import test from 'node:test';
import assert from 'node:assert/strict';
import {assessLocal,assessCloud,assessGemini,extractText} from '../dist/extraction.js';
const rows=['14.112480, 120.954680','14.112580, 120.955120','14.112130, 120.955390','14.111900, 120.955010','14.112090, 120.954630'];
const text='WGS 84\nTotal points: 5\n'+rows.join('\n');
const model=()=>({kind:'gps',datum:'WGS84',datumEvidence:'WGS 84',complete:true,multipleLots:false,unclearFields:[],coordinateRows:[...rows],courses:[],reference:'',statedAreaM2:null,areaEvidence:''});
const scan=t=>({text:t,confidence:96});
test('two matching complete local readings map a valid Philippine lot',()=>assert.equal(assessLocal(scan(text),scan(text)).status,'mapped'));
test('partial, unknown datum, low confidence, and inconsistent local readings do not map',()=>{
  for(const pair of [[text.replace('Total points: 5',''),text.replace('Total points: 5','')],[text.replace('WGS 84','PRS92'),text],[text,text.replace('14.112480','14.112490')]])assert.equal(assessLocal(scan(pair[0]),scan(pair[1])).status,'needs_help');
  assert.equal(assessLocal({...scan(text),confidence:70},scan(text)).status,'needs_help');
});
test('point labels are stripped but malformed numeric lines are retained as suspicious',()=>{
  const r=extractText('1. 14.112480, 120.954680\n2. 14.112I30, 120.955390');assert.equal(r.rows.length,1);
});
test('cloud accepts matching explicit WGS84 and blocks disagreements and dubious metadata',()=>{
  assert.equal(assessCloud(model(),{text,confidence:.99}).status,'mapped');
  for(const change of [{complete:false},{multipleLots:true},{unclearFields:['corner 1']},{datum:'PRS92'},{datumEvidence:'WGS 84 GPS survey'},{statedAreaM2:50,areaEvidence:'50 square metres'},{coordinateRows:rows.map(s=>s.replace('14.112480','14.112490'))}])assert.equal(assessCloud({...model(),...change},{text,confidence:.99}).status,'needs_help');
  assert.equal(assessCloud(model(),{text,confidence:.5}).status,'needs_help');
  assert.throws(()=>assessCloud({...model(),coordinateRows:[null]},{text,confidence:.99}));
});
test('bearings produce a shape, never invented geographic coordinates',()=>{
  const courses=["N 80° 00' E 50.00","S 10° 00' E 40.00","S 80° 00' W 50.00","N 10° 00' W 40.00"];
  const t='BOUNDARY COURSES (metres)\n'+courses.join('\n');
  const r=assessCloud({...model(),kind:'bearings',datum:'unknown',coordinateRows:[],courses},{text:t,confidence:.99});
  assert.equal(r.status,'shape_only');assert.equal(r.points,null);assert.ok(Math.abs(r.shape.area-2000)<1);
  assert.equal(assessCloud({...model(),kind:'bearings',coordinateRows:[],courses:courses.map(s=>s.replace('50.00','55.00'))},{text:t,confidence:.99}).status,'needs_help');
});
test('grid documents remain unlocated even when model claims completeness',()=>assert.equal(assessCloud({...model(),kind:'grid',datum:'PRS92'},{text,confidence:.99}).status,'needs_help'));
test('Philippine prose separates BLLM tie from all boundary courses',()=>{
  const r=extractText("Beginning at point 1 being N. 30 deg. 00' E., 500.00 m from BLLM 1; thence N. 80 deg. 00' E., 50.00 m; thence S. 10 deg. 00' E., 40.00 m; thence S. 80 deg. 00' W., 50.00 m; thence N. 10 deg. 00' W., 40.00 m to the beginning.");
  assert.equal(r.courses.length,4);assert.ok(r.courses.every(c=>!c.includes('500')));assert.equal(r.unitsConfirmed,true);
});
test('unknown distance units never become an assumed metre shape',()=>{
  const t="N 80° 00' E 50.00\nS 10° 00' E 40.00\nS 80° 00' W 50.00\nN 10° 00' W 40.00";
  assert.equal(assessLocal(scan(t),scan(t)).status,'needs_help');
});

test('Gemini alone maps structured coordinates without claiming OCR agreement',()=>{
  const r=assessGemini(model());assert.equal(r.status,'mapped');assert.equal(r.verification,'single_model');assert.equal(r.points.length,5);assert.match(r.message,/not been independently checked/);
  for(const change of [{complete:false},{datum:'unknown'},{multipleLots:true},{unclearFields:['corner']},{kind:'grid'},{coordinateRows:['14,120','14,120','14,120']},{statedAreaM2:1,areaEvidence:'1 square metre'}])assert.equal(assessGemini({...model(),...change}).status,'needs_help');
});
test('Gemini bearings require explicit metre units and remain unlocated',()=>{
  const m={...model(),kind:'bearings',datum:'unknown',coordinateRows:[],courses:["N 80� 00' E 50.00 m","S 10� 00' E 40.00 m","S 80� 00' W 50.00 m","N 10� 00' W 40.00 m"]};
  assert.equal(assessGemini(m).status,'shape_only');assert.equal(assessGemini(m).points,null);
  assert.equal(assessGemini({...m,courses:m.courses.map(s=>s.replace(' m',''))}).status,'needs_help');
});
