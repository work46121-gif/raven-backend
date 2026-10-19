'use strict';
// Existing share-link access, not a public media bucket. Only inline raster
// receipts move out of the HTML; persisted receipts and payment versions stay intact.
const DATA=/^data:image\/(?:jpeg|png|webp);base64,/i;
function url(receipt,tripId,token){
 const original=String(receipt.photo_url||'');
 return DATA.test(original)?'/trip/'+encodeURIComponent(tripId)+'/receipt-photo/'+encodeURIComponent(receipt.id)+'?t='+encodeURIComponent(token):original;
}
function register(app,db){
 app.get('/trip/:tripId/receipt-photo/:receiptId',async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");
  try{
   const {tripId,receiptId}=req.params,token=req.query.t;
   if(!/^[a-z0-9_-]{1,64}$/i.test(tripId)||!/^[a-z0-9_-]{1,64}$/i.test(receiptId)||typeof token!=='string'||!token||token.length>256)return res.status(403).send('Private receipt');
   const trip=await db.from('trips').select('share_token').eq('id',tripId).maybeSingle();
   if(trip.error)throw trip.error;
   if(!trip.data?.share_token||token!==trip.data.share_token)return res.status(403).send('Private receipt');
   const receipt=await db.from('trip_receipts').select('photo_url').eq('id',receiptId).eq('trip_id',tripId).maybeSingle();
   if(receipt.error)throw receipt.error;
   const value=String(receipt.data?.photo_url||'');
   const match=value.length<=28*1024*1024&&value.match(/^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/]+={0,2})$/i);
   if(!match)return res.status(404).send('Receipt photo unavailable');
   const bytes=Buffer.from(match[2],'base64');
   // Older uploaders labeled PNG screenshots as JPEG. Serve the verified raster
   // format, not the legacy label; keep rejecting HTML, SVG and unknown bytes.
   const mime=bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':
    bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':
    bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':null;
   if(!mime)return res.status(404).send('Receipt photo unavailable');
   res.type(mime).send(bytes);
  }catch{res.status(503).send('Could not load receipt photo. Please retry.')}
 });
}
module.exports={url,register};
