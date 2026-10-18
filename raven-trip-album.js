'use strict';
const {randomUUID}=require('node:crypto');
const {photoBytes}=require('./raven-chat-routes');
const BUCKET='raven-trip-album',TABLE='raven_trip_album';
const VIDEO_LIMIT=12*1024*1024,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=(status,message)=>{throw Object.assign(Error(message),{status})};
function mediaBytes(value){
 if(typeof value!=='string')fail(400,'Choose a photo or video.');
 if(value.startsWith('data:image/'))return {...photoBytes(value),kind:'photo'};
 const match=value.match(/^data:(video\/(?:mp4|quicktime|webm));base64,([A-Za-z0-9+/=]+)$/);
 if(!match||match[2].length>VIDEO_LIMIT*4/3)fail(400,'Choose an MP4, MOV or WebM video up to 12 MB.');
 const bytes=Buffer.from(match[2],'base64'),mime=match[1];
 if(bytes.length<16||bytes.length>VIDEO_LIMIT)fail(400,'Video must be up to 12 MB.');
 let valid=false;
 if(mime==='video/webm'){
  valid=bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))&&bytes.subarray(4,4096).includes(Buffer.from('webm'));
 }else if(bytes.toString('ascii',4,8)==='ftyp'){
  const size=bytes.readUInt32BE(0),brands=[bytes.toString('ascii',8,12)];
  if(size>=16&&size<=bytes.length&&size<=4096){for(let i=16;i+4<=size;i+=4)brands.push(bytes.toString('ascii',i,i+4));
   valid=brands.some(b=>['isom','iso2','iso4','iso5','iso6','avc1','mp41','mp42','M4V ','qt  '].includes(b))&&!brands.some(b=>['heic','heix','mif1','avif','avis'].includes(b));
  }
 }
 if(!valid)fail(400,'Video format does not match the file. Export it as MP4, MOV or WebM.');
 return {bytes,mime,kind:'video',extension:mime==='video/quicktime'?'mov':mime.split('/')[1]};
}
module.exports=function registerAlbum(app,db,{run,result}){
 const scoped=(req,res,user,scope)=>db.from(TABLE).select('*').eq('trip_id',scope.trip.id).eq('id',req.params.mediaId).maybeSingle();
 async function presentation(row,user,scope){
  const signed=await result(db.storage.from(BUCKET).createSignedUrl(row.object_path,300));
  return {id:row.id,kind:row.kind,caption:row.caption,mime_type:row.mime_type,created_at:row.created_at,url:signed.signedUrl,can_remove:scope.owner||row.uploader_id===user.id};
 }
 app.get('/trips/:id/album',run(async(req,res,user,scope)=>{
  const offset=Number(req.query.offset||0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)fail(400,'Invalid album page.');
  const rows=await result(db.from(TABLE).select('*').eq('trip_id',scope.trip.id).order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+24));
  const media=await Promise.all(rows.slice(0,24).map(row=>presentation(row,user,scope)));
  res.json({success:true,media,hasMore:rows.length>24,nextOffset:offset+24});
 }));
 app.get('/trips/:id/album/:mediaId',run(async(req,res,user,scope)=>{
  if(!UUID.test(req.params.mediaId))fail(400,'Invalid album item.');
  const row=await result(scoped(req,res,user,scope));if(!row)fail(404,'This photo or video is no longer in the album.');
  res.json({success:true,media:await presentation(row,user,scope)});
 }));
 app.post('/trips/:id/album',run(async(req,res,user,scope)=>{
  const caption=String(req.body.caption||'').trim();if(caption.length>160)fail(400,'Keep the caption under 160 characters.');
  const media=mediaBytes(req.body.data_url),id=req.body.upload_id||randomUUID();
  if(!UUID.test(id))fail(400,'Invalid upload. Choose the file again.');
  const existing=await result(db.from(TABLE).select('id,uploader_id,trip_id').eq('id',id).maybeSingle());
  if(existing){if(existing.uploader_id!==user.id||existing.trip_id!==scope.trip.id)fail(409,'This upload belongs to another album.');return res.status(201).json({success:true,id})}
  // Never reuse a deleted object's path: delayed cleanup of an earlier upload
  // must not remove a newer retry using the same client upload ID.
  const path=scope.trip.id+'/'+randomUUID()+'.'+media.extension;
  await result(db.storage.from(BUCKET).upload(path,media.bytes,{contentType:media.mime,upsert:false}));
  try{await result(db.from(TABLE).insert({id,trip_id:scope.trip.id,uploader_id:user.id,kind:media.kind,caption,object_path:path,mime_type:media.mime,byte_size:media.bytes.length}))}
  catch(error){await db.storage.from(BUCKET).remove([path]);throw error}
  res.status(201).json({success:true,id});
 }));
 app.delete('/trips/:id/album/:mediaId',run(async(req,res,user,scope)=>{
  if(!UUID.test(req.params.mediaId))fail(400,'Invalid album item.');
  const row=await result(scoped(req,res,user,scope));if(!row)fail(404,'Album item not found.');
  if(!scope.owner&&row.uploader_id!==user.id)fail(403,'Only the uploader or trip organizer can remove this.');
  await result(db.storage.from(BUCKET).remove([row.object_path]));
  await result(db.from(TABLE).delete().eq('trip_id',scope.trip.id).eq('id',row.id));
  res.json({success:true});
 }));
};
// New uploads must not prevent account deletion or leave personal files behind.
module.exports.cleanupUser=async function cleanupUser(db,userId){
 for(;;){
  const {data:rows,error}=await db.from(TABLE).select('id,object_path').eq('uploader_id',userId).limit(100);
  if(error){if(['42P01','PGRST205'].includes(error.code))return;throw error}
  if(!rows?.length)return;
  const removal=await db.storage.from(BUCKET).remove(rows.map(r=>r.object_path));if(removal.error)throw removal.error;
  const deletion=await db.from(TABLE).delete().eq('uploader_id',userId).in('id',rows.map(r=>r.id));if(deletion.error)throw deletion.error;
 }
};
module.exports.mediaBytes=mediaBytes;
module.exports.flushCleanup=async function flushCleanup(db){
 const batch=await db.from('raven_trip_album_cleanup').select('object_path').order('created_at',{ascending:true}).limit(100);
 if(batch.error){if(['42P01','PGRST205'].includes(batch.error.code))return;throw batch.error}
 if(!batch.data?.length)return;
 const paths=batch.data.map(row=>row.object_path);
 const removed=await db.storage.from(BUCKET).remove(paths);if(removed.error)throw removed.error;
 const cleared=await db.from('raven_trip_album_cleanup').delete().in('object_path',paths);if(cleared.error)throw cleared.error;
};
module.exports.startCleanup=function startCleanup(db){
 let running=false;
 const timer=setInterval(async()=>{if(running)return;running=true;try{await module.exports.flushCleanup(db)}catch{console.error('[trip-album] Storage cleanup will retry.')}finally{running=false}},5*60*1000);
 timer.unref();return timer;
};
