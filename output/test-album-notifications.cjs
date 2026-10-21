'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const {PGlite}=require('./push-test-runtime/node_modules/@electric-sql/pglite');
const N=require('../raven-album-notifications'),push=require('../raven-push');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333',BATCH='44444444-4444-4444-8444-444444444444';
async function sqlTest(){
 const pg=new PGlite();try{
  await pg.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
   create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key);
   create table profiles(id uuid primary key,email text,first_name text,last_name text,raven_id text);
   create table trips(id text primary key,name text,due_date date,creator_email text,member_emails text,people jsonb,total numeric);
   create table direct_messages(id uuid default gen_random_uuid(),sender_id uuid,receiver_id uuid);
   create table raven_chat_messages(id uuid default gen_random_uuid(),chat_id uuid,sender_id uuid);create table raven_chat_members(chat_id uuid,user_id uuid);
   create table participants(id uuid default gen_random_uuid(),bill_id text,phone text,amount numeric);
   create table trip_messages(id uuid default gen_random_uuid(),trip_id text,user_id uuid);create table trip_comments(id bigint generated always as identity,trip_id text,user_id text);
   create table trip_receipts(id uuid default gen_random_uuid(),trip_id text,added_by text,splits jsonb);create table raven_friends(id uuid default gen_random_uuid(),user_id uuid,friend_id uuid,status text);
   create table raven_trip_album(id uuid primary key default gen_random_uuid(),trip_id text references trips(id),uploader_id uuid references auth.users(id),kind text,created_at timestamptz default now());
   alter table raven_trip_album enable row level security;revoke all on raven_trip_album from public,anon,authenticated;grant all on raven_trip_album to service_role;
   insert into auth.users values('${A}'),('${B}'),('${C}');
   insert into profiles values('${A}','owner@test.invalid','Alex','A','alex'),('${B}','member@test.invalid','Blair','B','blair'),('${C}','outsider@test.invalid','Blair','C','other');
   insert into trips values('T','Trip <private>',null,'owner@test.invalid','["member@test.invalid"]','["Alex","Blair"]',123.45);
   insert into raven_trip_album(trip_id,uploader_id,kind) values('T','${B}','photo');`);
  await pg.exec(fs.readFileSync('output/raven-phone-alerts-migration.sql','utf8'));
  const sql=fs.readFileSync('output/raven-trip-album-notifications.sql','utf8');await pg.exec(sql);await pg.exec(sql);
  assert.equal((await pg.query("select count(*)::int n from raven_push_events where kind='trip_album'")).rows[0].n,0,'no notifications for old uploads');
  const add=(batch=BATCH,uploader=B)=>pg.query('insert into raven_trip_album(trip_id,uploader_id,kind,upload_batch_id) values($1,$2,$3,$4) returning id',['T',uploader,'photo',batch]);
  const first=await add();for(let i=0;i<9;i++)await add();
  const events=(await pg.query("select * from raven_push_events where kind='trip_album'")).rows;
  assert.equal(events.length,1,'ten files produce only one alert per recipient');assert.equal(events[0].user_id,A,'uploader and unrelated same-name profile excluded');
  assert.equal(events[0].source_id,'T');assert.ok(Date.parse(events[0].available_at)-Date.parse(events[0].created_at)>=89900,'summary has a batching delay');
  await pg.query('insert into raven_trip_album(id,trip_id,uploader_id,kind,upload_batch_id) values($1,$2,$3,$4,$5) on conflict(id) do nothing',[first.rows[0].id,'T',B,'photo',BATCH]);
  assert.equal((await pg.query("select count(*)::int n from raven_push_events where kind='trip_album'")).rows[0].n,1,'lost-response retry never duplicates');
  await pg.exec("update raven_push_events set attempts=1,done=true where kind='trip_album'");const before=(await pg.query('select * from raven_push_events')).rows;
  await add();assert.deepEqual((await pg.query('select * from raven_push_events')).rows,before,'later retries never reopen a delivered summary');
  await add(A);assert.equal((await pg.query("select count(*)::int n from raven_push_events where kind='trip_album'")).rows[0].n,2,'new upload batch gets a new summary');
  await add(null);await add(null);assert.equal((await pg.query("select count(*)::int n from raven_push_events where kind='trip_album'")).rows[0].n,3,'legacy uploads are coalesced');
  await pg.exec("update trips set member_emails='[]' where id='T'");await add(C,A);assert.equal((await pg.query("select count(*)::int n from raven_push_events where kind='trip_album'")).rows[0].n,3,'unlinked former members do not receive new alerts');
  await pg.exec(sql);assert.equal((await pg.query('select total from trips')).rows[0].total,'123.45');
  const acl=(await pg.query("select has_table_privilege('anon','raven_trip_album','select') a,has_table_privilege('authenticated','raven_push_events','select') b,has_function_privilege('authenticated','raven_album_summary_alert()','execute') c")).rows[0];assert.deepEqual(acl,{a:false,b:false,c:false});
 }finally{await pg.close()}
}
async function apiTest(){
 let actor={id:A,email:'owner@test.invalid'},route,lookupError=false;
 const data={raven_push_events:[{id:'mine',user_id:A,kind:'trip_album',source_id:'T',created_at:'2026-10-21T12:00:00Z'},{id:'removed',user_id:A,kind:'trip_album',source_id:'OTHER'},{id:'someone-else',user_id:B,kind:'trip_album',source_id:'T'}],trips:[{id:'T',name:'Weekend',creator_email:'owner@test.invalid',member_emails:[]},{id:'OTHER',name:'Private',creator_email:'other@test.invalid',member_emails:[]}]};
 const db={from(table){const filters=[];const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},order(){return q},limit(){return q},then(fn){return Promise.resolve(lookupError?{error:Error('offline')}:{data:data[table].filter(r=>filters.every(f=>f(r)))}).then(fn)}};return q},rpc:async()=>({data:[{id:A}]})};
 N.register({get:(p,f)=>route=f},db,async()=>actor);
 async function call(){let status=200,body;await route({}, {set(){},status(n){status=n;return this},json(v){body=v}});return {status,body}}
 assert.deepEqual((await call()).body.notifications,[{id:'mine',trip_id:'T',trip_name:'Weekend',created_at:'2026-10-21T12:00:00Z'}]);
 actor=null;assert.equal((await call()).status,401);actor={id:C,email:'outsider@test.invalid'};assert.deepEqual((await call()).body.notifications,[]);
 actor={id:A,email:'owner@test.invalid'};lookupError=true;assert.equal((await call()).status,503);
 assert.equal(await N.eligible(db,{user_id:A,source_id:'T'}),true);assert.equal(await N.eligible(db,{user_id:B,source_id:'T'}),false,'delivery rechecks membership');
 assert.equal(push.alertText({kind:'trip_album',trip_name:'Private',actor_name:'Private'}),'New photos added in a trip');
}
async function clientTest(){
 const d=fs.readFileSync('../account-release-site/dashboard.html','utf8'),start=d.indexOf('async function buildAlbumNotifications('),script=d.slice(start,d.indexOf('async function buildNotifications()',start));
 const ctx={AbortController,setTimeout,clearTimeout,Set,BACKEND:'https://fixture.invalid',currentUser:{id:A},db:{auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}})}},openTrip:id=>ctx.opened=id,fetch:async()=>({ok:true,json:async()=>({success:true,notifications:[{id:'event',trip_id:'T',trip_name:'Weekend',created_at:'2026-10-21T12:00:00Z'}]})})};vm.createContext(ctx);vm.runInContext(script,ctx);
 const events=await ctx.buildAlbumNotifications(A,new Set());assert.equal(events.length,1);assert.equal(events[0].title,'New photos added in a trip');events[0].action();assert.equal(ctx.opened,'T');
 assert.equal((await ctx.buildAlbumNotifications(A,new Set(['album-event'])))[0].unread,false);
 ctx.currentUser.id=B;assert.equal((await ctx.buildAlbumNotifications(A,new Set())).length,0,'late response from old account is ignored');
 ctx.currentUser.id=A;ctx.fetch=async()=>{throw Error('offline')};assert.equal((await ctx.buildAlbumNotifications(A,new Set())).length,0,'notification failure never breaks inbox');
}
async function workerTest(){
 const event={id:'event',lease:'lease',kind:'trip_album',source_id:'T',user_id:A,created_at:'2026-10-21T12:00:00Z',attempts:1};let member=true,failed=false,sent=0,saved=[],deviceLookups=0;
 const db={rpc:async name=>name==='raven_claim_phone_alerts'?{data:[event]}:failed?{error:Error('offline')}:{data:member?[{id:A}]:[]},from(table){const filters=[];let update;const q={select(){deviceLookups++;return q},update(v){update=v;return q},eq(k,v){filters.push([k,v]);return q},then(resolve){if(table==='raven_push_events'){saved.push({update,filters});return resolve({})}return resolve({data:[{token:'fixture',platform:'android',session_id:B,updated_at:'2026-10-20T12:00:00Z'}]})}};return q}};
 const worker=push({get(){},post(){},delete(){}},db,async()=>null,{RAVEN_PUSH_ENABLED:'1',FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:'fixture',private_key:'fixture',project_id:'fixture'})},async(_env,_device,e)=>{assert.equal(e.kind,'trip_album');sent++;return {status:200}});
 try{
  await worker.tick();assert.equal(sent,1);assert.equal(saved[0].update.done,true);assert.deepEqual(saved[0].filters,[['id','event'],['lease','lease']]);
  member=false;saved=[];deviceLookups=0;await worker.tick();assert.equal(sent,1);assert.equal(deviceLookups,0,'removed member never reaches provider/device lookup');assert.equal(saved[0].update.done,true);
  failed=true;saved=[];await worker.tick();assert.equal(sent,1);assert.equal(saved.length,0,'membership lookup failure leaves claimed event retryable');
 }finally{worker.stop()}
}
(async()=>{await sqlTest();await apiTest();await clientTest();await workerTest();console.log('PASS: album batch notifications, retry idempotency, sender exclusion, membership/privacy checks, delayed delivery, no backfill, unchanged totals, authenticated inbox feed, read state, worker delivery/skip/retry and safe offline fallback.');})().catch(e=>{console.error(e);process.exitCode=1});
