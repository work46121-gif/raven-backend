'use strict';
const G=require('./raven-guest-payments');
const TABLE='bill_guest_payment_methods';
const missing=e=>['42P01','PGRST205','PGRST202','42883'].includes(e?.code);
async function payer(db,bill){
  if(!bill?.paid_by)return null;
  const {data:people,error}=await db.from('participants').select('id,name,phone').eq('bill_id',bill.id);
  if(error)throw error;
  const matches=(people||[]).filter(p=>String(p.name||'').trim().toLowerCase()===String(bill.paid_by).trim().toLowerCase());
  if(matches.length!==1||!G.isGuest(matches[0]))return null;
  const person=matches[0];
  const result=await db.from(TABLE).select('venmo,cashapp,applepay,guest_identity').eq('bill_id',bill.id).eq('participant_id',person.id).maybeSingle();
  if(missing(result.error))return null; // Older bills work before the additive migration.
  if(result.error)throw result.error;
  if(!result.data||result.data.guest_identity!==person.phone)return null;
  const methods=G.normalize({venmo:result.data.venmo,cashapp:result.data.cashapp,applepay:result.data.applepay});
  return Object.keys(methods).length?{...methods,first_name:person.name,guest_payment_details:true}:null;
}
function register(app,db,authenticate){
  app.post('/bill/:billId/guest-payment-methods',async(req,res)=>{
    res.set('Cache-Control','no-store');
    try{
      const user=await authenticate(req);
      if(!user?.id||!user.email)return res.status(401).json({success:false,error:'Sign in to save guest payment details.'});
      const {data:bill,error}=await db.from('bills').select('id,creator_phone,status,share_token').eq('id',req.params.billId).maybeSingle();
      if(error)throw error;
      if(!bill||bill.status==='deleted')return res.status(404).json({success:false,error:'Bill not found.'});
      if(String(bill.creator_phone||'').toLowerCase()!==user.email.toLowerCase())return res.status(403).json({success:false,error:'Only the bill creator can save guest payment details.'});
      if(!bill.share_token||req.headers['x-raven-bill-token']!==bill.share_token)return res.status(403).json({success:false,error:'Open the editable bill link to save payment details.'});
      const entries=req.body?.entries;
      if(!Array.isArray(entries)||!entries.length||entries.length>50)return res.status(400).json({success:false,error:'Select 1–50 guests.'});
      const {data:people,error:peopleError}=await db.from('participants').select('id,name,phone').eq('bill_id',bill.id);
      if(peopleError)throw peopleError;
      const seen=new Set(),updates=[];
      for(const entry of entries){
        if(typeof entry?.name!=='string'||entry.name.length>120)return res.status(400).json({success:false,error:'Invalid guest name.'});
        const matches=(people||[]).filter(p=>String(p.name||'').trim().toLowerCase()===entry.name.trim().toLowerCase());
        if(matches.length!==1||!G.isGuest(matches[0]))return res.status(409).json({success:false,error:'Guest assignment changed. Registered accounts use their own payment methods.'});
        const person=matches[0];
        if(seen.has(person.id))return res.status(400).json({success:false,error:'Duplicate guest.'});
        seen.add(person.id);
        let methods;try{methods=G.normalize(entry.methods)}catch(e){return res.status(400).json({success:false,error:e.message})}
        updates.push({participant_id:person.id,guest_identity:person.phone,...methods});
      }
      const saved=await db.rpc('raven_save_guest_payment_methods',{p_bill_id:bill.id,p_actor_id:user.id,p_creator_email:user.email,p_entries:updates});
      if(saved.error)throw saved.error;
      return res.json({success:true});
    }catch(e){
      const conflict=e?.code==='P0001';
      return res.status(conflict?409:503).json({success:false,error:conflict?'Bill or guest assignment changed. Refresh before retrying.':missing(e)?'Guest payment storage is not available yet. Your bill is unchanged.':'Guest payment details could not be saved. Retry without creating another bill.'});
    }
  });
  app.get('/bill/:billId/guest-payer',async(req,res)=>{
    res.set('Cache-Control','private, no-store');
    try{
      const {data:bill,error}=await db.from('bills').select('id,creator_phone,status,paid_by,share_token').eq('id',req.params.billId).maybeSingle();
      if(error)throw error;
      if(!bill||bill.status==='deleted')return res.status(404).json({success:false,error:'Bill not found.'});
      const token=req.headers['x-raven-bill-token'];
      let allowed=!!bill.share_token&&token===bill.share_token;
      if(!allowed){
        const user=await authenticate(req);
        if(!user?.email)return res.status(401).json({success:false,error:'Sign in or open the payment link.'});
        allowed=user.email.toLowerCase()===String(bill.creator_phone||'').toLowerCase();
        if(!allowed){
          const {data:people,error:peopleError}=await db.from('participants').select('phone').eq('bill_id',bill.id);
          if(peopleError)throw peopleError;
          allowed=(people||[]).some(p=>String(p.phone||'').toLowerCase()===user.email.toLowerCase());
        }
      }
      if(!allowed)return res.status(403).json({success:false,error:'This bill is private.'});
      res.json({success:true,profile:await payer(db,bill)});
    }catch{res.status(503).json({success:false,error:'Could not load guest payment options. Try again.'})}
  });
}
module.exports={register,payer};
