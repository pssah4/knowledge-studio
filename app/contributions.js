/* FEAT-04-06: private contribution records and exact-byte release decisions.
   This contract prepares the selection and guards used by EditorSync.run.
   It never implements a separate synchronization loop. See src/ARCHITECTURE.map. */
(function(global){
'use strict';
const BASE='.llmwiki/contributions',VERSION=1,MAX=2000000;
const conversationKinds=['comment','resolve','reopen','proposal','reject','partial','acknowledge'];
function localConversation(events){const ids=new Set(events.filter(e=>e.circle==='local').map(e=>e.id));let count;do{count=ids.size;for(const e of events)if(ids.has(e.parent)||ids.has(e.thread))ids.add(e.id);}while(ids.size!==count);return ids;}
const F=()=>global.FolderAccess,R=()=>global.WikiReviews,C=()=>global.WikiCore;
const json=value=>JSON.stringify(value);
const equal=(a,b)=>json(a)===json(b);
function fail(code,message=code,details={}){throw Object.assign(new Error(message),{code,details});}
function need(condition,code,message,details){if(!condition)fail(code,message,details);}
function identifier(value){return typeof value==='string'&&value.length>0&&value.length<200&&!/[\/\\:\x00-\x20]/.test(value);}
function pagePath(page){need(typeof page==='string'&&/\.md$/i.test(page)&&!/[\\:\x00-\x1f]/.test(page)&&!page.split('/').some(s=>!s||s==='..'||s==='.'||s.startsWith('.')),'contribution_page_invalid');return page;}
async function peek(dir,page){try{return await F().readFile(dir,page);}catch(e){if(e.name==='NotFoundError')return null;throw e;}}
async function readJSON(dir,page){const seen=await peek(dir,page);if(!seen)return null;try{return JSON.parse(seen.text);}catch{fail('contribution_record_unreadable','A contribution record is unreadable.',{page});}}
async function write(dir,page,value,seen){const done=await F().writeFile(dir,page,typeof value==='string'?value:json(value)+'\n',seen??null);need(done.saved,'contribution_stale','Contribution data changed. Read it again.');return done;}
async function files(dir,prefix=''){
 let folder=dir;try{for(const part of prefix.split('/').filter(Boolean))folder=await folder.getDirectoryHandle(part);}catch(e){if(e.name==='NotFoundError')return [];throw e;}
 const found=[];async function walk(h,parent){for await(const entry of h.values()){const page=parent?parent+'/'+entry.name:entry.name;if(entry.kind==='directory')await walk(entry,page);else if(entry.kind==='file')found.push(page);}}await walk(folder,prefix);return found.sort();
}
async function recordPath(document,target){return BASE+'/'+await R().hash(json([document,target]))+'.json';}
const readers=value=>[...new Set(value??[])].sort();
async function binding(o){
 const meta=o.contributionMeta;need(meta&&identifier(meta.target?.bundle_id)&&identifier(meta.owner?.bundle_id),'contribution_connection_required','Select a contribution connection with a pinned bundle identity.');
 const targetFile=await peek(o.remote,'wiki/bundle.md'),homeFile=await peek(o.work,'wiki/bundle.md');
 const target=targetFile?C().parseDocument(targetFile.text).head:null,home=homeFile?C().parseDocument(homeFile.text).head:null;
 need(target?.id===meta.target.bundle_id,'bundle_id_changed','The target bundle identity changed.');
 need(home?.id===meta.owner.bundle_id,'bundle_id_changed','The home bundle identity changed.');
 need(meta.owner.bundle_id!==meta.target.bundle_id,'bundle_id_collision','Home and target must have different bundle identities.');
 need(Array.isArray(meta.target.readers)&&meta.target.readers.length,'audience_changed','The target reader circle is missing.');
 if(target.readers)need(equal(readers(target.readers),readers(meta.target.readers)),'audience_changed','The target reader circle changed.');
 return {owner:meta.owner.bundle_id,target:meta.target.bundle_id,readers:readers(meta.target.readers)};
}
function transfer(text){return C().transferForm(text);}
function compare(text){return C().compareForm(text);}
function normalize(e,page){
 need(e.norm===undefined||e.norm<=VERSION,'journal_norm_outdated','A newer journal normalization version is required.');
 if(e.norm!==undefined&&e.norm<VERSION)return null;
 const value={};for(const key of ['format','id','kind','author','at','parent','thread','message','recipients'])value[key]=e[key];
 value.page=page;value.base=transfer(e.base);value.text=transfer(e.text);value.norm=VERSION;
 if(e.circle==='local')value.circle='local';
 if(['editor_unknown','outside_process'].includes(e.source))value.source=e.source;
 // Map only exact retained lines from the complete source snapshots. A snippet
 // removed by normalization cannot re-enter the target through its anchor.
 if(e.anchor){
  function position(raw,normalized,line,quoted){const a=raw.split('\n'),b=normalized.split('\n'),index=line-1;if(index<0||!quoted.every((s,i)=>a[index+i]===s))return null;
   const blocks=a.length*b.length<=4000000?global.matchingBlocks(a,b):[];
   for(const [x,y,size]of blocks)if(index>=x&&index+Math.max(1,quoted.length)<=x+size)return y+index-x+1;
   return null;
  }
  const beforeLine=position(e.base,value.base,e.anchor.beforeLine,e.anchor.before),afterLine=position(e.text,value.text,e.anchor.afterLine,e.anchor.after);
  if(beforeLine&&afterLine)value.anchor={before:e.anchor.before,after:e.anchor.after,beforeLine,afterLine};
 }
 if(e.kind==='contribution_root'){
  value.source={owner:e.source.owner,document:e.source.document,target:e.source.target};
  value.cut=[...e.cut];value.resumes=[...(e.resumes??[])];value.predecessors=[...(e.predecessors??[])];
 }
 return value;
}
async function eventDigest(e){const {page,...rest}=e;return R().hash(json(rest));}
async function journalDigest(dir,page){const j=await R().read(dir,page);return R().hash(json({events:j.events,pending:j.pending,incomplete:j.incomplete,unreadable:j.unreadable}));}
function authoredLinks(text){
 const links=[];for(const match of text.matchAll(/(!?)\[([^\]\n]*)\]\(<?([^\s)>]+)>?(?:\s+["'][^\n]*?["'])?\)|(!?)\[\[([^\]\n]+)\]\]/g)){
  const wiki=match[5]?.split('|');links.push({written:match[0],target:match[3]??wiki?.[0],label:match[2]??wiki?.[1]??'',attachment:Boolean(match[1]||match[4]),include:false});
 }return links;
}
function relativeAsset(page,link){
 const target=link.split('#')[0].split('?')[0];if(!/\.(?:png|jpe?g|gif|webp|avif|svg|pdf|excalidraw)$/i.test(target)||/^[a-z]+:|^\/\//i.test(target))return null;
 let decoded;try{decoded=decodeURIComponent(target);}catch{fail('contribution_asset_missing');}
 const parts=page.split('/').slice(0,-1);for(const part of decoded.split('/')){if(part==='..'){need(parts.length,'contribution_asset_missing');parts.pop();}else if(part&&part!=='.')parts.push(part);}
 const result=parts.join('/');need(!result.split('/').some(p=>p.startsWith('.')),'contribution_asset_missing');return result;
}
async function assetDigest(file){const data=file.bytes??new TextEncoder().encode(file.text);const bytes=await global.crypto.subtle.digest('SHA-256',data);return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');}
async function disclosures(o,page,text,destination=null){
 const links=authoredLinks(text),assets=[],seen=new Set();
 const inventory=[];for(const path of await files(o.work))if(/\.md$/i.test(path)&&!path.split('/').some(s=>s.startsWith('.'))){const f=await peek(o.work,path);inventory.push({path,head:C().parseDocument(f.text).head});}
 for(const link of links){
  link.page=null;if(/^[a-z][a-z0-9+.-]*:|^\/\//i.test(link.target))continue;
  let written;try{written=decodeURIComponent(link.target.split('#')[0]);}catch{continue;}
  const parts=page.split('/').slice(0,-1);let valid=true;for(const p of written.split('/')){if(p==='..'){if(!parts.length){valid=false;break;}parts.pop();}else if(p&&p!=='.')parts.push(p);}
  if(!valid)continue;const relative=parts.join('/'),bare=written.replace(/\.md$/i,'');
  const matches=inventory.filter(p=>p.path===relative||p.path===written||!written.includes('/')&&[p.head.id,p.head.title,p.path.split('/').at(-1).replace(/\.md$/i,'')].includes(bare));
  if(matches.length===1)link.page=matches[0].path;
 }
 for(const link of links){const path=relativeAsset(page,link.target);if(!path||seen.has(path))continue;
  if(destination){let other;try{other=relativeAsset(destination,link.target);}catch{fail('asset_path_not_flat','Flattening would change the attachment link.');}need(other===path,'asset_path_not_flat','Flattening would change the attachment link.');}
  seen.add(path);let file;
  try{file=await F().readBinary(o.work,path);}catch(e){if(e.name==='NotFoundError')fail('contribution_asset_missing','A linked attachment is unavailable.',{path});throw e;}
  need(file,'contribution_asset_missing','A linked attachment is unavailable.',{path});
  const readable=/\.(?:svg|excalidraw)$/i.test(path)?new TextDecoder().decode(file.bytes??new TextEncoder().encode(file.text)):null;
  assets.push({path,required:true,digest:await assetDigest(file),size:file.size??file.bytes?.length??0,...(readable===null?{}:{text:readable})});
 }
 const parsed=C().parseDocument(text);return {links,assets,fields:{...parsed.head,...parsed.metadata?.fields}};
}
function clearance(value,page){const findings=global.EditorSync.contentClearance(value,page);need(!findings.length,'clearance','Content clearance requires local review.',{findings});}
function ownerDirectory(o){const dir=o.ownerRemote??o.contributionMeta?.owner?.wiki;return dir?(F().asDirectory?F().asDirectory(dir):dir):null;}
function teamHome(o){
 const owner=o.contributionMeta?.owner,authors=readers(owner?.authors??[o.contributionMeta?.author].filter(Boolean)),circle=readers(owner?.readers);
 return Boolean(ownerDirectory(o)&&!(authors.length===1&&circle.length===1&&authors[0]===circle[0]));
}
async function homeEvidence(o,page){
 const dir=ownerDirectory(o);if(!dir)return null;
 const path=R().currentPage(await R().aliases(dir),page);return {file:await peek(dir,path),journal:await R().read(dir,path)};
}
function originalHomeEvent(o,e){return e.norm===undefined&&((o.contributionMeta.owner.authors??[o.contributionMeta.author]).includes(e.author)||['wiki-relations','wiki-index'].includes(e.author));}
async function requireTeamCurrent(o,page,seen){
 if(!teamHome(o))return;
 const home=await homeEvidence(o,page);
 need(home?.file&&C().parseDocument(home.file.text).head.id===C().parseDocument(seen.text).head.id&&compare(home.file.text)===compare(seen.text)&&home.journal.events.some(e=>ordinary(e)&&originalHomeEvent(o,e)&&compare(e.text)===compare(home.file.text)),'team_copy_not_current','Run the full home synchronization before releasing this team document.');
}
async function handoverIdentity(dir,journal,document){
 const handovers=[];for(const path of await files(dir,BASE+'/handover/'+encodeURIComponent(document))){if(!path.endsWith('.json'))continue;const act=await readJSON(dir,path);if(act.document===document&&C().validateHandover(act,journal.events))handovers.push(act);}
 const events=(await R().read(dir,'wiki/bundle.md')).events,rekeys=[];for(const path of await files(dir,BASE+'/rekey'))if(path.endsWith('.json')){const trace=await readJSON(dir,path);if(C().validateRekey(trace,events))rekeys.push({trace,events});}
 return C().replicaIdentity(journal.events.filter(event=>event.kind!=='contribution_root'||event.source?.document===String(document)),{handovers,rekeys});
}
const activeMarker=head=>Boolean(head.shared_copy&&!head.shared_copy.until);
async function sourceIdentity(dir,document,journal){
 if(journal.events.some(event=>event.kind==='contribution_root'&&event.source?.document===String(document)))return null;
 for(const path of await files(dir,BASE+'/from')){
  if(!path.endsWith('/'+encodeURIComponent(document)+'.json'))continue;const state=await readJSON(dir,path);
  if(state?.format==='llmwiki-contribution-state/1'&&state.document===document&&identifier(state.owner)&&identifier(state.target)&&state.owner!==state.target&&typeof state.root==='string'&&path===BASE+'/from/'+encodeURIComponent(state.owner)+'/'+encodeURIComponent(document)+'.json')return {owner:state.owner,document,target:state.target,pending:true,reason:'replica_root_missing'};
 }
 return null;
}
async function replicaAt(dir,page){const file=await peek(dir,page);if(!file)return null;const head=C().parseDocument(file.text).head,journal=await R().read(dir,page);return await handoverIdentity(dir,journal,head.id??'')||await sourceIdentity(dir,head.id??'',journal)||(activeMarker(head)?{pending:true}:null);}
async function publicationPath(record){return BASE+'/published/'+await R().hash(json([record.document,record.target]))+'.json';}
async function publicationWitness(record,root){return {format:'llmwiki-contribution-publication/1',owner:record.owner,target:record.target,document:record.document,destination:record.destination,root:root.id,root_digest:await R().hash(json(root))};}
async function witnessedPublication(o,record){
 const witness=await readJSON(o.work,await publicationPath(record));
 if(witness)return equal(witness,await publicationWitness(record,record.root));
 const state=await readJSON(o.remote,BASE+'/from/'+encodeURIComponent(record.owner)+'/'+encodeURIComponent(record.document)+'.json');
 return state?.format==='llmwiki-contribution-state/1'&&['owner','target','document'].every(key=>state[key]===record[key])&&state.root===record.root.id;
}
async function recoverPublishedRoots(o,selected,result){
 if(!o.canPublish)return;
 for(const entry of selected.values()){
  const {record}=entry,remote=await peek(o.remote,entry.destination),journal=await R().read(o.remote,entry.destination);
  if(!remote||C().parseDocument(remote.text).head.id!==record.document||journal.events.some(e=>e.kind==='contribution_root')||journal.pending.some(e=>e.kind==='contribution_root')||!await approved(record,record.root)||!await witnessedPublication(o,record))continue;
  if((await retirementRecords(o,record.document,record.target)).some(act=>!record.root.resumes.includes(act.id)))continue;
  await requireTeamCurrent(o,entry.name,await peek(o.work,entry.name));clearance(record.root,entry.destination);need(!o.alive||o.alive(),'contribution_stale');
  await R().append(o.remote,record.root);need(await R().receipt(o.remote,record.root),'contribution_record_unreadable');
  (result.findings??=[]).push({code:'replica_root_missing',page:entry.name,document:record.document,target:record.target,root:record.root.id,repaired:true});
 }
}
async function retirementRecords(o,document,target){const records=[];for(const dir of [o.work,o.remote])for(const path of await files(dir,BASE+'/retired'))if(path.endsWith('.json')){const r=await readJSON(dir,path);if(r.document===document&&r.target===target)records.push(r);}return records;}
async function rekeyRecords(o){
 const records=[];for(const dir of [o.work,o.remote,ownerDirectory(o)].filter(Boolean)){
  const events=(await R().read(dir,'wiki/bundle.md')).events;
  for(const path of await files(dir,BASE+'/rekey'))if(path.endsWith('.json')){const trace=await readJSON(dir,path);if(global.WikiContributionLifecycle?.validateRekey(trace,events))records.push(trace);}
 }return records;
}
async function identityChanges(o,owner,destination){
 const traces=(await rekeyRecords(o)).filter(t=>t.role==='owner'),roots=(await R().read(o.remote,destination)).events.filter(e=>e.kind==='contribution_root'),changes=new Map();
 for(const root of roots){let current=root.source.owner;const seen=new Set();while(current!==owner&&!seen.has(current)){
  seen.add(current);const choices=traces.filter(t=>t.from===current);if(!choices.length)break;
  need(new Set(choices.map(t=>t.to)).size===1,'rekey_collision');const trace=choices[0];
  // Disclose only the identity decision. The source bundle's document, labels
  // and private navigation are not part of a contribution to this target.
  const event={format:'llmwiki-review/1',id:trace.decision_event,kind:'change',page:'wiki/bundle.md',author:trace.by,at:trace.at,parent:null,thread:trace.decision_event,base:'',text:'',message:'',recipients:[],norm:VERSION,source:{kind:'contribution_rekey',id:trace.id,role:trace.role,from:trace.from,to:trace.to,readers:trace.readers,confirmed:true}};
  need(global.WikiContributionLifecycle.validateRekey(trace,[event]),'rekey_unverified');
  const redirect={to:trace.to},path=BASE+'/from/'+encodeURIComponent(trace.from)+'/rekeyed.json',existing=await readJSON(o.remote,path);
  need(!existing||equal(existing,redirect),'rekey_collision');changes.set(trace.id,{trace,event,path,redirect});current=trace.to;
 }}return [...changes.values()].sort((a,b)=>a.trace.from.localeCompare(b.trace.from));
}
function currentSource(source,traces){
 const value={...source};for(const role of ['owner','target']){const seen=new Set();while(!seen.has(value[role])){seen.add(value[role]);const choices=traces.filter(t=>t.role===role&&t.from===value[role]);if(!choices.length)break;if(new Set(choices.map(t=>t.to)).size!==1)return null;value[role]=choices[0].to;}}
 return value;
}
async function reviewedRoot(o,prior,b,document,page,text,journal,author){
 const source={owner:b.owner,document,target:b.target};
 if(prior?.closed)need(prior.lifecycle?.kind==='retired','foreign_document_skipped','This document was handed over or forked; it cannot revive its former contribution.');
 const targetJournal=await R().read(o.remote,page),target=targetJournal.events.filter(e=>e.kind==='contribution_root'),traces=await rekeyRecords(o);
 need(![...targetJournal.events,...targetJournal.pending,...(prior?.root?[prior.root]:[])].some(e=>e.norm>VERSION),'journal_norm_outdated','A newer journal normalization version is required.');
 if(prior?.root&&!equal(prior.root.source,source))need(equal(currentSource(prior.root.source,traces),source),'rekey_unverified');
 need(target.every(e=>equal(currentSource(e.source,traces),source)),'owner_conflict');
 const retirements=await retirementRecords(o,document,b.target);
 const visible=latestRoot(target);
 if(!prior?.root&&visible&&equal(visible.source,source)&&transfer(visible.text)===text&&retirements.every(r=>visible.resumes.includes(r.id)))return visible;
 if(prior?.root&&equal(prior.root.source,source)&&!prior.closed&&(!target.length||visible&&(visible.id===prior.root.id||transfer(visible.text)===transfer(prior.root.text)))&&retirements.every(r=>prior.root.resumes.includes(r.id)))return prior.root;
 if(target.length&&!prior?.closed){
  const proof=journal.events;
  need(target.every(root=>anchors(proof.filter(e=>originalHomeEvent(o,e)).map(e=>({...e,base:transfer(e.base),text:transfer(e.text)})),root).has(compare(text))),'owner_conflict','The target root has no statement lineage in this home journal.');
 }
 return R().event({kind:'contribution_root',page,author,base:'',text,norm:VERSION,source,cut:[...new Set([...journal.events,...journal.pending].map(e=>e.id).concat([...targetJournal.events,...targetJournal.pending].map(e=>e.id),target.flatMap(e=>e.cut??[])))],resumes:[...new Set(retirements.map(r=>r.id))],predecessors:[...new Set([...target.map(e=>e.id),...(prior?.root?[prior.root.id]:[])])]});
}
async function validateOwner(o,page,seen){
 const head=C().parseDocument(seen.text).head;need(identifier(head.id),'contribution_identity_missing','The document needs a stable identity.');
 const journal=await R().read(o.work,page),home=await homeEvidence(o,page);
 need(!await sourceIdentity(o.work,head.id,journal)&&!(home&&await sourceIdentity(ownerDirectory(o),head.id,home.journal)),'replica_root_missing','This replica lost its root; let its home restore the published journal.');
 need(!activeMarker(head)&&!head.llmwiki_redirect&&!(home?.file&&activeMarker(C().parseDocument(home.file.text).head))&&!await handoverIdentity(o.work,journal,head.id)&&!(home&&await handoverIdentity(ownerDirectory(o),home.journal,head.id)),'foreign_document_skipped','A replica cannot contribute to another target.');
 need(!(o.contributionMeta.subscribed_ids??[]).includes(head.id),'foreign_document_skipped','This identity belongs to a subscribed wiki.');
 return {head,journal};
}
async function displayPacket(o,head,b,root,author){
 const also_in=[];for(const path of await files(o.work,BASE)){if(!/^\.llmwiki\/contributions\/[a-f0-9]+\.json$/.test(path))continue;const record=await readJSON(o.work,path);
  if(record?.format==='llmwiki-contribution/1'&&record.document===head.id&&record.target!==b.target&&!record.closed&&head.contribute_to?.includes(record.target)&&record.target_title)also_in.push({id:record.target,title:record.target_title});
 }
 also_in.sort((a,b)=>a.id.localeCompare(b.id));
 const target=C().parseDocument((await peek(o.remote,'wiki/bundle.md')).text).head,home=C().parseDocument((await peek(o.work,'wiki/bundle.md')).text).head;
 const display={owner:teamHome(o)?b.owner:author,...(teamHome(o)?{owner_title:home.title??b.owner}:{}),also_in,pushed_by:author,pushed_at:root.at};
 clearance(display,'replica notice');return {display,target_title:target.title??b.target};
}
async function displayState(o,entry){
 const head=C().parseDocument((await peek(o.work,entry.name)).text).head,current=await displayPacket(o,head,{owner:entry.record.owner,target:entry.record.target},entry.root,entry.record.confirmed_by);
 return {display:entry.record.display??{owner:entry.record.owner,also_in:[],pushed_by:entry.record.confirmed_by,pushed_at:entry.root.at},pending:!equal(current.display,entry.record.display)||current.target_title!==entry.record.target_title};
}
async function review(o,args){
 need(o.canPublish,'target_read_only','The contribution target is read-only.');
 if(Array.isArray(args.pages))return reviewBatch(o,args);
 const b=await binding(o),page=pagePath(args.page),seen=await peek(o.work,page);need(seen,'contribution_page_missing');
 const {head,journal}=await validateOwner(o,page,seen),path=await recordPath(head.id,b.target),prior=await readJSON(o.work,path);
 if(prior){need(prior.owner===b.owner,'owner_conflict');need(equal(prior.readers,b.readers),'audience_changed');}
 await requireTeamCurrent(o,page,seen);
 const text=transfer(seen.text);need(text.length<=MAX,'contribution_size_limit');
 const destination=R().currentPage(await R().aliases(o.remote),prior?.destination??'wiki/'+page.split('/').at(-1)),remote=await peek(o.remote,destination);
 if(remote)need(C().parseDocument(remote.text).head.id===head.id,'contribution_name_collision','Another document uses this target filename.',{page:destination});
 const other=(await files(o.remote)).filter(p=>/\.md$/i.test(p)&&p!==destination&&!p.startsWith('.'));
 for(const p of other){const f=await peek(o.remote,p);need(C().parseDocument(f.text).head.id!==head.id,'duplicate_id_in_target','The target already has this identity at another path.',{page:p});}
 const author=args.author??o.contributionMeta.author;need(typeof author==='string'&&author.trim(),'contribution_author_required');
 const root=await reviewedRoot(o,prior,b,head.id,destination,text,journal,author);
 const cut=new Set(root.cut),include_comments=o.contributionMeta.comments!==false&&(args.include_comments??o.contributionMeta.comments??prior?.include_comments??false);
 const localThreads=new Set(journal.events.filter(e=>e.circle==='local').map(e=>e.thread));
 const candidates=prior&&root.id===prior.root.id?journal.events.filter(e=>!localThreads.has(e.thread)&&!cut.has(e.id)&&(['change','accept'].includes(e.kind)||include_comments&&conversationKinds.includes(e.kind))).map(e=>normalize(e,destination)).filter(e=>e&&(e.kind!=='change'||compare(e.base)!==compare(e.text))):[root];
 const disclosed=await disclosures(o,page,text,destination);clearance(text,destination);for(const e of candidates)clearance(e,destination);for(const asset of disclosed.assets)if(asset.text!==undefined)clearance(asset.text,asset.path);
 const display=await displayPacket(o,head,b,root,author),identity_changes=await identityChanges(o,b.owner,destination);for(const change of identity_changes)clearance(change,destination);
 const observed={display:await R().hash(json(display)),identities:await R().hash(json(identity_changes)),source:await R().hash(seen.text),journal:await journalDigest(o.work,page),target:remote?await R().hash(remote.text):null,record:prior?await R().hash(json(prior)):null};
 const packet={page,document:head.id,destination,text,root,events:candidates,identity_changes,include_comments,...display,...disclosed,findings:prior&&prior.destination!==destination?[{code:'replica_moved',from:prior.destination,to:destination}]:[]};
 const id=global.crypto.randomUUID(),digest=await R().hash(json({binding:b,observed,packet}));
 const prepared={format:'llmwiki-contribution-preview/1',id,digest,binding:b,observed,packet,author};
 await write(o.work,BASE+'/prepared/'+id+'.json',prepared,null);
 return {id,digest,target:{bundle_id:b.target,readers:b.readers},...packet};
}
async function confirm(o,args){
 need(o.canPublish,'target_read_only','The contribution target is read-only.');
 need(/^[a-f0-9-]{36}$/i.test(args.id??''),'contribution_review_stale');
 const p=await readJSON(o.work,BASE+'/prepared/'+args.id+'.json');
 if(p?.format==='llmwiki-contribution-batch/1')return confirmBatch(o,args,p);
 need(p?.format==='llmwiki-contribution-preview/1'&&p.digest===args.digest,'contribution_review_stale','Read the exact contribution preview before confirming.');
 const b=await binding(o);need(equal(p.binding,b),'contribution_review_stale','The target or readership changed after review.');
 const {packet}=p,seen=await peek(o.work,packet.page),remote=await peek(o.remote,packet.destination),path=await recordPath(packet.document,b.target),previous=await peek(o.work,path),prior=previous?JSON.parse(previous.text):null;
 need(!packet.include_comments||o.contributionMeta.comments!==false,'contribution_review_stale','The connection no longer permits the reviewed conversations.');
 need(seen,'contribution_review_stale');await validateOwner(o,packet.page,seen);await requireTeamCurrent(o,packet.page,seen);
 if(prior?.confirmed_preview?.id===p.id&&prior.confirmed_preview.digest===p.digest)return {confirmed:true,document:packet.document,target:b.target,record:path,next:'sync',unchanged:true};
 const display=await displayPacket(o,C().parseDocument(seen.text).head,b,packet.root,p.author),identity_changes=await identityChanges(o,b.owner,packet.destination);
 const observed={display:await R().hash(json(display)),identities:await R().hash(json(identity_changes)),source:seen?await R().hash(seen.text):null,journal:await journalDigest(o.work,packet.page),target:remote?await R().hash(remote.text):null,record:prior?await R().hash(json(prior)):null};
 need(equal(observed,p.observed),'contribution_review_stale','The reviewed document, journal or target changed.');
 need(await R().hash(json({binding:b,observed:p.observed,packet}))===p.digest,'contribution_review_stale');
 const disclosed=await disclosures(o,packet.page,packet.text,packet.destination);need(equal(disclosed, {links:packet.links,assets:packet.assets,fields:packet.fields}),'contribution_review_stale','A reviewed attachment changed.');
 clearance(packet.text,packet.destination);for(const e of packet.events)clearance(e,packet.destination);for(const asset of packet.assets)if(asset.text!==undefined)clearance(asset.text,asset.path);
 const head=C().parseDocument(seen.text).head,targetList=[...new Set([...(Array.isArray(head.contribute_to)?head.contribute_to:[]),b.target])];
 const marked=C().setContributionTargets(seen.text,targetList);
 const author=args.author??p.author;need(author===p.author,'contribution_review_stale','The confirming person differs from the preview.');
 const done=await R().save(o.work,packet.page,seen,marked,author);need(done.saved&&done.recorded,'contribution_stale');
 const release={target:b.target,readers:b.readers,document:packet.document,text:await R().hash(packet.text),identities:await R().hash(json(identity_changes)),events:await Promise.all(packet.events.map(async e=>({id:e.id,digest:await eventDigest(e)}))),assets:packet.assets.map(({path,digest})=>({path,digest}))};
 const record={format:'llmwiki-contribution/1',display:packet.display,target_title:packet.target_title,identity_changes,owner:b.owner,target:b.target,readers:b.readers,document:packet.document,page:packet.page,destination:packet.destination,root:packet.root,include_comments:packet.include_comments,confirmed_by:author,confirmed_preview:{id:p.id,digest:p.digest},release,releases:[...(prior?.releases??[]),release],links:packet.links.map(l=>l.written)};
 await write(o.work,path,record,previous);
 return {confirmed:true,document:packet.document,target:b.target,record:path,next:'sync'};
}
async function heldFolderMarking(o,page,b,destination){
 const seen=await peek(o.work,page);need(seen,'contribution_page_missing');const {head}=await validateOwner(o,page,seen);
 const prior=await readJSON(o.work,await recordPath(head.id,b.target));
 destination??=R().currentPage(await R().aliases(o.remote),prior?.destination??'wiki/'+page.split('/').at(-1));
 const before=Array.isArray(head.contribute_to)?head.contribute_to:[],after=[...new Set([...before,b.target])],marked=C().setContributionTargets(seen.text,after);
 return {page,document:head.id,destination,reason:'contribution_name_collision',field:'contribute_to',before,after,expected:await R().hash(seen.text),marked_sha256:await R().hash(marked)};
}
async function reviewBatch(o,args){
 need(o.canPublish,'target_read_only','The contribution target is read-only.');
 const b=await binding(o),pages=[...new Set(args.pages??[])].sort(),list=[],findings=[],markings=[],destinations=new Set();
 need(pages.length>0&&pages.length<=500,'contribution_batch_invalid','Choose between one and 500 documents.');
 for(const page of pages){
  let held=null,destination=null;
  try{const p=await review(o,{page,author:args.author,include_comments:args.include_comments});destination=p.destination;if(destinations.has(destination))held='contribution_name_collision';else{destinations.add(destination);list.push({page,destination,review:p});}}catch(e){held=e.code??'contribution_unreadable';}
  if(held){findings.push({page,reason:held});if(args.folder&&held==='contribution_name_collision')markings.push(await heldFolderMarking(o,page,b,destination));}
 }
 const id=global.crypto.randomUUID(),packet={target:{bundle_id:b.target,readers:b.readers},files:list,findings,...(args.folder?{folder:args.folder,mode:args.mode,markings}: {})},digest=await R().hash(json({binding:b,packet}));
 await write(o.work,BASE+'/prepared/'+id+'.json',{format:'llmwiki-contribution-batch/1',id,digest,binding:b,packet,author:args.author??o.contributionMeta.author},null);
 return {id,digest,...packet};
}
async function confirmBatch(o,args,p){
 const b=await binding(o);need(p.digest===args.digest&&equal(p.binding,b)&&await R().hash(json({binding:b,packet:p.packet}))===p.digest,'contribution_review_stale');
 need(args.author===p.author,'contribution_review_stale');need(p.packet.files.length,'contribution_batch_empty','No document in this preview can be approved.');
 const markings=[];
 // Held files grant only the displayed target-field change. Check every
 // preimage before confirming any payload; no root or byte release is created.
 for(const mark of p.packet.markings??[]){
  const seen=await peek(o.work,mark.page);need(seen,'contribution_review_stale');const digest=await R().hash(seen.text);
  need(digest===mark.expected||digest===mark.marked_sha256,'contribution_review_stale');
  const {head}=await validateOwner(o,mark.page,seen);need(head.id===mark.document,'contribution_review_stale');
  const text=C().setContributionTargets(seen.text,mark.after);need(await R().hash(text)===mark.marked_sha256,'contribution_review_stale');
  if(digest!==mark.marked_sha256)markings.push({mark,seen,text});
 }
 const files=[];for(const item of p.packet.files)files.push({page:item.page,...await confirm(o,{id:item.review.id,digest:item.review.digest,author:args.author})});
 for(const {mark,seen,text}of markings){const done=await R().save(o.work,mark.page,seen,text,args.author);need(done.saved&&done.recorded,'contribution_stale');}
 if(p.packet.folder){const path=BASE+'/folders/'+await R().hash(json([b.target,p.packet.folder]))+'.json',seen=await peek(o.work,path),pages=[...new Set([...p.packet.files,...(p.packet.markings??[])].filter(f=>f.page.startsWith(p.packet.folder+'/')).map(f=>f.page))].sort();await write(o.work,path,{format:'llmwiki-contribution-folder/1',path:p.packet.folder,target:b.target,readers:b.readers,mode:p.packet.mode,author:p.author,pages},seen);}
 return {confirmed:true,files,findings:p.packet.findings,...(p.packet.folder?{folder:p.packet.folder,mode:p.packet.mode,markings:p.packet.markings??[]}:{})};
}
async function folder(o,args){
 if(args.step==='confirm')return confirm(o,args);
 const path=args.path;need(typeof path==='string'&&path&&!/[\\:\x00-\x1f]/.test(path)&&!path.split('/').some(p=>!p||p==='..'||p==='.'||p.startsWith('.')),'contribution_folder_invalid');
 const mode=args.mode??'propose';need(['propose','automatic'].includes(mode),'contribution_folder_invalid');
 const pages=(await files(o.work,path)).filter(p=>/\.md$/i.test(p)&&!p.split('/').some(s=>s.startsWith('.')));
 return reviewBatch(o,{...args,pages:[...pages,...(args.pages??[])],folder:path,mode});
}
async function folderRules(o,result){
 const target=o.contributionMeta.target.bundle_id;
 for(const path of await files(o.work,BASE+'/folders')){if(!path.endsWith('.json'))continue;const rule=await readJSON(o.work,path);if(rule.format!=='llmwiki-contribution-folder/1'||rule.target!==target)continue;
  if(!equal(readers(rule.readers),readers(o.contributionMeta.target.readers))){pending(result,rule.path,'audience_changed');continue;}
  for(const page of await files(o.work,rule.path)){if(!/\.md$/i.test(page)||page.split('/').some(s=>s.startsWith('.'))||rule.pages.includes(page))continue;
   const seen=await peek(o.work,page),head=C().parseDocument(seen.text).head;if(Array.isArray(head.contribute_to)&&head.contribute_to.includes(target))continue;
   if(rule.mode==='automatic'){
    if(head.resource?.link&&!/^[a-z]+:\/\//i.test(head.resource.link)&&!(o.contributionMeta.sources??[]).some(s=>s.id===head.resource.store&&s.store)){pending(result,page,'source_link_private');continue;}
    try{await validateOwner(o,page,seen);}catch(e){if(!['foreign_document_skipped','replica_root_missing','contribution_identity_missing'].includes(e.code))throw e;pending(result,page,e.code);continue;}
    const text=C().setContributionTargets(seen.text,[...(Array.isArray(head.contribute_to)?head.contribute_to:[]),target]),done=await R().save(o.work,page,seen,text,rule.author);need(done.saved&&done.recorded,'contribution_stale');
   }else pending(result,page,'contribution_proposed');
  }
 }
}
async function sourceState(o,entry){
 const file=await peek(o.remote,entry.destination);if(!file)return null;
 const published=(await R().read(o.remote,entry.destination)).events.find(e=>e.id===entry.root.id);need(published&&equal(published,entry.root),'contribution_record_unreadable');
 const witness=await publicationWitness(entry.record,entry.root),witnessPath=await publicationPath(entry.record),previous=await peek(o.work,witnessPath);if(previous?.text!==json(witness)+'\n')await write(o.work,witnessPath,witness,previous);
 const value={format:'llmwiki-contribution-state/1',document:entry.record.document,owner:entry.record.owner,target:entry.record.target,source:entry.record.display?.owner??entry.record.owner,by:entry.record.confirmed_by,root:entry.root.id,statement_sha256:await R().hash(compare(file.text))};
 if(teamHome(o))value.source_title=entry.record.display?.owner_title??entry.record.owner;
 const path=BASE+'/from/'+encodeURIComponent(value.owner)+'/'+encodeURIComponent(value.document)+'.json',prior=await peek(o.remote,path);let old=null;try{old=prior?JSON.parse(prior.text):null;}catch{}
 if(old){const {at,...rest}=old;if(equal(rest,value))return old;}
 const state={...value,at:new Date().toISOString()};await write(o.remote,path,state,prior);return state;
}
async function outcome(o,entry){
 const page=entry.name??entry.page,record=entry.record??entry,destination=entry.destination??record.destination,local=await peek(o.work,page),remote=await peek(o.remote,destination),state=await readJSON(o.remote,BASE+'/from/'+encodeURIComponent(record.owner)+'/'+encodeURIComponent(record.document)+'.json');
 return {page,document:record.document,target:record.target,destination,root:record.root.id,last_success:state?.at??null,statement_sha256:remote?await R().hash(compare(remote.text)):null,state:record.closed?'closed':local&&remote&&transfer(local.text)===transfer(remote.text)?'current':'pending'};
}
function journalDetails(page,plan){
 return [...new Set(plan.blocked.map(e=>e.reason))].map(reason=>({page,reason,events:plan.blocked.filter(e=>e.reason===reason).map(({reason,...e})=>e)}));
}
async function resultState(o,selected,result){
 for(const entry of selected.values()){
  const plan=await journalPlan(o,entry,true);
  for(const detail of journalDetails(entry.name,plan)){
   const existing=result.pending_details.find(p=>p.page===detail.page&&p.reason===detail.reason);
   if(existing)existing.events=detail.events;else{result.pending++;result.pending_details.push(detail);}
  }
 }
 result.target=o.contributionMeta.target.bundle_id;result.received_at=new Date().toISOString();result.complete=!result.pending&&!result.conflicts.length;result.contribution_state=[];
 for(const entry of selected.values()){const value=await outcome(o,entry);if(result.conflicts.some(c=>c.page===entry.name))value.state='conflict';else if(result.pending_details.some(c=>c.page===entry.name))value.state='pending';result.contribution_state.push(value);}
 for(const item of result.pending_details)if(!result.contribution_state.some(v=>v.page===item.page))result.contribution_state.push({page:item.page,target:result.target,state:'pending',reason:item.reason});
 result.proposed=result.pending_details.filter(p=>p.reason==='contribution_proposed').map(p=>p.page);
 result.held_by_owner_chain=result.pending_details.filter(p=>['held_by_owner_chain','team_copy_not_current'].includes(p.reason)).map(p=>p.page);
 result.replica_pending=result.pending_details.filter(p=>['replica_root_missing','stale_view','contribution_root_ambiguous'].includes(p.reason)).map(p=>p.page);
}
async function status(o,args){
 const target=o.contributionMeta?.target?.bundle_id,page=pagePath(args.page),seen=await peek(o.work,page),document=seen?C().parseDocument(seen.text).head.id:null;
 if(!document||!target)return {page,document,target,confirmed:false,reason:'contribution_record_missing'};
 const record=await readJSON(o.work,await recordPath(document,target));
 if(!record)return {page,document,target,confirmed:false,reason:'contribution_record_missing'};
 const entry={name:page,destination:record.destination,record},value={...await outcome(o,entry),confirmed:true,include_comments:record.include_comments},result={pending:0,pending_details:[]};
 if(record.closed)return value;
 if(!(record.releases??[record.release]).filter(Boolean).length)pending(result,page,'contribution_review_pending');
 else try{
  // Reuse the read-only journal gates. Selection and synchronization also write
  // private records and must never be invoked merely to inspect the status.
  const prepared=await preparePage(o,entry,result);
  if(prepared){
   const outgoing=await journalPlan(o,prepared,true),incoming=await journalPlan(o,prepared,false),known=new Set(outgoing.source.events.map(e=>e.id));
   result.pending_details.push(...journalDetails(page,outgoing));
   const ready=[...outgoing.events,...incoming.events.filter(e=>!known.has(e.id)),...(prepared.initial?[prepared.root]:[])];
   if(ready.length)result.pending_details.push({page,reason:'contribution_journal_pending',events:ready.map(({id,kind,author,at})=>({id,kind,author,at}))});
   if((await displayState(o,prepared)).pending)pending(result,page,'contribution_display_review_pending');
  }
 }catch(e){if(e.code!=='journal_norm_outdated')throw e;pending(result,page,e.code);}
 if(result.pending_details.length){value.state='pending';value.pending_details=result.pending_details;}
 return value;
}
async function device(o){const page=BASE+'/device.json',seen=await peek(o.work,page);if(seen)return JSON.parse(seen.text).id;const id=global.crypto.randomUUID();await write(o.work,page,{id},null);return id;}
async function probe(o,args={}){
 const b=await binding(o),own=await device(o),root='.llmwiki/platform-check';
 if(args.write){const id=global.crypto.randomUUID(),marker={format:'llmwiki-platform-check/1',device:own,id,at:new Date().toISOString()},page=root+'/'+own+'-'+id+'.json';await write(o.remote,page,marker,null);await write(o.remote,page+'.applied',{id,digest:await R().hash(json(marker)+'\n')},null);return {written:true,device:own,next:'Run contribute.probe on the other device after file transport finishes.'};}
 const matches=[];for(const page of await files(o.remote,root)){if(!page.endsWith('.json'))continue;const f=await peek(o.remote,page),m=JSON.parse(f.text),receipt=await readJSON(o.remote,page+'.applied');if(m.format==='llmwiki-platform-check/1'&&m.device!==own&&receipt?.id===m.id&&receipt.digest===await R().hash(f.text)&&Date.now()-Date.parse(m.at)<=7*86400000)matches.push({page,digest:receipt.digest,device:m.device,at:m.at});}
 need(matches.length,'dotfolder_sync_unverified','A marker and receipt from another device have not arrived.');
 const page=BASE+'/platform-proof/'+await R().hash(b.target)+'.json',seen=await peek(o.work,page);await write(o.work,page,{format:'llmwiki-platform-proof/1',target:b.target,device:own,markers:matches},seen);return {verified:true,markers:matches.length};
}
async function platformGate(o){
 const target=o.contributionMeta.target.bundle_id,proof=await readJSON(o.work,BASE+'/platform-proof/'+await R().hash(target)+'.json');if(!proof)return 'dotfolder_sync_unverified';
 for(const m of proof.markers){const f=await peek(o.remote,m.page),r=await readJSON(o.remote,m.page+'.applied');if(f&&await R().hash(f.text)===m.digest&&r?.digest===m.digest&&Date.now()-Date.parse(m.at)<=7*86400000)return null;}
 return 'dotfolder_sync_stale';
}
function pending(result,page,reason){result.pending++;result.pending_details.push({page,reason});}
async function selectPages(o,result){
 const b=await binding(o),selected=new Map(),names=new Map();
 await folderRules(o,result);
 for(const page of await files(o.work)){
  if(page.split('/').some(p=>p.startsWith('.')||['schema','notices','vermerke'].includes(p))||!/\.md$/i.test(page))continue;
  const file=await peek(o.work,page),head=C().parseDocument(file.text).head;
  if(!Array.isArray(head.contribute_to)||!head.contribute_to.includes(b.target))continue;
  const journal=await R().read(o.work,page),home=await homeEvidence(o,page);
  if(await sourceIdentity(o.work,head.id,journal)||home&&await sourceIdentity(ownerDirectory(o),head.id,home.journal)){pending(result,page,'replica_root_missing');continue;}
  if(home&&await handoverIdentity(ownerDirectory(o),home.journal,head.id)||home?.file&&activeMarker(C().parseDocument(home.file.text).head)){pending(result,page,'foreign_document_skipped');continue;}
  if(activeMarker(head)||await handoverIdentity(o.work,journal,head.id)){pending(result,page,'target_list_from_replica_ignored');continue;}
  if((o.contributionMeta.subscribed_ids??[]).includes(head.id)){pending(result,page,'foreign_document_skipped');continue;}
  if(!identifier(head.id)){pending(result,page,'contribution_identity_missing');continue;}
  const record=await readJSON(o.work,await recordPath(head.id,b.target));
  if(!record){pending(result,page,'contribution_record_missing');continue;}
  if(record.closed||!(record.releases??[record.release]).filter(Boolean).length){pending(result,page,record.lifecycle?.kind==='retired'?'retired_in_target':'contribution_review_pending');continue;}
  if(record.target!==b.target||record.owner!==b.owner){pending(result,page,'bundle_id_changed');continue;}
  if(!equal(record.readers,b.readers)){pending(result,page,'audience_changed');continue;}
  if(record.page!==page){pending(result,page,'contribution_path_changed');continue;}
  const destination=record.destination;pagePath(destination);
  if(names.has(destination)){pending(result,page,'contribution_name_collision');selected.delete(names.get(destination));continue;}
  names.set(destination,page);selected.set(page,{name:page,destination,size:file.text.length,record});
 }
 if(selected.size){const reason=await platformGate(o);if(reason){for(const page of selected.keys())pending(result,page,reason);selected.clear();}}
 await recoverPublishedRoots(o,selected,result);
 return selected;
}
function ordinary(e){return ['change','accept'].includes(e.kind)&&e.source!=='discard';}
function latestRoot(events){
 const roots=events.filter(e=>e.kind==='contribution_root'),ids=new Set(roots.map(e=>e.id)),ancestors=new Set(roots.flatMap(e=>e.predecessors??[]));
 if([...ancestors].some(id=>!ids.has(id)))return null;
 const byID=new Map(roots.map(e=>[e.id,e])),visit=(id,path=new Set())=>{if(path.has(id))return false;return (byID.get(id)?.predecessors??[]).every(p=>visit(p,new Set([...path,id])));};
 if(roots.some(e=>!visit(e.id)))return null;
 const heads=roots.filter(e=>!ancestors.has(e.id));if(!heads.length)return null;
 return heads.every(e=>equal(e.source,heads[0].source)&&transfer(e.text)===transfer(heads[0].text))?heads.slice().sort((a,b)=>a.id.localeCompare(b.id))[0]:null;
}
function anchors(events,root){
 const a=new Set([compare(root.text)]);let size;do{size=a.size;for(const e of events)if(ordinary(e)&&a.has(compare(e.base)))a.add(compare(e.text));}while(size!==a.size);return a;
}
async function approved(record,event){
 const digest=await eventDigest(event);return (record.releases??[record.release]).some(r=>r.target===record.target&&r.document===record.document&&equal(r.readers,record.readers)&&r.events.some(e=>e.id===event.id&&e.digest===digest));
}
async function preparePage(o,entry,result){
 if(!o.canPublish){pending(result,entry.name,'read_only');return null;}
 try{await requireTeamCurrent(o,entry.name,await peek(o.work,entry.name));}catch(e){if(e.code!=='team_copy_not_current')throw e;pending(result,entry.name,e.code);return null;}
 const {record}=entry,remote=await peek(o.remote,entry.destination),journal=await R().read(o.remote,entry.destination),roots=journal.events.filter(e=>e.kind==='contribution_root');
 if([record.root,...journal.events,...journal.pending].some(e=>e.norm>VERSION)){pending(result,entry.name,'journal_norm_outdated');return null;}
 if(remote&&C().parseDocument(remote.text).head.id!==record.document){pending(result,entry.name,'contribution_name_collision');return null;}
 const traces=await rekeyRecords(o),source={owner:record.owner,document:record.document,target:record.target};
 if(roots.some(e=>!equal(currentSource(e.source,traces),source))){pending(result,entry.name,'owner_conflict');return null;}
 const proposed=!roots.some(e=>e.id===record.root.id)&&await approved(record,record.root),lineage=proposed?[...roots,record.root]:roots;
 let root=lineage.length?latestRoot(lineage):record.root;
 if(!root){
  const local=(await R().read(o.work,entry.name)).events.filter(e=>originalHomeEvent(o,e)).map(e=>({...e,base:transfer(e.base),text:transfer(e.text)})),text=compare((await peek(o.work,entry.name)).text);
  const disconnected=proposed&&roots.some(candidate=>!anchors(local,candidate).has(text));
  pending(result,entry.name,disconnected?'owner_conflict':'contribution_root_ambiguous');return null;
 }
 if(root.id!==record.root.id){const samePhase=roots.find(e=>e.id===record.root.id&&equal(e.source,root.source)&&transfer(e.text)===transfer(root.text)&&!(root.predecessors??[]).includes(e.id));if(samePhase)root=samePhase;else{pending(result,entry.name,'stale_view');return null;}}
 if(!roots.length&&remote&&!C().parseDocument(remote.text).head.shared_copy){pending(result,entry.name,'foreign_id_in_target');return null;}
 if(!roots.length&&remote&&compare(remote.text)!==compare(root.text)){pending(result,entry.name,'replica_root_missing');return null;}
 if(journal.pending.some(e=>e.kind==='contribution_root'&&e.id!==root.id)){pending(result,entry.name,'stale_view');return null;}
 const retirements=await retirementRecords(o,record.document,record.target);
 if(retirements.some(r=>!lineage.some(e=>e.resumes.includes(r.id)))){pending(result,entry.name,'stale_view');return null;}
 const phaseCut=new Set(roots.flatMap(e=>e.cut).concat(record.root.cut));
 const currentTexts=anchors(journal.events.filter(e=>!phaseCut.has(e.id)),root);
 if(remote&&!currentTexts.has(compare(remote.text))&&journal.events.some(e=>(e.kind==='contribution_root'||phaseCut.has(e.id))&&compare(e.text)===compare(remote.text))){pending(result,entry.name,'replica_phase_file_pending');return null;}
 return {...entry,root,roots,journal,initial:!roots.some(e=>e.id===root.id),cut:new Set(roots.flatMap(e=>e.cut).concat(record.root.cut))};
}
async function journalPlan(o,entry,outgoing){
 const from=outgoing?o.work:o.remote,sourcePage=outgoing?entry.name:entry.destination,targetPage=outgoing?entry.destination:entry.name;
 const source=await R().read(from,sourcePage),events=[],blocked=[],hold=(e,reason)=>blocked.push({id:e.id,kind:e.kind,author:e.author,at:e.at,reason}),target=(await R().read(outgoing?o.remote:o.work,targetPage)).events;
 const known=new Set(target.map(e=>e.id)),eligible=[...entry.journal.events];if(!eligible.some(e=>e.id===entry.root.id))eligible.push(entry.root);
 const local=localConversation(source.events),byID=new Map(source.events.map(e=>[e.id,e])),include_comments=entry.record.include_comments&&o.contributionMeta.comments!==false;
 const authors=o.contributionMeta.owner.authors??[o.contributionMeta.author],current=outgoing?await peek(o.work,entry.name):null,via=new Map();
 if(outgoing)for(const raw of source.events)via.set(raw.id,await readJSON(o.work,(await R().eventPath(raw))+'.via'));
 // Provenance survives normalization even when another device has no local via
 // receipt. Maintenance names are local authority only on original home events.
 const own=raw=>!via.get(raw.id)&&originalHomeEvent(o,raw);
 const accepted=new Set();
 if(outgoing)for(const a of source.events){
  if(a.kind!=='accept'||!own(a)||!authors.includes(a.author)||local.has(a.id)||!await approved(entry.record,normalize(a,targetPage)))continue;
  const parent=byID.get(a.parent);if(!parent)continue;
  const threadGesture=conversationKinds.includes(parent.kind)&&!['proposal','reject','partial'].includes(parent.kind)&&compare(a.base)===compare(a.text);
  if(threadGesture||compare(a.text)===compare(parent.text)&&compare(a.text)===compare(current.text))accepted.add(parent.id);
 }
 const ancestors=raw=>{const chain=[],seen=new Set();let cursor=raw;while(cursor&&!seen.has(cursor.id)){seen.add(cursor.id);chain.push(cursor);cursor=byID.get(cursor.parent)??(cursor.thread!==cursor.id?byID.get(cursor.thread):null);}return chain;};
 function ownConversation(chain){
  const first=chain.filter(e=>conversationKinds.includes(e.kind)).at(-1);if(!first||!own(first))return false;
  const parent=byID.get(first.parent);return !first.parent||parent&&own(parent);
 }
 function conversationAllowed(raw){const chain=ancestors(raw);return chain.some(e=>accepted.has(e.id)||via.get(e.id)?.target===entry.record.target)||ownConversation(chain);}

 let remaining=[...source.events],progress=true;
 while(progress){progress=false;const next=[];for(const raw of remaining){
  if(raw.kind==='contribution_root'||raw.source==='discard'||local.has(raw.id))continue;
  const e=normalize(raw,targetPage);if(!e)continue;
  if(!ordinary(e)&&!((!outgoing||include_comments)&&conversationKinds.includes(e.kind)))continue;
  if(e.kind==='change'&&compare(e.base)===compare(e.text))continue;
  if(outgoing){
   if(known.has(e.id))continue;
   const released=await approved(entry.record,e);
   // A coordinated root may cut an old event whose two statements remain
   // visible as roots. Such a bridge still needs its own exact-byte release.
   if(entry.cut.has(e.id)&&!released)continue;
   const a=anchors(eligible,entry.root),texts=new Set(eligible.map(t=>compare(t.text))),bridge=texts.has(compare(e.base))&&texts.has(compare(e.text));
   if(!bridge&&(entry.cut.has(e.id)||!a.has(compare(e.base)))){next.push(raw);continue;}
   if(conversationKinds.includes(e.kind)){
    if(entry.cut.has(e.id))continue;
    if(!conversationAllowed(raw)){hold(e,'held_by_owner_chain');continue;}
   }else if(via.get(raw.id)?.target===entry.record.target)continue;
   else if(!own(raw)&&!accepted.has(raw.id)){
    // A superseded foreign statement stays private, but is not outstanding
    // work for the current authored choice. Conversations have their own gate.
    if(compare(e.text)===compare(current.text))hold(e,'held_by_owner_chain');continue;
   }
   if(e.kind==='accept'&&source.events.some(parent=>parent.id===e.parent&&!own(parent)&&(!conversationKinds.includes(parent.kind)||include_comments))&&!eligible.some(parent=>parent.id===e.parent)){next.push(raw);continue;}

   if(!released){hold(e,'contribution_review_pending');continue;}
   if(!ordinary(e)&&raw.parent&&byID.has(raw.parent)&&!accepted.has(raw.id)&&!eligible.some(parent=>parent.id===e.parent||parent.thread===e.thread)){next.push(raw);continue;}
  }
  events.push(e);eligible.push(e);known.add(e.id);progress=true;
 }remaining=next;}
 return {source,events,blocked};
}
async function canPublish(o,entry,text){
 if(entry.initial&&compare(text)===compare(entry.root.text))return await approved(entry.record,entry.root)&&await R().hash(transfer(text))===await R().hash(entry.root.text);
 const events=(await R().read(o.remote,entry.destination)).events;
 const covered=events.some(e=>ordinary(e)&&compare(e.text)===compare(text)),digest=await R().hash(transfer(text));
 // File authorization is checked separately from statement equality: block IDs,
 // spacing and metadata bytes belong to the approved transfer as well.
 return covered&&(entry.record.releases??[entry.record.release]).some(r=>r.target===entry.record.target&&equal(r.readers,entry.record.readers)&&r.text===digest);
}
async function finishRoot(o,entry){
 const changes=entry.record.identity_changes??[];
 if(changes.length){
  const digest=await R().hash(json(changes));need((entry.record.releases??[entry.record.release]).some(r=>r&&r.target===entry.record.target&&equal(r.readers,entry.record.readers)&&r.identities===digest),'contribution_review_pending');
  for(const {trace,event,path,redirect}of changes){
   clearance({trace,event,path,redirect},entry.destination);need(global.WikiContributionLifecycle.validateRekey(trace,[event]),'rekey_unverified');
   const tracePath=BASE+'/rekey/'+encodeURIComponent(trace.from)+'.json',oldTrace=await peek(o.remote,tracePath),oldRedirect=await peek(o.remote,path);
   need(!oldTrace||equal(JSON.parse(oldTrace.text),trace),'rekey_collision');need(!oldRedirect||equal(JSON.parse(oldRedirect.text),redirect),'rekey_collision');
   const prior=await peek(o.remote,await R().eventPath(event));need(!prior||equal(JSON.parse(prior.text),event),'rekey_collision');
   if(!prior)await R().append(o.remote,event);need(await R().receipt(o.remote,event),'contribution_record_unreadable');
   if(!oldTrace)await write(o.remote,tracePath,trace,null);if(!oldRedirect)await write(o.remote,path,redirect,null);
  }
 }
 if(!entry.initial){await sourceState(o,entry);return;}const file=await peek(o.remote,entry.destination);need(file&&compare(file.text)===compare(entry.root.text),'contribution_stale');
 const path=await R().eventPath(entry.root),known=await peek(o.remote,path);if(known)need(equal(JSON.parse(known.text),entry.root),'contribution_record_unreadable');else await R().append(o.remote,entry.root);
 need(await R().receipt(o.remote,entry.root),'contribution_record_unreadable');await sourceState(o,entry);
}
async function selectedAssets(o,selected,result){
 const candidates=new Map();for(const [page,entry]of selected){
  const own=await peek(o.work,page),remote=await peek(o.remote,entry.destination),local=own?await disclosures(o,page,transfer(own.text),entry.destination):{assets:[]},received=remote?await disclosures({...o,work:o.remote},entry.destination,transfer(remote.text),page):{assets:[]};
  const released=entry.record.releases??[entry.record.release],allowed=[];let reason=null;
  for(const asset of local.assets){if(!released.some(r=>r.target===entry.record.target&&equal(r.readers,entry.record.readers)&&r.assets.some(a=>a.path===asset.path&&a.digest===asset.digest))){reason='contribution_review_pending';break;}allowed.push({...asset,direction:'out'});}
  for(const asset of received.assets){const other=local.assets.find(a=>a.path===asset.path);if(other&&other.digest!==asset.digest){reason='asset_conflict';break;}allowed.push({...asset,direction:'in'});}
  if(reason){pending(result,page,reason);selected.delete(page);continue;}
  for(const asset of allowed){if(asset.text!==undefined)clearance(asset.text,asset.path);const previous=candidates.get(asset.path);if(previous&&previous.digest!==asset.digest){pending(result,page,'asset_conflict');selected.delete(page);break;}candidates.set(asset.path,{digest:asset.digest,directions:[...(previous?.directions??[]),asset.direction],page});}
 }
 for(const [path,asset]of candidates)if(!selected.has(asset.page))candidates.delete(path);
 return candidates;
}
global.WikiContributions={teamHome,review,confirm,folder,status,probe,platformGate,normalize,eventDigest,recordPath,files,readJSON,binding,transfer,compare,selectPages,preparePage,journalPlan,canPublish,finishRoot,approved,latestRoot,anchors,selectedAssets,assetDigest,resultState,replicaAt,displayState};
})(globalThis);
