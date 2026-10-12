const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium}=require('playwright'),{renderTrip}=require('./test-trip-custom-page.cjs');
const names=['Alex','Blair','Casey','Drew','Oshiro'];
const trip={id:'TEST',share_token:'token',invite_token:'invite',name:'Receipt review test',people:names,settled_people:{},simple_split:true,sweep_payments:[{id:'record1',from:'Blair',to:'Alex',amount:10,created_at:'2026-10-12T03:47:00Z'},{id:'legacy',from:'Casey',to:'Alex',amount:10}],creator_email:'test@example.invalid'};
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,reducedMotion:'reduce',timezoneId:'America/New_York'}),errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const req=route.request();if(req.isNavigationRequest())return route.fulfill({contentType:'text/html',body:await renderTrip(trip,[])});
   if(req.resourceType()==='script'||req.resourceType()==='stylesheet')return route.fulfill({body:'',contentType:req.resourceType()==='script'?'application/javascript':'text/css'});
   if(new URL(req.url()).pathname.endsWith('/scan-receipt'))return route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,total:551.12,tax:73.13,discount:0,items:[{name:'Rental',price:474.99},{name:'Gatorade',price:3}]})});
   if(req.method()==='POST'&&new URL(req.url()).pathname.endsWith('/receipt')){writes.push(req.postDataJSON());return route.fulfill({contentType:'application/json',body:'{"success":false,"error":"Synthetic storage response"}'});}
   return route.fulfill({contentType:'application/json',body:'{"success":true,"comments":[],"messages":[],"profiles":[],"data":[]}'});
  });
  await page.goto('https://receipt.test/trip/TEST?t=token&app=1');
  await page.locator('.sweep-history summary').click();const recorded=page.locator('[data-sweep-recorded-at="2026-10-12T03:47:00Z"]');assert.match(await recorded.innerText(),/Oct 11, 2026/);assert.match(await recorded.innerText(),/11:47 PM/);assert.match(await recorded.innerText(),/EDT/);assert.equal(await page.locator('[data-sweep-recorded-at=""]').innerText(),'Recorded · date unavailable');
  await page.evaluate(()=>{document.getElementById('receipt-form-wrap').style.display='block';document.getElementById('r-discount').value='50';const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jI9sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));tripPhoto(new File([bytes],'synthetic.png',{type:'image/png'}));});
  await page.waitForFunction(()=>document.getElementById('r-total').value==='551.12');assert.equal(await page.evaluate(()=>splitType),'even');assert.equal(await page.locator('#r-item-sec').isVisible(),false);assert.equal(await page.locator('#r-discount').inputValue(),'');await page.locator('#r-btn-i').click();assert.equal(await page.locator('#r-items-list > div').count(),2);
  await page.evaluate(()=>{
   document.getElementById('receipt-form-wrap').style.display='block';
   tripItems=[{id:1,name:'Mav R Max XRS - 4 Seater',price:474.99,assignees:[]},{id:2,name:'Damage protection',price:49.99,assignees:[]},{id:3,name:'2 bottles Gatorade',price:3,assignees:[]}];tripScanTotal=551.12;document.getElementById('r-tax').value='73.13';setSplit('itemized');renderItems();
  });
  assert.match(await page.locator('#r-item-summary').innerText(),/Over by \$49.99/);
  await page.evaluate(()=>saveReceipt());assert.equal(writes.length,0,'mismatched scan cannot be saved');
  await page.locator('[data-item-control="financial"]').nth(1).click();
  for(const n of names)assert.equal(await page.getByLabel(n+' percentage',{exact:true}).inputValue(),'20');
  assert.match(await page.getByRole('dialog').innerText(),/differ by at most 1¢/);
  await page.getByRole('button',{name:'Dollar amounts',exact:true}).click();assert.equal(await page.getByLabel('Oshiro amount',{exact:true}).inputValue(),'9.99');
  await page.getByRole('button',{name:'Percentage',exact:true}).click();
  for(const n of names)assert.equal(await page.getByLabel(n+' percentage',{exact:true}).inputValue(),'20');
  await page.screenshot({path:'output/equal-split-penny-preview.png'});
  await page.getByRole('button',{name:'Save split',exact:true}).click();assert.equal(await page.evaluate(()=>tripItems[1].custom_split.mode),'equal');
  await page.getByRole('button',{name:'Remove Damage protection',exact:true}).click();
  assert.match(await page.locator('#r-item-summary').innerText(),/Matches receipt/);
  await page.locator('#r-iname').fill('Extra drink');await page.locator('#r-iprice').fill('3');await page.locator('#r-add-item').click();
  assert.match(await page.locator('#r-item-summary').innerText(),/Over by \$3.00/);
  await page.getByRole('button',{name:'Remove Extra drink',exact:true}).click();
  await page.getByLabel('Price for 2 bottles Gatorade',{exact:true}).fill('4');await page.getByLabel('Price for 2 bottles Gatorade',{exact:true}).press('Tab');
  assert.match(await page.locator('#r-item-summary').innerText(),/Over by \$1.00/);
  await page.getByLabel('Price for 2 bottles Gatorade',{exact:true}).fill('3');await page.getByLabel('Price for 2 bottles Gatorade',{exact:true}).press('Tab');
  await page.locator('#r-item-sec').scrollIntoViewIfNeeded();await page.screenshot({path:'output/receipt-item-review-preview.png',fullPage:true});
  for(const width of [320,390]){await page.setViewportSize({width,height:844});assert.ok(await page.locator('#r-items-list').evaluate(root=>[...root.querySelectorAll('button,input')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})));}
  await page.setViewportSize({width:390,height:844});await page.locator('#r-items-list').screenshot({path:'output/receipt-clean-chips-preview.png'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile page has no horizontal overflow');
  await page.evaluate(()=>saveReceipt());assert.equal(writes.length,1);assert.equal(writes[0].total,551.12);assert.deepEqual(Object.values(writes[0].splits),[110.23,110.23,110.22,110.22,110.22]);
  assert.deepEqual(errors,[]);console.log('PASS mobile full Trip Hub: 20% each, mode round-trip preserves equal, exact pennies, add/remove/edit prices, mismatch blocks network writes, corrected receipt posts exact total.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
