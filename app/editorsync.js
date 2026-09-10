/* IMP-06-07-05: guarded Markdown transfers between a wiki and its editable copy.
   Snapshots and immutable review events persist on disk. Explicit moves archive verified originals; detachment never deletes.
   Whole-file conflicts are preserved for an explicit decision; clocks never win.
   Entry points: run, resolve. See src/ARCHITECTURE.map. */
(function(global){
'use strict';
const F=()=>global.FolderAccess,R=()=>global.WikiReviews;
const MAX=2000000;
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
  const paths=v.replace(/\bhttps?:\/\/[^\s<>"']+/gi,'').replace(/(?<![\p{L}\p{N}_/.~-])[\p{L}\p{N}][\p{L}\p{N}_-]*-\/(?:[\p{L}\p{N}][\p{L}\p{N}_-]*-\/)+[\p{L}\p{N}][\p{L}\p{N}_-]*/gu,'');
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
function transferVisible(page,kind){
 const roots=['.llmwiki/reviews','.llmwiki/evidence','.llmwiki/shadow/changes','.llmwiki/shadow/pins','.llmwiki/path-aliases','.llmwiki/transfers','.llmwiki/retirements'];
 return visible(page,kind)||(kind==='directory'&&roots.some(r=>r===page||r.startsWith(page+'/')||page.startsWith(r+'/')))||
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
function requireClearance(findings){if(!findings.length)return;const e=error('Sharing paused. Private values were found in a document or its history. Keep the original private and prepare a cleaned copy before sharing.');e.code='clearance';e.details={findings};throw e;}
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
async function record(o,b,page,value,resolved=false){return guarded(o,o.work,b.path,JSON.stringify({format:'llmwiki-editor-sync/1',identity:o.identity,page,text:value,resolved}),b.seen);}
async function journal(o,from,to,page){
  const source=await R().read(from,page),target=await R().read(to,page);
  const found=new Map([...target.events,...target.pending].map(e=>[e.id,e]));
  for(const e of source.events){
    if(!o.alive())throw error('The folder was disconnected.');
    requireClearance(contentClearance(e,page));
    const known=found.get(e.id);
    if(known&&JSON.stringify(known)!==JSON.stringify(e))throw error('The synchronization record cannot be read.');
    if(!known)await R().append(to,e);
    if(['change','accept'].includes(e.kind)&&!await R().receipt(to,e))throw error('The synchronization record cannot be read.');
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
 const visible=(path,kind)=>!path.split('/').some(p=>p.startsWith('.'))&&(kind==='directory'||/\.(png|jpe?g|gif|webp|avif|svg|pdf|excalidraw)$/i.test(path));
 const lists=await Promise.all([F().listFolder(o.work,undefined,{visible}),F().listFolder(o.remote,undefined,{visible})]);
 let cache=binaryChecks.get(o.work);if(!cache){cache=new Map();binaryChecks.set(o.work,cache);}
 const inventory=lists.map(items=>new Map(items.map(f=>[f.name,f])));
 const peek=async(dir,page)=>{try{return await F().readBinary(dir,page);}catch(e){if(e.name==='NotFoundError')return null;throw e;}};
 for(const page of new Set(lists.flat().map(f=>f.name))){
  await step(o,['asset',page],async()=>{
   if(!o.alive())return;
   if(!F().readBinary||!F().writeBinary){result.pending++;result.pending_details.push({page,reason:'binary_capability_required'});return;}
   const info=inventory.map(items=>items.get(page)),cacheable=info.every(f=>f&&Number.isFinite(f.at)&&Number.isFinite(f.size)),signature=cacheable?JSON.stringify(info.map(f=>[f.at,f.size])):null,key=o.identity+'/'+page,known=cache.get(key);
   if(signature&&known?.signature===signature&&Date.now()-known.at<60000)return;
   cache.delete(key);
   const local=await peek(o.work,page),remote=await peek(o.remote,page);
   if(local?.sha256===remote?.sha256){if(signature)cache.set(key,{signature,at:Date.now()});return;}
   if(local&&remote){result.pending++;result.pending_details.push({page,reason:'asset_conflict',local:local.sha256,remote:remote.sha256});return;}
   if(!remote&&!o.canPublish){result.pending++;result.pending_details.push({page,reason:'asset_publication_pending'});return;}
   const source=local||remote,target=local?o.remote:o.work;
   const done=await F().writeBinary(target,page,source.bytes,null);
   if(!done.saved)throw error('The file changed during synchronization. It will be checked again.');
   if(local)result.published++;else result.copied++;
  },result);
 }
}
async function run(options){
  const o={alive:()=>true,...options},result={copied:0,published:0,pending:0,pending_details:[],conflicts:[]};
  if(!o.alive())return result;
  if(o.work.isSameEntry&&await o.work.isSameEntry(o.remote))throw error('The shared wiki and working folder must be separate.');
  requireClearance([...(await checkClearance(o.remote,o)),...(o.canPublish?await checkClearance(o.work,o):[])]);
  await binaryAssets(o,result);
  await evidence(o,o.remote,o.work);if(o.canPublish)await evidence(o,o.work,o.remote);
  await shadowEvidence(o,o.remote,o.work);if(o.canPublish)await shadowEvidence(o,o.work,o.remote);
  for(const kind of ['transfers','retirements']){await sharedRecords(o,o.remote,o.work,kind);if(o.canPublish)await sharedRecords(o,o.work,o.remote,kind);}
  const retired=await step(o,['retire_groups'],()=>retireGroups(o,result),result);
  const aliases=await moveAliases(o,result);await identityAliases(o,aliases);
  const [local,remote]=await Promise.all([F().listFolder(o.work,undefined,{visible}),F().listFolder(o.remote,undefined,{visible})]);
  const pages=new Map([...local,...remote].map(f=>[f.name,f]));
  for(const [page,entry] of pages){
    if(!o.alive())break;
    await step(o,['page',page],async()=>{
     if(aliases.has(page)||retired.has(page))return;
     if(entry.size>MAX){result.pending++;result.pending_details.push({page,reason:'size_limit'});return;}
     const b=await baseline(o,page),l=await peek(o.work,page),r=await peek(o.remote,page),mine=text(l),theirs=text(r);
     if((mine!==null&&mine.length>MAX)||(theirs!==null&&theirs.length>MAX)){result.pending++;result.pending_details.push({page,reason:'size_limit'});return;}
     await journal(o,o.remote,o.work,page);
     if(o.canPublish)await journal(o,o.work,o.remote,page);
     if(mine===theirs){
       if(!b.data||b.data.text!==mine||b.data.resolved)await record(o,b,page,mine);
       return;
     }
     const base=b.data?.text;
     // Receive a new page or a remote change when the saved working file is clean.
     if((!b.data&&mine===null&&theirs!==null)||(b.data&&mine===base&&theirs!==null)){
       if(text(await peek(o.remote,page))!==theirs)throw error('The file changed during synchronization. It will be checked again.');
       await guarded(o,o.work,page,theirs,l);await record(o,b,page,theirs);result.copied++;return;
     }
     // Publishing requires an exact author chain, or an explicit conflict decision.
     const remoteClean=b.data?theirs===base:theirs===null;
     if(remoteClean&&mine!==null){
       if(!o.canPublish){result.pending++;result.pending_details.push({page,reason:'read_only'});return;}
       if(!(b.data?.resolved)||theirs!==base){
         if(!await transferable(o.work,page,theirs,mine)){result.pending++;result.pending_details.push({page,reason:'author_chain_missing',base:base??null,mine,theirs});return;}
       }
       if(text(await peek(o.work,page))!==mine)throw error('The file changed during synchronization. It will be checked again.');
       await guarded(o,o.remote,page,mine,r);await record(o,b,page,mine);result.published++;return;
     }
     result.conflicts.push({page,base:base??null,mine,theirs});
    },result);
  }
  await step(o,['retire_moves'],()=>retireMoves(o,result,aliases),result);
  return result;
}
async function resolve(options,conflict,value,by,message=''){
  const o={alive:()=>true,...options},l=await peek(o.work,conflict.page),r=await peek(o.remote,conflict.page);
  if(!o.alive())throw error('The folder was disconnected.');
  if(text(l)!==conflict.mine||text(r)!==conflict.theirs)throw error('The file changed again. Reopen the comparison before deciding.');
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
