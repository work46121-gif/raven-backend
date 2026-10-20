'use strict';
// Match Trip Hub's Completed label, including legacy trips with no end date.
function flightTracking(trip,now=new Date()){
 const end=String(trip?.end_date||'');
 const validDate=value=>{const parsed=new Date(value+'T12:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value};
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const start=String(trip?.trip_date||''),settled=trip?.total!=null&&Number.isFinite(Number(trip.total))&&Number(trip.total)<=0;
 const completed=end?validDate(end)&&today>=end:start?validDate(start)&&start<today&&settled:settled&&Number(trip?.receipt_count)>0;
 return {enabled:!completed,reason:completed?'trip_completed':null};
}
module.exports={flightTracking};
