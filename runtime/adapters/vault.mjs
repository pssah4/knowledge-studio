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
     let isDirectory=false;try{await this.vault.list(full);isDirectory=true;}catch(e){if(!notFolder(e))throw e;requireThat(await this.read(path,{binary:true}),'missing','Listed file disappeared.');}
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
export async function prepare(base,run){const store=new OverlayStore(base),result=await run(store);if(!store.state.changes.size)return {state:'complete',result};
 const id=base.services.uuid(),page='.llmwiki/transactions/'+id+'.json',data={format:'llmwiki-transaction/1',id,cursor:0,changes:[...store.state.changes.values()],reads:[...store.state.reads].map(([page,r])=>({page,expected:r.expected})),result};
 const text=JSON.stringify(data);requireThat(new TextEncoder().encode(text).length<=9*1024*1024,'transaction_size','Split this action into smaller source/page operations.');await base.write(page,text,{expected:null});return {state:'prepared',transaction:id,pending:data.changes.length,retry_after_seconds:60};}
export async function resume(base,id){requireThat(/^[a-f0-9-]{36}$/.test(id),'transaction','Invalid transaction ID.');const page='.llmwiki/transactions/'+id+'.json',file=await base.read(page);requireThat(file,'transaction','Transaction is missing.');const data=JSON.parse(file.text);requireThat(data.format==='llmwiki-transaction/1'&&data.id===id,'transaction','Invalid transaction record.');
 // A complete read-set check precedes the first mutation. Each write also checks
 // its baseline. Bridge limitations are explicit; preimages are always retained.
 if(data.cursor===0)for(const read of data.reads){
   const actual=(await base.read(read.page,{binary:true}))?.sha256??null,planned=data.changes.find(c=>c.page===read.page);
   // An interrupted batch may have written content before its checkpoint. Only
   // that exact planned content counts as resumable; unrelated changes still stop.
   requireThat(actual===read.expected||planned&&actual===await base.services.hash(payload(planned)),'stale','A dependency changed since preparation.',{page:read.page});
 }
 let count=0;while(data.cursor<data.changes.length&&count<3){const change=data.changes[data.cursor],seen=await base.read(change.page,{binary:true}),digest=await base.services.hash(payload(change));
   if(seen?.sha256!==digest)await base.write(change.page,payload(change),{expected:change.expected});data.cursor++;count++;
 }
 await base.write(page,JSON.stringify(data),{expected:file.sha256});return data.cursor===data.changes.length?{state:'complete',result:data.result,transaction:id}:{state:'pending',transaction:id,pending:data.changes.length-data.cursor,retry_after_seconds:60};
}
