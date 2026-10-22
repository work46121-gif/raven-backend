'use strict';
// Local synthetic browser QA. Every browser network request is intercepted.
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const html=require('../raven-plus-server').previewHtml();
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{requests.push(route.request().url());return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'});});
  await page.setContent(html);await page.getByRole('heading',{name:'One upgrade. The whole trip.'}).waitFor();
  assert.match(await page.locator('#price').innerText(),/5\.99/);
  await page.getByRole('button',{name:'Annual'}).click();assert.match(await page.locator('#price').innerText(),/39\.99/);assert.match(await page.locator('#price-note').innerText(),/once a year/);assert.equal(await page.locator('#annual').getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'Monthly',exact:true}).click();assert.match(await page.locator('#price').innerText(),/5\.99/);
  for(const [scenario,tier] of [['active','RAVEN Plus trip'],['cancelled','RAVEN Plus trip'],['expired','Standard trip'],['removed','Standard trip'],['refunded','Standard trip'],['sandbox','Standard trip']]){
   await page.locator('#scenario').selectOption(scenario);assert.equal(await page.locator('#trip-label').innerText(),tier);assert.ok((await page.locator('#demo-status').innerText()).length>35);
  }
  await page.locator('#scenario').selectOption('active');
  for(const width of [320,390,768,1280]){
   await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no horizontal overflow at '+width);
   assert.ok(await page.locator('main').evaluate(e=>e.scrollWidth<=e.clientWidth));
  }
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/plus-preview-mobile.png',fullPage:true});
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'output/plus-preview-desktop.png',fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('form').count(),0);assert.equal(await page.locator('a[href]').count(),0,'no checkout or outbound purchase links');assert.equal(requests.length,0,'self-contained preview makes zero network requests');
  await page.close();
  const admin=await browser.newPage({viewport:{width:390,height:844}});admin.on('pageerror',e=>errors.push(e.message));await admin.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'}));await admin.goto('https://synthetic.invalid');
  const source=fs.readFileSync('../account-release-site/dashboard.html','utf8'),section=source.match(/<section aria-labelledby="plus-pilot-heading"[\s\S]*?<\/section>/)[0],start=source.indexOf('async function openRavenPlusPreview()'),end=source.indexOf('let ravenAdminProfile',start);assert.ok(end>start);
  await admin.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#09080e;color:#fff;padding:16px;font:14px Arial;--green:#36dd86;--muted2:#b4adbf;--purple3:#c4a0ff;--border:#ffffff20}button{padding:12px}</style>'+section);
  await admin.evaluate(html=>{window.previewFixture=html;},html);
  await admin.addScriptTag({content:"var currentUser={id:'owner'},ravenAdminAccess=true,calls=0,fail=false,swap=false,toasts=[];function showToast(m){toasts.push(m)}async function ravenAdminRequest(path,options){if(path!=='/admin/plus/preview')throw Error('unexpected');calls++;if(fail)throw Error('offline');if(swap)currentUser={id:'different'};return{html:previewFixture};}"+source.slice(start,end)});
  await admin.getByRole('button',{name:'Explore Plus'}).click();await admin.getByRole('dialog').waitFor();assert.equal(await admin.locator('iframe').getAttribute('sandbox'),'allow-scripts');assert.equal(await admin.locator('iframe').getAttribute('referrerpolicy'),'no-referrer');
  await admin.frameLocator('iframe').getByRole('button',{name:'Annual'}).click();assert.match(await admin.frameLocator('iframe').locator('#price').innerText(),/39\.99/);
  await admin.getByRole('button',{name:'Back to Admin'}).click();assert.equal(await admin.locator('dialog').count(),0);assert.equal(await admin.evaluate(()=>document.activeElement.id),'plus-pilot-open');
  await admin.evaluate(async()=>{ravenAdminAccess=false;await openRavenPlusPreview()});assert.equal(await admin.evaluate(()=>calls),1,'non-admin cannot initiate preview request');
  await admin.evaluate(async()=>{ravenAdminAccess=true;swap=true;await openRavenPlusPreview()});assert.equal(await admin.locator('dialog').count(),0,'account changed during request discards result');
  await admin.evaluate(async()=>{currentUser={id:'owner'};swap=false;fail=true;await openRavenPlusPreview()});assert.ok((await admin.evaluate(()=>toasts)).at(-1).includes('unavailable'));assert.equal(await admin.locator('#plus-pilot-open').isDisabled(),false);
  await admin.evaluate(async()=>{fail=false;await openRavenPlusPreview()});await admin.getByRole('dialog').waitFor();await admin.evaluate(()=>{currentUser=null});await admin.waitForFunction(()=>!document.querySelector('dialog'));
  assert.deepEqual(errors,[]);
  console.log('PASS Plus UI: responsive 320/390/768/1280px, prices and annual billing, six lifecycle scenarios, zero preview network requests, no checkout, owner-only loading, sandboxed dialog, close/focus, account switch/sign-out and offline recovery. Synthetic only.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
