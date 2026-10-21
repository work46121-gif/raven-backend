'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const site='../account-release-site/',dashboard=fs.readFileSync(site+'dashboard.html','utf8');
const start=dashboard.indexOf('async function openBillModal(billId) {');
const preview=dashboard.slice(start,dashboard.indexOf('async function findAssignableRavenProfile',start));
new vm.Script(preview);
for(const m of dashboard.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/src=|application\/(?:ld\+)?json/.test(m[1]))new vm.Script(m[2]);
const setup=`
window.actions=[];let currentBillId=null,ravenAdminAccess=false,currentUser={id:'owner',email:'owner@example.invalid'};
const fixture={id:'B',name:'Dinner with friends',creator_phone:currentUser.email,share_token:'fixture-token',total:26.74,paid_by:'Test',participants:[{id:1,name:'Mel',phone:'mel@example.invalid',amount:26.74,paid:false},{id:2,name:'Test',phone:'unknown_test_B',amount:0,paid:true}]};
const member={id:'dd58ecef-0b94-4c53-ac39-ddf573ad1efb',raven_id:'melad',first_name:'Mel'};
const db={from(table){const q={select(){return q},eq(){return q},single(){return q},then(fn){return Promise.resolve({data:table==='bills'?structuredClone(fixture):[],error:null}).then(fn)}};return q}};
const cleanupBillPreviewDuplicates=async(id,parts)=>parts,dedupeBillPreviewParticipants=parts=>parts,billPreviewParticipantKey=n=>String(n).toLowerCase(),normalizeBillPreviewParticipantName=n=>n;
const resolveActiveBillParticipantProfiles=async()=>({Mel:member}),activeBillParticipantAvatar=()=>'<span style="display:flex;align-items:center;justify-content:center;flex:0 0 28px;width:28px;height:28px;border-radius:50%;background:#373042">M</span>';
function escapeHtml(s){const el=document.createElement('span');el.textContent=String(s);return el.innerHTML.replace(/"/g,'&quot;')}
const openProfileModal=p=>actions.push('profile'),assignBillParticipantRavenId=()=>actions.push('assign'),removeParticipantFromBillPreview=()=>actions.push('remove'),openPayModal=()=>actions.push('pay'),unmarkPaidFromDashboard=()=>actions.push('undo'),viewBillPage=()=>{},shareBillLink=()=>{},shareViewOnlyBillLink=()=>{},sendReminder=()=>{},deleteBill=()=>{},addPersonToBill=()=>{};
RavenGuestPaymentUI.init({backend:'https://fixture.invalid',session:async()=>({data:{session:{user:currentUser,access_token:'fixture-auth'}}})});
document.querySelectorAll('body > *').forEach(el=>{if(el.id!=='bill-modal'&&el.tagName!=='SCRIPT')el.style.display='none'});
`;
const html=dashboard.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')+['raven-plus-badge.js','raven-guest-payments.js','raven-guest-payments-client.js'].map(n=>'<script>'+fs.readFileSync(site+n,'utf8')+'</script>').join('')+'<script>'+setup+preview+'</script>';
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],writes=[];
 let methods={venmo:'old_guest'},fail=false;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const req=route.request(),url=req.url();
  if(req.isNavigationRequest())return route.fulfill({contentType:'text/html',body:html});
  if(url.endsWith('/guest-payment-methods/2'))return route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,participant:{id:2,name:'Test',guest_identity:'unknown_test_B'},methods})});
  if(url.endsWith('/guest-payment-methods')){
   const body=req.postDataJSON();writes.push({body,headers:req.headers()});
   if(!fail)methods=body.entries[0].methods;
   return route.fulfill({status:fail?503:200,contentType:'application/json',body:JSON.stringify(fail?{success:false,error:'Could not save. Try again.'}:{success:true})});
  }
  return route.abort();
 });
 await page.goto('https://fixture.invalid/dashboard');await page.evaluate(()=>openBillModal('B'));
 const rows=page.locator('.bill-preview-person'),badge=rows.first().locator('[data-raven-plus-badge]');
 assert.equal(await rows.count(),2);assert.equal(await page.locator('[data-guest-payment-index]').count(),1);
 assert.equal(await rows.getByRole('button',{name:'Remove',exact:true,includeHidden:true}).count(),2);
 assert.equal(await rows.getByRole('button',{name:'Remove',exact:true,includeHidden:true}).first().isVisible(),false,'management hidden by default');
 for(const width of [320,390,768]){
  await page.setViewportSize({width,height:844});
  assert.ok(await rows.evaluateAll(rows=>rows.every(el=>el.scrollWidth<=el.clientWidth)),'no row overflow at '+width);
  const rects=await rows.first().evaluate(row=>{const rect=s=>{const r=row.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,top:r.top,bottom:r.bottom}};return {name:rect('.bill-participant-profile .participant-name'),badge:rect('[data-raven-plus-badge]'),image:rect('[data-raven-plus-badge] img'),status:rect('.bill-preview-status')}});
  assert.equal(rects.image.width,18);assert.equal(rects.badge.width,24,'small icon keeps accessible tap target');
  assert.ok(rects.image.left>=rects.name.right&&rects.image.left-rects.name.right<=5,'icon close without overlap');
  assert.ok(rects.badge.right<=rects.status.left||rects.badge.bottom<=rects.status.top,'badge and payment status do not overlap');
 }
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/bill-preview-clean-mobile.png'});
 await badge.click();assert.ok(await page.getByRole('dialog',{name:'RAVEN Plus Member',exact:true}).isVisible());assert.deepEqual(await page.evaluate(()=>actions),[]);await page.keyboard.press('Escape');
 await rows.first().locator('.bill-participant-profile').click();assert.deepEqual(await page.evaluate(()=>actions),['profile']);
 await rows.first().locator('summary').click();await rows.first().getByRole('button',{name:'Change RAVEN ID'}).click();assert.deepEqual(await page.evaluate(()=>actions),['profile','assign']);await rows.first().locator('summary').click();
 const toggle=page.getByRole('button',{name:'Payment details',exact:true});await toggle.click();
 const venmo=page.getByRole('textbox',{name:'Test Venmo ID',exact:true}),cash=page.getByRole('textbox',{name:'Test Cash App',exact:true}),apple=page.getByRole('textbox',{name:'Test Apple Pay number',exact:true});
 await venmo.waitFor();assert.equal(await venmo.inputValue(),'old_guest');
 await venmo.fill('@guest_demo');await cash.fill('$GuestDemo');await apple.fill('+1 (555) 123-4567');
 await page.getByRole('button',{name:'Save payment details',exact:true}).click();await page.getByText('Payment details saved.',{exact:true}).waitFor();
 assert.deepEqual(methods,{venmo:'guest_demo',cashapp:'GuestDemo',applepay:'+15551234567'});
 assert.deepEqual(writes[0].body,{entries:[{name:'Test',participant_id:2,guest_identity:'unknown_test_B',methods}]});
 assert.equal(writes[0].headers.authorization,'Bearer fixture-auth');assert.equal(writes[0].headers['x-raven-bill-token'],'fixture-token');
 await page.locator('.bill-guest-editor').scrollIntoViewIfNeeded();await page.screenshot({path:'output/bill-preview-guest-editor-mobile.png'});
 for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.ok(await rows.evaluateAll(rows=>rows.every(el=>el.scrollWidth<=el.clientWidth)),'editor fits '+width)}
 await page.getByRole('button',{name:'Close details',exact:true}).click();await toggle.click();assert.equal(await venmo.inputValue(),'guest_demo','editor reloads saved values');
 fail=true;await venmo.fill('retry_guest');await page.getByRole('button',{name:'Save payment details',exact:true}).click();await page.getByText('Could not save. Try again.',{exact:true}).waitFor();assert.equal(await venmo.inputValue(),'retry_guest');assert.equal(await venmo.isEnabled(),true);
 fail=false;await page.getByRole('button',{name:'Save payment details',exact:true}).click();await page.getByText('Payment details saved.',{exact:true}).waitFor();
 await venmo.fill('');await cash.fill('');await apple.fill('');await page.getByRole('button',{name:'Save payment details',exact:true}).click();await page.getByText('Payment details saved.',{exact:true}).waitFor();assert.deepEqual(methods,{});
 const count=writes.length;await venmo.fill('javascript:evil');await page.getByRole('button',{name:'Save payment details',exact:true}).click();assert.equal(writes.length,count,'invalid handles never submitted');
 await venmo.fill('valid_guest');await page.evaluate(()=>currentUser={id:'other',email:'other@example.invalid'});await page.getByRole('button',{name:'Save payment details',exact:true}).click();await page.getByText('Sign in with the bill creator’s account to retry.',{exact:true}).waitFor();assert.equal(writes.length,count,'session changes cannot save');
 await page.evaluate(()=>openBillModal('B'));assert.equal(await page.locator('[data-guest-payment-index]').count(),0,'editor not offered to other viewer');
 await page.evaluate(()=>{currentUser={id:'owner',email:'owner@example.invalid'};member.raven_id='a_very_long_raven_id';fixture.participants[1].name='An extraordinarily long guest display name';return openBillModal('B')});
 await page.setViewportSize({width:320,height:844});assert.ok(await rows.evaluateAll(rows=>rows.every(el=>el.scrollWidth<=el.clientWidth)),'long names stay contained');
 assert.equal(await page.evaluate(()=>fixture.total),26.74);assert.deepEqual(await page.evaluate(()=>fixture.participants.map(p=>p.amount)),[26.74,0]);assert.deepEqual(errors,[]);
 console.log('PASS: production preview rendering at 320/390/768px; compact adjacent badge; separate profile/badge actions; Manage controls; guest edit/prefill/save/clear/retry; auth session guard; no balance changes.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
