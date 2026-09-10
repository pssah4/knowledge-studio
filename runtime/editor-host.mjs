/** Explicit loopback editor filesystem transport. ADR-29 / IMP-06-07-08.
 * Scopes come from validated project/device bindings, never from client paths.
 * A browser confirmation is tied to their complete identity and project instance.
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {NodeStore} from './adapters/node.mjs';
import {loadBindings} from './node-input.mjs';
import {load,folderStore,validateLocations,saveSettings} from './project.mjs';
import {requireThat,relativePath} from './core/errors.mjs';
const ACCESS='.llmwiki/editor-access.json';
const privatePath=p=>/(?:^|\/)\.llmwiki\/(?:editor-(?:server|access)(?:\.json|\.log)|device-bindings\.json|bindings\.json|locks(?:\/|$))/.test(p);
const safeJSON=v=>JSON.stringify(v).replace(/[<>&]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
export async function createEditorHost(root,{html,port=0,token=randomBytes(32).toString('hex'),pickFolder=null,bindingsFile=null}={}){
 requireThat(typeof html==='string'&&html.includes('<head>'),'editor','A bundled editor is required.');
 const pending=new Map();let origin,closed=false;
 async function catalog(){
  const {project}=await load(root),bindings=await loadBindings(root,{file:bindingsFile}),instance=await root.read('.llmwiki/project-instance.json');
  validateLocations(root,project,bindings);
  const folders=[];for(const f of project.folders){let store=null,error=null;try{store=await folderStore(root,f,{bindings,writable:f.kind!=='source'&&f.writable});}catch(e){error=e.message;}
   folders.push({...f,writable:f.kind!=='source'&&f.writable,root:store?.root??bindings[f.id]?.root??(f.path!==null?path.resolve(root.root,f.path):null),store,error});}
  const scopes=[{id:'$project',label:project.label,kind:'project',root:root.root,writable:true,store:root},...folders];
  const fingerprint=await root.services.hash(JSON.stringify([project,instance?.sha256,scopes.map(({id,root,writable})=>({id,root,writable}))]));
  let grant=null;try{grant=JSON.parse((await root.read(ACCESS))?.text??'null');}catch{}
  const identity=instance?.sha256??null,approved=scopes.map(({id,root,kind,writable})=>({id,root,kind,writable}));
  const granted=grant?.project===project.id&&grant?.instance===identity&&Array.isArray(grant.scopes)&&approved.every(f=>grant.scopes.some(g=>JSON.stringify(g)===JSON.stringify(f)));
  return {project,scopes,fingerprint,identity,approved,granted};
 }
 async function privateWrite(name,data){const previous=await root.read(name);await root.write(name,JSON.stringify(data)+'\n',{expected:previous?.sha256??null,mode:0o600});await fs.chmod(await root.location(name),0o600);}
 async function run(q){
  const c=await catalog();
  if(q.op==='catalog')return {project:c.project,folders:c.scopes.map(({store,...f})=>f),fingerprint:c.fingerprint,granted:c.granted};
  if(q.op==='revoke'){await privateWrite(ACCESS,{fingerprint:null});return {revoked:true};}
  if(q.op==='grant'){requireThat(q.fingerprint===c.fingerprint,'stale','Folder assignments changed. Confirm the current folders.');await privateWrite(ACCESS,{fingerprint:c.fingerprint,project:c.project.id,instance:c.identity,scopes:c.approved,confirmed_at:root.services.now()});return {granted:true};}
  requireThat(c.granted,'grant_required','Bestätige den Zugriff auf die gespeicherten Ordner.');
  if(q.op==='pick'){
   requireThat(pickFolder,'host_picker','Dieser Host bietet keine Ordnerauswahl. Verbinde den zusätzlichen Ordner im Agent-Setup.');
   const selected=await pickFolder();if(!selected)return null;const store=new NodeStore(selected);await store.location('');const id='picked-'+randomBytes(16).toString('hex');pending.set(id,store);return {scope:id,name:path.basename(store.root)};
  }
  if(q.op==='bind'){
   requireThat(typeof q.id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(q.id)&&!['__proto__','constructor','prototype'].includes(q.id),'binding','Invalid folder ID.');
   const store=pending.get(q.scope);requireThat(store,'binding','Choose the new folder first.');
   requireThat(!c.project.folders.some(f=>f.id===q.id),'binding','Existing assignments must be changed through the agent setup.');
   const bindings=await loadBindings(root,{file:bindingsFile});bindings[q.id]=store;
   await privateWrite('.llmwiki/device-bindings.json',{format:'llmwiki-device-bindings/1',folders:Object.fromEntries(Object.entries(bindings).map(([id,s])=>[id,s.root]))});return {bound:true};
  }
  const scope=c.scopes.find(f=>f.id===q.scope),picked=pending.get(q.scope),store=scope?.store??picked;
  requireThat(store,'binding',scope?.error??'Folder is not connected.');
  const p=relativePath(q.path??'',{root:true});requireThat(!privatePath(p),'private','Editor credentials and device mappings are private.');
  if(q.op==='resolve'){
   const other=c.scopes.find(f=>f.id===q.other)?.store??pending.get(q.other);requireThat(other,'binding','Unknown folder.');
   const base=await store.location(p),target=await other.location(q.otherPath??''),rel=path.relative(base,target);return rel===''?[]:rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel)?null:rel.split(path.sep);
  }
  if(q.op==='stat'){try{const s=await fs.lstat(await store.location(p));return {kind:s.isDirectory()?'directory':'file'};}catch(e){if(e.code==='ENOENT')return null;throw e;}}
  if(q.op==='list'){const entries=(await store.list(p,{recursive:false,hidden:true})).filter(e=>e.kind!=='symlink'&&!privatePath(e.path));return Promise.all(entries.map(async e=>{const s=await fs.lstat(await store.location(e.path));return {...e,size:s.size,modified:s.mtimeMs};}));}
  if(q.op==='read'){const f=await store.read(p,{binary:true});return f?{data:Buffer.from(f.bytes).toString('base64'),sha256:f.sha256,modified_at:f.modified_at}:null;}
  const target=await store.location(p);const sourceOverlap=c.scopes.some(f=>f.kind==='source'&&f.root&&(target===f.root||target.startsWith(f.root+path.sep)));
  requireThat(scope&&scope.writable&&!picked&&!sourceOverlap,'read-only','Source folders and unassigned folders are read-only.');
  if(q.op==='mkdir'){await store.mkdir(p);return {created:true};}
  if(q.op==='write'){
   requireThat(typeof q.data==='string'&&q.data.length<=180*1024*1024,'size','Invalid or oversized file.');
   const bytes=new Uint8Array(Buffer.from(q.data,'base64'));if(scope.id==='$project'&&p==='llmwiki.project.json'){const saved=await saveSettings(root,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),q.expected,{bindings:await loadBindings(root,{file:bindingsFile})});return {saved:true,sha256:saved.sha256};}return store.write(p,bytes,{expected:q.expected});
  }
  if(q.op==='remove'){
   requireThat(p&&!p.split('/').some(v=>v.startsWith('.')),'path','Only a selected visible file may be moved.');
   const seen=await store.read(p);requireThat(seen&&seen.sha256===q.expected,'stale','The file changed before the move.');
   // Retain a recoverable copy; detaching folders never calls this operation.
   await store.archive(p,'.llmwiki/editor-archive/'+root.services.uuid()+'/'+path.basename(p),seen.sha256);return {removed:true,archived:true};
  }
  throw Object.assign(Error('Unknown editor operation.'),{code:'operation'});
 }
 const server=http.createServer(async(req,res)=>{
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"frame-ancestors 'none'"};
  const reply=(status,value)=>{res.writeHead(status,{...headers,'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  try{
   requireThat(req.headers.host===new URL(origin).host,'origin','Unexpected host.');
   if(req.method==='GET'&&req.url==='/'){
    const current=await root.read('LLM-Wiki.html');const template=current?.text??html;
    const page=template.replace("connect-src 'none'","connect-src 'self'").replace('<head>','<head><script type="application/json" id="llmwiki-host">'+safeJSON({root:root.root})+'</script>');
    res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8'});res.end(page);return;
   }
   requireThat(req.method==='POST'&&req.url==='/api','route','Unknown route.');
   const actual=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+token);
   if(actual.length!==expected.length||!timingSafeEqual(actual,expected)){reply(401,{ok:false,error:{code:'auth',message:'Open the personal editor start link.'}});return;}
   if(req.headers.origin!==origin){reply(403,{ok:false,error:{code:'origin',message:'Foreign origins are not permitted.'}});return;}
   requireThat(req.headers['content-type']?.split(';')[0]==='application/json','content','JSON required.');
   const chunks=[];let size=0;for await(const bytes of req){size+=bytes.length;requireThat(size<=180*1024*1024,'size','Request too large.');chunks.push(bytes);}
   const q=JSON.parse(Buffer.concat(chunks).toString());requireThat(q&&typeof q==='object'&&!Array.isArray(q),'request','Object required.');
   if(q.op==='stop'){reply(200,{ok:true,result:{stopped:true}});setImmediate(()=>server.close());return;}
   reply(200,{ok:true,result:await run(q)});
  }catch(e){reply(400,{ok:false,error:{code:e.code??'request',message:e.message}});}
 });
 server.requestTimeout=30000;server.headersTimeout=10000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
 return {origin,token,url:origin+'/#'+token,server,close:async()=>{if(closed)return;closed=true;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
