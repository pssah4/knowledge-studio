/* IMP-06-07-05: guarded Markdown transfers between a wiki and its editable copy.
   Snapshots and immutable review events persist on disk. Explicit moves archive verified originals; detachment never deletes.
   Whole-file conflicts are preserved for an explicit decision; clocks never win.
   Entry points: run, resolve. See src/ARCHITECTURE.map. */
(function(global){
'use strict';
const F=()=>global.FolderAccess,R=()=>global.WikiReviews,K=()=>global.WikiContributions;
const MAX=2000000;
const statement=value=>(global.WikiCore?.statementText??global.statementText)(value);
const step=(o,key,fn,result)=>o.step?o.step(JSON.stringify(key),fn,result):fn();
const side=(o,dir)=>dir===o.work?"work":"remote";
function error(key){return global.I18n.error(global.I18n.message(key));}
// The same scanner is compiled into every runtime. It returns locations and
// kinds only: neither a diagnostic nor an exception contains the matched value.
function contentClearance(value,page=''){
 const findings=[],seen=new Set(),add=(code,field='')=>{const key=code+'|'+field;if(!seen.has(key)){seen.add(key);findings.push({code,page,...(field?{field}:{})});}};
 const secretKey=/^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwort|secret|geheimnis|credential|auth)$/i;
 const deviceKey=/^(?:device[_-]?id|machine[_-]?id|hostname|local[_-]?folder|runner|rechner)$/i;
 const name=v=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,40}$/.test(v);
 const secret=/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bxox[baprs]-[0-9A-Za-z-]{10,}|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[0-9A-Za-z]{20,}|\bsk-[0-9A-Za-z]{20,}|\bBearer\s+[0-9A-Za-z._~+/-]{20,}/;
 function inspect(v,field='',depth=0){
  if(depth>32){add('clearance_unreadable',field);return;}
  if(v&&typeof v==='object'){for(const [key,part]of Object.entries(v)){
   if(secretKey.test(key)&&part!==null&&part!==''&&!name(part))add('clearance_secret',key);
   if(deviceKey.test(key)&&part!==null&&part!=='')add('clearance_device',key);
   inspect(part,key,depth+1);
  }return;}
  if(typeof v!=='string')return;
  if(secret.test(v))add('clearance_secret',field);
  // URLs and relative document links do not disclose a local machine path.
  // Suspended compounds such as Prompt-/Model-/RAG-Änderungen are prose.
  // The boundary excludes tokens inside absolute/relative filesystem paths.
  // Symbolic home roots are portable prose, like relative document paths.
  // Normalize only their root for path detection; secret checks use the original.
  const paths=v.replace(/\bhttps?:\/\/[^\s<>"']+/gi,'').replace(/(?<![\w./~$])(?:~|\$HOME|\$\{HOME\})(?=\/)/g,'.').replace(/(?<![\p{L}\p{N}_/.~-])[\p{L}\p{N}][\p{L}\p{N}_-]*-\/(?:[\p{L}\p{N}][\p{L}\p{N}_-]*-\/)+[\p{L}\p{N}][\p{L}\p{N}_-]*/gu,'');
  if(/(?:^|[^\w./])\/(?:[\w.-]+\/)+[\w.-]+|(?:^|[^\w])[A-Za-z]:[\\/][\w.\\/-]+|(?:^|[^\w])~\/[\w.-]+/.test(paths))add('clearance_device_path',field);
  if(/^\s*[\[{]/.test(v))try{inspect(JSON.parse(v),field,depth+1);return;}catch{/* Ordinary prose is still scanned. */}
  if(/^---\r?\n/.test(v))try{
   const parsed=global.WikiCore?.parseDocument(v)??global.parseHead?.(v);
   if(parsed?.head)inspect(parsed.head,field,depth+1);
  }catch{add('clearance_unreadable',field);}
  for(const line of v.split(/\r?\n/)){
   const pair=/^\s*(?:-\s*)?([A-Za-z_][A-Za-z0-9_.-]*)\s*:\s*(.+?)\s*$/.exec(line);
   if(!pair)continue;const part=pair[2].replace(/^['"]|['"]$/g,'');
   if(secretKey.test(pair[1])&&!['null','~','[]','{}'].includes(part)&&!name(part))add('clearance_secret',pair[1]);
   if(deviceKey.test(pair[1])&&!['null','~',''].includes(part))add('clearance_device',pair[1]);
  }
 }
 inspect(value);return findings;
}
const textAsset=page=>/\.(svg|excalidraw)$/i.test(page);
const assetVisible=(path,kind)=>!path.split('/').some(p=>p.startsWith('.'))&&(kind==='directory'||/\.(png|jpe?g|gif|webp|avif|svg|pdf|excalidraw)$/i.test(path));
function transferVisible(page,kind){
 const roots=['.llmwiki/reviews','.llmwiki/evidence','.llmwiki/shadow/changes','.llmwiki/shadow/pins','.llmwiki/path-aliases','.llmwiki/transfers','.llmwiki/retirements','.llmwiki/contributions/from'];
 return visible(page,kind)||(assetVisible(page,kind)&&(kind==='directory'||textAsset(page)))||(kind==='directory'&&roots.some(r=>r===page||r.startsWith(page+'/')||page.startsWith(r+'/')))||
  (kind==='file'&&page.endsWith('.json')&&(page==='.llmwiki/identity-aliases.json'||roots.some(r=>page.startsWith(r+'/'))));
}
async function checkClearance(dir,o=null){
 const findings=[];
 async function walk(folder,prefix=''){for await(const entry of folder.values()){
  const page=prefix?prefix+'/'+entry.name:entry.name;if(!transferVisible(page,entry.kind))continue;
  if(entry.kind==='directory')await walk(entry,page);
  else if(entry.kind==='file'){const inspect=async()=>{const file=await peek(dir,page);return file?contentClearance(file.text,page):[];};findings.push(...(o?await step(o,['clearance',side(o,dir),page],inspect):await inspect()));}
 }}
 await walk(dir);
 return findings;
}
function requireClearance(findings){if(!findings.length)return;const e=error('Synchronization paused by content clearance. Review the reported document and history findings, preserve originals, then start a fresh sync after resolving them.');e.code='clearance';e.details={findings,operation:'sync',permanent:false,local_review:'check_existing_working_copy',recovery:'resolve_findings_then_fresh_sync'};throw e;}
function visible(path,kind){return !path.split('/').some(p=>p.startsWith('.')||['notices','vermerke'].includes(p))&&(kind==='directory'||path==='schema/FIELDS.json'||/\.md$/i.test(path));}
async function peek(dir,path){try{return await F().readFile(dir,path);}catch(e){if(e.name==='NotFoundError')return null;throw e;}}
function text(seen){return seen?seen.text:null;}
async function guarded(o,dir,path,value,seen){
  if(!o.alive())throw error('The folder was disconnected.');
  requireClearance(contentClearance(value,path));
  const done=await F().writeFile(dir,path,value,seen);
  if(!done.saved)throw error('The file changed during synchronization. It will be checked again.');
  return done;
}
async function statePath(o,page){return '.llmwiki/editor-sync/'+await R().hash(o.identity)+'/'+await R().hash(page)+'.json';}
async function baseline(o,page){
  const path=await statePath(o,page),seen=await peek(o.work,path);let data=null;
  if(seen){data=JSON.parse(seen.text);if(data.format!=='llmwiki-editor-sync/1'||data.page!==page||data.identity!==o.identity||!(data.text===null||typeof data.text==='string'&&data.text.length<=MAX))throw error('The synchronization record cannot be read.');}
  return {path,seen,data};
}
async function record(o,b,page,value,resolved=false,discard=null){return guarded(o,o.work,b.path,JSON.stringify({format:'llmwiki-editor-sync/1',identity:o.identity,page,text:value,resolved,...(discard?{discard}:{})}),b.seen);}
async function covered(dir,page,value){
 if(value===null)return false;const wanted=statement(value);
 return (await R().read(dir,page)).events.some(e=>['change','accept','contribution_root'].includes(e.kind)&&(e.norm===1?K().compare(e.text)===K().compare(value):statement(e.text)===wanted));
}
async function observeExternal(o,page,base,value){
 const existing=(await R().read(o.work,page)).events.find(e=>e.kind==='external'&&e.base===(base??'')&&e.text===value);
 if(existing)return existing;
 const e=R().event({kind:'external',page,author:'',base:base??'',text:value});await R().append(o.work,e);return e;
}
// The decision is device-local. Its event belongs to the remote journal and is
// evidence only after the exact replacement has completed and received a receipt.
async function discardRemote(o,b,page,mine,theirs,result){
 const d=b.data.discard,e=d.event;
 if(!R().valid(e)||e.source!=='discard'||e.page!==page||typeof d.statement_sha256!=='string')throw error('The synchronization record cannot be read.');
 async function expired(){
  await record(o,b,page,b.data.text);
  result.conflicts.push({page,reason:'discard_stale',base:b.data.text,mine:text(await peek(o.work,page)),theirs:text(await peek(o.remote,page))});
 }
 const path=await R().eventPath(e),known=await peek(o.remote,path);
 if(known&&JSON.stringify(JSON.parse(known.text))!==JSON.stringify(e))throw error('The synchronization record cannot be read.');
 if(known&&mine===e.text&&theirs===e.text&&o.canPublish){
  if(!await R().receipt(o.remote,e))throw error('The synchronization record cannot be read.');
  await record(o,b,page,e.text);return;
 }
 if(mine!==e.text||theirs!==e.base||await R().hash(statement(theirs))!==d.statement_sha256||await covered(o.remote,page,theirs)){await expired();return;}
 if(!o.canPublish){result.pending++;result.pending_details.push({page,reason:'read_only'});return;}
 if(!known)await R().append(o.remote,e);
 // An author record can arrive independently of the unchanged Markdown file.
 const remote=await peek(o.remote,page);
 if(text(remote)!==e.base||text(await peek(o.work,page))!==e.text||await covered(o.remote,page,e.base)){await expired();return;}
 await guarded(o,o.remote,page,e.text,remote);
 if(!await R().receipt(o.remote,e))throw error('The synchronization record cannot be read.');
 await record(o,b,page,e.text);result.published++;
}
async function journal(o,from,to,page,contribution=null){
  if(contribution){
    const outgoing=from===o.work,plan=await K().journalPlan(o,contribution,outgoing),targetPage=outgoing?contribution.destination:page;
    const found=new Map((await R().read(to,targetPage)).events.map(e=>[e.id,e]));
    for(const e of plan.events){
      requireClearance(contentClearance(e,targetPage));const known=found.get(e.id);
      if(known&&await K().eventDigest(K().normalize(known,targetPage))!==await K().eventDigest(e))throw error('The synchronization record cannot be read.');
      if(!known)await R().append(to,e);
      if(!known&&['change','accept'].includes(e.kind)&&!await R().receipt(to,e))throw error('The synchronization record cannot be read.');
      if(!outgoing&&!known){const viaPath=await R().eventPath(e)+'.via',via=await peek(to,viaPath);if(!via)await guarded(o,to,viaPath,JSON.stringify({target:contribution.record.target,owner:contribution.record.owner,event:e.id}),null);}
    }
    return plan.source;
  }
  const source=await R().read(from,page),target=await R().read(to,page);
  const found=new Map([...target.events,...target.pending].map(e=>[e.id,e]));
  for(const e of source.events){
    if(!o.alive())throw error('The folder was disconnected.');
    requireClearance(contentClearance(e,page));
    const known=found.get(e.id);
    if(known&&JSON.stringify(known)!==JSON.stringify(e))throw error('The synchronization record cannot be read.');
    if(!known)await R().append(to,e);
    if(['change','accept','contribution_root'].includes(e.kind)&&!await R().receipt(to,e))throw error('The synchronization record cannot be read.');
  }
  return source;
}
async function transferable(dir,page,base,value){
  const events=(await R().read(dir,page)).events,queue=[value],visited=new Set();
  while(queue.length){
    const cursor=queue.pop();if(cursor===(base??''))return true;
    if(visited.has(cursor))continue;visited.add(cursor);
    // A deliberate restoration can equal an older saved text. Follow every
    // witnessed predecessor; choosing the first match loses the current chain.
    for(const e of events)if(['change','accept'].includes(e.kind)&&e.text===cursor&&e.text!==e.base)queue.push(e.base);
  }
  return false;
}
async function evidence(o,from,to){
  let root;try{root=await from.getDirectoryHandle('.llmwiki');root=await root.getDirectoryHandle('evidence');}catch(e){if(e.name==='NotFoundError')return;throw e;}
  async function walk(dir,path){for await(const entry of dir.values()){
    const name=path+'/'+entry.name;
    if(entry.kind==='directory'){await walk(entry,name);continue;}
    if(!entry.name.endsWith('.json'))continue;
    await step(o,['evidence',side(o,from),name],async()=>{
     const source=await peek(from,name),target=await peek(to,name);
     if(target){if(target.text!==source.text)throw error('The synchronization record cannot be read.');return;}
     await guarded(o,to,name,source.text,null);
    });
  }}
  await walk(root,'.llmwiki/evidence');
}
async function shadowEvidence(o,from,to){
 for(const kind of ['changes','pins']){
  let root;try{root=await from.getDirectoryHandle('.llmwiki');root=await root.getDirectoryHandle('shadow');root=await root.getDirectoryHandle(kind);}catch(e){if(e.name==='NotFoundError')continue;throw e;}
  for await(const entry of root.values()){
   await step(o,['shadow',side(o,from),kind,entry.name],async()=>{
   if(entry.kind!=='file'||!/^[a-f0-9]{64}\.json$/.test(entry.name))throw error('The synchronization record cannot be read.');
    const name='.llmwiki/shadow/'+kind+'/'+entry.name,source=await peek(from,name);
    if(!source||source.text.length>MAX||await R().hash(source.text)!==entry.name.slice(0,-5))throw error('The synchronization record cannot be read.');
    const data=JSON.parse(source.text);if(!(data.format==='llmwiki-shadow/1'||kind==='changes'&&data.format==='llmwiki-shadow-identities/2')||data.kind!==(kind==='pins'?'quote':'identities'))throw error('The synchronization record cannot be read.');
    const target=await peek(to,name);if(target){if(target.text!==source.text)throw error('The synchronization record cannot be read.');return;}
    await guarded(o,to,name,source.text,null);
   });
  }
 }
}
async function sharedRecords(o,from,to,kind){
 let root;try{root=await from.getDirectoryHandle('.llmwiki');root=await root.getDirectoryHandle(kind);}catch(e){if(e.name==='NotFoundError')return;throw e;}
 for await(const entry of root.values()){
  await step(o,['records',side(o,from),kind,entry.name],async()=>{
   if(entry.kind!=='file'||!/^[a-f0-9]{64}\.json$/.test(entry.name))throw error('The synchronization record cannot be read.');const page='.llmwiki/'+kind+'/'+entry.name,source=await peek(from,page);
   if(!source||await R().hash(source.text)!==entry.name.slice(0,-5))throw error('The synchronization record cannot be read.');const data=JSON.parse(source.text);if(data.format!==(kind==='transfers'?'llmwiki-transfer/1':'llmwiki-retirement/1'))throw error('The synchronization record cannot be read.');const target=await peek(to,page);if(target&&target.text!==source.text)throw error('The synchronization record cannot be read.');if(!target)await guarded(o,to,page,source.text,null);
  });
 }
}
async function contributionStates(o){
 // Target-maintained source status is read by the operator's work copy. Local
 // work records are never authoritative and never travel in the reverse direction.
 for(const kind of ['from','handover','retired','rekey'])for(const page of await K().files(o.remote,'.llmwiki/contributions/'+kind)){
  if(!page.endsWith('.json'))continue;
  await step(o,['contribution_state',page],async()=>{
   const source=await peek(o.remote,page),target=await peek(o.work,page);if(!source||source.text===target?.text)return;
   JSON.parse(source.text);await guarded(o,o.work,page,source.text,target);
  });
 }
}
async function retireGroups(o,result){
 const records=new Map(),skip=new Set();for(const dir of [o.work,o.remote]){let root;try{root=await dir.getDirectoryHandle('.llmwiki');root=await root.getDirectoryHandle('retirements');}catch(e){if(e.name==='NotFoundError')continue;throw e;}for await(const e of root.values()){if(e.kind!=='file')continue;const f=await peek(dir,'.llmwiki/retirements/'+e.name),r=JSON.parse(f.text);if(r.format!=='llmwiki-retirement/1'||typeof r.page!=='string'||r.page.split('/').some(p=>!p||p==='.'||p==='..')||/[\\:\x00-\x1f]/.test(r.page)||!/^[a-f0-9]{64}$/.test(r.expected)||!/^[a-f0-9-]{36}$/.test(r.stage))throw error('The synchronization record cannot be read.');records.set(e.name,r);}}
 for(const r of records.values()){
  const local=await peek(o.work,r.page),remote=await peek(o.remote,r.page),files=[local,remote],hashes=await Promise.all(files.map(f=>f?R().hash(f.text):null));
  if(hashes.every(h=>h!==null&&h!==r.expected))continue;
  if(hashes.some(h=>h!==null&&h!==r.expected)){if(hashes.some(h=>h===r.expected)){skip.add(r.page);result.conflicts.push({page:r.page,reason:'retirement_changed',base:null,mine:text(local),theirs:text(remote)});}continue;}
  skip.add(r.page);let pending=false;for(const [i,dir]of [o.work,o.remote].entries()){
   if(!files[i])continue;const archive='.llmwiki/retired/'+r.stage+'/'+r.page;
   if(i===1&&!o.canPublish||!F().archiveFile||F().canArchive&&!F().canArchive(dir)){pending=true;result.pending++;result.pending_details.push({page:r.page,reason:'host_move_required',archive,expected:r.expected});continue;}
   await F().archiveFile(dir,r.page,archive,r.expected);
  }
  if(!pending)await record(o,await baseline(o,r.page),r.page,null);
 }
 return skip;
}
async function moveAliases(o,result){
 const all=new Map();for(const dir of [o.remote,o.work]){
  let root;try{root=await dir.getDirectoryHandle('.llmwiki');root=await root.getDirectoryHandle('path-aliases');}catch(e){if(e.name==='NotFoundError')continue;throw e;}
  for await(const file of root.values())if(file.kind==='file'&&file.name.endsWith('.json')){
   const path='.llmwiki/path-aliases/'+file.name,seen=await peek(dir,path),data=JSON.parse(seen.text);
   if(typeof data.from!=='string'||typeof data.to!=='string'||!data.expected||data.from===data.to)throw error('The synchronization record cannot be read.');
   const known=all.get(data.from);if(known&&known.seen.text!==seen.text)throw error('The synchronization record cannot be read.');all.set(data.from,{data,seen,path});
  }
 }
 for(const {data,seen,path}of all.values())for(const dir of [o.work,...(o.canPublish?[o.remote]:[])]){
  const prior=await peek(dir,path);if(!prior)await guarded(o,dir,path,seen.text,null);
 }
 return all;
}
async function identityAliases(o,aliases){
 const path='.llmwiki/identity-aliases.json',merged=new Map();
 function target(p){const seen=new Set();while(aliases.has(p)){if(seen.has(p))throw error('The synchronization record cannot be read.');seen.add(p);p=aliases.get(p).data.to;}return p;}
 for(const dir of [o.remote,o.work]){const file=await peek(dir,path);if(!file)continue;const data=JSON.parse(file.text);if(data.format!=='llmwiki-identity-aliases/1'||!Array.isArray(data.aliases))throw error('The synchronization record cannot be read.');for(const alias of data.aliases){const value={...alias,path:target(alias.path)},previous=merged.get(alias.id);if(previous&&JSON.stringify(previous)!==JSON.stringify(value))throw error('The synchronization record cannot be read.');merged.set(alias.id,value);}}
 if(!merged.size)return;const text=JSON.stringify({format:'llmwiki-identity-aliases/1',aliases:[...merged.values()].sort((a,b)=>a.id.localeCompare(b.id))});for(const dir of [o.work,...(o.canPublish?[o.remote]:[])]){const seen=await peek(dir,path);if(seen?.text!==text)await guarded(o,dir,path,text,seen);}
}
async function retireMoves(o,result,aliases){
 for(const {data}of aliases.values())for(const dir of [o.work,...(o.canPublish?[o.remote]:[])]){
  const old=await peek(dir,data.from);if(!old)continue;
  const next=await peek(dir,data.to);
  if(!next||await R().hash(old.text)!==data.expected){result.conflicts.push({page:data.from,base:null,mine:text(await peek(o.work,data.from)),theirs:text(await peek(o.remote,data.from)),move_to:data.to});continue;}
  if(!F().archiveFile||(F().canArchive&&!F().canArchive(dir))){result.pending++;result.pending_details.push({page:data.from,reason:'host_move_required',to:data.to,archive:'.llmwiki/moves/'+data.id+'/synced-originals/'+data.from,expected:data.expected});continue;}
  if(!o.alive())return;
  await F().archiveFile(dir,data.from,'.llmwiki/moves/'+data.id+'/synced-originals/'+data.from,data.expected);
 }
}
const binaryChecks=new WeakMap();
async function binaryAssets(o,result){
 const allowed=(page,kind)=>o.assetSelection?kind==='directory'||o.assetSelection.has(page):assetVisible(page,kind);
 const lists=await Promise.all([F().listFolder(o.work,undefined,{visible:allowed}),F().listFolder(o.remote,undefined,{visible:allowed})]);
 let cache=binaryChecks.get(o.work);if(!cache){cache=new Map();binaryChecks.set(o.work,cache);}
 const inventory=lists.map(items=>new Map(items.map(f=>[f.name,f])));
 const peek=async(dir,page)=>{try{return await F().readBinary(dir,page);}catch(e){if(e.name==='NotFoundError')return null;throw e;}};
 for(const page of new Set(lists.flat().map(f=>f.name))){
  await step(o,['asset',page],async()=>{
   if(!o.alive())return;
   if(!F().readBinary||!F().writeBinary){result.pending++;result.pending_details.push({page,reason:'binary_capability_required'});return;}
   const info=inventory.map(items=>items.get(page)),cacheable=info.every(f=>f&&Number.isFinite(f.at)&&Number.isFinite(f.size)),signature=cacheable?JSON.stringify(info.map(f=>[f.at,f.size])):null,key=o.identity+'/'+page,known=cache.get(key);
   if(!o.assetSelection&&signature&&known?.signature===signature&&Date.now()-known.at<60000)return;
   cache.delete(key);
   const local=await peek(o.work,page),remote=await peek(o.remote,page);
   if(local?.sha256===remote?.sha256){if(signature)cache.set(key,{signature,at:Date.now()});return;}
   if(local&&remote){result.pending++;result.pending_details.push({page,reason:'asset_conflict',local:local.sha256,remote:remote.sha256});return;}
   if(!remote&&!o.canPublish){result.pending++;result.pending_details.push({page,reason:'asset_publication_pending'});return;}
   const source=local||remote,target=local?o.remote:o.work;
   if(o.assetSelection){const approval=o.assetSelection.get(page);if(!approval?.directions.includes(local?'out':'in')||approval.digest!==await K().assetDigest(source))throw Object.assign(error('The file changed during synchronization. It will be checked again.'),{code:'contribution_review_stale'});}
   if(textAsset(page))requireClearance(contentClearance(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(source.bytes),page));
   const done=await F().writeBinary(target,page,source.bytes,null);
   if(!done.saved)throw error('The file changed during synchronization. It will be checked again.');
   if(local)result.published++;else result.copied++;
  },result);
 }
}
async function attributeOwn(o,result){
 const meta=o.contributionMeta,by=meta?.author,circle=meta?.owner?.work_readers;
 // connectionMeta only declares this author after checking the single work
 // writer and both effective reader declarations. Missing legacy answers opt out.
 if(o.scope==='participation'||typeof by!=='string'||!by.trim()||!Array.isArray(circle)||circle.length!==1||circle[0]!==by)return;
 const value=o.ownerRemote??meta.owner.wiki,home=value?(F().asDirectory?F().asDirectory(value):value):null;
 const form=value=>global.WikiCore.compareForm(value),unwitnessedRoot=j=>j.pending.some(e=>e.kind==='contribution_root'||e.source==='contribution_root');
 for(const {name:page}of await F().listFolder(o.work,undefined,{visible})){
  if(!/\.md$/i.test(page))continue;
  await step(o,['attribute_own',page],async()=>{
   if(!o.alive())return;const file=await peek(o.work,page);if(!file||file.text.length>MAX)return;
   const head=global.WikiCore.parseDocument(file.text).head,j=await R().read(o.work,page);
   if(head.llmwiki_redirect||unwitnessedRoot(j)||await K().replicaAt(o.work,page)||(meta.subscribed_ids??[]).includes(head.id))return;
   const localHome=home?R().currentPage(await R().aliases(home),page):null,homeFile=home?await peek(home,localHome):null,homeJournal=home?await R().read(home,localHome):null;
   if(home&&(unwitnessedRoot(homeJournal)||await K().replicaAt(home,localHome)))return;
   const coveredHere=j.events.some(e=>['change','accept'].includes(e.kind)&&form(e.text)===form(file.text));if(coveredHere)return;
   let remotePage=page;
   if(o.scope==='contributions'&&head.id){const record=await K().readJSON(o.work,await K().recordPath(head.id,meta.target.bundle_id));remotePage=R().currentPage(await R().aliases(o.remote),record?.destination??'wiki/'+page.split('/').at(-1));}
   // Matching bytes of an uncovered shared change are not proof of local
   // authorship, even if an external editor also put them in the work folder.
   for(const [dir,path,seen,journal]of [[o.remote,remotePage,null,null],...(home?[[home,localHome,homeFile,homeJournal]]:[])]){
    const shared=seen??await peek(dir,path);if(!shared||form(shared.text)!==form(file.text))continue;
    const events=journal?.events??(await R().read(dir,path)).events;
    if(!events.some(e=>['change','accept','contribution_root'].includes(e.kind)&&form(e.text)===form(shared.text)))return;
   }
   const previous=j.events.filter(e=>['change','accept'].includes(e.kind)&&e.source!=='discard').at(-1),b=await baseline(o,page);
   const base=previous?(previous.norm===1?global.WikiCore.composeHome(previous.text,file.text):previous.text):b.data?.text??'';
   const done=await R().attributeOwn(o.work,page,file,base,by);
   if(!done.saved||!done.recorded){result.pending++;result.pending_details.push({page,reason:'attribution_pending'});return;}
   (result.attributed??=[]).push({page,event:done.event.id,source:'editor_unknown',author:by});
  },result);
 }
}
async function run(options){
  const o={alive:()=>true,...options},result={copied:0,published:0,pending:0,pending_details:[],conflicts:[]};
  if(!o.alive())return result;
  if(o.work.isSameEntry&&await o.work.isSameEntry(o.remote))throw error('The shared wiki and working folder must be separate.');
  await global.WikiContributionLifecycle?.observeTakeovers(o,result);
  await attributeOwn(o,result);
  const selective=o.scope==='contributions',participation=o.scope==='participation',selected=selective?await K().selectPages(o,result):null;
  if(participation)o.canPublish=false;
  const view=participation?await global.WikiParticipationSync.selection(o,result):null;
  if(selective){
    for(const [page,entry] of selected){const prepared=await K().preparePage(o,entry,result);if(!prepared){selected.delete(page);continue;}selected.set(page,prepared);
      for(const [dir,name]of [[o.work,page],[o.remote,entry.destination]]){const file=await peek(dir,name);if(file)requireClearance(contentClearance(K().transfer(file.text),name));}
      try{
       for(const outgoing of [false,true])if(!outgoing||o.canPublish)for(const e of (await K().journalPlan(o,prepared,outgoing)).events)requireClearance(contentClearance(e,e.page));
      }catch(e){
       if(e.code!=='journal_norm_outdated')throw e;
       result.pending++;result.pending_details.push({page,reason:e.code});selected.delete(page);
      }
    }
    o.assetSelection=await K().selectedAssets(o,selected,result);await binaryAssets(o,result);
  }else if(participation){for(const page of view.selected.keys()){const file=await peek(o.remote,page);if(file)requireClearance(contentClearance(file.text,page));}}else requireClearance([...(await checkClearance(o.remote,o)),...(o.canPublish?await checkClearance(o.work,o):[])]);
  let retired=new Set(),aliases=new Set(),pages;
  if(!selective&&!participation){
  await binaryAssets(o,result);
  await evidence(o,o.remote,o.work);if(o.canPublish)await evidence(o,o.work,o.remote);
  await contributionStates(o);
  await shadowEvidence(o,o.remote,o.work);if(o.canPublish)await shadowEvidence(o,o.work,o.remote);
  for(const kind of ['transfers','retirements']){await sharedRecords(o,o.remote,o.work,kind);if(o.canPublish)await sharedRecords(o,o.work,o.remote,kind);}
  retired=await step(o,['retire_groups'],()=>retireGroups(o,result),result);
  aliases=await moveAliases(o,result);await identityAliases(o,aliases);
  const [local,remote]=await Promise.all([F().listFolder(o.work,undefined,{visible}),F().listFolder(o.remote,undefined,{visible})]);
  pages=new Map([...local,...remote].map(f=>[f.name,f]));
  }else pages=participation?view.selected:selected;
  for(const [page,entry] of pages){
    if(!o.alive())break;
    await step(o,['page',page],async()=>{
     if(aliases.has(page)||retired.has(page))return;
     if(entry.size>MAX){result.pending++;result.pending_details.push({page,reason:'size_limit'});return;}
     const contribution=selective?entry:null,remotePage=contribution?.destination??page;
     const form=value=>value===null||value===undefined?value:selective?K().transfer(value):value;
     const same=(a,b)=>a===null||a===undefined||b===null||b===undefined?a===b:selective?K().compare(a)===K().compare(b):a===b;
     const b=await baseline(o,page),l=await peek(o.work,page),r=await peek(o.remote,remotePage),mine=form(text(l)),theirs=form(text(r));
     if((mine!==null&&mine.length>MAX)||(theirs!==null&&theirs.length>MAX)){result.pending++;result.pending_details.push({page,reason:'size_limit'});return;}
     await journal(o,o.remote,o.work,page,contribution);
     if(o.canPublish)await journal(o,o.work,o.remote,page,contribution);
     if(participation){
       if(mine!==theirs){
         if(mine!==null&&(!b.data||mine!==b.data.text)){result.conflicts.push({page,reason:'participation_local_change',base:b.data?.text??null,mine,theirs});return;}
         if(text(await peek(o.remote,remotePage))!==text(r))throw error('The file changed during synchronization. It will be checked again.');
         await guarded(o,o.work,page,theirs,l);result.copied++;
       }
       await record(o,b,page,theirs);return;
     }
     const display=contribution?await K().displayState(o,contribution):null;
     if(display?.pending){result.pending++;result.pending_details.push({page,reason:'contribution_display_review_pending'});}
     if(b.data?.discard){if(contribution)await contributionDiscard(o,b,contribution,result);else await discardRemote(o,b,page,mine,theirs,result);return;}
     if(same(mine,theirs)){
       if(contribution&&o.canPublish){
         if(!display.pending&&r){
           const marker=global.WikiCore.parseDocument(r.text).head.shared_copy,previous=marker??{},updated=global.WikiCore.compose(mine,{...display.display,pushed_by:previous.pushed_by??display.display.pushed_by,pushed_at:previous.pushed_at??display.display.pushed_at},r.text);
           if(updated!==r.text){
             await guarded(o,o.remote,remotePage,updated,r);
             if(!marker)(result.findings??=[]).push({code:'marker_removed',page,destination:remotePage,document:contribution.record.document,target:contribution.record.target,repaired:true});
           }
         }
         await K().finishRoot(o,contribution);
       }
       if(!b.data||b.data.text!==mine||b.data.resolved)await record(o,b,page,mine);
       return;
     }
     const base=b.data?.text;
     const remoteCovered=contribution?(await R().read(o.remote,remotePage)).events.some(e=>['change','accept','contribution_root'].includes(e.kind)&&same(e.text,theirs)):await covered(o.remote,page,theirs);
     if(theirs!==null&&(!b.data||!same(theirs,base))&&!remoteCovered){
       const external=await observeExternal(o,page,base,theirs);
       result.conflicts.push({page,reason:'uncovered_remote_change',base:base??null,mine:selective?text(l):mine,theirs:selective?text(r):theirs,...(selective?{destination:remotePage}:{}),external:external.id,statement_sha256:await R().hash(statement(theirs))});return;
     }
     // Receive a new page or a remote change when the saved working file is clean.
     if((!b.data&&mine===null&&theirs!==null)||(b.data&&same(mine,base)&&theirs!==null)){
       if(text(await peek(o.remote,remotePage))!==text(r))throw error('The file changed during synchronization. It will be checked again.');
       if(contribution&&K().teamHome(o)){result.pending++;result.pending_details.push({page,reason:'team_acceptance_pending'});return;}
       const incoming=selective?global.WikiCore.composeHome(theirs,text(l)):theirs;
       await guarded(o,o.work,page,incoming,l);await record(o,b,page,theirs);result.copied++;return;
     }
     // Publishing requires an exact author chain, or an explicit conflict decision.
     const remoteClean=contribution?.initial?(theirs===null||same(theirs,contribution.root.text)):b.data?same(theirs,base):theirs===null;
     if(remoteClean&&mine!==null){
       if(!o.canPublish){result.pending++;result.pending_details.push({page,reason:'read_only'});return;}
       if(contribution){if(!await K().canPublish(o,contribution,mine)){result.pending++;result.pending_details.push({page,reason:'contribution_review_pending'});return;}}
       else if(!(b.data?.resolved)||theirs!==base){
         if(!await transferable(o.work,page,theirs,mine)){result.pending++;result.pending_details.push({page,reason:'author_chain_missing',base:base??null,mine,theirs});return;}
       }
       if(text(await peek(o.work,page))!==text(l))throw error('The file changed during synchronization. It will be checked again.');
       const outgoing=selective?global.WikiCore.compose(mine,{...display.display,pushed_at:new Date().toISOString()}):mine;
       await guarded(o,o.remote,remotePage,outgoing,r);if(contribution)await K().finishRoot(o,contribution);await record(o,b,page,mine);result.published++;return;
     }
     result.conflicts.push({page,base:base??null,mine:selective?text(l):mine,theirs:selective?text(r):theirs,...(selective?{destination:remotePage}: {})});
    },result);
  }
  if(!selective&&!participation)await step(o,['retire_moves'],()=>retireMoves(o,result,aliases),result);
  if(selective)await K().resultState(o,selected,result);
  if(participation)await global.WikiParticipationSync.finish(o,view,result);
  return result;
}
async function contributionDiscard(o,b,entry,result){
 const d=b.data.discard,e=d.event,page=entry.name,destination=entry.destination;
 if(!R().valid(e)||e.source!=='discard'||e.page!==destination||d.contribution!==destination)throw error('The synchronization record cannot be read.');
 const l=await peek(o.work,page),r=await peek(o.remote,destination),mine=l?K().transfer(l.text):null,theirs=r?K().transfer(r.text):null;
 const known=await peek(o.remote,await R().eventPath(e));
 if(known&&JSON.stringify(JSON.parse(known.text))!==JSON.stringify(e))throw error('The synchronization record cannot be read.');
 if(known&&mine===e.text&&theirs===e.text&&o.canPublish){if(!await R().receipt(o.remote,e))throw error('The synchronization record cannot be read.');await record(o,b,page,e.text);return;}
 const isCovered=async()=> (await R().read(o.remote,destination)).events.some(v=>['change','accept'].includes(v.kind)&&K().compare(v.text)===K().compare(e.base));
 if(!o.canPublish){result.pending++;result.pending_details.push({page,reason:'read_only'});return;}
 if(mine!==e.text||!r||await R().hash(r.text)!==d.expected||await isCovered()){
  await record(o,b,page,b.data.text);result.conflicts.push({page,destination,reason:'discard_stale',base:b.data.text,mine:text(l),theirs:text(r)});return;
 }
 requireClearance(contentClearance(e,destination));if(!known)await R().append(o.remote,e);
 if(text(await peek(o.work,page))!==text(l)||text(await peek(o.remote,destination))!==text(r)||await isCovered())throw error('The file changed again. Reopen the comparison before deciding.');
 const outgoing=global.WikiCore.compose(e.text,{owner:entry.record.owner,also_in:[],pushed_by:e.author,pushed_at:e.at});
 await guarded(o,o.remote,destination,outgoing,r);if(!await R().receipt(o.remote,e))throw error('The synchronization record cannot be read.');await record(o,b,page,e.text);result.published++;
}
async function resolveContribution(options,conflict,value,by,message,choice){
 const o={alive:()=>true,...options},result={pending:0,pending_details:[],conflicts:[]},selected=await K().selectPages(o,result),entry=selected.get(conflict.page);
 if(!entry||!await K().preparePage(o,entry,result))throw Object.assign(error('The contribution changed. Review its current state.'),{code:result.pending_details[0]?.reason??'contribution_review_stale'});
 const page=entry.name,destination=entry.destination,l=await peek(o.work,page),r=await peek(o.remote,destination);
 if(!o.alive()||text(l)!==conflict.mine||text(r)!==conflict.theirs||conflict.destination!==destination)throw error('The file changed again. Reopen the comparison before deciding.');
 if(choice==='leave')return {left:true};
 if(!by||typeof by!=='string')throw Object.assign(error('Declare the person making this decision.'),{code:'contribution_author_required'});
 const b=await baseline(o,page),mine=l?K().transfer(l.text):null,theirs=r?K().transfer(r.text):null;
 const remoteCovered=async()=> (await R().read(o.remote,destination)).events.some(e=>['change','accept','contribution_root'].includes(e.kind)&&K().compare(e.text)===K().compare(theirs));
 if(conflict.reason==='uncovered_remote_change'){
  if(!r||await remoteCovered())throw error('The file changed again. Reopen the comparison before deciding.');
  const external=(await R().read(o.work,page)).events.find(e=>e.id===conflict.external&&e.kind==='external'&&e.text===theirs);
  if(!external||await R().hash(statement(theirs))!==conflict.statement_sha256)throw error('The file changed again. Reopen the comparison before deciding.');
  choice??=value===conflict.theirs?'adopt':value===conflict.mine?'discard':null;
  if(choice==='discard'){
   const released=(entry.record.releases??[]).filter(Boolean),approved=mine!==null&&released.some(v=>v.target===entry.record.target&&v.text);
   const digest=mine===null?null:await R().hash(mine),rootApproved=mine!==null&&K().compare(mine)===K().compare(entry.record.root.text)&&await K().approved(entry.record,entry.record.root);
   if(!o.canPublish||!approved||!released.some(v=>v.text===digest)||!rootApproved&&!await K().canPublish(o,entry,mine))throw Object.assign(error('Review the exact contribution before restoring it.'),{code:'contribution_review_pending'});
   const event=R().event({kind:'change',page:destination,author:by,base:theirs,text:mine,message,norm:1});event.source='discard';event.discards=external.id;requireClearance(contentClearance(event,destination));
   await record(o,b,page,b.data?.text??conflict.base??null,false,{event,contribution:destination,expected:await R().hash(r.text),statement_sha256:conflict.statement_sha256});return {discarded:true,pending:true};
  }
  if(choice!=='adopt')throw error('Choose a version to keep. No file will be deleted.');
  const event=R().event({kind:'change',page,author:by,base:b.data?.text??'',text:theirs,message});event.source='outside_process';requireClearance(contentClearance(event,page));
  await R().append(o.work,event);await guarded(o,o.work,page,global.WikiCore.composeHome(theirs,l?.text??''),l);if(!await R().receipt(o.work,event))throw error('The synchronization record cannot be read.');await record(o,b,page,theirs);return {adopted:true,event};
 }
 if(typeof value!=='string'||value.length>MAX)throw error('Choose a version to keep. No file will be deleted.');
 const chosen=K().transfer(value),event=R().event({kind:'change',page,author:by,base:theirs??'',text:chosen,message}),events=[event];
 // A second target can have supplied the current home statement. The explicit
 // decision witnesses both transitions; neither imports that target's authors
 // or bypasses the later exact contribution review for either destination.
 if(mine!==null&&K().compare(mine)!==K().compare(theirs??'')&&K().compare(mine)!==K().compare(chosen))events.push(R().event({kind:'change',page,author:by,base:mine,text:chosen,message}));
 for(const decision of events)requireClearance(contentClearance(decision,page));
 for(const decision of events)await R().append(o.work,decision);
 await guarded(o,o.work,page,global.WikiCore.composeHome(chosen,l?.text??''),l);for(const decision of events)if(!await R().receipt(o.work,decision))throw error('The synchronization record cannot be read.');
 await record(o,b,page,theirs);return {resolved:true,event,events,next:'contribute.review',reason:'contribution_review_pending'};
}
async function resolve(options,conflict,value,by,message='',choice=null){
  if(options.scope==='contributions')return resolveContribution(options,conflict,value,by,message,choice);
  if(options.scope==='participation')throw Object.assign(error('The participation view is read-only.'),{code:'read-only'});
  const o={alive:()=>true,...options},l=await peek(o.work,conflict.page),r=await peek(o.remote,conflict.page);
  if(!o.alive())throw error('The folder was disconnected.');
  if(text(l)!==conflict.mine||text(r)!==conflict.theirs)throw error('The file changed again. Reopen the comparison before deciding.');
  if(choice==='leave')return {left:true};
  if(conflict.reason==='uncovered_remote_change'){
    if(!r||await covered(o.remote,conflict.page,r.text))throw error('The file changed again. Reopen the comparison before deciding.');
    choice??=value===conflict.theirs?'adopt':value===conflict.mine?'discard':null;
    if(!['adopt','discard'].includes(choice))throw error('Choose a version to keep. No file will be deleted.');
    const b=await baseline(o,conflict.page),external=(await R().read(o.work,conflict.page)).events.find(e=>e.id===conflict.external&&e.kind==='external'&&e.text===r.text);
    if(!external||await R().hash(statement(r.text))!==conflict.statement_sha256)throw error('The file changed again. Reopen the comparison before deciding.');
    if(choice==='discard'){
      if(!l||!await covered(o.work,conflict.page,l.text))throw error('Choose a version to keep. No file will be deleted.');
      const e=R().event({kind:'change',page:conflict.page,author:by,base:r.text,text:l.text,message});e.source='discard';e.discards=external.id;
      await record(o,b,conflict.page,b.data?.text??conflict.base??null,false,{event:e,statement_sha256:conflict.statement_sha256});return {discarded:true,pending:true};
    }
    const e=R().event({kind:'change',page:conflict.page,author:by,base:b.data?.text??'',text:r.text,message});e.source='outside_process';
    requireClearance([...contentClearance(e,conflict.page),...(await checkClearance(o.remote))]);
    await R().append(o.work,e);await guarded(o,o.work,conflict.page,r.text,l);
    if(!await R().receipt(o.work,e))throw error('The synchronization record cannot be read.');
    await record(o,b,conflict.page,r.text);return {adopted:true,event:e};
  }
  if(typeof value!=='string'||value.length>MAX)throw error('Choose a version to keep. No file will be deleted.');
  requireClearance([...contentClearance(value,conflict.page),...(await checkClearance(o.remote))]);
  const b=await baseline(o,conflict.page);
  await journal(o,o.remote,o.work,conflict.page);
  let parent=(await R().read(o.remote,conflict.page)).events.slice().reverse().find(e=>['change','accept'].includes(e.kind)&&e.text===conflict.theirs);
  if(!parent){parent=R().event({kind:'external',page:conflict.page,author:'',base:conflict.base??'',text:conflict.theirs??''});await R().append(o.work,parent);}
  const accepted=value===conflict.theirs;
  const response=accepted?null:R().reply(parent,value===conflict.mine?'reject':'proposal',by,conflict.theirs??'',value,message);
  const saved=await R().save(o.work,conflict.page,l,value,by,accepted?parent:null);
  if(!saved.saved||!saved.recorded)throw error('The file changed during synchronization. It will be checked again.');
  if(response)await R().append(o.work,response);
  await record(o,b,conflict.page,conflict.theirs,true);
}
global.EditorSync={run,resolve,visible,contentClearance,checkClearance};
})(globalThis);
