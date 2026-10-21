'use strict';
// Synthetic PostgreSQL and injected HTTP only. Never sends an actual email.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('./push-test-runtime/node_modules/@electric-sql/pglite');
const weekly=require('../raven-newsletter-weekly'),newsletter=require('../raven-newsletter'),issues=require('../raven-newsletter-issues');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333',D='44444444-4444-4444-8444-444444444444';
const content=issues.approved();assert.ok(content.length);for(const i of issues.all()){assert.ok(i.html.includes('1624 Broadway'));assert.ok(i.html.includes('{{UNSUBSCRIBE_URL}}'));assert.ok(i.text.includes('{{UNSUBSCRIBE_URL}}'));assert.ok(!i.html.includes('<script'))}
async function sqlTest(){
 const pg=new PGlite();try{
  await pg.exec(`set time zone 'UTC';create role anon;create role authenticated;create role service_role;create schema auth;
   create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create table profiles(id uuid primary key,privacy_email_marketing boolean,updated_at timestamptz);
   insert into auth.users values('${A}','a@test.invalid',now()),('${B}','b@test.invalid',now()),('${C}','c@test.invalid',null),('${D}','d@test.invalid',now());
   insert into profiles values('${A}',true,now()),('${B}',false,now()),('${C}',true,now()),('${D}',true,now());`);
  await pg.exec(fs.readFileSync('output/raven-newsletter.sql','utf8'));
  const sql=fs.readFileSync('output/raven-newsletter-weekly.sql','utf8');await pg.exec(sql);await pg.exec(sql);
  assert.equal((await pg.query('select enabled from raven_newsletter_schedule')).rows[0].enabled,false,'migration never activates mailing');
  const next=async t=>(await pg.query('select raven_newsletter_next_monday($1)::text n',[t])).rows[0].n;
  assert.match(await next('2026-10-21T12:00:00Z'),/^2026-10-26 14:00:00/);
  assert.match(await next('2026-10-26T14:00:00Z'),/^2026-11-02 15:00:00/,'fall DST remains 10am Eastern');
  assert.match(await next('2027-03-08T15:00:00Z'),/^2027-03-15 14:00:00/,'spring DST remains 10am Eastern');
  const sync=(t,c=content)=>pg.query('select raven_newsletter_weekly_sync($1,$2)',[JSON.stringify(c),t]);
  const claim=async t=>(await pg.query('select raven_newsletter_weekly_claim($1) d',[t])).rows[0].d;
  await pg.exec("update raven_newsletter_schedule set next_run_at='2026-10-26T14:00:00Z'");await sync('2026-10-26T14:00:00Z');assert.equal((await pg.query('select * from raven_newsletter_weekly_runs')).rows.length,0,'paused means no campaign');
  await pg.exec(`update raven_newsletter_schedule set enabled=true;update raven_newsletter_subscribers set email='previous@test.invalid' where user_id='${D}';`);
  await sync('2026-10-26T13:59:59Z');assert.equal((await pg.query('select * from raven_newsletter_weekly_runs')).rows.length,0,'not a second early');
  await sync('2026-10-26T14:00:00Z',[]);assert.equal((await pg.query('select last_error from raven_newsletter_schedule')).rows[0].last_error,'no_approved_content');
  await Promise.all([sync('2026-10-26T14:00:00Z'),sync('2026-10-26T14:00:00Z')]);
  assert.equal((await pg.query('select * from raven_newsletter_weekly_runs')).rows.length,1,'one campaign under concurrent ticks');
  assert.deepEqual((await pg.query('select user_id from raven_newsletter_weekly_deliveries')).rows,[{user_id:A}],'only opted-in, confirmed current addresses');
  await pg.exec(`insert into raven_newsletter_subscribers(user_id,email,enabled,consent_source) values('${B}','b@test.invalid',true,'test');`);
  await sync('2026-10-26T14:01:00Z');assert.equal((await pg.query('select * from raven_newsletter_weekly_deliveries')).rows.length,1,'audience freezes once');
  assert.equal(await claim('2026-10-26T13:59:59Z'),null);
  const first=await claim('2026-10-26T14:00:00Z');assert.equal(first.user_id,A);assert.equal(first.attempts,1);
  assert.equal(await claim('2026-10-26T14:01:00Z'),null,'lease prevents duplicate worker claim');
  await pg.query('update raven_newsletter_weekly_deliveries set request_payload=$1',[JSON.stringify({immutable:'original body'})]);
  const retry=await claim('2026-10-26T14:06:00Z');assert.equal(retry.attempts,2);assert.notEqual(retry.lease,first.lease);assert.deepEqual(retry.request_payload,{immutable:'original body'});
  const finish=async(lease,outcome)=>(await pg.query('select raven_newsletter_weekly_finish($1,$2,$3,$4,$5) ok',[first.run_id,A,lease,outcome,'provider-id'])).rows[0].ok;
  assert.equal(await finish(first.lease,'sent'),false,'old worker cannot overwrite a recovered lease');
  await pg.exec("update raven_newsletter_weekly_runs set scheduled_at=now()-interval '1 minute';update raven_newsletter_weekly_deliveries set lease_until=now()+interval '5 minutes'");
  const allowed=async()=>(await pg.query('select raven_newsletter_weekly_allowed($1,$2,$3) ok',[first.run_id,A,retry.lease])).rows[0].ok;
  assert.equal(await allowed(),true);await pg.exec(`update raven_newsletter_subscribers set enabled=false where user_id='${A}'`);assert.equal(await allowed(),false,'immediate opt-out rechecked');
  await pg.exec(`update raven_newsletter_subscribers set enabled=true where user_id='${A}';update auth.users set email='changed@test.invalid' where id='${A}'`);assert.equal(await allowed(),false,'changed address cannot receive');
  await pg.exec(`update auth.users set email='a@test.invalid' where id='${A}';update raven_newsletter_schedule set enabled=false`);assert.equal(await allowed(),false,'pause honored immediately');
  await pg.exec('update raven_newsletter_schedule set enabled=true');assert.equal(await finish(retry.lease,'sent'),true);
  await claim('2026-10-26T14:07:00Z');assert.equal((await pg.query('select status from raven_newsletter_weekly_runs')).rows[0].status,'complete');
  await sync('2026-11-02T15:00:00Z');assert.equal((await pg.query('select count(*)::int n from raven_newsletter_weekly_runs')).rows[0].n,1,'without rotation approval an approved issue is not reused');
  await pg.exec('update raven_newsletter_schedule set rotation_enabled=true');await sync('2026-11-02T15:00:00Z');assert.equal((await pg.query('select count(*)::int n from raven_newsletter_weekly_runs')).rows[0].n,2);
  const second=await claim('2026-11-02T15:00:01Z');assert.ok(second);assert.equal(second.run_id,'2026-11-02');
  await claim('2026-11-03T05:00:00Z');assert.equal((await pg.query("select count(*)::int n from raven_newsletter_weekly_deliveries where status='sending'")).rows[0].n,0,'no retry after Monday send window');
  await sync('2026-11-18T18:00:00Z');assert.equal((await pg.query("select count(*)::int n from raven_newsletter_weekly_deliveries where run_id>='2026-11-09'")).rows[0].n,0,'no backlog blast after extended downtime');
  const status=(await pg.query('select raven_newsletter_weekly_status() s')).rows[0].s;assert.ok(!JSON.stringify(status).includes('@test.invalid'),'admin status only returns aggregates');assert.equal(status.runs.find(r=>r.id==='2026-10-26').accepted,1);
  await pg.exec(sql);assert.equal((await pg.query('select enabled from raven_newsletter_schedule')).rows[0].enabled,true,'rerun preserves existing operator choice');
  for(const role of ['anon','authenticated']){const acl=(await pg.query(`select has_table_privilege('${role}','raven_newsletter_weekly_deliveries','select') a,has_function_privilege('${role}','raven_newsletter_weekly_sync(jsonb,timestamptz)','execute') b`)).rows[0];assert.deepEqual(acl,{a:false,b:false})}
  const old=(await pg.query('select status from raven_newsletter_campaigns')).rows[0];assert.equal(old.status,'draft','legacy campaign untouched');
 }finally{await pg.close()}
}
async function workerTest(){
 const calls=[],requests=[],writes=[],routes={};let allowed=true,claimed=false,network=false,saveFail=false,response={ok:true,status:200,json:async()=>({id:'provider'})};
 const row={run_id:'2026-10-26',user_id:A,email:'a@test.invalid',lease:B,content:content[0],attempts:1};
 const db={rpc:async(name,args)=>{calls.push({name,args});if(name.endsWith('_claim')){if(claimed)return {data:null};claimed=true;return {data:row}}if(name.endsWith('_allowed'))return {data:allowed};if(name.endsWith('_status'))return {data:{schedule:{enabled:true}}};return {data:true}},from(table){const q={update(v){writes.push({table,value:v});return q},eq(){return q},select(){return q},then(resolve){return Promise.resolve(saveFail?{error:Error('offline')}:{data:[{user_id:A}]}).then(resolve)}};return q}};
 const admin=()=>{},worker=weekly({get:(url,...handlers)=>routes[url]=handlers},db,admin,{SUPABASE_SERVICE_KEY:'fixture',RESEND_API_KEY:'fixture'},async(url,options)=>{requests.push({url,options});if(network)throw Error('network');return response},newsletter.tokenFor,{sleep:async()=>{},log:()=>{}});
 await worker.tick();assert.equal(requests.length,1);assert.equal(requests[0].options.headers['Idempotency-Key'],'newsletter-weekly:2026-10-26:'+A);const body=JSON.parse(requests[0].options.body);assert.ok(body.html.includes('1624 Broadway'));assert.ok(!body.html.includes('{{'));assert.ok(body.headers['List-Unsubscribe-Post']);assert.equal(calls.at(-2).name,'raven_newsletter_weekly_finish');
 allowed=false;await worker.deliver(row);assert.equal(requests.length,1);assert.equal(calls.at(-1).args.p_outcome,'skipped');allowed=true;
 network=true;await worker.deliver({...row,request_payload:body});assert.equal(calls.at(-1).args.p_outcome,'retry');assert.equal(requests.at(-1).options.body,requests[0].options.body,'retry uses frozen provider body');network=false;
 saveFail=true;await assert.rejects(worker.deliver(row));assert.equal(requests.length,2,'cannot send when idempotent payload persistence failed');saveFail=false;
 response={ok:false,status:429,json:async()=>({name:'daily_quota_exceeded'}),headers:{get:()=>null}};assert.equal(await worker.deliver({...row,request_payload:body}),false);assert.equal(calls.at(-1).args.p_outcome,'failed');assert.equal(writes.at(-1).value.last_error,'daily_quota_exceeded');
 assert.equal(weekly.failure(503,{},null).outcome,'retry');assert.equal(weekly.failure(409,{name:'invalid_idempotent_request'},null).outcome,'failed');assert.equal(weekly.failure(409,{name:'concurrent_idempotent_requests'},null).outcome,'retry');
 assert.equal(routes['/admin/newsletter/status'][0],admin,'status requires existing admin authorization');let result;await routes['/admin/newsletter/status'][1]({}, {set(){},json(v){result=v},status(){return this}});assert.equal(result.day,'Monday');assert.equal(result.time,'10:00');assert.equal(result.timezone,'America/New_York');assert.ok(!JSON.stringify(result).includes('fixture'));
}
(async()=>{await sqlTest();await workerTest();console.log('PASS weekly newsletter: Monday 10am/DST, paused migration, atomic per-week audience, concurrent/restart dedupe, stale lease protection, frozen request/retries, consent/email recheck, no late backlog, quota errors, private admin status and unchanged legacy sends. No external emails sent.');})().catch(e=>{console.error(e);process.exitCode=1});
