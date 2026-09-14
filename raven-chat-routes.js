const { randomUUID } = require('crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUCKET = 'raven-chat-media';
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
function pageOffset(value) { const n=Number(value||0); if(!Number.isSafeInteger(n)||n<0||n>100000)fail(400,'Invalid page.');return n; }
function photoBytes(value) {
  const match=String(value||'').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if(!match || match[2].length>8388608)fail(400,'Choose a JPEG, PNG, or WebP photo up to 6 MB.');
  const bytes=Buffer.from(match[2],'base64');
  if(!bytes.length||bytes.length>6291456)fail(400,'Photo must be under 6 MB.');
  const mime=match[1];
  const valid=mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  if(!valid)fail(400,'Photo format does not match the file.');
  return {bytes,mime,extension:mime.split('/')[1]};
}
module.exports = function registerRavenChats(app, db, authenticate) {
  const run=handler=>async(req,res)=>{
    try { const user=await authenticate(req);if(!user)fail(401,'Sign in required.');res.set('Cache-Control','private, no-store');await handler(req,res,user); }
    catch(error){console.error('[private-chat]',error.message);res.status(error.status||503).json({success:false,error:error.status?error.message:'Chat could not be updated. Please retry.'});}
  };
  async function result(query) { const {data,error}=await query;if(error)throw error;return data; }
  require('./raven-group-controls')(app,db,{run,result,member,photoBytes});
  async function member(chatId,userId) {
    if(!UUID.test(chatId))fail(400,'Invalid chat.');
    const row=await result(db.from('raven_chat_members').select('chat_id,user_id,last_read_at').eq('chat_id',chatId).eq('user_id',userId).maybeSingle());
    if(!row)fail(403,'You are not a member of this chat.');return row;
  }
  async function friends(userId) {
    const edges=await result(db.from('raven_friends').select('user_id,friend_id').eq('status','accepted').or('user_id.eq.'+userId+',friend_id.eq.'+userId));
    return [...new Set((edges||[]).map(e=>e.user_id===userId?e.friend_id:e.user_id).filter(id=>id!==userId))];
  }
  async function requireFriend(peer,user) {if(!UUID.test(peer)||peer===user)fail(400,'Choose a Raven friend.');if(!(await friends(user)).includes(peer))fail(403,'You must be accepted Raven friends first.');}
  const profileFields='id,first_name,last_name,raven_id,avatar_url';
  app.get('/chats/friends',run(async(req,res,user)=>{
    const ids=await friends(user.id);const profiles=ids.length?await result(db.from('profiles').select(profileFields).in('id',ids)):[];
    res.json({success:true,friends:profiles});
  }));
  app.get('/chats',run(async(req,res,user)=>{
    const offset=pageOffset(req.query.offset);
    const membership=await result(db.from('raven_chat_members').select('chat_id,last_read_at').eq('user_id',user.id));
    const ids=(membership||[]).map(m=>m.chat_id);
    if(!ids.length)return res.json({success:true,chats:[],hasMore:false,nextOffset:offset+50});
    const rows=await result(db.from('raven_chats').select('id,name,kind,updated_at,created_at,created_by').in('id',ids).order('updated_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+50));
    let groupPhotos=[];try{groupPhotos=await result(db.from('raven_chats').select('id,photo_path').in('id',rows.slice(0,50).map(c=>c.id)))}catch{/* Older schema still supports existing chats. */}
    const chats=await Promise.all(rows.slice(0,50).map(async chat=>{
      const latest=await result(db.from('raven_chat_messages').select('id,sender_id,body,created_at').eq('chat_id',chat.id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1));
      const last=latest[0]||null,read=membership.find(m=>m.chat_id===chat.id)?.last_read_at;
      let photo_url=null;const photoPath=groupPhotos.find(p=>p.id===chat.id)?.photo_path;if(photoPath){try{photo_url=(await result(db.storage.from(BUCKET).createSignedUrl(photoPath,900))).signedUrl}catch{}}
      return {...chat,photo_url,last_message:last,unread:!!(last&&last.sender_id!==user.id&&(!read||last.created_at>read))};
    }));
    res.json({success:true,chats,hasMore:rows.length>50,nextOffset:offset+50});
  }));
  app.post('/chats',run(async(req,res,user)=>{
    const name=String(req.body.name||'').trim();const peers=[...new Set(Array.isArray(req.body.members)?req.body.members:[])].filter(id=>id!==user.id);
    if(!name||name.length>80)fail(400,'Name your group using 1–80 characters.');
    if(peers.length<2||peers.length>19||peers.some(id=>!UUID.test(id)))fail(400,'Select 2–19 Raven friends for a group.');
    const accepted=await friends(user.id);if(peers.some(id=>!accepted.includes(id)))fail(403,'Every invited person must be your accepted Raven friend.');
    const chat=await result(db.from('raven_chats').insert({name,kind:'group',created_by:user.id}).select('*').single());
    try {await result(db.from('raven_chat_members').insert([user.id,...peers].map(user_id=>({chat_id:chat.id,user_id}))));}
    catch(error){await db.from('raven_chats').delete().eq('id',chat.id);throw error;}
    res.status(201).json({success:true,chat});
  }));
  app.patch('/chats/:id',run(async(req,res,user)=>{
    await member(req.params.id,user.id);const name=String(req.body.name||'').trim();if(!name||name.length>80)fail(400,'Use 1–80 characters for the group name.');
    const {error}=await db.rpc('raven_manage_group',{p_chat:req.params.id,p_actor:user.id,p_action:'rename',p_value:name});
    if(error)return res.status(error.code==='P0001'?403:503).json({success:false,error:error.code==='P0001'?error.message:'Group controls need the one-time database setup.'});
    const chat=await result(db.from('raven_chats').select('id,name').eq('id',req.params.id).maybeSingle());
    if(!chat)fail(404,'Group not found.');res.json({success:true,chat});
  }));
  app.get('/chats/:id/messages',run(async(req,res,user)=>{
    await member(req.params.id,user.id);const offset=pageOffset(req.query.offset);
    const rows=await result(db.from('raven_chat_messages').select('id,body,sender_id,created_at').eq('chat_id',req.params.id).order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+50));
    const members=await result(db.from('raven_chat_members').select('user_id').eq('chat_id',req.params.id));
    const profiles=await result(db.from('profiles').select(profileFields).in('id',members.map(m=>m.user_id)));
    const chat=await result(db.from('raven_chats').select('id,name').eq('id',req.params.id).single());
    res.json({success:true,chat,members:profiles,messages:rows.slice(0,50).reverse(),hasMore:rows.length>50,nextOffset:offset+50});
  }));
  app.post('/chats/:id/messages',run(async(req,res,user)=>{
    await member(req.params.id,user.id);const body=String(req.body.body||'').trim();if(!body||body.length>10000)fail(400,'Messages must be 1–10,000 characters.');
    const message=await result(db.from('raven_chat_messages').insert({chat_id:req.params.id,sender_id:user.id,body}).select('*').single());
    await result(db.from('raven_chats').update({updated_at:message.created_at}).eq('id',req.params.id));
    res.status(201).json({success:true,message});
  }));
  app.post('/chats/:id/read',run(async(req,res,user)=>{
    const membership=await member(req.params.id,user.id);
    // Mark only messages that were actually fetched, not newer arrivals.
    const at=String(req.body.at||'');if(!at||!Number.isFinite(Date.parse(at))||Date.parse(at)>Date.now()+1000)fail(400,'Invalid read time.');
    if(!membership.last_read_at||Date.parse(at)>Date.parse(membership.last_read_at))await result(db.from('raven_chat_members').update({last_read_at:at}).eq('chat_id',req.params.id).eq('user_id',user.id));res.json({success:true});
  }));
  function mediaQuery(scope,user) {
    let q=db.from('raven_chat_media').select('id,message_id,uploader_id,object_path,created_at');
    return scope.chat?q.eq('chat_id',scope.chat):q.is('chat_id',null).or('and(uploader_id.eq.'+user+',dm_peer_id.eq.'+scope.peer+'),and(uploader_id.eq.'+scope.peer+',dm_peer_id.eq.'+user+')');
  }
  async function scope(req,user,writing=false) {
    if(req.params.id){await member(req.params.id,user.id);return {chat:req.params.id};}
    if(!UUID.test(req.params.peer)||req.params.peer===user.id)fail(400,'Invalid conversation.');
    if(writing)await requireFriend(req.params.peer,user.id);
    return {peer:req.params.peer};
  }
  const getMedia=run(async(req,res,user)=>{
    const s=await scope(req,user),offset=pageOffset(req.query.offset);
    const rows=await result(mediaQuery(s,user.id).order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+50));
    const media=await Promise.all(rows.slice(0,50).map(async row=>{
      const signed=await result(db.storage.from(BUCKET).createSignedUrl(row.object_path,900));
      return {id:row.id,message_id:row.message_id,uploader_id:row.uploader_id,created_at:row.created_at,url:signed.signedUrl};
    }));res.json({success:true,media,hasMore:rows.length>50,nextOffset:offset+50});
  });
  const uploadMedia=run(async(req,res,user)=>{
    const s=await scope(req,user,true),photo=photoBytes(req.body.data_url),id=randomUUID();
    const objectPath=user.id+'/'+id+'.'+photo.extension;
    await result(db.storage.from(BUCKET).upload(objectPath,photo.bytes,{contentType:photo.mime,upsert:false}));
    let message=null;
    try {
      if(s.chat) message=await result(db.from('raven_chat_messages').insert({chat_id:s.chat,sender_id:user.id,body:'[Photo]'}).select('*').single());
      await result(db.from('raven_chat_media').insert({id,chat_id:s.chat||null,dm_peer_id:s.peer||null,uploader_id:user.id,message_id:message?.id||null,object_path:objectPath,mime_type:photo.mime,bytes:photo.bytes.length}));
      if(s.peer)await result(db.from('direct_messages').insert({sender_id:user.id,receiver_id:s.peer,body:'[RAVEN_PHOTO:'+id+']'}));
    }catch(error){await db.from('raven_chat_media').delete().eq('id',id);if(message)await db.from('raven_chat_messages').delete().eq('id',message.id);await db.storage.from(BUCKET).remove([objectPath]);throw error;}
    if(s.chat)await result(db.from('raven_chats').update({updated_at:new Date().toISOString()}).eq('id',s.chat));
    res.status(201).json({success:true,id});
  });
  app.get('/chats/:id/media',getMedia);app.post('/chats/:id/media',uploadMedia);
  app.get('/chat-dms/:peer/media',getMedia);app.post('/chat-dms/:peer/media',uploadMedia);
};
module.exports.photoBytes=photoBytes;
