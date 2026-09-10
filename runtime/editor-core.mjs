/** Browser projection of the same graph and stable-reference resolver used by agents. */
import {buildGraph,resolvePage,pageKey,graphProjection} from './core/graph.mjs';
export async function fromDocuments(documents,wikis){
  if(!wikis.length)return {nodes:[],edges:[],unresolved:0,core:null};
  const scopes=wikis.map(w=>{const files=new Map(documents.filter(d=>d.wiki===w.id).map(d=>[d.path,d]));return {...w,store:{read:async path=>files.get(path)??null,list:async()=>[...files.keys()].map(path=>({path,kind:'file'}))}};});
  const core=await buildGraph(scopes,{allowMissingRegister:true});
  return {core,nodes:graphProjection(core).pages.map(p=>({path:p.key,filePath:p.path,wiki:p.wiki,wikiLabel:core.scopes.get(p.wiki).label,label:p.head.title||p.path.split('/').at(-1).replace(/\.md$/,'' )})),edges:graphProjection(core).edges.filter(e=>e.valid).map(e=>({...e,crossWiki:core.pages.get(e.source).wiki!==core.pages.get(e.target).wiki})),unresolved:core.findings.length+core.failures.length};
}
export function resolve(view,wiki,page,written){if(!view.core)return null;const result=resolvePage(view.core,{wiki,path:page},written);return result.key?view.core.pages.get(result.key):null;}
export {pageKey};

// The browser keeps its UI review/draft state; document validation and derived
// navigation use the same functions as the agent's write action.
export {browserStore} from './adapters/browser.mjs';
import {browserStore} from './adapters/browser.mjs';
import {document,validateNote,refreshIndex} from './content.mjs';
export function newNote(dir,title,author,files,reviews){return document(browserStore(dir,files,reviews),{type:'concept',title,description:title,author,body:'# '+title+'\n\n'});}
export async function validateEdit(dir,page,text,files,reviews){return validateNote(browserStore(dir,files,reviews),{page,text},{allowPlainExisting:true,fallbackRegister:true});}
export async function saveNote(dir,page,expected,text,author,files,reviews,{update=true}={}){
 const store=browserStore(dir,files,reviews);await validateNote(store,{page,text},{allowPlainExisting:true,fallbackRegister:true});
 const result=await reviews.save(dir,page,expected,text,author);if(!update)result.index_deferred=true;
 if(result.saved&&result.recorded&&update)try{await updateIndex(dir,files,reviews);result.index_updated=true;const final=await files.readFile(dir,page);result.text=final.text;result.mark=final.mark;}catch(error){result.index_error=error.message;}
 return result;
}
export async function updateIndex(dir,files,reviews){const store=browserStore(dir,files,reviews);return await store.read('wiki/index.md')?refreshIndex(store):{updated:false,needs_setup:true};}
export {parseDocument,patchHead,projectMetadata} from './core/document.mjs';
export {markdownLink} from './derived.mjs';

export {planMoves,applyMoves,makeFolder} from './file-management.mjs';

export {exportGraph} from './derived.mjs';

export {assetName,assetFolder,imageType,resolveAsset} from './assets.mjs';
export {patchPropertyDetails} from './property-details.mjs';

export {STATUS_VALUES} from './content.mjs';

export {navigationPage} from './core/graph.mjs';

export {propertyChoices} from "./property-choices.mjs";

export {resolveQuote,resolvePassage} from './shadow-project.mjs';
export {parseShadow,resolveLocator} from './shadow.mjs';

export {decodePassage} from './passage-links.mjs';
