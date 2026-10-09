const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const R=require('../raven-trip-receipts');
const source=fs.readFileSync('Server.js','utf8');
function section(a,b){const i=source.indexOf(a);assert.ok(i>=0,a);return source.slice(i,source.indexOf(b,i))}
const names=['Cousin','Mel','Sam'];
const r={id:'car',name:'Car booking',total:600,paid_by:'Cousin',splits:{Cousin:300,Mel:150,Sam:150},items:[],version:'v1',split_settings:{mode:'bill',people:names,split:{mode:'percent',values:{cousin:50,mel:25,sam:25}}}};
const inputs=['edit-r-name','edit-r-total','r-name','r-total','r-discount','r-tax','r-tip','r-service','r-item-discount','r-iname','r-iprice'];
const divs=['edit-r-people','edit-r-split-preview','edit-r-split-rows','edit-r-added-by','edit-r-items','r-even-prev','r-items-list','r-item-summary'];
const html='<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#06060a;color:#eee8fa;font:16px system-ui;margin:16px}input,select{box-sizing:border-box;background:#121019;color:white;padding:10px;border:1px solid #66507e;border-radius:8px;width:100%;margin-bottom:5px}button{background:#22172f;color:#e3c9ff;border:1px solid #66507e;border-radius:10px;padding:10px}.modal-bg:not(.open){display:none}#edit-r-people input{width:20px}</style></head><body><h1>Trip Hub · split test</h1><div id="edit-receipt-modal" class="modal-bg">'+inputs.map(id=>'<input id="'+id+'">').join('')+divs.map(id=>'<div id="'+id+'"></div>').join('')+['edit-r-paidby','r-paidby'].map(id=>'<select id="'+id+'">'+names.map(n=>'<option>'+n+'</option>').join('')+'</select>').join('')+'<button id="edit-r-save" onclick="saveEditReceipt()">Save Changes</button><button id="r-save">Save Receipt</button></div></body></html>';
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let requests=[],fail=false;
  await page.route('https://trip.test/**',async route=>{
   if(route.request().method()!=='POST')return route.fulfill({contentType:'text/html; charset=utf-8',body:html});
   const payload=route.request().postDataJSON();requests.push(payload);R.validate(payload,{people:names});
   return route.fulfill({contentType:'application/json',body:JSON.stringify({success:!fail,error:fail?'Storage unavailable':undefined})});
  });
  await page.goto('https://trip.test');
  for(const file of ['raven-quantities.js','raven-trip-splits.js'])await page.addScriptTag({content:fs.readFileSync(file,'utf8')});
  await page.addScriptTag({content:`const PEOPLE=${JSON.stringify(names)},receiptsDataMap={car:${JSON.stringify(r)}},BACKEND='https://trip.test',TRIP_ID='TEST',TRIP_TOKEN='token';let tripItems=[],splitType='itemized',imgBase64=null;const toasts=[];function toast(t){toasts.push(t)}function reloadPage(){}function getTripViewerProfile(){return {}};`+fs.readFileSync('raven-trip-bill-editor.js','utf8')+section('function updateEven()','function tripPhoto(')});
  await page.evaluate(()=>openEditReceipt('car'));
  assert.match(await page.locator('#edit-r-split-rows').innerText(),/\$300.00/);
  await page.locator('#edit-r-name').fill('Rental car');await page.locator('#edit-r-save').click();await page.locator('#edit-receipt-modal').waitFor({state:'hidden'});assert.deepEqual(requests.at(-1).splits,r.splits,'renaming preserves saved unequal shares');
  await page.evaluate(()=>{openEditReceipt('car');adjustExistingTripBill()});
  await page.getByRole('button',{name:'Dollar amounts',exact:true}).click();
  await page.getByLabel('Cousin amount',{exact:true}).fill('400');
  assert.equal(await page.getByRole('button',{name:'Save split',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Split remainder equally',exact:true}).click();
  assert.equal(await page.getByLabel('Mel amount',{exact:true}).inputValue(),'100');
  await page.screenshot({path:'output/trip-custom-dollar-split-preview.png'});
  const box=await page.getByRole('dialog').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390&&box.y>=0&&box.y+box.height<=844);
  await page.getByRole('button',{name:'Save split',exact:true}).click();
  fail=true;await page.locator('#edit-r-save').click();await page.waitForFunction(()=>toasts.includes('Storage unavailable'));assert.equal(await page.locator('#edit-receipt-modal').isVisible(),true);assert.equal(await page.locator('#edit-r-save').isDisabled(),false);
  fail=false;await page.locator('#edit-r-save').click();await page.locator('#edit-receipt-modal').waitFor({state:'hidden'});assert.deepEqual(requests.at(-1).splits,{Cousin:400,Mel:100,Sam:100});
  await page.evaluate(()=>{openEditReceipt('car');document.getElementById('edit-r-total').value=601;updateEditSplitPreview()});
  // Percentage mode scales to the new total, whereas dollar allocations require review.
  assert.equal(await page.locator('#edit-r-save').isDisabled(),false);
  await page.evaluate(()=>{editBillSplit={mode:'amount',values:{cousin:400,mel:100,sam:100}};updateEditSplitPreview()});
  assert.equal(await page.locator('#edit-r-save').isDisabled(),true);
  await page.evaluate(()=>{tripItems=[{id:1,name:'Car booking',price:600,assignees:[]}];renderItems()});
  await page.locator('[data-item-control="financial"]').click();
  await page.getByLabel('Cousin percentage',{exact:true}).fill('50');await page.getByRole('button',{name:'Split remainder equally',exact:true}).click();
  await page.screenshot({path:'output/trip-custom-percent-split-preview.png'});
  await page.getByRole('button',{name:'Save split',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>RavenTripSplits.receipt(tripItems,PEOPLE,{tax:60},RavenQuantities)),{total:660,splits:{Cousin:330,Mel:165,Sam:165}});
  await page.locator('[data-item-control="financial"]').click();await page.getByLabel('Cousin percentage',{exact:true}).fill('70');await page.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await page.evaluate(()=>Number(tripItems[0].custom_split.values.cousin)),50,'cancel never mutates the draft');
  assert.equal(requests.length,3,'opening and cancelling dialogs never sends writes');
  await page.evaluate(()=>{receiptsDataMap.car={...receiptsDataMap.car,items:tripItems,split_settings:{mode:'items'},total:660,tax:60,splits:{Cousin:330,Mel:165,Sam:165}};openEditReceipt('car')});
  await page.getByRole('button',{name:'Adjust item split',exact:true}).click();
  await page.getByLabel('Cousin percentage',{exact:true}).fill('60');await page.getByRole('button',{name:'Split remainder equally',exact:true}).click();await page.getByRole('button',{name:'Save split',exact:true}).click();
  await page.locator('#edit-r-save').click();await page.locator('#edit-receipt-modal').waitFor({state:'hidden'});assert.deepEqual(requests.at(-1).splits,{Cousin:396,Mel:132,Sam:132});assert.equal(requests.at(-1).items[0].custom_split.values.cousin,'60');
  assert.deepEqual(errors,[]);console.log('PASS mobile UI: percentage/dollar modes, remainder helper, validation, cent previews, name-edit preservation, cancellation, retryable save failures, itemized existing bills and no horizontal overflow.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
