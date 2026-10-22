'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('./push-test-runtime/node_modules/@electric-sql/pglite');
const P=require('../raven-plus'),S=require('../raven-plus-server');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
function domain(){
 const now=Date.parse('2026-10-21T16:00:00Z');
 const grant={user_id:A,provider:'apple',environment:'production',starts_at:'2026-10-01T00:00:00Z',ends_at:'2026-11-01T00:00:00Z',revoked_at:null};
 assert.equal(P.membership([grant],A,now).tier,'plus');
 assert.equal(P.membership([{...grant,auto_renew:false}],A,now).tier,'plus','cancelled renewal retains paid period');
 for(const mutation of [{environment:'sandbox'},{revoked_at:'2026-10-20T00:00:00Z'},{user_id:B},{starts_at:'2026-12-01T00:00:00Z'},{ends_at:'2026-10-21T16:00:00Z'},{ends_at:null},{ends_at:'invalid'},{provider:'client'},{provider:'badge'}])assert.equal(P.membership([{...grant,...mutation}],A,now).tier,'free',JSON.stringify(mutation));
 assert.equal(P.membership([{...grant,provider:'complimentary'}],A,now).source,'complimentary');
 assert.equal(P.membership([], 'dd58ecef-0b94-4c53-ac39-ddf573ad1efb',now).tier,'free','cosmetic founder badge is not a membership');
 const f=P.projection({grants:[],hosted_trips:[{status:'active'},{status:'completed'}]},A,now);
 assert.equal(f.proposed.remaining,0);assert.equal(f.proposed.can_host_or_sponsor,false);assert.equal(f.enforced,false);assert.equal(f.existing_access_unchanged,true);assert.equal(f.proposed.joining_unlimited,true);
 const paid=P.projection({grants:[grant],hosted_trips:Array(40).fill({status:'active'}),sponsored_trips:[{status:'active'}]},A,now);assert.equal(paid.proposed.remaining,9,'joined or hosted trips do not silently consume sponsor slots');
 assert.equal(P.activeTrip({status:'active',end_date:'2026-10-21'},now),false);assert.equal(P.activeTrip({status:'active',end_date:'2026-02-30'},now),true);assert.equal(P.activeTrip({trip_date:'2026-10-19',total:0},now),false);assert.equal(P.activeTrip({trip_date:'2026-10-19',total:null},now),true);
 assert.equal(P.activeTrip({status:'archived'},now),false);assert.equal(P.activeTrip({end_date:'2026-10-22'},now),true);
 const trip={trip:{status:'active'},sponsors:[{user_id:A,linked:true,grants:[grant]}]};assert.equal(P.tripProjection(trip,now).tier,'plus');trip.sponsors[0].linked=false;assert.equal(P.tripProjection(trip,now).tier,'free');trip.sponsors.push({user_id:B,linked:true,grants:[{...grant,user_id:B}]});assert.equal(P.tripProjection(trip,now).tier,'plus','another eligible sponsor can retain Plus');
 assert.deepEqual(Object.keys(P.tripProjection(trip,now)).sort(),['completed','enforced','existing_access_unchanged','sponsor_count','tier']);
 assert.equal(P.POLICY.checkout_enabled,false);assert.equal(P.POLICY.enforced,false);assert.equal(P.POLICY.limits_confirmed,false);assert.equal(P.POLICY.trip_pass_enabled,false);
 assert.equal(P.POLICY.monthly_cents,599);assert.equal(P.POLICY.annual_cents,3999);
}
async function sql(){
 const pg=new PGlite();try{
  await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
   create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
   create table trips(id text primary key,creator_email text,member_emails text,status text,trip_date text,end_date text,total numeric,receipt_count int);
   create table bills(id text,total numeric);insert into bills values('unchanged',26.74);
   insert into auth.users values('${A}','a@example.invalid',now()),('${B}','b@example.invalid',now());
   insert into trips values('OWN','a@example.invalid','[]','active',null,null,20,1),('JOIN','b@example.invalid','["a@example.invalid"]','active',null,null,20,1),('OTHER','b@example.invalid','[]','active',null,null,20,1);`);
  const migration=fs.readFileSync('output/raven-plus-membership.sql','utf8');await pg.exec(migration);await pg.exec(migration);
  assert.equal((await pg.query('select count(*)::int n from raven_plus_memberships')).rows[0].n,0,'no seeded entitlements');
  const base=Date.now()-600000,time=n=>new Date(base+n).toISOString();
  const facts=[A,'apple','production','subscription-a','event-a',time(0),time(-86400000),time(86400000),null];
  const record=async args=>(await pg.query('select raven_plus_record_verified_membership($1,$2,$3,$4,$5,$6,$7,$8,$9) result',args)).rows[0].result;
  assert.equal(await record(facts),'applied');assert.equal(await record(facts),'duplicate');
  await assert.rejects(record([B,...facts.slice(1)]),/different account/);
  const conflict=[...facts];conflict[7]=time(2*86400000);await assert.rejects(record(conflict),/Conflicting/);
  const renewal=[...facts];renewal[4]='renewal';renewal[5]=time(1000);renewal[7]=time(2*86400000);assert.equal(await record(renewal),'applied');
  const refund=[...renewal];refund[4]='refund';refund[5]=time(2000);refund[8]=time(2000);assert.equal(await record(refund),'applied');
  const old=[...facts];old[4]='old-delayed';assert.equal(await record(old),'stale');
  assert.ok((await pg.query('select revoked_at from raven_plus_memberships')).rows[0].revoked_at,'old renewal cannot undo refund');
  assert.equal((await pg.query('select count(*)::int n from raven_plus_memberships')).rows[0].n,1);
  const future=[...facts];future[4]='bad-future';future[5]=time(86400000);await assert.rejects(record(future),/Invalid/);
  const sameEventOther=[...facts];sameEventOther[3]='another-subscription';await assert.rejects(record(sameEventOther),/Conflicting/);
  assert.equal((await pg.query('select count(*)::int n from raven_plus_memberships')).rows[0].n,1,'conflicting event cannot leave a new entitlement behind');
  const sandbox=[...facts];sandbox[2]='sandbox';sandbox[4]='sandbox';assert.equal(await record(sandbox),'applied');
  const current=[...facts];current[3]='second-valid';current[4]='second-valid';assert.equal(await record(current),'applied');
  await pg.exec(`insert into raven_plus_trip_sponsors(trip_id,user_id) values('JOIN','${A}'),('OTHER','${A}')`);
  const snapshot=async(id=A)=>(await pg.query('select raven_plus_account_snapshot($1) s',[id])).rows[0].s;
  let snap=await snapshot();assert.equal(snap.grants.length,2);assert.deepEqual(snap.hosted_trips.map(t=>t.id),['OWN']);assert.deepEqual(snap.sponsored_trips.map(t=>t.id),['JOIN'],'stale removed-member sponsor ignored');
  const tripSnapshot=async(id='JOIN',user=A)=>(await pg.query('select raven_plus_trip_snapshot($1,$2) s',[id,user])).rows[0].s;
  assert.equal(P.tripProjection(await tripSnapshot()).tier,'plus');assert.equal(await tripSnapshot('OTHER'),null);assert.equal(await tripSnapshot('MISSING'),null);
  assert.equal(P.tripProjection(await tripSnapshot('JOIN',B)).tier,'plus','all linked members see group benefit');
  assert.equal(P.projection(snap,A).tier,'plus');assert.ok(!JSON.stringify(snap).includes('subscription_id'));assert.ok(!JSON.stringify(snap).includes('@example.invalid'));
  assert.equal((await snapshot(B)).grants.length,0);
  await pg.exec("update trips set member_emails='[]' where id='JOIN'");assert.equal((await snapshot()).sponsored_trips.length,0);
  assert.equal(await tripSnapshot(),null);assert.equal(P.tripProjection(await tripSnapshot('JOIN',B)).tier,'free','removed sponsor cannot share benefits');
  await pg.exec(`update auth.users set email_confirmed_at=null where id='${A}'`);await assert.rejects(snapshot(),/Confirmed/);await pg.exec(`update auth.users set email_confirmed_at=now() where id='${A}'`);
  const linked=async(members,email='A@EXAMPLE.INVALID')=>(await pg.query('select raven_plus_is_linked($1,$2) b',[JSON.stringify({creator_email:'owner@example.invalid',member_emails:members}),email])).rows[0].b;
  assert.equal(await linked(['a@example.invalid']),true);assert.equal(await linked('["a@example.invalid"]'),true);assert.equal(await linked('bad json'),false);assert.equal(await linked(['A']),false);assert.equal(await linked([''],''),false);
  for(const role of ['anon','authenticated']){
   await pg.exec('set role '+role);await assert.rejects(pg.query('select * from raven_plus_memberships'));await assert.rejects(pg.query('insert into raven_plus_trip_sponsors values($1,$2,now())',['OWN',A]));await assert.rejects(snapshot());await assert.rejects(tripSnapshot());await assert.rejects(record(facts));await pg.exec('reset role');
  }
  await pg.exec(migration);assert.equal((await snapshot()).grants.length,2,'migration rerun preserves membership state');
  await pg.exec('set role service_role');assert.equal((await snapshot()).grants.length,2);await pg.exec('reset role');
  await pg.exec(`delete from auth.users where id='${A}'`);assert.equal((await pg.query('select count(*)::int n from raven_plus_memberships')).rows[0].n,0);assert.equal((await pg.query('select count(*)::int n from raven_plus_membership_events')).rows[0].n,0);assert.equal((await pg.query('select count(*)::int n from raven_plus_trip_sponsors')).rows[0].n,0);
  assert.equal((await pg.query('select count(*)::int n from trips')).rows[0].n,3);assert.equal((await pg.query('select total from bills')).rows[0].total,'26.74','financial data untouched');
 }finally{await pg.close();}
}
async function api(){
 const routes={},calls=[],admin=()=>{};let actor={id:A},failure=false;
 const db={rpc:async(name,args)=>{calls.push({name,args});if(failure)return {error:Error('database SECRET')};if(name==='raven_plus_trip_snapshot')return {data:args.p_trip_id==='JOIN'?{trip:{status:'active'},sponsors:[]}:null};return {data:{grants:[],hosted_trips:[],sponsored_trips:[]}}}};
 S.register({get:(path,...handlers)=>routes[path]=handlers},db,async()=>actor,admin);
 assert.deepEqual(Object.keys(routes).sort(),['/admin/plus/preview','/me/membership','/trips/:id/membership']);assert.equal(routes['/admin/plus/preview'][0],admin);
 async function request(path='/me/membership',id='JOIN'){
  let status=200,payload,headers={};const response={set(k,v){headers[k]=v;return this},status(n){status=n;return this},json(v){payload=v;return this}};
  await routes[path].at(-1)({params:{id},query:{user_id:B,tier:'plus'},body:{user_id:B,tier:'plus'}},response);return {status,payload,headers};
 }
 actor=null;assert.equal((await request()).status,401);assert.equal((await request('/trips/:id/membership')).status,401);assert.equal(calls.length,0);
 actor={id:A};const me=await request();assert.equal(calls[0].args.p_user_id,A);assert.equal(me.headers['Cache-Control'],'private, no-store');assert.equal(me.payload.membership.tier,'free');assert.equal(me.payload.membership.enforced,false);
 assert.equal((await request('/trips/:id/membership')).status,200);assert.equal((await request('/trips/:id/membership','OTHER')).status,404);assert.equal((await request('/trips/:id/membership','bad/input')).status,400);
 failure=true;const failed=await request();assert.equal(failed.status,503);assert.equal((await request('/trips/:id/membership')).status,503);assert.equal(failed.payload.membership,undefined);assert.ok(!JSON.stringify(failed).includes('SECRET'));
 const preview=await request('/admin/plus/preview');assert.ok(preview.payload.html.includes('One upgrade.'));assert.ok(!preview.payload.html.includes('/* RAVEN_PLUS_POLICY */ null'));assert.ok(preview.payload.html.includes('checkout_enabled'));assert.equal(preview.payload.policy.checkout_enabled,false);
 await assert.rejects(S.bounded(new Promise(()=>{}),10),/timeout/);
 const server=fs.readFileSync('server.js','utf8');assert.ok(server.includes("require('./raven-plus-server').register(app, supabase, getAuthenticatedRavenUser, requireRavenAdmin)"));
 const dashboard=fs.readFileSync('../account-release-site/dashboard.html','utf8');assert.ok(!dashboard.includes("fetch(BACKEND + '/me/membership'"),'no membership fetch on trip opening');
}
(async()=>{domain();await sql();await api();console.log('PASS Plus foundation: expiry/cancel/refund/sandbox/identity, free joining, sponsor removal, private SQL RLS, replay and out-of-order events, cross-account rejection, account-delete cascade, migration rerun, auth-only reads, offline safety, private preview and no financial/access changes. Synthetic only.');})().catch(e=>{console.error(e);process.exitCode=1});
