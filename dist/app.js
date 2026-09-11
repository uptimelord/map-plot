import {parseCoordinates,parseBearings,metrics,kml} from './geo.js';
import {assessLocal} from './extraction.js';
const $=id=>document.getElementById(id);
const sample='14.112480, 120.954680\n14.112580, 120.955120\n14.112130, 120.955390\n14.111900, 120.955010\n14.112090, 120.954630';
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
let points=[],mode='gps',map,markers=[],ready=false,result=null,selectedFile=null,photoURL=null,active=null,config={cloudAvailable:false,authenticated:false},spoken=false;
const empty={type:'FeatureCollection',features:[]};
const style={version:8,sources:{satellite:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:19,attribution:'Imagery © Esri, Maxar, Earthstar Geographics and the GIS User Community'},streets:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'},lot:{type:'geojson',data:empty}},layers:[{id:'satellite',type:'raster',source:'satellite'},{id:'streets',type:'raster',source:'streets',layout:{visibility:'none'}},{id:'lot-fill',type:'fill',source:'lot',paint:{'fill-color':'#d5ee93','fill-opacity':.22}},{id:'lot-line',type:'line',source:'lot',paint:{'line-color':'#efffc0','line-width':4}}]};

function status(title,message,warning=false){
  $('status-title').textContent=title;$('ocr-status').textContent=message;$('reading-panel').classList.toggle('needs-help',warning);
  if(spoken&&'speechSynthesis'in window){speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(title+'. '+message));}
}
function mapData(){
  markers.forEach(m=>m.remove());markers=[];
  if(!ready)return;
  map.getSource('lot').setData(points.length?{type:'Feature',properties:{approximate:true},geometry:{type:'Polygon',coordinates:[[...points,points[0]]]}}:empty);
  markers=points.map((p,i)=>{const el=document.createElement('div');el.className='corner';el.textContent=i+1;el.setAttribute('aria-label','Corner '+(i+1));return new maplibregl.Marker({element:el}).setLngLat(p).addTo(map);});
}
function fit(){
  if(!ready||!points.length)return;
  const b=new maplibregl.LngLatBounds();points.forEach(p=>b.extend(p));
  const h=$('map').clientHeight,card=$('lot-card').offsetHeight;
  map.fitBounds(b,{padding:{top:160,bottom:Math.min(card+80,h-240),left:60,right:70},maxZoom:19,duration:reduced?0:800});
}
try{
  if(!window.maplibregl)throw Error('The map could not load. Check your internet connection.');
  map=new maplibregl.Map({container:'map',style,center:[122,12],zoom:4,attributionControl:true});
  map.addControl(new maplibregl.ScaleControl({maxWidth:90,unit:'metric'}),'bottom-left');
  map.on('load',()=>{ready=true;mapData();fit();});
  map.on('error',()=>{$('map-error').hidden=false;$('map-error').textContent='The map imagery could not load. Try Streets or check your internet connection.';});
  map.on('idle',()=>{if(map.areTilesLoaded())$('map-error').hidden=true;});
}catch(e){$('map-error').hidden=false;$('map-error').textContent=e.message;}

