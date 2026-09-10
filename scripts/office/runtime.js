/* Office runtime executed only in an opaque-origin, network-disabled frame.
   Third-party engines and their WASM bytes are bundled by build_office.mjs. */
import {DocumentViewer} from '../../vendor/office/zrimo/dist/viewer.js';
import {AdapterRegistry} from '../../vendor/office/zrimo/dist/registry.js';
import {FontManager} from '../../vendor/office/zrimo/dist/fonts.js';
import {RenderScheduler} from '../../vendor/office/zrimo/dist/render-scheduler.js';
import {defaultResourceLimits} from '../../vendor/office/zrimo/dist/limits.js';
import {createOfficeAdapter} from '../../vendor/office/zrimo/dist/adapters/office.js';
import {DocxDocument} from '../../vendor/office/ooxml/dist/docx.mjs';
import {XlsxWorkbook} from '../../vendor/office/ooxml/dist/xlsx.mjs';
import {PptxPresentation} from '../../vendor/office/ooxml/dist/pptx.mjs';
import {initSync,convertLegacyToOoxml,extractLegacyPlainText} from '../../vendor/office/zrimo/dist/assets/legacy/index.js';
import docxWasm from '../../vendor/office/ooxml/dist/docx_parser_bg.wasm';
import xlsxWasm from '../../vendor/office/ooxml/dist/xlsx_parser_bg.wasm';
import pptxWasm from '../../vendor/office/ooxml/dist/pptx_parser_bg.wasm';
import legacyWasm from '../../vendor/office/zrimo/dist/assets/legacy/index_bg.wasm';
const uri=bytes=>'data:application/wasm;base64,'+bytes;
const binary=base64=>Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
const translations={previous:'Zurück',next:'Weiter',page:'Seite',of:'von',zoomIn:'Vergrößern',zoomOut:'Verkleinern',fitWidth:'Seitenbreite',fitPage:'Ganze Seite',search:'Suchen',searchPlaceholder:'Dokument durchsuchen',matches:'Treffer',thumbnails:'Miniaturen',fullscreen:'Vollbild',exitFullscreen:'Vollbild schließen',download:'Original herunterladen',sheets:'Tabellenblätter',selectedRange:'Markierter Bereich',loading:'Wird geladen…',close:'Schließen',noMatches:'Keine Treffer'};
const blocked=async()=>{throw Error('Network access is disabled in the bundled Office viewer.');};
const adapter=createOfficeAdapter({engines:{
 docx:(bytes,options)=>DocxDocument.load(bytes,{...options,wasmUrl:uri(docxWasm)}),
 xlsx:(bytes,options)=>XlsxWorkbook.load(bytes,{...options,wasmUrl:uri(xlsxWasm)}),
 pptx:(bytes,options)=>PptxPresentation.load(bytes,{...options,wasmUrl:uri(pptxWasm)})
},legacy:{convert:async(bytes,format)=>{initSync({module:binary(legacyWasm)});return convertLegacyToOoxml(bytes,format);}}});
let loaded=false;
addEventListener('message',async event=>{
 if(event.source!==parent||event.data?.type!=='open-office'||loaded)return;loaded=true;
 const {bytes,name,locale,token,icons}=event.data;
 const send=(type,detail={})=>parent.postMessage({type,token,...detail},'*');
 try{
  const registry=new AdapterRegistry([adapter]);
  const runtime={registry,fetch:blocked,limits:{...defaultResourceLimits,maxExpandedOfficeBytes:128*1024*1024,maxDocumentUnits:10000},fonts:new FontManager({fetch:blocked,policy:{mode:'offline'}}),renderScheduler:new RenderScheduler(2),release:()=>{}};
  const viewer=new DocumentViewer({container:document.getElementById('office'),ui:true,fit:'width',locale:'en',translations:locale==='de'?translations:undefined},runtime);
  globalThis.officeViewer=viewer;
  const map={thumbnails:'menu',previous:'chevron-left',next:'chevron-right','zoom-in':'zoom-in','zoom-out':'zoom-out','fit-width':'maximize','fit-page':'file-text',search:'search',fullscreen:'maximize','search-previous':'chevron-left','search-next':'chevron-right','search-close':'x'};
  for(const button of document.querySelectorAll('button[data-action]')){const paths=icons[map[button.dataset.action]];if(paths)button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths+'</svg>';}
  try{
   // The pinned PPT converter flattens master and slide text into one page.
   // Present an explicit text view until a slide-preserving parser is bundled.
   if(name.toLowerCase().endsWith('.ppt'))throw Error('PPT layout is not supported');
   await viewer.load(new Uint8Array(bytes),{fileName:name});
  }
  catch(error){
   const format=name.split('.').pop().toLowerCase();
   if(!['doc','xls','ppt'].includes(format))throw error;
   initSync({module:binary(legacyWasm)});
   const text=extractLegacyPlainText(new Uint8Array(bytes),format);
   if(!text.trim())throw error;
   await viewer.destroy();
   const hint=document.createElement('p'),content=document.createElement('pre');
   hint.className='office-fallback-hint';hint.textContent=locale==='de'?'Textvorschau · Das Layout dieses älteren Office-Dokuments kann nicht dargestellt werden.':'Text preview · This legacy Office document’s layout could not be rendered.';
   content.className='office-fallback-text';content.textContent=text;
   document.getElementById('office').replaceChildren(hint,content);
  }
  send('office-loaded');
 }catch(error){send('office-error',{message:String(error.message||error)});}
});
parent.postMessage({type:'office-ready'},'*');
