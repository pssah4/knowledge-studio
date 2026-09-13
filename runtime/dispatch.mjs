import {assessCollection,collectionUpgrade,mapCollection} from './collection.mjs';
import {registerParticipation,setParticipation,overview} from './participation.mjs';
import {adoptPublished} from './published.mjs';
import {ingestGroup,recordGroupOperation} from './ingest-groups.mjs';
import {transfer} from './sharing.mjs';
import {decodePassage} from './passage-links.mjs';
import {editorCitations} from './citations.mjs';
import {refreshShadow,readShadow,pinQuote,resolveQuote,resolvePassage} from './shadow-project.mjs';
import {startIntake,decideIntake,intakeStatus,authorizeIntake} from './intake.mjs';
import {planNotes,reviewNote} from './note-maintenance.mjs';
import {planAssets,reviewAsset,renameAsset} from './assets.mjs';
import {exportProjectGraph,exportGraph} from './derived.mjs';
import {knowledgeScopes} from './knowledge-scopes.mjs';
import {publicationDifferences} from './publication-readiness.mjs';
import {repairMetadata} from './metadata-repair.mjs';
import {planMoves,applyMoves,makeFolder,planFlatWiki} from './file-management.mjs';
import {relocate} from './relocate.mjs';
/** Single request contract shared by all runtime packages. */
import * as project from './project.mjs';
import * as content from './content.mjs';
import * as workflow from './workflow.mjs';
import {inventory,ingest,repairOriginalLinks} from './ingest.mjs';
import {plan,markMissing} from './maintenance.mjs';
import {query} from './query.mjs';
import {buildGraph,graphProjection} from './core/graph.mjs';
import {patchHead,parseDocument} from './core/document.mjs';
import {reviews,contributions,contributionLifecycle,sync,handle} from './review.mjs';
import {requireThat} from './core/errors.mjs';

export async function integratedNotePlan(store){const plan=await planNotes(store),sessions=await workflow.sessions(store),reviewed=new Map(sessions.filter(s=>s.complete).flatMap(s=>[...s.outputs,...s.review.record.topics.pages].map(page=>[page,s.id])));for(const note of plan.changes)if(note.state!=='unreadable'&&note.assets.every(a=>a.state==='reviewed')&&reviewed.has(note.page)){note.state='unchanged';note.review_basis={workflow:reviewed.get(note.page)};}return {...plan,complete:plan.changes.every(n=>n.state==='unchanged'),counts:Object.fromEntries(Object.keys(plan.counts).map(s=>[s,plan.changes.filter(n=>n.state===s).length]))};}

async function recipientTakeover(options,args){
 let owner;
 if(args.step==='confirm'){
  requireThat(/^[a-f0-9-]{36}$/i.test(args.id??''),'lifecycle_review_stale');
  const plan=await contributions.readJSON(options.work,'.llmwiki/contributions/lifecycle/prepared/'+args.id+'.json'),packet=plan?.packet;
  requireThat(packet?.action==='takeover'&&['request','complete'].includes(packet.mode),'contribution_connection_required','The full connection can only request or complete a recipient takeover.');
  owner=packet.binding?.owner;
 }else{
  requireThat(['request','complete'].includes(args.mode??'request'),'contribution_connection_required','The full connection can only request or complete a recipient takeover.');
  const replica=await contributions.replicaAt(options.remote,args.page);
  requireThat(replica&&!replica.pending&&replica.target===options.contributionMeta.target.bundle_id,'replica_root_missing','Read the complete target replica before requesting its takeover.');owner=replica.owner;
 }
 // The full work belongs to the receiving bundle. Use the receipted replica's
 // home identity (or its exact prepared decision), as the browser does.
 options.contributionMeta={...options.contributionMeta,owner:{...options.contributionMeta.owner,bundle_id:owner}};
 return contributionLifecycle.takeover(options,args);
}

