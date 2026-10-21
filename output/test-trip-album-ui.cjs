'use strict';
// Headless Edge; every network request is fulfilled by synthetic local fixtures.
const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const U='11111111-1111-4111-8111-111111111111';
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors=[];
  let rows=[],posts=0,deleted=0,listFailure=false,delayList=false,releaseList,delayUpload=false,releaseUpload;
  let movie,photo;const batches=[],uploader={name:'Alex Member',avatar_url:'https://media.test/avatar.png'};
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(req.isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#08080d;color:white;font:16px Arial"><button id="trip-travel-action">Trip Center</button></body>'});
   if(url.hostname==='media.test')return route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},contentType:url.pathname.endsWith('.webm')?'video/webm':'image/png',body:url.pathname.endsWith('.webm')?movie:photo});
   if(url.pathname.endsWith('/travel'))return json({members:[{id:U,first_name:'Alex'}],media:[],can_assign:false,hasMore:false,nextOffset:50});
   assert.ok(url.pathname.includes('/album'),'unexpected network request '+url.pathname);
   if(req.method()==='POST'){
    posts++;assert.ok(url.pathname.endsWith('/album/file'));const headers=req.headers(),data={upload_id:headers['x-raven-upload-id'],caption:decodeURIComponent(headers['x-raven-upload-caption']||'')};assert.ok(data.upload_id);if(posts<=3)assert.equal(data.caption,'Desert weekend');
    batches.push(headers['x-raven-upload-batch']);assert.match(batches.at(-1),/^[a-f0-9-]{36}$/);const raw=req.postDataBuffer();assert.ok(raw?.length);assert.ok(!headers['content-type'].includes('json'),'binary transport avoids base64');
    if(delayUpload)await new Promise(resolve=>{releaseUpload=resolve;setTimeout(resolve,15000)});
    if(!rows.some(r=>r.id===data.upload_id)){const kind=headers['content-type'].startsWith('video')?'video':'photo';rows.unshift({id:data.upload_id,kind,caption:data.caption,uploader,created_at:'2026-10-18T16:00:00Z',can_remove:true,url:'https://media.test/'+data.upload_id+(kind==='video'?'.webm':'.png')})}
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
  await page.evaluate(()=>{window.__albumXhrs=[];const Native=XMLHttpRequest;window.XMLHttpRequest=class extends Native{constructor(){super();window.__albumXhrs.push(this)}}});
  const assets=await page.evaluate(async()=>{
   const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const ctx=canvas.getContext('2d');
   const gradient=ctx.createLinearGradient(0,0,320,240);gradient.addColorStop(0,'#c46c48');gradient.addColorStop(1,'#282b53');ctx.fillStyle=gradient;ctx.fillRect(0,0,320,240);ctx.fillStyle='#edd4a0';ctx.beginPath();ctx.arc(240,60,28,0,Math.PI*2);ctx.fill();
   const png=canvas.toDataURL('image/png');const stream=canvas.captureStream(10),recorder=new MediaRecorder(stream,{mimeType:'video/webm'}),chunks=[];
   const finished=new Promise(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=resolve});recorder.start();
   for(let i=0;i<6;i++){ctx.fillStyle='#6ba58c';ctx.fillRect(i*10,220,10,10);await new Promise(resolve=>setTimeout(resolve,100))}recorder.stop();await finished;stream.getTracks().forEach(t=>t.stop());
   const bytes=new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer());return {png,movie:Array.from(bytes)};
  });photo=Buffer.from(assets.png.split(',')[1],'base64');movie=Buffer.from(assets.movie);assert.ok(movie.length>100);
  await page.addScriptTag({content:`var TRIP_ID='T',BACKEND='https://api.test';function initChatDb(){return Promise.resolve()}var chatDb={auth:{getSession:async()=>({data:{session:{access_token:'test',user:{id:'${U}'}}}})}};`});
  for(const file of ['raven-trip-album-ui.js',process.env.RAVEN_TRAVEL_UI_PATH||'raven-travel-ui.js'])await page.addScriptTag({content:fs.readFileSync(file,'utf8')});
  await page.getByRole('button',{name:'Trip Center',exact:true}).click();await page.getByRole('button',{name:'Trip Photo Album  →',exact:true}).click();await page.getByText('No memories yet. Add the first photo or video.').waitFor();
  assert.deepEqual(await page.locator('.travel-section h4').allTextContents(),['Photos / videos']);
  await page.getByRole('button',{name:'＋ Add photos / videos',exact:true}).click();
  assert.equal(await page.getByLabel('Album photos and videos').isVisible(),false,'native boring file control is hidden');
  assert.equal(await page.getByRole('button',{name:'Choose photos or videos'}).isVisible(),true);
  await page.getByLabel('Album photos and videos').setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});assert.equal(await page.getByRole('button',{name:'Upload to album'}).isEnabled(),false);
  await page.getByRole('button',{name:'Remove bad.svg from selection'}).click();
  await page.getByText('Photos & videos up to 50 MB each · 10 at a time',{exact:true}).waitFor();
  await page.getByLabel('Album photos and videos').evaluate((input,header)=>{const files=new DataTransfer(),bytes=new Uint8Array(52428800);bytes.set(header);files.items.add(new File([bytes],'maximum.png',{type:'image/png'}));files.items.add(new File([bytes,new Uint8Array(1)],'oversized.png',{type:'image/png'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}))},Array.from(photo));
  assert.equal(await page.locator('.trip-album-pending[data-phase=ready]').count(),1,'50 MiB photo accepted by picker');
  assert.equal(await page.locator('.trip-album-pending[data-phase=invalid]').count(),1,'50 MiB plus one byte rejected by picker');
  assert.match(await page.locator('.trip-album-pending[data-phase=invalid]').innerText(),/over the 50 MB limit/);
  assert.equal(await page.getByRole('button',{name:'Upload to album'}).isEnabled(),true);
  await page.getByRole('button',{name:'Remove maximum.png from selection'}).click();await page.getByRole('button',{name:'Remove oversized.png from selection'}).click();
  await page.getByLabel('Album photos and videos').setInputFiles([{name:'sunset.png',mimeType:'image/png',buffer:photo},{name:'memory.webm',mimeType:'video/webm',buffer:movie}]);
  assert.equal(await page.locator('.trip-album-queue img').count(),1);assert.equal(await page.locator('.trip-album-queue video').count(),1,'selected videos appear in Trip Center before upload');
  await page.getByRole('heading',{name:'Trip Photo Album',exact:true}).evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:'output/trip-album-picker-preview.png'});
  await page.getByLabel('Album caption').fill('Desert weekend');await page.getByRole('button',{name:'Upload to album'}).click();await page.getByText(/Your remaining selections are here to retry/).waitFor();
  assert.equal(rows.length,2);await page.getByRole('button',{name:'Retry upload'}).click();await page.getByText('1 added to the trip album.').waitFor();assert.equal(rows.length,2);assert.equal(posts,3);
  assert.equal(new Set(batches).size,1,'files and lost-response retries keep one notification batch');
  await page.waitForFunction(()=>document.querySelector('.trip-album-tile.has-preview > img')?.naturalWidth>0);
  assert.equal(await page.locator('.trip-album-tile .trip-album-avatar img').count(),2);
  assert.ok(await page.locator('.trip-album-tile').first().evaluate(tile=>{const a=tile.querySelector('.trip-album-avatar').getBoundingClientRect(),t=tile.getBoundingClientRect();return a.width===28&&Math.abs(t.right-a.right-6)<1&&Math.abs(t.bottom-a.bottom-6)<1}),'uploader avatar is bottom-right');
  await page.locator('.trip-album-tile').first().click();const preview=page.getByRole('dialog',{name:'Trip album preview'});await preview.locator('video').waitFor();
  assert.equal(await preview.locator('video').evaluate(v=>v.controls&&v.playsInline),true);
  await page.evaluate(()=>{window.__shares=[];Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.__shares.push({name:data.files[0].name,size:data.files[0].size})}})});
  await page.getByRole('button',{name:'Save video',exact:true}).click();await page.getByText('Ready. Tap Save video to choose where to save it.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__shares.length),0,'file preparation does not open a share sheet without a fresh tap');
  await page.getByRole('button',{name:'Save video',exact:true}).click();assert.equal(await page.evaluate(()=>window.__shares.length),1);assert.equal(await page.evaluate(()=>window.__shares[0].size),movie.length);
  await preview.locator('video').evaluate(async v=>{v.muted=true;await v.play()});await page.waitForFunction(()=>document.querySelector('.trip-album-viewer video')?.readyState>=2);
  await page.getByRole('button',{name:'Close album preview'}).click();await page.waitForFunction(()=>!document.querySelector('.trip-album-viewer video'));
  await page.locator('.trip-album-tile').last().click();await preview.locator('img.trip-album-full-media').waitFor();
  assert.equal(await preview.locator('.trip-album-byline strong').innerText(),'Alex Member');
  assert.equal(await preview.locator('time').getAttribute('datetime'),'2026-10-18T16:00:00.000Z');assert.match(await preview.locator('time').innerText(),/Uploaded .*2026.*[0-9]:[0-9]/);
  assert.ok(await preview.evaluate(v=>v.querySelector('.trip-album-byline').getBoundingClientRect().top>v.querySelector('.trip-album-full-media').getBoundingClientRect().bottom),'uploader details are below media');
  for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.ok(await preview.evaluate(v=>{const s=v.querySelector('.trip-album-save').getBoundingClientRect(),d=v.querySelector('.trip-album-delete').getBoundingClientRect();return v.scrollWidth<=v.clientWidth&&(d.left-s.right>=19||d.top-s.bottom>=19)}),'save and remove are separated at '+width)}
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/trip-album-uploader-viewer.png'});
  await page.getByRole('button',{name:'Save photo',exact:true}).click();await page.getByText('Ready. Tap Save photo to choose where to save it.',{exact:true}).waitFor();
  await page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new DOMException('Canceled','AbortError')}}));
  await page.getByRole('button',{name:'Save photo',exact:true}).click();await page.getByText('Save canceled. Tap Save photo to try again.',{exact:true}).waitFor();
  await page.evaluate(()=>Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false}));
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Save photo',exact:true}).click();assert.match((await downloaded).suggestedFilename(),/^RAVEN-trip-.*\.png$/);
  page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Remove from album'}).click();assert.equal(deleted,0);
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Remove from album'}).click();await page.waitForFunction(()=>document.querySelectorAll('.trip-album-tile').length===1);assert.equal(deleted,1);
  // The original phone failure: a supported MOV bigger than the old 12 MiB cap.
  await page.getByLabel('Album photos and videos').evaluate(input=>{const files=new DataTransfer();files.items.add(new File([new Uint8Array(52428801)],'too-large.mov',{type:'video/quicktime'}));files.items.add(new File([new Uint8Array(13*1024*1024)],'iphone.MOV',{type:'application/octet-stream'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}))});
  assert.equal(await page.locator('.trip-album-pending[data-phase=invalid]').count(),1);
  assert.match(await page.locator('.trip-album-pending[data-phase=invalid]').innerText(),/over the 50 MB limit/);
  assert.equal(await page.getByRole('button',{name:'Upload to album'}).isEnabled(),true,'invalid file does not block a supported file');
  await page.getByRole('button',{name:'Remove too-large.mov from selection'}).click();
  delayUpload=true;await page.getByRole('button',{name:'Upload to album'}).click();await page.waitForFunction(()=>window.__albumXhrs.length===4);
  await page.evaluate(()=>window.__albumXhrs.at(-1).upload.dispatchEvent(new ProgressEvent('progress',{lengthComputable:true,loaded:65,total:100})));
  await page.getByText('Uploading · 65%',{exact:true}).waitFor();
  await page.evaluate(()=>window.__albumXhrs.at(-1).upload.dispatchEvent(new ProgressEvent('progress',{lengthComputable:true,loaded:100,total:100})));
  await page.getByText('Saving to album…',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Stop upload'}).isVisible(),true);
  assert.equal(await page.getByRole('button',{name:'Choose photos or videos'}).isEnabled(),false);
  page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Close Trip Center'}).click();assert.equal(await page.getByRole('dialog',{name:'Trip Center',exact:true}).isVisible(),true,'accidental close preserves upload');
  for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.ok(await page.locator('.trip-album-upload').evaluate(e=>e.scrollWidth<=e.clientWidth),'upload queue fits '+width)}
  await page.setViewportSize({width:390,height:844});await page.getByRole('heading',{name:'Trip Photo Album',exact:true}).evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:'output/trip-album-upload-progress.png'});
  releaseUpload();delayUpload=false;await page.getByText('1 added to the trip album.',{exact:true}).waitFor();assert.equal(rows.length,2);
  await page.getByLabel('Album photos and videos').setInputFiles({name:'cancel.webm',mimeType:'video/webm',buffer:movie});
  delayUpload=true;releaseUpload=null;await page.getByRole('button',{name:'Upload to album'}).click();
  while(!releaseUpload)await new Promise(resolve=>setTimeout(resolve,10));
  await page.getByRole('button',{name:'Stop upload'}).click();await page.getByRole('button',{name:'Retry upload'}).waitFor();
  assert.match(await page.locator('.trip-album-pending[data-phase=error]').innerText(),/Upload stopped/);
  releaseUpload();delayUpload=false;
  await page.getByRole('button',{name:'Retry upload'}).click();await page.getByText('1 added to the trip album.',{exact:true}).waitFor();
  assert.equal(rows.length,3,'retry after abort does not duplicate a file already accepted by the server');
  const largePhoto=Buffer.alloc(13*1024*1024);photo.copy(largePhoto);
  await page.getByLabel('Album photos and videos').setInputFiles({name:'large-photo.png',mimeType:'image/png',buffer:largePhoto});
  await page.getByRole('button',{name:'Upload to album'}).click();await page.getByText('1 added to the trip album.',{exact:true}).waitFor();
  assert.equal(rows.length,4,'photo above former 6 MiB limit uploads through normal browser flow');
  rows=Array.from({length:27},(_,i)=>({id:'photo-'+i,kind:i%4===0?'video':'photo',caption:i%4===0?'Weekend moments':'Desert sunset',uploader:i===26?null:uploader,created_at:'2026-10-18T16:00:00Z',can_remove:false,url:'https://media.test/'+i+(i%4===0?'.webm':'.png')}));
  await page.getByRole('button',{name:'Refresh album'}).click();await page.waitForFunction(()=>document.querySelectorAll('.trip-album-tile').length===24);await page.getByRole('button',{name:'Load more memories'}).click();await page.waitForFunction(()=>document.querySelectorAll('.trip-album-tile').length===27);
  await page.locator('.trip-album-tile').first().click();await preview.locator('video').waitFor();assert.equal(await page.getByRole('button',{name:'Remove from album'}).count(),0);await page.getByRole('button',{name:'Close album preview'}).click();
  await page.locator('.trip-album-tile').last().click();await preview.locator('img.trip-album-full-media').waitFor();assert.equal(await preview.locator('.trip-album-byline strong').innerText(),'RAVEN member');assert.equal(await preview.locator('.trip-album-avatar img').count(),0);assert.equal(await page.getByRole('button',{name:'Remove from album'}).count(),0);assert.equal(await page.getByRole('button',{name:'Save photo',exact:true}).isVisible(),true);await page.getByRole('button',{name:'Close album preview'}).click();
  for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.ok(await page.locator('#raven-trip-travel-popup').evaluate(e=>e.scrollWidth<=e.clientWidth),'no horizontal overflow at '+width)}
  await page.setViewportSize({width:390,height:844});await page.getByRole('heading',{name:'Trip Photo Album',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'output/trip-album-mobile-preview.png'});
  listFailure=true;await page.getByRole('button',{name:'Refresh album'}).click();await page.getByText('Album temporarily unavailable. Please retry.').waitFor();assert.equal(await page.locator('.trip-album-tile').count(),27,'failed refresh preserves visible photos');listFailure=false;
  delayList=true;await page.getByRole('button',{name:'Refresh album'}).click();await page.getByRole('button',{name:'Close Trip Center'}).click();await page.waitForFunction(()=>!document.querySelector('.trip-album-viewer'));releaseList();delayList=false;
  await page.getByRole('button',{name:'Trip Center',exact:true}).click();await page.getByRole('button',{name:'Trip Photo Album  →',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.trip-album-tile').length===24);assert.equal(await page.locator('.trip-album-viewer').count(),1,'no leaked viewer after reopening');
  assert.equal(await page.locator('a[target="_blank"]').count(),0);assert.deepEqual(errors,[]);
  await page.getByRole('button',{name:'Close Trip Center'}).click();
  await page.evaluate(()=>{const mount=window.RavenTripAlbum.mount;window.RavenTripAlbum.mount=(...args)=>{const handle=mount(...args);return {destroy:()=>handle.destroy()}}});
  await page.getByRole('button',{name:'Trip Center',exact:true}).click();await page.getByRole('button',{name:'Trip Photo Album  →',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.trip-album-tile').length===24);
  await page.getByRole('button',{name:'Close Trip Center'}).click();assert.equal(await page.getByRole('dialog',{name:'Trip Center',exact:true}).isVisible(),false,'new site handles older album helper during rolling deployment');assert.deepEqual(errors,[]);
  console.log('PASS album UI: mobile grid, photos and playable video, upload/retry deduplication, safe deletion, paging, no external windows, async close cleanup, 320/390/768px layout.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
