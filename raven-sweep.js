'use strict';
const crypto=require('node:crypto');
const key=v=>String(v||'').trim().toLowerCase();
const cents=v=>Math.round((Number(v)||0)*100);
function parse(v,fallback){try{for(let i=0;i<3&&typeof v==='string';i++)v=JSON.parse(v);return v??fallback}catch(_){return fallback}}
function ledger(trip){const v=parse(trip.sweep_payments,[]);return Array.isArray(v)?v:[]}
function active(trip){return !!trip.simple_split||ledger(trip).some(p=>!p.reversed_at)}
function snapshot(trip,receipts){return{people:trip.people??null,simple_split:trip.simple_split??null,settled_people:trip.settled_people??null,sweep_payments:trip.sweep_payments??[],receipts:receipts.map(r=>({id:String(r.id),paid_by:r.paid_by??null,total:r.total==null?null:Number(r.total),splits:r.splits??null})).sort((a,b)=>a.id.localeCompare(b.id))}}
function stable(v){if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));return v}
function version(trip,receipts){return crypto.createHash('sha256').update(JSON.stringify(stable(snapshot(trip,receipts)))).digest('hex')}
function plan(people,detailed,fronted={},payments=[]){
 const canon=new Map(people.map(n=>[key(n),n]));
 const net=Object.fromEntries(people.map(n=>[n,0]));
 const payoutsByPerson=Object.fromEntries(people.map(n=>[n,{}]));
 for(const [debtor,payers]of Object.entries(detailed))for(const [payer,amount]of Object.entries(payers)){
   const from=canon.get(key(debtor)),to=canon.get(key(payer)),value=cents(amount);
   if(!from||!to||from===to||value<=0)continue;
   net[from]-=value;net[to]+=value;
 }
 const originalNet={...net};
 for(const payment of payments){
   if(payment.reversed_at)continue;
   const from=canon.get(key(payment.from)),to=canon.get(key(payment.to)),value=cents(payment.amount);
   if(!from||!to||from===to||value<=0)throw Error('A recorded Sweep payment no longer matches the trip members. Review payment history.');
   net[from]+=value;net[to]-=value;
 }
 // A single clearing person: debtors pay the largest original payer, who
 // forwards only the other creditors' net reimbursements. Never route cycles.
 const hub=[...people].sort((a,b)=>cents(fronted[b])-cents(fronted[a])||originalNet[b]-originalNet[a]||a.localeCompare(b))[0]||null;
 for(const name of people){
   if(name===hub)continue;
   if(net[name]<0)payoutsByPerson[name][hub]=-net[name]/100;
   if(net[name]>0)payoutsByPerson[hub][name]=net[name]/100;
 }
 const receivableByPerson=Object.fromEntries(people.map(n=>[n,0])),payableByPerson={};
 for(const [from,targets]of Object.entries(payoutsByPerson)){
   payableByPerson[from]=Object.values(targets).reduce((s,v)=>s+cents(v),0)/100;
   for(const [to,value]of Object.entries(targets))receivableByPerson[to]=(cents(receivableByPerson[to])+cents(value))/100;
 }
 const netByPerson=Object.fromEntries(people.map(n=>[n,net[n]/100]));
 return{hub,payoutsByPerson,receivableByPerson,payableByPerson,netByPerson,originalNetByPerson:Object.fromEntries(people.map(n=>[n,originalNet[n]/100])),outstanding:people.reduce((s,n)=>s+Math.max(0,-net[n]),0)/100};
}
function build(trip,receipts){
 const people=parse(trip.people,[]),canon=new Map(people.map(n=>[key(n),n]));
 let credits=parse(trip.settled_people,{});
 if(Array.isArray(credits))credits=Object.fromEntries(credits.map(n=>[key(n),999999]));
 credits=Object.fromEntries(Object.entries(credits||{}).map(([n,v])=>[key(n),Math.max(0,cents(v))]));
 const fronted=Object.fromEntries(people.map(n=>[n,0])),detailed=Object.fromEntries(people.map(n=>[n,{}]));
 const validIds=new Set(receipts.map(r=>String(r.id)));
 for(const receipt of receipts){
   const payer=canon.get(key(receipt.paid_by));if(!payer)continue;
   fronted[payer]+=Number(receipt.total)||0;
   const splits=parse(receipt.splits,{});
   for(const [alias,share]of Object.entries(splits)){
     const name=canon.get(key(alias));if(!name||name===payer)continue;
     const debt=Math.max(0,cents(share)),credit=credits[key(name)+'::receipt::'+receipt.id]||0;
     detailed[name][payer]=(cents(detailed[name][payer])+Math.max(0,debt-credit))/100;
   }
 }
 for(const name of people){
   const hasReceiptCredit=Object.keys(credits).some(k=>k.startsWith(key(name)+'::receipt::')&&validIds.has(k.split('::receipt::')[1]));
   if(hasReceiptCredit)continue;
   let credit=credits[key(name)]||0;
   for(const payer of Object.keys(detailed[name]).sort((a,b)=>detailed[name][b]-detailed[name][a]||a.localeCompare(b))){
     const value=cents(detailed[name][payer]),take=Math.min(value,credit);detailed[name][payer]=(value-take)/100;credit-=take;
   }
 }
 return{...plan(people,detailed,fronted,ledger(trip)),version:version(trip,receipts)};
}
function record(trip,receipts,{name,amount,expected_version}){
 const current=build(trip,receipts),person=parse(trip.people,[]).find(n=>key(n)===key(name));
 if(expected_version!==current.version)throw Error('Balances changed. Refresh the trip before recording payment.');
 if(!person||cents(amount)<=0||cents(amount)!==cents(current.payableByPerson[person]))throw Error('Record only the current displayed payout amount.');
 const now=new Date().toISOString();
 return [...ledger(trip),...Object.entries(current.payoutsByPerson[person]).map(([to,amount])=>({id:crypto.randomUUID(),from:person,to,amount,created_at:now}))];
}
function reverse(trip,receipts,{id,expected_version}){
 if(expected_version!==version(trip,receipts))throw Error('Balances changed. Refresh before undoing payment.');
 const all=ledger(trip);if(!all.some(p=>p.id===id&&!p.reversed_at))throw Error('That payment was already undone or was not found.');
 return all.map(p=>p.id===id?{...p,reversed_at:new Date().toISOString()}:p);
}
module.exports={key,cents,parse,ledger,active,snapshot,version,plan,build,record,reverse};
