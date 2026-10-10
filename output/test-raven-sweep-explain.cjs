const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const S=require('../raven-sweep'),E=require('../raven-sweep-explain');
const trip={id:'TEST',share_token:'token',invite_token:'invite',people:['Alex','Blair','Casey','Drew','Evan'],simple_split:true,settled_people:{},sweep_payments:[]};
const receipts=[{id:1,name:'Stay',total:1300.07,paid_by:'Alex',splits:{Blair:260.01,Casey:260.01,Drew:260.01,Evan:260.01}},{id:2,name:'Car',total:900.03,paid_by:'Blair',splits:{Alex:180.01,Casey:180.01,Drew:180.01,Evan:180.01}}];
let info=E.describe(trip,receipts),focused=E.reply(info,'evan');
assert.equal(info.version,S.build(trip,receipts).version);
assert.equal(info.balances.find(p=>p.name==='Alex').share,440.04);
assert.equal(info.balances.find(p=>p.name==='Blair').share,440);
assert.match(focused,/Evan owes \$440\.02 in total/);
assert.match(focused,/\$420\.01 \+ \$20\.01 = \$440\.02/);
assert.match(focused,/Alex still needs \$860\.03. Other people's planned payments cover \$440\.02/);
assert.match(focused,/Blair still needs \$460\.03. Other people's planned payments cover \$440\.02/);
assert.match(focused,/ONE balance/);assert.match(focused,/forward the excess/);
assert.match(focused,/Where the cents come from/);
assert.match(focused,/Stay: 4 other people × \$260.01 = \$1040.04. \$1300.07 − \$1040.04 leaves Alex's own share at \$260.03/);
assert.match(focused,/Car: 4 other people × \$180.01 = \$720.04. \$900.03 − \$720.04 leaves Blair's own share at \$179.99/);
assert.match(focused,/Evan's receipt shares: \$260.01 \(Stay\) \+ \$180.01 \(Car\) = \$440.02/);
assert.match(E.reply(info),/Evan: \$420\.01 to Alex \+ \$20\.01 to Blair = \$440\.02 total/);
assert.throws(()=>E.reply(info,'Stranger'),/not on this trip/);
const payments=S.record(trip,receipts,{name:'Evan',to:'Alex',amount:420.01,expected_version:info.version});
const paid={...trip,sweep_payments:payments};
focused=E.reply(E.describe(paid,receipts),'Evan');
assert.match(focused,/Evan owes \$20\.01 in total/);assert.match(focused,/\$420\.01 in recorded settlement adjustments/);
assert.doesNotMatch(focused,/Why more than one recipient/);
const undone={...paid,sweep_payments:S.reverse(paid,receipts,{id:payments[0].id,expected_version:S.version(paid,receipts)})};
assert.equal(E.reply(E.describe(undone,receipts),'Evan'),E.reply(info,'Evan'));
const legacy={...trip,settled_people:{'evan::receipt::1':100}};
assert.match(E.reply(E.describe(legacy,receipts),'Evan'),/Evan owes \$340\.02 in total/);
assert.match(E.reply(E.describe(legacy,receipts)),/recorded settlement adjustments/);
const mutual={...trip,people:['One','Two']},mutualBills=[{id:1,total:10,paid_by:'Two',splits:{One:10}},{id:2,total:5,paid_by:'One',splits:{Two:5}}];
assert.match(E.reply(E.describe(mutual,mutualBills)),/One: \$5\.00 to Two = \$5\.00 total/);
assert.match(E.reply(E.describe({...mutual,sweep_payments:[{from:'One',to:'Two',amount:5}]},mutualBills)),/None — everyone is settled/);
for(const text of ['Why does Evan pay both?', 'Explain Sweep','Who owes what?','Breakdown','What did I pay?','Why are the cents different?','What is my share?'])assert.equal(E.explainsBalance(text),true);
assert.equal(E.explainsBalance('Where do I upload a photo?'),false);
const custom=E.describe(trip,[{id:3,name:'Unequal car',total:1000,paid_by:'Alex',splits:{Alex:500,Blair:200,Casey:100,Drew:100,Evan:100}}]);
assert.equal(custom.bills[0].rounding,null,'custom shares are not mislabeled as rounding');
assert.doesNotMatch(E.reply(custom),/Where the cents come from/);
// Execute the real concierge and RAVENBOT route. No external AI or DB mutations.
const source=fs.readFileSync('Server.js','utf8'),routes={};let readFail=false,aiCalls=0;
const context={RavenSweep:S,RavenSweepExplain:E,aggregateSettledCredits:()=>({}),console,app:{get(){},post:(path,fn)=>routes[path]=fn},
 supabase:{from(table){const q={select(){return q},eq(){return q},single(){return q},order(){return q},then(resolve){resolve({data:table==='trips'?trip:receipts,error:readFail&&table==='trip_receipts'?Error('Unavailable'):null})}};return q}},
 getAnthropic:()=>{aiCalls++;throw Error('External AI should not be called for a calculated breakdown')}};
vm.runInNewContext(source.slice(source.indexOf('function parseTripPeople('),source.indexOf('// ─── LIFESTYLE AI COACH')),context);
async function request(body){let status=200,result;const res={status(n){status=n;return res},json(v){result=v}};await routes['/trip/:tripId/ravenbot']({params:{tripId:'TEST'},body},res);return{status,result}}
(async()=>{
 const body={token:'token',message:'Explain',intent:'sweep_explanation',person:'Evan'};
 for(const token of ['wrong',undefined])assert.equal((await request({...body,token})).result.success,false);
 let response=await request(body);assert.equal(response.result.reply,E.reply(info,'Evan'));assert.equal(response.result.source,'sweep_calculation');
 response=await request({token:'invite',message:'Why do I pay both?'});assert.equal(response.result.reply,E.reply(info));
 readFail=true;response=await request(body);assert.equal(response.status,503);assert.equal(response.result.success,false);readFail=false;
 assert.equal(aiCalls,0);assert.deepEqual(trip.sweep_payments,[]);
 console.log('PASS RAVENBOT: exact shared-engine amounts, one total/two recipients, rounding, legacy credits, partial payments, undo, mutual offsets, settled state, authorization, read failure and zero external AI/payment writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
