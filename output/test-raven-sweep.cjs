const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),S=require('../raven-sweep');
const own={people:['Me','Him'],simple_split:true,settled_people:{},sweep_payments:[]};
const mutual=[{id:1,total:10,paid_by:'Him',splits:{Me:10}},{id:2,total:5,paid_by:'Me',splits:{Him:5}}];
assert.deepEqual(S.build(own,mutual).payoutsByPerson,{Me:{Him:5},Him:{}});
const shared=mutual.map((r,i)=>({...r,splits:{Me:i?2.5:5,Him:i?2.5:5}}));
assert.equal(S.build(own,shared).payoutsByPerson.Me.Him,2.5,'shared costs use assigned shares, not gross paid difference');
const trip={people:['Andrew','Arsalan','Mel','Will','Nicholas'],simple_split:true,settled_people:{},sweep_payments:[]};
const receipts=[{id:1,paid_by:'Andrew',total:1500,splits:{Andrew:300,Arsalan:300,Mel:300,Will:300,Nicholas:300}},{id:2,paid_by:'Arsalan',total:1000,splits:{Andrew:200,Arsalan:200,Mel:200,Will:200,Nicholas:200}}];
const start=S.build(trip,receipts);
assert.equal(start.hub,'Andrew');assert.deepEqual(start.netByPerson,{Andrew:1000,Arsalan:500,Mel:-500,Will:-500,Nicholas:-500});
assert.deepEqual(start.payoutsByPerson,{Andrew:{Arsalan:500},Arsalan:{},Mel:{Andrew:500},Will:{Andrew:500},Nicholas:{Andrew:500}});
assert.equal(start.receivableByPerson.Andrew,1500);assert.equal(start.payableByPerson.Andrew,500);assert.equal(start.outstanding,1500);
function addPayment(t,name){const plan=S.build(t,receipts);return{...t,sweep_payments:S.record(t,receipts,{name,amount:plan.payableByPerson[name],expected_version:plan.version})}}
for(const order of [['Andrew','Mel','Will','Nicholas'],['Mel','Will','Nicholas','Andrew'],['Will','Andrew','Mel','Nicholas']]){
 let t=trip;
 for(const name of order){const before=S.build(t,receipts);t=addPayment(t,name);const after=S.build(t,receipts);assert.equal(Object.values(after.netByPerson).reduce((s,n)=>s+Math.round(n*100),0),0);assert.equal(after.hub,'Andrew');assert.equal(after.payableByPerson[name],0);assert.ok(after.outstanding<=before.outstanding);}
 assert.equal(S.build(t,receipts).outstanding,0);assert.ok(Object.values(S.build(t,receipts).netByPerson).every(v=>v===0));
 const one=t.sweep_payments.find(p=>p.from==='Mel');const undone={...t,sweep_payments:S.reverse(t,receipts,{id:one.id,expected_version:S.version(t,receipts)})};
 assert.deepEqual(S.build(undone,receipts).payoutsByPerson.Mel,{Andrew:500});assert.equal(S.build(undone,receipts).netByPerson.Andrew,500);
 assert.throws(()=>S.reverse(undone,receipts,{id:one.id,expected_version:S.version(undone,receipts)}),/already undone/);
}
assert.throws(()=>S.record(trip,receipts,{name:'Mel',amount:499,expected_version:start.version}),/current displayed/);
const once=addPayment(trip,'Mel');assert.throws(()=>S.record(once,receipts,{name:'Mel',amount:500,expected_version:start.version}),/changed/);
const old={...trip,settled_people:{'mel::receipt::1':300}};assert.equal(S.build(old,receipts).netByPerson.Mel,-200);assert.equal(S.build(old,receipts).netByPerson.Andrew,700);
assert.equal(S.build({...trip,settled_people:['Mel']},receipts).netByPerson.Mel,0);
assert.deepEqual(S.plan(['a','b'],{a:{b:.01},b:{}},{b:1}).payoutsByPerson,{a:{b:.01},b:{}},'one cent is not dropped');
console.log('PASS Sweep: mutual offset, assigned versus gross costs, one recipient for debtors, net reimbursements, exact cents, no cycles, all payment orders, legacy credits, undo and stale/double-submit rejection.');
(async()=>{
 const {PGlite}=require('./push-test-runtime/node_modules/@electric-sql/pglite');const pg=new PGlite();
 try{
  await pg.exec(`create role anon;create role authenticated;create role service_role;create table trips(id text primary key,share_token text,people jsonb,simple_split boolean,settled_people jsonb,total numeric);create table trip_receipts(id bigint primary key,trip_id text,total numeric,paid_by text,splits jsonb);`);
  const migration=fs.readFileSync('output/raven-sweep-ledger.sql','utf8');await pg.exec(migration);await pg.exec(migration);
  await pg.query('insert into trips(id,share_token,people,simple_split,settled_people) values($1,$2,$3,true,$4)',['TEST','token',trip.people,{}]);
  for(const r of receipts)await pg.query('insert into trip_receipts values($1,$2,$3,$4,$5)',[r.id,'TEST',r.total,r.paid_by,r.splits]);
  const payments=once.sweep_payments,expected=S.snapshot(trip,receipts);
  const save=(token='token',snapshot=expected)=>pg.query('select raven_save_sweep_payments($1,$2,$3,$4,$5)', ['TEST',token,snapshot,payments,S.build(once,receipts).outstanding]);
  await assert.rejects(save('wrong'),/Invalid trip token/);await save();await assert.rejects(save(),/Balances changed/);
  assert.deepEqual((await pg.query('select sweep_payments from trips')).rows[0].sweep_payments,payments);
  const newExpected=S.snapshot({...trip,sweep_payments:payments},receipts);
  await pg.exec('update trip_receipts set total=1600 where id=1');await assert.rejects(save('token',newExpected),/Balances changed/);
  assert.equal((await pg.query("select has_function_privilege('anon','raven_save_sweep_payments(text,text,jsonb,jsonb,numeric)','execute') as allowed")).rows[0].allowed,false);
  assert.equal(Number((await pg.query('select total from trips')).rows[0].total),1000);
  await assert.rejects(pg.exec("update trip_receipts set paid_by='Arsalan' where id=1"),/reconcile/i);
  await assert.rejects(pg.query('update trips set people=$1',[['Andrew','Arsalan','Will','Nicholas']]),/reconcile/i);
  await pg.query('update trips set people=$1',[JSON.stringify(trip.people)]);
  console.log('PASS PostgreSQL: additive rerunnable ledger, exact snapshot compare, atomic payment saves, concurrent/stale rejection, receipt-edit detection and no public access.');
 }finally{await pg.close()}
 const src=fs.readFileSync('Server.js','utf8');const from=src.indexOf('function updatePersonBalanceDisplay('),to=src.indexOf('// State is fully server-rendered',from);let accesses=0;
 const ctx={D:{simpleSplit:true},document:{getElementById(){accesses++;throw Error('Should not overwrite server Sweep balances')}}};vm.createContext(ctx);vm.runInContext(src.slice(from,to),ctx);ctx.updatePersonBalanceDisplay('Andrew');assert.equal(accesses,0);
 console.log('PASS: legacy client balance updater cannot erase Sweep receivables or double-count forwarded payouts.');
})().catch(e=>{console.error(e);process.exitCode=1});
