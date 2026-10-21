// Email marketing is independent of transactional bill and account emails.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const BASE = 'https://raven-backend-production-fb1f.up.railway.app';
const ISSUE = '2026-10-12-adjustable-shares';
const SUBJECT = 'Your trip. Your split. Meet adjustable shares in RAVEN';
const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function tokenFor(user, email, secret) {
 const data=Buffer.from(JSON.stringify([user,email.toLowerCase()])).toString('base64url');
 return data+'.'+crypto.createHmac('sha256',secret).update('newsletter-unsubscribe:'+data).digest('base64url');
}
function readToken(token, secret) {
 try {const [data,signature,...extra]=String(token).split('.');if(extra.length||!data||!signature)return null;
 const expected=crypto.createHmac('sha256',secret).update('newsletter-unsubscribe:'+data).digest();
 const actual=Buffer.from(signature,'base64url');if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))return null;
 const pair=JSON.parse(Buffer.from(data,'base64url').toString());return Array.isArray(pair)&&pair.length===2&&pair.every(v=>typeof v==='string')?pair:null;
 }catch{return null;}
}
function render(unsubscribe) {
 return fs.readFileSync(path.join(__dirname,'raven-newsletter-template.html'),'utf8').replaceAll('{{UNSUBSCRIBE_URL}}',escape(unsubscribe));
}
module.exports=function registerNewsletter(app,db,authenticate,admin,env=process.env,fetcher=fetch) {
 const weekly=require('./raven-newsletter-weekly')(app,db,admin,env,fetcher,tokenFor);
 const secret=env.RAVEN_NEWSLETTER_SECRET||env.SUPABASE_SERVICE_KEY;
 const checked=async q=>{const {data,error}=await q;if(error)throw Error('Newsletter database unavailable');return data;};
 const link=(id,email)=>BASE+'/newsletter/unsubscribe?token='+encodeURIComponent(tokenFor(id,email,secret));
 async function send(row,test=false) {
  const url=link(row.user_id,row.email);
  const response=await fetcher('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(20000),headers:{
   'Content-Type':'application/json',Authorization:'Bearer '+env.RESEND_API_KEY,
   'Idempotency-Key':(test?'newsletter-preview:':'newsletter:')+row.campaign_id+':'+row.user_id
  },body:JSON.stringify({from:'RAVEN <support@ravensplit.com>',to:[row.email],reply_to:'support@ravensplit.com',
   subject:(test?'[PREVIEW] ':'')+SUBJECT,html:render(url),
   text:'Not every bill needs an equal split. Adjust each person’s Trip Hub receipt share by percentage or dollar amount. For a $600 car booking, one person can pay $300 and the other two $150 each. Open your trip, add or edit a receipt, choose Adjust split, review and save. https://ravensplit.com/dashboard.html\nRAVEN does not transfer money.\nYou opted into RAVEN Email Updates.\nRAVEN, 1624 Broadway, New Hyde Park, NY 11040\nsupport@ravensplit.com\nUnsubscribe: '+url,
   headers:{'List-Unsubscribe':'<'+url+'>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}
  })});
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.id)throw Error('Newsletter delivery was not confirmed');
  return result.id;
 }
 app.post('/newsletter/prompt',async(req,res)=>{try{
  const user=await authenticate(req);if(!user)return res.status(401).json({success:false});
  const show=await checked(db.rpc('raven_claim_newsletter_prompt',{p_user:user.id}));
  res.json({success:true,show:show===true});
 }catch{res.status(503).json({success:false,show:false});}});
 app.get('/newsletter/preferences',async(req,res)=>{try{
  const user=await authenticate(req);if(!user)return res.status(401).json({success:false});
  const row=await checked(db.from('raven_newsletter_subscribers').select('enabled,email').eq('user_id',user.id).maybeSingle());
  res.json({success:true,enabled:!!row?.enabled&&row.email===String(user.email||'').toLowerCase()});
 }catch{res.status(503).json({success:false,error:'Newsletter preferences are temporarily unavailable.'});}});
 app.put('/newsletter/preferences',async(req,res)=>{try{
  const user=await authenticate(req);if(!user)return res.status(401).json({success:false});
  if(typeof req.body?.enabled!=='boolean')return res.status(400).json({success:false,error:'Choose on or off.'});
  if(req.body.enabled&&!user.email_confirmed_at)return res.status(400).json({success:false,error:'Confirm your email before subscribing.'});
  const enabled=req.body.enabled,now=new Date().toISOString();
  // Keep older clients in sync before updating the authoritative subscription.
  await checked(db.from('profiles').update({privacy_email_marketing:enabled}).eq('id',user.id));
  await checked(db.from('raven_newsletter_subscribers').upsert({user_id:user.id,email:String(user.email).toLowerCase(),enabled,
   consent_source:['onboarding','monthly_prompt'].includes(req.body.source)?req.body.source:'settings',consent_at:enabled?now:null,updated_at:now},{onConflict:'user_id'}));
  res.json({success:true,enabled});
 }catch{res.status(503).json({success:false,error:'Could not save your newsletter choice. Please try again.'});}});
 const unsubscribePage=(body)=>'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>RAVEN newsletter</title><body style="background:#09090f;color:#eee;font:18px Arial;padding:40px;line-height:1.6"><main style="max-width:480px;margin:auto"><h1>RAVEN</h1>'+body+'</main></body>';
 app.get('/newsletter/unsubscribe',(req,res)=>{
  if(!secret||!readToken(req.query.token,secret))return res.status(400).send(unsubscribePage('<p>This unsubscribe link is invalid.</p>'));
  res.set('Referrer-Policy','no-referrer');res.set('Cache-Control','no-store');
  res.send(unsubscribePage('<p>Turn off weekly feature emails? Your bill reminders and account emails won’t change.</p><form method="post"><input type="hidden" name="token" value="'+escape(req.query.token)+'"><button style="padding:14px">Unsubscribe</button></form>'));
 });
 app.post('/newsletter/unsubscribe',async(req,res)=>{try{
  const pair=secret&&readToken(req.query.token||req.body?.token,secret);
  if(!pair)return res.status(400).send(unsubscribePage('<p>This unsubscribe link is invalid.</p>'));
  const sub=await checked(db.from('raven_newsletter_subscribers').select('email').eq('user_id',pair[0]).maybeSingle());
  if(sub?.email===pair[1]){
   await checked(db.from('raven_newsletter_subscribers').update({enabled:false,updated_at:new Date().toISOString()}).eq('user_id',pair[0]).eq('email',pair[1]));
   await checked(db.from('profiles').update({privacy_email_marketing:false}).eq('id',pair[0]));
  }
  res.set('Cache-Control','no-store').send(unsubscribePage('<h2>You’re unsubscribed.</h2><p>You can turn the newsletter back on in RAVEN Settings.</p>'));
 }catch{res.status(503).send(unsubscribePage('<p>We couldn’t save that. Please try again.</p>'));}});
 app.post('/admin/newsletter/preview',admin,async(req,res)=>{try{
  if(!secret||!env.RESEND_API_KEY)throw Error('not configured');
  const id=await send({campaign_id:ISSUE,user_id:req.ravenAdmin.id,email:req.ravenAdmin.email},true);
  res.json({success:true,provider_id:id});
 }catch{res.status(503).json({success:false,error:'Preview delivery was not confirmed.'});}});
 app.post('/admin/newsletter/send',admin,async(req,res)=>{try{
  if(req.body?.campaign!==ISSUE||req.body?.confirm!==true)return res.status(400).json({success:false});
  await checked(db.from('raven_newsletter_campaigns').update({status:'queued'}).eq('id',ISSUE).eq('status','draft'));
  res.json({success:true});void tick();
 }catch{res.status(503).json({success:false});}});
 let busy=false;
 async function tick(){
  if(busy||!secret||!env.RESEND_API_KEY)return;
  busy=true;
  try{
   const rows=await checked(db.rpc('raven_newsletter_claim'));
   for(const row of rows||[]){
    // Unknown/unapproved content is never sent. Re-check consent immediately before delivery.
    const sub=await checked(db.from('raven_newsletter_subscribers').select('enabled,email').eq('user_id',row.user_id).maybeSingle());
    if(row.campaign_id!==ISSUE||!sub?.enabled||sub.email!==row.email){await checked(db.from('raven_newsletter_deliveries').update({status:'skipped'}).eq('campaign_id',row.campaign_id).eq('user_id',row.user_id));continue;}
    try{const provider=await send(row);await checked(db.from('raven_newsletter_deliveries').update({status:'sent',provider_id:provider,sent_at:new Date().toISOString()}).eq('campaign_id',row.campaign_id).eq('user_id',row.user_id));}
    catch{await checked(db.from('raven_newsletter_deliveries').update({status:'failed'}).eq('campaign_id',row.campaign_id).eq('user_id',row.user_id));}
    await new Promise(resolve=>setTimeout(resolve,650));
   }
  }catch{console.warn('[newsletter] Delivery check unavailable; no automatic resend.');}finally{busy=false;}
 }
 const run=async()=>{await weekly.tick();await tick()};
 const timer=setInterval(run,60000);timer.unref?.();
 const startup=setTimeout(run,5000);startup.unref?.();
 return {tick,send,weekly,stop(){clearInterval(timer);clearTimeout(startup)}};
};
module.exports.tokenFor=tokenFor;module.exports.readToken=readToken;module.exports.render=render;
