'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const site='../account-release-site/',d=fs.readFileSync(site+'dashboard.html','utf8');
const helper=n=>fs.readFileSync(site+n,'utf8');
function between(start,end,last=false){const i=last?d.lastIndexOf(start):d.indexOf(start);assert.ok(i>=0,start);return d.slice(i,d.indexOf(end,i+start.length));}
const render=between('function cbRenderPeople() {','function cbAddItem()');
const create=between('async function cbCreateFinalBill() {','// ─── NOTIFICATIONS');
const profile=between('function openProfileModal(p) {','function closeProfileModal()',true);
const pay=between('async function openPayModal(','function cbToggleOtherMethods()');
const script=render+'\n'+create+'\n'+profile+'\n'+pay;
new vm.Script(script);
for(const m of d.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/src=|application\/(?:ld\+)?json/.test(m[1]))new vm.Script(m[2]);
const ids=['cb-people-chips','cb-guest-payment-details','profile-modal','pm-name','pm-raven-id','pm-raven-score','pm-avatar','pm-action-btn','pm-payment-methods','pay-modal-amount','pay-modal-methods','cb-pay-modal','pay-modal-title','pay-modal-sub','pending'];
let markup='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:20px;background:#09080e;color:#eee;font:14px Arial;--muted2:#aaa;--purple3:#ca9ff5;--border:#333;--green:#25d05b}input,select{padding:12px;background:#15131e;border:1px solid #38313f;border-radius:10px;color:#eee}button{padding:10px;color:#eee;background:#282031;border:1px solid #534267;border-radius:9px}#pm-name{font-size:24px;margin-top:20px}.person-tag{display:inline-flex;gap:8px;margin:6px}#cb-pay-modal{flex-direction:column}.pay-method-row{display:block;padding:14px;margin:8px 0;color:#fff}#pm-action-btn button{max-width:100%}</style>'+ids.map(id=>'<div id="'+id+'"></div>').join('')+'<select id="cb-paidby"><option>Guest</option></select><input id="cb-name" value="Guest test"><button id="cb-final-btn">Create Bill</button>';
markup=markup.replace('<!doctype html>','<!doctype html><meta charset="utf-8">');
markup+=['raven-plus-badge.js','raven-guest-payments.js','raven-guest-payments-client.js'].map(n=>'<script>'+helper(n)+'</script>').join('');
markup+='<script>'+`window.writes=[];window.toasts=[];window.opens=[];window.saves=0;window.failSave=true;
let cbPeople=['Guest','@t'],cbKnownProfilesByName={},cbItems=[],cbImageBase64=null,cbSplitMode='even',cbLiveMode=false,cbLivePeopleCount=2,cbScannedReceiptTotal=null,cbReceiptNeedsReview=false,_cbActiveTripId=null,_cbActiveTripName='',cbChargeSplits={};
let currentUser={id:'owner',email:'owner@example.invalid'},payModalParticipantId=null,payModalBillId=null,payModalMethodOptions=[],_profileModalData=null;
const avatarGradients=['purple'];
const db={from(table){const q={select(){return q},eq(){return q},ilike(){return q},or(){return q},insert(rows){writes.push({table,rows});return q},update(){throw Error('Unexpected update')},single(){return q},maybeSingle(){return q},then(fn){return Promise.resolve({data:table==='bills'?{name:'Guest test',paid_by:'Guest',share_token:'token'}:table==='participants'?{name:'Guest',phone:'unknown_guest'}:null,error:null}).then(fn)}};return q}};
RavenGuestPaymentUI.init({backend:'https://guest.test',session:async()=>({data:{session:{user:currentUser,access_token:'fixture'}}})});
const cbIsKnownRavenUser=n=>n==='@t',cbRemovePerson=n=>{},cbEvenSubtotal=()=>20,cbComputePersonAmounts=()=>({'Guest':10,'@t':10}),findAssignableRavenProfile=async()=>({email:'linked@example.invalid'}),cbValidateStep1=()=>true,cbValidateStep2=()=>true,generateId=()=> 'B',cbGoToStep=()=>{},celebrateBillCreated=()=>{},cbClearPhoto=()=>{},cbRenderItems=()=>{},cbUpdateSummary=()=>{},loadAllData=()=>{},showPage=()=>{},hideProfileInlinePicker=()=>{},payModalBuildMethodOptions=()=>[],buildApplePayHref=n=>'sms:'+n,showToast=(...x)=>toasts.push(x),openBillModal=async id=>{opens.push(id);RavenGuestPaymentUI.renderPending(document.getElementById('pending'),id)};
`+script+'</script>';
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});try{
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async route=>{const req=route.request();if(req.isNavigationRequest())return route.fulfill({contentType:'text/html',body:markup});requests.push({url:req.url(),method:req.method(),body:req.postData()});if(req.url().endsWith('/guest-payment-methods'))return route.fulfill({status:await page.evaluate(()=>failSave)?503:200,contentType:'application/json',body:JSON.stringify(await page.evaluate(()=>failSave)?{success:false,error:'Retry saving'}:{success:true})});if(req.url().endsWith('/guest-payer'))return route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,profile:{first_name:'Guest',venmo:'guest_demo',cashapp:'GuestDemo',applepay:'+15551234567',guest_payment_details:true}})});return route.abort()});
await page.goto('https://guest.test/dashboard.html');await page.evaluate(()=>cbRenderPeople());
assert.equal(await page.locator('#cb-guest-payment-details details').count(),1,'only plain guests get editors');
await page.getByText('Guest · Payment details',{exact:true}).click();
await page.getByRole('textbox',{name:'Guest Venmo ID',exact:true}).fill('@guest_demo');await page.getByRole('textbox',{name:'Guest Cash App',exact:true}).fill('$GuestDemo');await page.getByRole('textbox',{name:'Guest Apple Pay number',exact:true}).fill('+1 (555) 123-4567');
await page.evaluate(()=>cbRenderPeople());await page.getByText('Guest · Payment details',{exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'Guest Venmo ID',exact:true}).inputValue(),'@guest_demo','rerender preserves drafts');
for(const width of [320,390,768]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'guest fields fit '+width)}
await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/guest-payment-form-mobile.png'});
await page.evaluate(()=>cbCreateFinalBill());await page.waitForFunction(()=>opens.length===1);
assert.equal(await page.getByRole('button',{name:'Retry saving guest payment details'}).isVisible(),true);
assert.equal(await page.evaluate(()=>writes.filter(w=>w.table==='bills').length),1);
await page.evaluate(()=>failSave=false);await page.getByRole('button',{name:'Retry saving guest payment details'}).click();await page.waitForFunction(()=>!RavenGuestPaymentUI.hasPending('B'));
assert.equal(await page.evaluate(()=>writes.filter(w=>w.table==='bills').length),1,'retry never recreates bill');
const rows=await page.evaluate(()=>writes.find(w=>w.table==='participants').rows);assert.equal(rows[0].phone,'unknown_guest_B');assert.equal(rows[1].phone,'linked@example.invalid');assert.deepEqual(rows.map(p=>p.amount),[10,10]);
const saves=requests.filter(r=>r.url.endsWith('/guest-payment-methods'));assert.equal(saves.length,2);assert.equal(saves[0].body,saves[1].body,'retry same data');
await page.evaluate(()=>openPayModal(2,'B',10));assert.ok(await page.getByText(/Guest details · added/).isVisible());assert.equal(await page.locator('a[href^="venmo:"]').count(),1);assert.equal(await page.locator('a[href^="https://cash.app/"]').count(),1);assert.equal(await page.locator('a[href^="sms:"]').count(),1);
await page.evaluate(()=>openProfileModal({id:'dd58ecef-0b94-4c53-ac39-ddf573ad1efb',raven_id:'melad',first_name:'Mel',last_name:'Fixture'}));
assert.equal(await page.locator('#pm-name [data-raven-plus-badge]').count(),1);assert.equal(await page.locator('#pm-name [data-raven-creator]').count(),1);assert.equal(await page.locator('#pm-raven-score [data-raven-creator]').count(),0);
await page.locator('#pm-name [data-raven-plus-badge]').click();assert.equal(await page.getByRole('dialog',{name:'RAVEN Plus Member',exact:true}).isVisible(),true);await page.keyboard.press('Escape');
await page.locator('#profile-modal').evaluate(el=>el.scrollIntoView());await page.screenshot({path:'output/creator-profile-mobile.png'});
await page.evaluate(()=>openProfileModal({id:'wrong',raven_id:'melad',first_name:'Not the creator'}));assert.equal(await page.locator('#pm-name [data-raven-creator]').count(),0);
assert.deepEqual(errors,[]);
// Verify the actual production modal styling as well as the isolated flow.
markup=d.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')+'<script>'+helper('raven-plus-badge.js')+'</script><script>let _profileModalData=null;const avatarGradients=["linear-gradient(135deg,#6f3eea,#24cc64)"],hideProfileInlinePicker=()=>{};'+profile+'</script>';
await page.goto('https://guest.test/profile-preview');
await page.evaluate(()=>{document.querySelectorAll('body > *').forEach(el=>{if(el.id!=='profile-modal'&&el.tagName!=='SCRIPT')el.style.display='none'});openProfileModal({id:'dd58ecef-0b94-4c53-ac39-ddf573ad1efb',raven_id:'melad',first_name:'Mel',last_name:'N'});});
for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.ok(await page.locator('#pm-name').evaluate(el=>el.scrollWidth<=el.clientWidth),'profile badge fits '+width)}
await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/creator-profile-mobile.png'});
console.log('PASS: actual dashboard guest creation/payment/profile functions, optional fields, mobile layout, normalized persistence, failed-save retry without duplicate bill, unchanged split amounts, guest pay links, Plus/Creator identity and tap behavior.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
