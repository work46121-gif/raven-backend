// Read-only detail view. Opening an amount never records or initiates payment.
function openSweepBalance(person, trigger) {
  const previous = document.getElementById('sweep-balance-dialog');
  if (previous) previous.close();
  const dialog = document.createElement('dialog');
  dialog.id = 'sweep-balance-dialog';
  dialog.setAttribute('aria-label', 'Balance breakdown for ' + person);
  dialog.style.cssText = 'position:fixed;inset:0;margin:auto;width:min(460px,calc(100vw - 28px));max-height:85dvh;overflow:auto;box-sizing:border-box;background:#121019;color:#eee8fa;border:1px solid #7c3aed55;border-radius:22px;padding:22px;font:inherit;text-align:left';
  const node = (tag, text) => { const el = document.createElement(tag); el.textContent = text || ''; return el; };
  const header = node('div');header.style.cssText='display:flex;justify-content:space-between;align-items:center;gap:12px';
  const title = node('h2', person + '’s balance');title.style.cssText='font-size:21px;line-height:1.3;margin:0;overflow-wrap:anywhere';
  const close = node('button', '×');close.type='button';close.setAttribute('aria-label','Close balance breakdown');close.style.cssText='width:38px;height:38px;flex-shrink:0;border:1px solid #ffffff18;border-radius:50%;background:#ffffff08;color:#aaa4b7;font:inherit;font-size:23px;cursor:pointer';close.onclick=()=>dialog.close();
  header.append(title,close);dialog.append(header);
  const body=node('div');body.setAttribute('aria-live','polite');dialog.append(body);
  const money=v=>(Number(v)<0?'−':'')+'$'+Math.abs(Number(v)||0).toFixed(2);
  const note=text=>{const el=node('p',text);el.style.cssText='font-size:12px;line-height:1.5;color:#aaa4b7;margin:8px 0';return el};
  const heading=text=>{const el=node('h3',text);el.style.cssText='font-size:13px;margin:20px 0 10px;color:#c5b4dd';body.append(el)};
  const line=(parent,label,value,bold=false)=>{const row=node('div');row.style.cssText='display:flex;justify-content:space-between;gap:16px;font-size:13px;line-height:1.5;padding:7px 0'+(bold?';font-weight:700;border-top:1px solid #ffffff16;margin-top:6px':'');const caption=node('span',label);caption.style.overflowWrap='anywhere';const amount=node('span',value);amount.style.cssText='white-space:nowrap;font-variant-numeric:tabular-nums';row.append(caption,amount);parent.append(row)};
  let pending=null;
  async function load() {
    const controller=new AbortController();pending=controller;const timeout=setTimeout(()=>controller.abort(),12000);
    body.replaceChildren(note('Loading current receipt breakdown…'));
    try {
      const response=await fetch(BACKEND+'/trip/'+TRIP_ID+'/ravenbot',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TRIP_TOKEN,message:'Show balance breakdown',intent:'balance_breakdown',person})});
      const result=await response.json();
      if(!response.ok||!result.success||!result.breakdown)throw Error(result.error||'Could not load the breakdown. Please retry.');
      if(!dialog.open)return;
      const detail=result.breakdown;
      body.replaceChildren();
      const state=detail.net<0?'Still to pay':detail.net>0?'Still to receive':'Settled';
      const hero=node('div',money(Math.abs(detail.net)));hero.style.cssText='font-size:30px;font-weight:800;font-variant-numeric:tabular-nums;margin-top:18px;color:'+(detail.net<0?'#ff9a3c':detail.net>0?'#c084fc':'#30d158');body.append(hero,note(state+' · '+detail.name));
      if(detail.version!==D.sweepVersion){
        const warning=note('Balances changed since this page opened. This breakdown is current; refresh the trip before paying.');warning.style.color='#ffb04a';body.append(warning);
        const refresh=node('button','Refresh trip');refresh.type='button';refresh.onclick=()=>reloadPage(0);body.append(refresh);
      }
      heading('Share by receipt');
      detail.bills.forEach(bill=>{
        const card=node('section');card.style.cssText='padding:12px 14px;margin:8px 0;border:1px solid #ffffff12;border-radius:12px;background:#ffffff03';
        line(card,bill.name,money(bill.share));card.append(note('Receipt '+money(bill.total)+' · Paid by '+bill.paid_by),note(bill.logic));body.append(card);
      });
      if(!detail.bills.length)body.append(note('No receipts have been added.'));
      heading('How the balance is calculated');
      line(body,'Receipt shares',money(detail.share));
      if(detail.paid)line(body,'Paid toward receipts','−'+money(detail.paid));
      if(detail.sent)line(body,'Recorded payments sent','−'+money(detail.sent));
      if(detail.received)line(body,'Recorded payments received','+'+money(detail.received));
      if(detail.earlier_adjustment)line(body,'Earlier settlement adjustment',(detail.earlier_adjustment>0?'−':'+')+money(Math.abs(detail.earlier_adjustment)));
      line(body,state,money(Math.abs(detail.net)),true);
      if(detail.net>0)body.append(note('Paid more than their own share: the remaining difference is money to receive, not a new charge.'));
      const transfers=detail.net<0?detail.recipients:detail.incoming;
      if(transfers.length){
        heading(detail.net<0?'Where this balance goes':'Where reimbursement comes from');
        transfers.forEach(t=>line(body,(detail.net<0?'To ':'From ')+t.name,money(t.amount)));
        body.append(note(detail.net<0&&transfers.length>1?'These payments add up to the one total above. Sweep offsets what each person owes against what they are owed, then pays recipients directly.':'Sweep offsets what each person owes against what they are owed. Only the remaining balance needs payment.'));
      }
      if(detail.recorded_payments.length){
        const history=node('details'),summary=node('summary','Recorded payments');summary.style.cssText='font-size:12px;color:#aaa4b7;cursor:pointer;margin-top:18px';history.append(summary);detail.recorded_payments.forEach(p=>line(history,p.from+' → '+p.to,money(p.amount)));body.append(history);
      }
      body.append(note('Read-only breakdown. Opening this panel does not move money or change any split.'));
    } catch(error) {
      if(!dialog.open)return;
      body.replaceChildren(note(error.name==='AbortError'?'Could not load the breakdown. Check your connection and retry.':error.message||'Could not load the breakdown. Please retry.'));
      const retry=node('button','Retry');retry.type='button';retry.style.cssText='padding:10px 16px;border:1px solid #7c3aed66;border-radius:10px;background:#a855f71a;color:#e3c9ff;font:inherit;cursor:pointer';retry.onclick=load;body.append(retry);
    } finally {clearTimeout(timeout);if(pending===controller)pending=null;}
  }
  dialog.addEventListener('close',()=>{if(pending)pending.abort();dialog.remove();if(trigger&&trigger.isConnected)trigger.focus()});
  document.body.append(dialog);dialog.showModal();load();
}
