/** Bounded Node monitoring. Derived checkpoints contain digests, never original bytes.
 * Knowledge and original stores stay read-only; only the project checkpoint is saved.
 * A supervising CLI drains JSON and terminates the worker with pending native reads.
 */
import {load,context} from './project.mjs';
import {integratedNotePlan} from './dispatch.mjs';
import {compareInventory} from './maintenance.mjs';
import {requireThat,WikiError} from './core/errors.mjs';

const CHECKPOINT='.llmwiki/source-monitor.json',FORMAT='llmwiki-source-monitor/1';
const OUTPUT_BYTES=24*1024,MAX_CHECKPOINT_BYTES=32*1024*1024;
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
function integer(value,fallback,min,max,name){value??=fallback;requireThat(Number.isInteger(value)&&value>=min&&value<=max,'monitor_budget',`${name} must be an integer from ${min} to ${max}.`);return value;}
function failure(error){return {code:error.code??'monitor',message:error.message,details:error.details??{}};}
async function timed(operation,ms,details){
 let timer;try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new WikiError('monitor_read_timeout','Reading exceeded this call’s budget; the item remains unresolved.',details)),ms);})]);}finally{clearTimeout(timer);}
}
function boundedStore(store,guard){
 return new Proxy(store,{get(target,key){
  if(['read','list','fingerprint'].includes(key))return (...args)=>guard(()=>target[key](...args),{operation:key,path:args[0]??'',store:target.root});
  if(key==='substore')return async (...args)=>boundedStore(await guard(()=>target.substore(...args),{operation:'substore',path:args[0],store:target.root}),guard);
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
}
const sourcePaths=async(store,prefix='')=>(await store.list(prefix)).filter(e=>e.kind==='file').map(e=>e.path).sort();
const sameNames=(a,b)=>a.length===b.length&&a.every((name,i)=>name===b[i]);
function queue(state,kind,value){
 if(value.error){state.scan_ok=false;state.maintenance_complete=false;}
 if(value.plan){
  if((value.plan.changes??[]).some(c=>c.state==='unreadable'))state.scan_ok=false;
  if(value.plan.complete===false||(value.plan.changes??[]).some(c=>c.state!=='unchanged'))state.maintenance_complete=false;
 }
 state.queue.push({kind,value});
}
/** A response may contain several fragments of a pair. Counts apply to that fragment. */
function deliver(state,maxItems){
 const out={pairs:[],notes:[]};let count=0;
 while(state.queue.length&&count<maxItems){
  const {kind,value}=state.queue[0],plan=value.plan;
  if(!plan){if(bytes(out)+bytes(value)>OUTPUT_BYTES&&count)break;out[kind].push(value);state.queue.shift();count++;continue;}
  const fragment={...value,plan:{...plan,changes:[],advisories:[],total_counts:plan.counts,counts:Object.fromEntries(Object.keys(plan.counts??{}).map(k=>[k,0])),page_complete:false}};
  out[kind].push(fragment);let added=0;
  for(const field of ['changes','advisories'])while(plan[field]?.length&&count<maxItems){
   const item=plan[field][0];fragment.plan[field].push(item);
   if(bytes(out)>OUTPUT_BYTES){
    fragment.plan[field].pop();
    if(!count){
     // Never hide an oversized finding or call it completed. Read its page separately.
     out[kind].pop();out[kind].push({connection:value.connection,wiki:value.wiki,source:value.source,error:{code:'monitor_item_too_large',message:'Read this item separately; its full findings exceed the response budget.',details:{path:item.path??item.page??null}}});
     plan[field].shift();state.scan_ok=false;state.maintenance_complete=false;count++;
    }else if(!added)out[kind].pop();
    return out;
   }
   plan[field].shift();count++;added++;
   if(field==='changes'&&item.state)fragment.plan.counts[item.state]=(fragment.plan.counts[item.state]??0)+1;
  }
  if(!plan.changes?.length&&!plan.advisories?.length){fragment.plan.page_complete=true;state.queue.shift();if(!added)count++;}
 }
 return out;
}

export async function monitor(root,request,{bindings={}}={}){
 const budget=integer(request.budget_ms,20000,100,20000,'budget_ms'),readTimeout=Math.min(integer(request.read_timeout_ms,2000,25,5000,'read_timeout_ms'),Math.floor(budget/4));
 const maxFiles=integer(request.max_files,128,1,256,'max_files'),maxItems=integer(request.max_items,64,1,128,'max_items');
 const summary=request.report==='summary';
 requireThat(request.report===undefined||summary,'monitor_report','report must be "summary" when supplied.');
 if(request.connection!==undefined)requireThat(typeof request.connection==='string'&&request.connection,'connection','Select an existing connection.');
 if(request.source!==undefined)requireThat(typeof request.source==='string'&&request.source,'source','Select an assigned source.');
 if(request.prefix!==undefined)requireThat(typeof request.prefix==='string','prefix','Select a source-relative prefix.');
 const deadline=Date.now()+budget;let readTimedOut=false,readFailure=null;
 const guard=(operation,details)=>{
  if(readFailure)throw readFailure;
  const remaining=deadline-Date.now();if(remaining<=0)throw new WikiError('monitor_read_timeout','This call’s read budget is exhausted.',details);
  return timed(operation,Math.min(readTimeout,remaining),details).catch(error=>{if(error.code==='monitor_read_timeout'){readTimedOut=true;readFailure??=error;}throw error;});
 };
 const guarded=boundedStore(root,guard),bound=Object.fromEntries(Object.entries(bindings).map(([id,store])=>[id,boundedStore(store,guard)]));
 const {project,file}=await load(guarded),seen=await guarded.read(CHECKPOINT);
 const identity=await root.services.hash(JSON.stringify({root:root.root,project:file.sha256,bindings:Object.entries(bindings).map(([id,s])=>[id,s.root]).sort()}));
 let state;
 if(request.cursor!==undefined){
  requireThat(typeof request.cursor==='string'&&/^[a-f0-9]{64}$/.test(request.cursor),'monitor_cursor','Use the exact returned cursor.');
  requireThat(seen?.sha256===request.cursor,'monitor_stale','The monitor checkpoint changed or is missing. Start source.monitor again without a cursor.');
  const checkpoint=JSON.parse(seen.text);
  requireThat(checkpoint.format===FORMAT&&checkpoint.identity===identity&&Date.now()-checkpoint.started_at<24*60*60*1000,'monitor_stale','The project, bindings or scan age changed. Start a fresh monitor without a cursor.');
  state=checkpoint;
 }else{
  const links=request.connection===undefined?project.connections:project.connections.filter(link=>link.id===request.connection);
  requireThat(links.length,'connection','Select an existing connection.');
  const tasks=links.map(link=>({kind:'notes',connection:link.id,wiki:link.wiki}));
  for(const link of links)for(const source of link.sources)if(request.source===undefined||source===request.source)tasks.push({kind:'pairs',connection:link.id,wiki:link.wiki,source,prefix:request.prefix??''});
  if(request.source!==undefined)requireThat(tasks.some(task=>task.kind==='pairs'),'source','Select a source assigned to the selected connection.');
  state={format:FORMAT,identity,started_at:Date.now(),tasks,task:0,current:null,queue:[],scan_ok:true,maintenance_complete:true,files_scanned:0,report:summary?'summary':'full'};
 }
 state.report??='full';
 let filesRead=0;
 // Deliver queued results before scanning more, so output stays bounded even for large wikis.
 while(!state.queue.length&&state.task<state.tasks.length&&!readTimedOut&&Date.now()<deadline&&filesRead<maxFiles){
  const task=state.tasks[state.task],ids={connection:task.connection,wiki:task.wiki,...(task.source?{source:task.source}:{})};
  try{
   const c=await context(guarded,task.connection,{bindings:bound});
   if(task.kind==='notes'){
    // The task itself is read-only. Late reads cannot commit a review or change a checkpoint.
    const plan=await timed(()=>integratedNotePlan(c.work),Math.max(1,deadline-Date.now()),{operation:'notes',connection:task.connection});
    queue(state,'notes',{...ids,plan});state.task++;continue;
   }
   const source=c.sources.find(s=>s.id===task.source);
   if(!source?.store)throw new WikiError(source?.error?.code??'binding',source?.error?.message??'Source store unavailable.');
   if(!state.current)state.current={files:await sourcePaths(source.store,task.prefix),originals:[],phase:'scan',validated:0};
   const scan=state.current;
   if(scan.phase==='scan'){
   while(scan.originals.length<scan.files.length&&filesRead<maxFiles&&deadline-Date.now()>readTimeout&&!readTimedOut){
    const name=scan.files[scan.originals.length];
    try{
     const before=await source.store.fingerprint(name),f=await source.store.read(name,{binary:true});
     requireThat(f,'monitor_source_changed','The listed source disappeared during this scan.',{path:name});
     const version=await source.store.fingerprint(name);
     requireThat(JSON.stringify(before)===JSON.stringify(version),'monitor_source_changed','The source changed while it was read.',{path:name});
     scan.originals.push({path:name,sha256:f.sha256,size:f.size,created_at:f.created_at,created_at_basis:f.created_at_basis,version});
    }catch(error){scan.originals.push({path:name,error:error.message,code:error.code??'read'});state.scan_ok=false;state.maintenance_complete=false;}
    filesRead++;state.files_scanned++;
   }
   if(scan.originals.length===scan.files.length)scan.phase='validate';
   break;
   }
   requireThat(sameNames(scan.files,await sourcePaths(source.store,task.prefix)),'monitor_source_changed','The source directory changed during this scan. Start a fresh monitor; no missing or renamed state was inferred.');
   if(scan.phase==='validate'){
    let checked=0;
    while(scan.validated<scan.originals.length&&checked<512&&deadline-Date.now()>readTimeout){
     const original=scan.originals[scan.validated];
     if(!original.error)requireThat(JSON.stringify(await source.store.fingerprint(original.path))===JSON.stringify(original.version),'monitor_source_changed','A source changed after an earlier scan page. Start a fresh monitor.',{path:original.path});
     scan.validated++;checked++;
    }
    if(scan.validated===scan.originals.length)scan.phase='compare';
    break;
   }
   const plan=await timed(()=>compareInventory(c.work,source,scan.originals.map(({version,...item})=>item),{prefix:task.prefix,listedPaths:new Set(scan.files)}),Math.max(1,deadline-Date.now()),{operation:'source_plan',...ids});
   if(state.report==='summary'){
    const actionable=plan.changes.filter(item=>item.state!=='unchanged');
    if(actionable.length)state.maintenance_complete=false;
    if(plan.changes.some(item=>item.state==='unreadable'))state.scan_ok=false;
    state.queue.push({kind:'pairs',value:{...ids,summary:{scope:plan.scope,counts:plan.counts,samples:actionable.slice(0,5).map(item=>({path:item.path,state:item.state})),findings_omitted:Math.max(0,actionable.length-5)},triage_only:true}});
   }else queue(state,'pairs',{...ids,plan});
   state.current=null;state.task++;
  }catch(error){queue(state,task.kind,{...ids,error:failure(error)});state.current=null;state.task++;}
 }
 const output=deliver(state,maxItems),scanFinished=state.task===state.tasks.length,deliveryComplete=scanFinished&&!state.queue.length;
 const pending=!deliveryComplete;
 const result={...output,report:state.report,scan_finished:scanFinished,scan_complete:scanFinished&&state.scan_ok,delivery_complete:deliveryComplete,complete:state.report==='full'&&deliveryComplete&&state.scan_ok&&state.maintenance_complete,
  progress:{files_read:filesRead,files_scanned:state.files_scanned,tasks_finished:state.task,tasks_total:state.tasks.length,...(state.current?{source:state.tasks[state.task].source,source_files:state.current.files.length,source_files_scanned:state.current.originals.length,phase:state.current.phase,source_files_validated:state.current.validated}:{})},
  next_request:null,next:pending?'Continue with next_request until delivery_complete. Retain every response.':state.report==='summary'?'Triage only: choose a connection/source/prefix and run a full source.monitor before processing findings.':'Process all delivered source and note findings. Unreadable items remain unresolved; this scan never acknowledges maintenance.'};
 if(readTimedOut){result.read_timeout=true;result.unresolved=state.current?.originals.filter(f=>f.code==='monitor_read_timeout').slice(-1).map(f=>({source:state.tasks[state.task].source,path:f.path,error:f.error}))??[];}
 const text=JSON.stringify(state)+'\n';requireThat(new TextEncoder().encode(text).length<=MAX_CHECKPOINT_BYTES,'monitor_checkpoint_limit','The monitor checkpoint exceeds 32 MiB. The scan remains incomplete.');
 // Writes use the real adapter’s CAS and verification, not a raced background mutation.
 const saved=await root.write(CHECKPOINT,text,{expected:seen?.sha256??null});
 if(pending)result.next_request={action:'source.monitor',cursor:saved.sha256,budget_ms:budget,read_timeout_ms:readTimeout,max_files:maxFiles,max_items:maxItems};
 return result;
}
