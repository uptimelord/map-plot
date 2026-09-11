import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {extractDocument,ServiceError} from './providers.js';

const ROOT=fileURLToPath(new URL('../dist/',import.meta.url));
const MAX_BYTES=15*1024*1024;
const digest=s=>crypto.createHash('sha256').update(s).digest();
const equal=(a,b)=>crypto.timingSafeEqual(digest(a),digest(b));
const cookieName='lotlens_session';
import {securityHeaders as headers} from './security.js';

export function createApp({env=process.env,extract=extractDocument,now=Date.now}={}) {
  const production=env.NODE_ENV==='production';
  const configured=Boolean(env.GEMINI_API_KEY&&env.APP_ACCESS_CODE?.length>=12&&env.SESSION_SECRET?.length>=32);
  const origin=env.APP_ORIGIN||'http://127.0.0.1:5173';
  if(production&&(!env.APP_ORIGIN||!origin.startsWith('https://')))throw Error('Production requires APP_ORIGIN=https://your-host');
  const sessions=new Map(),attempts=new Map();
  const dailyLimit=Number(env.DAILY_SCAN_LIMIT||100);
  if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>10000)throw Error('DAILY_SCAN_LIMIT must be between 1 and 10000.');
  let inflight=0,daily=0,day='';
  // Single-process accounting: also configure persistent Google-side quotas.
  function limit(id,max,window){
    if(attempts.size>10000){for(const [k,v] of attempts)if(v.until<now())attempts.delete(k);if(attempts.size>10000)throw new ServiceError('The service is busy. Try again later.',503);}
    let x=attempts.get(id);if(!x||x.until<now())x={count:0,until:now()+window};x.count++;attempts.set(id,x);if(x.count>max)throw new ServiceError('Too many attempts. Please wait a few minutes.',429);
  }
  function session(req){
    const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
    if(!token)return null;
    const s=sessions.get(token);if(!s||s.expires<now()){sessions.delete(token);return null;}return token;
  }
  const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(data));};
  async function body(req,max){
    if(Number(req.headers['content-length'])>max)throw new ServiceError('The photo is too large. Please use one under 15 MB.',413);
    let size=0;const chunks=[];
    for await(const chunk of req){size+=chunk.length;if(size>max)throw new ServiceError('The photo is too large. Please use one under 15 MB.',413);chunks.push(chunk);}
    return Buffer.concat(chunks);
  }
  return async function handler(req,res){
    for(const [k,v] of Object.entries(headers))res.setHeader(k,v);
    if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
    const started=now(),requestId=crypto.randomUUID();res.setHeader('X-Request-ID',requestId);
    let route='';
    try {
      route=new URL(req.url,origin).pathname;
      if(route.startsWith('/server/')||route.startsWith('/.openai/'))throw new ServiceError('Not found.',404);
      if(route==='/api/config'&&req.method==='GET')return send(res,200,{cloudAvailable:configured,visionEnabled:!!env.GOOGLE_VISION_API_KEY,authenticated:!!session(req),country:'Philippines'});
      if(route==='/healthz'&&req.method==='GET')return send(res,200,{ok:true});
      if(route.startsWith('/api/')) {
        if(req.method!=='POST')throw new ServiceError('This action is not available.',405);
        if(req.headers.origin!==origin)throw new ServiceError('Open the app from its normal address and try again.',403);
        if(!configured)throw new ServiceError('Google reading has not been set up. You can still use free device reading.',503);
        if(route==='/api/session') {
          limit('login:'+req.socket.remoteAddress,5,10*60*1000);
          let value;try{value=JSON.parse((await body(req,1024)).toString());}catch{throw new ServiceError('Enter the access code provided by your helper.',400);}
          if(typeof value.code!=='string'||!equal(value.code,env.APP_ACCESS_CODE))throw new ServiceError('That access code is not correct.',401);
          for(const [k,v] of sessions)if(v.expires<now())sessions.delete(k);
          if(sessions.size>=1000)throw new ServiceError('The service is busy. Please try again later.',503);
          const token=crypto.createHmac('sha256',env.SESSION_SECRET).update(crypto.randomBytes(32)).digest('base64url');sessions.set(token,{expires:now()+12*3600*1000});
          res.setHeader('Set-Cookie',`${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${production?'; Secure':''}`);
          return send(res,200,{ok:true});
        }
        const s=session(req);if(!s)throw new ServiceError('Ask your helper to unlock Google reading on this device.',401);
        if(route==='/api/logout'){sessions.delete(s);res.setHeader('Set-Cookie',`${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${production?'; Secure':''}`);return send(res,200,{ok:true});}
        if(route!=='/api/extract')throw new ServiceError('This action is not available.',404);
        if(!['image/jpeg','image/png','image/webp'].includes(req.headers['content-type']))throw new ServiceError('Choose a JPG, PNG, or WEBP photo.',415);
        if(req.headers['x-document-consent']!=='google')throw new ServiceError('Allow Google to read the document before sending it.',400);
        limit('scan:'+s,6,60000);
        const today=new Date(now()).toISOString().slice(0,10);if(today!==day){day=today;daily=0;}
        if(daily>=dailyLimit)throw new ServiceError('Today’s reading allowance has been reached. Try again tomorrow or use device reading.',429);
        if(inflight>=2)throw new ServiceError('Another document is being read. Please try again shortly.',429);
        inflight++;
        const controller=new AbortController();
        const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnect);
        try {
          const input=await body(req,MAX_BYTES);if(!input.length)throw new ServiceError('Choose a photo first.',400);
          daily++;const result=await extract(input,env,{signal:controller.signal});
          if(!res.destroyed)send(res,200,{...result,requestId});
        } finally {inflight--;res.off('close',disconnect);}
        return;
      }
      if(!['GET','HEAD'].includes(req.method))throw new ServiceError('This action is not available.',405);
      let decoded;try{decoded=decodeURIComponent(route);}catch{throw new ServiceError('Invalid address.',400);}
      if(decoded.includes('\0')||decoded.includes('\\'))throw new ServiceError('Invalid address.',400);
      const file=path.resolve(ROOT,'.'+(decoded==='/'?'/index.html':decoded));
      if(!file.startsWith(ROOT)||path.relative(ROOT,file).startsWith('..'))throw new ServiceError('Not found.',404);
      const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.wasm':'application/wasm'}[path.extname(file)];
      if(!mime)throw new ServiceError('Not found.',404);
      let data;try{data=await fs.readFile(file);}catch{throw new ServiceError('Not found.',404);}
      res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache'}).end(req.method==='HEAD'?undefined:data);
    } catch(e) {
      if(!res.headersSent&&!res.destroyed)send(res,e instanceof ServiceError?e.status:500,{error:e instanceof ServiceError?e.message:'We could not finish reading. Please try again.',requestId});
    } finally {
      if(env.LOG_REQUESTS==='true')console.info(JSON.stringify({requestId,route:route.startsWith('/api/')?'api':'page',status:res.statusCode,durationMs:now()-started}));
    }
  };
}
export function startServer(){
  const server=http.createServer(createApp());server.requestTimeout=75000;server.headersTimeout=10000;
  server.listen(Number(process.env.PORT||5173),process.env.HOST||'127.0.0.1',()=>console.log(`Local: http://${process.env.HOST||'127.0.0.1'}:${process.env.PORT||5173}`));
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)));
  return server;
}
