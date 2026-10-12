const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {normalizeParsedReceipt:N}=require('../raven-receipt'),S=require('../raven-trip-splits'),Q=require('../raven-quantities');
const raw={bill_name:'Rental',items:[{name:'Mav R Max XRS - 4 Seater',price:474.99},{name:'Damage protection',price:49.99},{name:'2 bottles Gatorade',price:3}],tax:73.13,total:551.12};
assert.equal(N(raw).calculated_total,601.11);assert.equal(N(raw).needs_review,true);
const classified={...raw,items:raw.items.map((i,n)=>({...i,included_in_parent:n===1}))};
const fixed=N(classified);assert.equal(fixed.calculated_total,551.12);assert.equal(fixed.needs_review,false);assert.equal(fixed.items.length,2);assert.equal(fixed.included_details.length,1);assert.deepEqual(N(fixed),fixed);
assert.equal(N({...raw,total:601.11}).items.length,3,'real paid add-on is retained');
const names=['A','B','C','D','E'];
assert.deepEqual(Object.values(S.receipt(fixed.items,names,{tax:73.13},Q).splits),[110.23,110.23,110.22,110.22,110.22]);
assert.equal(new Set(Object.values(S.receipt([{name:'One',price:49.99},{name:'Two',price:49.99},{name:'Three',price:0.02}],names,{},Q).splits)).size,1,'equal receipt shares round once rather than accumulating pennies');
const src=fs.readFileSync('Server.js','utf8'),start=src.indexOf("app.post('/demo/scan-receipt',"),end=src.indexOf('\napp.',start+10);
let handler,answers=[],prompts=[];
vm.runInNewContext(src.slice(start,end),{app:{post:(p,h)=>handler=h},console:{log(){},warn(){},error(){}},require:p=>require('../'+p.slice(2)),getAnthropic:()=>({messages:{create:async p=>{prompts.push(p.messages[0].content[1].text);return{content:[{type:'text',text:JSON.stringify(answers.shift())}]}}}})});
async function scan(values){answers=values;let data;await handler({body:{image:'synthetic',mediaType:'image/png'}},{json:r=>data=r});return data}
(async()=>{
 let r=await scan([raw,classified]);assert.equal(r.total,551.12);assert.equal(r.items.length,2);assert.equal(r.needs_review,false);assert.match(prompts[0],/included_in_parent/);
 r=await scan([raw,{...raw,total:601.11}]);assert.equal(r.total,551.12);assert.equal(r.needs_review,true,'retry cannot hide mismatch by inflating total');
 console.log('PASS included-component reconciliation, stable metadata, real add-ons retained, printed-total anchor, final equal receipt rounding, real scan handler with mocked OCR.');
})().catch(e=>{console.error(e);process.exitCode=1});
