'use strict';
const assert=require('node:assert/strict'),register=require('../raven-trip-travel'),{flightTracking}=require('../raven-trip-lifecycle');
const end_date='2026-10-19';
assert.equal(flightTracking({end_date},new Date('2026-10-19T03:59:59Z')).enabled,true,'not complete before New York midnight');
assert.equal(flightTracking({end_date},new Date('2026-10-19T04:00:00Z')).enabled,false,'same completion boundary as Trip Hub');
for(const end_date of ['',null,'invalid','2026-13-19','2026-02-30'])assert.equal(flightTracking({end_date}).enabled,true,'invalid dates do not throw');
assert.equal(flightTracking({trip_date:'2000-01-01',total:0}).enabled,false,'legacy past settled trip is completed');
assert.equal(flightTracking({trip_date:'2000-01-01',total:10}).enabled,true,'legacy unpaid trip stays active');
assert.equal(flightTracking({total:0,receipt_count:1}).enabled,false,'undated settled receipts match Completed label');
assert.equal(flightTracking({total:0,receipt_count:0}).enabled,true,'empty trip stays active');
assert.equal(flightTracking({end_date:'2999-01-01',total:0,receipt_count:1}).enabled,true,'future end date takes precedence');
let user={id:'U',email:'owner@test.invalid'},trip={id:'T',creator_email:user.email,end_date:'2000-01-01'},handler,calls=0;
const previous=global.fetch;global.fetch=async()=>{calls++;return {ok:true,json:async()=>({})}};
const db={from(){const q={select(){return q},eq(){return q},maybeSingle(){return Promise.resolve({data:trip})}};return q}};
register({get(path,h){if(path.endsWith('/flight-status'))handler=h},post(){},delete(){},patch(){}},db,async()=>user);
async function get(){let status=200,body;await handler({params:{id:'T'},query:{flight:'AA100'},headers:{}},{set(){},status(n){status=n;return this},json(v){body=v}});return {status,body}}
(async()=>{try{
 for(let i=0;i<3;i++){const r=await get();assert.equal(r.body.tracking_enabled,false);assert.equal(r.body.status,'completed')}
 assert.equal(calls,0,'no AirLabs or ADS-B calls, including repeat requests by old clients');
 user={id:'X',email:'outsider@test.invalid'};assert.equal((await get()).status,403);assert.equal(calls,0);
 user=null;assert.equal((await get()).status,401);assert.equal(calls,0);
 user={id:'U',email:'owner@test.invalid'};trip.end_date='2999-01-01';await get();assert.ok(calls>0,'future trip can still query provider');
 console.log('PASS completed-trip tracking: New York date boundary, invalid dates, auth checks, repeated calls use zero provider requests, future trips unchanged.');
}finally{global.fetch=previous}})().catch(e=>{console.error(e);process.exitCode=1});
