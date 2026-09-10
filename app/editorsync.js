/* IMP-06-07-05: guarded Markdown transfers between a wiki and its editable copy.
   Snapshots and immutable review events persist on disk. Explicit moves archive verified originals; detachment never deletes.
   Whole-file conflicts are preserved for an explicit decision; clocks never win.
   Entry points: run, resolve. See src/ARCHITECTURE.map. */
(function(global){
'use strict';
const F=()=>global.FolderAccess,R=()=>global.WikiReviews;
const MAX=2000000;
function error(key){return global.I18n.error(global.I18n.message(key));}
function visible(path,kind){return !path.split('/').some(p=>p.startsWith('.')||['notices','vermerke'].includes(p))&&(kind==='directory'||/\.md$/i.test(path));}
async function peek(dir,path){try{return await F().readFile(dir,path);}catch(e){if(e.name==='NotFoundError')return null;throw e;}}
function text(seen){return seen?seen.text:null;}
async function guarded(o,dir,path,value,seen){
  if(!o.alive())throw error('The folder was disconnected.');
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
    const source=await peek(from,name),target=await peek(to,name);
    if(target){if(target.text!==source.text)throw error('The synchronization record cannot be read.');continue;}
    await guarded(o,to,name,source.text,null);
  }}
  await walk(root,'.llmwiki/evidence');
}
async function shadowEvidence(o,from,to){
 for(const kind of ['changes','pins']){
  let root;try{root=await from.getDirectoryHandle('.llmwiki');root=await root.getDirectoryHandle('shadow');root=await root.getDirectoryHandle(kind);}catch(e){if(e.name==='NotFoundError')continue;throw e;}
  for await(const entry of root.values()){
   if(entry.kind!=='file'||!/^[a-f0-9]{64}\.json$/.test(entry.name))throw error('The synchronization record cannot be read.');
   const name='.llmwiki/shadow/'+kind+'/'+entry.name,source=await peek(from,name);
   if(!source||source.text.length>MAX||await R().hash(source.text)!==entry.name.slice(0,-5))throw error('The synchronization record cannot be read.');
   const data=JSON.parse(source.text);if(!(data.format==='llmwiki-shadow/1'||kind==='changes'&&data.format==='llmwiki-shadow-identities/2')||data.kind!==(kind==='pins'?'quote':'identities'))throw error('The synchronization record cannot be read.');
   const target=await peek(to,name);if(target){if(target.text!==source.text)throw error('The synchronization record cannot be read.');continue;}
   await guarded(o,to,name,source.text,null);
  }
 }
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
 const visible=(path,kind)=>!path.split('/').some(p=>p.startsWith('.'))&&(kind==='directory'||/\.(png|jpe?g|gif|webp|avif)$/i.test(path));
 const lists=await Promise.all([F().listFolder(o.work,undefined,{visible}),F().listFolder(o.remote,undefined,{visible})]);
 let cache=binaryChecks.get(o.work);if(!cache){cache=new Map();binaryChecks.set(o.work,cache);}
 const inventory=lists.map(items=>new Map(items.map(f=>[f.name,f])));
 const peek=async(dir,page)=>{try{return await F().readBinary(dir,page);}catch(e){if(e.name==='NotFoundError')return null;throw e;}};
 for(const page of new Set(lists.flat().map(f=>f.name))){
  if(!o.alive())return;
  if(!F().readBinary||!F().writeBinary){result.pending++;result.pending_details.push({page,reason:'binary_capability_required'});continue;}
  const info=inventory.map(items=>items.get(page)),cacheable=info.every(f=>f&&Number.isFinite(f.at)&&Number.isFinite(f.size)),signature=cacheable?JSON.stringify(info.map(f=>[f.at,f.size])):null,key=o.identity+'/'+page,known=cache.get(key);
  if(signature&&known?.signature===signature&&Date.now()-known.at<60000)continue;
  cache.delete(key);
  const local=await peek(o.work,page),remote=await peek(o.remote,page);
  if(local?.sha256===remote?.sha256){if(signature)cache.set(key,{signature,at:Date.now()});continue;}
  if(local&&remote){result.pending++;result.pending_details.push({page,reason:'asset_conflict',local:local.sha256,remote:remote.sha256});continue;}
  if(!remote&&!o.canPublish){result.pending++;result.pending_details.push({page,reason:'asset_publication_pending'});continue;}
  const source=local||remote,target=local?o.remote:o.work;
  const done=await F().writeBinary(target,page,source.bytes,null);
  if(!done.saved)throw error('The file changed during synchronization. It will be checked again.');
  if(local)result.published++;else result.copied++;
 }
}
async function run(options){
  const o={alive:()=>true,...options},result={copied:0,published:0,pending:0,pending_details:[],conflicts:[]};
  if(!o.alive())return result;
  if(o.work.isSameEntry&&await o.work.isSameEntry(o.remote))throw error('The shared wiki and working folder must be separate.');
  await binaryAssets(o,result);
  await evidence(o,o.remote,o.work);if(o.canPublish)await evidence(o,o.work,o.remote);
  await shadowEvidence(o,o.remote,o.work);if(o.canPublish)await shadowEvidence(o,o.work,o.remote);
  const aliases=await moveAliases(o,result);await identityAliases(o,aliases);
  const [local,remote]=await Promise.all([F().listFolder(o.work,undefined,{visible}),F().listFolder(o.remote,undefined,{visible})]);
  const pages=new Map([...local,...remote].map(f=>[f.name,f]));
  for(const [page,entry] of pages){
    if(aliases.has(page))continue;
    if(!o.alive())break;
    if(entry.size>MAX){result.pending++;result.pending_details.push({page,reason:'size_limit'});continue;}
    const b=await baseline(o,page),l=await peek(o.work,page),r=await peek(o.remote,page),mine=text(l),theirs=text(r);
    if((mine!==null&&mine.length>MAX)||(theirs!==null&&theirs.length>MAX)){result.pending++;result.pending_details.push({page,reason:'size_limit'});continue;}
    await journal(o,o.remote,o.work,page);
    if(o.canPublish)await journal(o,o.work,o.remote,page);
    if(mine===theirs){
      if(!b.data||b.data.text!==mine||b.data.resolved)await record(o,b,page,mine);
      continue;
    }
    const base=b.data?.text;
    // Receive a new page or a remote change when the saved working file is clean.
    if((!b.data&&mine===null&&theirs!==null)||(b.data&&mine===base&&theirs!==null)){
      if(text(await peek(o.remote,page))!==theirs)throw error('The file changed during synchronization. It will be checked again.');
      await guarded(o,o.work,page,theirs,l);await record(o,b,page,theirs);result.copied++;continue;
    }
    // Publishing requires an exact author chain, or an explicit conflict decision.
    const remoteClean=b.data?theirs===base:theirs===null;
    if(remoteClean&&mine!==null){
      if(!o.canPublish){result.pending++;result.pending_details.push({page,reason:'read_only'});continue;}
      if(!(b.data?.resolved)||theirs!==base){
        if(!await transferable(o.work,page,theirs,mine)){result.pending++;result.pending_details.push({page,reason:'author_chain_missing',base:base??null,mine,theirs});continue;}
      }
      if(text(await peek(o.work,page))!==mine)throw error('The file changed during synchronization. It will be checked again.');
      await guarded(o,o.remote,page,mine,r);await record(o,b,page,mine);result.published++;continue;
    }
    result.conflicts.push({page,base:base??null,mine,theirs});
  }
  await retireMoves(o,result,aliases);
  return result;
}
async function resolve(options,conflict,value,by,message=''){
  const o={alive:()=>true,...options},l=await peek(o.work,conflict.page),r=await peek(o.remote,conflict.page);
  if(!o.alive())throw error('The folder was disconnected.');
  if(text(l)!==conflict.mine||text(r)!==conflict.theirs)throw error('The file changed again. Reopen the comparison before deciding.');
  if(typeof value!=='string'||value.length>MAX)throw error('Choose a version to keep. No file will be deleted.');
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
global.EditorSync={run,resolve,visible};
})(globalThis);
