import {securityHeaders} from './security.js';
import {extractPreparedDocument,ServiceError} from './google.js';
import {reserveQuota,acquireLease,releaseLease,pruneQuota} from './quota.js';

const MAX_UPLOAD=6*1024*1024;
export function validatePreparedPng(bytes){
  const signature=[137,80,78,71,13,10,26,10];
  if(bytes.length<45||bytes.length>MAX_UPLOAD||signature.some((v,i)=>bytes[i]!==v)||String.fromCharCode(...bytes.slice(12,16))!=='IHDR')throw new ServiceError('The prepared image is invalid. Please choose the photo again.',422);
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=view.getUint32(16),height=view.getUint32(20);
  if(width<600||height<600||width*height>9_000_000||Math.max(width,height)>3400)throw new ServiceError('Please photograph the complete description clearly, then try again.',422);
  // Framing validation without inflating image bytes in a 128 MB Worker.
  let offset=8,idat=false,end=false;
  while(offset+12<=bytes.length){const size=view.getUint32(offset);if(size>MAX_UPLOAD||offset+size+12>bytes.length)throw new ServiceError('The image is incomplete. Choose the photo again.',422);const type=String.fromCharCode(...bytes.slice(offset+4,offset+8));if(type==='acTL')throw new ServiceError('Animated images are not supported.',422);if(type==='IDAT')idat=true;if(type==='IEND'){end=size===0&&offset+12===bytes.length;break;}offset+=size+12;}
  if(!idat||!end)throw new ServiceError('The image is incomplete. Choose the photo again.',422);
}
async function readBody(request){
  if(Number(request.headers.get('content-length'))>MAX_UPLOAD)throw new ServiceError('The prepared photo is too large. Please retake it closer to the description.',413);
  if(!request.body)throw new ServiceError('Choose a photo first.',400);
  const reader=request.body.getReader(),chunks=[];let total=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>MAX_UPLOAD)throw new ServiceError('The prepared photo is too large. Please retake it closer to the description.',413);chunks.push(value);}}catch(e){await reader.cancel();throw e;}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...securityHeaders,'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export function createSitesHandler({assets={},extract=extractPreparedDocument,now=Date.now}={}){
  return async (request,env,ctx={waitUntil:()=>{}})=>{
    const url=new URL(request.url),id=crypto.randomUUID();
    try{
      const configured=Boolean(env.DB&&env.GEMINI_API_KEY&&env.QUOTA_SALT?.length>=32);
      // These headers are trustworthy ONLY behind the Sites dispatcher, which
      // sets them. Never expose this Worker under a bypass workers.dev route.
      const user=request.headers.get('oai-authenticated-user-id');
      if(url.pathname==='/api/config'&&request.method==='GET')return json({cloudAvailable:configured,visionEnabled:!!env.GOOGLE_VISION_API_KEY,authenticated:!!user,authMode:'chatgpt',country:'Philippines'});
      if(url.pathname==='/healthz')return json({ok:true});
      if(url.pathname.startsWith('/api/')){
        if(url.pathname!=='/api/extract'||request.method!=='POST')throw new ServiceError('This action is not available.',405);
        if(!configured)throw new ServiceError('Google reading is not configured. You can use device reading.',503);
        if(!user)throw new ServiceError('Sign in to ChatGPT to use Google reading.',401);
        if(request.headers.get('origin')!==url.origin)throw new ServiceError('Open the app from its normal address and try again.',403);
        if(request.headers.get('x-document-consent')!=='google')throw new ServiceError('Allow Google to read the document before sending it.',400);
        if(request.headers.get('content-type')!=='image/png')throw new ServiceError('Please select the photo using the app.',415);
        const cap=Number(env.DAILY_SCAN_LIMIT||100);if(!Number.isInteger(cap)||cap<1||cap>10000)throw new ServiceError('The reading allowance needs to be configured by the owner.',503);
        const time=now(),minute=Math.floor(time/60000),day=Math.floor(time/86400000);
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.QUOTA_SALT+':'+user)))).map(v=>v.toString(16).padStart(2,'0')).join('');
        await reserveQuota(env.DB,'user:'+hash+':'+minute,6,(minute+2)*60000);
        const bytes=await readBody(request);validatePreparedPng(bytes);
        // Start the paid-work lease only after the upload finishes. Slow uploads
        // must not consume the lease's 90-second provider execution window.
        await acquireLease(env.DB,id,now());
        try{
          await reserveQuota(env.DB,'day:'+day,cap,(day+2)*86400000);
          const result=await extract(bytes,env,{signal:request.signal});
          return json({...result,requestId:id});
        }finally{
          await releaseLease(env.DB,id);
          ctx.waitUntil(pruneQuota(env.DB,time).catch(()=>{}));
        }
      }
      const asset=assets[url.pathname==='/'?'/index.html':url.pathname];
      if(!asset||!['GET','HEAD'].includes(request.method))return new Response('Not found',{status:404});
      return new Response(request.method==='HEAD'?null:asset.body,{headers:{...securityHeaders,'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(self), microphone=(), geolocation=()'}});
    }catch(e){return json({error:e instanceof ServiceError?e.message:'The reading service is temporarily unavailable. Please try again.',requestId:id},e instanceof ServiceError?e.status:503);}
  };
}
