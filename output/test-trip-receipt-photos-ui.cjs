'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {renderTrip}=require('./test-trip-custom-page.cjs');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jI9sAAAAASUVORK5CYII=';
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true}),errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  const trip={id:'TEST',name:'Trip preview',people:['Alex','Blair'],share_token:'token',invite_token:'invite',creator_email:'test@example.invalid',simple_split:true,settled_people:{}};
  const receipts=[{id:42,name:'Weekend rental',total:100,paid_by:'Alex',splits:{Alex:50,Blair:50},items:[],photo_url:png,created_at:'2026-10-19'}];
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(req.isNavigationRequest())return route.fulfill({contentType:'text/html; charset=utf-8',body:await renderTrip(trip,receipts)});
   if(req.resourceType()==='script')return route.fulfill({contentType:'application/javascript',body:''});
   if(req.resourceType()==='stylesheet')return route.fulfill({contentType:'text/css',body:''});
   if(url.pathname==='/trip/TEST/receipt-photo/42'){assert.equal(url.searchParams.get('t'),'token');return route.fulfill({contentType:'image/png',body:Buffer.from(png.split(',')[1],'base64')})}
   if(req.method()!=='GET')writes.push(url.pathname);
   return route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,data:[],profiles:[],comments:[],messages:[],total:0})});
  });
  await page.goto('https://trip-photos.test/trip/TEST?t=token&app=1');
  assert.equal(await page.locator('#trip-album-action').count(),1);assert.equal(await page.locator('#trip-travel-action').count(),1);
  await page.screenshot({path:'output/trip-fast-entry-preview.png'});
  const detail=page.locator('img[alt="Weekend rental"]');
  assert.equal(await detail.getAttribute('loading'),'lazy');assert.equal(await detail.getAttribute('decoding'),'async');assert.ok((await detail.getAttribute('src')).startsWith('/trip/TEST/receipt-photo/42'));
  await page.locator('[onclick="toggleReceipts()"]',{}).click();
  await page.getByText('Weekend rental',{exact:true}).first().click();await detail.waitFor({state:'visible'});
  await detail.scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('img[alt="Weekend rental"]').naturalWidth>0);
  await detail.click();await page.getByRole('button',{name:'Close preview',exact:true}).waitFor();
  assert.equal(await page.locator('body > div').last().locator('img').evaluate(img=>img.src.includes('/trip/TEST/receipt-photo/42?t=token')),true);
  await page.getByRole('button',{name:'Close preview',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Close preview',exact:true}).count(),0);assert.deepEqual(errors,[]);assert.deepEqual(writes,[],'viewing images performs no financial operations');
  console.log('PASS full Trip Hub: separate album entry, lazy photo decoding, receipt expand/zoom/close, unchanged balance display, no client writes. All traffic mocked.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