export const queryActions=['contribute.status','published.check','collection.assess','participation.overview','shadow.status','shadow.resolve','inspect','context','source.inventory','source.plan','source.read','read','query','graph','readiness','workflow.status','workflow.list','review.read'];
export const actions=['contribute.review','contribute.confirm','contribute.folder','contribute.status','contribute.probe','contribute.rekey','contribute.retire','contribute.handover','contribute.fork','contribute.takeover','collection.assess','collection.upgrade','collection.map','participation.register','participation.set','participation.overview','published.adopt','published.check','ingest.group','ingest.take_back','sharing.move','shadow.rebuild','shadow.refresh','shadow.status','shadow.pin','shadow.resolve','intake.start','intake.decide','intake.status','wiki.initialize','note.plan','note.review','attachment.plan','attachment.review','attachment.rename','source.monitor','graph.refresh','metadata.repair','folder.create','document.move.plan','document.move.apply','wiki.flatten.plan','inspect','setup.draft','configure','settings','detach','editor','context','workspace.select','workspace.relocate','source.plan','source.missing','source.store','source.inventory','source.read','source.ingest','read','write','patch','query','graph','index','readiness','workflow.start','workflow.review','workflow.decide','workflow.finish','workflow.status','workflow.list','sync','conflict.resolve','review.read','review.respond'];
export async function dispatch(root,request,options={}){
 const readOnly=root.writable===false;
 requireThat(!readOnly||queryActions.includes(request.action),'read-only','The query skill is read-only. Setup and changes belong to maintain-llm-wiki.');
 if(request.action==='graph.refresh')return exportProjectGraph(root,options);
 const result=await executeAction(root,request,options);
 const stagedMutation=['collection.upgrade','collection.map','published.adopt','sharing.move','ingest.group','ingest.take_back'].includes(request.action)&&['applying','applied','rolling_back','rolled_back'].includes(result.state)&&(['apply','rollback'].includes(request.step)||request.action==='ingest.take_back');
 if(readOnly&&request.action==='inspect'){
   result.runtime.actions=queryActions;
   if(result.project){result.next='query';return result;}
   let knowledge=false;for(const prefix of ['wiki',''])try{knowledge ||= (await root.list(prefix,{recursive:false})).some(e=>e.kind==='file'&&/\.md$/i.test(e.path));}catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code))throw error;}
   return {next:'locate_project',knowledge_present:knowledge,reason:'No project configuration at this root. This does not mean knowledge is absent.',project_hint:result.project_hint??null,runtime:result.runtime};
 }
 if(!readOnly&&(stagedMutation||request.action==='participation.set'||['wiki.initialize','configure','settings','detach','editor','write','patch','metadata.repair','document.move.apply','source.ingest','source.missing','index','workflow.finish','sync','conflict.resolve'].includes(request.action))&&await root.read('llmwiki.project.json')){
   try{const snapshot=await exportProjectGraph(root,options);result.graph={revision:snapshot.revision,generated_at:snapshot.generated_at,complete:snapshot.complete};}
   catch(error){result.graph_error={code:error.code??'graph',message:error.message};}
 }
 if(!readOnly&&(stagedMutation||request.action==='participation.set'||['write','patch','index','source.ingest','document.move.apply','workflow.finish','sync'].includes(request.action))&&await root.read('llmwiki.project.json')){
  try{result.shadow=await executeAction(root,{action:'shadow.refresh',...(request.connection?{connection:request.connection}:{}),...(['write','patch'].includes(request.action)&&request.connection&&result.page?{paths:[result.page]}:{})},options);}catch(error){result.shadow={complete:false,code:error.code??'shadow',message:error.message};}
 }
 return result;
}
async function executeAction(root,request,{bindings={},extract,editorHTML=null}={}){
 const {action,connection,...args}=request;requireThat(actions.includes(action),'action','Unknown action.',{actions});
 if(action==='inspect')return {...await project.inspect(root,{editorHTML,bindings}),runtime:{format:'llmwiki-runtime/1',version:typeof __LLMWIKI_VERSION__!=='undefined'?__LLMWIKI_VERSION__:'development',actions,capabilities:root.capabilities}};
 if(action==='source.monitor'){
  const {project:p}=await project.load(root),pairs=[],notes=[];
  for(const link of p.connections)try{const c=await project.context(root,link.id,{bindings});notes.push({connection:link.id,wiki:link.wiki,plan:await integratedNotePlan(c.work)});}catch(error){notes.push({connection:link.id,wiki:link.wiki,error:{code:error.code,message:error.message}});}
  for(const link of p.connections){try{const c=await project.context(root,link.id,{bindings});for(const source of c.sources){if(!source.store){pairs.push({connection:link.id,wiki:link.wiki,source:source.id,error:source.error});continue;}try{pairs.push({connection:link.id,wiki:link.wiki,source:source.id,plan:await plan(c.work,source,{})});}catch(error){pairs.push({connection:link.id,wiki:link.wiki,source:source.id,error:{code:error.code,message:error.message}});}}}catch(error){pairs.push({connection:link.id,wiki:link.wiki,error:{code:error.code,message:error.message}});}}
  return {pairs,notes,complete:!pairs.some(p=>p.error)&&notes.every(n=>n.plan?.complete),next:'Process every new, changed and repair_required source in its assigned wiki; preserve unchanged originals. Review every new, changed or dependency_changed own note with note.review; do not infer semantic completion from a graph refresh.'};
 }
 if(action==='collection.assess'&&!await root.read('llmwiki.project.json'))return assessCollection(root,args);
 if(action==='workspace.relocate')return relocate(root,{...args,connection},{bindings,editorHTML});
 if(action==='configure')return project.configure(root,args,{bindings,editorHTML});
 if(action==='setup.draft')return project.setupDraft(root,args.answers,args.expected);
 if(action==='settings')return project.saveSettings(root,args.data,args.expected,{editorHTML,bindings});
 if(action==='detach')return project.detach(root,args.folder,args.expected,{editorHTML,bindings});
 if(action==='workspace.select')return project.selectWorkspace(root,connection,args.work);
 if(action==='editor'){const {project:p}=await project.load(root);requireThat(editorHTML,'editor','This host needs the packaged HTML asset.');return project.installEditor(root,p,editorHTML,{...args,bindings});}
 if(action==='participation.overview'||action==='query'||action==='graph'||action==='readiness'||action.startsWith('shadow.')){
   const {project:p}=await project.load(root),target=action==='shadow.resolve'&&args.reference?decodePassage(args.reference):null;
   if(target){const marker=await root.read('.llmwiki/project-instance.json');requireThat(target.project===p.id&&target.instance===JSON.parse(marker?.text??'null')?.instance,'citation_scope','This passage belongs to another project instance.');}
   const selected=args.connections??(connection?[connection]:target?[target.connection]:p.connections.map(c=>c.id)),contexts=[],inaccessible=[];
   for(const id of selected){requireThat(p.connections.some(c=>c.id===id),'connection','Select an existing connection.');try{contexts.push(await project.context(root,id,{bindings,...(target?.connection===id?{work:target.work}:{})}));}catch(error){if(action!=='query'&&action!=='participation.overview'&&!action.startsWith('shadow.'))throw error;inaccessible.push({connection:id,code:error.code??'access',message:error.message});}}
   const scopes=knowledgeScopes(contexts),wikis=scopes.map(s=>s.wiki),knowledgeContexts=scopes.map(({context,wiki})=>({...context,wiki}));
   if(action==='participation.overview'){const result=await overview(wikis,args.field);result.findings.push(...inaccessible.map(f=>({connection:f.connection,code:f.code})));result.complete&&=!inaccessible.length;return result;}
   if(action==='query'||action.startsWith('shadow.')){
    requireThat(wikis.length,'access','No selected wiki is currently accessible. Existing knowledge may still be present.',{findings:inaccessible});
    if(action==='shadow.resolve'){if(args.reference){const marker=await root.read('.llmwiki/project-instance.json');return resolvePassage(wikis,args.reference,{project:p.id,instance:JSON.parse(marker?.text??'null')?.instance});}return resolveQuote(wikis,args.id);}
    const writing=['shadow.refresh','shadow.rebuild','shadow.pin'].includes(action);let db=null,cacheError=null;
    try{if(root.shadowDatabase){const instance=await root.read('.llmwiki/project-instance.json');db=await root.shadowDatabase(p.id+'@'+(instance?JSON.parse(instance.text).instance:''),{readOnly:!writing,rebuild:action==='shadow.rebuild',...(args.cache_bytes?{maxBytes:args.cache_bytes}:{})});}}catch(error){if(writing)throw error;cacheError={code:error.code??'shadow_cache',message:error.message};}
    try{
     if(action==='shadow.refresh'||action==='shadow.rebuild'){if(!db)return {complete:false,mode:'memory',reason:'sqlite_unavailable',next:'Use a Node host for persistent maintenance; current passage retrieval remains available.'};const result=await refreshShadow(wikis,db,{...args,rebuild:action==='shadow.rebuild'});result.findings.push(...inaccessible);result.complete&&=!inaccessible.length;return result;}
     if(action==='shadow.pin'){const pin=await pinQuote(wikis,db,args);const href=root.fileURL&&await root.read('LLM-Wiki.html')?await root.fileURL('LLM-Wiki.html')+'#shadow='+pin.id:null;return {...pin,editor_href:href,markdown:href?'[Open retained quote]('+href+')':null};}
     const shadow=await readShadow(wikis,db,args);shadow.reason=cacheError?'cache_unavailable':!root.shadowDatabase?'sqlite_unavailable':!db?'not_initialized':shadow.persistent?'current':'changed_files';
     if(cacheError)shadow.findings.push(cacheError);
     if(action==='shadow.status')return {mode:shadow.mode,reason:shadow.reason,documents:shadow.documents.length,current:shadow.documents.filter(d=>d.state==='current').length,findings:[...shadow.findings,...inaccessible]};
     const result=await editorCitations(root,p,knowledgeContexts,await query(wikis,args,{shadow}));if(inaccessible.length){result.findings.push(...inaccessible);result.complete=false;}return result;
    }finally{db?.close();}
   }
   if(action==='readiness'){
    const knowledge=await content.readiness(wikis),workflows=await Promise.all(wikis.map(async w=>({wiki:w.id,sessions:await workflow.sessions(w.store)}))),blocked_by=[];
    if(!knowledge.ready)blocked_by.push({code:'knowledge_findings'});
    for(const w of workflows){
     for(const source of knowledge.source_pages.filter(p=>p.wiki===w.wiki))if(!w.sessions.some(s=>s.sources?.includes(source.page)))blocked_by.push({code:'workflow_missing',wiki:w.wiki,page:source.page});
     for(const session of w.sessions)if(session.error)blocked_by.push({code:'workflow_error',wiki:w.wiki,path:session.path});else if(!session.complete&&session.outcome!=='superseded')blocked_by.push({code:'workflow_incomplete',wiki:w.wiki,id:session.id,next:session.next,outcome:session.outcome});
    }
    const notes=[];for(const w of wikis){const plan=await integratedNotePlan(w.store),pending=plan.changes.filter(n=>n.state!=='unchanged');notes.push({wiki:w.id,...plan,pending});for(const n of pending)blocked_by.push({code:'note_'+n.state,wiki:w.id,page:n.page});}
    const differences=[];
    for(const c of contexts)differences.push(...await publicationDifferences(c));
    const publication={synchronized:!differences.length,differences};if(!publication.synchronized)blocked_by.push({code:'publication_pending'});
    const originals=[];
    for(const c of knowledgeContexts)for(const item of knowledge.source_pages.filter(p=>p.wiki===c.wiki.id)){
      const head=parseDocument((await c.work.read(item.page)).text).head,source=c.sources.find(s=>s.id===head.resource?.store);let state='unavailable';
      if(source?.store)try{const original=await source.store.read(head.resource.name,{binary:true});state=!original?(head.resource.availability==='missing'?'missing_acknowledged':'missing'):original.sha256===head.resource.sha256?'current':'changed';}catch{}
      originals.push({...item,state});if(!['current','missing_acknowledged'].includes(state))blocked_by.push({code:'original_'+state,...item});
    }
    return {complete:blocked_by.length===0,blocked_by,knowledge,workflows,publication,originals,notes};
   }
   const graph=await buildGraph(wikis);return {nodes:graphProjection(graph).pages.map(p=>({key:p.key,wiki:p.wiki,page:p.path,title:p.head.title,type:p.head.type,id:p.head.id})),edges:graph.edges,findings:[...graph.failures,...graph.findings]};
 }
 const c=await project.context(root,connection,{bindings,work:args.work,verifyTarget:action!=='contribute.rekey'}),store=c.work;
 if(args.group){requireThat(['write','patch','workflow.start','workflow.review','workflow.decide','workflow.finish','source.ingest'].includes(action),'group','This action cannot be recorded as group curation.');return recordGroupOperation(c,{...args,action},async overlay=>{const scoped=Object.create(root);scoped.substore=async(path,opts)=>path===c.workFolder.path?overlay:root.substore(path,opts);const {group,...next}=args;return executeAction(scoped,{action,connection,...next},{bindings:{...bindings,...(c.workFolder.path===null?{[c.workFolder.id]:overlay}:{})},extract,editorHTML});});}
 if(action==='collection.assess'){if(args.source){const source=c.sources.find(s=>s.id===args.source);requireThat(source?.store,'access','Select an assigned readable source collection.');return assessCollection(source.store,{...args,readers:source.readers});}return assessCollection(store,{...args,readers:c.wiki.readers});}
 if(action==='collection.upgrade')return collectionUpgrade(store,args);
 if(action==='collection.map')return mapCollection(store,args);
 if(action==='published.adopt'||action==='published.check')return adoptPublished(store,{...args,...(action==='published.check'?{step:'check'}:{})});
 if(action==='participation.register')return registerParticipation(store,args);
 if(action==='participation.set')return setParticipation(store,args);
 if(action==='sharing.move')return transfer(root,c,args,{bindings});
 if(action==='ingest.group'||action==='ingest.take_back'){const result=await ingestGroup(c,{...args,...(action==='ingest.take_back'?{step:'rollback'}:{})},{extract});if(['applied','rolled_back'].includes(result.state))await content.refreshIndex(store);return result;}
 if(action==='intake.start'){const source=c.sources.find(s=>s.id===(args.source??c.connection.default_source));requireThat(source,'source','Choose an assigned source folder.');return startIntake(store,args,source.id);}
 if(action==='intake.decide')return decideIntake(store,args);
 if(action==='intake.status')return intakeStatus(store,args.id);
 if(action==='note.plan')return integratedNotePlan(store);
 if(action==='note.review')return reviewNote(store,args);
 if(action==='attachment.plan')return planAssets(store);
 if(action==='attachment.review')return reviewAsset(store,args);
 if(action==='attachment.rename')return renameAsset(store,args);
 if(action==='wiki.initialize')return content.createBundle(store,{title:c.wiki.label,purpose:args.purpose,audience:args.audience,author:args.author,language:args.language??'de',preserveExisting:true});
 if(action==='context')return {project:c.project.id,connection:c.connection,wiki:c.wiki,work:c.workFolder,sources:c.sources.map(({store,...f})=>f)};
 if(action.startsWith('source.')){
   const defaultSource=Object.hasOwn(c.connection,'default_source')?c.connection.default_source:(c.sources.length===1?c.sources[0].id:null);
   const source=c.sources.find(s=>s.id===(args.source??defaultSource));requireThat(source,'source','Select a source folder assigned to this wiki or configure its default source.');requireThat(source.store,'binding','Connect this source root on this device.',{folder:source.id});
   if(action==='source.inventory')return inventory(source,args);
   if(action==='source.plan')return plan(store,source,args);
   if(action==='source.missing')return markMissing(store,source,args);
   if(action==='source.store'){
     requireThat(source.writable,'read-only','Enable adding attachments to this source root in settings first.');requireThat(typeof args.text==='string'||Array.isArray(args.bytes)&&args.bytes.every(b=>Number.isInteger(b)&&b>=0&&b<=255),'content','Provide attachment text or bytes.');
     await authorizeIntake(store,args.intake,source.id,args.path,args.bytes?new Uint8Array(args.bytes):args.text);
     const destination=source.path===null?await bindings[source.id].substore('',{writable:true}):await root.substore(source.path,{writable:true});
     const saved=await destination.write(args.path,args.bytes?new Uint8Array(args.bytes):args.text,{expected:null});return {source:source.id,path:args.path,sha256:saved.sha256,next:'source.ingest'};
   }
   if(action==='source.read'){const file=await source.store.read(args.path,{binary:true});requireThat(file,'source','The source is missing.');return {...await extract({bytes:file.bytes,name:args.path,metadata:file}),path:args.path,sha256:file.sha256};}
   return ingest(store,source,args.path,{...args,extract,linkRoot:c.remote.root});
 }
 if(action==='read'){const file=await store.read(args.page);requireThat(file,'page','This knowledge page is missing.');return {page:args.page,text:file.text,sha256:file.sha256};}
 if(['write','patch'].includes(action))requireThat(!await contributions.replicaAt(handle(store),args.page),'replica_read_only','This is a contribution replica. Propose a change for its home instead of editing its authored content.');
 if(action==='write')return content.writeNote(store,args);
 if(action==='patch'){const seen=await store.read(args.page);requireThat(seen&&seen.sha256===args.expected,'stale','The note changed.');return content.writeNote(store,{...args,text:patchHead(seen.text,args.updates)});}
 if(action==='metadata.repair')return repairMetadata(store,args);
 if(action==='folder.create')return makeFolder(store,args.path);
 if(action==='document.move.plan')return planMoves(store,args);
 if(action==='wiki.flatten.plan')return planFlatWiki(store,args);
 if(action==='document.move.apply')return applyMoves(store,args.id);
 if(action==='index'){const originals=await repairOriginalLinks(store,c.sources,{linkRoot:c.remote.root,author:args.author});return {...await content.refreshIndex(store),original_links:originals};}
 if(action==='workflow.start')return workflow.start(store,args.mode,args.pages,args.author,args);
 if(action==='workflow.review')return workflow.review(store,args.id,args.record,args.author);
 if(action==='workflow.decide')return workflow.decide(store,args.id,args.decision,args.author);
 if(action==='workflow.finish')return workflow.finish(store,args.id,args.outputs,args.author,args);
 if(action==='workflow.status')return (await workflow.sessions(store)).find(s=>s.id===args.id)??workflow.status(store,args.id);
 if(action==='workflow.list')return workflow.sessions(store);
 const options={work:handle(store),remote:handle(c.remote),identity:c.identity,canPublish:c.canPublish,...c.syncOptions,project:handle(root),connection:c.connection.id,ownerRemote:c.syncOptions.contributionMeta.owner.wiki?handle(c.syncOptions.contributionMeta.owner.wiki):null};
 if(action.startsWith('contribute.')){const operation=action.slice(11);if(operation==='takeover'&&c.syncOptions.scope==='full')return recipientTakeover(options,args);requireThat(c.syncOptions.scope==='contributions','contribution_connection_required','Select a contribution connection.');const method=contributions[operation]??contributionLifecycle[operation];requireThat(typeof method==='function','contribution_action_unavailable','This contribution action is unavailable.');return method(options,args);}
 if(action==='sync'){const result=await sync.run(options);await exportGraph(store);if(c.canPublish&&c.syncOptions.scope==='full')await exportGraph(c.remote);return result;}
 if(action==='conflict.resolve'){await sync.resolve(options,args.conflict,args.text,args.author,args.message,args.choice);return sync.run(options);}
 if(action==='review.read'){const journal=await reviews.read(handle(store),args.page);return {...journal,incoming:reviews.incoming(journal.events,args.author,args.seen)};}
 if(action==='review.respond'){
   requireThat(args.circle===undefined||args.circle==='local','review_circle','Choose only here or omit the conversation circle.');
   const events=(await reviews.read(handle(store),args.page)).events,parent=events.find(e=>e.id===args.id);requireThat(parent,'review','The review event is unavailable.');
   const seen=await store.read(args.page);requireThat(seen&&seen.sha256===args.expected,'stale','Read the current comparison before deciding.');
   if(args.choice==='accept')return reviews.accept(handle(store),parent,seen,args.author);
   requireThat(['reject','proposal','comment','resolve','reopen'].includes(args.choice),'review','Choose accept, reject, proposal or comment.');
   const event=reviews.reply(parent,args.choice,args.author,seen.text,args.text??seen.text,args.message,{circle:args.circle});event.page=args.page;await reviews.append(handle(store),event);return {recorded:true,event};
 }
}
