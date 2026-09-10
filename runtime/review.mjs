/** Storage boundary for the unchanged browser review and sync wire protocols. */
import {createReviews} from './compat/reviews.mjs';
import {createSync} from './compat/editorsync.mjs';
import {createProject} from './compat/project.mjs';
import {matchingBlocks} from './compat/matching.mjs';
import {parseDocument} from './core/document.mjs';
import {relativePath} from './core/errors.mjs';

const missing=()=>Object.assign(new Error('File or directory not found.'),{name:'NotFoundError'});
export function handle(store,prefix=''){
  const full=p=>prefix?(p?prefix+'/'+p:prefix):p;
  return {
    store,prefix,kind:'directory',name:prefix.split('/').at(-1),
    async isSameEntry(other){return store===other.store&&prefix===other.prefix||store.root&&store.root===other.store.root&&prefix===other.prefix;},
    async getDirectoryHandle(part){relativePath(part);const p=full(part);try{await store.list(p,{recursive:false,hidden:true});}catch(e){if(e.code==='ENOENT')throw missing();throw e;}return handle(store,p);},
    async *values(){for(const entry of await store.list(prefix,{recursive:false,hidden:true})){
      const name=entry.path.split('/').at(-1);
      if(entry.kind==='directory')yield {...handle(store,entry.path),name};
      else if(entry.kind==='file')yield {kind:'file',name,async getFile(){const seen=await store.read(entry.path);if(!seen)throw missing();return {size:seen.size,text:async()=>seen.text};}};
    }},
    full
  };
}
const FolderAccess={
  async readBinary(dir,page){const file=await dir.store.read(dir.full(page),{binary:true});if(!file)throw missing();return file;},
  async writeBinary(dir,page,bytes,seen){return dir.store.write(dir.full(page),bytes,{expected:seen?.sha256??null});},
  canArchive:dir=>typeof dir.store.archive==='function',
  async archiveFile(dir,from,to,expected){return dir.store.archive(dir.full(from),dir.full(to),expected);},
  async peek(dir,page){return dir.store.read(dir.full(page));},
  async readFile(dir,page){const seen=await this.peek(dir,page);if(!seen)throw missing();return {...seen,mark:seen.sha256};},
  async writeFile(dir,page,value,seen){try{const result=await dir.store.write(dir.full(page),value,{expected:seen?.sha256??seen?.mark??null});return {...result,text:value,mark:result.sha256};}catch(e){if(['stale','busy','mismatch'].includes(e.code))return {saved:false,stale:true,reason:e.message};throw e;}},
  async listFolder(dir,_unused,{visible=()=>true}={}){return (await dir.store.list(dir.prefix)).filter(e=>e.kind==='file'&&visible(e.path,'file')).map(e=>({name:dir.prefix?e.path.slice(dir.prefix.length+1):e.path,size:0}));}
};
export const environment={FolderAccess,crypto,matchingBlocks,
  I18n:{message:key=>key,error:message=>new Error(message)},
  headField:(text,key)=>parseDocument(text).head[key],parseHead:parseDocument};
export const reviews=createReviews(environment);
export const sync=createSync(environment);
export const projectSettings=createProject(environment);
export async function save(store,page,text,author,expected){
  const current=await store.read(page);
  if((current?.sha256??null)!==expected)throw Object.assign(new Error('The document changed.'),{code:'stale'});
  const result=await reviews.save(handle(store),page,current,text,author);
  if(!result.saved||!result.recorded)throw Object.assign(new Error('The save has no completed review receipt.'),{code:'incomplete_save',result});
  return result;
}
