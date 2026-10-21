'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#08080e;color:#efedf4;font:14px Arial;padding:16px;--green:#30d158;--muted2:#b4acc5;--muted:#999;--border:#ffffff20}button{background:transparent;color:#c49bff;border:1px solid #c49bff55;border-radius:8px}</style>'}));
  await page.goto('https://newsletter.test');
  const source=fs.readFileSync('../account-release-site/dashboard.html','utf8'),html=source.match(/<section aria-labelledby="newsletter-admin-heading"[\s\S]*?<\/section>/)[0],start=source.indexOf('async function loadNewsletterAdminStatus()'),end=source.indexOf('async function openRavenStudentsPreview',start);
  assert.ok(end>start);
  await page.evaluate(html=>document.body.insertAdjacentHTML('beforeend',html),html);
  await page.addScriptTag({content:"var ravenAdminAccess=true,currentUser={id:'owner'};function escapeHtml(s){return String(s).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]))}var response={schedule:{enabled:true,next_run_at:'2026-10-26T14:00:00Z',last_checked_at:new Date().toISOString()},configured:true,eligible_subscribers:14,approved_issues:[{id:'tip'}],runs:[{id:'2026-10-19',subject:'Check your split <img src=x onerror=alert(1)>',scheduled_at:'2026-10-19T14:00:00Z',status:'needs_attention',accepted:10,pending:0,failed:4,skipped:0,errors:['daily_quota_exceeded']}]};async function ravenAdminRequest(){return response};"+source.slice(start,end)});
  await page.evaluate(()=>loadNewsletterAdminStatus());
  await page.getByText('Enabled',{exact:true}).waitFor();assert.match(await page.locator('#newsletter-admin-status').innerText(),/Oct 26, 2026, 10:00 AM EDT/);assert.equal(await page.locator('#newsletter-admin-status img').count(),0,'campaign strings are escaped');
  for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.ok(await page.locator('section').evaluate(e=>e.scrollWidth<=e.clientWidth),'fits '+width)}
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/newsletter-weekly-admin.png',fullPage:true});
  await page.evaluate(async()=>{response.schedule.enabled=false;await loadNewsletterAdminStatus()});await page.getByText('Paused',{exact:true}).waitFor();
  await page.evaluate(async()=>{ravenAdminRequest=async()=>{throw Error('offline')};await loadNewsletterAdminStatus()});await page.getByText(/Newsletter status is unavailable/).waitFor();
  await page.evaluate(async()=>{ravenAdminRequest=async()=>{currentUser={id:'different'};return response};await loadNewsletterAdminStatus()});assert.equal(await page.locator('#newsletter-admin-status').innerText(),'');assert.deepEqual(errors,[]);
  const all=require('../raven-newsletter-issues').all();for(const issue of all){await page.setContent(issue.html.replaceAll('{{UNSUBSCRIBE_URL}}','https://example.invalid/unsubscribe'));assert.equal(await page.locator('h1').count(),1);assert.equal(await page.locator('a').filter({hasText:'Unsubscribe'}).count(),1);assert.equal(await page.locator('script').count(),0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth))}
  await page.screenshot({path:'output/newsletter-weekly-email.png',fullPage:true});
  console.log('PASS weekly UI: 320/390/768px admin status, next Eastern send, aggregate errors, safe HTML, pause/offline/account switch and all email templates on mobile. Synthetic only.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
