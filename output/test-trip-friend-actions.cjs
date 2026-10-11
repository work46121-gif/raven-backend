const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),register=require('../raven-trip-travel');
const user={id:'11111111-1111-4111-8111-111111111111',email:'one@test.invalid'},peer={id:'22222222-2222-4222-8222-222222222222',email:'two@test.invalid'};
let signedIn=true,linked=true,status='none',writes=0,fail=false;const routes={};
const db={from(table){let inserted=false;const q={select(){return q},eq(){return q},maybeSingle(){return q},or(){return q},insert(row){assert.equal(row.user_id,user.id);assert.equal(row.friend_id,peer.id);inserted=true;writes++;return q},then(resolve){resolve({error:inserted&&fail?{message:'failed'}:null,data:table==='trips'?{id:'T',creator_email:user.email,member_emails:linked?[peer.email]:[]}:table==='profiles'?peer:status==='none'?[]:[{status}]})}};return q}};
register({get:(p,h)=>routes['GET '+p]=h,post:(p,h)=>routes['POST '+p]=h,patch(){},delete:(p,h)=>routes['DELETE '+p]=h},db,async()=>signedIn?user:null);
async function call(){let code=200,body;const res={set(){},status(c){code=c;return res},json(b){body=b}};await routes['POST /trips/:id/friend-request']({params:{id:'T'},headers:{},body:{raven_id:'two'}},res);return {code,body}}
(async()=>{
 signedIn=false;assert.equal((await call()).code,401);assert.equal(writes,0);
 signedIn=true;linked=false;assert.equal((await call()).code,404);assert.equal(writes,0);
 linked=true;status='pending';assert.equal((await call()).body.status,'pending');assert.equal(writes,0);
 status='accepted';assert.equal((await call()).body.status,'accepted');assert.equal(writes,0);
 status='none';assert.equal((await call()).body.success,true);assert.equal(writes,1);
 fail=true;assert.equal((await call()).code,503);
 const source=fs.readFileSync('Server.js','utf8'),nav=source.slice(source.indexOf('function tripOpenDashboard('),source.indexOf('async function tripRequestFriend('));
 for(const [referrer,expected] of [['capacitor://localhost/','capacitor://localhost/dashboard.html'],['capacitor://localhost/dashboard.html','capacitor://localhost/dashboard.html'],['https://ravensplit.com/dashboard.html','https://ravensplit.com/dashboard.html'],['https://evil.test/dashboard.html','https://ravensplit.com/dashboard.html']]){
  let target='';const ctx={URL,URLSearchParams,document:{referrer},location:{search:'?app=1',assign:v=>target=v}};
  vm.runInNewContext(nav+';tripOpenDashboard("https://ravensplit.com/dashboard.html?dm_friend=abc")',ctx);
  assert.equal(target.split('?')[0],expected);assert.ok(target.includes('app=1')&&target.includes('dm_friend=abc'));
 }
 const profile=source.slice(source.indexOf('function openMemberProfile('),source.indexOf('function closeMemberProfile('));
 assert.ok(!profile.includes('window.open('),'no external browser windows from friend/profile actions');
 console.log('PASS friend actions: signed-in linked members only, existing/pending requests, save failure, no Safari popup, trusted local dashboard route, no untrusted redirects.');
})().catch(e=>{console.error(e);process.exitCode=1});
