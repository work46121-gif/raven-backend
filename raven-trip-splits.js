(function(root){
 'use strict';
 const key=value=>String(value||'').trim().toLowerCase();
 const money=value=>{
  if(!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(String(value)))throw Error('Use a non-negative amount with at most two decimal places.');
  const cents=Math.round(Number(value)*100);
  if(!Number.isSafeInteger(cents)||cents>1000000000)throw Error('Amount is too large.');
  return cents;
 };
 function roster(names){
  if(!Array.isArray(names)||!names.length||names.length>200||names.some(n=>!key(n)||['__proto__','constructor','prototype'].includes(key(n)))||new Set(names.map(key)).size!==names.length)throw Error('Refresh the trip member list before adjusting this split.');
  return names;
 }
 function apportion(cents,weights){
  if(!Number.isSafeInteger(cents)||cents<0||weights.some(w=>!Number.isFinite(w)||w<0))throw Error('Invalid split.');
  const sum=weights.reduce((a,b)=>a+b,0);if(sum<=0){if(cents===0)return weights.map(()=>0);throw Error('Include at least one person.');}
  const exact=weights.map(w=>cents*w/sum),out=exact.map(Math.floor);
  const order=exact.map((v,i)=>({i,remainder:v-out[i]})).sort((a,b)=>b.remainder-a.remainder||a.i-b.i);
  for(let i=0,left=cents-out.reduce((a,b)=>a+b,0);i<left;i++)out[order[i%order.length].i]++;
  return out;
 }
 function allocation(total,names,split={mode:'equal'}){
  roster(names);const cents=money(total);let shares;
  if(split.mode==='equal')shares=apportion(cents,names.map(()=>1));
  else{
   if(!['percent','amount'].includes(split.mode)||!split.values||Array.isArray(split.values))throw Error('Choose equal, percentage, or dollar amounts.');
   if(JSON.stringify(Object.keys(split.values).sort())!==JSON.stringify(names.map(key).sort()))throw Error('The people sharing this item changed. Please adjust the split again.');
   const values=names.map(n=>money(split.values[key(n)]));
   const expected=split.mode==='percent'?10000:cents;
   if(values.reduce((a,b)=>a+b,0)!==expected)throw Error(split.mode==='percent'?'Percentages must add up to 100%.':'Dollar amounts must add up to $'+(cents/100).toFixed(2)+'.');
   shares=split.mode==='amount'?values:apportion(cents,values);
  }
  return Object.fromEntries(names.map((n,i)=>[n,shares[i]/100]));
 }
 function fromAmounts(total,names,values,payer){
  roster(names);const amounts=names.map(n=>Math.max(0,Number(Object.entries(values||{}).find(([v])=>key(v)===key(n))?.[1])||0));
  // Older even receipts stored zero for the payer, although their own share
  // is still part of the purchase. Restore that share for editing only.
  const remainder=money(total)-amounts.reduce((s,v)=>s+Math.round(v*100),0),payerIndex=names.findIndex(n=>key(n)===key(payer));
  if(remainder>1&&payerIndex>=0&&amounts[payerIndex]===0)amounts[payerIndex]+=remainder/100;
  if(Math.abs(amounts.reduce((s,v)=>s+v,0)-Number(total))>0.02)throw Error('The saved shares do not match the total. Review this split before saving.');
  const normalized=apportion(money(total),amounts);
  return{mode:'amount',values:Object.fromEntries(names.map((n,i)=>[key(n),normalized[i]/100]))};
 }
 function itemShares(item,names,quantities){
  if(item.custom_split)return allocation(item.price,names,item.custom_split);
  const weights=names.map(n=>Number(item.price)===0?1:quantities.share(item,names,n));
  const values=apportion(money(item.price),weights);
  return Object.fromEntries(names.map((n,i)=>[n,values[i]/100]));
 }
 function receipt(items,names,charges,quantities){
  roster(names);const base=Object.fromEntries(names.map(n=>[n,0]));let subtotal=0;
  if(!Array.isArray(items)||!items.length)throw Error('Add at least one item.');
  for(const item of items){
   const sharing=item.assignees?.length?item.assignees:names;
   roster(sharing);
   if(sharing.some(n=>!names.includes(n)))throw Error('An item includes someone who is no longer on this trip.');
   const shares=itemShares(item,sharing,quantities);subtotal+=money(item.price);
   for(const [name,value]of Object.entries(shares))base[name]+=Math.round(value*100);
  }
  const extra=['tax','tip','service_fee'].reduce((s,k)=>s+money(charges[k]||0),0),discount=money(charges.discount||0);
  if(discount>subtotal+extra)throw Error('The discount cannot exceed the receipt total.');
  const total=subtotal+extra-discount;
  const shares=apportion(total,names.map(n=>base[n]));
  return{total:total/100,splits:Object.fromEntries(names.map((n,i)=>[n,shares[i]/100]))};
 }
 function validateSplits(total,names,splits){
  if(!splits||typeof splits!=='object'||Array.isArray(splits)||Object.keys(splits).some(n=>!names.includes(n)))throw Error('Use only members of this trip.');
  if(Object.values(splits).reduce((sum,v)=>sum+money(v),0)!==money(total))throw Error('The shares must add up to the full receipt total, including the payer’s share.');
  return splits;
 }
 function label(item,names,name){
  if(!item.custom_split)return '';
  try{const shares=allocation(item.price,names,item.custom_split);return(item.custom_split.mode==='percent'?Number(item.custom_split.values[key(name)])+'% · ':'')+'$'+shares[name].toFixed(2)}catch(_){return 'Review split'}
 }
 const api={key,money,roster,apportion,allocation,fromAmounts,itemShares,receipt,validateSplits,label};
 if(typeof module!=='undefined'&&module.exports){module.exports=api;return}
 root.RavenTripSplits=api;
 api.edit=(options,save)=>{
  const {total,names,title}=options;roster(names);money(total);
  const initial=options.initial||{mode:'equal'};
  let mode=initial.mode==='equal'?'percent':initial.mode,values={},busy=false;
  const touched=new Set();const fields={},amountLabels={};
  const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','Adjust split');
  dialog.style.cssText='position:fixed;inset:0;margin:auto;width:min(460px,calc(100vw - 28px));max-height:85dvh;overflow:auto;box-sizing:border-box;background:#121019;color:#eee8fa;border:1px solid #7c3aed66;border-radius:22px;padding:22px;font:inherit';
  const node=(tag,text)=>{const e=document.createElement(tag);e.textContent=text||'';return e};
  const heading=node('h2','Adjust split'),description=node('p',title),hint=node('p',options.hint||'Set each person’s share. The person who paid can cover more of the cost; they will not owe themselves.');
  heading.style.cssText='font-size:23px;margin:0 0 8px';hint.style.cssText='font-size:13px;line-height:1.5;color:#b8b1c7';
  dialog.append(heading,description,hint,node('p','Total: $'+Number(total).toFixed(2)));
  const modes=node('div');modes.style.cssText='display:flex;gap:8px;margin:16px 0';
  const percent=node('button','Percentage'),amount=node('button','Dollar amounts');modes.append(percent,amount);dialog.append(modes);
  const note=node('p');note.setAttribute('role','status');note.style.cssText='font-size:13px;line-height:1.5;color:#ffb04a';
  function candidate(){return{mode,values:{...values}}}
  function sync(){
   percent.setAttribute('aria-pressed',String(mode==='percent'));amount.setAttribute('aria-pressed',String(mode==='amount'));
   percent.style.borderColor=mode==='percent'?'#c084fc':'#473551';amount.style.borderColor=mode==='amount'?'#c084fc':'#473551';
   names.forEach(n=>{fields[key(n)].value=values[key(n)];fields[key(n)].setAttribute('aria-label',n+(mode==='percent'?' percentage':' amount'));});update();
  }
  function update(){
   let shares=null;try{shares=allocation(total,names,candidate());note.textContent='Fully assigned · $'+Number(total).toFixed(2);note.style.color='#30d158'}catch(error){note.textContent=error.message;note.style.color='#ffb04a'}
   names.forEach(n=>{amountLabels[key(n)].textContent=shares?'$'+shares[n].toFixed(2):'—'});
   apply.disabled=busy||!shares;
  }
  names.forEach(n=>{
   const row=node('label'),caption=node('span',n),input=node('input'),preview=node('span');
   row.style.cssText='display:grid;grid-template-columns:minmax(0,1fr) 90px 70px;align-items:center;gap:8px;padding:10px 0';caption.style.overflowWrap='anywhere';
   input.type='number';input.inputMode='decimal';input.min='0';input.step='0.01';input.style.width='100%';
   preview.style.cssText='font-size:13px;text-align:right;color:#30d158';fields[key(n)]=input;amountLabels[key(n)]=preview;
   input.oninput=()=>{values[key(n)]=input.value;touched.add(key(n));update()};row.append(caption,input,preview);dialog.append(row);
  });
  function switchMode(next){
   let shares;try{shares=allocation(total,names,candidate())}catch(_){note.textContent='Finish the current split, or choose Split equally, before switching.';return}
   mode=next;const units=mode==='percent'?10000:money(total),weights=names.map(n=>Number(total)===0?1:shares[n]);
   const allocated=apportion(units,weights);values=Object.fromEntries(names.map((n,i)=>[key(n),allocated[i]/100]));touched.clear();sync();
  }
  percent.onclick=()=>switchMode('percent');amount.onclick=()=>switchMode('amount');
  const equal=node('button','Split equally'),remainder=node('button','Split remainder equally'),cancel=node('button','Cancel'),apply=node('button','Save split');
  equal.onclick=()=>{const units=mode==='percent'?10000:money(total);const v=apportion(units,names.map(()=>1));values=Object.fromEntries(names.map((n,i)=>[key(n),v[i]/100]));touched.clear();sync()};
  remainder.onclick=()=>{
   const others=names.filter(n=>!touched.has(key(n)));if(!others.length){note.textContent='All shares were edited. Set the remaining values manually, or start with Split equally.';return}
   try{const used=names.filter(n=>touched.has(key(n))).reduce((s,n)=>s+money(values[key(n)]),0),remaining=(mode==='percent'?10000:money(total))-used;
    if(remaining<0)throw Error('The edited shares exceed the total.');const v=apportion(remaining,others.map(()=>1));others.forEach((n,i)=>{values[key(n)]=v[i]/100});sync();
   }catch(error){note.textContent=error.message}
  };
  cancel.onclick=()=>dialog.close();apply.onclick=async()=>{
   if(busy)return;try{const next=candidate();allocation(total,names,next);busy=true;dialog.querySelectorAll('button,input').forEach(e=>e.disabled=true);await save(next);dialog.close()}
   catch(error){busy=false;dialog.querySelectorAll('button,input').forEach(e=>e.disabled=false);update();note.textContent=error.message||'Could not save. Please retry.'}
  };
  const actions=node('div');actions.style.cssText='display:flex;gap:8px;flex-wrap:wrap';actions.append(equal,remainder,cancel,apply);dialog.append(note,actions);
  dialog.querySelectorAll('button,input').forEach(e=>{e.style.cssText+=';box-sizing:border-box;min-width:0;font:inherit;font-size:14px;padding:11px;border-radius:10px;border:1px solid #473551;background:#22172f;color:#e3c9ff;touch-action:manipulation';if(e.tagName==='BUTTON')e.type='button'});
  apply.style.cssText+=';background:#28ce58;color:#061109;font-weight:800';
  let start,initialError='';try{start=allocation(total,names,initial)}catch(error){start=allocation(total,names);initialError=error.message+' Equal shares shown for review; Cancel keeps the original.';}
  const units=mode==='percent'?10000:money(total),allocated=apportion(units,names.map(n=>Number(total)===0?1:start[n]));values=Object.fromEntries(names.map((n,i)=>[key(n),allocated[i]/100]));
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault()});dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);sync();if(initialError){note.textContent=initialError;note.style.color='#ffb04a'}dialog.showModal();
 };
})(typeof window!=='undefined'?window:globalThis);
