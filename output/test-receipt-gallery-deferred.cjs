'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {renderTrip}=require('./test-trip-custom-page.cjs');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jI9sAAAAASUVORK5CYII=';
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  for(const withPending of [false,true]){
   const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true});const errors=[],writes=[];let photoRequests=0,active=0,peak=0;
   const now=new Date('2026-10-20T12:00:00Z');await page.clock.install({time:now});await page.clock.pauseAt(now);
   page.on('pageerror',e=>errors.push(e.message));
   const trip={id:'TEST',name:'Trip preview',people:['Alex','Blair'],share_token:'token',invite_token:'invite',creator_email:'test@example.invalid',simple_split:true,settled_people:{}};
   const receipts=Array.from({length:5},(_,i)=>({id:42+i,trip_id:'TEST',name:i?'Receipt '+i:'Weekend rental',total:100,paid_by:'Alex',splits:{Alex:50,Blair:50},items:[],photo_url:png,created_at:'2026-10-19'}));
   const snapshot=JSON.stringify(receipts);
   await page.addInitScript(({withPending,png})=>{if(withPending)localStorage.setItem('raven_pending_receipts',JSON.stringify([{id:'local',tripId:'TEST',scanned:false,imageBase64:png.split(',')[1],mediaType:'image/png',savedAt:'2026-10-19'}]))},{withPending,png});
   await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(req.isNavigationRequest())return route.fulfill({contentType:'text/html; charset=utf-8',body:await renderTrip(trip,receipts)});
    if(req.resourceType()==='script')return route.fulfill({contentType:'application/javascript',body:''});
    if(req.resourceType()==='stylesheet')return route.fulfill({contentType:'text/css',body:''});
    if(url.pathname.includes('/receipt-photo/')){photoRequests++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,30));active--;return route.fulfill({contentType:'image/png',body:Buffer.from(png.split(',')[1],'base64')})}
    if(req.method()!=='GET')writes.push(url.pathname);
    return route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,data:[],profiles:[],comments:[],messages:[],total:0})});
   });
   await page.goto('https://gallery.test/trip/TEST?t=token&app=1');
   await page.clock.runFor(250);
   const toggle=page.getByRole('button',{name:/Saved Receipt Photos/}),body=page.locator('#saved-receipts-body');
   await toggle.waitFor();assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await body.isVisible(),false);
   assert.ok(await page.locator('#saved-receipts-section').evaluate(el => el.previousElementSibling === document.getElementById('receipts-body').closest('.sec')), 'All Receipts is immediately above Saved Receipt Photos');
   assert.ok(await page.locator('#saved-receipts-section').evaluate(el => el.nextElementSibling.contains(document.getElementById('comments-heading'))), 'saved photos remain above comments');
   assert.equal(await body.locator('img').count(),0,'no gallery image elements on trip entry');assert.equal(photoRequests,0,'no initial photo downloads');
   if(withPending)assert.match(await toggle.innerText(),/1 pending/i);
   await toggle.scrollIntoViewIfNeeded();await page.screenshot({path:'output/trip-saved-photos-collapsed.png'});
   if(!withPending){
    await page.clock.runFor(4500);
    await page.waitForFunction(()=>document.querySelectorAll('#saved-receipts-body img').length===5&&[...document.querySelectorAll('#saved-receipts-body img')].every(img=>img.naturalWidth>0),{},{polling:50});
    assert.ok(photoRequests>0,'photos warm in the background while collapsed');
    assert.ok(peak<=2,'at most two concurrent background photo requests');
    assert.equal(await body.isVisible(),false);assert.equal(await toggle.getAttribute('aria-expanded'),'false');
    assert.equal(await body.locator('img').first().getAttribute('fetchpriority'),'low');
   }
   // All Receipts remains independent: an individual receipt still opens and loads.
   await page.locator('[onclick="toggleReceipts()"]',{}).click();await page.getByText('Weekend rental',{exact:true}).first().click();
   const detail=page.locator('img[alt="Weekend rental"]');await detail.scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('img[alt="Weekend rental"]').naturalWidth>0);
   assert.equal(await body.locator('img').count(),withPending?0:5);assert.equal(await toggle.getAttribute('aria-expanded'),'false');
   await toggle.click();assert.equal(await body.isVisible(),true);assert.equal(await toggle.getAttribute('aria-expanded'),'true');
   assert.equal(await body.locator('img').count(),withPending?6:5);
   await body.locator('img').first().scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('#saved-receipts-body img').naturalWidth>0);
   if(withPending)assert.equal(await page.getByRole('button',{name:/Retry scanning 1 pending photo/}).isVisible(),true);
   await toggle.click();await toggle.focus();await page.keyboard.press('Enter');assert.equal(await body.locator('img').count(),withPending?6:5,'reopen does not duplicate gallery');
   assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.equal(JSON.stringify(receipts),snapshot,'records and amounts unchanged');await page.close();
  }
  console.log('PASS saved-photo gallery: All Receipts above Saved Receipt Photos, collapsed default, zero entry downloads, low-priority background photos after load, independent All Receipts, early open, keyboard reopen/no duplicates, pending photos preserved, zero writes.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
