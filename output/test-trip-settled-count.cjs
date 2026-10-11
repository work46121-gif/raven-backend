const assert=require('node:assert/strict'),{renderTrip}=require('./test-trip-custom-page.cjs'),S=require('../raven-sweep');
const people=['Alex','Blair','Casey','Drew','Evan'];
const trip={id:'TEST',share_token:'token',name:'Count regression',people,simple_split:true,settled_people:{},sweep_payments:[]};
const receipts=[{id:1,total:1712.77,paid_by:'Alex',splits:{Blair:342.55,Casey:342.55,Drew:342.55,Evan:342.55}},{id:2,total:1171.93,paid_by:'Blair',splits:{Alex:234.39,Casey:234.39,Drew:234.39,Evan:234.39}}];
async function check(t,expected){
 const writes=[],html=await renderTrip(t,receipts,writes);
 const summary=writes.find(w=>w.table==='trips'&&w.value.settled_count!==undefined).value;
 // Exact formula used by the already-installed dashboard.
 const count=people.length-summary.debtor_count+Math.min(summary.settled_count,summary.debtor_count);
 assert.equal(count,expected);assert.ok(html.includes(expected+'/5 people settled'));
 assert.ok(writes.every(w=>!('sweep_payments' in w.value)&&!('settled_people' in w.value)),'no payment records changed');
}
(async()=>{
 await check(trip,0);
 const one={...trip,sweep_payments:[{id:'one',from:'Casey',to:'Alex',amount:576.94}]};
 await check(one,1);
 await check({...trip,sweep_payments:[{id:'partial',from:'Casey',to:'Alex',amount:100}]},0);
 await check({...one,sweep_payments:[{...one.sweep_payments[0],reversed_at:'now'}]},0);
 let full={...trip,sweep_payments:[]},i=0;
 while(S.build(full,receipts).outstanding){const plan=S.build(full,receipts);const from=people.find(n=>plan.payableByPerson[n]>0);const [to,amount]=Object.entries(plan.payoutsByPerson[from])[0];full.sweep_payments.push({id:String(++i),from,to,amount});}
 await check(full,5);
 console.log('PASS: existing dashboard and Trip Hub settled counts match for unpaid, one paid, partial, undo and fully settled; payment records unchanged.');
})().catch(e=>{console.error(e);process.exitCode=1});
