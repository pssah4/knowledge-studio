/* ADR-29: FileSystemHandle-compatible transport for an explicitly started Node host.
 * No OS path access from the browser; each handle refers to a confirmed scope.
 */
(function(global){
'use strict';
if(!document.getElementById('llmwiki-host'))return;
const tokenKey='llmwiki-host-token/'+JSON.parse(document.getElementById('llmwiki-host').textContent).root;
let token=location.hash.slice(1)||localStorage.getItem(tokenKey)||sessionStorage.getItem('llmwiki-host-token');
if(location.hash){sessionStorage.setItem('llmwiki-host-token',token);localStorage.setItem(tokenKey,token);history.replaceState(null,'',location.pathname);}
let confirmation=null;
const msg=key=>global.I18n.message(key),say=(node,key)=>global.I18n.setText(node,msg(key));
async function request(q,retry=true){
 let response;try{response=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(q)});}catch{throw global.I18n.error(msg('The editor service is unavailable. Start the editor from your project and retry. Your draft is kept.'));}
 const data=await response.json();if(!data.ok){if(data.error.code==='grant_required'&&retry){await confirm();return request(q,false);}throw Object.assign(Error(data.error.message),{code:data.error.code});}return data.result;
}
async function confirm(){
 if(confirmation)return confirmation;
 confirmation=(async()=>{for(;;){const c=await request({op:'catalog'},false);if(c.granted)return c;
  const accepted=await new Promise((resolve,reject)=>{const d=document.createElement('dialog');d.className='ws-dialog';const header=document.createElement('header'),content=document.createElement('div'),foot=document.createElement('footer');header.className='ws-dialog-head';content.className='ws-dialog-content';foot.className='ws-dialog-foot';d.append(header,content,foot);const h=document.createElement('h2');h.id='host-access-title';d.setAttribute('aria-labelledby',h.id);say(h,'Access to your connected folders');header.append(h);const intro=document.createElement('p');say(intro,'Confirm the configured folders. The editor manages your working copies; you do not need to select the folders again.');content.append(intro);
   const copies=document.createElement('details'),summary=document.createElement('summary');say(summary,'Working copies and project settings');copies.append(summary);
   for(const f of c.folders){const p=document.createElement('p'),name=document.createElement('strong'),location=document.createElement('small');name.append(document.createTextNode(f.label+' · '));global.I18n.appendText(name,msg(f.writable?'Read and write':'Read only'));if(f.root||f.error)location.textContent=f.root||f.error;else say(location,'Not connected');location.style.display='block';location.style.overflowWrap='anywhere';p.append(name,location);(f.kind==='work'||f.kind==='project'?copies:content).append(p);}content.append(copies);
   const button=document.createElement('button');say(button,'Allow access');button.className='ws-primary';button.onclick=async()=>{button.disabled=true;try{await request({op:'grant',fingerprint:c.fingerprint},false);d.close();d.remove();resolve(true);}catch(error){if(error.code==='stale'){d.close();d.remove();resolve(false);return;}button.disabled=false;const p=document.createElement('p');p.setAttribute('role','alert');global.I18n.setText(p,global.I18n.fromError(error));content.append(p);}};
   const cancel=()=>{d.close();d.remove();reject(global.I18n.error(msg('Access was not confirmed. You can allow it at any time.')));};const back=document.createElement('button');say(back,'Cancel');back.onclick=cancel;d.addEventListener('cancel',event=>{event.preventDefault();cancel();});foot.append(button,back);document.body.append(d);d.showModal();
  });if(accepted)return c;}
 })();try{return await confirmation;}finally{confirmation=null;}
}
const join=(a,b)=>{if(typeof b!=='string'||!b||b==='.'||b==='..'||/[\\/]/.test(b))throw new TypeError('Invalid entry name');return a?a+'/'+b:b;};
const missing=()=>new DOMException('File not found','NotFoundError');
class Handle{
 constructor(scope,path,name,kind){this.scope=scope;this.path=path;this.name=name;this.kind=kind;this.hostHandle=true;}
 async queryPermission(){return (await request({op:'catalog'},false)).granted?'granted':'prompt';}
 async requestPermission(){await confirm();return 'granted';}
 async isSameEntry(other){const parts=other?.hostHandle?await request({op:'resolve',scope:this.scope,path:this.path,other:other.scope,otherPath:other.path}):null;return parts?.length===0&&this.kind===other.kind;}
 async resolve(other){return other?.hostHandle?request({op:'resolve',scope:this.scope,path:this.path,other:other.scope,otherPath:other.path}):null;}
 async getDirectoryHandle(name,{create=false}={}){const p=join(this.path,name),stat=await request({op:'stat',scope:this.scope,path:p});if(!stat){if(!create)throw missing();await request({op:'mkdir',scope:this.scope,path:p});}else if(stat.kind!=='directory')throw new DOMException('Not a directory','TypeMismatchError');return new Handle(this.scope,p,name,'directory');}
 async getFileHandle(name,{create=false}={}){const p=join(this.path,name),stat=await request({op:'stat',scope:this.scope,path:p});if(!stat&&!create)throw missing();if(stat&&stat.kind!=='file')throw new DOMException('Not a file','TypeMismatchError');const handle=new Handle(this.scope,p,name,'file');if(!stat)handle.baseline=null;return handle;}
 async *values(){for(const entry of await request({op:'list',scope:this.scope,path:this.path}))yield Object.assign(new Handle(this.scope,entry.path,entry.path.split('/').at(-1),entry.kind),{metadata:{size:entry.size,lastModified:entry.modified}});}
 async *entries(){for await(const h of this.values())yield [h.name,h];}
 [Symbol.asyncIterator](){return this.entries();}
 async getFile(){const f=await request({op:'read',scope:this.scope,path:this.path});if(!f)throw missing();this.baseline=f.sha256;const bytes=Uint8Array.from(atob(f.data),c=>c.charCodeAt(0));return new File([bytes],this.name,{lastModified:Date.parse(f.modified_at)});}
 async createWritable(options={}){if(Object.hasOwn(options,'expected'))this.baseline=options.expected;if(this.baseline===undefined){const f=await request({op:'read',scope:this.scope,path:this.path});this.baseline=f?.sha256??null;}const expected=this.baseline;let data=null,aborted=false;return {write:async value=>{data=value;},abort:async()=>{aborted=true;},close:async()=>{if(aborted)return;if(data===null)throw Error('Nothing to save');const bytes=new Uint8Array(await new Blob([data]).arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));const result=await request({op:'write',scope:this.scope,path:this.path,expected,data:btoa(binary)});this.baseline=result.sha256;}};}
 async removeEntry(name){const path=join(this.path,name),f=await request({op:'read',scope:this.scope,path});if(!f)throw missing();await request({op:'remove',scope:this.scope,path,expected:f.sha256});}
}
const api={request,confirm,async root(){await confirm();const c=await request({op:'catalog'});return new Handle('$project','',c.folders[0].root.split(/[\\/]/).at(-1),'directory');},async folder(id){const c=await request({op:'catalog'}),f=c.folders.find(f=>f.id===id);return f?new Handle(id,'',f.root?.split(/[\\/]/).at(-1)||f.label,'directory'):null;},async bind(id,h){if(h.scope.startsWith('picked-'))await request({op:'bind',id,scope:h.scope});},async choose(){const f=await request({op:'pick'});return f?new Handle(f.scope,'',f.name,'directory'):null;}};
global.EditorHost=api;
})(globalThis);
