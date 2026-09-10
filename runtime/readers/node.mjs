/** Node PDF reader. Dependencies/assets are bundled by the release build. */
import {extractSource} from './index.mjs';
import {requireThat} from '../core/errors.mjs';
import {fileURLToPath} from 'node:url';

export async function readPDF(bytes,metadata={}){
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const assets=new URL(typeof __PDFJS_ASSETS__!=='undefined'?__PDFJS_ASSETS__:'../../node_modules/pdfjs-dist/',import.meta.url);
  requireThat(new TextDecoder().decode(bytes.subarray(0,1024)).includes('%PDF-'),'format','Source is not a PDF.');
  const task=pdfjs.getDocument({data:bytes.slice(),useSystemFonts:false,disableFontFace:true,isEvalSupported:false,
    useWorkerFetch:false,verbosity:0,stopAtErrors:true,cMapUrl:fileURLToPath(new URL('cmaps/',assets)),cMapPacked:true,
    standardFontDataUrl:fileURLToPath(new URL('standard_fonts/',assets)),wasmUrl:fileURLToPath(new URL('wasm/',assets))});
  let doc;
  try{
    doc=await task.promise;const parts=[],gaps=[];
    for(let n=1;n<=doc.numPages;n++){
      const page=await doc.getPage(n),content=await page.getTextContent({includeMarkedContent:false,disableNormalization:true});
      let text='',previousY=null;
      for(const item of content.items){if(!Object.hasOwn(item,'str'))continue;
        const y=item.transform?.[5];if(previousY!==null&&y!==undefined&&Math.abs(y-previousY)>3&&!text.endsWith('\n'))text+='\n';
        text+=item.str+(item.hasEOL?'\n':' ');previousY=y;
      }
      parts.push('## Page '+n+'\n\n'+text.trim());
      if(!text.trim())gaps.push({code:'page_without_text',page:n,message:'Read this page visually or with OCR.'});
      let operators;try{operators=await page.getOperatorList();}catch(error){gaps.push({code:'visual_read_failed',page:n,message:error.message});operators={fnArray:[]};}
      const imageOps=new Set([pdfjs.OPS.paintImageXObject,pdfjs.OPS.paintInlineImageXObject,pdfjs.OPS.paintImageMaskXObject]);
      if(operators.fnArray.some(op=>imageOps.has(op)))gaps.push({code:'visual_content',page:n,message:'Read the images on this page and record their relevant content.'});
      if(operators.fnArray.includes(pdfjs.OPS.constructPath))gaps.push({code:'vector_content',page:n,message:'Check the vector drawings, charts or table layout on this page.'});
      const annotations=await page.getAnnotations();
      for(const note of annotations)if(note.contentsObj?.str)parts.push('### Annotation (page '+n+')\n\n'+note.contentsObj.str);
      page.cleanup();
    }
    const details=await doc.getMetadata().catch(()=>null),info=details?.info??{};
    const date=/^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(Z|[+-]\d{2}'?\d{2}'?)?/.exec(info.CreationDate??'');
    if(date){const [,y,m,d,h,min,s,zone='Z']=date,normalizedZone=zone==='Z'?'Z':zone.replace(/'/g,'').replace(/([+-]\d{2})(\d{2})/,'$1:$2'),stamp=`${y}-${m}-${d}T${h}:${min}:${s}${normalizedZone}`;
      if(Number.isFinite(Date.parse(stamp)))metadata={...metadata,created_at:new Date(stamp).toISOString(),created_at_basis:'document_metadata'};}
    return {text:parts.join('\n\n'),metadata,gaps};
  }finally{await task.destroy();}
}
export const extract=source=>extractSource({...source,readPDF});
