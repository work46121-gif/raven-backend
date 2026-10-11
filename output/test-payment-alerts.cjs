const fs=require('node:fs'),assert=require('node:assert/strict');
const {PGlite}=require('./push-test-runtime/node_modules/@electric-sql/pglite');
const {alertText}=require('../raven-push');
(async()=>{
 const pg=new PGlite();
 try{
  const existing=fs.readFileSync('output/test-push-upgrade-sql.cjs','utf8');
  await pg.exec(existing.match(/await pg.exec\(`(create role[\s\S]*?)`\);/)[1]);
  await pg.exec('create table bills(id text,creator_email text,paid_by text); alter table participants add paid boolean default false, add paid_at text, add name text; alter table trips add sweep_payments jsonb default \'[]\'; alter table profiles add privacy_payment_alerts boolean default true;');
  await pg.exec(fs.readFileSync('output/raven-phone-alerts-migration.sql','utf8'));
  const sql=fs.readFileSync('output/raven-payment-alerts.sql','utf8');await pg.exec(sql);await pg.exec(sql);
  const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
  await pg.exec(`insert into auth.users values('${a}'),('${b}');
   insert into profiles(id,email,first_name,last_name,raven_id) values('${a}','a@test.invalid','Alex','A','alex'),('${b}','b@test.invalid','Blair','B','blair');
   insert into trips(id,name,creator_email,member_emails,people) values('T','Test','a@test.invalid','["b@test.invalid"]','["Alex","Blair"]');
   insert into bills values('B','a@test.invalid','Alex');
   delete from raven_push_events;`);
  const count=async()=>Number((await pg.query("select count(*) as n from raven_push_events where kind='trip_payment' or event_key like 'bill_payment:%'")).rows[0].n);
  await pg.exec("insert into participants(id,bill_id,name,phone,paid,paid_at) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','B','Blair','b@test.invalid',true,'date1')");
  assert.equal(await count(),1);
  await pg.exec("update participants set paid=true,paid_at='date2'");assert.equal(await count(),1,'repeat does not alert');
  await pg.exec("update participants set paid=false");assert.equal(await count(),1,'undo does not alert');
  const save=payments=>pg.query("update trips set sweep_payments=$1::jsonb where id='T'",[JSON.stringify(payments)]);
  const p={id:'pay1',from:'Blair',to:'Alex',amount:10};
  await save([p]);assert.equal(await count(),2);
  await save([p]);assert.equal(await count(),2);
  await save([{...p,reversed_at:'now'}]);assert.equal(await count(),2);
  await pg.exec(`update profiles set privacy_payment_alerts=false where id='${a}'`);
  await save([p,{...p,id:'pay2'}]);assert.equal(await count(),2,'opt out');
  await pg.exec(`update profiles set privacy_payment_alerts=true where id='${a}'`);
  await save([p,{...p,id:'pay2'},{...p,id:'pay3',to:'Stranger'}]);assert.equal(await count(),2,'unlinked recipient blocked');
  await pg.exec('begin');await save([{...p,id:'rollback'}]);await pg.exec('rollback');assert.equal(await count(),2,'failed transaction has no alert');
  const events=(await pg.query("select * from raven_push_events where kind='trip_payment' or event_key like 'bill_payment:%'")).rows;
  assert.ok(events.every(e=>e.user_id===a&&alertText(e)==='Blair recorded a payment on RAVEN'));
  console.log('PASS payment notifications: atomic save, rollback, duplicate save, undo, preference, linked recipient, first-name text; no real notifications sent.');
 }finally{await pg.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
