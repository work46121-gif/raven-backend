'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {renderTrip}=require('./test-trip-custom-page.cjs');
const photos=require('../raven-trip-receipt-photos');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jI9sAAAAASUVORK5CYII=';
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true}),errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  const trip={id:'TEST',name:'Trip preview',people:['Alex','Blair'],share_token:'token',invite_token:'invite',creator_email:'test@example.invalid',simple_split:true,settled_people:{}};
  const legacyPhoto=png.replace('image/png','image/jpeg');
  const receipts=[{id:42,trip_id:'TEST',name:'Weekend rental',total:100,paid_by:'Alex',splits:{Alex:50,Blair:50},items:[],photo_url:legacyPhoto,created_at:'2026-10-19'}];
  let imageHandler,imageRequests=0;
  const db={from(table){const filters=[];const q={select(){return q},eq(k,v){filters.push(row=>String(row[k])===String(v));return q},maybeSingle(){return q},then(resolve){const rows=table==='trips'?[trip]:receipts;resolve({data:rows.find(row=>filters.every(f=>f(row)))||null})}};return q}};
  photos.register({get(path,handler){imageHandler=handler}},db);
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(req.isNavigationRequest())return route.fulfill({contentType:'text/html; charset=utf-8',body:await renderTrip(trip,receipts)});
   if(req.resourceType()==='script')return route.fulfill({contentType:'application/javascript',body:''});
   if(req.resourceType()==='stylesheet')return route.fulfill({contentType:'text/css',body:''});
   if(url.pathname==='/trip/TEST/receipt-photo/42'){
    imageRequests++;const result={status:200,headers:{}};
    await imageHandler({params:{tripId:'TEST',receiptId:'42'},query:{t:url.searchParams.get('t')}},{setHeader(k,v){result.headers[k]=v},status(n){result.status=n;return this},type(mime){result.headers['Content-Type']=mime;return this},send(body){result.body=body;return this}});
    assert.equal(result.status,200);assert.equal(result.headers['Content-Type'],'image/png');
    return route.fulfill(result);
   }
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
  assert.ok(imageRequests>0,'real image handler exercised');assert.equal(receipts[0].photo_url,legacyPhoto,'legacy record was not rewritten');
  console.log('PASS full Trip Hub: legacy PNG labeled JPEG loads through actual private image handler; lazy decode, expand/zoom/close, unchanged records/balances, no client writes. All traffic mocked.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