function clearResult(){
  points=[];result=null;$('view-result').hidden=true;mapData();$('lot-card').hidden=true;$('empty-map').hidden=false;
  $('results').classList.remove('has-result','shape-result');$('export').disabled=true;$('google').hidden=true;
  $('lot-name').textContent='No mapped boundary';$('lot-location').textContent='Philippines';$('helper-report').hidden=true;
  $('raw').value='';$('bearings').value='';$('helper-confirm').checked=false;$('input-error').textContent='';$('points-panel').hidden=true;
  $('points-toggle').textContent='Show corners';$('ocr-details').hidden=true;
}
function drawShape(shape){
  const svg=$('shape');svg.replaceChildren();
  const xs=shape.xy.map(p=>p[0]),ys=shape.xy.map(p=>p[1]);const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const scale=Math.min(340/Math.max(1,maxX-minX),160/Math.max(1,maxY-minY));
  const list=shape.xy.map(([x,y])=>[200+(x-(minX+maxX)/2)*scale,110-(y-(minY+maxY)/2)*scale]);
  const polygon=document.createElementNS('http://www.w3.org/2000/svg','polygon');polygon.setAttribute('points',list.map(p=>p.join(',')).join(' '));polygon.setAttribute('fill','#dcebb7');polygon.setAttribute('stroke','#426937');polygon.setAttribute('stroke-width','3');svg.append(polygon);
  list.forEach((p,i)=>{const t=document.createElementNS('http://www.w3.org/2000/svg','text');t.setAttribute('x',p[0]);t.setAttribute('y',p[1]-8);t.setAttribute('text-anchor','middle');t.setAttribute('font-size','16');t.setAttribute('fill','#203e2e');t.textContent=i+1;svg.append(t);});
}
function display(next){
  result=next;points=next.points||[];$('raw').value=(next.coordinateRows||[]).join('\n');$('bearings').value=(next.courses||[]).join('\n');
  $('helper-report').hidden=false;mapData();
  if(next.status==='needs_help'){status('A little help is needed',next.message,true);return;}
  $('view-result').hidden=false;
  const shapeOnly=next.status==='shape_only';
  $('results').classList.add('has-result');$('results').classList.toggle('shape-result',shapeOnly);$('lot-card').hidden=false;$('empty-map').hidden=true;
  $('shape-container').hidden=!shapeOnly;if(shapeOnly)drawShape(next.shape);
  $('card-title').textContent=next.sample?'Example lot':shapeOnly?'Your lot’s shape':'Your approximate outline';
  $('result-badge').textContent=next.sample?'Example':shapeOnly?'Not located':'Approximate';
  $('lot-name').textContent=next.sample?'Example only':shapeOnly?'Shape only':'Your document';
  $('lot-location').textContent=shapeOnly?'Reference needed':'WGS 84';
  const m=shapeOnly?next.shape:metrics(points);
  $('area').innerHTML=m.area.toLocaleString(undefined,{maximumFractionDigits:0})+'<small> m²</small>';
  $('perimeter').innerHTML=m.perimeter.toFixed(1)+'<small> m</small>';
  $('point-count').textContent=shapeOnly?next.shape.xy.length:points.length;
  $('boundary-status').textContent=shapeOnly?'Earth location has not been established.':next.sample?'Example boundary. This is not your property.':'Geometry checks passed. Survey verification is still needed.';
  $('export').disabled=!points.length;$('google').hidden=!points.length;$('points-toggle').hidden=!points.length;
  $('points-list').replaceChildren(...points.map((p,i)=>{const row=document.createElement('div');row.className='point-row';for(const v of [i+1,p[1].toFixed(7),p[0].toFixed(7)]){const el=document.createElement('span');el.textContent=v;row.append(el);}return row;}));
  if(points.length){const c=points.reduce((a,p)=>[a[0]+p[0]/points.length,a[1]+p[1]/points.length],[0,0]);$('google').href='https://www.google.com/maps/search/?api=1&query='+c[1]+','+c[0];}
  status(shapeOnly?'We found the lot’s shape':next.sample?'Example loaded':'Your outline is ready',next.message,shapeOnly);
  requestAnimationFrame(()=>{map?.resize();fit();});
}
function setBusy(busy){
  for(const id of ['file','camera','retry','demo','plot','cloud-consent'])$(id).disabled=busy;
  for(const id of ['camera-label','file-label'])$(id).setAttribute('aria-disabled',String(busy));
  $('cancel').hidden=!busy;$('progress').hidden=!busy;
}
function cancel(){if(active){active.controller.abort();active.worker?.terminate().catch(()=>{});active=null;setBusy(false);status('Reading cancelled','Your photo has not been mapped. Choose another photo or tap Read again.');}}
function loadOCR(){
  if(window.Tesseract)return Promise.resolve();
  return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/tesseract.js@6/dist/tesseract.min.js';script.onload=resolve;script.onerror=()=>{script.remove();reject(Error('Free reading could not load. Check your internet connection.'));};document.head.append(script);});
}
async function preparePhoto(file){
  let image;
  try{image=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{throw Error('This photo cannot be opened. Use a JPG, PNG, or WEBP image.');}
  try{
    if(image.width*image.height>40000000)throw Error('This photo is too large to process. Use a normal-resolution photo under 40 megapixels.');
    if(Math.min(image.width,image.height)<600)throw Error('This photo is too small. Move closer and take another photo of the whole description.');
    const scale=Math.min(1,2600/image.width,3400/image.height),canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const original=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    for(let i=0;i<pixels.data.length;i+=4){const v=.299*pixels.data[i]+.587*pixels.data[i+1]+.114*pixels.data[i+2];pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=Math.max(0,Math.min(255,(v-128)*1.2+128));}
    ctx.putImageData(pixels,0,0);const enhanced=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));canvas.width=canvas.height=0;
    if(!original||!enhanced)throw Error('The photo could not be prepared. Please try again.');return {original,enhanced};
  }finally{image.close();}
}
function ocrConfidence(data){
  const words=(data.blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>(p.lines||[]).flatMap(l=>l.words||[]))).filter(w=>/\d/.test(w.text));
  return words.length?Math.min(...words.map(w=>w.confidence||0)):0;
}
async function localRead(file,run){
  status('Preparing your photo','Please keep this page open. Nothing is uploaded.');
  const image=await preparePhoto(file);if(run.controller.signal.aborted)throw Error('Cancelled');await loadOCR();
  const w=await Tesseract.createWorker('eng',1,{logger:m=>{if(active===run&&m.status==='recognizing text')$('progress').value=Math.round((run.pass===2?50:0)+m.progress*50);}});
  run.worker=w;if(run.controller.signal.aborted){await w.terminate();throw Error('Cancelled');}
  status('Reading the small numbers','We read the photo twice and compare the results.');
  run.pass=1;const first=await w.recognize(image.original,{}, {text:true,blocks:true});
  if(run.controller.signal.aborted)throw Error('Cancelled');
  run.pass=2;const second=await w.recognize(image.enhanced,{}, {text:true,blocks:true});
  if(active!==run)throw Error('Cancelled');
  $('ocr-text').textContent=first.data.text;$('ocr-details').hidden=false;
  return {...assessLocal({text:first.data.text,confidence:ocrConfidence(first.data)},{text:second.data.text,confidence:ocrConfidence(second.data)}),engine:'Two device OCR passes',readAt:new Date().toISOString()};
}
async function cloudRead(file,run){
  if(!config.authenticated){if(config.authMode!=='chatgpt')$('unlock-dialog').showModal();throw Error(config.authMode==='chatgpt'?'Sign in to ChatGPT, then choose the photo again.':'Ask your helper to unlock Google reading, then tap Read again.');}
  status('Preparing your photo','The photo is being prepared before it is sent to Google.');
  const {original}=await preparePhoto(file);
  if(original.size>6*1024*1024)throw Error('The prepared photo is too large. Take a closer photo of the technical description.');
  if(run.controller.signal.aborted)throw Error('Reading cancelled.');
  status('Reading your document',config.visionEnabled?'Google OCR and Gemini are reading the photo separately.':'Gemini is reading the numbers and preparing a structured outline.');$('progress').removeAttribute('value');
  const response=await fetch('/api/extract',{method:'POST',headers:{'Content-Type':'image/png','X-Document-Consent':'google'},body:original,signal:run.controller.signal});
  const data=await response.json();
  if(!response.ok){if(response.status===401){config.authenticated=false;$('unlock').hidden=false;if(config.authMode!=='chatgpt')$('unlock-dialog').showModal();}throw Error(data.error||'Google reading could not finish. Try again.');}
  return data;
}
async function read(file){
  if(!file||active)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)){status('Please choose a supported photo','Use JPG, PNG, or WEBP. For an iPhone HEIC file, export a JPG copy first.',true);return;}
  if(file.size>15*1024*1024){status('This photo is too large','Choose a photo smaller than 15 MB.',true);return;}
  selectedFile=file;clearResult();
  if(photoURL)URL.revokeObjectURL(photoURL);photoURL=URL.createObjectURL(file);$('document-preview').src=photoURL;$('photo-actions').hidden=false;$('clear').hidden=false;
  const run={controller:new AbortController(),worker:null};active=run;setBusy(true);$('progress').value=0;
  const timer=setTimeout(()=>run.controller.abort('timeout'),90000);
  try{
    const aborted=new Promise((_,reject)=>run.controller.signal.addEventListener('abort',()=>reject(Error(run.controller.signal.reason==='timeout'?'Reading took too long. Please try a clearer photo.':'Reading cancelled.')),{once:true}));
    const task=config.cloudAvailable&&$('cloud-consent').checked?cloudRead(file,run):localRead(file,run);
    const next=await Promise.race([task,aborted]);if(active===run)display(next);
  }catch(e){if(active===run)status('We could not finish',e.message,true);}
  finally{clearTimeout(timer);run.controller.abort();await run.worker?.terminate().catch(()=>{});if(active===run){active=null;setBusy(false);}$('file').value='';$('camera').value='';}
}
for(const id of ['file','camera'])$(id).onchange=e=>read(e.target.files[0]);
for(const [label,input] of [['camera-label','camera'],['file-label','file']])$(label).onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!active)$(input).click();}};
$('retry').onclick=()=>read(selectedFile);$('cancel').onclick=cancel;
$('clear').onclick=()=>{cancel();clearResult();selectedFile=null;if(photoURL)URL.revokeObjectURL(photoURL);photoURL=null;$('document-preview').removeAttribute('src');$('large-photo').removeAttribute('src');$('photo-actions').hidden=true;$('clear').hidden=true;$('ocr-text').textContent='';status('Ready when you are','Choose a new photo. The previous document has been cleared.');};
$('demo').onclick=()=>{if(active)return;clearResult();display({status:'mapped',sample:true,points:parseCoordinates(sample),coordinateRows:sample.split('\n'),message:'This is a fictional example in Tagaytay. Take a photo to read your own document.'});};
function setMode(next){mode=next;$('gps-input').hidden=mode!=='gps';$('bearing-input').hidden=mode!=='bearing';$('gps-tab').classList.toggle('active',mode==='gps');$('bearing-tab').classList.toggle('active',mode==='bearing');}
$('gps-tab').onclick=()=>setMode('gps');$('bearing-tab').onclick=()=>setMode('bearing');
$('plot').onclick=()=>{try{if(!$('helper-confirm').checked)throw Error('Please verify the survey details and tick the checkbox first.');let p;if(mode==='gps')p=parseCoordinates($('raw').value);else{const r=parseBearings($('bearings').value,$('anchor-lat').value,$('anchor-lng').value);if(r.closure>Math.max(.05,metrics(r.points).perimeter/5000))throw Error('The survey lines do not close. Please check the courses.');p=r.points;}if(p.some(([lon,lat])=>lon<116||lon>127.5||lat<4||lat>22))throw Error('The coordinates are outside the supported Philippine region.');display({status:'mapped',points:p,coordinateRows:p.map(p=>p[1]+', '+p[0]),engine:'Helper-entered coordinates',message:'An approximate outline is ready from the helper-checked coordinates.'});$('input-error').textContent='';}catch(e){$('input-error').textContent=e.message;}};
$('fit').onclick=fit;$('zoom-in').onclick=()=>map?.zoomIn();$('zoom-out').onclick=()=>map?.zoomOut();$('north').onclick=()=>map?.easeTo({bearing:0,pitch:0,duration:reduced?0:300});
function projection(globe){if(!ready)return;map.setProjection({type:globe?'globe':'mercator'});for(const id of ['map-view','globe-view']){const yes=id===(globe?'globe-view':'map-view');$(id).classList.toggle('active',yes);$(id).setAttribute('aria-pressed',yes);}if(globe)map.flyTo({center:points[0]||[122,12],zoom:2,pitch:0,duration:reduced?0:1200});else fit();}
$('map-view').onclick=()=>projection(false);$('globe-view').onclick=()=>projection(true);
function layer(name){if(!ready)return;for(const id of ['satellite','streets']){map.setLayoutProperty(id,'visibility',id===name?'visible':'none');$(id).classList.toggle('active',id===name);$(id).setAttribute('aria-pressed',id===name);}$('map-error').hidden=true;}
$('satellite').onclick=()=>layer('satellite');$('streets').onclick=()=>layer('streets');
function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('export').onclick=()=>{if(points.length)download(kml(points),result?.sample?'example-lot.kml':'approximate-lot.kml','application/vnd.google-earth.kml+xml');};
$('helper-report').onclick=()=>{if(result)download(JSON.stringify({app:'LotLens',warning:'Approximate extraction, not a verified survey. Do not treat a shape-only result as a geographic location.',...result},null,2),'lotlens-helper-details.json','application/json');};
$('points-toggle').onclick=()=>{$('points-panel').hidden=!$('points-panel').hidden;$('points-toggle').textContent=$('points-panel').hidden?'Show corners':'Hide corners';requestAnimationFrame(fit);};
$('help').onclick=()=>$('help-dialog').showModal();$('close-help').onclick=()=>$('help-dialog').close();
$('enlarge').onclick=()=>{$('large-photo').src=photoURL;$('photo-dialog').showModal();};$('close-photo').onclick=()=>$('photo-dialog').close();$('photo-zoom').oninput=e=>$('large-photo').style.width=e.target.value+'%';
$('speak').onclick=()=>{if(!('speechSynthesis'in window)){status('Read aloud is unavailable','Your browser does not support read aloud. The same instructions are shown in large text.');return;}spoken=!spoken;$('speak').setAttribute('aria-pressed',spoken);$('speak').textContent=spoken?'Stop voice':'Read aloud';speechSynthesis.cancel();if(spoken)speechSynthesis.speak(new SpeechSynthesisUtterance($('status-title').textContent+'. '+$('ocr-status').textContent));};
$('unlock').onclick=()=>{if(config.authMode==='chatgpt')window.location.href='/signin-with-chatgpt?return_to=%2F';else $('unlock-dialog').showModal();};$('close-unlock').onclick=()=>$('unlock-dialog').close();
$('unlock-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button[type=submit]');button.disabled=true;try{const r=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:$('access-code').value}),signal:AbortSignal.timeout(10000)});const data=await r.json();if(!r.ok)throw Error(data.error||'Could not unlock.');config.authenticated=true;$('unlock').hidden=true;$('unlock-dialog').close();$('unlock-error').textContent='';status('Google reading is unlocked','Choose a photo, or tap Read again for the selected photo.');}catch(e){$('unlock-error').textContent=e.message;}finally{$('access-code').value='';button.disabled=false;}};
fetch('/api/config',{signal:AbortSignal.timeout(5000)}).then(r=>r.ok?r.json():null).then(c=>{if(!c)return;config=c;$('cloud-options').hidden=!c.cloudAvailable;$('unlock').hidden=!c.cloudAvailable||c.authenticated;if(c.authMode==='chatgpt')$('unlock').textContent='Sign in to ChatGPT';$('backend-note').textContent=c.cloudAvailable?(c.authMode==='chatgpt'?'Google reading is available to signed-in visitors.':'Google reading is configured. Your helper can unlock this device with the owner’s access code.'):'Google reading is not configured on this server. The app currently uses free device reading.';}).catch(()=>{});
$('cloud-consent').onchange=()=>{$('engine-status').textContent=$('cloud-consent').checked?'Google OCR + AI · photo sent to Google':'Free reading on this device';};
window.addEventListener('pagehide',()=>{cancel();if(photoURL)URL.revokeObjectURL(photoURL);if('speechSynthesis'in window)speechSynthesis.cancel();});
if(document.modelContext?.registerTool){try{document.modelContext.registerTool({name:'read_lot_boundary',title:'Read lot result',description:'Read the current approximate lot result. Shape-only and needs-help results have no geographic boundary.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>result||{status:'empty',points:null}});}catch{}}

$('view-result').onclick=()=>{$('results').scrollIntoView({behavior:reduced?'instant':'smooth',block:'start'});};
