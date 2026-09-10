// Generated from app/reviews.js by scripts/sync-contracts.mjs.
export function createReviews(environment){
(function(global){
'use strict';
const FORMAT='llmwiki-review/1',ROOT='.llmwiki/reviews',MAX_TEXT=2000000;
const idPattern=/^[a-z0-9-]{20,80}$/i;
const kinds=['change','proposal','reject','accept','comment','external','resolve','reopen','acknowledge','partial'];
const F=()=>global.FolderAccess;
const msg=(key,values)=>global.I18n.message(key,values);
function fail(key){throw global.I18n.error(msg(key));}
function author(value){return typeof value==='string'&&value.trim()!==''&&value.length<=120&&!/[\r\n\x00-\x1f]/.test(value);}
function valid(e){
  return Boolean((!e?.anchor||(Number.isInteger(e.anchor.beforeLine)&&Number.isInteger(e.anchor.afterLine)&&Array.isArray(e.anchor.before)&&Array.isArray(e.anchor.after)&&e.anchor.before.every(v=>typeof v==='string')&&e.anchor.after.every(v=>typeof v==='string')))&&e&&e.format===FORMAT&&idPattern.test(e.id)&&kinds.includes(e.kind)&&(author(e.author)||(e.kind==='external'&&e.author===''))&&
    typeof e.page==='string'&&e.page&&!e.page.split('/').some(p=>!p||p==='..'||p==='.'||p.startsWith('.'))&&!/[\\:\x00-\x1f]/.test(e.page)&&
    (e.parent===null||typeof e.parent==='string'&&idPattern.test(e.parent))&&idPattern.test(e.thread)&&
    typeof e.base==='string'&&e.base.length<=MAX_TEXT&&typeof e.text==='string'&&e.text.length<=MAX_TEXT&&
    typeof e.message==='string'&&e.message.length<=10000&&Array.isArray(e.recipients)&&e.recipients.length<=200&&e.recipients.every(author)&&
    typeof e.at==='string'&&/Z$/.test(e.at)&&Number.isFinite(Date.parse(e.at)));
}
function event(values){
  const id=global.crypto.randomUUID();
  const e={format:FORMAT,id,kind:values.kind,page:values.page,author:values.author,at:new Date().toISOString(),
    parent:values.parent||null,thread:values.thread||id,base:values.base,text:values.text,message:values.message||'',recipients:values.recipients||[]};
  if(!valid(e))fail('The change record is incomplete or invalid.');return e;
}
function reply(parent,kind,by,base,text,message){
  if(!valid(parent))fail('The change record is incomplete or invalid.');
  return event({page:parent.page,kind,author:by,base,text,message,parent:parent.id,thread:kind==='comment'&&['change','external','accept'].includes(parent.kind)?null:parent.thread,recipients:!parent.author||parent.author===by?parent.recipients:[parent.author]});
}
async function hash(text){const bytes=await global.crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');}
async function pageFolder(page){return ROOT+'/'+await hash(page);}
async function eventPath(e){return await pageFolder(e.page)+'/'+e.id+'.json';}
async function append(dir,e){
  if(!valid(e))fail('The change record is incomplete or invalid.');
  const done=await F().writeFile(dir,await eventPath(e),JSON.stringify(e,null,2)+'\n',null);
  if(!done.saved)fail('The response could not be recorded. Nothing was sent.');return e;
}
async function receipt(dir,e){
  const path=await eventPath(e)+'.applied',text=JSON.stringify({id:e.id,digest:await hash(JSON.stringify(e))});
  try{const existing=await F().readFile(dir,path);return existing.text===text;}catch(error){if(error.name!=='NotFoundError')throw error;}
  const result=await F().writeFile(dir,path,text,null);
  return Boolean(result.saved);
}
async function save(dir,page,expected,text,by,parent=null){
  let current=null;try{current=await F().readFile(dir,page);}catch(error){if(error.name!=='NotFoundError')throw error;}
  if((current?current.text:null)!==(expected?expected.text:null))return {saved:false,stale:true};
  if(!parent&&current&&current.text===text)return {saved:true,recorded:true,text,mark:current.mark,event:null,unchanged:true};
  const e=parent?reply(parent,'accept',by,current?current.text:'',text,''):event({page,kind:'change',author:by,base:current?current.text:'',text});
  e.page=page;
  await append(dir,e); // Refuse before touching the document if journalling is unavailable.
  const done=await F().writeFile(dir,page,text,current);
  if(!done.saved)return {...done,event:e,recorded:false};
  let recorded=false;try{recorded=await receipt(dir,e);}catch(_){/* Return the successful file write and expose the missing receipt. */}
  return {...done,event:e,recorded};
}
async function accept(dir,e,current,by){
  if(!valid(e))fail('The change record is incomplete or invalid.');
  if(current.text!==e.text&&(['change','external'].includes(e.kind)||current.text!==e.base)){
    const journal=await read(dir,e.page),parts=journal.events.filter(p=>p.kind==='partial'&&p.parent===e.id&&p.text===current.text);
    const proven=parts.some(p=>journal.events.some(a=>a.kind==='accept'&&a.parent===p.id&&a.text===current.text));
    if(!['proposal','reject'].includes(e.kind)||!proven)return {saved:false,stale:true};
  }
  return save(dir,currentPage(await aliases(dir),e.page),current,e.text,by,e);
}
async function directory(dir,path){for(const part of path.split('/'))dir=await dir.getDirectoryHandle(part);return dir;}
async function readOwn(dir,page=null){
  let root;try{root=await directory(dir,page?await pageFolder(page):ROOT);}catch(error){if(error.name==='NotFoundError')return {events:[],incomplete:0,unreadable:0,pending:[]};throw error;}
  const found=[],receipts=new Map();let incomplete=0,unreadable=0;
  async function scan(h,depth){
    for await(const entry of h.values()){
      if(entry.kind==='directory'){if(depth===0&&page===null&&/^[a-f0-9]{64}$/.test(entry.name))await scan(entry,1);continue;}
      if(!/^[a-z0-9-]{20,80}\.json(?:\.applied)?$/i.test(entry.name))continue;
      try{
        const f=await entry.getFile();if(f.size>MAX_TEXT*12+50000){unreadable++;continue;}
        const data=JSON.parse(await f.text());
        if(entry.name.endsWith('.applied')){if(data.id+'.json.applied'===entry.name)receipts.set(data.id,data.digest);else unreadable++;}
        else if(valid(data)&&data.id+'.json'===entry.name&&(!page||data.page===page))found.push(data);else unreadable++;
      }catch(_){unreadable++;}
    }
  }
  await scan(root,0);const events=[],pending=[];
  for(const e of found){if(['change','accept'].includes(e.kind)&&receipts.get(e.id)!==await hash(JSON.stringify(e))){incomplete++;pending.push(e);continue;}events.push(e);}
  // Timestamp only orders the presentation. Content equality, never a clock, gates writes.
  events.sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
  return {events,incomplete,unreadable,pending};
}
const aliasCache=new WeakMap();
async function aliases(dir){
 const cached=aliasCache.get(dir);if(cached&&Date.now()-cached.at<500)return cached.map;
 const map=new Map();let root;try{root=await directory(dir,'.llmwiki/path-aliases');}catch(e){if(e.name==='NotFoundError')return map;throw e;}
 for await(const entry of root.values())if(entry.kind==='file'&&entry.name.endsWith('.json')){const data=JSON.parse(await(await entry.getFile()).text());if(data.kind!=='consolidated'&&typeof data.from==='string'&&typeof data.to==='string')map.set(data.from,data.to);}
 aliasCache.set(dir,{at:Date.now(),map});return map;
}
function currentPage(map,page){const visited=new Set();while(map.has(page)){if(visited.has(page))fail('The synchronization record cannot be read.');visited.add(page);page=map.get(page);}return page;}
async function read(dir,page=null){
 const result=await readOwn(dir,page);if(!page)return result;
 const map=await aliases(dir);for(const old of map.keys())if(old!==page&&currentPage(map,old)===page){const prior=await readOwn(dir,old);result.events.push(...prior.events);result.pending.push(...prior.pending);result.incomplete+=prior.incomplete;result.unreadable+=prior.unreadable;}
 result.events.sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));return result;
}
function threadState(events,thread){
 const byId=new Map(events.map(e=>[e.id,e])),states=events.filter(e=>e.thread===thread&&['resolve','reopen'].includes(e.kind)),ancestors=new Set();
 for(const state of states){let parent=state.parent;const visited=new Set();while(parent&&!visited.has(parent)){visited.add(parent);ancestors.add(parent);parent=byId.get(parent)?.parent;}}
 const heads=states.filter(e=>!ancestors.has(e.id));return heads.length&&heads.every(e=>e.kind==='resolve')?'resolved':'open';
}
function incoming(events,by,seen){
  const known=new Set(seen||[]);
  const parents=new Map(events.map(e=>[e.id,e]));
  const answered=new Set(events.filter(e=>e.author===by&&!['acknowledge','partial','comment','resolve','reopen'].includes(e.kind)||(e.kind==='accept'&&parents.get(e.parent)&&!['change','external'].includes(parents.get(e.parent).kind))).map(e=>e.parent));
  return events.filter(e=>e.author!==by&&!['accept','external','resolve','acknowledge','partial'].includes(e.kind)&&threadState(events,e.thread)!=='resolved'&&!known.has(e.id)&&!answered.has(e.id)&&
    (e.kind==='change'||!e.recipients.length||e.recipients.includes(by)));
}
// A journal is evidence, not an inbox. First observation establishes a baseline;
// subsequent content differences and unanswered conversations are actionable.
async function tasks(events,by,checkpoint,current,page){
  const replies=incoming(events,by,checkpoint?.seen||[]).filter(e=>!['change','external'].includes(e.kind));
  if(!checkpoint||checkpoint.text===current)return replies;
  let change=events.slice().reverse().find(e=>['change','accept'].includes(e.kind)&&e.text===current&&e.base!==e.text);
  if(!change){
    change=event({kind:'external',page,author:'',base:checkpoint.text,text:current});
    change.id='external-'+await hash(JSON.stringify([page,checkpoint.text,current]));change.thread=change.id;
  }
  return (checkpoint.seen||[]).includes(change.id)?replies:[change,...replies];
}
function localKey(project,folder,path,by){return 'review/'+[project,folder,String(path),by||'unnamed'].map(encodeURIComponent).join('/');}
async function checkpoint(key,page,value){
  if(value){
    const done=await F().keepDraft(key,page,JSON.stringify(value),'llmwiki-checkpoint/1');
    if(!done)fail('The personal comparison baseline could not be saved.');return value;
  }
  const saved=await F().recallDraft(key,page);if(!saved)return null;
  try{const data=JSON.parse(saved.text);return typeof data.text==='string'&&Array.isArray(data.seen)?data:null;}catch(_){return null;}
}
function selectChanges(before,after,selection,revert=false){
 const hunks=diff(before,after);if(!Array.isArray(selection)||!selection.length||new Set(selection).size!==selection.length||selection.some(i=>!Number.isInteger(i)||i<0||i>=hunks.length))fail('Select a valid change.');
 // Retain original line endings in every untouched range.
 const lines=(revert?after:before).match(/[^\n]*\n|[^\n]+$/g)||[],next=(revert?before:after).match(/[^\n]*\n|[^\n]+$/g)||[];
 for(const i of [...selection].sort((a,b)=>b-a)){const h=hunks[i],from=revert?h.afterLine:h.beforeLine,count=revert?h.after.length:h.before.length,to=revert?h.beforeLine:h.afterLine,size=revert?h.before.length:h.after.length;lines.splice(from-1,count,...next.slice(to-1,to-1+size));}
 return lines.join('');
}
function diff(before,after){
  if(before===after)return [];
  const a=before.split(/\r?\n/),b=after.split(/\r?\n/),hunks=[];let ai=0,bi=0;
  const matches=a.length*b.length<=4000000?global.matchingBlocks(a,b):[[a.length,b.length,0]];
  for(const [x,y,size] of matches){if(x>ai||y>bi)hunks.push({before:a.slice(ai,x),after:b.slice(bi,y),beforeLine:ai+1,afterLine:bi+1});ai=x+size;bi=y+size;}
  return hunks;
}
// Follow exact snapshots, retaining authors on untouched lines. Timestamps never
// bridge a missing content link, and uncovered text stays explicitly unknown.
function attribution(before,after,events){
  const chain=[],used=new Set();let cursor=after;
  while(cursor!==before){
    const matches=events.filter(e=>['change','accept'].includes(e.kind)&&e.base!==e.text&&e.text===cursor&&!used.has(e.id));
    if(!matches.length)break;
    const e=matches[matches.length-1];used.add(e.id);chain.unshift(e);cursor=e.base;
  }
  const original=before.split(/\r?\n/),start=cursor.split(/\r?\n/),deleted=new Map();
  let lines=start.map(()=>({author:null,index:null}));
  if(original.length*start.length<=4000000)for(const [a,b,size] of global.matchingBlocks(original,start))for(let i=0;i<size;i++)lines[b+i].index=a+i;
  for(const e of chain){
    const a=e.base.split(/\r?\n/),b=e.text.split(/\r?\n/),next=b.map(()=>({author:e,index:null}));let old=0;
    const matches=a.length*b.length<=4000000?global.matchingBlocks(a,b):[[a.length,b.length,0]];
    for(const [x,y,size]of matches){
      for(let i=old;i<x;i++)if(lines[i]&&lines[i].index!==null)deleted.set(lines[i].index,e);
      for(let i=0;i<size;i++)next[y+i]=lines[x+i];old=x+size;
    }
    lines=next;
  }
  return diff(before,after).map(h=>{
    const authors=new Map();let unknown=false;
    for(let i=h.afterLine-1;i<h.afterLine-1+h.after.length;i++){const e=lines[i]&&lines[i].author;if(e)authors.set(e.id,e);else unknown=true;}
    for(let i=h.beforeLine-1;i<h.beforeLine-1+h.before.length;i++){const e=deleted.get(i);if(e)authors.set(e.id,e);else if(!h.after.length)unknown=true;}
    return {authors:Array.from(authors.values()),unknown};
  });
}

// Legacy agent notices still provide provenance for their quoted paragraph,
// never for the entire file just because the author field happens to be present.
function parseNotice(text){
  if(global.headField(text,'format')!=='llmwiki-notice/1')return null;
  const sections={},body=text.slice(global.parseHead(text).offset);let heading=null,quote=null,width=0,lines=[];
  for(const line of body.split(/\r?\n/)){
    const marker=/^ {0,3}(`{3,}|~{3,})/.exec(line);
    if(quote){if(marker&&marker[1][0]===quote&&marker[1].length>=width){sections[heading]=lines.join('\n');quote=null;}else lines.push(line);continue;}
    const h=/^##\s+(warum|vorher|nachher)\s*$/.exec(line);if(h)heading=h[1];
    if(marker&&heading){quote=marker[1][0];width=marker[1].length;lines=[];}
  }
  return {author:global.headField(text,'von')||'',at:global.headField(text,'wann')||'',base:sections.vorher||'',text:sections.nachher||'',message:sections.warum||''};
}
async function notices(dir,text){
  const id=global.headField(text,'id');if(typeof id!=='string'||!/^[a-zA-Z0-9_-]+$/.test(id))return [];
  const found=[];
  for(const top of ['notices','vermerke']){
    let root;try{root=await directory(dir,top+'/'+id);}catch(error){if(error.name==='NotFoundError')continue;throw error;}
    for await(const entry of root.values())if(entry.kind==='file'&&entry.name.endsWith('.md')){const file=await entry.getFile();if(file.size>MAX_TEXT)continue;const n=parseNotice(await file.text());if(n)found.push(n);}
  }
  return found;
}
global.WikiReviews={selectChanges,revertChanges:(before,after,selection)=>selectChanges(before,after,selection,true),threadState,aliases,currentPage,event,valid,reply,save,accept,append,read,incoming,tasks,localKey,checkpoint,diff,attribution,hash,eventPath,receipt,parseNotice,notices};
})(environment);
return environment.WikiReviews;
}
