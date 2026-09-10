/** Resumable Node sync. Completed units retain filesystem proofs, not authority to
 * overwrite files. Every transfer still uses the shared clearance, journal and CAS.
 */
import {load,context} from './project.mjs';
import {sync,handle} from './review.mjs';
import {dispatch} from './dispatch.mjs';
import {exportGraph,exportProjectGraph} from './derived.mjs';
import {nodeBudget,integer} from './node-budget.mjs';
import {requireThat,WikiError} from './core/errors.mjs';
const FORMAT='llmwiki-node-sync/1',LIMIT=32*1024*1024;
const json=v=>JSON.stringify(v),equal=(a,b)=>json(a)===json(b);
const ordered=items=>items===null?null:items.map(({path,kind})=>({path,kind})).sort((a,b)=>a.path.localeCompare(b.path)||a.kind.localeCompare(b.kind));
const empty=()=>({copied:0,published:0,pending:0,pending_details:[],conflicts:[]});
const encode=v=>v instanceof Set?{type:'set',values:[...v]}:v===undefined?null:v;
const decode=v=>v?.type==='set'?new Set(v.values):v;
function delta(before,after){return {copied:after.copied-before.copied,published:after.published-before.published,pending:after.pending-before.pending,pending_details:after.pending_details.slice(before.pending_details.length),conflicts:after.conflicts.slice(before.conflicts.length)};}
function add(target,value){for(const key of ['copied','published','pending'])target[key]+=value[key];for(const key of ['pending_details','conflicts'])target[key].push(...value[key]);}
// Update directory proofs only for our verified writes, never by accepting a fresh
// unrelated listing. A foreign entry therefore invalidates the cached unit.
function changedList(dep,name,kind,remove=false){
 const prefix=dep.path?dep.path+'/':'';if(!name.startsWith(prefix))return;
 const parts=name.slice(prefix.length).split('/');if(!dep.options.hidden&&parts.some(p=>p.startsWith('.')||p.startsWith('~$')))return;
 if(remove){if(dep.value)dep.value=dep.value.filter(e=>e.path!==name);return;}
 dep.value??=[];
 let current=dep.path;for(let i=0;i<parts.length;i++){
  current=current?current+'/'+parts[i]:parts[i];if(dep.options.recursive===false&&i>0)break;
  if(!dep.value.some(e=>e.path===current))dep.value.push({path:current,kind:i===parts.length-1?kind:'directory'});
 }
 dep.value=ordered(dep.value);
}
export async function nodeSync(root,request,{bindings={}}={}){
 const scope=nodeBudget(request),maxSteps=integer(request.max_steps,64,1,256,'max_steps'),guarded=scope.wrap(root);
 const bound=Object.fromEntries(Object.entries(bindings).map(([id,store])=>[id,scope.wrap(store)]));
 const {file}=await load(guarded),c=await context(guarded,request.connection,{bindings:bound});
 const connection=c.connection.id,checkpoint='.llmwiki/sync/'+await root.services.hash(connection)+'.json',seen=await guarded.read(checkpoint);
 const marker=await guarded.read('.llmwiki/project-instance.json');
 const identity=await root.services.hash(json({project:file.sha256,instance:marker?.sha256,root:root.root,connection,work:c.work.root,remote:c.remote.root,canPublish:c.canPublish,bindings:Object.entries(bindings).map(([id,s])=>[id,s.root]).sort()}));
 let state;
 if(request.cursor!==undefined){
  requireThat(typeof request.cursor==='string'&&/^[a-f0-9]{64}$/.test(request.cursor)&&seen?.sha256===request.cursor,'sync_stale','The sync checkpoint changed. Start a fresh sync without a cursor; keep existing knowledge and journals.');
  state=JSON.parse(seen.text);requireThat(state.format===FORMAT&&state.identity===identity&&Date.now()-state.started_at<86400000,'sync_stale','Project, binding or sync age changed. Start a fresh sync.');
 }else state={format:FORMAT,identity,started_at:Date.now(),phase:'sync',steps:{},result:empty()};
 if(request.detail){
  requireThat(request.cursor,'sync_detail','A detail request needs the returned cursor.');
  const {kind,index,field,offset=0}=request.detail;
  requireThat(['conflicts','pending_details','shadow_findings'].includes(kind)&&Number.isInteger(index)&&index>=0,'sync_detail','Use the returned detail request.');
  const item=(kind==='shadow_findings'?state.shadow?.findings:state.result[kind])?.[index];requireThat(item,'sync_detail','Finding is unavailable.');
  if(field===undefined)return {complete:false,detail:{...Object.fromEntries(Object.entries(item).filter(([k])=>!['mine','base','theirs'].includes(k))),fields:Object.fromEntries(['mine','base','theirs'].map(k=>[k,typeof item[k]==='string'?item[k].length:null]))},next:'Read each text field in bounded chunks using detail.field and detail.offset before an explicit conflict decision.'};
  requireThat(['mine','base','theirs'].includes(field)&&Number.isInteger(offset)&&offset>=0,'sync_detail','Choose a text field and a non-negative offset.');
  const value=item[field]??null;return {complete:false,detail:{kind,index,field,offset,text:value===null?null:value.slice(offset,offset+4096),length:value?.length??0,next_offset:value&&offset+4096<value.length?offset+4096:null}};
 }
 const stores=new Map([[c.work.root,c.work],[c.remote.root,c.remote]]);let active=null,steps=0,blocked=null;
 const depKey=d=>json([d.store,d.kind,d.path,d.options]);
 scope.observe(async event=>{
  if(!active)return;
  if(event.kind==='file'||event.kind==='list'){
   const dep={kind:event.kind,store:event.store.root,path:event.path,...(event.kind==='list'?{options:event.options,value:ordered(event.value)}:{value:event.value})};active.set(depKey(dep),dep);return;
  }
  const changes=event.kind==='archive'?[[event.args[0],null],[event.args[1],'file']]:[[event.args[0],event.kind==='mkdir'?'directory':'file']];
  for(const [name,kind]of changes){
   if(kind!=='directory'){
    const value=kind===null?null:await scope.read(()=>event.store.fingerprint(name),{operation:'write_verification',path:name,store:event.store.root});
    const dep={kind:'file',store:event.store.root,path:name,value};active.set(depKey(dep),dep);
   }
   for(const deps of [active.values(),...Object.values(state.steps).map(s=>s.deps)])for(const dep of deps)if(dep.kind==='list'&&dep.store===event.store.root)changedList(dep,name,kind,kind===null);
  }
 });
 async function valid(unit){
  for(const dep of unit.deps){
   const store=stores.get(dep.store);if(!store)return false;
   let value;try{value=dep.kind==='file'?await store.fingerprint(dep.path):ordered(await store.list(dep.path,dep.options));}catch(error){if(error.code==='ENOENT')value=null;else throw error;}
   if(!equal(value,dep.value))return false;
  }return true;
 }
 async function step(key,fn,result){
  scope.check();const unit=state.steps[key];
  if(unit&&await valid(unit)){if(result&&unit.delta)add(result,unit.delta);return decode(unit.value);}
  if(steps>=maxSteps||scope.remaining<Math.min(1000,scope.readTimeout))throw new WikiError('sync_yield','Continue the sync with a fresh call budget.');
  delete state.steps[key];active=new Map();const before=result?structuredClone(result):null;
  try{const value=await fn();scope.check();state.steps[key]={deps:[...active.values()],value:encode(value),...(result?{delta:delta(before,result)}:{})};steps++;return value;}
  finally{active=null;}
 }
 try{
  if(state.phase==='sync'){
   state.result=await sync.run({work:handle(c.work),remote:handle(c.remote),identity:c.identity,canPublish:c.canPublish,step});scope.check();state.phase='work_graph';
  }else if(state.phase==='work_graph'){
   await exportGraph(c.work);scope.check();state.phase=c.canPublish?'remote_graph':'project_graph';
  }else if(state.phase==='remote_graph'){
   await exportGraph(c.remote);scope.check();state.phase='project_graph';
  }else if(state.phase==='project_graph'){
   const graph=await exportProjectGraph(guarded,{bindings:bound});scope.check();state.graph={revision:graph.revision,generated_at:graph.generated_at,complete:graph.complete};state.phase='shadow';
  }else if(state.phase==='shadow'){
   state.shadow=await dispatch(guarded,{action:'shadow.refresh',connection},{bindings:bound});scope.check();state.phase='done';
  }
 }catch(error){
  error=scope.failure??error;
  if(!['sync_yield','runtime_budget','runtime_read_timeout','sync_changed'].includes(error.code))throw error;
  if(['runtime_read_timeout','sync_changed'].includes(error.code))blocked={code:error.code,message:error.message,details:error.details};
 }
 // No observation is active here; progress uses the original CAS adapter even
 // after a timed-out read. One blocked read leaves native threads for this write.
 scope.observe(null);
 const findings={conflicts:[],pending_details:[],shadow_findings:[]},all=['conflicts','pending_details','shadow_findings'].flatMap(kind=>(kind==='shadow_findings'?state.shadow?.findings??[]:state.result[kind]).map((item,index)=>({kind,index,item})));
 let deliveryComplete=false;
 if(state.phase==='done'){
  state.delivered??=0;
  while(state.delivered<all.length){
   const {kind,index,item}=all[state.delivered],entry=Buffer.byteLength(json(item))<=4096?item:{page:item.page,reason:item.reason??item.code??'conflict',detail_request:{action:'sync',connection,cursor:'0'.repeat(64),detail:{kind,index}}};
   findings[kind].push(entry);if(Buffer.byteLength(json(findings))>16*1024){findings[kind].pop();break;}state.delivered++;
  }
  deliveryComplete=state.delivered===all.length;
 }
 const text=json(state)+'\n';requireThat(Buffer.byteLength(text)<=LIMIT,'sync_checkpoint_limit','Sync checkpoint exceeds 32 MiB. Sync remains incomplete.');
 const saved=await root.write(checkpoint,text,{expected:seen?.sha256??null});
 for(const list of Object.values(findings))for(const item of list)if(item.detail_request)item.detail_request.cursor=saved.sha256;
 const next=deliveryComplete?null:{action:'sync',connection,cursor:saved.sha256,budget_ms:scope.budget,read_timeout_ms:scope.readTimeout,max_steps:maxSteps};
 const result={...state.result,conflicts:findings.conflicts,pending_details:findings.pending_details,complete:deliveryComplete&&!state.result.pending&&!state.result.conflicts.length&&state.graph?.complete!==false&&state.shadow?.complete!==false,sync_complete:state.phase!=='sync',delivery_complete:deliveryComplete,findings_total:all.length,progress:{phase:state.phase,steps_completed:steps,steps_saved:Object.keys(state.steps).length},graph:state.graph,shadow:state.shadow?{...state.shadow,findings:findings.shadow_findings}:undefined,next_request:blocked?null:next,...(blocked?{blocked,resume_request:next}:{}),next:blocked?'The named file remains unreadable. Retry resume_request once; if the same file blocks again, report it and stop. Never bypass clearance or change sandbox grants.':next?'Continue next_request until it is null. Sync and derived maintenance are not finished yet.':'Review all conflicts, pending items and incomplete graph/shadow findings before maintenance can be considered complete.'};
 return result;
}
