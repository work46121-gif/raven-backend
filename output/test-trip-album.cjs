'use strict';
// Synthetic local fixtures only: no network, customer data or storage writes.
const assert=require('node:assert/strict'),fs=require('node:fs');
const register=require('../raven-trip-travel'),album=require('../raven-trip-album');
const {PGlite}=require('./push-test-runtime/node_modules/@electric-sql/pglite');
const U='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',ID='33333333-3333-4333-8333-333333333333';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jI9sAAAAASUVORK5CYII=';
const mp4=Buffer.alloc(24);mp4.writeUInt32BE(24);mp4.write('ftyp',4);mp4.write('isom',8);mp4.write('mp42',16);mp4.write('avc1',20);
const video='data:video/mp4;base64,'+mp4.toString('base64');
assert.equal(album.mediaBytes(png).kind,'photo');assert.equal(album.mediaBytes(video).kind,'video');
const mov=Buffer.from(mp4);mov.write('qt  ',8);assert.equal(album.mediaBytes('data:video/quicktime;base64,'+mov.toString('base64')).extension,'mov');
const webm=Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3]),Buffer.from('webm'),Buffer.alloc(20)]);assert.equal(album.mediaBytes('data:video/webm;base64,'+webm.toString('base64')).extension,'webm');
for(const value of [null,'https://private.invalid/photo','data:image/svg+xml;base64,PHN2Zz4=','data:video/mp4;base64,'+Buffer.from('<html>not a movie</html>').toString('base64'),png.replace('image/png','image/jpeg'),'data:video/mp4;base64,'+Buffer.alloc(12582913).toString('base64')])assert.throws(()=>album.mediaBytes(value));
let user={id:U,email:'member@test.invalid'},rows=[],uploads=[],removals=[],signed=[],insertError=false,storageError=false,tableMissing=false,profileLookups=0,profileError=false;
const routes={};
const trip={id:'T',creator_email:'owner@test.invalid',member_emails:['member@test.invalid','other@test.invalid'],people:['Member','Other']};
const db={from(table){let filters=[],op='read',inserted,range;const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},order(){return q},range(a,b){range=[a,b+1];return q},limit(n){range=[0,n];return q},maybeSingle(){q.single=true;return q},insert(row){op='insert';inserted=row;return q},delete(){op='delete';return q},then(resolve){
  if(table==='trips')return resolve({data:[trip,{...trip,id:'T2'}].find(r=>filters.every(f=>f(r)))||null});
  if(table==='profiles'){profileLookups++;return resolve(profileError?{error:Error('offline')}:{data:[{id:U,first_name:'Alex',last_name:'Member',avatar_url:'https://synthetic.invalid/avatar.png',email:'never-return@example.invalid'}]})}
  if(tableMissing)return resolve({error:{code:'42P01'}});
  let found=rows.filter(r=>filters.every(f=>f(r)));
  if(op==='insert'){if(insertError)return resolve({error:{code:'synthetic'}});rows.push({...inserted,created_at:'2026-10-18T16:00:00Z'});return resolve({data:null})}
  if(op==='delete'){rows=rows.filter(r=>!found.includes(r));return resolve({data:null})}
  if(range)found=found.slice(...range);resolve({data:q.single?found[0]||null:found});
 }};return q},storage:{from(bucket){assert.equal(bucket,'raven-trip-album');return {
  upload:async(path,bytes,opts)=>{uploads.push({path,bytes:bytes.length,opts});return storageError?{error:{code:'storage'}}:{data:{}}},
  remove:async(paths)=>{removals.push(...paths);return storageError?{error:{code:'storage'}}:{data:{}}},
  createSignedUrl:async(path,ttl)=>{signed.push({path,ttl});return {data:{signedUrl:'https://synthetic.invalid/private/'+path}}}
 }}}};
