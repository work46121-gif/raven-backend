'use strict';
// All browser traffic is mocked. No external accounts, media, or live mutations.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors=[];
  let scriptRequests=0,travelRequests=0,albumRequests=0,failScript=true,delayScript=false,releaseScript;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(req.isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#08080d;color:white;font:16px Arial"><h1>Trip Hub</h1><p>Balances and receipts</p><button id="trip-travel-action">Trip Center</button><button id="trip-album-action">Trip Photo Album</button></body>'});
   if(url.pathname==='/assets/trip-album-ui.js'){
    scriptRequests++;if(failScript)return route.abort();if(delayScript)await new Promise(resolve=>releaseScript=resolve);
    return route.fulfill({contentType:'application/javascript; charset=utf-8',body:fs.readFileSync('raven-trip-album-ui.js','utf8')});
   }
   if(url.pathname.endsWith('/travel')){travelRequests++;return route.fulfill({contentType:'application/json',body:JSON.stringify({members:[{id:'11111111-1111-4111-8111-111111111111',first_name:'Alex'}],media:[],hasMore:false,can_assign:false})})}
   if(url.pathname.endsWith('/album')){albumRequests++;return route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,media:[],hasMore:false})})}
   throw Error('Unexpected request '+url.pathname);
  });
  await page.goto('https://lazy-trip.test');
  await page.addScriptTag({content:"var TRIP_ID='T',BACKEND='https://api.test';function initChatDb(){return Promise.resolve()}var chatDb={auth:{getSession:async()=>({data:{session:{access_token:'test',user:{id:'11111111-1111-4111-8111-111111111111'}}}})}};"});
  await page.addScriptTag({content:fs.readFileSync(process.env.RAVEN_TRAVEL_UI_PATH||'raven-travel-ui.js','utf8')});
  assert.deepEqual([scriptRequests,travelRequests,albumRequests],[0,0,0],'opening Trip Hub does not download any album/travel data');
  await page.getByRole('button',{name:'Trip Center',exact:true}).click();await page.getByRole('button',{name:'Trip Photo Album  →',exact:true}).waitFor();
  assert.deepEqual([scriptRequests,travelRequests,albumRequests],[0,1,0],'opening travel plans never loads the gallery');
  await page.getByRole('button',{name:'Close Trip Center'}).click();
  await page.getByRole('button',{name:'Trip Photo Album',exact:true}).click();await page.getByRole('button',{name:'Retry opening album'}).waitFor();assert.equal(albumRequests,0,'failure does not request gallery data');
  failScript=false;delayScript=true;await page.getByRole('button',{name:'Retry opening album'}).click();
  await page.waitForFunction(()=>document.querySelector('script[src*="/assets/trip-album-ui.js"]'));
  await page.getByRole('button',{name:'Close Trip Center'}).click();
  while(!releaseScript)await new Promise(resolve=>setTimeout(resolve,10));releaseScript();delayScript=false;await page.waitForFunction(()=>window.RavenTripAlbum);
  assert.equal(await page.locator('.trip-album-viewer').count(),0,'late script cannot reopen a closed screen');assert.equal(albumRequests,0);
  await page.getByRole('button',{name:'Trip Photo Album',exact:true}).click();await page.getByText('No memories yet. Add the first photo or video.').waitFor();
  assert.deepEqual([scriptRequests,travelRequests,albumRequests],[2,1,1],'direct album skips flights and reuses the loaded script');
  await page.getByRole('button',{name:'＋ Add photos / videos',exact:true}).click();
  await page.screenshot({path:'output/trip-album-separate-view.png'});
  for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.ok(await page.locator('#raven-trip-travel-popup').evaluate(e=>e.scrollWidth<=e.clientWidth))}
  await page.getByRole('button',{name:'← Trip Center',exact:true}).click();await page.getByRole('button',{name:'Trip Photo Album  →',exact:true}).waitFor();assert.equal(await page.locator('.trip-album-viewer').count(),0,'back releases gallery media');
  assert.equal(travelRequests,2);assert.equal(albumRequests,1);
  await page.getByRole('button',{name:'Trip Photo Album  →',exact:true}).click();await page.getByText('No memories yet. Add the first photo or video.').waitFor();assert.equal(scriptRequests,2);assert.equal(albumRequests,2);
  await page.getByRole('button',{name:'Close Trip Center'}).click();assert.equal(await page.locator('a[target="_blank"]').count(),0);assert.deepEqual(errors,[]);
  console.log('PASS lazy album: zero initial/travel gallery requests, separate in-app entry, deferred library, direct auth path, network retry, close race, cleanup and mobile layout.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
