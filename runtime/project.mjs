/** Human-facing wiki/source connections; private working copies stay implicit. */
import {projectSettings,handle,sync} from './review.mjs';
import {createBundle} from './content.mjs';
import {requireThat,nonempty,relativePath} from './core/errors.mjs';
import {parseDocument,sectionText} from './core/document.mjs';
import {setupContract,validateSetupAnswers} from './setup-contract.mjs';

const NAME='llmwiki.project.json';
export function validateLocations(root,project,bindings){
 const clean=value=>typeof value==='string'?value.replace(/\\/g,'/').replace(/\/+$/,''):null;
 const location=f=>f.path===null?clean(bindings[f.id]?.root):clean(f.path==='.'?root.root:[root.root,f.path].filter(Boolean).join('/'));
 const overlaps=(a,b)=>a!==null&&b!==null&&(a===b||a===''||b===''||a.startsWith(b+'/')||b.startsWith(a+'/'));
 for(const c of project.connections){const folder=id=>project.folders.find(f=>f.id===id),wiki=folder(c.wiki),works=c.works.map(folder);
  for(const work of works)requireThat(!overlaps(location(wiki),location(work)),'binding_overlap','Wiki storage and working copy must be separate directories.',{wiki:wiki.id,work:work.id});
  for(const source of c.sources.map(folder))for(const target of [wiki,...works])requireThat(!overlaps(location(source),location(target)),'binding_overlap','The source binding points inside a wiki/working copy or contains it. Bind the actual original source directory.',{source:source.id,target:target.id});
 }
}
const INSTANCE='.llmwiki/project-instance.json';
export const WORKSPACE_STATE='.llmwiki/workspace-state.json';
export async function workspaceState(root){const {project}=await load(root),marker=await root.read(INSTANCE),f=await root.read(WORKSPACE_STATE);let data=null;try{data=f?JSON.parse(f.text):null;}catch{}return data?.format==='llmwiki-workspace-state/1'&&data.project===project.id&&data.instance===JSON.parse(marker?.text??'null')?.instance&&project.connections.some(c=>c.id===data.connection&&c.works.includes(data.work))?data:null;}
export async function selectWorkspace(root,connection,work){const {project}=await load(root),c=project.connections.find(c=>c.id===connection);requireThat(c,'connection','Select a connected wiki.');work??=c.works.length===1?c.works[0]:null;requireThat(c.works.includes(work),'work','Choose an assigned working copy.');const marker=await ensureInstance(root,project),seen=await root.read(WORKSPACE_STATE),data={format:'llmwiki-workspace-state/1',project:project.id,instance:marker.instance,connection,work};await root.write(WORKSPACE_STATE,JSON.stringify(data,null,2)+'\n',{expected:seen?.sha256??null});return data;}
const entryLocation=root=>root.editorLocation?.()??{project_root:null,entry_path:'LLM-Wiki.html',entry_uri:null};
const isolatedWorkingCopy=project=>project.folders.some(f=>f.kind==='work'&&/^\.llmwiki\/working\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\//i.test(f.path??''));
async function legacyBrowserGrant(root,project){
 const settings=await root.read(NAME);requireThat(settings&&JSON.stringify(projectSettings.validate(JSON.parse(settings.text)))===JSON.stringify(project),'stale','Project settings changed before browser recovery.');
 return {format:'llmwiki-browser-migration/1',project:project.id,settings_sha256:settings.sha256,folders:project.folders.map(({id,kind,path})=>({id,kind,path}))};
}
/** A project ID can be reused after setup; browser handles and drafts bind to this lifecycle. */
export async function ensureInstance(root,project,{instance=null,origin=instance?'setup':'upgrade'}={}){
 const seen=await root.read(INSTANCE);
 if(seen&&!instance){
  const previous=JSON.parse(seen.text);
  requireThat(previous.format==='llmwiki-project-instance/1'&&typeof previous.instance==='string'&&/^[a-f0-9-]{36}$/i.test(previous.instance),'instance','The project instance marker is invalid.');
  if(previous.project===project.id)return previous;
 }
 let legacy=false;
 if(origin==='upgrade'&&!seen){
  const starter=await root.read('LLM-Wiki.html');
  requireThat(!isolatedWorkingCopy(project)&&!/<meta\s+name="llmwiki-entry-instance"(?:\s|>)/.test(starter?.text??''),'instance','The project instance marker is missing. Restore its identity before updating this existing starter.');
  const version=editorVersion(starter?.text),parts=version?.match(/^(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number);
  legacy=Boolean(starter)&&(!version||parts&&parts[0]===0&&(parts[1]<4||parts[1]===4&&parts[2]<2));
  requireThat(!starter||legacy,'instance','The existing starter has no verifiable legacy identity. Restore the project instance marker before updating it.');
 }
 const data={format:'llmwiki-project-instance/1',project:project.id,instance:instance??root.services.uuid(),origin};
 if(legacy)data.legacy_browser=await legacyBrowserGrant(root,project);
 await root.write(INSTANCE,JSON.stringify(data,null,2)+'\n',{expected:seen?.sha256??null});return data;
}
async function recoverBrowser(root,project,recovery){
 const settings=await root.read(NAME),seen=await root.read(INSTANCE);
 requireThat(recovery&&typeof recovery==='object'&&!Array.isArray(recovery)&&settings?.sha256===recovery.expected,'stale','Project settings changed; browser recovery requires the exact read baseline.');
 const marker=seen?JSON.parse(seen.text):null;
 requireThat(marker?.format==='llmwiki-project-instance/1'&&marker.project===project.id&&marker.instance===recovery.instance,'instance','Read the current project instance before recovering browser connections.');
 requireThat((marker.origin===undefined||marker.origin==='upgrade')&&!isolatedWorkingCopy(project),'reset','A new or fresh setup must not inherit connections from an earlier project instance.');
 const grant=await legacyBrowserGrant(root,project);
 if(JSON.stringify(marker.legacy_browser)!==JSON.stringify(grant))await root.write(INSTANCE,JSON.stringify({...marker,legacy_browser:grant},null,2)+'\n',{expected:seen.sha256});
}
const editorVersion=html=>html?.match(/<meta name="llmwiki-editor-version" content="([^"]+)">/)?.[1]??null;
function embeddedJSON(html,id){try{const text=html?.match(new RegExp('<script type="application/json" id="'+id+'">([\\s\\S]*?)</script>'))?.[1];return text?JSON.parse(text):null;}catch{return null;}}
export async function inspect(root,{editorHTML=null,bindings={}}={}){const file=await root.read(NAME);if(file){const project=projectSettings.validate(JSON.parse(file.text)),issues=[];
 for(const c of project.connections)for(const id of c.works){const work=project.folders.find(f=>f.id===id);try{const store=await folderStore(root,work,{bindings,writable:false}),bundle=await store.read('wiki/bundle.md'),purpose=bundle?sectionText(parseDocument(bundle.text).body,['Zweck','Purpose']):'';if(!purpose||/Noch nicht geschrieben|Not yet written/i.test(purpose))issues.push({connection:c.id,work:id,code:bundle?'bundle_purpose_missing':'working_bundle_missing'});}catch(error){issues.push({connection:c.id,work:id,code:'bundle_unreadable',message:error.message});}}
 const locations=project.folders.map(f=>({id:f.id,kind:f.kind,location:f.path===null?bindings[f.id]?.root??null:f.path==='.'?root.root:[root.root,f.path].join('/'),external:f.path===null,binding_available:f.path!==null||Boolean(bindings[f.id]),write_configured:f.writable}));
 const entry=await root.read('LLM-Wiki.html'),version=editorVersion(entry?.text),current_version=editorVersion(editorHTML);
 const bindingLocations=Object.fromEntries(locations.filter(f=>f.external&&f.location!==null).map(f=>[f.id,f.location]));
 const location=entryLocation(root),bindingChanged=JSON.stringify(embeddedJSON(entry?.text,'llmwiki-editor-design'))!==JSON.stringify(embeddedJSON(editorHTML,'llmwiki-editor-design'))||JSON.stringify(embeddedJSON(entry?.text,'llmwiki-entry-binding-locations'))!==JSON.stringify(bindingLocations)||JSON.stringify(embeddedJSON(entry?.text,'llmwiki-entry-location'))!==JSON.stringify(location)||JSON.stringify(embeddedJSON(entry?.text,'llmwiki-entry-settings'))!==JSON.stringify(project);
 const editor={exists:Boolean(entry),version,current_version,update_required:Boolean(editorHTML)&&(!entry||version!==current_version||bindingChanged),...location};
 return {next:issues.length?'repair_setup':'choose_task',project,sha256:file.sha256,issues,locations,editor};}
 const draft=await root.read('.llmwiki/setup.json'),starter=await root.read('LLM-Wiki.html');return {project_root:entryLocation(root).project_root,project_hint:embeddedJSON(starter?.text,'llmwiki-entry-location')?.project_root??null,next:'setup',draft:draft?JSON.parse(draft.text).answers:{},draft_sha256:draft?.sha256??null,folders:(await root.list('',{recursive:false})).filter(e=>e.kind==='directory').map(e=>e.path),questions:['editor','wikis','sources','author'],setup_contract:setupContract(draft?.sha256??null)};}
export async function setupDraft(root,answers,expected){
 validateSetupAnswers(answers);
 const file=await root.read('.llmwiki/setup.json');requireThat((file?.sha256??null)===expected,'stale','Setup answers changed. Read inspect and merge the saved answers before retrying.',{draft_sha256:file?.sha256??null,next_request:{action:'inspect'}});
 const combined={...(file?JSON.parse(file.text).answers:{}),...answers};const saved=await root.write('.llmwiki/setup.json',JSON.stringify({format:'llmwiki-setup/1',answers:combined},null,2)+'\n',{expected});return {answers:combined,sha256:saved.sha256};
}
export async function load(root){const file=await root.read(NAME);requireThat(file,'setup','Start guided setup before selecting a task.');return {project:projectSettings.validate(JSON.parse(file.text)),file};}
export async function saveSettings(root,data,expected,{editorHTML=null,bindings={}}={}){
 projectSettings.validate(data);validateLocations(root,data,bindings);const seen=await root.read(NAME);requireThat((seen?.sha256??null)===expected,'stale','Project settings changed.');
 await root.write(NAME,JSON.stringify(data,null,2)+'\n',{expected});const verified=await load(root);
 if(editorHTML)await installEditor(root,data,editorHTML,{bindings});return {project:verified.project,sha256:verified.file.sha256,settings_verified:true};
}
export async function folderStore(root,folder,{bindings={},writable=folder.writable}={}){
  if(folder.path===null){requireThat(bindings[folder.id],'binding','Connect this device to the selected folder.',{folder:folder.id});return bindings[folder.id].substore('',{writable:writable&&folder.kind!=='source'});}
  return root.substore(folder.path,{writable:writable&&folder.kind!=='source'});
}
export async function configure(root,request,{bindings={},editorHTML=null}={}){
  nonempty(request.author,'author');requireThat(Array.isArray(request.wikis)&&request.wikis.length,'wiki','Select at least one wiki.');
  const existing=await root.read(NAME);requireThat((existing?.sha256??null)===(request.expected??null),'stale','Project settings changed; reload their exact baseline.');
  requireThat(request.fresh===undefined||typeof request.fresh==='boolean','setup','fresh must be a boolean.');
  const previous=existing?projectSettings.validate(JSON.parse(existing.text)):null;
  const newInstance=!existing||request.fresh?root.services.uuid():null;
  const project={format:'llmwiki-project/1',id:request.id,label:request.label,editor:request.editor??'builtin',folders:[],connections:[]};
  for(const w of request.wikis){nonempty(w.purpose,'purpose');requireThat(Array.isArray(w.audience)&&w.audience.length,'audience','Name the reader circle.');
    const previousWork=previous?.folders.find(f=>f.id===previous.connections.find(c=>c.wiki===w.id)?.works[0]);
    const workId=previousWork?.id??'work-'+w.id,workPath=Object.hasOwn(w,'workPath')?w.workPath:request.fresh?'.llmwiki/working/'+newInstance+'/'+w.id:previousWork?previousWork.path:'.llmwiki/working/'+w.id;
    requireThat(!previousWork||request.fresh||workPath===previousWork.path,'relocation','Use workspace.relocate to preserve an existing working copy when changing its directory.');
    requireThat(w.path!=='.'&&(w.path===null||w.path!==workPath),'wiki','Choose a separate wiki directory within or connected to the project.');
    project.folders.push({id:w.id,label:w.label,kind:'wiki',...(w.icon?{icon:w.icon}:{}),path:w.path,writable:w.writable!==false,readers:w.audience,writers:w.writable===false?[]:[request.author]},
      {id:workId,label:w.label,kind:'work',path:workPath,writable:true,readers:[request.author],writers:[request.author]});
    const sources=(request.sources??[]).filter(s=>s.wikis.includes(w.id)).map(s=>s.id);
    project.connections.push({id:w.id,label:w.label,wiki:w.id,works:[workId],sources,default_source:Object.hasOwn(w,'default_source')?w.default_source:(sources.length===1?sources[0]:null),mode:w.shared?'gemeinsam':'eigen'});
  }
  for(const s of request.sources??[])project.folders.push({id:s.id,label:s.label,kind:'source',...(s.icon?{icon:s.icon}:{}),path:s.path,writable:s.writable===true,readers:[request.author],writers:s.writable===true?[request.author]:[]});
  projectSettings.validate(project);
  validateLocations(root,project,bindings);
  // Validate access and user answers before creating any bundle files.
  for(const f of project.folders){if(f.path===null)requireThat(bindings[f.id],'binding','External folder permission is missing.',{folder:f.id});else if(f.kind==='source')await root.substore(f.path,{writable:false});}
  if(request.fresh)for(const w of request.wikis.filter(w=>Object.hasOwn(w,'workPath'))){const work=project.folders.find(f=>f.id===project.connections.find(c=>c.wiki===w.id).works[0]),store=await folderStore(root,work,{bindings});let entries;try{entries=await store.list('',{hidden:true});}catch(error){if(error.code!=='ENOENT')throw error;entries=[];}requireThat(!entries.length,'reset','A fresh setup needs an empty explicitly selected working directory; existing content is preserved.',{work:work.id});}
  for(const w of request.wikis){
    const wiki=project.folders.find(f=>f.id===w.id),work=project.folders.find(f=>f.id===project.connections.find(c=>c.wiki===w.id).works[0]);
    if(wiki.path!==null)await root.mkdir(wiki.path);if(work.path!==null)await root.mkdir(work.path);
    const remote=await folderStore(root,wiki,{bindings}),local=await folderStore(root,work,{bindings});
    const options={work:handle(local),remote:handle(remote),identity:syncIdentity(project,wiki,work)};
    const received=await sync.run({...options,canPublish:false});requireThat(!received.conflicts.length,'conflict','Existing working content differs from the selected wiki; resolve it before reconfiguration.',received);
    if(wiki.writable){
      await createBundle(local,{title:w.label,purpose:w.purpose,audience:w.audience,author:request.author,language:request.language??'de'});
      const published=await sync.run({...options,canPublish:true});requireThat(!published.conflicts.length&&!published.pending,'sync','Setup content could not be synchronized.',published);
    }else requireThat(await local.read('wiki/bundle.md'),'bundle','Read-only wiki has no bundle.');
  }
  await root.write(NAME,JSON.stringify(project,null,2)+'\n',{expected:existing?.sha256??null});
  const verified=await load(root);requireThat(JSON.stringify(verified.project)===JSON.stringify(project),'settings','Settings readback failed.');
  await ensureInstance(root,project,{instance:newInstance,origin:request.fresh?'reset':existing?'upgrade':'setup'});
  if(editorHTML)await installEditor(root,project,editorHTML,{bindings});
  return {project,sha256:verified.file.sha256,entry:editorHTML?'LLM-Wiki.html':null};
}
export function syncIdentity(project,wiki,work){return JSON.stringify([project.id,wiki.id,wiki.path,work.id,work.path]);}
export async function context(root,connection,{bindings={},work:workID}={}){
  const {project}=await load(root),active=await workspaceState(root);connection??=active?.connection??(project.connections.length===1?project.connections[0].id:null);const c=project.connections.find(c=>c.id===connection);requireThat(c,'connection','Select a connected wiki.');
  const folder=id=>project.folders.find(f=>f.id===id),wiki=folder(c.wiki),work=folder(workID??(active?.connection===c.id?active.work:null)??(c.works.length===1?c.works[0]:null));
  validateLocations(root,{...project,connections:[c]},bindings);
  requireThat(work&&c.works.includes(work.id),'work','Working folder is not assigned to this wiki.');
  const sources=[];for(const id of c.sources){const f=folder(id);try{sources.push({...f,store:await folderStore(root,f,{bindings,writable:false})});}catch(error){sources.push({...f,store:null,error:{code:error.code,message:error.message}});}}
  return {project,connection:c,wiki,workFolder:work,work:await folderStore(root,work,{bindings}),remote:await folderStore(root,wiki,{bindings}),sources,identity:syncIdentity(project,wiki,work),canPublish:wiki.writable};
}
export async function detach(root,id,expected,{editorHTML=null,bindings={}}={}){
  const {project,file}=await load(root);requireThat(file.sha256===expected,'stale','Project settings changed.');
  requireThat(project.folders.some(f=>f.id===id&&f.kind!=='work'),'folder','Select a wiki or source folder.');
  project.folders=project.folders.filter(f=>f.id!==id);project.connections=project.connections.filter(c=>c.wiki!==id).map(c=>({...c,sources:c.sources.filter(s=>s!==id),...(c.default_source===id?{default_source:null}:{})}));
  const used=new Set(project.connections.flatMap(c=>c.works));project.folders=project.folders.filter(f=>f.kind!=='work'||used.has(f.id));
  projectSettings.validate(project);await root.write(NAME,JSON.stringify(project,null,2)+'\n',{expected});if(editorHTML)await installEditor(root,project,editorHTML,{bindings});
  return {detached:id,deleted:0,project};
}
export async function installEditor(root,project,html,{recover_browser=null,bindings={}}={}){
  const path='LLM-Wiki.html',seen=await root.read(path),banner='<!-- Diese Seite wird erzeugt, aus app/ gebaut und nie von Hand geändert. -->';
  requireThat(!seen||seen.text.slice(0,1024).includes(banner),'entry','The existing LLM-Wiki.html is not a generated editor.');
  requireThat(html.includes(banner)&&html.includes('<head>'),'entry','Editor template is incomplete.');
  if(recover_browser!==null)await recoverBrowser(root,project,recover_browser);
  const instance=await ensureInstance(root,project);
  const escapeJSON=value=>JSON.stringify(value).replace(/[&<>]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  const location=entryLocation(root);
  const inventory={};for(const f of project.folders.filter(f=>f.kind!=='wiki'))try{const store=await folderStore(root,f,{bindings,writable:false});inventory[f.id]=(await store.list('')).filter(e=>e.kind==='file'&&!e.path.split('/').some(p=>p.startsWith('.'))&&(f.kind==='source'||/\.md$/i.test(e.path)&&!e.path.startsWith('schema/'))).map(e=>({name:e.path}));}catch{/* A disconnected root keeps its assignment; no access is inferred. */}
  const inventoryRevision=await root.services.hash(JSON.stringify(inventory));
  const bindingNames=Object.fromEntries(project.folders.filter(f=>f.path===null&&typeof bindings[f.id]?.root==='string').map(f=>[f.id,bindings[f.id].root.replace(/\\/g,'/').split('/').filter(Boolean).at(-1)]));
  const bindingLocations=Object.fromEntries(project.folders.filter(f=>f.path===null&&typeof bindings[f.id]?.root==='string').map(f=>[f.id,bindings[f.id].root]));
  const marker='<meta name="llmwiki-entry-project" content="'+project.id+'">\n<meta name="llmwiki-entry-instance" content="'+instance.instance+'">\n<script type="application/json" id="llmwiki-entry-settings">'+escapeJSON(project)+'</script>\n<script type="application/json" id="llmwiki-entry-inventory" data-revision="'+inventoryRevision+'">'+escapeJSON(inventory)+'</script>\n<script type="application/json" id="llmwiki-entry-location">'+escapeJSON(location)+'</script>';
  const text=html.replace('<head>','<head>\n'+marker+'\n<script type="application/json" id="llmwiki-entry-binding-names">'+escapeJSON(bindingNames)+'</script>\n<script type="application/json" id="llmwiki-entry-binding-locations">'+escapeJSON(bindingLocations)+'</script>');if(text===seen?.text)return {page:path,unchanged:true,...location};
  await root.write(path,text,{expected:seen?.sha256??null});return {page:path,...location};
}
