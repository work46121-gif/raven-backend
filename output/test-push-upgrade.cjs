const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const reminders = require('../raven-push-reminders');
const push = require('../raven-push');
const trip = { id:'ABCDE',name:'Test trip',due_date:'2026-10-06',people:['Mel','Bob'],member_emails:'["bob@test.invalid"]',creator_email:'mel@test.invalid' };
const slot = iso => reminders.schedule(trip,new Date(iso));
assert.equal(slot('2026-10-08T18:00:00Z'),null);
assert.equal(slot('2026-10-09T13:59:00Z'),null);
assert.equal(slot('2026-10-09T14:00:00Z').cycle,1);
assert.equal(slot('2026-10-12T14:00:00Z').cycle,2);
assert.equal(slot('2026-10-13T14:00:00Z').cycle,2); // Only current cycle, never backlog.
assert.equal(slot('2026-10-10T00:00:00Z'),null);
assert.equal(reminders.schedule({...trip,due_date:'2026-02-31'},new Date('2026-03-10T18:00:00Z')),null);
assert.equal(reminders.schedule({...trip,status:'deleted'},new Date('2026-10-09T18:00:00Z')),null);
assert.equal(reminders.schedule({...trip,type:'roommates'},new Date('2026-10-09T18:00:00Z')),null);
assert.equal(reminders.schedule({...trip,due_date:'2026-10-30'},new Date('2026-11-02T14:59:00Z')),null);
assert.equal(reminders.schedule({...trip,due_date:'2026-10-30'},new Date('2026-11-02T15:00:00Z')).cycle,1); // DST.
const profiles=[{id:'mel',email:'mel@test.invalid',first_name:'Mel'},{id:'bob',email:'bob@test.invalid',first_name:'Bob'},{id:'stranger',email:'stranger@test.invalid',first_name:'Bob'}];
assert.deepEqual(reminders.recipients(trip,profiles,[{name:'Bob',amount:50}]),['bob']);
assert.deepEqual(reminders.recipients(trip,profiles,[{name:'Bob',amount:.02}]),[]);
assert.deepEqual(reminders.recipients({...trip,member_emails:['bob@test.invalid','stranger@test.invalid']},profiles,[{name:'Bob',amount:50}]),[]);
assert.equal(push.alertText({kind:'dm',actor_name:'Mel'}),'Mel sent you a message on RAVEN');
assert.equal(push.alertText({kind:'group',actor_name:'Mel',body:'private message'}),'Mel sent you a message on RAVEN');
assert.equal(push.alertText({kind:'trip_comment',actor_name:'Mel',trip_name:'Miami'}),'Mel added a comment on trip Miami');
assert.equal(push.alertText({kind:'dm',actor_name:'\u202eM\nel'}),'Mel sent you a message on RAVEN');
assert.ok(push.alertText({kind:'trip_comment',actor_name:'a'.repeat(1000),trip_name:'b'.repeat(1000)}).length<210);
const server=fs.readFileSync('Server.js','utf8');
const helperContext={};vm.createContext(helperContext);
const start=server.indexOf('function parseSettledPeopleRecord('),end=server.indexOf('async function computeOutstanding(',start);
vm.runInContext(server.slice(start,end),helperContext);
const conciergeStart=server.indexOf('function parseTripPeople('),conciergeEnd=server.indexOf("app.",server.indexOf('function buildTripConciergePayload('));
// Extract only the balance calculation portion, before unrelated route code.
const body=server.slice(server.indexOf('function buildTripConciergePayload('),server.indexOf('  const totalSpent =',server.indexOf('function buildTripConciergePayload(')))+'return debtors;}';
vm.runInContext(server.slice(conciergeStart,server.indexOf('function buildTripConciergePayload('))+body,helperContext);
const debtorsFor=(t,r)=>helperContext.buildTripConciergePayload(t,r);
const receipts=[{id:'r1',paid_by:'Mel',splits:{Mel:20,Bob:50}}];
assert.equal(debtorsFor(trip,receipts)[0].amount,50);
assert.equal(debtorsFor({...trip,settled_people:{bob:50}},receipts).length,0);
assert.equal(debtorsFor({...trip,settled_people:['Bob']},receipts).length,0);
assert.equal(debtorsFor({...trip,settled_people:{bob:50,'bob::receipt::r1':20}},receipts)[0].amount,30);
assert.equal(debtorsFor({...trip,settled_people:{'bob::receipt::deleted':50}},receipts)[0].amount,50);
(async()=>{
 const adminDb={from(table){assert.equal(table,'raven_push_devices');return{select(columns){assert.equal(columns,'user_id,platform');return{in(){return{not:async()=>({data:[{user_id:'bob',platform:'ios'}]})}}}}}}};
 assert.equal((await push.registrationStatus(adminDb,['bob'],{})).bob.state,'service_unavailable');
 assert.equal((await push.registrationStatus(adminDb,['mel'],{})).mel.state,'not_registered');
 assert.match(server,/app.get\('\/admin\/profile\/:ravenId', requireRavenAdmin/);
 let current={...trip};
 const db={from(table){return{select(){return{eq(){return table==='trips'?{maybeSingle:async()=>({data:current})}:Promise.resolve({data:receipts})}}}}},rpc:async()=>({data:profiles})};
 const worker=reminders(db,debtorsFor,{},()=>new Date('2026-10-09T18:00:00Z'));
 const event={source_id:'ABCDE',user_id:'bob',event_key:'trip_overdue:ABCDE:bob:2026-10-06:1'};
 try {
  assert.equal(await worker.eligible(event),true);
  current={...trip,settled_people:{bob:50}};assert.equal(await worker.eligible(event),false);
  current={...trip,member_emails:[]};assert.equal(await worker.eligible(event),false);
  current={...trip,due_date:'2026-10-20'};assert.equal(await worker.eligible(event),false);
 } finally {worker.stop()}
 console.log('PASS: notification wording/sanitization, admin safe status, 3-day cadence/DST, exact recipients, existing settlement math and delivery-time payment/membership recheck.');
})().catch(e=>{console.error(e);process.exitCode=1});
