const assert=require('node:assert/strict');
const register=require('../raven-newsletter');
(async()=>{
 const routes={},writes=[],requests=[];let sub={email:'yes@example.invalid',enabled:true};
 const app={};for(const method of ['get','post','put'])app[method]=(url,...handlers)=>routes[method+' '+url]=handlers;
 const db={from(table){const q={select(){return q},eq(){return q},maybeSingle(){return Promise.resolve({data:sub})},update(v){writes.push({table,...v});return q},upsert(v){writes.push({table,...v});return q},then(resolve){return Promise.resolve({data:null}).then(resolve)}};return q},rpc:async()=>({data:[]})};
 const user={id:'test-user',email:'yes@example.invalid',email_confirmed_at:'2026-01-01'};
 const service=register(app,db,async req=>req.user,(_req,_res,next)=>next(),{SUPABASE_SERVICE_KEY:'test-secret',RESEND_API_KEY:'test-key'},async(url,opts)=>{requests.push({url,...opts});return {ok:true,json:async()=>({id:'provider-test'})}});
 async function call(route,req){let status=200,body;const res={status(n){status=n;return this},json(v){body=v;return this},send(v){body=v;return this},set(){return this}};await routes[route].at(-1)({query:{},body:{},...req},res);return {status,body};}
 assert.equal((await call('get /newsletter/preferences',{})).status,401);
 assert.equal((await call('put /newsletter/preferences',{user,body:{enabled:'true'}})).status,400);
 assert.equal((await call('put /newsletter/preferences',{user:{...user,email_confirmed_at:null},body:{enabled:true}})).status,400);
 assert.equal((await call('put /newsletter/preferences',{user,body:{enabled:true,source:'onboarding'}})).body.enabled,true);
 assert.equal(writes.at(-1).consent_source,'onboarding');
 const token=register.tokenFor(user.id,user.email,'test-secret');
 writes.length=0;
 assert.equal((await call('get /newsletter/unsubscribe',{query:{token}})).status,200);assert.equal(writes.length,0,'link scanner GET cannot unsubscribe');
 assert.equal((await call('post /newsletter/unsubscribe',{query:{token}})).status,200);assert.equal(writes[0].enabled,false);
 writes.length=0;assert.equal((await call('post /newsletter/unsubscribe',{query:{token:token+'x'}})).status,400);assert.equal(writes.length,0);
 sub.email='new@example.invalid';await call('post /newsletter/unsubscribe',{query:{token}});assert.equal(writes.length,0,'old-email token cannot suppress new address');
 await service.send({campaign_id:'issue1',user_id:user.id,email:user.email});
 const request=requests[0],body=JSON.parse(request.body);assert.equal(request.headers['Idempotency-Key'],'newsletter:issue1:test-user');assert.equal(body.reply_to,'support@ravensplit.com');assert.ok(body.headers['List-Unsubscribe'].includes('/newsletter/unsubscribe?token='));assert.equal(body.headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');assert.ok(body.html.includes('1624 Broadway'));assert.ok(!body.html.includes('{{'));
 console.log('PASS: auth, consent, GET safety, one-click opt-out, tamper rejection, address changes, delivery headers and dedup key');
})().catch(e=>{console.error(e);process.exit(1)});
