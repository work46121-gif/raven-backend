const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('Server.js','utf8'),start=source.indexOf("app.get('/trip/:tripId',"),end=source.indexOf("app.get('/trip/:tripId/comments'",start);
const trip={id:'TEST',share_token:'token',invite_token:'invite',name:'Test trip',people:['Cousin','Mel','Sam'],settled_people:{},creator_email:'owner@test.invalid'};
const receipt={id:42,trip_id:'TEST',name:'Car',total:600,paid_by:'Cousin',splits:{Cousin:300,Mel:150,Sam:150},items:[],created_at:'2026-10-09',split_settings:{mode:'bill',people:trip.people,split:{mode:'percent',values:{cousin:50,mel:25,sam:25}}}};
async function renderTrip(testTrip=trip,receipts=[receipt]){
 let handler;const db={from(table){const q={select(){return q},eq(){return q},in(){return q},order(){return q},limit(){return q},single(){return q},update(){return q},then(resolve,reject){return Promise.resolve({data:table==='trips'?testTrip:table==='trip_receipts'?receipts:[]}).then(resolve,reject)}};return q}};
 const localRequire=p=>p.startsWith('./')?require('../'+p.slice(2)):require(p);localRequire.resolve=p=>require.resolve('../'+p.slice(2));
 const context={app:{get:(p,fn)=>{if(p==='/trip/:tripId')handler=fn}},supabase:db,process:{env:{}},URLSearchParams,require:localRequire,crypto:require('node:crypto'),console,RavenSweep:require('../raven-sweep'),RavenQuantities:require('../raven-quantities'),RavenTripSplits:require('../raven-trip-splits'),RavenTripReceipts:require('../raven-trip-receipts'),parseTripPeople:v=>Array.isArray(v)?v:JSON.parse(v||'[]'),buildTripConciergePayload:()=>({}),isSafeExternalUrl:()=>true,parseSettledPeopleRecord:v=>v||{},aggregateSettledCredits:()=>({}),roundMoney:v=>Math.round(Number(v)*100)/100};
 vm.runInNewContext(source.slice(start,end),context);
 let html;await handler({params:{tripId:'TEST'},query:{t:'token',app:'1'},headers:{}},{setHeader(){},status(){return this},send(value){html=value}});
 assert.ok(typeof html==='string');let count=0;
 for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){if(/application\/json/.test(m[1]))continue;new vm.Script(m[2]);count++}
 assert.ok(count>1);return html;
}
module.exports={renderTrip};
if(require.main===module)renderTrip().then(html=>{assert.ok(html.includes('Adjust split · % or $'));assert.match(html,/raven_edit|editTripItemSplit/);console.log('PASS: complete Trip Hub renders and every executable script parses, including the native-app view.');}).catch(error=>{console.error(error);process.exitCode=1});
