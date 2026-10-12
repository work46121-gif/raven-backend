const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium}=require('playwright'),{renderTrip}=require('./test-trip-custom-page.cjs');
const names=['Alex','Blair','Casey','Drew','Oshiro'];
const trip={id:'TEST',share_token:'token',invite_token:'invite',name:'Receipt review test',people:names,settled_people:{},creator_email:'test@example.invalid'};
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,reducedMotion:'reduce'}),errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const req=route.request();if(req.isNavigationRequest())return route.fulfill({contentType:'text/html',body:await renderTrip(trip,[])});
   if(req.resourceType()==='script'||req.resourceType()==='stylesheet')return route.fulfill({body:'',contentType:req.resourceType()==='script'?'application/javascript':'text/css'});
   if(req.method()==='POST'&&new URL(req.url()).pathname.endsWith('/receipt')){writes.push(req.postDataJSON());return route.fulfill({contentType:'application/json',body:'{"success":false,"error":"Synthetic storage response"}'});}
   return route.fulfill({contentType:'application/json',body:'{"success":true,"comments":[],"messages":[],"profiles":[],"data":[]}'});
  });
  await page.goto('https://receipt.test/trip/TEST?t=token&app=1');
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
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile page has no horizontal overflow');
  await page.evaluate(()=>saveReceipt());assert.equal(writes.length,1);assert.equal(writes[0].total,551.12);assert.deepEqual(Object.values(writes[0].splits),[110.23,110.23,110.22,110.22,110.22]);
  assert.deepEqual(errors,[]);console.log('PASS mobile full Trip Hub: 20% each, mode round-trip preserves equal, exact pennies, add/remove/edit prices, mismatch blocks network writes, corrected receipt posts exact total.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
