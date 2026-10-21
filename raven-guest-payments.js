/* Optional guest payment contacts. Bill-scoped data, never an account identity. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RavenGuestPayments=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  function normalize(raw){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Enter valid guest payment details.');
    if(Object.keys(raw).some(k=>!['venmo','cashapp','applepay'].includes(k)))throw Error('Unsupported guest payment field.');
    const result={};
    for(const key of ['venmo','cashapp','applepay']){
      if(raw[key]!=null&&typeof raw[key]!=='string')throw Error('Payment details must be text.');
      const value=String(raw[key]||'').trim();
      if(value.length>80)throw Error('Payment details are too long.');
      if(!value)continue;
      if(key==='venmo'){
        const handle=value.replace(/^@/,'');
        if(!/^[a-zA-Z0-9_-]{1,30}$/.test(handle))throw Error('Enter a Venmo ID, not a link (letters, numbers, - or _).');
        result.venmo=handle;
      }else if(key==='cashapp'){
        const tag=value.replace(/^\$/,'');
        if(!/^[a-zA-Z0-9]{1,20}$/.test(tag)||!/[a-zA-Z]/.test(tag))throw Error('Enter a Cash App $cashtag, not a link.');
        result.cashapp=tag;
      }else{
        if(!/^\+?[\d ()\-.]+$/.test(value))throw Error('Enter an Apple Pay phone number, including its country code.');
        const number=value.replace(/[ ()\-.]/g,'');
        if(!/^\+?[0-9]{7,15}$/.test(number))throw Error('Enter an Apple Pay phone number with 7–15 digits.');
        result.applepay=number;
      }
    }
    return result;
  }
  function isGuest(participant){
    return !!participant&&typeof participant.phone==='string'
      &&/^(unknown_|guest:)/.test(participant.phone)&&!String(participant.name||'').trim().startsWith('@');
  }
  function createEditor(){
    const values=new Map();
    function render(container,names){
      if(!container)return;
      container.replaceChildren();
      const guests=names.filter(name=>!String(name).trim().startsWith('@'));
      for(const key of values.keys())if(!guests.includes(key))values.delete(key);
      if(!guests.length)return;
      const intro=document.createElement('p');
      intro.textContent='Guest payment details · optional. Add only with their permission; visible to people with this bill’s payment link. No RAVEN account needed.';
      intro.style.cssText='font-size:12px;line-height:1.5;color:var(--muted2,#aaa);margin:8px 0';
      container.append(intro);
      for(const name of guests){
        const details=document.createElement('details');
        details.style.cssText='border-top:1px solid var(--border,#333);padding:10px 0';
        const summary=document.createElement('summary');
        summary.textContent=name+' · Payment details';
        summary.style.cssText='font-size:13px;color:var(--purple3,#C084FC);cursor:pointer;overflow-wrap:anywhere';
        details.append(summary);
        const fields=document.createElement('div');fields.style.cssText='display:grid;gap:9px;padding-top:12px';
        const draft=values.get(name)||{};values.set(name,draft);
        for(const [key,title,placeholder]of[['venmo','Venmo ID','@username'],['cashapp','Cash App','$cashtag'],['applepay','Apple Pay number','+1 555 123 4567']]){
          const label=document.createElement('label');label.textContent=title;label.style.cssText='display:grid;gap:5px;font-size:12px;color:var(--muted2,#aaa)';
          const input=document.createElement('input');input.className='form-input';input.type=key==='applepay'?'tel':'text';
          input.placeholder=placeholder;input.maxLength=80;input.autocomplete='off';input.spellcheck=false;input.value=draft[key]||'';
          input.setAttribute('aria-label',name+' '+title);input.style.cssText='width:100%;min-width:0;font-size:16px';
          input.addEventListener('input',()=>{draft[key]=input.value;input.setCustomValidity('')});
          input.addEventListener('blur',()=>{try{normalize({[key]:input.value});input.setCustomValidity('')}catch(e){input.setCustomValidity(e.message)}});
          label.append(input);fields.append(label);
        }
        const note=document.createElement('small');note.textContent='If this guest paid, these options help others repay them. Apple Pay opens Messages; RAVEN does not send money.';
        note.style.cssText='font-size:11px;line-height:1.5;color:var(--muted,#999)';
        fields.append(note);details.append(fields);container.append(details);
      }
    }
    function entries(names){
      return names.filter(name=>!String(name).trim().startsWith('@')).flatMap(name=>{
        let methods;try{methods=normalize(values.get(name)||{})}catch(e){throw Error(name+': '+e.message)}
        return Object.keys(methods).length?[{name,methods}]:[];
      });
    }
    return {render,entries,remove:name=>values.delete(name),clear:()=>values.clear()};
  }
  return {normalize,isGuest,createEditor};
});
