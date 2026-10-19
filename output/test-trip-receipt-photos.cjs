'use strict';
// Local synthetic fixtures only. No customer records, live tokens or network.
const assert=require('node:assert/strict'),fs=require('node:fs');
const photos=require('../raven-trip-receipt-photos'),{renderTrip}=require('./test-trip-custom-page.cjs');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jI9sAAAAASUVORK5CYII=';
let handler,reads=[],broken=false,value=png;
const db={from(table){reads.push(table);let filters=[];const q={select(){return q},eq(k,v){filters.push(row=>row[k]===v);return q},maybeSingle(){return q},then(resolve){const row=table==='trips'?{id:'TEST',share_token:'token',invite_token:'invite'}:{id:'42',trip_id:'TEST',photo_url:value};resolve(broken?{error:Error('synthetic')}:{data:filters.every(f=>f(row))?row:null})}};return q}};
photos.register({get(path,fn){assert.equal(path,'/trip/:tripId/receipt-photo/:receiptId');handler=fn}},db);
async function get(token='token',tripId='TEST',receiptId='42'){
 const result={status:200,headers:{}};await handler({params:{tripId,receiptId},query:{t:token}},{setHeader(k,v){result.headers[k]=v},status(n){result.status=n;return this},type(v){result.mime=v;return this},send(v){result.body=v;return this}});return result;
}
(async()=>{
 const response=await get();assert.equal(response.status,200);assert.equal(response.mime,'image/png');assert.deepEqual(response.body,Buffer.from(png.split(',')[1],'base64'));assert.equal(response.headers['Cache-Control'],'private, no-store');assert.equal(response.headers['X-Content-Type-Options'],'nosniff');
 for(const token of ['',undefined,'invite','wrong',['token']]){reads=[];assert.equal((await get(token===undefined?null:token)).status,403);assert.ok(!reads.includes('trip_receipts'),'never reads a photo without valid view access')}
 assert.equal((await get('token','OTHER')).status,403);assert.equal((await get('token','TEST','43')).status,404);assert.equal((await get('token','../TEST')).status,403);
 for(const label of ['image/jpeg','image/webp']){
  value=png.replace('image/png',label);const legacy=await get();
  assert.equal(legacy.status,200,'legacy mislabeled PNG remains viewable');assert.equal(legacy.mime,'image/png','serve actual raster type');
  assert.deepEqual(legacy.body,Buffer.from(png.split(',')[1],'base64'),'never alter original photo bytes');
  assert.equal(legacy.headers['X-Content-Type-Options'],'nosniff');
 }
 for(const [mime,bytes] of [['image/jpeg',Buffer.from([255,216,255,224])],['image/webp',Buffer.from('RIFF0000WEBP')]]){
  value='data:image/png;base64,'+bytes.toString('base64');const detected=await get();
  assert.equal(detected.status,200);assert.equal(detected.mime,mime);assert.deepEqual(detected.body,bytes);
 }
 for(const bad of ['https://external.invalid/photo.jpg','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,%%%','data:image/jpeg;base64,'+Buffer.from('<svg onload="alert(1)"></svg>').toString('base64'),'data:image/png;base64,'+Buffer.from('<html><script>alert(1)</script></html>').toString('base64'),'data:image/jpeg;base64,AAAA']){value=bad;assert.equal((await get()).status,404)}
 value=png.replace('image/png','image/jpeg');
 for(const token of ['wrong','invite'])assert.equal((await get(token)).status,403,'legacy images still require trip view access');
 broken=true;assert.equal((await get()).status,503);broken=false;
 assert.equal(photos.url({id:'42',photo_url:png},'TEST','token'),'/trip/TEST/receipt-photo/42?t=token');assert.equal(photos.url({photo_url:'https://existing.invalid/photo'},'TEST','token'),'https://existing.invalid/photo');
 const trip={id:'TEST',share_token:'token',invite_token:'invite',name:'Synthetic performance trip',people:['Alex','Blair'],simple_split:true,settled_people:{},creator_email:'owner@test.invalid'};
 const image='data:image/jpeg;base64,'+Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(1024*1024,71)]).toString('base64');
 const receipts=Array.from({length:17},(_,i)=>({id:i+1,trip_id:'TEST',name:'Synthetic receipt '+i,total:20,paid_by:'Alex',splits:{Alex:10,Blair:10},items:[],created_at:'2026-10-19',photo_url:image}));
 const before=JSON.stringify(receipts),writes=[];const html=await renderTrip(trip,receipts,writes);
 assert.equal(JSON.stringify(receipts),before,'receipt data untouched');assert.ok(!html.includes(image),'no full receipt photos in initial HTML');assert.ok(!html.includes('window.RavenTripAlbum='),'album library absent until requested');assert.ok(html.includes('id="trip-album-action"'));
 const pageData=JSON.parse(html.match(/<script id="page-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);assert.equal(pageData.receiptsData.length,17);assert.equal(pageData.receiptsData[0].photo_url,'/trip/TEST/receipt-photo/1?t=token');
 const oldPath='output/account-release-backend/server.js';if(fs.existsSync(oldPath)&&!fs.readFileSync(oldPath,'utf8').includes('id="trip-album-action"')){
  const oldWrites=[],oldHtml=await renderTrip(trip,receipts,oldWrites,fs.readFileSync(oldPath,'utf8'));
  assert.equal(JSON.stringify(writes),JSON.stringify(oldWrites),'existing trip summary refreshes unchanged; no new financial writes');
  assert.ok(Buffer.byteLength(html)<Buffer.byteLength(oldHtml)*.1,'at least 90% smaller for inline-photo fixture');
  assert.deepEqual(pageData.receiptsData.map(({photo_url,...r})=>r),JSON.parse(oldHtml.match(/<script id="page-data" type="application\/json">([\s\S]*?)<\/script>/)[1]).receiptsData.map(({photo_url,...r})=>r),'all financial data and edit versions identical');
  console.log(JSON.stringify({synthetic_only:true,receipts:17,photo_bytes_each:1024*1024,old_html_bytes:Buffer.byteLength(oldHtml),new_html_bytes:Buffer.byteLength(html),reduction_percent:Number((100*(1-Buffer.byteLength(html)/Buffer.byteLength(oldHtml))).toFixed(2))}));
 }
 console.log('PASS private on-demand receipt photos: share-token/trip isolation, invite denied, no external proxy, raster checks, unchanged finances, slim initial HTML.');
})().catch(e=>{console.error(e);process.exitCode=1});
