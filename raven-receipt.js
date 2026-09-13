// Money reconciliation must never fabricate a fee or throw away readable items.
const money=v=>Math.round((Number(String(v??0).replace(/[$,]/g,''))||0)*100)/100;
const sumItems=items=>money((items||[]).reduce((s,i)=>s+money(i.price),0));
const expectedTotal=r=>money(r.subtotal+r.tax+r.tip+r.service_fee+r.misc-r.discount);
function normalizeParsedReceipt(raw){
 const r={bill_name:String(raw?.bill_name||'').trim(),items:[],subtotal:money(raw?.subtotal),tax:money(raw?.tax),tip:money(raw?.tip),service_fee:money(raw?.service_fee??raw?.serviceFee),misc:money(raw?.misc??raw?.misc_fee??raw?.fees),discount:money(raw?.discount),total:money(raw?.total),warning:''};
 let itemService=0,itemMisc=0;
 for(const i of Array.isArray(raw?.items)?raw.items:[]){const name=String(i?.name||'').trim(),price=money(i?.price);if(!name||price<=0)continue;
  if(/\b(service|convenience|processing|delivery)\s+(fee|charge)\b/i.test(name)){itemService=money(itemService+price);continue;}
  if(/\b(misc(?:ellaneous)?|bag|recycling|container)\s+(fee|charge)\b|\bbottle deposit\b/i.test(name)){itemMisc=money(itemMisc+price);continue;}
  r.items.push({name,price});
 }
 if(!r.service_fee)r.service_fee=itemService;if(!r.misc)r.misc=itemMisc;
 r.printed_subtotal=r.subtotal;
 const itemSum=sumItems(r.items),charges=money(r.tax+r.tip+r.service_fee+r.misc-r.discount);
 // Printed subtotal may include mandatory fees or an order-level discount.
 // Only accept a different subtotal interpretation if the full receipt also balances.
 if(r.items.length&&r.total>0&&Math.abs(money(itemSum+charges-r.total))<=0.02)r.subtotal=itemSum;
 else if(!r.subtotal&&itemSum)r.subtotal=itemSum;
 r.calculated_total=money(itemSum+charges);
 r.difference=money(r.total-r.calculated_total);
 r.needs_review=!r.items.length||r.total<=0||Math.abs(r.difference)>0.02||Math.abs(money(itemSum-r.subtotal))>0.02;
 if(r.needs_review)r.warning=r.items.length?'Readable items kept. Review the receipt and correct missing items or charges before creating the bill.':'No item lines could be read. Try the original photo or enter the items manually.';
 return r;
}
const subtotalMismatch=r=>!r?.items?.length?Number.POSITIVE_INFINITY:money(Math.abs(sumItems(r.items)-r.subtotal)+Math.abs(sumItems(r.items)+r.tax+r.tip+r.service_fee+r.misc-r.discount-r.total));
module.exports={money,sumItems,expectedTotal,normalizeParsedReceipt,subtotalMismatch};
