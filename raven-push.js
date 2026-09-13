// Private iOS alert delivery. Disabled until Apple credentials and the SQL migration are installed.
const http2 = require('node:http2');
const crypto = require('node:crypto');
const TEXT = {bill:'You were added to a bill.',trip:'You were added to a trip.',dm:'You have a new message.',group:'You have a new group message.'};
let cachedProvider, cachedAt=0, cachedKey, appleClient, appleHost;
function configured(env) {return env.RAVEN_PUSH_ENABLED==='1'&&!!(env.APNS_KEY_ID&&env.APNS_TEAM_ID&&env.APNS_PRIVATE_KEY);}
function providerToken(env) {
 const key=env.APNS_KEY_ID+env.APNS_TEAM_ID+env.APNS_PRIVATE_KEY;
 if(cachedProvider&&cachedKey===key&&Date.now()-cachedAt<3000000)return cachedProvider;
 const head=Buffer.from(JSON.stringify({alg:'ES256',kid:env.APNS_KEY_ID})).toString('base64url');
 const body=Buffer.from(JSON.stringify({iss:env.APNS_TEAM_ID,iat:Math.floor(Date.now()/1000)})).toString('base64url');
 const input=head+'.'+body;
 const signature=crypto.sign('sha256',Buffer.from(input),{key:env.APNS_PRIVATE_KEY.replace(/\\n/g,'\n'),dsaEncoding:'ieee-p1363'}).toString('base64url');
 cachedKey=key;cachedAt=Date.now();cachedProvider=input+'.'+signature;return cachedProvider;
}
function sendApple(env,token,event) {
 return new Promise((resolve,reject)=>{
  const host=env.APNS_ENVIRONMENT==='sandbox'?'https://api.sandbox.push.apple.com':'https://api.push.apple.com';
  if(!appleClient||appleClient.closed||appleClient.destroyed||appleHost!==host){
   appleClient?.destroy();appleHost=host;appleClient=http2.connect(host);
   appleClient.on('error',()=>appleClient?.destroy());appleClient.on('goaway',()=>appleClient?.close());
  }
  const client=appleClient;
  let finished=false;
  const onError=e=>finish(e);
  const finish=(err,value)=>{if(finished)return;finished=true;clearTimeout(timer);client.off('error',onError);err?reject(err):resolve(value)};
  let stream;
  const timer=setTimeout(()=>{stream?.close();finish(Error('APNs timeout'))},15000);
  client.once('error',onError);
  try {
   stream=client.request({':method':'POST',':path':'/3/device/'+token,authorization:'bearer '+providerToken(env),'apns-topic':'com.ravensplit.app','apns-push-type':'alert','apns-priority':'10','apns-expiration':String(Math.floor(Date.now()/1000)+3600),'apns-collapse-id':event.id});
   let status=0,body='';stream.on('response',headers=>status=headers[':status']);stream.on('data',chunk=>body+=chunk);
   stream.on('error',e=>finish(e));stream.on('end',()=>{let reason;try{reason=JSON.parse(body).reason}catch{}finish(null,{status,reason})});
   stream.end(JSON.stringify({aps:{alert:{title:'RAVEN',body:TEXT[event.kind]},sound:'default'},kind:event.kind,source_id:event.source_id,recipient_id:event.user_id}));
  } catch(error){finish(error)}
 });
}
module.exports=function registerPush(app,db,authenticate,env=process.env,send=sendApple) {
 const run=fn=>async(req,res)=>{try{const user=await authenticate(req);if(!user)return res.status(401).json({success:false,error:'Sign in required.'});res.set('Cache-Control','private, no-store');await fn(req,res,user)}catch{res.status(503).json({success:false,error:'Phone notifications are not ready. Please retry later.'})}};
 app.get('/push/status',run(async(req,res)=>res.json({success:true,enabled:configured(env)})));
 app.post('/push/device',run(async(req,res,user)=>{
  if(!configured(env))return res.status(503).json({success:false,error:'Phone notifications are awaiting activation.'});
  const token=String(req.body.token||'').toLowerCase();if(!/^[0-9a-f]{64,200}$/.test(token))return res.status(400).json({success:false,error:'Invalid device.'});
  // authenticate() has already verified this bearer token with Supabase.
  const jwt=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  const session=JSON.parse(Buffer.from(jwt.split('.')[1],'base64url')).session_id;
  if(!/^[0-9a-f-]{36}$/i.test(session||''))return res.status(400).json({success:false,error:'Please sign in again.'});
  const {error}=await db.from('raven_push_devices').upsert({token,user_id:user.id,session_id:session,updated_at:new Date().toISOString()});if(error)throw error;
  res.json({success:true});
 }));
 app.delete('/push/device',run(async(req,res,user)=>{
  const {error}=await db.from('raven_push_devices').delete().eq('token',String(req.body.token||'').toLowerCase()).eq('user_id',user.id);if(error)throw error;res.json({success:true});
 }));
 let busy=false;
 async function tick(){if(busy||!configured(env))return;busy=true;
  try {
   const {data:events,error}=await db.rpc('raven_claim_phone_alerts');if(error)throw error;
   for(const event of events||[]){
    let retry=false;
    const {data:devices,error:lookupError}=await db.from('raven_push_devices').select('token,updated_at').eq('user_id',event.user_id);if(lookupError)throw lookupError;
    await Promise.all((devices||[]).map(async device=>{
     // Opting in now must not deliver activity from before that registration.
     if(device.updated_at>event.created_at)return;
     try{const r=await send(env,device.token,event);
      if(r.status===410||r.reason==='BadDeviceToken'||r.reason==='Unregistered')await db.from('raven_push_devices').delete().eq('token',device.token).eq('user_id',event.user_id);
      else if(r.status!==200)retry=true;
     }catch{retry=true}
    }));
    const {error:saveError}=await db.from('raven_push_events').update({done:!retry,available_at:new Date(Date.now()+60000*Math.min(30,2**event.attempts)).toISOString()}).eq('id',event.id).eq('lease',event.lease);if(saveError)throw saveError;
   }
  }catch{console.warn('[push] Delivery pending; check notification migration and APNs configuration.')}finally{busy=false}
 }
 const timer=setInterval(tick,15000);timer.unref();return {tick,stop:()=>clearInterval(timer)};
};
module.exports.providerToken=providerToken;
module.exports.configured=configured;
