'use strict';
const issues=require('./raven-newsletter-issues');
const BASE='https://raven-backend-production-fb1f.up.railway.app';
const checked=async q=>{
 const controller=new AbortController();let timer;
 try{const {data,error}=await Promise.race([typeof q.abortSignal==='function'?q.abortSignal(controller.signal):q,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Newsletter storage timeout'))},15000)})]);if(error)throw Error('Newsletter storage unavailable');return data}
 finally{clearTimeout(timer)}
};
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function payload(row,tokenFor,secret){
 const url=BASE+'/newsletter/unsubscribe?token='+encodeURIComponent(tokenFor(row.user_id,row.email,secret));
 if(!row.content?.subject||!row.content?.html?.includes('{{UNSUBSCRIBE_URL}}')||!row.content?.text?.includes('{{UNSUBSCRIBE_URL}}'))throw Error('Approved newsletter content unavailable');
 return {from:'RAVEN <support@ravensplit.com>',to:[row.email],reply_to:'support@ravensplit.com',subject:row.content.subject,
 html:row.content.html.replaceAll('{{UNSUBSCRIBE_URL}}',escape(url)),text:row.content.text.replaceAll('{{UNSUBSCRIBE_URL}}',url),
 headers:{'List-Unsubscribe':'<'+url+'>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}};
}
function failure(status,body,headers){
 const name=String(body?.name||'');const quota=['daily_quota_exceeded','monthly_quota_exceeded'].includes(name);
 const retry=!quota&&(status===429||status>=500||name==='concurrent_idempotent_requests');
 const safe=['daily_quota_exceeded','monthly_quota_exceeded','rate_limit_exceeded','invalid_idempotent_request','concurrent_idempotent_requests','restricted_api_key','suspended_api_key'].includes(name)?name:'provider_http_'+status;
 return {outcome:retry?'retry':'failed',error:safe,retrySeconds:Math.min(3600,Math.max(60,Number(headers?.get?.('retry-after'))||60)),stop:quota||status===401||status===403};
}
module.exports=function registerWeekly(app,db,admin,env,fetcher,tokenFor,{sleep=ms=>new Promise(r=>setTimeout(r,ms)),catalog=issues.approved,log=console.warn}={}){
 const secret=env.RAVEN_NEWSLETTER_SECRET||env.SUPABASE_SERVICE_KEY;let busy=false,lastWarning=0;
 const rpc=(name,args)=>checked(db.rpc(name,args));
 const configured=()=>!!(secret&&env.RESEND_API_KEY);
 app.get('/admin/newsletter/status',admin,async(_req,res)=>{
  res.set('Cache-Control','private, no-store');try{
   const status=await rpc('raven_newsletter_weekly_status');
   res.json({success:true,...status,configured:configured(),timezone:'America/New_York',day:'Monday',time:'10:00',approved_issues:catalog().map(({id,subject})=>({id,subject}))});
  }catch{res.status(503).json({success:false,error:'Weekly newsletter setup or status is unavailable. No automatic activation occurred.'})}
 });
 async function finish(row,outcome,provider=null,error=null,retrySeconds=60){
  return rpc('raven_newsletter_weekly_finish',{p_run:row.run_id,p_user:row.user_id,p_lease:row.lease,p_outcome:outcome,p_provider:provider,p_error:error,p_retry_seconds:retrySeconds});
 }
 async function deliver(row){
  const args={p_run:row.run_id,p_user:row.user_id,p_lease:row.lease};
  if(!await rpc('raven_newsletter_weekly_allowed',args)){await finish(row,'skipped',null,'consent_or_identity_changed');return true}
  // Persist the exact provider request before sending. A restart/secret/content change
  // cannot alter the body under the same 24-hour provider idempotency key.
  let request=row.request_payload;
  if(!request){
   try{request=payload(row,tokenFor,secret)}catch{await finish(row,'failed',null,'invalid_content');return false}
   const stored=await checked(db.from('raven_newsletter_weekly_deliveries').update({request_payload:request}).eq('run_id',row.run_id).eq('user_id',row.user_id).eq('lease',row.lease).eq('status','sending').select('user_id'));
   if(!stored?.length)return false;
  }
  if(!await rpc('raven_newsletter_weekly_allowed',args)){await finish(row,'skipped',null,'consent_or_identity_changed');return true}
  let response,body;
  try{
   response=await fetcher('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.RESEND_API_KEY,'Idempotency-Key':'newsletter-weekly:'+row.run_id+':'+row.user_id},body:JSON.stringify(request)});
   body=await response.json().catch(()=>({}));
  }catch{await finish(row,'retry',null,'network_or_timeout',Math.min(1800,60*2**row.attempts));return true}
  if(response.ok&&typeof body?.id==='string'&&body.id){await finish(row,'sent',body.id);return true}
  // A success without a provider ID is ambiguous, not a confirmed send.
  const result=response.ok?{outcome:'retry',error:'unconfirmed_provider_response',retrySeconds:120}:failure(response.status,body,response.headers);
  await finish(row,result.outcome,null,result.error,Math.max(result.retrySeconds,Math.min(1800,60*2**row.attempts)));
  if(result.stop){await checked(db.from('raven_newsletter_schedule').update({last_error:result.error,next_claim_at:new Date(Date.now()+3600000).toISOString()}).eq('id','weekly'));return false}
  return true;
 }
 async function tick(){
  if(busy||!configured())return;busy=true;
  try{
   await rpc('raven_newsletter_weekly_sync',{p_content:catalog()});
   for(let i=0;i<20;i++){
    const row=await rpc('raven_newsletter_weekly_claim');if(!row)break;
    if(!await deliver(row))break;
    await sleep(1100);
   }
  }catch{if(Date.now()-lastWarning>300000){log('[newsletter-weekly] Scheduler unavailable; no unconfirmed delivery is marked sent.');lastWarning=Date.now()}}
  finally{busy=false}
 }
 return {tick,deliver};
};
module.exports.payload=payload;module.exports.failure=failure;
