import {parseCoordinateLine, parseCoordinates, parseBearings, metrics, distance} from './geo.js';

export const extractionSchema = {
  type:'object', additionalProperties:false,
  properties:{
    kind:{type:'string',enum:['gps','bearings','grid','unreadable']},
    datum:{type:'string',enum:['WGS84','PRS92','Luzon1911','unknown']},
    datumEvidence:{type:'string'},
    complete:{type:'boolean'},
    multipleLots:{type:'boolean'},
    unclearFields:{type:'array',items:{type:'string'}},
    coordinateRows:{type:'array',items:{type:'string'}},
    courses:{type:'array',items:{type:'string'}},
    reference:{type:'string'},
    statedAreaM2:{type:['number','null']},
    areaEvidence:{type:'string'},
  },
  required:['kind','datum','datumEvidence','complete','multipleLots','unclearFields','coordinateRows','courses','reference','statedAreaM2','areaEvidence'],
};

// Do not correct 0/O, 1/I, missing digits, signs or hemispheres here.
export function extractText(text) {
  const rows=[], courses=[], suspicious=[];
  const normalized=text.replace(/\b([NSEW])\.(?=\s|,)/gi,'$1').replace(/\bdeg(?:rees)?\.?/gi,'°');
  const coursePattern=/\b[NS]\s*\d+(?:\.\d+)?\s*[°º]?\s*(?:\d+(?:\.\d+)?\s*['′’]\s*)?(?:\d+(?:\.\d+)?\s*["″]\s*)?[EW]\s*[,;:]?\s*\d+(?:\.\d+)?\s*(?:m\b|metres\b|meters\b)?/gi;
  const allCourses=[...normalized.matchAll(coursePattern)];
  let unitsConfirmed=allCourses.length>0;
  const hasDistanceUnit=/\b(?:distances?|courses)\s*(?:in\s*|\()?\s*(?:metres|meters|m\b)/i.test(normalized);
  for(const match of allCourses){
    const preceding=normalized.slice(0,match.index),thence=preceding.toLowerCase().lastIndexOf('thence');
    // A control-point connection precedes the boundary's first "thence".
    const end=normalized.toLowerCase().indexOf('thence',match.index);
    const context=normalized.slice(Math.max(0,preceding.lastIndexOf('\n')),end<0?match.index+match[0].length+140:end);
    if(/\b(?:BLLM|tie\s*line|reference\s*monument)\b/i.test(context)&&thence<=preceding.lastIndexOf('\n'))continue;
    const course=match[0].trim();
    if(!hasDistanceUnit&&!/\b(?:m|metres|meters)$/i.test(course))unitsConfirmed=false;
    courses.push(course.replace(/\s*[,;:]\s*/g,' ').replace(/\s+(?:m|metres|meters)$/i,'').trim());
  }
  for (const raw of text.split(/\r?\n/)) {
    const line=raw.trim();
    const candidate=line.replace(/^(?:point\s*|pt\.?\s*|corner\s*)?\d{1,3}[.):\s]+(?=[+-]?\d{1,3}[.°])/i,'');
    if (!/\d/.test(candidate)) continue;
    try {
      if (!/(?:\d\.\d{4}|\d\s*[°º])/.test(candidate)) throw Error();
      const p=parseCoordinateLine(candidate);
      if (!p.every(Number.isFinite)||Math.abs(p[1])>85||Math.abs(p[0])>180) throw Error();
      rows.push(`${p[1]}, ${p[0]}`);
    } catch {
      if (/\d{1,3}[.,]\d{3,}.*\d{1,3}[.,]\d{3,}/.test(line)) suspicious.push(line);
    }
  }
  const datum=/\bWGS\s*[-:]?\s*84\b/i.test(text)?'WGS84':/\bPRS\s*[-:]?\s*92\b/i.test(text)?'PRS92':/\bLUZON\b/i.test(text)?'Luzon1911':'unknown';
  return {rows,courses,suspicious,datum,unitsConfirmed};
}

function canonical(s){return s.toUpperCase().replace(/\s/g,'').replace(/[º]/g,'°').replace(/[′’]/g,"'").replace(/[″]/g,'"');}
export function samePolygon(a,b,tolerance=.02){return a.length===b.length&&a.every((p,i)=>distance(p,b[i])<=tolerance);}
function shapeFromCourses(courses){
  const r=parseBearings(courses.join('\n'),0,0);
  const m=metrics(r.points);
  if(r.closure>Math.max(.05,m.perimeter/5000))throw Error('The boundary lines do not close. A distance or bearing needs checking.');
  const xy=r.points.map(p=>[p[0]*111195.08,p[1]*111195.08]);
  return {xy,closure:r.closure,area:m.area,perimeter:m.perimeter};
}
function needs(message,extra={}) {return {status:'needs_help',message,points:null,...extra};}

export function assessLocal(first,second) {
  const a=extractText(first.text),b=extractText(second.text);
  const draft={coordinateRows:a.rows,courses:a.courses,datum:a.datum};
  if(a.courses.length>=3) {
    try {
      if(first.confidence<90||second.confidence<90)return needs('Some survey numbers are too faint to trust. Try a brighter photo.',draft);
      if(!a.unitsConfirmed||!b.unitsConfirmed)return needs('The distance units are not clear. A helper must confirm metres before drawing the shape.',draft);
      if(canonical(a.courses.join('\n'))!==canonical(b.courses.join('\n')))return needs('The two readings disagree. Take a clearer photo or ask a helper to check it.',draft);
      const shape=shapeFromCourses(a.courses);
      return {status:'shape_only',message:'The lot shape is ready. A survey reference and its coordinate system are still needed to place it on Earth.',shape,...draft,points:null};
    }catch(e){return needs(e.message,draft);}
  }
  if(a.datum!=='WGS84'||b.datum!=='WGS84')return needs(a.datum==='unknown'?'The page does not identify its coordinate system. A helper or geodetic engineer needs to check the survey reference.':'This document uses a Philippine survey datum. A verified coordinate conversion is needed before placing it on Earth.',draft);
  if(first.confidence<90||second.confidence<90||a.suspicious.length||b.suspicious.length)return needs('Some numbers are unclear. Try a closer, brighter photo of the whole coordinate table.',draft);
  try {
    const p=parseCoordinates(a.rows.join('\n')),q=parseCoordinates(b.rows.join('\n'));
    // A valid polygon alone does not prove that a cropped table is complete.
    const complete=(raw,rows,parsed)=>{
      if(rows.length===parsed.length+1) {
        try{return distance(parseCoordinateLine(rows[0]),parseCoordinateLine(rows.at(-1)))<.01;}catch{return false;}
      }
      const count=raw.match(/(?:total\s+(?:corners|points)|number\s+of\s+(?:corners|points))\s*[:=]?\s*(\d+)/i);
      return Boolean(count&&Number(count[1])===parsed.length);
    };
    if(!complete(first.text,a.rows,p)||!complete(second.text,b.rows,q))return needs('The numbers were read, but we cannot confirm every corner is included. Use Google reading or ask a helper to check the complete table.',draft);
    if(!samePolygon(p,q))return needs('The two readings disagree. Try a sharper photo; we have not placed a boundary.',draft);
    if(!inPhilippines(p))return needs('The coordinates appear outside the Philippines. Ask a helper to check the page.',draft);
    return {status:'mapped',points:p,message:'An approximate outline is ready. Two readings agree and the boundary checks pass. This is not a verified survey.',...draft};
  }catch(e){return needs('We could not read a complete boundary. Take a photo of the whole technical description or ask a helper.',draft);}
}

function inPhilippines(p){return p.every(([lon,lat])=>lon>=116&&lon<=127.5&&lat>=4&&lat<=22);}
function validateModel(model) {
  if(!model||typeof model!=='object'||!['gps','bearings','grid','unreadable'].includes(model.kind))throw Error('The reading service returned an invalid result.');
  for(const key of ['coordinateRows','courses','unclearFields'])if(!Array.isArray(model[key])||model[key].length>500||model[key].some(v=>typeof v!=='string'||v.length>1000))throw Error('The reading service returned invalid fields.');
  if(typeof model.datumEvidence!=='string'||typeof model.areaEvidence!=='string'||typeof model.reference!=='string'||model.reference.length>1000)throw Error('The reading service returned invalid evidence.');
  if(!['WGS84','PRS92','Luzon1911','unknown'].includes(model.datum)||typeof model.complete!=='boolean'||typeof model.multipleLots!=='boolean'||(model.statedAreaM2!==null&&(!Number.isFinite(model.statedAreaM2)||model.statedAreaM2<=0)))throw Error('The reading service returned invalid metadata.');
}
export function assessCloud(model,ocr) {
  validateModel(model);
  const draft={coordinateRows:model.coordinateRows,courses:model.courses,datum:model.datum,reference:model.reference};
  if(!model.complete||model.multipleLots||model.unclearFields.length||model.kind==='unreadable')return needs(model.multipleLots?'This photo contains more than one lot. Photograph one complete lot description at a time.':'The page is incomplete or some numbers are unclear. Take another photo or ask a helper.',draft);
  const independently=extractText(ocr.text);
  if(model.kind==='grid')return needs('These are Philippine grid coordinates. A geodetic engineer must confirm the datum and zone before conversion.',draft);
  if(model.kind==='bearings') {
    const modelCourses=model.courses.map(s=>s.replace(/\s+(?:m|metres|meters)$/i,''));
    if(!independently.unitsConfirmed)return needs('The distance units could not be independently confirmed as metres.',draft);
    if(canonical(modelCourses.join('\n'))!==canonical(independently.courses.join('\n')))return needs('The readers disagree on the boundary lines. A helper needs to check the original.',draft);
    if(ocr.confidence<.9)return needs('Some survey text is too faint to trust. Try a brighter photo.',draft);
    try {
      const shape=shapeFromCourses(model.courses);
      if(model.statedAreaM2!==null&&Math.abs(shape.area-model.statedAreaM2)/model.statedAreaM2>.03)return needs('The calculated area does not match the document. Ask a helper to check the boundary lines.',draft);
      return {status:'shape_only',message:'The lot shape is ready. A verified BLLM / survey reference, datum, and bearing basis are needed to place it on Earth.',shape,points:null,...draft};
    }catch(e){return needs(e.message,draft);}
  }
  if(model.datum!=='WGS84'||independently.datum!=='WGS84'||!/WGS\s*[-:]?\s*84/i.test(model.datumEvidence)||!canonical(ocr.text).includes(canonical(model.datumEvidence)))return needs('The coordinate system is not independently confirmed as WGS 84. A helper must check it before mapping.',draft);
  if(ocr.confidence<.9||independently.suspicious.length)return needs('Some printed numbers are unclear. Retake the photo or ask a helper.',draft);
  try {
    const p=parseCoordinates(model.coordinateRows.join('\n')),q=parseCoordinates(independently.rows.join('\n'));
    if(!samePolygon(p,q))return needs('The OCR and AI readings disagree on the corners. We have not placed the lot.',draft);
    if(!inPhilippines(p))return needs('These coordinates appear outside the Philippines. Ask a helper to check them.',draft);
    const m=metrics(p);
    if(model.statedAreaM2!==null) {
      if(!model.areaEvidence||!canonical(ocr.text).includes(canonical(model.areaEvidence)))return needs('The stated area could not be independently checked.',draft);
      if(Math.abs(m.area-model.statedAreaM2)/model.statedAreaM2>.03)return needs('The calculated area differs from the document by more than 3%. Ask a helper to check it.',draft);
    }
    return {status:'mapped',points:p,...draft,message:'An approximate outline is ready. OCR and AI agree on the corners and the geometry checks pass. This is not a verified survey.'};
  }catch(e){return needs('The extracted corners do not make a valid boundary. Ask a helper to check the document.',draft);}
}

// Single-model extraction: geometry validation is not independent OCR agreement.
export function assessGemini(model) {
  validateModel(model);
  const draft={coordinateRows:model.coordinateRows,courses:model.courses,datum:model.datum,reference:model.reference,verification:'single_model'};
  if(!model.complete||model.multipleLots||model.unclearFields.length||model.kind==='unreadable')return needs('The page is incomplete, contains multiple lots, or has unclear numbers. Take a clearer photo of one complete description.',draft);
  if(model.kind==='grid')return needs('These grid coordinates need a verified datum, zone, and survey reference before mapping.',draft);
  try {
    if(model.kind==='bearings') {
      if(!model.courses.length||model.courses.some(s=>! /\s(?:m|metres|meters)$/i.test(s)))return needs('The distance units are not confirmed as metres. A helper needs to check the document.',draft);
      const courses=model.courses.map(s=>s.replace(/\s+(?:m|metres|meters)$/i,''));
      const shape=shapeFromCourses(courses);
      if(model.statedAreaM2!==null&&Math.abs(shape.area-model.statedAreaM2)/model.statedAreaM2>.03)return needs('The calculated area does not match the document. Check the boundary lines.',draft);
      return {status:'shape_only',points:null,shape,...draft,message:'Gemini extracted the lot shape. A verified survey reference is needed to locate it on Earth. The reading has not been independently checked.'};
    }
    if(model.datum!=='WGS84'||! /\bWGS\s*[-:]?\s*84\b/i.test(model.datumEvidence))return needs('The document does not explicitly identify WGS 84 coordinates. A helper must confirm its coordinate system.',draft);
    const points=parseCoordinates(model.coordinateRows.join('\n'));
    if(!inPhilippines(points))return needs('These coordinates appear outside the Philippines. Check the document.',draft);
    if(model.statedAreaM2!==null&&(!model.areaEvidence||Math.abs(metrics(points).area-model.statedAreaM2)/model.statedAreaM2>.03))return needs('The stated area is missing evidence or differs from the outline. Check the original.',draft);
    return {status:'mapped',points,...draft,message:'Gemini extracted an approximate outline and geometry checks passed. The numbers have not been independently checked. This is not a verified survey.'};
  }catch{return needs('The extracted numbers do not form a valid, closed boundary. Check the original document.',draft);}
}
