/** Vault Operator bridge. No Node, OS access, eval, network or worker. */
import {relativePath,requireThat} from '../core/errors.mjs';
export const webServices={hash:async value=>{const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');},random:n=>crypto.getRandomValues(new Uint8Array(n)),uuid:()=>crypto.randomUUID(),now:()=>new Date().toISOString()};
const absent=e=>/not found|not a folder|ENOENT/i.test(e.message);
const notFolder=e=>absent(e)||e.code==='ENOTDIR'||/\bENOTDIR\b/.test(e.message);
const encode=bytes=>{let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);};
const payload=change=>change.encoding==='base64'?Uint8Array.from(atob(change.data),c=>c.charCodeAt(0)):change.text;
export class VaultStore{
 constructor(vault,root='',{writable=true}={}){this.vault=vault;this.root=relativePath(root,{root:true});this.writable=writable;this.services=webServices;this.capabilities={binary:true,textWritesOnly:typeof vault.writeBinary!=='function',exclusiveCreate:false,cooperativeLocks:false,externalWriterCAS:false};}
 full(p){const r=relativePath(p,{root:true});return this.root?(r?this.root+'/'+r:this.root):r;}
 hostPath(p){return this.full(p);}
 editorLocation(){return {project_root:this.root,entry_path:this.full('LLM-Wiki.html'),entry_uri:null};}
 async missingFile(full,error){
  // The native bridge uses the same error for a missing path and a directory.
  // A successful parent listing is evidence of absence; a permission failure is not.
  for(let candidate=full;candidate;){
   const parent=candidate.split('/').slice(0,-1).join('/');
   try{const entries=await this.vault.list(parent);if(entries.includes(candidate))throw error;return true;}
   catch(e){if(e===error||!parent||!notFolder(e))throw e;candidate=parent;}
  }
  throw error;
 }
 async read(p,{binary=false}={}){let value;try{value=await this.vault.readBinary(this.full(p));}catch(e){if(/^Not a file: /i.test(e.message)){if(await this.missingFile(this.full(p),e))return null;}else if(absent(e))return null;throw e;}const bytes=new Uint8Array(value);requireThat(bytes.length<=128*1024*1024,'size','Source exceeds the 128 MiB reading limit.');return {path:p,bytes,sha256:await this.services.hash(bytes),size:bytes.length,created_at:null,created_at_basis:'unknown',modified_at:null,...(binary?{}:{text:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)})};}
 async list(p='',{recursive=true,hidden=false}={}){const out=[];const visit=async relative=>{let children;try{children=await this.vault.list(this.full(relative));}catch(e){if(absent(e))e.code='ENOENT';throw e;}
   for(const full of children.sort()){const path=this.root?full.slice(this.root.length+1):full,name=path.split('/').at(-1);if(!hidden&&(name.startsWith('.')||name.startsWith('~$')))continue;
     let isDirectory=false;try{await this.vault.list(full);isDirectory=true;}catch(e){if(!notFolder(e))throw e;/* The successful parent listing identifies this as a file; read only on demand. */}
     out.push({path,kind:isDirectory?'directory':'file'});if(recursive&&isDirectory)await visit(path);
   }};await visit(p);return out;}
 async mkdir(p){requireThat(this.writable,'read-only','Sources are read-only.');if(!this.full(p))return;await this.vault.mkdir(this.full(p));}
 async write(p,text,{expected}={}){requireThat(this.writable,'read-only','Sources are read-only.');requireThat(typeof text==='string'||text instanceof Uint8Array,'write','Supply text or bytes.');requireThat(typeof text==='string'||typeof this.vault.writeBinary==='function','binary_capability','This host does not offer vault.writeBinary.');
   const seen=await this.read(p,{binary:true});requireThat((seen?.sha256??null)===expected,'stale','The vault file changed before writing.',{page:p});
   const parent=p.split('/').slice(0,-1).join('/');if(parent)await this.mkdir(parent);if(typeof text==='string')await this.vault.write(this.full(p),text);else await this.vault.writeBinary(this.full(p),text);
   const digest=await this.services.hash(text);requireThat((await this.read(p,{binary:true}))?.sha256===digest,'mismatch','The vault file changed during verification.',{page:p});return {saved:true,sha256:digest};}
 async substore(p,{writable=true}={}){const store=new VaultStore(this.vault,this.full(p),{writable:this.writable&&writable});store.services=this.services;return store;}
}

