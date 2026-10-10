const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),S=require('../raven-sweep');
const trip={share_token:'token',people:['Me','Him'],simple_split:true,settled_people:{},sweep_payments:[]};
const receipts=[{id:1,total:10,paid_by:'Him',splits:{Me:10}},{id:2,total:5,paid_by:'Me',splits:{Him:5}}];
const src=fs.readFileSync('Server.js','utf8'),start=src.indexOf('async function saveRavenSweepPayment('),end=src.indexOf("app.post('/trip/:tripId/partial-unsettle'",start);
let calls=[],fail=false,readFail=false;const routes={};
const db={from(table){const q={select(){return q},eq(){return q},single(){return q},then(resolve){resolve({data:table==='trips'?trip:receipts,error:readFail&&table==='trip_receipts'?Error('Unavailable'):null})}};return q},async rpc(name,args){calls.push({name,args});return fail?{error:{code:'P0001',message:'Balances changed'}}:{data:{success:true}}}};
vm.runInNewContext(src.slice(start,end),{app:{post:(path,fn)=>routes[path]=fn},supabase:db,RavenSweep:S,console});
async function request(body,undoId){let status=200,result;const res={status(n){status=n;return res},json(v){result=v}};await routes[undoId?'/trip/:tripId/sweep-payment/:paymentId/undo':'/trip/:tripId/mark-settled']({params:{tripId:'TEST',paymentId:undoId},body},res);return{status,result}}
(async()=>{
 const valid={token:'token',name:'Me',amount:5,expected_version:S.version(trip,receipts)};
 for(const body of [{...valid,token:'wrong'},{...valid,amount:10},{...valid,expected_version:'old'},{...valid,receipt_id:1}])assert.equal((await request(body)).result.success,false);
 assert.equal(calls.length,0);readFail=true;assert.equal((await request(valid)).result.success,false);readFail=false;assert.equal(calls.length,0);
 assert.equal((await request(valid)).result.success,true);assert.equal(calls.length,1);assert.equal(calls[0].args.p_outstanding,0);assert.equal(calls[0].args.p_payments[0].amount,5);
 fail=true;assert.equal((await request(valid)).result.success,false);fail=false;
 const payment=calls[0].args.p_payments[0];trip.sweep_payments=[payment];
 assert.equal((await request({...valid,expected_version:S.version(trip,receipts)},payment.id)).result.success,true);
 assert.ok(calls.at(-1).args.p_payments[0].reversed_at);assert.equal(calls.at(-1).args.p_outstanding,5);
 console.log('PASS Sweep API: authorization, stale clients, receipt bypass and inflated amounts blocked; failed storage never reports success; atomic exact-dollar save and undo.');
})().catch(error=>{console.error(error);process.exitCode=1});
