'use strict';
// Delete only the server-authenticated caller. Never accept a target ID/email
// from the request body. Shared bills and payments are deliberately untouched.
module.exports=function registerAccountDelete(app,db){
 app.post('/account/delete',async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
   const header=req.headers.authorization||'';
   if(!header.startsWith('Bearer ')||!header.slice(7).trim())return res.status(401).json({success:false,error:'Sign in again to delete your account.'});
   const auth=await db.auth.getUser(header.slice(7));const user=auth.data?.user;
   if(auth.error||!user?.id)return res.status(401).json({success:false,error:'Invalid or expired session. Please sign in again.'});
   async function cleanup(query,optional=false){const result=await query;if(result.error&&!(optional&&['42P01','PGRST205'].includes(result.error.code)))throw Error('cleanup');}
   await require('./raven-trip-album').cleanupUser(db,user.id);
   await cleanup(db.from('raven_friends').delete().or(`user_id.eq.${user.id},friend_id.eq.${user.id}`));
   if(user.email){
    await cleanup(db.from('trip_members').delete().eq('user_email',user.email),true);
    await cleanup(db.from('contacts').delete().eq('owner_phone',user.email),true);
   }
   await cleanup(db.from('profiles').delete().eq('id',user.id));
   const profile=await db.from('profiles').select('id').eq('id',user.id).maybeSingle();
   if(profile.error||profile.data)throw Error('profile_not_deleted');
   const deletion=await db.auth.admin.deleteUser(user.id,false);
   if(deletion.error)throw Error('auth_delete');
   const verification=await db.auth.admin.getUserById(user.id);
   const absent=verification.error&&(verification.error.code==='user_not_found'||verification.error.status===404);
   if(!absent||verification.data?.user)throw Error('auth_not_verified');
   return res.json({success:true,deleted:true,deleted_user_id:user.id});
  }catch{
   return res.status(503).json({success:false,error:'Account deletion could not be confirmed. Some cleanup may have completed. Do not assume your account is deleted; retry or contact support.'});
  }
 });
};
