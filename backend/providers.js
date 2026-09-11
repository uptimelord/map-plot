import sharp from 'sharp';
import {extractPreparedDocument,ServiceError} from './google.js';
export {googleRequest,visionText,ServiceError} from './google.js';
export async function extractDocument(buffer,env,{fetchImpl=fetch,signal}={}) {
  let image;
  try {
    const input=sharp(buffer,{limitInputPixels:40_000_000,failOn:'error'});
    const meta=await input.metadata();
    if(!['jpeg','png','webp'].includes(meta.format)||meta.pages>1)throw Error();
    if(Math.min(meta.width,meta.height)<600)throw new ServiceError('This photo is too small. Take a closer photo of the page.',422);
    image=await input.rotate().resize({width:2600,height:3400,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).png().toBuffer();
  }catch(e){if(e instanceof ServiceError)throw e;throw new ServiceError('This image could not be opened. Use a JPG, PNG, or WEBP photo under 15 MB.',422);}
  return extractPreparedDocument(image,env,{fetchImpl,signal});
}
