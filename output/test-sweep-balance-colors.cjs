'use strict';
// Real rendered Trip Hub + deterministic calculation engine. All requests mocked.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {renderTrip}=require('./test-trip-custom-page.cjs');
const E=require('../raven-sweep-explain');
const S=require('../raven-sweep');
const trip={id:'TEST',share_token:'token',invite_token:'invite',name:'Balance color test',people:['Andrew','Blair','Casey'],simple_split:true,settled_people:{},sweep_payments:[]};
const receipts=[
  {id:1,name:'Airbnb',total:300,paid_by:'Andrew',splits:{Blair:100,Casey:100}},
  {id:2,name:'Rental car',total:90,paid_by:'Blair',splits:{Andrew:30,Casey:30}},
  {id:3,name:'Activity',total:40,paid_by:'Casey',splits:{Blair:20}}
];
const contextSnapshot=JSON.stringify({trip,receipts});
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true});
  const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.isNavigationRequest())return route.fulfill({contentType:'text/html; charset=utf-8',body:await renderTrip(trip,receipts)});
   if(request.resourceType()==='script')return route.fulfill({contentType:'application/javascript',body:''});
   if(request.resourceType()==='stylesheet')return route.fulfill({contentType:'text/css',body:''});
   if(request.method()==='POST')requests.push({path:url.pathname,body:request.postDataJSON()});
   if(url.pathname.endsWith('/ravenbot')){
    const body=request.postDataJSON();
    return route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,breakdown:E.breakdown(E.describe(trip,receipts),body.person)})});
   }
   return route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,data:[],profiles:[],comments:[],messages:[],total:0})});
  });
  await page.goto('https://balance-colors.test/trip/TEST?t=token&app=1&name=Casey');
  async function open(name){
   await page.locator('#row-person-'+name+' .sweep-balance-open').click();
   await page.locator('#sweep-balance-dialog [data-receipt-role]').first().waitFor();
  }
  async function roles(){return page.locator('#sweep-balance-dialog [data-receipt-role]').evaluateAll(cards=>cards.map(card=>card.dataset.receiptRole));}
  async function close(){await page.getByRole('button',{name:'Close balance breakdown',exact:true}).click();}
  await open('Andrew');
  assert.deepEqual(await roles(),['paid','included','excluded'],'viewed person overrides viewer; payer takes precedence over own share');
  const cards=page.locator('#sweep-balance-dialog [data-receipt-role]');
  assert.deepEqual(await cards.evaluateAll(cards=>cards.map(card=>getComputedStyle(card).backgroundColor)),['rgba(48, 209, 88, 0.08)','rgba(168, 85, 247, 0.08)','rgba(170, 164, 183, 0.04)']);
  for(const [index,label] of ['Paid by Andrew','Included in split','Not included'].entries())assert.ok((await cards.nth(index).innerText()).includes(label),'visible non-color status');
  const legend=page.getByRole('group',{name:'Receipt color legend for Andrew',exact:true});
  assert.equal(await legend.count(),1);
  assert.equal(await legend.getByText('Paid by Andrew',{exact:true}).count(),1);
  assert.equal(await legend.getByText('Included in split',{exact:true}).count(),1);
  assert.equal(await legend.getByText('Not included',{exact:true}).count(),1);
  assert.ok(await legend.evaluate(el=>!!(el.previousElementSibling.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING)&&el.previousElementSibling.dataset.receiptRole==='excluded'),'legend is directly under receipt list');
  for(const width of [320,390,768]){
   await page.setViewportSize({width,height:844});
   assert.ok(await page.locator('#sweep-balance-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),'dialog fits '+width+'px');
   assert.ok(await cards.evaluateAll(cards=>cards.every(el=>el.scrollWidth<=el.clientWidth)),'cards fit '+width+'px');
   assert.ok(await legend.evaluate(el=>el.scrollWidth<=el.clientWidth),'legend wraps at '+width+'px');
  }
  await page.setViewportSize({width:390,height:1000});
  await page.locator('#sweep-balance-dialog').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:'output/sweep-balance-colors-mobile.png'});
  await legend.scrollIntoViewIfNeeded();
  await page.screenshot({path:'output/sweep-balance-colors-legend.png'});
  await close();await open('Blair');
  assert.deepEqual(await roles(),['included','paid','included'],'switching balance changes roles');
  await close();
  assert.equal(JSON.stringify({trip,receipts}),contextSnapshot,'opening balances does not mutate financial input');
  receipts.push({id:4,name:'Paid for others',total:30,paid_by:'Andrew',splits:{Blair:15,Casey:15}});
  await open('Andrew');
  assert.equal((await roles())[3],'paid','payer with zero own share remains green');
  assert.match(await page.locator('[data-receipt-role]').nth(3).innerText(),/\$0.00/);
  await close();
  const plan=S.build(trip,receipts),payment=Object.entries(plan.payoutsByPerson.Blair)[0];
  trip.sweep_payments=S.record(trip,receipts,{name:'Blair',to:payment[0],amount:payment[1],expected_version:plan.version});
  await open('Blair');assert.deepEqual(await roles(),['included','paid','included','included'],'settlements never change receipt participation colors');await close();
  receipts[0].name='<img src=x onerror="alert(1)">'+('Long receipt name '.repeat(15));
  await page.setViewportSize({width:320,height:844});await open('Andrew');
  assert.equal(await page.locator('#sweep-balance-dialog img').count(),0,'receipt names remain escaped text');
  assert.ok(await page.locator('#sweep-balance-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),'long name does not overflow');
  await close();
  receipts.length=0;await page.reload();await page.locator('#row-person-Andrew .sweep-balance-open').click();
  await page.getByText('No receipts have been added.',{exact:true}).waitFor();
  assert.equal(await page.locator('.sweep-receipt-legend').count(),0,'empty list has no orphan legend');
  assert.equal(requests.filter(r=>/mark-settled|sweep-payment|edit-receipt/.test(r.path)).length,0,'no financial writes');
  assert.deepEqual(errors,[]);
  console.log('PASS balance receipt colors: selected person, payer priority including zero share, included/excluded, settled receipts, readable labels/legend, 320/390/768px layout, escaped long names, empty state and no financial writes. All network mocked.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
