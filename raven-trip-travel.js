const {randomUUID,randomBytes,createHmac,timingSafeEqual}=require('node:crypto');
const {photoBytes}=require('./raven-chat-routes');
const BUCKET='raven-trip-media';
const emails=value=>{try{const a=typeof value==='string'?JSON.parse(value):value;return Array.isArray(a)?a.map(v=>String(v).trim().toLowerCase()):[]}catch{return []}};
const deny=(status,message)=>{throw Object.assign(Error(message),{status})};
module.exports=function registerTravel(app,db,authenticate){
 const secret=process.env.RAVEN_TRAVEL_SECRET||randomBytes(32).toString('hex');
 const sign=data=>createHmac('sha256',secret).update(data).digest('base64url');
 const flightStatusCache=new Map(),FLIGHT_STATUS_TTL=60*1000;
 const flightNumber=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
 const validFlight=value=>/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(value);
 const FLIGHT_TITLE_META=/\s*\[\[raven:flight=([A-Z0-9]+)\]\]\s*$/i;
 const flightTitleMeta=value=>{const raw=String(value||''),match=raw.match(FLIGHT_TITLE_META);return {title:raw.replace(FLIGHT_TITLE_META,'').trim(),flight:match?flightNumber(match[1]):''}};
 const storedFlightTitle=(title,flight)=>{const clean=flightTitleMeta(title).title||'Flight '+flight;return clean+' [[raven:flight='+flight+']]'};
 const field=(row,...keys)=>keys.map(key=>row?.[key]).find(value=>value!==undefined&&value!==null&&String(value).trim()!=='')||'';
 const statusFor=value=>{const text=String(value||'').trim().toLowerCase();if(/cancel/.test(text))return {status:'cancelled',label:'Cancelled'};if(/delay/.test(text))return {status:'delayed',label:'Delayed'};if(/land|arriv|complete/.test(text))return {status:'landed',label:'Landed'};if(/en.?route|airborne|active|departed/.test(text))return {status:'live',label:'Live · airborne'};if(/sched|board|gate/.test(text))return {status:'scheduled',label:'Scheduled'};return {status:'unavailable',label:'Status unavailable'}};
 async function fetchFlightData(url){const controller=typeof AbortController==='function'?new AbortController():null,timer=controller?setTimeout(()=>controller.abort(),6000):null;try{return await fetch(url,controller?{signal:controller.signal}:undefined)}finally{if(timer)clearTimeout(timer)}}
 function normalizeAirLabs(payload,flight){const row=payload?.response||payload?.data?.[0]||payload?.data||payload;if(!row||typeof row!=='object'||Array.isArray(row))return null;const departure=field(row,'dep_iata','departure_iata')||field(row.departure||{},'iata','icao');const arrival=field(row,'arr_iata','arrival_iata')||field(row.arrival||{},'iata','icao');const state=statusFor(field(row,'status','flight_status'));return {available:true,flight:field(row,'flight_iata','flight_icao')||flight,status:state.status,label:state.label,departure:String(departure||'').toUpperCase(),arrival:String(arrival||'').toUpperCase(),departure_time:field(row,'dep_actual','dep_estimated','dep_time')||field(row.departure||{},'actual','estimated','scheduled'),arrival_time:field(row,'arr_actual','arr_estimated','arr_time')||field(row.arrival||{},'actual','estimated','scheduled'),gate:field(row,'dep_gate')||field(row.departure||{},'gate'),terminal:field(row,'dep_terminal')||field(row.departure||{},'terminal'),source:'AirLabs'};}
 function normalizeAdsb(payload,flight){const aircraft=Array.isArray(payload?.ac)?payload.ac.find(row=>flightNumber(row.flight)===flight)||payload.ac[0]:null;if(!aircraft)return null;const route=String(aircraft.route||'').trim(),parts=route.split(/[-–—>]/).map(value=>value.trim()).filter(Boolean);return {available:true,flight,status:'live',label:'Live · airborne',departure:parts[0]||'',arrival:parts[1]||'',route,updated_at:typeof aircraft.seen==='number'?new Date(Date.now()-Math.max(0,aircraft.seen)*1000).toISOString():'',source:'ADS-B'};}
 async function lookupFlight(flight){const now=Date.now(),cached=flightStatusCache.get(flight);if(cached&&now-cached.at<FLIGHT_STATUS_TTL)return {...cached.data,cached:true};let data=null;const airlabsKey=String(process.env.AIRLABS_API_KEY||'').trim();if(airlabsKey){try{const response=await fetchFlightData('https://airlabs.co/api/v9/flight?flight_iata='+encodeURIComponent(flight)+'&api_key='+encodeURIComponent(airlabsKey));if(response.ok)data=normalizeAirLabs(await response.json(),flight)}catch{}}
  if(!data){try{const response=await fetchFlightData('https://api.adsb.lol/v2/callsign/'+encodeURIComponent(flight));if(response.ok)data=normalizeAdsb(await response.json(),flight)}catch{}}
  if(!data)data={available:false,flight,status:'unavailable',label:'Live status unavailable',detail:airlabsKey?'Flight data is temporarily unavailable.':'Live aircraft status appears once this flight is broadcasting.',source:airlabsKey?'AirLabs':'ADS-B'};
  flightStatusCache.set(flight,{at:now,data});if(flightStatusCache.size>150)flightStatusCache.delete(flightStatusCache.keys().next().value);return data;
 }
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
 const run=fn=>async(req,res)=>{try{const user=fromPass(req)||await authenticate(req);if(!user)deny(401,'Open this trip from your Raven dashboard to reconnect securely.');res.set('Cache-Control','private, no-store');const scope=await access(req.params.id,user);await fn(req,res,user,scope)}catch(e){res.status(e.status||503).json({success:false,error:e.status?e.message:(req.body?.message||req.body?.gif_url||req.body?.photo_url)?'Could not send your message. Please retry.':'Travel uploads are not ready. Ask the owner to run the travel-storage setup, or retry later.'})}};
 app.post('/trips/:id/travel-pass',async(req,res)=>{try{const user=await authenticate(req);if(!user)deny(401,'Sign in required.');await access(req.params.id,user);const data=Buffer.from(JSON.stringify({trip:req.params.id,user:{id:user.id,email:user.email},exp:Date.now()+2*60*60*1000})).toString('base64url');res.set('Cache-Control','private, no-store');res.json({success:true,pass:data+'.'+sign(data)})}catch(e){res.status(e.status||503).json({success:false,error:e.status?e.message:'Could not connect travel plans.'})}});
 app.delete('/trips/:id/messages/:messageId',run(async(req,res,user,scope)=>{
  const rows=await result(db.from('trip_messages').delete().eq('trip_id',scope.trip.id).eq('id',req.params.messageId).eq('user_id',user.id).select('id'));
  if(!rows?.length)deny(404,'Message not found or it is not yours.');res.json({success:true});
 }));
 app.post('/trips/:id/messages',run(async(req,res,user,scope)=>{
  const message=String(req.body.message||'').trim(),gif=req.body.gif_url||null,photo=req.body.photo_url||null;
  if(!message&&!gif&&!photo)deny(400,'Write a message or select a GIF/photo.');
  if(message.length>10000)deny(400,'Message is too long.');
  if(gif&&(typeof gif!=='string'||gif.length>2048||!/^https:\/\//i.test(gif)))deny(400,'Choose a valid GIF.');
  if(photo)photoBytes(photo);
  const profile=await result(db.from('profiles').select('first_name,avatar_url').eq('id',user.id).maybeSingle());
  const row={trip_id:scope.trip.id,user_id:user.id,sender_name:profile?.first_name||'Member',avatar_url:profile?.avatar_url||null,message,gif_url:gif,photo_url:photo,created_at:new Date().toISOString()};
  const inserted=await result(db.from('trip_messages').insert(row).select('*').single());
  res.status(201).json({success:true,message:inserted});
 }));
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
 app.get('/trips/:id/flight-status',run(async(req,res)=>{
  const flight=flightNumber(req.query.flight);
  if(!validFlight(flight))deny(400,'Enter a flight number like AA100.');
  res.json({success:true,...await lookupFlight(flight)});
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
   const meta=row.kind==='flight'?flightTitleMeta(row.title):{title:row.title,flight:''};
   return {id:row.id,kind:row.kind,person_id:row.person_id,title:meta.title,flight_number:meta.flight,created_at:row.created_at,url:signed.signedUrl,can_remove:scope.owner||row.uploader_id===user.id};
  }));res.json({success:true,members,media,can_assign:scope.owner,hasMore:rows.length>50,nextOffset:offset+50});
 }));
 app.post('/trips/:id/travel',run(async(req,res,user,scope)=>{
  const kind=req.body.kind;let title=String(req.body.title||'').trim(),flight='';if(!['stay','flight','vehicle'].includes(kind))deny(400,'Choose Airbnb / stay, Flight or Vehicle.');
  let person=null;
  if(kind==='flight'){
   flight=flightNumber(req.body.flight_number);if(flight&&!validFlight(flight))deny(400,'Enter a flight number like AA100.');if(flight)title=storedFlightTitle(title,flight);
   person=req.body.person_id||user.id;
   if(!/^[0-9a-f-]{36}$/i.test(person))deny(400,'Choose a trip member.');
   if(person!==user.id&&!scope.owner)deny(403,'You can upload your own flight. Only the organizer can upload for another member.');
   const member=await result(db.from('profiles').select('email').eq('id',person).maybeSingle());
   if(!member||!scope.allowed.includes(String(member.email).toLowerCase()))deny(400,'That person is not linked to this trip.');
  }
  if(title.length>100)deny(400,'Use a title under 100 characters.');
  const photo=photoBytes(req.body.data_url),id=randomUUID(),path=scope.trip.id+'/'+id+'.'+photo.extension;
  await result(db.storage.from(BUCKET).upload(path,photo.bytes,{contentType:photo.mime,upsert:false}));
 try{await result(db.from('raven_trip_media').insert({id,trip_id:scope.trip.id,kind,person_id:person,uploader_id:user.id,title,object_path:path}))}
  catch(error){await db.storage.from(BUCKET).remove([path]);throw error}
  res.status(201).json({success:true});
 }));
 app.patch('/trips/:id/travel/:mediaId/flight',run(async(req,res,user,scope)=>{
  const row=await result(db.from('raven_trip_media').select('*').eq('trip_id',scope.trip.id).eq('id',req.params.mediaId).maybeSingle());
  if(!row)deny(404,'Flight upload not found.');
  if(row.kind!=='flight')deny(400,'Only flight uploads can be tracked.');
  const flight=flightNumber(req.body?.flight_number);
  if(!validFlight(flight))deny(400,'Enter a flight number like AA100.');
  // A flight number is shared trip information, so any linked member can
  // attach it to an older screenshot without changing the image itself.
  const title=storedFlightTitle(row.title,flight);
  await result(db.from('raven_trip_media').update({title}).eq('id',row.id).eq('trip_id',scope.trip.id));
  res.json({success:true,flight_number:flight});
 }));
 app.delete('/trips/:id/travel/:mediaId',run(async(req,res,user,scope)=>{
  const row=await result(db.from('raven_trip_media').select('*').eq('trip_id',scope.trip.id).eq('id',req.params.mediaId).maybeSingle());
  if(!row)deny(404,'Upload not found.');if(!scope.owner&&row.uploader_id!==user.id)deny(403,'Only the uploader or organizer can remove this.');
  await result(db.storage.from(BUCKET).remove([row.object_path]));
  await result(db.from('raven_trip_media').delete().eq('id',row.id).eq('trip_id',scope.trip.id));res.json({success:true});
 }));
};
module.exports.emails=emails;
