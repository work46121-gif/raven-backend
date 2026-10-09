'use strict';
const crypto = require('node:crypto');
const S = require('./raven-trip-splits');
const Q = require('./raven-quantities');
const parse = (value, fallback) => {
  if(value == null)return fallback;
  try{return typeof value === 'string' ? JSON.parse(value) : value;}catch(_){return fallback;}
};
const fields = ['name','paid_by','total','splits','items','tax','tip','service_fee','discount','split_settings'];
function snapshot(receipt) {
  return Object.fromEntries(fields.map(field => [field,receipt[field]??null]));
}
function version(receipt) {
  return crypto.createHash('sha256').update(JSON.stringify(snapshot(receipt))).digest('hex');
}
function validate(body, trip) {
  const names = S.roster(parse(trip.people, []));
  const total = S.money(body.total)/100;
  if(total<=0)throw Error('Enter a bill total greater than zero.');
  if(body.paid_by && !names.includes(body.paid_by))throw Error('Choose a payer from this trip.');
  const items = parse(body.items, []);
  if(!Array.isArray(items)||items.length>500)throw Error('Invalid receipt items.');
  const settings = body.split_settings;
  if(!settings || !['bill','items'].includes(settings.mode))throw Error('Review and save the split again.');
  let calculated;
  if(settings.mode==='items'){
    calculated=S.receipt(items,names,body,Q);
    if(S.money(calculated.total)!==S.money(total))throw Error('Item amounts and charges must add up to the bill total.');
  }else{
    const sharing = S.roster(settings.people);
    if(sharing.some(n=>!names.includes(n)))throw Error('The trip members changed. Refresh before saving.');
    calculated={total,splits:S.allocation(total,sharing,settings.split)};
  }
  const splits = S.validateSplits(total,names,body.splits);
  if(names.some(n=>S.money(splits[n]||0)!==S.money(calculated.splits[n]||0)))throw Error('The split preview changed. Review it before saving.');
  // Validate item data even when a bill-level override is active.
  for(const item of items){
    S.money(item.price);
    const sharing=S.roster(item.assignees?.length?item.assignees:names);
    if(sharing.some(n=>!names.includes(n)))throw Error('An item has an unknown trip member.');
    if(item.custom_split)S.allocation(item.price,sharing,item.custom_split);
  }
  for(const field of ['tax','tip','service_fee','discount'])S.money(body[field]||0);
  return {...calculated,items,split_settings:settings};
}
module.exports={parse,snapshot,version,validate};
