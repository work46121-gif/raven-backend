'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const badge = require('../raven-plus-badge');
const { renderTrip } = require('./test-trip-custom-page.cjs');
const server = fs.readFileSync('Server.js','utf8');
const dashboardPath = fs.existsSync('dashboard.html') ? 'dashboard.html' : '../account-release-site/dashboard.html';
const dashboard = fs.readFileSync(dashboardPath,'utf8');
const profiles = [
 ['dd58ecef-0b94-4c53-ac39-ddf573ad1efb','melad','Mel'],
 ['0bba9a50-82f8-4a15-bc41-91654eef06f2','t','Andrew'],
 ['b72054bd-964c-483f-8f89-876fd0581f80','arsalan','Arsalan'],
 ['739d2182-437d-488a-99b8-1acb004b3163','will','Will'],
 ['2b98cc1d-257b-4254-b589-98319cce1cb4','nicholas110','Nicholas']
].map(([id,raven_id,first_name])=>({id,raven_id,first_name,email:raven_id+'@example.invalid',last_name:'Fixture'}));
const trip={id:'TEST',share_token:'token',invite_token:'invite',name:'Wingcheck QA',people:profiles.map(p=>p.first_name),member_emails:profiles.map(p=>p.email),creator_email:profiles[0].email,settled_people:{},simple_split:true,sweep_payments:[]};
const receipts=[{id:1,name:'Dinner fixture',total:50,paid_by:'Mel',splits:{Andrew:10,Arsalan:10,Will:10,Nicholas:10},items:[],created_at:'2026-10-20'}];
const helper = fs.readFileSync('raven-plus-badge.js','utf8');
function syntax(html) { for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) if(!/src=|application\/(?:ld\+)?json/.test(m[1]))new vm.Script(m[2]); }
async function renderBill(live) {
 let handler, output;
 const bill={id:'TEST',share_token:'token',name:'Badge bill fixture',creator_phone:profiles[0].email,paid_by:'Mel',total:20,live_mode:live};
 const participants=[{id:1,name:'Mel',phone:profiles[0].email,amount:0,paid:true},{id:2,name:'Andrew',phone:profiles[1].email,amount:10,paid:false},{id:3,name:'Will',phone:'guest:will',amount:10,paid:false}];
 const data={bills:[bill],participants,profiles:structuredClone(profiles),receipt_items:[],item_selections:[]};
 const db={from(table){let single=false;const filters=[];const q={select(){return q},eq(k,v){if(k!=='bill_id')filters.push(r=>r[k]===v);return q},ilike(k,v){filters.push(r=>String(r[k]).toLowerCase()===v.toLowerCase());return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},or(s){const parts=s.split(',').map(p=>p.split('.eq.'));filters.push(r=>parts.some(([k,v])=>r[k]===v));return q},order(){return q},single(){single=true;return q},maybeSingle(){single=true;return q},then(resolve,reject){let rows=(data[table]||[]).filter(r=>filters.every(fn=>fn(r)));return Promise.resolve({data:single?rows[0]||null:rows,error:null}).then(resolve,reject)}};return q}};
 const req=p=>p.startsWith('./')?require('../'+p.slice(2)):require(p);req.resolve=p=>require.resolve('../'+p.slice(2));
 const context={app:{get:(path,fn)=>{handler=fn}},supabase:db,require:req,process:{env:{}},Buffer,URLSearchParams,console,
 RavenQuantities:require('../raven-quantities'),canonicalizeBillParticipantState:async(id,participants,selections)=>({participants,selections}),billParticipantKey:s=>String(s).trim().toLowerCase(),normalizeBillParticipantName:s=>s,chooseCanonicalBillParticipantName:n=>n[0]};
 const start=server.indexOf("app.get('/bill/:billId',");
 const end=server.indexOf('// Helper: compute outstanding balance',start);
 vm.runInNewContext(server.slice(start,end),context);
 const response={setHeader(){},status(){return this},send(html){output=html;return this}};
 await handler({params:{billId:'TEST'},query:{t:'token',app:'1'},headers:{}},response);
 assert.ok(output&&!output.includes('Fallback bill view'),'full bill route renders');
 syntax(output);return output;
}
(async()=>{
 for(const p of profiles) { assert.ok(badge.isMember(p)); assert.ok(badge.html(p).includes('RAVEN Plus Member')); }
 for(const p of [null,{}, {first_name:'Mel'}, {raven_id:'melad'}, {id:'new-account',raven_id:'melad'}, {id:'not-a-member',raven_id:'t'}, {id:'"><script>alert(1)</script>'}]) {assert.equal(badge.isMember(p),false);assert.equal(badge.html(p),'');}
 assert.ok(badge.isMember({...profiles[0],raven_id:'renamed'}),'badge follows selected account, not reusable handle');
 syntax(dashboard);
 const before=JSON.stringify({trip,receipts,profiles});
 const tripHTML=await renderTrip(trip,receipts,[],server,{profiles});
 assert.equal(JSON.stringify({trip,receipts,profiles}),before,'render preserves all records');
 const guestHTML=await renderTrip({...trip,people:['Will'],member_emails:[],creator_email:'unrelated@example.invalid'},[],[],server,{profiles});
 assert.equal(JSON.parse(guestHTML.match(/<script id="page-data" type="application\/json">([\s\S]*?)<\/script>/)[1]).plusBadgeProfilesByMember.Will,undefined,'unlinked first-name match gets no badge');
 const explicitHTML=await renderTrip({...trip,people:['@t'],member_emails:[],creator_email:''},[],[],server,{profiles});
 assert.equal(JSON.parse(explicitHTML.match(/<script id="page-data" type="application\/json">([\s\S]*?)<\/script>/)[1]).plusBadgeProfilesByMember['@t'].id,profiles[1].id,'one-character explicit handle works');
 const classic=await renderBill(false),live=await renderBill(true);
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true});
  const errors=[],mutations=[];let html=tripHTML;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const r=route.request();
   if(r.isNavigationRequest())return route.fulfill({contentType:'text/html; charset=utf-8',body:html});
   if(r.method()!=='GET')mutations.push(r.url());
   if(r.resourceType()==='script')return route.fulfill({contentType:'application/javascript',body:''});
   if(r.resourceType()==='stylesheet')return route.fulfill({contentType:'text/css',body:''});
   if(r.url().includes('/bill/TEST/state'))return route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,bill:{paid_by:'Mel',total:20},items:[],selections:[],participants:[{id:1,name:'Mel',amount:0},{id:2,name:'Andrew',amount:10},{id:3,name:'Will',amount:10}]})});
   return route.fulfill({contentType:'application/json',body:'{"success":true,"comments":[],"messages":[],"profiles":[],"data":[],"total":0}'});
  });
  await page.goto('https://badge.test/trip/TEST?t=token&app=1');
  assert.equal(await page.locator('[data-trip-member-name] [data-raven-plus-badge]').count(),5);
  const first=page.locator('#row-person-Mel [data-raven-plus-badge]').first();
  await first.click();
  assert.equal(await page.getByRole('dialog',{name:'RAVEN Plus Member',exact:true}).isVisible(),true);
  assert.equal(await page.locator('#member-profile-modal').evaluate(el=>el.classList.contains('open')),false,'tap does not open underlying profile');
  await page.keyboard.press('Escape');assert.equal(await first.evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Enter');assert.equal(await page.getByRole('dialog',{name:'RAVEN Plus Member',exact:true}).isVisible(),true);
  await page.getByRole('button',{name:'Close membership information',exact:true}).click();
  await page.evaluate(()=>openMemberProfile('Mel'));
  assert.equal(await page.locator('#mp-name [data-raven-plus-badge]').count(),1);
  await page.locator('#mp-name [data-raven-plus-badge]').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#member-profile-modal').evaluate(el=>el.classList.contains('open')),true,'Escape closes badge info, not the profile');
  await page.evaluate(()=>closeMemberProfile());
  for(const width of [320,390,768]){
   await page.setViewportSize({width,height:844});
   assert.equal(await page.locator('[data-raven-plus-badge]').evaluateAll(nodes=>nodes.some(n=>n.parentElement.closest('button'))),false,'no nested buttons');
   await first.click();
   const box=await page.locator('#raven-plus-info').boundingBox();
   assert.ok(box.x>=0&&box.x+box.width<=width&&box.y>=0&&box.y+box.height<=844,'popover fits '+width);
   await page.keyboard.press('Escape');
   assert.ok(await page.locator('[data-trip-member-row]').evaluateAll(rows=>rows.every(r=>r.scrollWidth<=r.clientWidth)),'member rows fit '+width);
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('#row-person-Mel').evaluate(el=>el.scrollIntoView({block:'start'}));
  await page.screenshot({path:'output/raven-plus-trip-mobile.png'});
  await first.click();await page.screenshot({path:'output/raven-plus-tap-mobile.png'});
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('[id="receipt-0"] [data-raven-plus-badge]').count()>0,'receipt payer and shares have badges');
  // Classic bill uses exact stored account identities, never the guest's name.
  html=classic;await page.goto('https://badge.test/bill/TEST?t=token&app=1');
  assert.equal(await page.locator('#prow-1 [data-raven-plus-badge]').count(),1);
  assert.equal(await page.locator('#prow-2 [data-raven-plus-badge]').count(),1);
  assert.equal(await page.locator('#prow-3 [data-raven-plus-badge]').count(),0);
  await page.locator('#prow-2 [data-raven-plus-badge]').click();
  assert.equal(await page.getByRole('dialog',{name:'RAVEN Plus Member',exact:true}).isVisible(),true);
  html=live;await page.goto('https://badge.test/bill/TEST?t=token&app=1');
  await page.waitForFunction(()=>document.querySelectorAll('#owes-list [data-raven-plus-badge]').length===2);
  // Exercise the actual dashboard participant-name fragment and mount behavior.
  const identityLine=dashboard.split(/\r?\n/).find(l=>l.includes('? \'<span class="raven-plus-identity"'));
  assert.ok(identityLine);
  const expression=identityLine.trim().slice(2);
  const identity=vm.runInNewContext(expression,{index:0,participantAvatar:'<span>A</span>',participantProfile:profiles[1],paymentMethod:'',escapeHtml:s=>s,window:{RavenPlusBadge:badge}});
  html='<!doctype html><meta name="viewport" content="width=device-width"><style>body{background:#06060a;color:white;font:16px sans-serif;padding:20px}.bill-participant-profile{background:transparent;border:0;color:white;font:inherit}</style><script>'+helper+'</script><div id="outer">'+identity+'</div><div id="name">Fixture</div><button id="outside" style="margin-top:150px">Outside</button><script>window.opens=0;document.getElementById("outer").onclick=()=>window.opens++</script>';
  await page.goto('https://badge.test/dashboard.html');
  assert.equal(await page.locator('button button').count(),0);
  await page.locator('[data-raven-plus-badge]').click();assert.equal(await page.evaluate(()=>window.opens),0);
  await page.locator('#outside').click();assert.equal(await page.locator('#raven-plus-info').isVisible(),false);
  await page.evaluate(p=>{RavenPlusBadge.mount(document.getElementById('name'),p,'profile');RavenPlusBadge.mount(document.getElementById('name'),p,'profile')},profiles[0]);
  assert.equal(await page.locator('#name [data-raven-plus-badge]').count(),1,'rerender deduplicates');
  await page.evaluate(()=>RavenPlusBadge.mount(document.getElementById('name'),{id:'not-a-member'}));
  assert.equal(await page.locator('#name [data-raven-plus-badge]').count(),0,'switching accounts removes old badge');
  assert.deepEqual(mutations,[],'badge performs no writes or payment requests');
  assert.deepEqual(errors,[],'no browser errors');
  console.log('PASS: five stable account assignments; no name/handle impersonation; guest exclusion; one-character ID; trip, receipt and profile integration; classic/live bill rendering; dashboard name fragment; tap/keyboard/Escape/outside dismissal; no nested buttons; 320/390/768px layout; no mutations.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
