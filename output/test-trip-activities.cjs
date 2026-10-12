const assert=require('node:assert/strict'),fs=require('node:fs'),register=require('../raven-trip-travel');
const {PGlite}=require('./push-test-runtime/node_modules/@electric-sql/pglite');
const U='11111111-1111-4111-8111-111111111111';let user={id:U,email:'member@test.invalid'},inserted,uploads=0;const routes={};
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jI9sAAAAASUVORK5CYII=';
const db={from(table){const q={select(){return q},eq(){return q},maybeSingle(){return q},insert(row){inserted=row;return q},then(resolve){resolve({data:table==='trips'?{id:'T',creator_email:'owner@test.invalid',member_emails:['member@test.invalid']}:null})}};return q},storage:{from(){return {upload:async()=>{uploads++;return {data:{}}},remove:async()=>({})}}}};
register({get(){},patch(){},delete(){},post:(p,h)=>routes[p]=h},db,async()=>user);
async function call(){let status=200,body;const res={set(){},status(v){status=v;return res},json(v){body=v}};await routes['/trips/:id/travel']({params:{id:'T'},headers:{},body:{kind:'activity',title:'Saturday hike',data_url:png,person_id:U}},res);return {status,body}}
(async()=>{
 const pg=new PGlite();try{
  await pg.exec("create table raven_trip_media(kind text,person_id uuid);");
  const sql=fs.readFileSync('output/raven-trip-center-activities.sql','utf8');await pg.exec(sql);await pg.exec(sql);
  await pg.exec("insert into raven_trip_media values('activity',null),('stay',null),('vehicle',null),('flight','"+U+"')");
  await assert.rejects(pg.exec("insert into raven_trip_media values('activity','"+U+"')"));await assert.rejects(pg.exec("insert into raven_trip_media values('other',null)"));
 }finally{await pg.close()}
 assert.equal((await call()).status,201);assert.equal(inserted.kind,'activity');assert.equal(inserted.person_id,null);assert.equal(inserted.uploader_id,U);
 user=null;assert.equal((await call()).status,401);assert.equal(uploads,1);
 user={id:U,email:'outsider@test.invalid'};assert.equal((await call()).status,403);assert.equal(uploads,1);
 console.log('PASS activities: rerunnable schema, shared category, preserved flight rules, linked-member upload, denied outsider/anonymous.');
})().catch(e=>{console.error(e);process.exitCode=1});