/** A prepared action retains preimages and write order, without spending writes. */
export class OverlayStore{
 constructor(base,state={changes:new Map(),directories:new Set(),reads:new Map()},prefix='',writable=base.writable){this.base=base;this.state=state;this.root=base.root+'/'+prefix;this.prefix=prefix;this.writable=writable;this.services=base.services;this.capabilities=base.capabilities;}
 full(p){const clean=relativePath(p,{root:true});return this.prefix?(clean?this.prefix+'/'+clean:this.prefix):clean;}
 hostPath(p){return this.base.hostPath?this.base.hostPath(this.full(p)):this.full(p);}
 editorLocation(){return this.prefix?null:this.base.editorLocation?.();}
 async read(p,options={}){const key=this.full(p),changed=this.state.changes.get(key);if(changed){const value=payload(changed),bytes=typeof value==='string'?new TextEncoder().encode(value):value;return {path:p,...(options.binary?{}:{text:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)}),bytes,size:bytes.length,sha256:await this.services.hash(bytes),created_at:null,created_at_basis:'unknown',modified_at:null};}
   const value=await this.base.read(key,options);if(!this.state.reads.has(key))this.state.reads.set(key,{expected:value?.sha256??null,text:value?.text??null});return value;}
 async list(p='',options={}){const prefix=this.full(p),found=new Map();try{for(const entry of await this.base.list(prefix,options))found.set(entry.path,entry);}catch(e){if(e.code!=='ENOENT'||!this.state.directories.has(prefix))throw e;}
   for(const [key]of this.state.changes)if(!prefix||key.startsWith(prefix+'/'))found.set(key,{path:key,kind:'file'});
   for(const key of this.state.directories)if(key!==prefix&&(!prefix||key.startsWith(prefix+'/')))found.set(key,{path:key,kind:'directory'});
   return [...found.values()].filter(e=>(options.recursive!==false||!e.path.slice(prefix?prefix.length+1:0).includes('/'))&&(options.hidden||!e.path.slice(prefix?prefix.length+1:0).split('/').some(p=>p.startsWith('.')))).map(e=>({...e,path:this.prefix?e.path.slice(this.prefix.length+1):e.path}));}
 async mkdir(p){requireThat(this.writable,'read-only','Sources are read-only.');const parts=this.full(p).split('/');for(let i=1;i<=parts.length;i++)this.state.directories.add(parts.slice(0,i).join('/'));}
 async write(p,text,{expected}={}){requireThat(this.writable,'read-only','Sources are read-only.');requireThat(typeof text==='string'||text instanceof Uint8Array,'write','Supply text or bytes.');requireThat(typeof text==='string'||!this.capabilities.textWritesOnly,'binary_capability','This host does not offer binary writes.');const seen=await this.read(p,{binary:true});requireThat((seen?.sha256??null)===expected,'stale','Prepared write baseline changed.');const key=this.full(p),previous=this.state.changes.get(key);this.state.changes.set(key,{page:key,expected:previous?previous.expected:expected,before:previous?previous.before:seen?encode(seen.bytes):null,beforeEncoding:previous?previous.beforeEncoding:'base64',...(typeof text==='string'?{text}:{encoding:'base64',data:encode(text)})});const parent=p.split('/').slice(0,-1).join('/');if(parent)await this.mkdir(parent);return {saved:true,sha256:await this.services.hash(text)};}
 async substore(p,{writable=true}={}){return new OverlayStore(this.base,this.state,this.full(p),this.writable&&writable);}
}
// Native budgets: ten mkdir/write calls per minute, ten MiB per write.
// Four immutable 6-MiB chunks (8 MiB base64) plus a manifest fit one window.
const segmentBytes=6*1024*1024;
const transactionPage=id=>'.llmwiki/transactions/'+id+'.json';
function directoryOperations(state){
 const directories=[...state.directories].filter(Boolean),files=[...state.changes.keys()];
 return directories.filter(dir=>!files.some(file=>file.startsWith(dir+'/'))&&!directories.some(child=>child.startsWith(dir+'/'))).sort();
}
async function checkDirectory(base,dir){
 try{await base.list(dir,{recursive:false,hidden:true});return;}
 catch(e){if(!notFolder(e)&&e.code!=='ENOENT')throw e;}
 const parent=dir.split('/').slice(0,-1).join('/');let entries=[];
 try{entries=await base.list(parent,{recursive:false,hidden:true});}catch(e){if(!notFolder(e)&&e.code!=='ENOENT')throw e;}
 requireThat(!entries.some(e=>e.path===dir),'directory_conflict','A file occupies the requested folder.',{page:dir});
}
export async function prepare(base,run){
 const store=new OverlayStore(base),result=await run(store),directories=directoryOperations(store.state);
 if(!store.state.changes.size&&!directories.length)return {state:'complete',result};
 for(const dir of directories)await checkDirectory(base,dir);
 const id=base.services.uuid(),page=transactionPage(id),data={format:'llmwiki-transaction/1',id,cursor:0,changes:[...store.state.changes.values()],directories,reads:[...store.state.reads].map(([page,r])=>({page,expected:r.expected})),result};
 const text=JSON.stringify(data),bytes=new TextEncoder().encode(text);let manifest=text;
 requireThat(bytes.length<=4*segmentBytes,'transaction_size','Split this action into smaller source/page operations (24 MiB prepared data limit).');
 if(bytes.length>9*1024*1024){
  const parts=[];
  for(let start=0;start<bytes.length;start+=segmentBytes){const partPage='.llmwiki/transactions/'+id+'/'+parts.length+'.b64',encoded=encode(bytes.subarray(start,start+segmentBytes));const written=await base.write(partPage,encoded,{expected:null});parts.push({page:partPage,sha256:written.sha256});}
  manifest=JSON.stringify({format:'llmwiki-transaction/2',id,cursor:0,parts});
 }
 await base.write(page,manifest,{expected:null});return {state:'prepared',transaction:id,pending:data.changes.length+directories.length,retry_after_seconds:60};
}
async function transactionData(base,record,id){
 if(record.format==='llmwiki-transaction/1')return record;
 requireThat(record.format==='llmwiki-transaction/2'&&Array.isArray(record.parts)&&record.parts.length>0&&record.parts.length<=4,'transaction','Invalid transaction record.');
 const chunks=[];let size=0;
 for(const [index,part]of record.parts.entries()){
  requireThat(part.page==='.llmwiki/transactions/'+id+'/'+index+'.b64','transaction_integrity','Invalid transaction segment path.');
  const file=await base.read(part.page);requireThat(file&&file.sha256===part.sha256&&file.size<=8*1024*1024,'transaction_integrity','A retained transaction segment is missing or changed.');
  const bytes=Uint8Array.from(atob(file.text),c=>c.charCodeAt(0));chunks.push(bytes);size+=bytes.length;
 }
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));requireThat(data.format==='llmwiki-transaction/1'&&data.id===id,'transaction_integrity','Invalid transaction payload.');return {...data,cursor:record.cursor};
}
export async function resume(base,id){
 requireThat(/^[a-f0-9-]{36}$/.test(id),'transaction','Invalid transaction ID.');const page=transactionPage(id),file=await base.read(page);requireThat(file,'transaction','Transaction is missing.');const record=JSON.parse(file.text);requireThat(record.id===id,'transaction','Invalid transaction record.');
 const data=await transactionData(base,record,id),directories=data.directories??[],total=data.changes.length+directories.length;
 requireThat(Number.isSafeInteger(data.cursor)&&data.cursor>=0&&data.cursor<=total,'transaction','Invalid transaction cursor.');
 // Check dependencies before any mutation. A lost checkpoint may only be
 // resumed against the exact planned bytes, never arbitrary changed content.
 if(data.cursor===0){
  for(const read of data.reads){const actual=(await base.read(read.page,{binary:true}))?.sha256??null,planned=data.changes.find(c=>c.page===read.page);
   requireThat(actual===read.expected||planned&&actual===await base.services.hash(payload(planned)),'stale','A dependency changed since preparation.',{page:read.page});
  }
  for(const dir of directories)await checkDirectory(base,dir);
 }
 let count=0;
 while(data.cursor<total&&count<3){
  if(data.cursor<data.changes.length){const change=data.changes[data.cursor],seen=await base.read(change.page,{binary:true}),digest=await base.services.hash(payload(change));
   if(seen?.sha256!==digest)await base.write(change.page,payload(change),{expected:change.expected});
  }else{const dir=directories[data.cursor-data.changes.length];await checkDirectory(base,dir);await base.mkdir(dir);}
  data.cursor++;count++;
 }
 await base.write(page,JSON.stringify(record.format==='llmwiki-transaction/2'?{...record,cursor:data.cursor}:data),{expected:file.sha256});
 return data.cursor===total?{state:'complete',result:data.result,transaction:id}:{state:'pending',transaction:id,pending:total-data.cursor,retry_after_seconds:60};
}
