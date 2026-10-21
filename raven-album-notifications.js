'use strict';
const emails=value=>{try{const list=typeof value==='string'?JSON.parse(value):value;return Array.isArray(list)?list.map(v=>String(v).trim().toLowerCase()):[]}catch{return []}};
const linked=(trip,email)=>[String(trip.creator_email||'').trim().toLowerCase(),...emails(trip.member_emails)].includes(String(email||'').trim().toLowerCase());
module.exports.register=function register(app,db,authenticate){
 app.get('/me/trip-album-notifications',async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  try{
   const user=await authenticate(req);if(!user?.id||!user.email)return res.status(401).json({success:false,error:'Sign in to view album notifications.'});
   const events=await db.from('raven_push_events').select('id,source_id,created_at').eq('user_id',user.id).eq('kind','trip_album').order('created_at',{ascending:false}).limit(50);
   if(events.error)throw events.error;
   const ids=[...new Set((events.data||[]).map(e=>e.source_id))];
   if(!ids.length)return res.json({success:true,notifications:[]});
   const trips=await db.from('trips').select('id,name,creator_email,member_emails').in('id',ids);if(trips.error)throw trips.error;
   const allowed=new Map((trips.data||[]).filter(t=>linked(t,user.email)).map(t=>[t.id,t]));
   res.json({success:true,notifications:events.data.filter(e=>allowed.has(e.source_id)).map(e=>({id:e.id,trip_id:e.source_id,trip_name:allowed.get(e.source_id).name||'Your trip',created_at:e.created_at}))});
  }catch{res.status(503).json({success:false,error:'Album notifications could not refresh. Please retry.'})}
 });
};
// Recheck membership immediately before delivery, including queued retries.
module.exports.eligible=async function eligible(db,event){
 const {data,error}=await db.rpc('raven_push_linked_trip_profiles',{p_trip:event.source_id});if(error)throw error;
 return (data||[]).some(p=>p.id===event.user_id);
};
