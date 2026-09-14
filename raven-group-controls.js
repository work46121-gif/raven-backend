const {randomUUID}=require('crypto');
module.exports=function(app,db,{run,result,member,photoBytes}){
 const bucket='raven-chat-media';
 async function details(id,user){await member(id,user);const chat=await result(db.from('raven_chats').select('id,name,photo_path').eq('id',id).single());const rows=await result(db.from('raven_chat_members').select('user_id,role').eq('chat_id',id));const profiles=await result(db.from('profiles').select('id,first_name,last_name,raven_id,avatar_url').in('id',rows.map(r=>r.user_id)));let photo_url=null;if(chat.photo_path)photo_url=(await result(db.storage.from(bucket).createSignedUrl(chat.photo_path,900))).signedUrl;return {chat:{id:chat.id,name:chat.name,photo_url},members:profiles.map(p=>({...p,role:rows.find(r=>r.user_id===p.id).role})),can_manage:rows.find(r=>r.user_id===user)?.role==='admin'};}
 app.get('/chats/:id/details',run(async(req,res,user)=>res.json({success:true,...await details(req.params.id,user.id)})));
 app.post('/chats/:id/manage',run(async(req,res,user)=>{
  await member(req.params.id,user.id);
  if(!['add','remove','role','leave'].includes(req.body.action))return res.status(400).json({success:false,error:'Invalid group action.'});
  const {error}=await db.rpc('raven_manage_group',{p_chat:req.params.id,p_actor:user.id,p_action:req.body.action,p_target:req.body.target||null,p_value:req.body.role||null});
  if(error)return res.status(error.code==='P0001'?400:503).json({success:false,error:error.code==='P0001'?error.message:'Group controls need the one-time database setup.'});
  res.json({success:true});
 }));
 app.post('/chats/:id/photo',run(async(req,res,user)=>{
  const before=await details(req.params.id,user.id);if(!before.can_manage)return res.status(403).json({success:false,error:'Only group admins can change the group photo.'});
  const photo=photoBytes(req.body.data_url),path='groups/'+req.params.id+'/'+randomUUID()+'.'+photo.extension;
  await result(db.storage.from(bucket).upload(path,photo.bytes,{contentType:photo.mime,upsert:false}));
  const {error}=await db.rpc('raven_manage_group',{p_chat:req.params.id,p_actor:user.id,p_action:'photo',p_value:path});
  if(error){await db.storage.from(bucket).remove([path]);return res.status(403).json({success:false,error:'Could not change group photo. Check your admin access and retry.'})}
  res.json({success:true});
 }));
};
