// Inlined into Trip Hub after the shared split calculator. Draft changes are
// committed only by Save Receipt / Save Changes, never by opening a dialog.
let tripBillSplit={mode:'equal'};
let _editReceiptId=null, editBillSplit=null, editBillItems=[], editBillMode='bill';
const tripSplitEsc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function tripBillPreview(splits,payer){
  return Object.entries(splits).map(([name,amount])=>'<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;font-size:13px"><span>'+tripSplitEsc(name)+(RavenTripSplits.key(name)===RavenTripSplits.key(payer)?' (own share, already paid)':'')+'</span><strong style="color:#30d158">$'+amount.toFixed(2)+'</strong></div>').join('');
}
function tripBillNet(){
  const gross=RavenTripSplits.money(document.getElementById('r-total').value||0),discount=RavenTripSplits.money(document.getElementById('r-discount').value||0);
  if(discount>gross)throw Error('The discount cannot exceed the total.');
  return(gross-discount)/100;
}
function adjustNewTripBill(){
  try{const total=tripBillNet();if(total<=0)throw Error('Enter the total first.');
    RavenTripSplits.edit({total,names:PEOPLE,title:document.getElementById('r-name').value||'Bill',initial:tripBillSplit},async split=>{tripBillSplit=split;updateEven()});
  }catch(error){toast(error.message,false)}
}
function editTripItemSplit(item,sharing,done){
  let initial=item.custom_split||{mode:'equal'};
  if(!item.custom_split && RavenQuantities.valid(item,sharing))initial=RavenTripSplits.fromAmounts(item.price,sharing,RavenTripSplits.itemShares(item,sharing,RavenQuantities));
  try{RavenTripSplits.edit({total:item.price,names:sharing,title:item.name,initial,hint:'Set this item’s percentage or dollar shares. Tax, tip, fees and discounts follow the item shares. Save the receipt to apply your changes.'},async split=>{
    item.custom_split=split;delete item.quantity_split;done();
  })}catch(error){toast(error.message,false)}
}
function editReceiptNames(){return [...document.querySelectorAll('input[name="edit-person"]:checked')].map(cb=>cb.value)}
function editReceiptCharges(){const r=receiptsDataMap[_editReceiptId];return{tax:r.tax||0,tip:r.tip||0,service_fee:r.service_fee||0,discount:r.discount||0}}
function editReceiptAllocation(){
  if(editBillMode==='items')return RavenTripSplits.receipt(editBillItems,PEOPLE,editReceiptCharges(),RavenQuantities);
  const total=Number(document.getElementById('edit-r-total').value);
  if(!editBillSplit)throw Error('Choose Adjust split to review the shares.');
  return{total,splits:RavenTripSplits.allocation(total,editReceiptNames(),editBillSplit)};
}
function openEditReceipt(id){
  const r=receiptsDataMap[id];if(!r){toast('Receipt not found',false);return}
  _editReceiptId=id;editBillItems=JSON.parse(JSON.stringify(r.items||[]));
  editBillMode=r.split_settings?.mode==='items'?'items':'bill';
  document.getElementById('edit-r-name').value=r.name;
  document.getElementById('edit-r-total').value=r.total;
  document.getElementById('edit-r-paidby').value=r.paid_by||'';
  const added=document.getElementById('edit-r-added-by');added.textContent=r.added_by?r.added_by+' added this receipt':'';added.style.display=r.added_by?'block':'none';
  let selected=r.split_settings?.people||Object.keys(r.splits||{});
  if(r.paid_by&&!selected.includes(r.paid_by))selected=[...selected,r.paid_by];
  selected=PEOPLE.filter(n=>selected.some(s=>RavenTripSplits.key(s)===RavenTripSplits.key(n)));
  const box=document.getElementById('edit-r-people');box.replaceChildren();
  for(const name of PEOPLE){const row=document.createElement('label'),cb=document.createElement('input'),label=document.createElement('span');
    row.style.cssText='display:flex;align-items:center;gap:12px;padding:8px';cb.type='checkbox';cb.name='edit-person';cb.value=name;cb.checked=selected.includes(name);cb.style.cssText='width:20px;height:20px;accent-color:#30d158';label.textContent=name;row.append(cb,label);box.append(row);
    cb.onchange=()=>{editBillMode='bill';updateEditSplitPreview()};
  }
  try{editBillSplit=r.split_settings?.mode==='bill'?r.split_settings.split:RavenTripSplits.fromAmounts(r.total,selected,r.splits,r.paid_by)}catch(_){editBillSplit=null}
  document.getElementById('edit-r-paidby').onchange=updateEditSplitPreview;
  document.getElementById('edit-r-save').disabled=false;document.getElementById('edit-r-save').textContent='Save Changes';
  renderEditReceiptItems();updateEditSplitPreview();document.getElementById('edit-receipt-modal').classList.add('open');
}
function renderEditReceiptItems(){
  const box=document.getElementById('edit-r-items');box.replaceChildren();
  editBillItems.forEach(item=>{
    const row=document.createElement('div'),title=document.createElement('p'),button=document.createElement('button');
    row.style.cssText='padding:12px;border:1px solid #ffffff15;border-radius:10px;margin-top:8px';title.textContent=item.name+' · $'+Number(item.price).toFixed(2);button.type='button';button.className='btn-o';button.textContent='Adjust item split';
    button.onclick=()=>editTripItemSplit(item,item.assignees?.length?item.assignees:PEOPLE,()=>{
      editBillMode='items';renderEditReceiptItems();updateEditSplitPreview();
    });row.append(title,button);box.append(row);
    const detail=document.createElement('p');detail.style.cssText='font-size:12px;color:#b8b1c7';
    try{detail.textContent=Object.entries(RavenTripSplits.itemShares(item,item.assignees?.length?item.assignees:PEOPLE,RavenQuantities)).map(([n,v])=>n+': $'+v.toFixed(2)).join(' · ')}catch(error){detail.textContent=error.message}row.append(detail);
  });
}
function adjustExistingTripBill(){
  try{const names=editReceiptNames();RavenTripSplits.roster(names);
    RavenTripSplits.edit({total:Number(document.getElementById('edit-r-total').value),names,title:document.getElementById('edit-r-name').value,initial:editBillSplit||{mode:'equal'},hint:'Choose each person’s share of the whole bill, including all charges. This overrides item-level shares. Save Changes to apply.'},async split=>{editBillSplit=split;editBillMode='bill';updateEditSplitPreview()});
  }catch(error){toast(error.message,false)}
}
function updateEditSplitPreview(){
  const preview=document.getElementById('edit-r-split-preview'),rows=document.getElementById('edit-r-split-rows'),total=document.getElementById('edit-r-total');preview.style.display='block';
  total.readOnly=editBillMode==='items';
  try{const allocation=editReceiptAllocation();if(editBillMode==='items')total.value=allocation.total.toFixed(2);
    rows.innerHTML='<p style="font-size:12px;color:#b8b1c7">'+(editBillMode==='items'?'Item splits plus proportional charges.':'Whole-bill split. Item details, if present, are for reference.')+'</p>'+tripBillPreview(allocation.splits,document.getElementById('edit-r-paidby').value);
    document.getElementById('edit-r-save').disabled=false;
  }catch(error){rows.textContent=error.message;document.getElementById('edit-r-save').disabled=true}
}
function closeEditReceipt(){document.getElementById('edit-receipt-modal').classList.remove('open');_editReceiptId=null}
async function saveEditReceipt(){
  if(!_editReceiptId)return;
  const id=_editReceiptId,r=receiptsDataMap[id],btn=document.getElementById('edit-r-save');
  try{const allocation=editReceiptAllocation();
    btn.disabled=true;btn.textContent='Saving...';
    const response=await fetch(BACKEND+'/trip/'+TRIP_ID+'/receipt/'+id+'/edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      token:TRIP_TOKEN,expected_version:r.version,split_format:1,name:document.getElementById('edit-r-name').value.trim()||'Receipt',paid_by:document.getElementById('edit-r-paidby').value||null,...allocation,items:editBillItems,...editReceiptCharges(),
      split_settings:editBillMode==='items'?{mode:'items'}:{mode:'bill',people:editReceiptNames(),split:editBillSplit}
    })});
    const result=await response.json();if(!response.ok||!result.success)throw Error(result.error||'Could not save this bill.');
    closeEditReceipt();toast('Bill split saved!');reloadPage(900);
  }catch(error){toast(error.message||'Network error. Your draft is still here.',false)}
  finally{btn.disabled=false;btn.textContent='Save Changes'}
}
