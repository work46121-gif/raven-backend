async function saveSweepAction(url,body,button){
  const label=button.textContent;button.disabled=true;button.textContent='Saving...';
  try{
    const response=await fetch(BACKEND+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TRIP_TOKEN,expected_version:D.sweepVersion,...body})});
    const result=await response.json();if(!response.ok||!result.success)throw Error(result.error||'Could not record payment.');
    toast('Payment record updated. Recalculating net balances...');reloadPage(0);
  }catch(error){button.disabled=false;button.textContent=label;toast(error.message||'Network error. Please retry.',false)}
}
function recordSweepPayment(name,button){
  const amount=Number(button.dataset.settleAmount);
  if(!confirm('Confirm '+name+' already sent the displayed payment'+(amount?' of $'+amount.toFixed(2):'')+'? This only records it; RAVEN does not transfer money.'))return;
  return saveSweepAction('/trip/'+TRIP_ID+'/mark-settled',{name,amount},button);
}
function undoSweepPayment(button){
  if(!confirm('Undo this payment record? Balances will be recalculated. This does not reverse an actual money transfer.'))return;
  return saveSweepAction('/trip/'+TRIP_ID+'/sweep-payment/'+encodeURIComponent(button.dataset.sweepPayment)+'/undo',{},button);
}
