const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const S=require('../raven-sweep'),{renderTrip}=require('./test-trip-custom-page.cjs');
let trip={id:'TEST',share_token:'token',invite_token:'invite',name:'Sweep regression test',people:['Andrew','Arsalan','Mel','Will','Nicholas'],simple_split:true,settled_people:{},sweep_payments:[],creator_email:'test@example.invalid'};
const receipts=[{id:1,name:'Airbnb',total:1500,paid_by:'Andrew',splits:{Andrew:300,Arsalan:300,Mel:300,Will:300,Nicholas:300},items:[]},{id:2,name:'Car',total:1000,paid_by:'Arsalan',splits:{Andrew:200,Arsalan:200,Mel:200,Will:200,Nicholas:200},items:[]}];
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true});let writes=[],fail=false,allow=false;const errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>allow?d.accept():d.dismiss());
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.isNavigationRequest())return route.fulfill({contentType:'text/html; charset=utf-8',body:await renderTrip(trip,receipts)});
   if(request.resourceType()==='script')return route.fulfill({contentType:'application/javascript',body:''});
   if(request.resourceType()==='stylesheet')return route.fulfill({contentType:'text/css',body:''});
   if(request.method()==='POST'&&(/mark-settled|sweep-payment/.test(url.pathname))){
    const body=request.postDataJSON();writes.push({path:url.pathname,body});
    if(fail)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({success:false,error:'Balances changed. Refresh before recording payment.'})});
    trip={...trip,sweep_payments:url.pathname.includes('/undo')?S.reverse(trip,receipts,{id:url.pathname.split('/')[4],expected_version:body.expected_version}):S.record(trip,receipts,body)};
    return route.fulfill({contentType:'application/json',body:'{"success":true}'});
   }
   if(url.pathname.includes('comments'))return route.fulfill({contentType:'application/json',body:'{"success":true,"comments":[],"messages":[],"total":0}'});
   return route.fulfill({contentType:'application/json',body:'{"success":true,"data":[],"profiles":[]}'});
  });
  await page.goto('https://sweep.test/trip/TEST?t=token&app=1');
  await page.locator('#row-person-Andrew').waitFor();
  assert.match(await page.locator('#row-person-Andrew .person-balance-display').innerText(),/\+\$1000.00 net/);
  assert.match(await page.locator('#row-person-Andrew .person-status-display').innerText(),/collect \$1500.00 · forward \$500.00/);
  assert.match(await page.locator('#row-person-Arsalan .person-status-display').innerText(),/collect \$500.00/);
  for(const name of ['Mel','Will','Nicholas'])assert.deepEqual(await page.locator('#row-person-'+name+' .pay-slot').evaluateAll(elements=>elements.map(el=>[el.dataset.payer,el.dataset.amount])),[['Andrew','500.00']]);
  assert.equal(await page.locator('#row-person-Andrew').getAttribute('data-is-settled'),'0');
  await page.locator('#row-person-Andrew').scrollIntoViewIfNeeded();await page.screenshot({path:'output/raven-sweep-mobile-preview.png'});
  const button=page.locator('#markpaid-person-Mel');await button.click();assert.equal(writes.length,0,'cancel has no side effects');
  allow=true;fail=true;await button.click();await page.waitForFunction(()=>document.getElementById('markpaid-person-Mel').disabled===false);assert.equal(writes.length,1);assert.equal(trip.sweep_payments.length,0);
  fail=false;await button.click();await page.waitForFunction(()=>document.getElementById('row-person-Mel').dataset.isSettled==='1');
  assert.equal(trip.sweep_payments.length,1);assert.equal(trip.sweep_payments[0].amount,500);assert.equal(trip.sweep_payments[0].to,'Andrew');
  assert.match(await page.locator('#row-person-Andrew .person-status-display').innerText(),/collect \$1000.00 · forward \$500.00/);
  await page.getByText('Recorded Sweep payments',{exact:true}).click();await page.getByRole('button',{name:'Undo record',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('row-person-Mel').dataset.isSettled==='0');assert.ok(trip.sweep_payments[0].reversed_at);
  assert.match(await page.locator('#row-person-Andrew .person-balance-display').innerText(),/\+\$1000.00 net/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  console.log('PASS full mobile Trip Hub: no creditor overwrite, single-recipient net payments, cancel, retry, persist/reload, undo, valid client scripts and no overflow. All network traffic mocked; no customer records touched.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
