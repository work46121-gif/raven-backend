'use strict';
// Headless Edge; every network request is fulfilled by synthetic local fixtures.
const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const U='11111111-1111-4111-8111-111111111111';
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors=[];
  let rows=[],posts=0,deleted=0,listFailure=false,delayList=false,releaseList;
  let movie,photo;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(req.isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#08080d;color:white;font:16px Arial"><button id="trip-travel-action">Trip Center</button></body>'});
   if(url.hostname==='media.test')return route.fulfill({contentType:url.pathname.endsWith('.webm')?'video/webm':'image/png',body:url.pathname.endsWith('.webm')?movie:photo});
   if(url.pathname.endsWith('/travel'))return json({members:[{id:U,first_name:'Alex'}],media:[],can_assign:false,hasMore:false,nextOffset:50});
   assert.ok(url.pathname.includes('/album'),'unexpected network request '+url.pathname);
   if(req.method()==='POST'){
    posts++;const data=req.postDataJSON();assert.ok(data.upload_id);assert.equal(data.caption,'Desert weekend');
    if(!rows.some(r=>r.id===data.upload_id)){const kind=data.data_url.startsWith('data:video')?'video':'photo';rows.unshift({id:data.upload_id,kind,caption:data.caption,created_at:'2026-10-18T16:00:00Z',can_remove:true,url:'https://media.test/'+data.upload_id+(kind==='video'?'.webm':'.png')})}
    // Simulate committed upload whose response was lost. Retry must reuse its ID.
    if(posts===2)return json({error:'Connection interrupted.'},503);
    return json({success:true},201);
   }
   if(req.method()==='DELETE'){deleted++;rows=rows.filter(r=>r.id!==url.pathname.split('/').pop());return json({success:true})}
   if(url.pathname.endsWith('/album')){
    if(delayList)await new Promise(resolve=>releaseList=resolve);
    if(listFailure)return json({error:'Album temporarily unavailable. Please retry.'},503);
    const offset=Number(url.searchParams.get('offset')||0);return json({success:true,media:rows.slice(offset,offset+24),nextOffset:offset+24,hasMore:rows.length>offset+24});
   }
   return json({success:true,media:rows.find(r=>r.id===url.pathname.split('/').pop())});
  });
  await page.goto('https://album-ui.test');
  const assets=await page.evaluate(async()=>{
   const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const ctx=canvas.getContext('2d');
   const gradient=ctx.createLinearGradient(0,0,320,240);gradient.addColorStop(0,'#c46c48');gradient.addColorStop(1,'#282b53');ctx.fillStyle=gradient;ctx.fillRect(0,0,320,240);ctx.fillStyle='#edd4a0';ctx.beginPath();ctx.arc(240,60,28,0,Math.PI*2);ctx.fill();
   const png=canvas.toDataURL('image/png');const stream=canvas.captureStream(10),recorder=new MediaRecorder(stream,{mimeType:'video/webm'}),chunks=[];
   const finished=new Promise(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=resolve});recorder.start();
   for(let i=0;i<6;i++){ctx.fillStyle='#6ba58c';ctx.fillRect(i*10,220,10,10);await new Promise(resolve=>setTimeout(resolve,100))}recorder.stop();await finished;stream.getTracks().forEach(t=>t.stop());
   const bytes=new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer());return {png,movie:Array.from(bytes)};
  });photo=Buffer.from(assets.png.split(',')[1],'base64');movie=Buffer.from(assets.movie);assert.ok(movie.length>100);
  await page.addScriptTag({content:`var TRIP_ID='T',BACKEND='https://api.test';function initChatDb(){return Promise.resolve()}var chatDb={auth:{getSession:async()=>({data:{session:{access_token:'test',user:{id:'${U}'}}}})}};`});
  for(const file of ['raven-trip-album-ui.js','raven-travel-ui.js'])await page.addScriptTag({content:fs.readFileSync(file,'utf8')});
  await page.getByRole('button',{name:'Trip Center',exact:true}).click();await page.getByText('No memories yet. Add the first photo or video.').waitFor();
  assert.deepEqual(await page.locator('.travel-section h4').allTextContents(),['Airbnb / stay','Vehicle','Alex · Flights','Itinerary / Activities','Trip Photo Album']);
  await page.getByRole('button',{name:'＋ Add photos / videos',exact:true}).click();
  await page.getByLabel('Album photos and videos').setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});assert.equal(await page.getByRole('button',{name:'Upload to album'}).isEnabled(),false);
  await page.getByLabel('Album photos and videos').setInputFiles([{name:'sunset.png',mimeType:'image/png',buffer:photo},{name:'memory.webm',mimeType:'video/webm',buffer:movie}]);
  await page.getByLabel('Album caption').fill('Desert weekend');await page.getByRole('button',{name:'Upload to album'}).click();await page.getByText(/Retry to upload the remaining 1/).waitFor();
  assert.equal(rows.length,2);await page.getByRole('button',{name:'Upload to album'}).click();await page.getByText('1 added to the trip album.').waitFor();assert.equal(rows.length,2);assert.equal(posts,3);
  await page.locator('.trip-album-tile').first().click();const preview=page.getByRole('dialog',{name:'Trip album preview'});await preview.locator('video').waitFor();
  assert.equal(await preview.locator('video').evaluate(v=>v.controls&&v.playsInline),true);
  await preview.locator('video').evaluate(async v=>{v.muted=true;await v.play()});await page.waitForFunction(()=>document.querySelector('.trip-album-viewer video')?.readyState>=2);
  await page.getByRole('button',{name:'Close album preview'}).click();await page.waitForFunction(()=>!document.querySelector('.trip-album-viewer video'));
  await page.locator('.trip-album-tile').last().click();await preview.locator('img').waitFor();page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Remove from album'}).click();assert.equal(deleted,0);
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Remove from album'}).click();await page.waitForFunction(()=>document.querySelectorAll('.trip-album-tile').length===1);assert.equal(deleted,1);
  rows=Array.from({length:27},(_,i)=>({id:'photo-'+i,kind:i%4===0?'video':'photo',caption:i%4===0?'Weekend moments':'Desert sunset',created_at:'2026-10-18T16:00:00Z',can_remove:false,url:'https://media.test/'+i+(i%4===0?'.webm':'.png')}));
  await page.getByRole('button',{name:'Refresh album'}).click();await page.waitForFunction(()=>document.querySelectorAll('.trip-album-tile').length===24);await page.getByRole('button',{name:'Load more memories'}).click();await page.waitForFunction(()=>document.querySelectorAll('.trip-album-tile').length===27);
  await page.locator('.trip-album-tile').first().click();await preview.locator('video').waitFor();assert.equal(await page.getByRole('button',{name:'Remove from album'}).count(),0);await page.getByRole('button',{name:'Close album preview'}).click();
  for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.ok(await page.locator('#raven-trip-travel-popup').evaluate(e=>e.scrollWidth<=e.clientWidth),'no horizontal overflow at '+width)}
  await page.setViewportSize({width:390,height:844});await page.getByRole('heading',{name:'Trip Photo Album',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'output/trip-album-mobile-preview.png'});
  listFailure=true;await page.getByRole('button',{name:'Refresh album'}).click();await page.getByText('Album temporarily unavailable. Please retry.').waitFor();assert.equal(await page.locator('.trip-album-tile').count(),27,'failed refresh preserves visible photos');listFailure=false;
  delayList=true;await page.getByRole('button',{name:'Refresh album'}).click();await page.getByRole('button',{name:'Close Trip Center'}).click();await page.waitForFunction(()=>!document.querySelector('.trip-album-viewer'));releaseList();delayList=false;
  await page.getByRole('button',{name:'Trip Center',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.trip-album-tile').length===24);assert.equal(await page.locator('.trip-album-viewer').count(),1,'no leaked viewer after reopening');
  assert.equal(await page.locator('a[target="_blank"]').count(),0);assert.deepEqual(errors,[]);
  await page.getByRole('button',{name:'Close Trip Center'}).click();
  console.log('PASS album UI: mobile grid, photos and playable video, upload/retry deduplication, safe deletion, paging, no external windows, async close cleanup, 320/390/768px layout.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
