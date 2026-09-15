const {randomUUID,randomBytes,createHmac,timingSafeEqual}=require('node:crypto');
const {photoBytes}=require('./raven-chat-routes');
const BUCKET='raven-trip-media';
const emails=value=>{try{const a=typeof value==='string'?JSON.parse(value):value;return Array.isArray(a)?a.map(v=>String(v).trim().toLowerCase()):[]}catch{return []}};
const deny=(status,message)=>{throw Object.assign(Error(message),{status})};
module.exports=function registerTravel(app,db,authenticate){
 const secret=process.env.RAVEN_TRAVEL_SECRET||randomBytes(32).toString('hex');
 const sign=data=>createHmac('sha256',secret).update(data).digest('base64url');
 function fromPass(req){try{const token=String(req.headers?.authorization||'').replace(/^Bearer /,'');const [data,signature]=token.split('.');if(!data||!signature)return null;const expected=Buffer.from(sign(data)),actual=Buffer.from(signature);if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return null;const p=JSON.parse(Buffer.from(data,'base64url').toString());return p.trip===req.params.id&&p.exp>Date.now()?p.user:null}catch{return null}}
 const result=async q=>{const {data,error}=await q;if(error)throw error;return data};
 async function access(id,user){
  if(!/^[a-z0-9_-]{1,64}$/i.test(id))deny(400,'Invalid trip.');
  const trip=await result(db.from('trips').select('id,name,creator_email,member_emails,people').eq('id',id).maybeSingle());
  if(!trip)deny(404,'Trip not found.');
  const owner=String(trip.creator_email||'').trim().toLowerCase(),email=String(user.email||'').trim().toLowerCase();
  const allowed=[...new Set([owner,...emails(trip.member_emails)].filter(Boolean))];
  if(!email||!allowed.includes(email))deny(403,'Only linked trip members can access travel plans. Ask the organizer to add your Raven account to the trip.');
  return {trip,owner:email===owner,allowed};
 }
 const run=fn=>async(req,res)=>{try{const user=fromPass(req)||await authenticate(req);if(!user)deny(401,'Open this trip from your Raven dashboard to reconnect securely.');res.set('Cache-Control','private, no-store');const scope=await access(req.params.id,user);await fn(req,res,user,scope)}catch(e){res.status(e.status||503).json({success:false,error:e.status?e.message:'Travel uploads are not ready. Ask the owner to run the travel-storage setup, or retry later.'})}};
 app.post('/trips/:id/travel-pass',async(req,res)=>{try{const user=await authenticate(req);if(!user)deny(401,'Sign in required.');await access(req.params.id,user);const data=Buffer.from(JSON.stringify({trip:req.params.id,user:{id:user.id,email:user.email},exp:Date.now()+2*60*60*1000})).toString('base64url');res.set('Cache-Control','private, no-store');res.json({success:true,pass:data+'.'+sign(data)})}catch(e){res.status(e.status||503).json({success:false,error:e.status?e.message:'Could not connect travel plans.'})}});
 app.get('/trips/:id/friend-status',run(async(req,res,user,scope)=>{
  const rid=String(req.query.raven_id||'').trim().replace(/^@/,'').toLowerCase();
  if(!/^[a-z0-9_]{1,64}$/.test(rid))deny(400,'Invalid Raven ID.');
  const profile=await result(db.from('profiles').select('id,email').eq('raven_id',rid).maybeSingle());
  if(!profile||!scope.allowed.includes(String(profile.email||'').trim().toLowerCase()))deny(404,'Linked trip member not found.');
  if(profile.id===user.id)return res.json({success:true,status:'self',profile_id:profile.id});
  const rows=await result(db.from('raven_friends').select('user_id,friend_id,status')
   .or('and(user_id.eq.'+user.id+',friend_id.eq.'+profile.id+'),and(user_id.eq.'+profile.id+',friend_id.eq.'+user.id+')'));
  const status=rows.some(r=>r.status==='accepted')?'accepted':rows.some(r=>r.status==='pending')?'pending':'none';
  res.json({success:true,status,profile_id:profile.id});
 }));
 app.get('/trips/:id/travel',run(async(req,res,user,scope)=>{
  const members=await result(db.from('profiles').select('id,first_name,last_name,raven_id').in('email',scope.allowed));
  // Keep the full stored roster visible. A display-name match never grants account access.
  let roster=[];try{roster=typeof scope.trip.people==='string'?JSON.parse(scope.trip.people):scope.trip.people||[]}catch{}
  const aliases=new Set(members.flatMap(p=>[p.first_name,[p.first_name,p.last_name].filter(Boolean).join(' '),p.raven_id].filter(Boolean).map(v=>String(v).trim().replace(/^@/,'').toLowerCase())));
  const guests=Array.isArray(roster)?roster.filter(n=>typeof n==='string'&&n.trim()&&!aliases.has(n.trim().replace(/^@/,'').toLowerCase())).map((name,index)=>({id:'guest-'+index,first_name:name,unlinked:true})):[];
  members.push(...guests);
  const offset=Number(req.query.offset||0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)deny(400,'Invalid page.');
  const rows=await result(db.from('raven_trip_media').select('*').eq('trip_id',scope.trip.id).order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+50));
  const media=await Promise.all(rows.slice(0,50).map(async row=>{
   const signed=await result(db.storage.from(BUCKET).createSignedUrl(row.object_path,900));
   return {id:row.id,kind:row.kind,person_id:row.person_id,title:row.title,created_at:row.created_at,url:signed.signedUrl,can_remove:scope.owner||row.uploader_id===user.id};
  }));res.json({success:true,members,media,can_assign:scope.owner,hasMore:rows.length>50,nextOffset:offset+50});
 }));
 app.post('/trips/:id/travel',run(async(req,res,user,scope)=>{
  const kind=req.body.kind,title=String(req.body.title||'').trim();if(!['stay','flight','vehicle'].includes(kind)||title.length>100)deny(400,'Choose Airbnb / stay, Flight or Vehicle and use a title under 100 characters.');
  let person=null;
  if(kind==='flight'){
   person=req.body.person_id||user.id;
   if(!/^[0-9a-f-]{36}$/i.test(person))deny(400,'Choose a trip member.');
   if(person!==user.id&&!scope.owner)deny(403,'You can upload your own flight. Only the organizer can upload for another member.');
   const member=await result(db.from('profiles').select('email').eq('id',person).maybeSingle());
   if(!member||!scope.allowed.includes(String(member.email).toLowerCase()))deny(400,'That person is not linked to this trip.');
  }
  const photo=photoBytes(req.body.data_url),id=randomUUID(),path=scope.trip.id+'/'+id+'.'+photo.extension;
  await result(db.storage.from(BUCKET).upload(path,photo.bytes,{contentType:photo.mime,upsert:false}));
  try{await result(db.from('raven_trip_media').insert({id,trip_id:scope.trip.id,kind,person_id:person,uploader_id:user.id,title,object_path:path}))}
  catch(error){await db.storage.from(BUCKET).remove([path]);throw error}
  res.status(201).json({success:true});
 }));
 app.delete('/trips/:id/travel/:mediaId',run(async(req,res,user,scope)=>{
  const row=await result(db.from('raven_trip_media').select('*').eq('trip_id',scope.trip.id).eq('id',req.params.mediaId).maybeSingle());
  if(!row)deny(404,'Upload not found.');if(!scope.owner&&row.uploader_id!==user.id)deny(403,'Only the uploader or organizer can remove this.');
  await result(db.storage.from(BUCKET).remove([row.object_path]));
  await result(db.from('raven_trip_media').delete().eq('id',row.id).eq('trip_id',scope.trip.id));res.json({success:true});
 }));
};
module.exports.emails=emails;
