// Generated from app/contribution-lifecycle.js by scripts/sync-contracts.mjs.
export function createContributionLifecycle(environment){
(function(global){
'use strict';
const BASE='.llmwiki/contributions',F=()=>global.FolderAccess,R=()=>global.WikiReviews,C=()=>global.WikiCore;
const json=value=>JSON.stringify(value),uuid=()=>global.crypto.randomUUID(),same=(a,b)=>json(a)===json(b);
const warning='Already read copies, personal work folders and platform history cannot be withdrawn. Archived bytes remain in the same target folder.';
function fail(code,message=code,details={}){throw Object.assign(new Error(message),{code,details});}
function need(ok,code,message,details){if(!ok)fail(code,message,details);}
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<200&&!/[\/\\:\x00-\x20]/.test(value);
const eventID=value=>typeof value==='string'&&/^[a-z0-9-]{20,80}$/i.test(value);
function pagePath(value){need(typeof value==='string'&&value.endsWith('.md')&&!/[\\:\x00-\x1f]/.test(value)&&!value.split('/').some(part=>!part||part==='..'||part==='.'||part.startsWith('.')),'contribution_page_invalid');return value;}
function now(o){const value=o.now?o.now():new Date().toISOString();need(Number.isFinite(Date.parse(value)),'lifecycle_clock');return value;}
const side=(o,name)=>name==='work'?o.work:name==='remote'?o.remote:name==='project'?o.project:name==='owner'?o.ownerRemote:null;
async function peek(dir,path){need(dir,'lifecycle_folder_missing');try{return await F().readFile(dir,path);}catch(error){if(error.name==='NotFoundError')return null;throw error;}}
async function listing(dir,prefix=''){let folder=dir;try{for(const part of prefix.split('/').filter(Boolean))folder=await folder.getDirectoryHandle(part);}catch(error){if(error.name==='NotFoundError')return [];throw error;}const result=[];async function walk(h,base){for await(const entry of h.values()){const path=base?base+'/'+entry.name:entry.name;if(entry.kind==='directory')await walk(entry,path);else if(entry.kind==='file')result.push(path);}}await walk(folder,prefix);return result.sort();}
function inventoryPath(item,path){
 if(item.prefix&&path!==item.prefix&&!path.startsWith(item.prefix+'/'))return false;
 if(item.kind==='documents')return path.endsWith('.md')&&!path.split('/').some(part=>part.startsWith('.'))&&!/^(schema|meta|notices|vermerke)\//.test(path);
 return item.kind!=='records'||new RegExp('^'+BASE+'/[a-f0-9]{64}\\.json$').test(path);
}
function inventoryEntry(item,path,text){return {path,...(item.kind==='documents'?{id:String(C().parseDocument(text).head.id??'')}:{})};}
async function inventoryRead(o,item){const rows=[];for(const path of await listing(side(o,item.side),item.prefix))if(inventoryPath(item,path)){const file=item.kind==='documents'?await peek(side(o,item.side),path):null;need(item.kind!=='documents'||file,'lifecycle_review_stale');rows.push(inventoryEntry(item,path,file?.text));}return rows;}
async function inventory(p,o,name,kind,prefix=''){
 const prior=p.inventories.find(item=>item.side===name&&item.kind===kind&&item.prefix===prefix);if(prior)return prior.entries;
 const item={side:name,kind,prefix};item.entries=await inventoryRead(o,item);p.inventories.push(item);return item.entries;
}
function inventoryAfter(item,entries,operation){
 const result=new Map(entries.map(row=>[row.path,row]));if(operation?.side!==item.side)return entries;
 if(inventoryPath(item,operation.path)){if(operation.type==='archive')result.delete(operation.path);else result.set(operation.path,inventoryEntry(item,operation.path,operation.text));}
 if(operation.type==='archive'&&inventoryPath(item,operation.to))result.set(operation.to,inventoryEntry(item,operation.to,operation.archived));
 return [...result.values()].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
function parse(file){try{return file?JSON.parse(file.text):null;}catch{fail('contribution_record_unreadable');}}
async function recordPath(document,target){return BASE+'/'+await R().hash(json([document,target]))+'.json';}
function declared(o,author){need(typeof author==='string'&&author.trim()&&author.length<=120&&!/[\r\n\x00-\x1f]/.test(author)&&author===o.contributionMeta?.author,'lifecycle_author','Use the declared author of this work folder.');}
function currentBinding(o){const m=o.contributionMeta;need(m&&identifier(m.target?.bundle_id)&&identifier(m.owner?.bundle_id),'contribution_connection_required');return {connection:o.connection??o.identity??null,owner:m.owner.bundle_id,target:m.target.bundle_id,readers:[...new Set(m.target.readers??[])].sort(),authors:[...(m.owner.authors??[])].sort()};}
async function observe(p,o,name,path){const known=p.observed.find(item=>item.side===name&&item.path===path);if(known)return known.text===null?null:{text:known.text};const seen=await peek(side(o,name),path);p.observed.push({side:name,path,text:seen?.text??null});return seen;}
async function journal(p,o,name,page){const value=await R().read(side(o,name),page);p.journals.push({side:name,page,events:value.events,pending:value.pending,unreadable:value.unreadable});need(!value.unreadable,'lifecycle_journal_unreadable');return value;}
async function writeOp(p,o,name,path,value,type='write',extra={}){need(!p.operations.some(op=>op.side===name&&op.path===path),'lifecycle_duplicate_write');await observe(p,o,name,path);p.operations.push({type,side:name,path,text:typeof value==='string'?value:json(value)+'\n',...extra});}
async function eventOp(p,o,name,event){need(R().valid(event),'lifecycle_event_invalid');await writeOp(p,o,name,await R().eventPath(event),JSON.stringify(event,null,2)+'\n','event',{event});}
async function receiptOp(p,o,name,event){await writeOp(p,o,name,await R().eventPath(event)+'.applied',json({id:event.id,digest:await R().hash(json(event))}),'receipt',{event});}
function event(p,page,base,text,source,extra={}){return R().event({kind:'change',page,author:p.author,base,text,source,...extra});}
async function noteOp(p,o,name,page,before,text,source){if(before===text)return;const e=event(p,page,before??'',text,source);await eventOp(p,o,name,e);await writeOp(p,o,name,page,text);await receiptOp(p,o,name,e);}
function patch(source,updates){
 const p=C().parseDocument(source),eol=p.prefix.includes('\r\n')?'\r\n':'\n';let raw=p.raw;
 const edits=[],additions=[];for(const [key,value]of Object.entries(updates)){const pair=p.yaml?.contents?.items.find(item=>item.key?.value===key),written=value===undefined?'':key+': '+json(value)+eol;if(!pair){if(written)additions.push(written);continue;}let end=pair.value?.range?.[2]??pair.key.range[2];if(!pair.value){const n=raw.indexOf('\n',end);end=n<0?raw.length:n+1;}edits.push({start:pair.key.range[0],end,written});}
 for(const edit of edits.sort((a,b)=>b.start-a.start))raw=raw.slice(0,edit.start)+edit.written+raw.slice(edit.end);raw+=additions.join('');
 return (p.yaml?p.prefix+raw+p.suffix:'---'+eol+raw+'---'+eol)+(p.metadataPrefix??'')+p.body;
}
function freshIdentity(o){let n=BigInt(Date.parse(now(o)));for(const byte of global.crypto.getRandomValues(new Uint8Array(10)))n=(n<<8n)|BigInt(byte);const alphabet='0123456789ABCDEFGHJKMNPQRSTVWXYZ';let value='';for(let i=0;i<26;i++){value=alphabet[Number(n&31n)]+value;n>>=5n;}return value;}
async function checkBindings(p,o,{teamOnly=false,relaxed=false}={}){
 const remote=await observe(p,o,'remote','wiki/bundle.md'),r=remote?C().parseDocument(remote.text).head:{};
 if(!relaxed){need(r.id===p.binding.target,'bundle_id_changed');if(r.readers)need(same([...new Set(r.readers)].sort(),p.binding.readers),'audience_changed');}
 need(p.binding.readers.length,'audience_changed');
 if(!teamOnly){const home=await observe(p,o,'work','wiki/bundle.md');if(!relaxed)need(home&&C().parseDocument(home.text).head.id===p.binding.owner,'bundle_id_changed');}
 need(p.binding.owner!==p.binding.target,'bundle_id_collision');return r;
}
async function records(p,o){const rows=[];for(const {path}of await inventory(p,o,'work','records',BASE)){const file=await observe(p,o,'work',path),value=parse(file);need(value?.format==='llmwiki-contribution/1','contribution_record_unreadable');rows.push({path,value});}return rows;}
async function targetFor(p,o,document,pathHint){
 const matches=(await inventory(p,o,'remote','documents')).filter(entry=>entry.id===document).map(entry=>entry.path);
 need(matches.length<2,'duplicate_id_in_target');
 let page=matches[0];if(!page){const aliases=parse(await observe(p,o,'remote','.llmwiki/identity-aliases.json'));const found=aliases?.aliases?.filter(alias=>alias.id===document)??[];need(found.length<2,'duplicate_id_in_target');page=found[0]?.path??pathHint;}
 return {page:pagePath(page),file:await observe(p,o,'remote',page)};
}
async function documentState(p,o,args,{teamOnly=false,allowFork=false,coverage=true}={}){
 const homePage=pagePath(args.page),home=teamOnly?null:await observe(p,o,'work',homePage),document=teamOnly?args.document??String(C().parseDocument((await peek(o.remote,homePage))?.text??'').head.id??''):String(C().parseDocument(home?.text??'').head.id??'');
 need(identifier(document),'contribution_document_missing');let record=null,path=null;
 if(!teamOnly){need(home,'owner_copy_missing');path=await recordPath(document,p.binding.target);record=parse(await observe(p,o,'work',path));need(record?.format==='llmwiki-contribution/1'&&record.document===document&&record.target===p.binding.target&&record.owner===p.binding.owner,'contribution_record_missing');await journal(p,o,'work',homePage);}
 const target=await targetFor(p,o,document,record?.destination??homePage);need(target.file,'replica_missing');const targetHead=C().parseDocument(target.file.text).head;
 need(allowFork||String(targetHead.id)===document,'foreign_id_in_target');const j=await journal(p,o,'remote',target.page),roots=j.events.filter(e=>e.kind==='contribution_root'&&e.source?.document===document&&e.source.target===p.binding.target);
 const root=record?roots.find(e=>e.id===record.root.id):roots.at(-1);need(root,'replica_root_missing');need(roots.every(e=>e.source.owner===root.source.owner),'owner_conflict');if(record)need(same(root,record.root),'owner_conflict');
 need(!coverage||j.events.some(e=>['contribution_root','change','accept'].includes(e.kind)&&C().compareForm(e.text)===C().compareForm(target.file.text))||allowFork,'uncovered_remote_change');
 Object.assign(p.preview,{document,target:p.binding.target,page:homePage,destination:target.page,owner:root.source.owner,statement_sha256:await R().hash(C().compareForm(target.file.text))});
 return {document,homePage,home,record,path,target,root,journal:j};
}
async function closeHome(p,o,s,kind,extra={}){
 const next={...s.record,release:null,releases:[],closed:true,lifecycle:{kind,id:p.id,by:p.author,at:p.at},...extra};await writeOp(p,o,'work',s.path,next);
 const head=C().parseDocument(s.home.text).head,targets=(Array.isArray(head.contribute_to)?head.contribute_to:[]).filter(value=>value!==p.binding.target);
 await noteOp(p,o,'work',s.homePage,s.home.text,C().setContributionTargets(s.home.text,targets),{kind:'contribution_'+kind,document:s.document,target:p.binding.target});
}
async function retirePlan(p,o,args){
 const s=await documentState(p,o,args,{coverage:false});need(C().compareForm(s.home.text)===C().compareForm(s.target.file.text),'retirement_changed','Resolve the changed target statement before retiring it.');
 p.preview.archive='.llmwiki/retired/'+p.id+'/'+s.target.page;
 await closeHome(p,o,s,'retired',{retirements:[...(s.record.retirements??[]),p.id]});
 const act={format:'llmwiki-contribution-retirement/1',id:p.id,document:s.document,target:p.binding.target,owner:s.root.source.owner,root:s.root.id,by:p.author,at:p.at,expected:p.preview.statement_sha256};
 for(const name of ['work','remote'])await writeOp(p,o,name,BASE+'/retired/'+p.id+'.json',act);
 const text=C().transferForm(s.target.file.text),e=event(p,s.target.page,text,text,{kind:'contribution_retirement',retirement:p.id,document:s.document,target:p.binding.target});await eventOp(p,o,'remote',e);
 await observe(p,o,'remote',p.preview.archive);p.operations.push({type:'archive',side:'remote',path:s.target.page,to:p.preview.archive,text:null,archived:s.target.file.text});
 await receiptOp(p,o,'remote',e);
}
async function handoverPlan(p,o,args){
 const s=await documentState(p,o,args),targets=new Set((C().parseDocument(s.home.text).head.contribute_to??[]).filter(target=>target!==p.binding.target));
 for(const row of await records(p,o))if(row.value.document===s.document&&row.value.target!==p.binding.target&&!row.value.closed)targets.add(row.value.target);
 need(!targets.size,'handover_pending','Decide retirement or fork for every other target first.',{targets:[...targets]});need(C().compareForm(s.home.text)===C().compareForm(s.target.file.text),'handover_changed','Resolve the unpublished home or target change before handing over.');
 const text=C().transferForm(s.target.file.text),source={kind:'contribution_handover',document:s.document,from:s.root.source.owner,to:p.binding.target,target:p.binding.target,root:s.root.id,accepted:true};
 const e=event(p,s.target.page,text,text,source,{kind:'accept',parent:s.root.id,thread:s.root.thread,message:'Document handed over.'});
 const act={format:'llmwiki-contribution-handover/1',id:p.id,document:s.document,from:source.from,to:source.to,target:source.target,root:s.root.id,accepted:true,by:p.author,at:p.at,decision_event:e.id};
 need(C().validateHandover(act,[...s.journal.events,e]),'handover_invalid');
 await writeOp(p,o,'work',s.path,{...s.record,release:null,releases:[],closed:true,lifecycle:{kind:'handover',id:p.id,by:p.author,at:p.at}});
 await eventOp(p,o,'remote',e);await writeOp(p,o,'remote',s.target.page,text);await receiptOp(p,o,'remote',e);await writeOp(p,o,'remote',BASE+'/handover/'+s.document+'/'+p.id+'.json',act);
 const redirect='---\nllmwiki_redirect: '+json({wiki:p.binding.target,id:s.document})+'\n---\n[Moved document]('+p.binding.target+'/'+s.document+')\n';
 await noteOp(p,o,'work',s.homePage,s.home.text,redirect,source);
}
async function forkTarget(p,o,s,kind){
 const id=freshIdentity(o);p.preview.new_document=id;
 const aliasesPath='.llmwiki/identity-aliases.json',prior=parse(await observe(p,o,'remote',aliasesPath))??{format:'llmwiki-identity-aliases/1',aliases:[]};
 need(prior.format==='llmwiki-identity-aliases/1'&&Array.isArray(prior.aliases)&&!prior.aliases.some(alias=>alias.id===s.document&&alias.path!==s.target.page),'identity_alias_invalid');
 const aliases={...prior,aliases:[...prior.aliases.filter(alias=>alias.id!==s.document),{id:s.document,path:s.target.page}]},text=patch(C().transferForm(s.target.file.text),{id,shared_copy:{owner:s.root.source.owner,until:p.at}});
 await noteOp(p,o,'remote',s.target.page,s.target.file.text,text,{kind:'contribution_'+kind,document:s.document,new_document:id,root:s.root.id});await writeOp(p,o,'remote',aliasesPath,aliases);
 return id;
}
async function forkPlan(p,o,args){const s=await documentState(p,o,args);await closeHome(p,o,s,'forked');await forkTarget(p,o,s,'fork');}
async function takeoverPlan(p,o,args){
 const mode=args.mode??'request';need(['request','object','complete','acknowledge','repair'].includes(mode),'takeover_mode');p.mode=mode;p.preview.mode=mode;
 const s=await documentState(p,o,args,{teamOnly:['request','complete'].includes(mode),allowFork:mode==='acknowledge'}),folder=BASE+'/handover/'+s.document;
 if(mode==='request'){
  need(typeof args.reason==='string'&&args.reason.trim()&&args.reason.length<=10000,'takeover_reason');
  const effective_at=new Date(Date.parse(p.at)+30*86400000).toISOString(),record={format:'llmwiki-contribution-takeover/1',kind:'takeover',id:p.id,document:s.document,target:p.binding.target,owner:s.root.source.owner,root:s.root.id,by:p.author,at:p.at,effective_at,reason:args.reason,expected:p.preview.statement_sha256};
  p.preview.effective_at=effective_at;p.preview.takeover=p.id;await writeOp(p,o,'remote',folder+'/'+p.id+'.json',record);return;
 }
 need(eventID(args.takeover),'takeover_missing');const path=folder+'/'+args.takeover+'.json',record=parse(await observe(p,o,'remote',path));
 need(record?.format==='llmwiki-contribution-takeover/1'&&record.id===args.takeover&&record.document===s.document&&record.target===p.binding.target&&record.owner===s.root.source.owner&&record.root===s.root.id&&Number.isFinite(Date.parse(record.effective_at)),'takeover_missing');
 p.preview.takeover=record.id;p.preview.effective_at=record.effective_at;
 const objectionPath=folder+'/'+record.id+'.objection.json',objection=await observe(p,o,'remote',objectionPath),completedPath=folder+'/'+record.id+'.completed.json',completed=parse(await observe(p,o,'remote',completedPath));
 if(mode==='object'){
  need(!completed,'takeover_completed');need(!objection,'takeover_objected');
  const act={format:'llmwiki-contribution-objection/1',id:p.id,takeover:record.id,document:s.document,target:p.binding.target,owner:s.root.source.owner,root:s.root.id,by:p.author,at:p.at};
  await writeOp(p,o,'work',s.path,{...s.record,objections:[...(s.record.objections??[]),act]});await writeOp(p,o,'remote',objectionPath,act);return;
 }
 if(mode==='repair'){
  const remembered=(s.record.objections??[]).find(act=>act.takeover===record.id);need(remembered,'objection_missing');need(!objection||objection.text===json(remembered)+'\n','objection_changed');
  p.preview.reason=objection?'objection_present':'objection_removed';if(!objection)await writeOp(p,o,'remote',objectionPath,remembered);return;
 }
 if(mode==='acknowledge'){
  need(completed?.format==='llmwiki-contribution-takeover-completion/1'&&completed.takeover===record.id&&completed.document===s.document&&completed.new_document===C().parseDocument(s.target.file.text).head.id,'takeover_not_completed');
  await closeHome(p,o,s,'taken_over',{takeover:completed});return;
 }
 need(!objection,'takeover_objected');need(!completed,'takeover_completed');need(Date.parse(p.at)>=Date.parse(record.effective_at),'takeover_pending','The announced 30-day objection period has not elapsed.');
 const new_document=await forkTarget(p,o,s,'takeover');await writeOp(p,o,'remote',completedPath,{format:'llmwiki-contribution-takeover-completion/1',id:p.id,takeover:record.id,document:s.document,new_document,root:s.root.id,owner:s.root.source.owner,target:p.binding.target,by:p.author,at:p.at});
}
function validateRekey(trace,events){return C().validateRekey(trace,events);}
async function rekeyPlan(p,o,args){
 const role=args.role??'target';need(['target','owner'].includes(role)&&typeof args.to==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(args.to)&&Array.isArray(args.readers)&&args.readers.length>0&&args.readers.length<=100&&args.readers.every(value=>typeof value==='string'&&value.trim()&&value.length<=240),'rekey_invalid');need(o.project&&o.connection,'rekey_project_required');
 const projectFile=await observe(p,o,'project','llmwiki.project.json'),settings=parse(projectFile);need(Array.isArray(settings?.connections),'rekey_project_required');
 const selected=settings.connections.find(connection=>connection.id===(role==='owner'?o.contributionMeta.owner.connection:o.connection));need(selected?.bundle_id,'rekey_project_required');
 const from=selected.bundle_id,to=args.to,readers=[...new Set(args.readers)].sort(),name=role==='target'?'remote':'work',bundle=await observe(p,o,name,'wiki/bundle.md'),head=C().parseDocument(bundle?.text??'').head;
 need(head.id===to,'bundle_id_changed','The new pin must equal the visible bundle identity.');need(Array.isArray(head.readers)&&same([...new Set(head.readers)].sort(),readers),'audience_changed','Confirm the visible new reader circle.');
 need(!settings.connections.some(connection=>connection.wiki!==selected.wiki&&connection.bundle_id===to),'rekey_collision');
 need(!(await inventory(p,o,'remote','source-keys',BASE+'/from/'+encodeURIComponent(to))).length,'rekey_collision');
 Object.assign(p.preview,{role,from,to,readers,target:role==='target'?to:p.binding.target});
 const rows=(await records(p,o)).filter(row=>row.value[role]===from),nextSettings={...settings,connections:settings.connections.map(connection=>connection.wiki===selected.wiki&&connection.bundle_id===from?{...connection,bundle_id:to,readers}:connection)};
 p.preview.invalidated_releases=rows.length;const trace={format:'llmwiki-contribution-rekey/1',id:p.id,role,from,to,readers,by:p.author,at:p.at,confirmed:true};
 const source={kind:'contribution_rekey',id:p.id,role,from,to,readers,confirmed:true},e=event(p,'wiki/bundle.md',bundle.text,bundle.text,source);trace.decision_event=e.id;need(validateRekey(trace,[e]),'rekey_invalid');
 const tracePath=BASE+'/rekey/'+encodeURIComponent(from)+'.json',traceSide=role==='owner'&&o.ownerRemote?'owner':name;
 if(traceSide==='owner'){const shared=await observe(p,o,'owner','wiki/bundle.md');need(shared&&C().parseDocument(shared.text).head.id===to,'bundle_id_changed');e.base=shared.text;e.text=shared.text;}
 const existing=parse(await observe(p,o,traceSide,tracePath));need(!existing||existing.to===to,'rekey_collision');
 for(const row of rows){
  const record={...row.value,[role]:to,readers:role==='target'?readers:row.value.readers,release:null,releases:[],rekey:{id:p.id,role,from,to},closed:row.value.closed??false};
  const nextPath=await recordPath(record.document,record.target);
  if(nextPath!==row.path){need(!await observe(p,o,'work',nextPath),'rekey_collision');await writeOp(p,o,'work',row.path,{...row.value,release:null,releases:[],closed:true,rekeyed_to:nextPath,rekey:record.rekey});}
  await writeOp(p,o,'work',nextPath,record);
  if(role==='target'){const file=await observe(p,o,'work',record.page);need(file,'owner_copy_missing');const targets=C().parseDocument(file.text).head.contribute_to??[];await noteOp(p,o,'work',record.page,file.text,C().setContributionTargets(file.text,[...new Set(targets.map(target=>target===from?to:target))]),source);}
 }
 await eventOp(p,o,traceSide,e);await receiptOp(p,o,traceSide,e);await writeOp(p,o,traceSide,tracePath,trace);
 if(traceSide!=='work')await writeOp(p,o,'work',tracePath,trace);
 await writeOp(p,o,'project','llmwiki.project.json',nextSettings);
}
async function prepare(o,args,action){
 need(o.canPublish===true,'read-only');const author=args.author??o.contributionMeta?.author;declared(o,author);need(!o.alive||o.alive(),'lifecycle_disconnected');
 const p={format:'llmwiki-contribution-lifecycle/1',id:uuid(),action,mode:args.mode??null,author,at:now(o),binding:currentBinding(o),observed:[],inventories:[],journals:[],operations:[],preview:{action,warning}};
 const teamOnly=action==='takeover'&&['request','complete'].includes(args.mode??'request');await checkBindings(p,o,{teamOnly,relaxed:action==='rekey'});
 if(action==='retire')await retirePlan(p,o,args);else if(action==='handover')await handoverPlan(p,o,args);else if(action==='fork')await forkPlan(p,o,args);else if(action==='takeover')await takeoverPlan(p,o,args);else await rekeyPlan(p,o,args);
 const digest=await R().hash(json(p)),plan={packet:p,digest,state:'prepared',done:[],pending:null},path=BASE+'/lifecycle/prepared/'+p.id+'.json';const done=await F().writeFile(o.work,path,json(plan)+'\n',null);need(done.saved,'lifecycle_stale');
 return {id:p.id,digest,...p.preview,changes:p.operations.map(op=>({side:op.side,path:op.path,action:op.type,...(op.type==='archive'?{archive:op.to,text:op.archived}:{text:op.text})}))};
}
async function checkPlan(o,plan){
 const p=plan.packet,changedProject=p.operations.findIndex(op=>op.side==='project'&&op.path==='llmwiki.project.json'),appliedRekey=p.action==='rekey'&&(plan.done.includes(changedProject)||plan.pending===changedProject);
 need(Array.isArray(p.inventories),'lifecycle_review_stale','Read a fresh lifecycle preview with a bound selection inventory.');
 for(const item of p.inventories){
  let expected=item.entries;for(let i=0;i<p.operations.length;i++)if(plan.done.includes(i))expected=inventoryAfter(item,expected,p.operations[i]);
  const actual=await inventoryRead(o,item),pending=plan.pending===null?null:p.operations[plan.pending];
  need(same(actual,expected)||pending&&same(actual,inventoryAfter(item,expected,pending)),'lifecycle_review_stale','The reviewed document or contribution inventory changed.',{side:item.side,prefix:item.prefix});
 }
 const nextBinding=appliedRekey?{...p.binding,[p.preview.role]:p.preview.to,...(p.preview.role==='target'?{readers:p.preview.readers}:{})}:null;
 need(same(currentBinding(o),p.binding)||nextBinding&&same(currentBinding(o),nextBinding),'lifecycle_review_stale','The connection or reader circle changed after review.');
 for(const dependency of p.observed){const actual=(await peek(side(o,dependency.side),dependency.path))?.text??null;
  const changed=p.operations.map((op,index)=>({op,index})).find(({op,index})=>(plan.done.includes(index)||plan.pending===index)&&op.side===dependency.side&&(op.path===dependency.path||op.type==='archive'&&op.to===dependency.path));
  const expected=changed?(changed.op.type==='archive'&&changed.op.to===dependency.path?changed.op.archived:changed.op.text):dependency.text;
  need(changed&&plan.done.includes(changed.index)?actual===expected:actual===dependency.text||changed&&actual===expected,'lifecycle_review_stale','A reviewed file changed.',{side:dependency.side,path:dependency.path});
 }
 const ours=new Set(p.operations.filter(op=>op.event).map(op=>op.event.id)),snapshot=value=>({events:value.events.filter(e=>!ours.has(e.id)),pending:value.pending.filter(e=>!ours.has(e.id)),unreadable:value.unreadable});
 for(const j of p.journals)need(same(snapshot(await R().read(side(o,j.side),j.page)),snapshot(j)),'lifecycle_review_stale','A reviewed journal changed.');
 if(p.action==='takeover'&&p.mode==='complete')need(Date.parse(now(o))>=Date.parse(p.preview.effective_at),'takeover_pending');
}
async function confirm(o,args,action){
 need(/^[a-f0-9-]{36}$/i.test(args.id??''),'lifecycle_review_stale');const path=BASE+'/lifecycle/prepared/'+args.id+'.json';let seen=await peek(o.work,path),plan=parse(seen),p=plan?.packet;
 need(p?.format==='llmwiki-contribution-lifecycle/1'&&p.action===action&&p.id===args.id&&plan.digest===args.digest&&await R().hash(json(p))===args.digest,'lifecycle_review_stale','Confirm the exact reviewed lifecycle change.');
 declared(o,args.author);need(args.author===p.author,'lifecycle_author');need(o.canPublish===true,'read-only');
 const result=extra=>({id:p.id,action,confirmed:true,complete:plan.state==='complete',...p.preview,...extra});
 if(plan.state==='complete')return result();
 await checkPlan(o,plan);
 const checkpoint=async()=>{const done=await F().writeFile(o.work,path,json(plan)+'\n',seen);need(done.saved,'lifecycle_stale');seen=await peek(o.work,path);};
 for(let i=0;i<p.operations.length;i++){
  if(plan.done.includes(i))continue;need(!o.alive||o.alive(),'lifecycle_disconnected');await checkPlan(o,plan);const op=p.operations[i],dir=side(o,op.side);let current=await peek(dir,op.path);
  plan.pending=i;plan.state='applying';await checkpoint();
  if(op.type==='archive'){
   const archive=await peek(dir,op.to);if(current){need(current.text===op.archived,'lifecycle_review_stale');need(!archive||archive.text===op.archived,'lifecycle_review_stale');if(!F().archiveFile||F().canArchive&&!F().canArchive(dir))return result({requires_host_move:{side:op.side,source:op.path,destination:op.to,expected:await R().hash(op.archived)},reason:'host_move_required'});
    await F().archiveFile(dir,op.path,op.to,await R().hash(op.archived));
   }else need(archive?.text===op.archived,'lifecycle_archive_missing');
  }else if(current?.text!==op.text){
   const dependency=p.observed.find(d=>d.side===op.side&&d.path===op.path);need((current?.text??null)===dependency.text,'lifecycle_review_stale');
   if(op.type==='event')await R().append(dir,op.event);else if(op.type==='receipt')need(await R().receipt(dir,op.event),'lifecycle_receipt_missing');else need((await F().writeFile(dir,op.path,op.text,current)).saved,'lifecycle_stale');
  }
  plan.done.push(i);plan.pending=null;await checkpoint();
 }
 plan.state='complete';await checkpoint();return result();
}
function validObjection(act,request){return act?.format==='llmwiki-contribution-objection/1'&&eventID(act.id)&&act.takeover===request.id&&['document','owner','target','root'].every(key=>act[key]===request[key])&&typeof act.by==='string'&&act.by.trim()&&Number.isFinite(Date.parse(act.at));}
async function confirmedObjection(o,request){
 const m=o.contributionMeta;if(!o.canPublish||m?.target?.bundle_id!==request.target||m.owner?.bundle_id!==request.owner)return null;
 const record=parse(await peek(o.work,await recordPath(request.document,request.target))),home=await peek(o.work,'wiki/bundle.md'),target=await peek(o.remote,'wiki/bundle.md');
 if(record?.format!=='llmwiki-contribution/1'||record.document!==request.document||record.owner!==request.owner||record.target!==request.target||record.root?.id!==request.root||C().parseDocument(home?.text??'').head.id!==request.owner||!same(record.readers,[...new Set(m.target.readers??[])].sort()))return null;
 const targetHead=C().parseDocument(target?.text??'').head;if(targetHead.id!==request.target||targetHead.readers&&!same([...new Set(targetHead.readers)].sort(),record.readers))return null;
 for(const act of record.objections??[]){
  if(!validObjection(act,request))continue;const plan=parse(await peek(o.work,BASE+'/lifecycle/prepared/'+act.id+'.json')),p=plan?.packet;
  if(p?.format!=='llmwiki-contribution-lifecycle/1'||p.id!==act.id||p.action!=='takeover'||p.mode!=='object'||plan.state!=='complete'||p.author!==act.by||p.binding.owner!==request.owner||p.binding.target!==request.target||await R().hash(json(p))!==plan.digest)continue;
  const objectPath=BASE+'/handover/'+request.document+'/'+request.id+'.objection.json',index=p.operations.findIndex(op=>op.side==='remote'&&op.path===objectPath&&op.text===json(act)+'\n');
  if(index>=0&&plan.done.includes(index))return act;
 }
 return null;
}
async function observeTakeovers(o,result){
 if(o.scope==='participation')return;
 const paths=(await listing(o.remote,BASE+'/handover')).filter(path=>path.endsWith('.json')&&!path.endsWith('.objection.json')&&!path.endsWith('.completed.json'));if(!paths.length)return;
 const target=C().parseDocument((await peek(o.remote,'wiki/bundle.md'))?.text??'').head.id,all=await R().read(o.remote),clock=Date.parse(now(o));
 for(const path of paths){
  const source=await peek(o.remote,path),request=parse(source);if(request?.format!=='llmwiki-contribution-takeover/1')continue;
  if(!eventID(request.id)||!identifier(request.document)||request.target!==target||path!==BASE+'/handover/'+request.document+'/'+request.id+'.json'||!Number.isFinite(Date.parse(request.at))||Date.parse(request.effective_at)-Date.parse(request.at)!==30*86400000)continue;
  const root=all.events.find(event=>event.id===request.root&&event.kind==='contribution_root'&&event.source?.owner===request.owner&&event.source?.document===request.document&&event.source?.target===request.target);if(!root)continue;
  const objectPath=path.slice(0,-5)+'.objection.json',completedPath=path.slice(0,-5)+'.completed.json';let objection=await peek(o.remote,objectPath);const completion=parse(await peek(o.remote,completedPath));
  const completed=completion?.format==='llmwiki-contribution-takeover-completion/1'&&completion.takeover===request.id&&['document','owner','target','root'].every(key=>completion[key]===request[key])&&all.events.some(event=>event.source?.kind==='contribution_takeover'&&event.source.root===request.root&&event.source.document===request.document&&event.source.new_document===completion.new_document&&event.author===completion.by);
  if(!objection&&!completed){
   const remembered=await confirmedObjection(o,request);
   if(remembered&&(await peek(o.remote,path))?.text===source.text&&!await peek(o.remote,completedPath)){
    need(!o.alive||o.alive(),'lifecycle_disconnected');const restored=await F().writeFile(o.remote,objectPath,json(remembered)+'\n',null);objection=await peek(o.remote,objectPath);
    (result.findings??=[]).push({code:restored.saved?'objection_removed':'objection_changed',page:root.page,document:request.document,takeover:request.id,repaired:Boolean(restored.saved)});
   }
  }
  const reason=completed?'takeover_completed':objection?validObjection(parse(objection),request)?'takeover_objected':'takeover_evidence_invalid':clock<Date.parse(request.effective_at)?'takeover_pending':'takeover_ready';
  result.pending++;result.pending_details.push({page:root.page,document:request.document,target:request.target,takeover:request.id,by:request.by,at:request.at,effective_at:request.effective_at,reason});
 }
}
const action=kind=>(o,args={})=>args.step==='confirm'?confirm(o,args,kind):args.step===undefined||args.step==='review'?prepare(o,args,kind):Promise.reject(Object.assign(new Error('Choose review or confirm.'),{code:'lifecycle_step'}));
global.WikiContributionLifecycle={retire:action('retire'),handover:action('handover'),fork:action('fork'),takeover:action('takeover'),rekey:action('rekey'),validateRekey,observeTakeovers};
})(environment);
return environment.WikiContributionLifecycle;
}