const app={};for(const method of ['get','post','delete','patch'])app[method]=(p,h)=>routes[method+' '+p]=h;
register(app,db,async()=>user);
async function call(method='get',suffix='',body={},params={}){
 let status=200,payload,headers={};const res={set(k,v){headers[k]=v},status(n){status=n;return res},json(v){payload=v}};
 await routes[method+' /trips/:id/album'+suffix]({params:{id:'T',mediaId:ID,...params},query:body,body,headers:{}},res);return {status,payload,headers};
}
(async()=>{
 const pg=new PGlite();try{
  await pg.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
   create table auth.users(id uuid primary key);create table trips(id text primary key);
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(bucket_id text,name text);alter table storage.objects enable row level security;
   grant usage on schema storage to anon,authenticated;grant select on storage.objects to anon,authenticated;
   create policy legacy_broad_policy on storage.objects for all to anon,authenticated using(true) with check(true);
   insert into storage.objects values('raven-trip-album','private.png'),('unrelated-bucket','unchanged.png');
   insert into trips values('T');insert into auth.users values('${U}');`);
  const sql=fs.readFileSync('output/raven-trip-album.sql','utf8');await pg.exec(sql);await pg.exec(sql);
  const permissions=(await pg.query("select has_table_privilege('anon','raven_trip_album','select') as anon,has_table_privilege('authenticated','raven_trip_album','insert') as member,has_table_privilege('service_role','raven_trip_album','insert') as service")).rows[0];assert.deepEqual(permissions,{anon:false,member:false,service:true});
  assert.equal((await pg.query("select relrowsecurity from pg_class where relname='raven_trip_album'")).rows[0].relrowsecurity,true);
  assert.equal((await pg.query('select public from storage.buckets')).rows[0].public,false);
  await pg.exec('set role authenticated');assert.deepEqual((await pg.query('select name from storage.objects')).rows,[{name:'unchanged.png'}],'even broad old storage policies cannot expose the album');await pg.exec('reset role');
  const insert=(kind,mime,size)=>pg.query('insert into raven_trip_album(trip_id,uploader_id,kind,object_path,mime_type,byte_size) values($1,$2,$3,$4,$5,$6)',['T',U,kind,kind+size,mime,size]);
  await insert('photo','image/png',100);await insert('video','video/mp4',12582912);
  await assert.rejects(insert('video','video/mp4',12582913));await assert.rejects(insert('photo','image/svg+xml',20));await assert.rejects(insert('photo','image/png',6291457));
  await pg.exec(sql);assert.equal((await pg.query('select count(*)::int as n from raven_trip_album')).rows[0].n,2,'reinstall preserves uploads');
  await pg.exec("delete from trips where id='T'");assert.equal((await pg.query('select count(*)::int as n from raven_trip_album_cleanup')).rows[0].n,2,'trip deletion durably queues private object cleanup');
 }finally{await pg.close()}
 assert.equal((await call('post','',{data_url:png,caption:'Desert hike',upload_id:ID})).status,201);
 assert.equal(rows[0].uploader_id,U);assert.equal(uploads.length,1);assert.equal(uploads[0].opts.upsert,false);
 assert.equal((await call('post','',{data_url:png,upload_id:ID})).status,201);assert.equal(uploads.length,1,'retry does not create a duplicate');
 const page=await call();assert.equal(page.headers['Cache-Control'],'private, no-store');assert.equal(page.payload.media[0].can_remove,true);assert.equal(page.payload.media[0].object_path,undefined);assert.equal(page.payload.media[0].uploader_id,undefined);assert.equal(signed[0].ttl,300);
 assert.deepEqual(page.payload.media[0].uploader,{name:'Alex Member',avatar_url:'https://synthetic.invalid/avatar.png'});
 assert.equal(page.payload.media[0].created_at,'2026-10-18T16:00:00Z');
 assert.equal((await call('get','/:mediaId')).status,200);
 assert.equal((await call('get','',{offset:-1})).status,400);
 user=null;const before=signed.length;assert.equal((await call()).status,401);
 user={id:OTHER,email:'outsider@test.invalid'};assert.equal((await call()).status,403);assert.equal((await call('post','',{data_url:video})).status,403);assert.equal(signed.length,before);
 user={id:OTHER,email:'other@test.invalid'};assert.equal((await call()).payload.media[0].can_remove,false);assert.equal((await call('delete','/:mediaId')).status,403);
 assert.equal((await call('post','',{data_url:video,upload_id:ID})).status,409,'cannot reuse another uploader id');
 assert.equal((await call('get','/:mediaId',{}, {mediaId:'44444444-4444-4444-8444-444444444444'})).status,404);
 assert.equal((await call('get','/:mediaId',{}, {id:'T2'})).status,404,'cannot read a different trip’s photo by guessing its ID');
 assert.equal((await call('delete','/:mediaId',{}, {id:'T2'})).status,404);
 assert.equal((await call('get','',{}, {id:'MISSING'})).status,404);
 user={id:U,email:'member@test.invalid'};
 assert.equal((await call('post','',{data_url:video,caption:'x'.repeat(161)})).status,400);
 insertError=true;const removed=removals.length;assert.equal((await call('post','',{data_url:video})).status,503);assert.equal(removals.length,removed+1,'failed metadata insert cleans storage');insertError=false;
 storageError=true;const rowCount=rows.length;assert.equal((await call('post','',{data_url:video})).status,503);assert.equal(rows.length,rowCount);assert.equal((await call('delete','/:mediaId')).status,503);assert.equal(rows.length,rowCount);storageError=false;
 user={id:OTHER,email:'owner@test.invalid'};assert.equal((await call()).payload.media[0].can_remove,false);const deletesBefore=removals.length;assert.equal((await call('delete','/:mediaId')).status,403);assert.equal(removals.length,deletesBefore,'organizer cannot delete another member’s storage object');assert.equal(rows.length,1);
 user={id:U,email:'member@test.invalid'};assert.equal((await call('delete','/:mediaId')).status,200);assert.equal(rows.length,0);
 user={id:U,email:'member@test.invalid'};await call('post','',{data_url:video,upload_id:ID});assert.equal(rows[0].kind,'video');
 // More than one page, private signed URLs limited to the returned 24.
 rows=Array.from({length:25},(_,i)=>({...rows[0],id:i===0?ID:String(i),object_path:'T/'+i+'.mp4'}));
 const lookupsBefore=profileLookups;const first=await call();assert.equal(profileLookups,lookupsBefore+1,'only one profile lookup for the whole page');assert.equal(first.payload.media.length,24);assert.equal(first.payload.hasMore,true);assert.equal((await call('get','',{offset:24})).payload.media.length,1);
 profileError=true;assert.equal((await call()).payload.media[0].uploader.name,'RAVEN member','optional profile failure does not block the album');profileError=false;
 rows.push({...rows[0],id:'different-user',uploader_id:OTHER,object_path:'T/other.mp4'});
 await album.cleanupUser(db,U);assert.equal(rows.length,1);assert.equal(rows[0].uploader_id,OTHER);
 tableMissing=true;await album.cleanupUser(db,U);tableMissing=false;
 let queued=[{object_path:'T/deleted.mp4'}],cleanupFailure=true;
 const cleanupDb={from(table){assert.equal(table,'raven_trip_album_cleanup');return {select(){return {order(){return {limit:async()=>({data:queued})}}}},delete(){return {in:async()=>{queued=[];return {}}}}}},storage:{from(bucket){assert.equal(bucket,'raven-trip-album');return {remove:async()=>cleanupFailure?{error:Error('offline')}:{data:{}}}}}};
 await assert.rejects(album.flushCleanup(cleanupDb));assert.equal(queued.length,1);cleanupFailure=false;await album.flushCleanup(cleanupDb);assert.equal(queued.length,0,'queue cleared only after storage deletion succeeds');
 console.log('PASS album: private/idempotent schema, file signatures/limits, linked-member auth, private URLs, isolated ownership, retries, pagination, storage failures, account cleanup.');
})().catch(e=>{console.error(e);process.exitCode=1});
