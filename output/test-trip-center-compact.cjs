const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict'),{renderTrip}=require('./test-trip-custom-page.cjs');
const U='11111111-1111-4111-8111-111111111111',png='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="240"><rect width="180" height="240" fill="#30233e"/><text x="15" y="80" fill="#ded0f0" font-size="20">Trip plan</text></svg>');
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});try{
 const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors=[];let rows=[{id:1,kind:'flight',person_id:U,title:'Outbound flight',flight_number:'AA2099',url:png,can_remove:true},{id:2,kind:'activity',title:'Saturday · Canyon tour',url:png,can_remove:true}],writes=0;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const req=route.request();if(req.isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#08080d;color:white;font:16px Arial"><button id="trip-travel-action">Trip Center</button></body>'});
 if(req.url().includes('flight-status'))return route.fulfill({contentType:'application/json',body:JSON.stringify({label:'Live status unavailable',detail:'Live status appears when the flight is broadcasting.'})});
 if(req.method()==='DELETE'){writes++;rows=rows.filter(r=>r.id!==2)}
 return route.fulfill({contentType:'application/json',body:JSON.stringify({members:[{id:U,first_name:'Alex'}],media:rows,can_assign:true,hasMore:false})});});
 await page.goto('https://compact.test');await page.addScriptTag({content:`var TRIP_ID='TEST',BACKEND='https://api.test';function initChatDb(){return Promise.resolve()}var chatDb={auth:{getSession:async()=>({data:{session:{access_token:'test',user:{id:'${U}'}}}})}};`});await page.addScriptTag({content:fs.readFileSync('raven-travel-ui.js','utf8')});await page.getByRole('button',{name:'Trip Center',exact:true}).click();await page.locator('.travel-media').first().waitFor();
 assert.equal(await page.getByLabel('Upload type').isVisible(),false);assert.equal(await page.getByRole('button',{name:'Refresh status'}).isVisible(),false);
 await page.screenshot({path:'output/trip-center-compact-preview.png'});
 await page.locator('.travel-flight-disclosure summary').click();await page.getByRole('button',{name:'Refresh status'}).click();await page.getByText('Live status unavailable',{exact:true}).waitFor();
 await page.getByRole('button',{name:'View Outbound flight'}).click();assert.equal(await page.getByRole('dialog',{name:'Screenshot preview'}).isVisible(),true);await page.getByRole('button',{name:'Close preview'}).click();
 await page.getByRole('button',{name:'＋ Add activity',exact:true}).click();assert.equal(await page.getByLabel('Upload type').inputValue(),'activity');assert.equal(await page.getByLabel('Upload type').isVisible(),true);
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Remove Saturday · Canyon tour'}).click();assert.equal(writes,0);
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Remove Saturday · Canyon tour'}).click();await page.waitForFunction(()=>document.querySelectorAll('.travel-media').length===1);assert.equal(writes,1);
 assert.ok(await page.locator('#raven-trip-travel-popup').evaluate(e=>e.scrollWidth<=e.clientWidth));assert.deepEqual(errors,[]);
 const html=await renderTrip({id:'TEST',share_token:'token',name:'Test',people:['Alex','Blair','Casey'],simple_split:true,settled_people:{},sweep_payments:[]},[{id:1,total:300,paid_by:'Alex',splits:{Alex:100,Blair:100,Casey:100},items:[],name:'Rental'}]);
 assert.equal((html.match(/class="receipt-sweep-note"/g)||[]).length,1);assert.ok(!html.includes('Use the net payment plan above, not a separate payment'));
 console.log('PASS compact mobile sections, collapsed upload/tracker, photo preview, activity shortcut, safe removal, no overflow, one Sweep note per receipt.');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
