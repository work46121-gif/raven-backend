'use strict';
// Local HTTP + in-memory DB/storage and PGlite only. Never contacts production.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
process.env.NODE_PATH=[path.join(__dirname,'album-upload-test-runtime/node_modules'),process.env.NODE_PATH].filter(Boolean).join(path.delimiter);require('node:module').Module._initPaths();
const express=require('express'),register=require('../raven-trip-travel'),album=require('../raven-trip-album');
const {PGlite}=require('./push-test-runtime/node_modules/@electric-sql/pglite');
const U='11111111-1111-4111-8111-111111111111',ID='33333333-3333-4333-8333-333333333333';
function movie(size=24){const bytes=Buffer.alloc(size);bytes.writeUInt32BE(24);bytes.write('ftyp',4);bytes.write('qt  ',8);bytes.write('qt  ',16);return bytes}
const large=movie(13*1024*1024),limit=50*1024*1024;
assert.equal(album.binaryMedia(large,'video/quicktime').bytes.length,large.length);
assert.equal(album.binaryMedia(movie(limit),'video/quicktime').bytes.length,limit);
assert.throws(()=>album.binaryMedia(movie(limit+1),'video/quicktime'),/50 MB/);
assert.throws(()=>album.binaryMedia(Buffer.alloc(6291457),'image/png'),/6 MB/);
assert.throws(()=>album.binaryMedia(Buffer.from('<html>not a movie</html>'),'video/quicktime'),/format/);
const heic=movie();heic.write('heic',16);assert.throws(()=>album.binaryMedia(heic,'video/quicktime'),/format/);
const wide=Buffer.alloc(8);wide.writeUInt32BE(8);wide.write('wide',4);assert.equal(album.binaryMedia(Buffer.concat([wide,movie()]),'video/quicktime').kind,'video');
let rows=[],uploads=0,storageFailure=false,hold=false,releases=[];
const trip={id:'T',creator_email:'owner@example.invalid',member_emails:['member@example.invalid']};
const db={from(table){let filters=[],operation='read',value;const q={select(){return q},eq(k,v){filters.push(row=>row[k]===v);return q},maybeSingle(){return q},insert(row){operation='insert';value=row;return q},then(resolve){
 if(table==='trips')return resolve({data:filters.every(f=>f(trip))?trip:null});
 if(operation==='insert'){rows.push(value);return resolve({data:null})}
 resolve({data:rows.find(row=>filters.every(f=>f(row)))||null});
 }};return q},storage:{from(){return {
  upload:async()=>{uploads++;if(hold)await new Promise(resolve=>releases.push(resolve));return storageFailure?{error:Error('Synthetic storage error')}:{data:{}}},
  remove:async()=>({data:{}})
 }}}};
(async()=>{
 const pg=new PGlite();try{
  await pg.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create table auth.users(id uuid primary key);create table trips(id text primary key);create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text,name text);insert into trips values('T');insert into auth.users values('${U}');insert into storage.buckets values('unrelated','unrelated',true,1024,null);`);
  await pg.exec(fs.readFileSync('output/raven-trip-album.sql','utf8'));
  await pg.exec(`insert into raven_trip_album(id,trip_id,uploader_id,kind,object_path,mime_type,byte_size) values('${ID}','T','${U}','video','original.mov','video/quicktime',1024)`);
  const migration=fs.readFileSync('output/raven-trip-album-video-limit.sql','utf8');await pg.exec(migration);await pg.exec(migration);
  assert.deepEqual((await pg.query('select object_path,byte_size from raven_trip_album')).rows,[{object_path:'original.mov',byte_size:1024}],'existing media intact');
  assert.deepEqual((await pg.query("select public,file_size_limit::int from storage.buckets where id='raven-trip-album'")).rows,[{public:false,file_size_limit:limit}]);
  assert.deepEqual((await pg.query("select public,file_size_limit::int from storage.buckets where id='unrelated'")).rows,[{public:true,file_size_limit:1024}]);
  assert.equal((await pg.query("select has_table_privilege('authenticated','raven_trip_album','insert') as allowed")).rows[0].allowed,false);
  await pg.exec(`insert into raven_trip_album(trip_id,uploader_id,kind,object_path,mime_type,byte_size) values('T','${U}','video','maximum.mov','video/quicktime',${limit})`);
  await assert.rejects(pg.exec(`insert into raven_trip_album(trip_id,uploader_id,kind,object_path,mime_type,byte_size) values('T','${U}','video','too-large.mov','video/quicktime',${limit+1})`));
  await assert.rejects(pg.exec(`insert into raven_trip_album(trip_id,uploader_id,kind,object_path,mime_type,byte_size) values('T','${U}','photo','oversized.png','image/png',6291457)`));
 }finally{await pg.close()}
 const app=express();app.use(express.json({limit:'20mb'}));
 register(app,db,async req=>req.headers.authorization==='Bearer member'?{id:U,email:'member@example.invalid'}:req.headers.authorization==='Bearer outsider'?{id:U,email:'outsider@example.invalid'}:null);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
 async function post({body=movie(),mime='video/quicktime',id=ID,auth='member',caption='Weekend 🌵',tripId='T'}={}){
  const response=await fetch(base+'/trips/'+tripId+'/album/file',{method:'POST',headers:{Authorization:'Bearer '+auth,'Content-Type':mime,'X-Raven-Upload-Id':id,'X-Raven-Upload-Caption':encodeURIComponent(caption)},body});return {status:response.status,body:await response.json()};
 }
 try{
  assert.equal((await post({body:large})).status,201);assert.equal(rows[0].byte_size,large.length);assert.equal(rows[0].caption,'Weekend 🌵');assert.equal(rows[0].kind,'video');
  assert.equal((await post()).status,201);assert.equal(uploads,1,'lost-response retry does not duplicate file');
  assert.equal((await post({auth:'none'})).status,401);assert.equal((await post({auth:'outsider'})).status,403);assert.equal((await post({tripId:'other'})).status,404);assert.equal(uploads,1,'outsiders cannot upload');
  assert.equal((await post({mime:'image/svg+xml'})).status,415);assert.equal((await post({id:'bad'})).status,400);assert.equal((await post({caption:'x'.repeat(161)})).status,400);
  assert.equal((await post({body:Buffer.from('fake video bytes fake video')})).status,400);
  assert.equal((await post({body:movie(limit+1)})).status,413,'oversized binary is rejected before buffering');
  storageFailure=true;assert.equal((await post({id:'44444444-4444-4444-8444-444444444444'})).status,503);storageFailure=false;assert.equal(rows.length,1);
  hold=true;const first=post({id:'55555555-5555-4555-8555-555555555555'}),second=post({id:'66666666-6666-4666-8666-666666666666'});
  while(releases.length<2)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal((await post({id:'77777777-7777-4777-8777-777777777777'})).status,429,'bounded simultaneous upload buffers');
  hold=false;releases.splice(0).forEach(resolve=>resolve());assert.equal((await first).status,201);assert.equal((await second).status,201);
  assert.match(fs.readFileSync('Server.js','utf8'),/Access-Control-Allow-Headers[^\n]*X-Raven-Upload-Id, X-Raven-Upload-Caption/,'upload metadata allowed by CORS');
  console.log('PASS binary album: real local HTTP, 13 MiB MOV, 50 MiB boundary, exact MIME/signature validation, iPhone header padding, Unicode captions, retry deduplication, auth/trip isolation, memory concurrency cap and private/idempotent migration preserving existing media.');
 }finally{hold=false;releases.splice(0).forEach(resolve=>resolve());server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
})().catch(error=>{console.error(error);process.exitCode=1});
