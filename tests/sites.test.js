import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import {DatabaseSync} from 'node:sqlite';
import {createSitesHandler,validatePreparedPng} from '../backend/sites-handler.js';
import {reserveQuota,acquireLease,releaseLease} from '../backend/quota.js';
function database(t){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(fs.readFileSync('drizzle/0000_rich_nomad.sql','utf8'));t.after(()=>sqlite.close());
  const wrap=(sql,args=[])=>({bind:(...values)=>wrap(sql,values),first:async()=>sqlite.prepare(sql).get(...args)||null,run:async()=>sqlite.prepare(sql).run(...args)});
  return {prepare:sql=>wrap(sql),batch:async statements=>{sqlite.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
}
const image=()=>sharp({create:{width:800,height:800,channels:3,background:'white'}}).png().toBuffer();
test('durable quota cannot be reset by making a new handler',async t=>{
  const DB=database(t);await reserveQuota(DB,'daily',2,99999);await reserveQuota(DB,'daily',2,99999);await assert.rejects(()=>reserveQuota(DB,'daily',2,99999),/allowance/);
  await acquireLease(DB,'one',100);await acquireLease(DB,'two',100);await assert.rejects(()=>acquireLease(DB,'three',100),/Other documents/);await releaseLease(DB,'one');await acquireLease(DB,'three',100);
});
test('Sites API requires dispatcher identity and consent; shares durable cap across instances',async t=>{
  const env={DB:database(t),GEMINI_API_KEY:'test',GOOGLE_VISION_API_KEY:'test',QUOTA_SALT:'x'.repeat(32),DAILY_SCAN_LIMIT:'1'};
  let calls=0;const extract=async()=>{calls++;return {status:'needs_help',points:null};};
  const handler=createSitesHandler({extract,now:()=>100000}),handler2=createSitesHandler({extract,now:()=>100000});
  const payload=await image();const headers={'Origin':'https://lotlens.example','Content-Type':'image/png','X-Document-Consent':'google','oai-authenticated-user-id':'test-user'};
  const req=h=>new Request('https://lotlens.example/api/extract',{method:'POST',headers:h,body:payload});
  const missing={...headers};delete missing['oai-authenticated-user-id'];assert.equal((await handler(req(missing),env)).status,401);
  assert.equal((await handler(req({...headers,Origin:'https://evil.test'}),env)).status,403);
  assert.equal((await handler(req({...headers,'X-Document-Consent':''}),env)).status,400);
  assert.equal((await handler(req(headers),env)).status,200);
  assert.equal((await handler2(req(headers),env)).status,429);assert.equal(calls,1);
});
test('Sites static assets and unconfigured status work without a database',async()=>{
  const handler=createSitesHandler({assets:{'/index.html':{body:'test page',type:'text/html'}}});
  assert.equal(await (await handler(new Request('https://lotlens.example/'),{})).text(),'test page');
  assert.equal((await (await handler(new Request('https://lotlens.example/api/config'),{})).json()).cloudAvailable,false);
  assert.equal((await handler(new Request('https://lotlens.example/.env'),{})).status,404);
});
test('prepared image framing rejects truncated, huge, and non-PNG inputs',async()=>{
  const png=await image();assert.doesNotThrow(()=>validatePreparedPng(png));
  assert.throws(()=>validatePreparedPng(png.subarray(0,35)));assert.throws(()=>validatePreparedPng(new Uint8Array(100)));
  const oversized=Buffer.from(png);oversized.writeUInt32BE(100000,16);assert.throws(()=>validatePreparedPng(oversized));
});
