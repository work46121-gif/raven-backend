const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const S=require('../raven-sweep'),{renderTrip}=require('./test-trip-custom-page.cjs');
const E=require('../raven-sweep-explain');
let trip={id:'TEST',share_token:'token',invite_token:'invite',name:'Sweep regression test',people:['Andrew','Arsalan','Mel','Will','Nicholas'],simple_split:true,settled_people:{},sweep_payments:[],creator_email:'test@example.invalid'};
const receipts=[{id:1,name:'Airbnb',total:1500,paid_by:'Andrew',splits:{Andrew:300,Arsalan:300,Mel:300,Will:300,Nicholas:300},items:[]},{id:2,name:'Car',total:1000,paid_by:'Arsalan',splits:{Andrew:200,Arsalan:200,Mel:200,Will:200,Nicholas:200},items:[]}];
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true});let writes=[],fail=false,allow=false,botFail=false,botRequests=[];const errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>allow?d.accept():d.dismiss());
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.isNavigationRequest())return route.fulfill({contentType:'text/html; charset=utf-8',body:await renderTrip(trip,receipts)});
   if(request.resourceType()==='script')return route.fulfill({contentType:'application/javascript',body:''});
   if(request.resourceType()==='stylesheet')return route.fulfill({contentType:'text/css',body:''});
   if(url.pathname.endsWith('/ravenbot')){
    const body=request.postDataJSON();botRequests.push(body);
    return route.fulfill({status:botFail?503:200,contentType:'application/json',body:JSON.stringify(botFail?{success:false}:{success:true,reply:E.reply(E.describe(trip,receipts),body.person)})});
   }
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
  assert.equal((await page.locator('#row-person-Andrew .person-balance-display').innerText()).trim(),'$1000.00');
  assert.equal((await page.locator('#row-person-Andrew .person-status-display').innerText()).trim(),'Gets back');
  assert.equal((await page.locator('#row-person-Arsalan .person-status-display').innerText()).trim(),'Gets back');
  assert.equal(await page.locator('#row-person-Andrew .pay-slot, #row-person-Arsalan .pay-slot').count(),0,'creditors never forward payments');
  for(const name of ['Mel','Will','Nicholas'])assert.deepEqual(await page.locator('#row-person-'+name+' .pay-slot').evaluateAll(elements=>elements.map(el=>[el.dataset.payer,el.dataset.amount])),[[name==='Mel'?'Arsalan':'Andrew','500.00']]);
  assert.equal(await page.locator('#row-person-Andrew').getAttribute('data-is-settled'),'0');
  assert.equal(await page.locator('#sweep-info').isVisible(),false);
  assert.equal(await page.getByText('RAVEN Sweep nets everyone’s shares.',{exact:false}).count(),0,'no inline explanatory paragraph');
  await page.getByRole('button',{name:'What is RAVENSWEEP?',exact:true}).click();assert.equal(await page.locator('#sweep-info').isVisible(),true);
  const description=await page.locator('#sweep-info').innerText();assert.match(description,/Payments go directly/);for(const name of trip.people)assert.equal(description.includes(name),false,'generic explanation has no participant names');
  await page.screenshot({path:'output/raven-sweep-info-preview.png'});await page.getByRole('button',{name:'Got it',exact:true}).click();assert.equal(await page.locator('#sweep-info').isVisible(),false);
  await page.locator('#row-person-Andrew').evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:'output/raven-sweep-direct-mobile-preview.png'});
  const button=page.locator('#row-person-Mel .sweep-record-payment');await button.click();assert.equal(writes.length,0,'cancel has no side effects');
  allow=true;fail=true;await button.click();await page.waitForFunction(()=>document.querySelector('#row-person-Mel .sweep-record-payment').disabled===false);assert.equal(writes.length,1);assert.equal(trip.sweep_payments.length,0);
  fail=false;await button.click();await page.waitForFunction(()=>document.getElementById('row-person-Mel').dataset.isSettled==='1');
  assert.equal(trip.sweep_payments.length,1);assert.equal(trip.sweep_payments[0].amount,500);assert.equal(trip.sweep_payments[0].to,'Arsalan');
  assert.match(await page.locator('#row-person-Andrew .person-status-display').innerText(),/Gets back/);
  await page.getByText('Recorded Sweep payments',{exact:true}).click();await page.getByRole('button',{name:'Undo record',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('row-person-Mel').dataset.isSettled==='0');assert.ok(trip.sweep_payments[0].reversed_at);
  assert.match(await page.locator('#row-person-Andrew .person-balance-display').innerText(),/\$1000.00/);
  trip={...trip,sweep_payments:[]};
  Object.assign(receipts[0],{total:1300.07,splits:{Arsalan:260.01,Mel:260.01,Will:260.01,Nicholas:260.01}});
  Object.assign(receipts[1],{total:900.03,splits:{Andrew:180.01,Mel:180.01,Will:180.01,Nicholas:180.01}});
  await page.reload();
  assert.match(await page.locator('#row-person-Arsalan').innerText(),/Share \$440.00/,'include the payer share omitted by legacy receipts');
  assert.match(await page.locator('#row-person-Andrew').innerText(),/Share \$440.04/,'include exact rounding borne by the payer');
  assert.equal(await page.locator('#row-person-Nicholas .sweep-record-payment').count(),2);
  assert.match(await page.locator('#row-person-Nicholas .sweep-payment-group').innerText(),/One balance · 2 payments/);
  assert.match(await page.locator('#row-person-Nicholas .sweep-payment-total').innerText(),/\$420.01 \+ \$20.01 = \$440.02/);
  await page.locator('#row-person-Nicholas').evaluate(el=>el.scrollIntoView({block:'center'}));
  await page.screenshot({path:'output/raven-sweep-grouped-preview.png'});
  await page.locator('#row-person-Nicholas .sweep-explain-person').click();
  await page.waitForFunction(()=>document.getElementById('chat-msgs').textContent.includes('Nicholas owes $440.02 in total'));
  assert.equal(await page.locator('#chat-modal').isVisible(),true);
  assert.equal(botRequests.at(-1).intent,'sweep_explanation');assert.equal(botRequests.at(-1).person,'Nicholas');
  assert.equal(await page.locator('#ai-consent-modal').count(),0,'calculated explanation needs no external AI consent');
  await page.locator('#chat-msgs').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:'output/ravenbot-sweep-breakdown-preview.png'});
  await page.evaluate(()=>closeChat());
  botFail=true;await page.locator('#sweep-explain-all').click();
  await page.waitForFunction(()=>document.getElementById('chat-msgs').textContent.includes('I could not refresh the current payment breakdown'));
  assert.equal(trip.sweep_payments.length,0,'asking RAVENBOT never records a payment');
  botFail=false;await page.evaluate(()=>closeChat());
  await page.locator('#row-person-Nicholas .sweep-record-payment[data-sweep-to="Andrew"]').click();
  await page.waitForFunction(()=>document.querySelector('#row-person-Nicholas .person-balance-display').textContent.trim()==='$20.01');
  assert.equal(trip.sweep_payments.length,1);assert.equal(trip.sweep_payments[0].amount,420.01);assert.equal(trip.sweep_payments[0].to,'Andrew');
  assert.equal(await page.locator('#row-person-Nicholas').getAttribute('data-is-settled'),'0');
  assert.equal(await page.locator('#row-person-Nicholas .sweep-record-payment').getAttribute('data-sweep-to'),'Arsalan');
  assert.equal(await page.locator('#row-person-Nicholas .sweep-payment-group').count(),0,'group disappears after only one payment remains');
  await page.locator('#sweep-explain-all').click();await page.waitForFunction(()=>document.getElementById('chat-msgs').textContent.includes('Nicholas: $20.01 to Arsalan = $20.01 total'));
  await page.evaluate(()=>closeChat());
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  console.log('PASS full mobile Trip Hub: generic click-to-open explanation, clean page, clear balance labels, no creditor forwarding, per-recipient recording, cancel, retry, persist/reload, undo and no overflow. All network traffic mocked.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
