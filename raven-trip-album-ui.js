(() => {
 const make=(tag,text)=>{const node=document.createElement(tag);if(text)node.textContent=text;return node};
 const css=make('style');css.textContent=`
 .trip-album-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:12px}
 .trip-album-tile{position:relative;aspect-ratio:1;overflow:hidden;border:0;border-radius:10px;background:linear-gradient(140deg,#352143,#122e29);color:#e9d8ff;padding:0;cursor:pointer}
 .trip-album-tile img{display:block;width:100%;height:100%;object-fit:cover}
 .trip-album-tile span{display:block;font:600 12px inherit;padding:6px;overflow-wrap:anywhere}
 .trip-album-tile .trip-album-play{font-size:30px}
 .trip-album-upload{display:grid;gap:10px;margin:12px 0}.trip-album-upload[hidden]{display:none}
 #raven-trip-travel-popup .trip-album-upload input{box-sizing:border-box;width:100%;min-width:0;font:16px inherit;background:#14131c;border:1px solid #ffffff22;border-radius:10px;padding:12px;color:#eee}
 .trip-album-upload button{padding:12px;border:0;border-radius:10px;background:#30d158;color:#051309;font:600 14px inherit}
 #raven-trip-travel-popup .trip-album-note{font-size:12px;line-height:1.45;margin:6px 0}
 .trip-album-viewer{inset:0;margin:auto;box-sizing:border-box;width:min(760px,calc(100% - 20px));max-height:92dvh;overflow:auto;background:#0d0c14;color:#eee;border:1px solid #a855f750;border-radius:18px;padding:16px;font:14px inherit}
 .trip-album-viewer::backdrop{background:#030308df;backdrop-filter:blur(8px)}
 .trip-album-viewer img,.trip-album-viewer video{display:block;width:100%;max-height:65dvh;object-fit:contain;border-radius:10px;background:#000}
 .trip-album-viewer p{overflow-wrap:anywhere;color:#b7afc7;line-height:1.5}
 .trip-album-viewer header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
 .trip-album-viewer button{padding:10px 12px;border:1px solid #ffffff22;background:transparent;color:#ddc2f3;border-radius:9px;font:inherit;cursor:pointer}
 .trip-album-viewer .trip-album-delete{color:#e2a6b6}
 `;document.head.append(css);
 window.RavenTripAlbum={mount(container,{tripId,api}){
  const path='/trips/'+encodeURIComponent(tripId)+'/album';let disposed=false,busy=false,offset=0,items=[],pending=[],viewSequence=0;
  const section=make('section');section.className='travel-section';section.setAttribute('aria-label','Trip Photo Album');
  const head=make('div');head.className='travel-section-head';const add=make('button','＋ Add photos / videos');add.type='button';add.className='travel-text-button';
  head.append(make('h4','Trip Photo Album'),add);
  const note=make('p','Memories for this trip · visible to linked trip members only.');note.className='trip-album-note';
  const status=make('p');status.className='trip-album-note';status.setAttribute('role','status');
  const form=make('form');form.className='trip-album-upload';form.hidden=true;
  const file=make('input');file.type='file';file.multiple=true;file.accept='image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,.mov';file.setAttribute('aria-label','Album photos and videos');
  const caption=make('input');caption.maxLength=160;caption.placeholder='Caption (optional)';caption.setAttribute('aria-label','Album caption');
  const hint=make('p','Photos: JPG, PNG, WebP · 6 MB. Videos: MP4, MOV, WebM · 12 MB. Up to 10 at a time.');hint.className='trip-album-note';
  const send=make('button','Upload to album');send.type='submit';send.disabled=true;
  form.append(file,caption,hint,send);const grid=make('div');grid.className='trip-album-grid';
  const more=make('button','Load more memories'),refresh=make('button','Refresh album');
  for(const button of [more,refresh]){button.type='button';button.className='travel-text-button';button.style.marginRight='16px'}more.hidden=true;
  section.append(head,note,form,status,grid,more,refresh);container.append(section);
  const viewer=make('dialog');viewer.className='trip-album-viewer';viewer.setAttribute('aria-label','Trip album preview');document.body.append(viewer);
  const clearViewer=()=>{for(const video of viewer.querySelectorAll('video')){video.pause();video.removeAttribute('src');video.load()}viewer.replaceChildren()};
  viewer.addEventListener('close',()=>{viewSequence++;clearViewer()});
  function valid(){return !disposed&&section.isConnected}
  function error(message){if(valid())status.textContent=message||'Could not update the album. Please retry.'}
  async function show(item){
   const sequence=++viewSequence;clearViewer();const close=make('button','Close album preview');close.type='button';close.onclick=()=>viewer.close();
   const header=make('header');header.append(make('strong',item.kind==='video'?'Trip video':'Trip photo'),close);const message=make('p','Opening…');viewer.append(header,message);if(!viewer.open)viewer.showModal();
   try{
    // Refresh the short-lived URL and re-check membership each time it opens.
    const result=await api(path+'/'+item.id);if(!valid()||sequence!==viewSequence||!viewer.open)return;
    const row=result.media,media=make(row.kind==='video'?'video':'img');
    if(row.kind==='video'){media.controls=true;media.playsInline=true;media.preload='metadata'}else media.alt=row.caption||'Trip photo';
    media.src=row.url;media.onerror=()=>{message.textContent='This file could not be displayed. Close and reopen to retry. Some video formats may not play on this device.'};
    message.textContent=[row.caption,'Added '+new Date(row.created_at).toLocaleString()].filter(Boolean).join(' · ');viewer.append(media);
    if(row.can_remove){const remove=make('button','Remove from album');remove.type='button';remove.className='trip-album-delete';
     remove.onclick=async()=>{if(!confirm('Remove this photo or video from the trip album?'))return;remove.disabled=true;
      try{await api(path+'/'+row.id,'DELETE');if(valid()){viewer.close();await load(false)}}catch(e){message.textContent=e.message;remove.disabled=false}
     };viewer.append(remove);
    }
   }catch(e){if(valid()&&sequence===viewSequence)message.textContent=e.message||'Could not open this memory. Close and try again.'}
  }
  function render(){
   grid.replaceChildren();for(const item of items){const tile=make('button');tile.type='button';tile.className='trip-album-tile';tile.setAttribute('aria-label','View '+(item.caption||(item.kind==='video'?'trip video':'trip photo')));tile.onclick=()=>show(item);
    if(item.kind==='photo'){const img=make('img');img.src=item.url;img.alt=item.caption||'Trip photo';img.loading='lazy';img.onerror=()=>{img.remove();tile.append(make('span','Photo · tap to view'))};tile.append(img)}
    else{const play=make('span','▷');play.className='trip-album-play';tile.append(play,make('span',item.caption||'Video'))}grid.append(tile);
   }
  }
  async function load(append=false){
   if(busy||!valid())return;busy=true;more.disabled=refresh.disabled=true;
   try{const result=await api(path+'?offset='+(append?offset:0));if(!valid())return;
    const all=append?[...items,...result.media]:result.media;items=[...new Map(all.map(i=>[i.id,i])).values()];offset=result.nextOffset;more.hidden=!result.hasMore;render();status.textContent=items.length?'':'No memories yet. Add the first photo or video.';
   }catch(e){error(e.message)}finally{busy=false;more.disabled=refresh.disabled=false}
  }
  add.onclick=()=>{form.hidden=!form.hidden;add.setAttribute('aria-expanded',String(!form.hidden));if(!form.hidden)file.focus()};add.setAttribute('aria-expanded','false');
  file.onchange=()=>{
   pending=[];send.disabled=true;const chosen=Array.from(file.files||[]);if(chosen.length>10){error('Choose up to 10 files at a time.');return}
   for(const photo of chosen){const type=photo.type||(/\.mov$/i.test(photo.name)?'video/quicktime':'');
    if(!['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm'].includes(type)||!photo.size||photo.size>(type.startsWith('video/')?12582912:6291456)){error('Choose JPG, PNG or WebP photos up to 6 MB, or MP4, MOV or WebM videos up to 12 MB.');return}
    pending.push({file:photo,type,id:crypto.randomUUID()});
   }send.disabled=!pending.length;status.textContent=pending.length+' selected';
  };
  form.onsubmit=async event=>{
   event.preventDefault();if(!pending.length||send.disabled)return;send.disabled=true;file.disabled=true;caption.disabled=true;let uploaded=0;
   try{
    while(pending.length&&valid()){
     const next=pending[0];status.textContent='Uploading '+(uploaded+1)+' of '+(uploaded+pending.length)+'…';
     let data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Could not read this file. Choose it again.'));reader.readAsDataURL(next.file)});
     if(!valid())return;data=data.replace(/^data:[^;]*;/,'data:'+next.type+';');
     await api(path,'POST',{data_url:data,caption:caption.value,upload_id:next.id});pending.shift();uploaded++;
    }
    if(valid()){file.value='';caption.value='';form.hidden=true;add.setAttribute('aria-expanded','false');await load(false);status.textContent=uploaded+' added to the trip album.'}
   }catch(e){if(valid()){await load(false);error((uploaded?uploaded+' added. ':'')+(e.message||'Upload failed.')+' Retry to upload the remaining '+pending.length+'.')}}
   finally{send.disabled=!pending.length;file.disabled=caption.disabled=false}
  };
  more.onclick=()=>load(true);refresh.onclick=()=>load(false);void load(false);
  return {destroy(){disposed=true;viewSequence++;viewer.close();clearViewer();viewer.remove();section.remove();pending=[]}};
 }};
})();
