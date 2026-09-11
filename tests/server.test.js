import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createApp} from '../backend/http.js';
import {googleRequest,visionText,extractDocument} from '../backend/providers.js';
const configured={GEMINI_API_KEY:'test-gemini',GOOGLE_VISION_API_KEY:'test-vision',APP_ACCESS_CODE:'family-test-code',SESSION_SECRET:'a'.repeat(40),APP_ORIGIN:'http://localhost',DAILY_SCAN_LIMIT:'2'};
async function fixture(t,env={},extract=async()=>({status:'needs_help',points:null})){const s=http.createServer(createApp({env,extract}));await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>s.close(r)));return 'http://127.0.0.1:'+s.address().port;}
async function unlock(url){const r=await fetch(url+'/api/session',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({code:configured.APP_ACCESS_CODE})});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);return r.headers.get('set-cookie').split(';')[0];}
test('unconfigured cloud stays unavailable; static server does not expose secrets or crash on bad URLs',async t=>{
  const url=await fixture(t);assert.equal((await (await fetch(url+'/api/config')).json()).cloudAvailable,false);
  assert.equal((await fetch(url+'/api/extract',{method:'POST',headers:{Origin:'http://127.0.0.1:5173'}})).status,503);
  for(const name of ['/.env','/server.js','/%E0%A4%A','/%2e%2e%5cpackage.json'])assert.ok((await fetch(url+name)).status>=400);
  const r=await fetch(url+'/');assert.equal(r.status,200);assert.ok(r.headers.get('content-security-policy').includes("object-src 'none'"));
});
test('cloud requires origin, session, consent, supported MIME, and respects scan allowance',async t=>{
  let calls=0;const url=await fixture(t,configured,async()=>{calls++;return {status:'needs_help',points:null};});
  assert.equal((await fetch(url+'/api/extract',{method:'POST',headers:{Origin:'https://other.example'}})).status,403);
  assert.equal((await fetch(url+'/api/extract',{method:'POST',headers:{Origin:'http://localhost'}})).status,401);
  const cookie=await unlock(url);const headers={Origin:'http://localhost',Cookie:cookie,'Content-Type':'image/png','X-Document-Consent':'google'};
  const missing={...headers};delete missing['X-Document-Consent'];assert.equal((await fetch(url+'/api/extract',{method:'POST',headers:missing,body:'test'})).status,400);
  assert.equal((await fetch(url+'/api/extract',{method:'POST',headers:{...headers,'Content-Type':'image/svg+xml'},body:'test'})).status,415);
  for(let i=0;i<2;i++)assert.equal((await fetch(url+'/api/extract',{method:'POST',headers,body:'test'})).status,200);
  assert.equal((await fetch(url+'/api/extract',{method:'POST',headers,body:'test'})).status,429);assert.equal(calls,2);
});
test('login brute force is bounded',async t=>{
  const url=await fixture(t,configured);for(let i=0;i<5;i++)assert.equal((await fetch(url+'/api/session',{method:'POST',headers:{Origin:'http://localhost'},body:'{"code":"incorrect"}'})).status,401);
  assert.equal((await fetch(url+'/api/session',{method:'POST',headers:{Origin:'http://localhost'},body:'{"code":"incorrect"}'})).status,429);
});
test('production requires a configured https origin',()=>assert.throws(()=>createApp({env:{NODE_ENV:'production'}})));
test('provider auth errors are not retried and response bodies never leak',async()=>{
  let calls=0;await assert.rejects(()=>googleRequest('https://example.test','secret',{}, {fetchImpl:async()=>{calls++;return new Response('secret document text',{status:403});}}),/unavailable/);assert.equal(calls,1);
});
test('numeric word confidence takes the lowest word, not page average',()=>{
  const r=visionText({responses:[{fullTextAnnotation:{text:'14.1 120.2',pages:[{blocks:[{paragraphs:[{words:[{symbols:[{text:'14.1'}],confidence:.99},{symbols:[{text:'120.2'}],confidence:.4}]}]}]}]}}]});assert.equal(r.confidence,.4);
});
test('invalid image never reaches a paid provider',async()=>{
  let calls=0;await assert.rejects(()=>extractDocument(Buffer.from('not an image'),configured,{fetchImpl:async()=>{calls++;}}),/image could not be opened/);assert.equal(calls,0);
});
test('provider response size is bounded while streaming',async()=>{
  let cancelled=false;
  const stream=new ReadableStream({pull(c){c.enqueue(new Uint8Array(1_000_001));},cancel(){cancelled=true;}});
  await assert.rejects(()=>googleRequest('https://example.test','test',{}, {fetchImpl:async()=>new Response(stream)}),/too much text/);
  assert.equal(cancelled,true);
});

test('Gemini-only provider uses exact model and JSON schema without calling Vision',async()=>{
  const {extractPreparedDocument}=await import('../backend/google.js');let calls=0;
  const result=await extractPreparedDocument(new Uint8Array([1]),{GEMINI_API_KEY:'test'},{fetchImpl:async(url,options)=>{
    calls++;assert.match(url,/models\/gemini-3.5-flash-lite:generateContent$/);
    const body=JSON.parse(options.body);assert.equal(body.generationConfig.responseMimeType,'application/json');assert.ok(body.generationConfig.responseJsonSchema);
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({kind:'unreadable',datum:'unknown',datumEvidence:'',complete:false,multipleLots:false,unclearFields:['blur'],coordinateRows:[],courses:[],reference:'',statedAreaM2:null,areaEvidence:''})}]}}]});
  }});
  assert.equal(calls,1);assert.equal(result.engine,'Gemini');assert.equal(result.status,'needs_help');
});
