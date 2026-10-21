(() => {
 const make=(tag,text)=>{const node=document.createElement(tag);if(text)node.textContent=text;return node};
 const css=make('style');css.textContent=`
 .trip-album-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:12px}
 .trip-album-tile{position:relative;aspect-ratio:1;overflow:hidden;border:0;border-radius:10px;background:linear-gradient(140deg,#352143,#122e29);color:#e9d8ff;padding:0;cursor:pointer}
 .trip-album-tile img{display:block;width:100%;height:100%;object-fit:cover}
 .trip-album-tile span{display:block;font:600 12px inherit;padding:6px;overflow-wrap:anywhere}
 .trip-album-tile .trip-album-play{font-size:30px}
 .trip-album-tile.has-preview .trip-album-play{position:absolute;inset:0;display:grid;place-items:center;text-shadow:0 2px 10px #000;background:#0002}
 .trip-album-tile.has-preview .trip-album-caption{position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,#000b);color:#fff;padding:18px 38px 6px 6px;font-size:11px}
 .trip-album-avatar{position:relative;display:grid;place-items:center;flex:0 0 40px;width:40px;height:40px;border-radius:50%;overflow:hidden;background:linear-gradient(140deg,#65418a,#205942);color:#fff;font:600 14px/1 sans-serif}
 .trip-album-avatar img{position:absolute;inset:0;display:block;width:100%;height:100%;max-height:none;object-fit:cover;border-radius:50%;background:none}
 .trip-album-tile .trip-album-avatar{position:absolute;display:grid;bottom:6px;right:6px;width:28px;height:28px;box-sizing:border-box;border:2px solid #17131c;padding:0;font-size:10px;box-shadow:0 2px 8px #0008;z-index:2}
 .trip-album-upload{display:grid;gap:10px;margin:12px 0}.trip-album-upload[hidden]{display:none}
 .trip-album-upload input[hidden]{display:none!important}
 .trip-album-pending progress[hidden],.trip-album-upload button[hidden]{display:none}
 #raven-trip-travel-popup .trip-album-upload input{box-sizing:border-box;width:100%;min-width:0;font:16px inherit;background:#14131c;border:1px solid #ffffff22;border-radius:10px;padding:12px;color:#eee}
 .trip-album-upload button{padding:12px;border:0;border-radius:10px;background:#30d158;color:#051309;font:inherit;font-size:14px;font-weight:600}
 .trip-album-upload button:disabled{opacity:.4;cursor:not-allowed!important}
 #raven-trip-travel-popup .trip-album-choose{display:flex;align-items:center;gap:12px;text-align:left;padding:16px;border:1px dashed #a855f777;background:linear-gradient(110deg,#a855f714,#30d15808);color:#e3c8ff}
 .trip-album-choose b{font-size:27px;font-weight:400;color:#30d158}.trip-album-choose small{display:block;margin-top:3px;color:#aaa4b7;font-size:12px;font-weight:400}
 .trip-album-queue{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:10px 0}
 .trip-album-queue:empty{display:none}.trip-album-pending{min-width:0;position:relative}
 .trip-album-preview{aspect-ratio:1;border-radius:10px;overflow:hidden;background:linear-gradient(140deg,#352143,#122e29);position:relative;display:grid;place-items:center;color:#d6b9f6}
 .trip-album-preview img,.trip-album-preview video{display:block;width:100%;height:100%;object-fit:cover}
 .trip-album-preview .trip-album-play{position:absolute;bottom:6px;left:7px;text-shadow:0 1px 4px #000;font-size:22px;pointer-events:none}
 #raven-trip-travel-popup .trip-album-remove-pending{position:absolute;top:4px;right:4px;padding:0;width:26px;height:26px;border:1px solid #ffffff33;border-radius:50%;background:#0b0b13dd;color:#fff;line-height:24px;font-size:18px;z-index:1}
 .trip-album-pending-name{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:#ccc3d9;margin-top:5px}
 .trip-album-pending-state{display:block;overflow-wrap:anywhere;font-size:11px;line-height:1.4;color:#c5b0dd;margin-top:3px}
 .trip-album-pending[data-phase=invalid] .trip-album-pending-state,.trip-album-pending[data-phase=error] .trip-album-pending-state{color:#ffb26c}
 .trip-album-pending[data-phase=done] .trip-album-pending-state{color:#30d158}
 .trip-album-pending progress{display:block;width:100%;height:4px;margin-top:5px;accent-color:#30d158}
 #raven-trip-travel-popup .trip-album-note[data-tone=error]{color:#ffb26c}
 #raven-trip-travel-popup .trip-album-stop{background:none;color:#c6b5dc;border:1px solid #ffffff22}
 #raven-trip-travel-popup .trip-album-note{font-size:12px;line-height:1.45;margin:6px 0}
 .trip-album-viewer{inset:0;margin:auto;box-sizing:border-box;width:min(760px,calc(100% - 20px));max-height:92dvh;overflow:auto;background:#0d0c14;color:#eee;border:1px solid #a855f750;border-radius:18px;padding:16px;font:14px inherit}
 .trip-album-viewer::backdrop{background:#030308df;backdrop-filter:blur(8px)}
 .trip-album-viewer .trip-album-full-media{display:block;width:100%;max-height:62dvh;object-fit:contain;border-radius:10px;background:#000}
 .trip-album-viewer p{overflow-wrap:anywhere;color:#b7afc7;line-height:1.5}
 .trip-album-viewer header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
 .trip-album-viewer button{padding:10px 12px;border:1px solid #ffffff22;background:transparent;color:#ddc2f3;border-radius:9px;font:inherit;cursor:pointer}
 .trip-album-viewer .trip-album-close{width:36px;height:36px;padding:0;font-size:24px;flex-shrink:0}
 .trip-album-byline{display:flex;align-items:center;gap:10px;margin-top:16px;min-width:0}
 .trip-album-byline-copy{min-width:0;display:grid;gap:5px}.trip-album-byline strong{font-size:14px;overflow-wrap:anywhere}
 .trip-album-byline time{font-size:12px;color:#aaa2b8;line-height:1.5}
 .trip-album-viewer .trip-album-actions{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:1px solid #ffffff13}
 .trip-album-viewer .trip-album-delete{color:#e2a6b6;font-size:12px;background:none;border-color:transparent;min-height:40px;margin-left:auto}
 .trip-album-viewer .trip-album-save{background:#30d158;color:#07120a;border:0;font-size:13px;font-weight:700;min-height:40px;margin:0}
 .trip-album-viewer .trip-album-save-note{font-size:12px;margin:10px 0 0}.trip-album-save-note:empty{display:none}
 `;document.head.append(css);
 window.RavenTripAlbum={mount(container,{tripId,api,standalone=false}){
  const path='/trips/'+encodeURIComponent(tripId)+'/album';let disposed=false,busy=false,uploading=false,uploadController=null,offset=0,items=[],pending=[],viewSequence=0;
  const section=make('section');section.className='travel-section';section.setAttribute('aria-label','Trip Photo Album');
  const head=make('div');head.className='travel-section-head';const add=make('button','＋ Add photos / videos');add.type='button';add.className='travel-text-button';
  head.append(make('h4',standalone?'Photos / videos':'Trip Photo Album'),add);
  const note=make('p','Your trip, together. Shared with linked trip members only.');note.className='trip-album-note';
  const status=make('p');status.className='trip-album-note';status.setAttribute('role','status');
  const form=make('form');form.className='trip-album-upload';form.hidden=true;
  const file=make('input');file.type='file';file.multiple=true;file.hidden=true;file.accept='image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,.mov,.mp4,.webm';file.setAttribute('aria-label','Album photos and videos');
  const choose=make('button');choose.type='button';choose.className='trip-album-choose';
  const chooseText=make('span','Choose photos / videos');chooseText.append(make('small','Add memories from your library'));choose.append(make('b','＋'),chooseText);choose.setAttribute('aria-label','Choose photos or videos');choose.onclick=()=>file.click();
  const caption=make('input');caption.maxLength=160;caption.placeholder='Caption (optional)';caption.setAttribute('aria-label','Album caption');
  const hint=make('p','Photos & videos up to 50 MB each · 10 at a time');hint.className='trip-album-note';
  const send=make('button','Upload to album');send.type='submit';send.disabled=true;
  const queue=make('div');queue.className='trip-album-queue';queue.setAttribute('aria-label','Selected memories');
  const stop=make('button','Stop upload');stop.type='button';stop.className='trip-album-stop';stop.hidden=true;stop.onclick=()=>uploadController?.abort();
  form.append(file,choose,queue,caption,hint,send,stop);const grid=make('div');grid.className='trip-album-grid';
  const more=make('button','Load more memories'),refresh=make('button','Refresh album');
  for(const button of [more,refresh]){button.type='button';button.className='travel-text-button';button.style.marginRight='16px'}more.hidden=true;
  section.append(head,note,form,status,grid,more,refresh);container.append(section);
  const viewer=make('dialog');viewer.className='trip-album-viewer';viewer.setAttribute('aria-label','Trip album preview');document.body.append(viewer);
  let saveController=null,saveUrl=null;
  const clearViewer=()=>{saveController?.abort();saveController=null;if(saveUrl)URL.revokeObjectURL(saveUrl);saveUrl=null;for(const video of viewer.querySelectorAll('video')){video.pause();video.removeAttribute('src');video.load()}viewer.replaceChildren()};
  viewer.addEventListener('close',()=>{viewSequence++;clearViewer()});
  function valid(){return !disposed&&section.isConnected}
  function error(message){if(valid()){status.dataset.tone='error';status.textContent=message||'Could not update the album. Please retry.'}}
  function info(message){if(valid()){status.dataset.tone='';status.textContent=message}}
  function avatar(uploader){
   const name=uploader?.name||'RAVEN member',node=make('span',name.trim().split(/\s+/).slice(0,2).map(s=>s[0]||'').join('').toUpperCase());node.className='trip-album-avatar';node.setAttribute('aria-label','Uploaded by '+name);node.title='Uploaded by '+name;
   if(typeof uploader?.avatar_url==='string'&&/^(https:\/\/|data:image\/(?:png|jpe?g|webp|gif);base64,)/i.test(uploader.avatar_url)){
    const img=make('img');img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';img.src=uploader.avatar_url;img.onerror=()=>img.remove();node.append(img);
   }return node;
  }
  async function show(item){
   const sequence=++viewSequence;clearViewer();const close=make('button','×');close.type='button';close.className='trip-album-close';close.setAttribute('aria-label','Close album preview');close.onclick=()=>viewer.close();
   const header=make('header');header.append(make('strong',item.kind==='video'?'Trip video':'Trip photo'),close);const message=make('p','Opening…');viewer.append(header,message);if(!viewer.open)viewer.showModal();
   try{
    // Refresh the short-lived URL and re-check membership each time it opens.
    const result=await api(path+'/'+item.id);if(!valid()||sequence!==viewSequence||!viewer.open)return;
    const row=result.media,media=make(row.kind==='video'?'video':'img');media.className='trip-album-full-media';
    if(row.kind==='video'){media.controls=true;media.playsInline=true;media.preload='metadata'}else media.alt=row.caption||'Trip photo';
    media.src=row.url;media.onerror=()=>{message.textContent='This file could not be displayed. Close and reopen to retry. Some video formats may not play on this device.'};
    message.textContent='';viewer.append(media);if(row.caption)viewer.append(make('p',row.caption));
    const byline=make('footer');byline.className='trip-album-byline';const copy=make('div');copy.className='trip-album-byline-copy';copy.append(make('strong',row.uploader?.name||'RAVEN member'));
    const date=new Date(row.created_at),stamp=make('time');
    if(Number.isFinite(date.getTime())){stamp.dateTime=date.toISOString();stamp.textContent='Uploaded '+date.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})+' · '+date.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});stamp.title=date.toLocaleString(undefined,{timeZoneName:'short'})}else stamp.textContent='Upload date unavailable';
    copy.append(stamp);byline.append(avatar(row.uploader),copy);viewer.append(byline);
    const actions=make('div');actions.className='trip-album-actions';viewer.append(actions);
    {
     const kind=row.kind==='video'?'video':'photo',title=kind==='video'?'Trip video':'Trip photo';
     const save=make('button','Save '+kind),saveNote=make('p');save.type='button';save.className='trip-album-save';saveNote.className='trip-album-save-note';saveNote.setAttribute('role','status');let readyFile=null;
     save.onclick=async()=>{
      if(readyFile){
       try{
        if(navigator.canShare?.({files:[readyFile]})&&navigator.share){await navigator.share({files:[readyFile],title});saveNote.textContent='Choose '+(kind==='video'?'Save Video':'Save Image')+' or Save to Files in your device’s share sheet.'}
        else{if(!saveUrl)saveUrl=URL.createObjectURL(readyFile);const link=make('a');link.href=saveUrl;link.download=readyFile.name;document.body.append(link);link.click();link.remove();saveNote.textContent='Download requested. Check your device’s downloads.'}
       }catch(e){saveNote.textContent=e.name==='AbortError'?'Save canceled. Tap Save '+kind+' to try again.':'Could not open the save menu. Please try again.'}return;
      }
      save.disabled=true;save.textContent='Preparing '+kind+'…';saveNote.textContent='Preparing the original file. Keep this preview open.';const controller=saveController=new AbortController();const timer=setTimeout(()=>controller.abort(),120000);
      try{
       const fresh=await api(path+'/'+row.id);if(!valid()||sequence!==viewSequence||!viewer.open)return;
       const response=await fetch(fresh.media.url,{signal:controller.signal});if(!response.ok)throw Error('Could not download this '+kind+'. Please retry.');
       const blob=await response.blob();if(!blob.size||blob.size>52428800)throw Error('This '+kind+' could not be prepared for saving.');
       if(!valid()||sequence!==viewSequence||!viewer.open)return;
       const mime=fresh.media.mime_type||blob.type,ext={'video/quicktime':'mov','video/webm':'webm','video/mp4':'mp4','image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[mime];if(!ext)throw Error('This file type cannot be saved.');
       readyFile=new File([blob],'RAVEN-trip-'+String(row.id).replace(/[^a-z0-9-]/gi,'').slice(0,40)+'.'+ext,{type:mime});
       saveNote.textContent='Ready. Tap Save '+kind+' to choose where to save it.';
      }catch(e){if(valid()&&sequence===viewSequence&&viewer.open)saveNote.textContent=e.name==='AbortError'?'Download stopped. Tap Save '+kind+' to retry.':e.message}
      finally{clearTimeout(timer);if(sequence===viewSequence&&viewer.open){save.disabled=false;save.textContent='Save '+kind}}
     };actions.append(save);viewer.append(saveNote);
    }
    if(row.can_remove){const remove=make('button','Remove from album');remove.type='button';remove.className='trip-album-delete';
     remove.onclick=async()=>{if(!confirm('Remove this photo or video from the trip album?'))return;remove.disabled=true;
      try{await api(path+'/'+row.id,'DELETE');if(valid()){viewer.close();await load(false)}}catch(e){message.textContent=e.message;remove.disabled=false}
     };actions.append(remove);
    }
   }catch(e){if(valid()&&sequence===viewSequence)message.textContent=e.message||'Could not open this memory. Close and try again.'}
  }
  // Only visible album tiles request a frame, two at a time. Never autoplay or
  // load the gallery while opening a trip. Release video decoders after capture.
  let thumbObserver=null,thumbEpoch=0,thumbQueue=[],thumbActive=0,thumbStops=[],thumbUrls=[];
  function clearThumbs(){thumbEpoch++;thumbObserver?.disconnect();for(const stop of thumbStops)stop();thumbStops=[];thumbQueue=[];thumbActive=0;for(const url of thumbUrls)URL.revokeObjectURL(url);thumbUrls=[]}
  function pumpThumbs(){
   while(valid()&&thumbActive<2&&thumbQueue.length){
    const {tile,item}=thumbQueue.shift(),epoch=thumbEpoch;thumbActive++;const video=make('video');let finished=false,capturing=false;
    const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);video.pause();video.removeAttribute('src');video.load();if(epoch===thumbEpoch){thumbActive--;pumpThumbs()}};
    const timer=setTimeout(finish,10000);thumbStops.push(finish);
    video.muted=true;video.playsInline=true;video.preload='metadata';video.crossOrigin='anonymous';
    const capture=()=>{if(finished||capturing||video.readyState<2)return;capturing=true;try{const canvas=make('canvas');canvas.width=240;canvas.height=Math.max(1,Math.min(480,Math.round(240*video.videoHeight/video.videoWidth)));canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);canvas.toBlob(blob=>{if(!finished&&blob&&valid()&&epoch===thumbEpoch&&tile.isConnected){const img=make('img');img.alt=item.caption||'Video preview';img.src=URL.createObjectURL(blob);thumbUrls.push(img.src);tile.prepend(img);tile.classList.add('has-preview')}finish()},'image/jpeg',0.75)}catch{finish()}};
    video.onloadedmetadata=()=>{try{video.currentTime=Math.min(0.1,Number.isFinite(video.duration)?video.duration/2:0.1)}catch{capture()}};video.onseeked=capture;video.onloadeddata=()=>{if(!video.seeking)capture()};video.onerror=finish;video.src=item.url+'#t=0.1';video.load();
   }
  }
  function render(){
   clearThumbs();
   if(typeof IntersectionObserver==='function')thumbObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){thumbObserver.unobserve(entry.target);thumbQueue.push({tile:entry.target,item:entry.target.albumItem})}pumpThumbs()},{root:container.closest('dialog'),rootMargin:'60px'});
   grid.replaceChildren();for(const item of items){const tile=make('button');tile.type='button';tile.className='trip-album-tile';tile.setAttribute('aria-label','View '+(item.caption||(item.kind==='video'?'trip video':'trip photo')));tile.onclick=()=>show(item);
    if(item.kind==='photo'){const img=make('img');img.src=item.url;img.alt=item.caption||'Trip photo';img.loading='lazy';img.onerror=()=>{img.remove();tile.append(make('span','Photo · tap to view'))};tile.append(img)}
    else{const play=make('span','▷'),caption=make('span',item.caption||'Video');play.className='trip-album-play';caption.className='trip-album-caption';tile.append(play,caption);tile.albumItem=item}grid.append(tile);
    tile.append(avatar(item.uploader));tile.setAttribute('aria-label',tile.getAttribute('aria-label')+' · Uploaded by '+(item.uploader?.name||'RAVEN member'));
    if(item.kind==='video'){if(thumbObserver)thumbObserver.observe(tile);else thumbQueue.push({tile,item})}
   }
   if(!thumbObserver)pumpThumbs();
  }
  async function load(append=false){
   if(busy||!valid())return;busy=true;more.disabled=refresh.disabled=true;
   try{const result=await api(path+'?offset='+(append?offset:0));if(!valid())return;
    const all=append?[...items,...result.media]:result.media;items=[...new Map(all.map(i=>[i.id,i])).values()];offset=result.nextOffset;more.hidden=!result.hasMore;render();
    for(const entry of pending.filter(p=>p.phase==='done'&&items.some(i=>i.id===p.id)))release(entry);
    pending=pending.filter(p=>!(p.phase==='done'&&items.some(i=>i.id===p.id)));renderPending();
    if(!pending.length&&!uploading)info(items.length?'':'No memories yet. Add the first photo or video.');
   }catch(e){error(e.message)}finally{busy=false;more.disabled=refresh.disabled=false}
  }
  function release(entry){if(entry.url){URL.revokeObjectURL(entry.url);entry.url=null}const video=entry.tile?.querySelector('video');if(video){video.pause();video.removeAttribute('src');video.load()}entry.tile?.remove()}
  function renderPending(){
   for(const entry of pending){
    if(!entry.tile){
     const tile=make('div');tile.className='trip-album-pending';entry.tile=tile;
     const preview=make('div');preview.className='trip-album-preview';
     if(entry.url){const media=make(entry.type.startsWith('video/')?'video':'img');media.src=entry.url;
      if(media.tagName==='VIDEO'){media.muted=true;media.playsInline=true;media.preload='metadata';preview.append(make('span','▷'));preview.lastChild.className='trip-album-play'}
      else media.alt='Selected photo preview';preview.prepend(media);
      media.onerror=()=>{media.remove();preview.prepend(make('span',entry.type.startsWith('video/')?'Video preview':'Photo preview'))};
     }else preview.append(make('span','!'));
     const remove=make('button','×');remove.type='button';remove.className='trip-album-remove-pending';remove.setAttribute('aria-label','Remove '+entry.file.name+' from selection');entry.remove=remove;
     remove.onclick=()=>{if(uploading)return;release(entry);pending=pending.filter(p=>p!==entry);renderPending();info(pending.length?pending.length+' selected':'Choose photos or videos to add.')};
     const name=make('span',entry.file.name);name.className='trip-album-pending-name';name.title=entry.file.name;
     entry.state=make('span');entry.state.className='trip-album-pending-state';entry.state.setAttribute('role','status');
     entry.bar=make('progress');entry.bar.max=100;entry.bar.setAttribute('aria-label','Upload progress for '+entry.file.name);
     tile.append(preview,remove,name,entry.state,entry.bar);queue.append(tile);
    }
    entry.tile.dataset.phase=entry.phase;entry.remove.disabled=uploading;
    entry.state.textContent=entry.message||((entry.file.size/1024/1024).toFixed(1)+' MB · Ready');
    entry.bar.hidden=!['uploading','saving'].includes(entry.phase);entry.bar.value=entry.percent||0;
   }
   const eligible=pending.filter(p=>['ready','error'].includes(p.phase));send.disabled=uploading||!eligible.length;
   send.textContent=uploading?'Uploading…':pending.some(p=>p.phase==='error')?'Retry upload':'Upload to album';
   choose.disabled=file.disabled=caption.disabled=uploading;stop.hidden=!uploading;
  }
  add.onclick=()=>{if(uploading){queue.scrollIntoView({block:'nearest'});return}form.hidden=!form.hidden;add.setAttribute('aria-expanded',String(!form.hidden));if(!form.hidden)choose.focus()};add.setAttribute('aria-expanded','false');
  file.onchange=()=>{
   if(uploading)return;const chosen=Array.from(file.files||[]);file.value='';if(!chosen.length)return;
   if(chosen.length+pending.length>10){error('Choose up to 10 files at a time. Remove a selection before adding more.');return}
   const types={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',mov:'video/quicktime',mp4:'video/mp4',m4v:'video/mp4',webm:'video/webm'};
   for(const photo of chosen){
    if(pending.some(p=>p.file.name===photo.name&&p.file.size===photo.size&&p.file.lastModified===photo.lastModified))continue;
    const type=photo.type&&photo.type!=='application/octet-stream'?photo.type.toLowerCase():types[photo.name.split('.').pop().toLowerCase()]||'';
    const limit=52428800;let message='';
    if(!Object.values(types).includes(type))message='Unsupported format. Use JPG, PNG, WebP, MP4, MOV or WebM.';
    else if(!photo.size)message='Empty file. Download it from iCloud and choose it again.';
    else if(photo.size>limit)message=(photo.size/1024/1024).toFixed(1)+' MB — over the '+(limit/1024/1024)+' MB limit. '+(type.startsWith('video/')?'Trim or export a smaller clip.':'Choose a smaller photo.');
    pending.push({file:photo,type,id:crypto.randomUUID(),phase:message?'invalid':'ready',message,url:message?null:URL.createObjectURL(photo)});
   }
   renderPending();const count=pending.filter(p=>p.phase==='ready').length;
   if(pending.some(p=>p.phase==='invalid'))error(count?count+' ready. Remove or replace the highlighted files.':'These files cannot be uploaded. See the reason below each preview.');else info(count+' selected · Preview and upload here in Trip Center.');
   queue.scrollIntoView({block:'nearest'});
  };
  form.onsubmit=async event=>{
   event.preventDefault();if(uploading||send.disabled)return;
   if(!api.upload){error('Reopen this trip to load the new uploader, then choose your files again.');return}
   const batch=pending.filter(p=>['ready','error'].includes(p.phase));if(!batch.length)return;
   const batchId=batch.find(p=>p.batchId)?.batchId||crypto.randomUUID();for(const entry of batch)entry.batchId??=batchId;
   uploading=true;uploadController=new AbortController();let uploaded=0;renderPending();
   try{
    for(const next of batch){
     if(!valid()||uploadController.signal.aborted)break;
     next.phase='uploading';next.message='Uploading · 0%';next.percent=0;next.caption??=caption.value;
     info('Uploading '+(uploaded+1)+' of '+batch.length+' · Keep Trip Center open.');renderPending();
     try{
      await api.upload(path+'/file',next.file,{type:next.type,id:next.id,batchId:next.batchId,caption:next.caption,signal:uploadController.signal,onProgress:percent=>{
       if(!valid())return;next.percent=percent;next.phase=percent===100?'saving':'uploading';next.message=percent===100?'Saving to album…':'Uploading · '+percent+'%';renderPending();
      }});
      next.phase='done';next.message='Added to album';uploaded++;renderPending();
     }catch(e){next.phase='error';next.message=e.name==='AbortError'?'Upload stopped. Retry when ready.':e.message||'Upload failed. Retry when ready.';throw e}
    }
    if(valid()){await load(false);info(uploaded+' added to the trip album.');if(!pending.length)caption.value=''}
   }catch(e){if(valid()){await load(false);error((uploaded?uploaded+' added. ':'')+(e.name==='AbortError'?'Upload stopped.':e.message||'Upload failed.')+' Your remaining selections are here to retry.')}}
   finally{uploading=false;uploadController=null;if(valid())renderPending()}
  };
  more.onclick=()=>load(true);refresh.onclick=()=>load(false);void load(false);
  return {isUploading(){return uploading},destroy(){disposed=true;clearThumbs();uploadController?.abort();viewSequence++;viewer.close();clearViewer();viewer.remove();for(const entry of pending)release(entry);section.remove();pending=[]}};
 }};
})();
