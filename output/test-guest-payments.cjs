'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('./push-test-runtime/node_modules/@electric-sql/pglite');
const G=require('../raven-guest-payments'),S=require('../raven-guest-payments-server');
const owner={id:'00000000-0000-4000-8000-000000000001',email:'owner@example.invalid'};
async function sqlTests(){
 const pg=new PGlite();
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,email text);
 create table bills(id text primary key,creator_phone text,status text,total numeric);
 create table participants(id integer primary key,bill_id text references bills(id),phone text,name text,amount numeric,paid boolean);
 insert into auth.users values('${owner.id}','${owner.email}');
 insert into bills values('B','${owner.email}','active',30);
 insert into participants values(1,'B','unknown_guest_B','Guest',15,true),(2,'B','linked@example.invalid','Member',15,false);`);
 const sql=fs.readFileSync('output/raven-guest-payment-methods.sql','utf8');await pg.exec(sql);await pg.exec(sql);
 const row={participant_id:1,guest_identity:'unknown_guest_B',venmo:'guest_demo',cashapp:'GuestDemo',applepay:'+15551234567'};
 const save=(entries=[row],actor=owner.id,email=owner.email)=>pg.query('select raven_save_guest_payment_methods($1,$2,$3,$4)', ['B',actor,email,JSON.stringify(entries)]);
 const before=await pg.query('select * from participants order by id');
 await save();await save();assert.equal((await pg.query('select * from bill_guest_payment_methods')).rows.length,1,'idempotent retry');
 await assert.rejects(save([row],owner.id,'other@example.invalid'));
 await assert.rejects(save([{...row,guest_identity:'stale'}]));
 await assert.rejects(save([{...row,participant_id:2,guest_identity:'linked@example.invalid'}]));
 await assert.rejects(save([row,row]));
 await assert.rejects(save([{...row,venmo:'changed'}, {...row,participant_id:999}]));
 assert.equal((await pg.query('select venmo from bill_guest_payment_methods')).rows[0].venmo,'guest_demo','invalid batch rolls back');
 await assert.rejects(save([{...row,applepay:'javascript:alert(1)'}]));
 assert.deepEqual(await pg.query('select * from participants order by id'),before,'no amounts/paid/name/identity changed');
 assert.equal((await pg.query('select total from bills')).rows[0].total,'30');
 for(const role of ['anon','authenticated']){
  await pg.exec('set role '+role);
  await assert.rejects(pg.query('select * from bill_guest_payment_methods'));
  await assert.rejects(save());await pg.exec('reset role');
 }
 await pg.exec('set role service_role');await save();await pg.exec('reset role');
 await pg.exec(`update participants set phone='linked@example.invalid' where id=1`);await assert.rejects(save());
 await pg.exec(`update participants set phone='unknown_guest_B' where id=1;update bills set status='deleted' where id='B'`);await assert.rejects(save());
 await pg.exec(`update bills set status='active' where id='B';delete from auth.users where id='${owner.id}'`);
 assert.equal((await pg.query('select count(*)::int n from bill_guest_payment_methods')).rows[0].n,0);
 assert.equal((await pg.query('select count(*)::int n from participants')).rows[0].n,2,'account deletion contact cascade preserves shared financials');
 await pg.close();
}
async function apiTests(){
 const routes={},calls=[];let actor=owner;
 const data={bills:[{id:'B',share_token:'secret',creator_phone:owner.email,paid_by:'Guest',status:'active'}],participants:[{id:1,bill_id:'B',name:'Guest',phone:'unknown_guest_B'},{id:2,bill_id:'B',name:'Member',phone:'linked@example.invalid'}],bill_guest_payment_methods:[{participant_id:1,bill_id:'B',guest_identity:'unknown_guest_B',venmo:'guest_demo',cashapp:'',applepay:''}]};
 const db={from(table){let single=false;const filters=[];const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},maybeSingle(){single=true;return q},then(fn,fail){const rows=(data[table]||[]).filter(r=>filters.every(f=>f(r)));return Promise.resolve({data:single?rows[0]||null:rows,error:null}).then(fn,fail)}};return q},async rpc(name,args){calls.push({name,args});return{data:true,error:null}}};
 S.register({post:(p,f)=>routes.POST=f,get:(p,f)=>routes.GET=f},db,async()=>actor);
 async function run(method,body={},token='secret'){let code=200,output;const res={set(){},status(n){code=n;return this},json(value){output=value;return this}};await routes[method]({params:{billId:'B'},headers:{'x-raven-bill-token':token},body},res);return{code,output}}
 const entries=[{name:'Guest',methods:{venmo:'@guest_demo',cashapp:'$GuestDemo',applepay:'+1 (555) 123-4567'}}];
 assert.equal((await run('POST',{entries})).code,200);assert.equal(calls[0].args.p_entries[0].applepay,'+15551234567');
 const allowed=calls.length;
 actor=null;assert.equal((await run('POST',{entries})).code,401);assert.equal((await run('GET',{},'bad')).code,401);
 assert.equal((await run('GET')).output.profile.venmo,'guest_demo','private payment link works without signup');
 actor={id:'other',email:'outsider@example.invalid'};assert.equal((await run('POST',{entries})).code,403);assert.equal((await run('GET',{},'bad')).code,403);
 actor={id:'member',email:'linked@example.invalid'};assert.equal((await run('GET',{},'')).code,200);
 actor=owner;assert.equal((await run('POST',{entries},'bad')).code,403);
 assert.equal((await run('POST',{entries:[{name:'Member',methods:{venmo:'bad'}}]})).code,409);
 assert.equal((await run('POST',{entries:[{name:'Guest',methods:{venmo:'https://evil.invalid'}}]})).code,400);
 assert.equal((await run('POST',{entries:[...entries,...entries]})).code,400);
 assert.equal(calls.length,allowed,'unauthorized or invalid requests never write');
 data.participants[0].phone='linked@example.invalid';assert.equal(await S.payer(db,data.bills[0]),null,'manual details never attach to an assigned account');
 data.participants[0].phone='unknown_different';assert.equal(await S.payer(db,data.bills[0]),null,'stale guest identity suppressed');
 data.bills[0].status='deleted';assert.equal((await run('GET')).code,404);
}
(async()=>{
 assert.deepEqual(G.normalize({venmo:'@name-x',cashapp:'$NameX',applepay:'+1 (555) 123-4567'}),{venmo:'name-x',cashapp:'NameX',applepay:'+15551234567'});
 for(const value of [{venmo:'javascript:evil'}, {venmo:'https://venmo.com/name'}, {cashapp:'123'}, {applepay:'+1;evil'}, {admin:true},{venmo:42}])assert.throws(()=>G.normalize(value));
 assert.equal(G.isGuest({name:'Guest',phone:'unknown_guest'}),true);assert.equal(G.isGuest({name:'@melad',phone:'guest:melad'}),false);
 await sqlTests();await apiTests();console.log('PASS: normalization, authenticated creator-only writes, private reads, linked-account rejection, atomic/idempotent SQL, RLS/revoked access, stale identities, deletion cleanup, unchanged balances.');
})().catch(e=>{console.error(e);process.exitCode=1});
