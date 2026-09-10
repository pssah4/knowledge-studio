import {decodePassage} from './passage-links.mjs';
/** FEAT-03-06 orchestration: private derivations, immutable shared identities and
 * deliberately retained quotes. Every read starts from accessible wiki stores.
 */
import {parseShadow,matchBlocks,makeLocator,resolveLocator,SHADOW_FORMAT,PARSER_VERSION} from './shadow.mjs';
import {relativePath,requireThat} from './core/errors.mjs';
import {identityPackages,assembleIdentities} from './shadow-exchange.mjs';
import {navigationPage} from './core/graph.mjs';

const CHANGES='.llmwiki/shadow/changes',PINS='.llmwiki/shadow/pins';
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const key=(path,revision)=>JSON.stringify([path,revision]);
const eligible=path=>/\.md$/i.test(path)&&!navigationPage(path)&&!path.split('/').some(p=>p.startsWith('.')||p.startsWith('~$'))&&!/^(schema|meta|notices|vermerke)\//.test(path);
const missing=e=>e.code==='ENOENT'||e.name==='NotFoundError';
async function files(store,prefix){try{return (await store.list(prefix,{hidden:true})).filter(e=>e.kind==='file');}catch(e){if(missing(e))return [];throw e;}}
const issue=(wiki,error,page)=>({wiki,...(page?{page}:{}),code:error.code??'shadow_read',message:error.message,...(error.details?{details:error.details}:{})});
function scopes(wikis){requireThat(Array.isArray(wikis)&&new Set(wikis.map(w=>w.id)).size===wikis.length,'shadow_scope','Select unique accessible wikis.');}

async function history(wiki,{maxBytes=32*1024*1024}={}){
 const entries=await files(wiki.store,CHANGES);requireThat(entries.length<=8192,'shadow_history_budget','The identity history exceeds its scan budget.');
 const packages=[];let size=0;
 for(const entry of entries){const name=entry.path.slice(CHANGES.length+1);requireThat(/^[a-f0-9]{64}\.json$/.test(name),'shadow_history','Invalid identity package name.');
  const file=await wiki.store.read(entry.path);requireThat(file,'shadow_history','An identity package disappeared.');size+=file.size??new TextEncoder().encode(file.text).length;
  requireThat(size<=maxBytes,'shadow_history_budget','The identity history exceeds its byte budget.');
  requireThat(await wiki.store.services.hash(file.text)===name.slice(0,-5),'shadow_history','An identity package checksum is invalid.');
  const data=JSON.parse(file.text);requireThat(data.kind==='identities'&&data.wiki===wiki.id,'shadow_history','Invalid identity package scope.');packages.push(data);
 }
 const result=await assembleIdentities(packages,wiki.store.services);
 for(const record of result.records){relativePath(record.path);requireThat(eligible(record.path)&&hex(record.id)&&(record.revision===null||hex(record.revision))&&Array.isArray(record.blocks)&&record.blocks.length<=20000,'shadow_history','Invalid document identity.');
  for(const block of record.blocks)requireThat(hex(block.id)&&hex(block.text_hash)&&hex(block.occurrence)&&Number.isInteger(block.start)&&Number.isInteger(block.end)&&block.start>=0&&block.end>block.start,'shadow_history','Invalid block identity.');
 }
 // Keep old packages durable, but prefer current coordinate metadata for the same revision.
 const current=new Set(result.records.filter(r=>r.parser===PARSER_VERSION).map(r=>JSON.stringify([r.id,r.path,r.revision])));
 result.records=result.records.filter(r=>r.parser===PARSER_VERSION||!current.has(JSON.stringify([r.id,r.path,r.revision])));
 return result;
}

function identityRecord(row,previous){return {id:row.id,path:row.path,revision:row.revision,parser:PARSER_VERSION,previous_revision:previous?.revision??null,previous_path:previous?.path??null,
 blocks:row.data.blocks.map(({id,kind,text_hash,occurrence,start,end,mapping,predecessors,candidate_basis})=>({id,kind,text_hash,occurrence,start,end,mapping,predecessors,...(candidate_basis?{candidate_basis}:{})}))};}
function mapped(parsed,record){const byOccurrence=new Map(record.blocks.map(b=>[b.occurrence,b])),byRange=new Map(record.blocks.map(b=>[JSON.stringify([b.text_hash,b.start,b.end]),b]));return {...parsed,blocks:parsed.blocks.map(b=>{const known=record.parser===parsed.parser?byOccurrence.get(b.occurrence):byRange.get(JSON.stringify([b.text_hash,b.start,b.end]));requireThat(known&&known.text_hash===b.text_hash&&known.start===b.start&&known.end===b.end,'shadow_history','Stored selectors do not match the current document.');return {...b,id:known.id,mapping:known.mapping,predecessors:known.predecessors??[],...(known.candidate_basis?{candidate_basis:known.candidate_basis}:{})};})};}
async function currentFiles(wiki,{maxFiles=10000,maxBytes=64*1024*1024}={}){
 const entries=(await wiki.store.list('')).filter(e=>e.kind==='file'&&eligible(e.path));requireThat(entries.length<=maxFiles,'shadow_budget','The wiki exceeds the document scan budget.');
 const result=[],findings=[];let size=0;
 for(const e of entries)try{const file=await wiki.store.read(e.path);requireThat(file,'shadow_stale','A listed document disappeared.');size+=file.size??new TextEncoder().encode(file.text).length;requireThat(size<=maxBytes,'shadow_budget','The wiki exceeds the text scan budget.');result.push({...file,path:e.path});}
 catch(error){findings.push(issue(wiki.id,error,e.path));if(error.code==='shadow_budget')break;}
 return {files:result,findings,paths:new Set(entries.map(e=>e.path))};
}

async function changedFiles(wiki,cached,options){
 if(options.paths===undefined||options.rebuild)return currentFiles(wiki,options);
 requireThat(Array.isArray(options.paths)&&options.paths.length>0&&options.paths.length<=1000,'shadow_paths','Choose 1–1000 known Markdown paths, or omit paths for a full reconciliation.');
 const paths=[...new Set(options.paths.map(p=>relativePath(p)))];
 if(paths.some(p=>!eligible(p)||!cached.some(d=>d.path===p)))return currentFiles(wiki,options);
 const files=[];let bytes=0;for(const p of paths){const file=await wiki.store.read(p);if(!file)return currentFiles(wiki,options);bytes+=file.size??new TextEncoder().encode(file.text).length;requireThat(bytes<=(options.maxBytes??64*1024*1024),'shadow_budget','The selected paths exceed the text scan budget.');files.push({...file,path:p});}
 return {files,findings:[],paths:new Set(cached.map(d=>d.path)),full_scan:false};
}

async function publish(wiki,records,options){
 const payloads=await identityPackages(wiki.id,records,wiki.store.services,options);let shared_bytes=0,packages=0;
 try{for(const text of payloads){const name=CHANGES+'/'+await wiki.store.services.hash(text)+'.json',seen=await wiki.store.read(name);if(seen)requireThat(seen.text===text,'shadow_history','Conflicting identity package.');else{await wiki.store.write(name,text,{expected:null});shared_bytes+=new TextEncoder().encode(text).length;packages++;}}}catch(error){error.details={...error.details,phase:'publish',shared_bytes,packages,next:'Retry shadow.refresh after restoring access. Preserve all existing identity packages and Markdown.'};throw error;}
 return {shared_bytes,packages};
}

export async function refreshShadow(wikis,db,options={}){
 scopes(wikis);requireThat(db&&!db.readOnly,'shadow_capability','Persistent shadow maintenance requires a writable local SQLite host. Browser and Vault use read-only passage retrieval.');
 const expected=db.generation(),updates=[],remove=[],findings=[],batches=[],scans=[];let parsedCount=0,unchanged=0;
 for(const wiki of wikis)try{
  const cached=db.documents(wiki.id).filter(d=>!d.data.origin||d.data.origin===wiki.store.root),scan=await changedFiles(wiki,cached,options),exchange=await history(wiki,options),past=exchange.records,byPath=new Map(cached.map(d=>[d.path,d])),records=[];scans.push(scan.full_scan!==false);findings.push(...scan.findings);
  const superseded=new Set(past.filter(r=>r.previous_revision).map(r=>JSON.stringify([r.id,r.previous_path??r.path,r.previous_revision]))),terminals=past.filter(r=>r.revision&&!superseded.has(JSON.stringify([r.id,r.path,r.revision])));
  const gone=scan.full_scan===false?[]:terminals.filter(d=>!scan.paths.has(d.path)),claimed=new Set();
  for(const file of scan.files)try{
   const previous=byPath.get(file.path),exact=past.filter(r=>r.path===file.path&&r.revision===file.sha256&&r.parser===PARSER_VERSION),identities=new Set(exact.map(r=>JSON.stringify([r.id,r.blocks.map(b=>b.id)])));
   requireThat(new Set(past.filter(r=>r.path===file.path&&r.revision===file.sha256).map(r=>r.id)).size<=1,'shadow_ambiguous','Conflicting document identities cannot be hidden by a coordinate migration.');
   requireThat(identities.size<=1,'shadow_ambiguous','Conflicting identity histories exist for this exact file version.');
   if(!exact.length&&previous?.revision===file.sha256&&previous.data.source===file.text&&previous.data.parser===PARSER_VERSION){
    records.push(identityRecord(previous,previous.data.identity_previous));updates.push(previous);unchanged++;continue;
   }
   if(!options.rebuild&&exact.length&&previous?.revision===file.sha256&&previous.data.source===file.text&&previous.data.parser===PARSER_VERSION&&(!exact.length||exact[0].id===previous.id)){unchanged++;continue;}
   const parsed=await parseShadow(file.text,wiki.store.services,options);parsedCount++;
   let ancestor=null;
   if(!exact.length){const terminal=terminals.filter(r=>r.path===file.path);
    requireThat(terminal.length<=1,'shadow_ambiguous','Concurrent document histories require an explicit file reconciliation.');
    if(terminal.length)ancestor={...terminal[0],data:{blocks:terminal[0].blocks}};
   }
   if(!ancestor&&!exact.length){const moved=gone.filter(d=>d.revision===file.sha256&&!claimed.has(d.id)),copies=scan.files.filter(f=>f.sha256===file.sha256&&!terminals.some(r=>r.path===f.path));
    if(moved.length===1&&copies.length===1){ancestor={...moved[0],data:{blocks:moved[0].blocks}};claimed.add(ancestor.id);}
    else if(moved.length)throw Object.assign(new Error('A copy or rename cannot be assigned uniquely.'),{code:'shadow_ambiguous'});
   }
   requireThat(!exact.length||!terminals.some(r=>r.id===exact[0].id&&r.path!==file.path&&scan.files.some(f=>f.path===r.path&&f.sha256===r.revision)),'shadow_ambiguous','This historical identity is active at another path; a copy cannot reuse it.');
   const id=exact[0]?.id??ancestor?.id??await wiki.store.services.hash(JSON.stringify([SHADOW_FORMAT,wiki.id,file.path,file.sha256]));
   let data;
   if(exact.length)data=mapped(parsed,exact[0]);
   else{const blocks=await matchBlocks(ancestor?.data.blocks??[],parsed.blocks,wiki.store.services);
    for(const block of blocks)if(block.mapping!=='unchanged')block.id=await wiki.store.services.hash(JSON.stringify([id,block.occurrence]));
    data={...parsed,blocks};
   }
   data.origin=wiki.store.root??null;data.identity_previous=exact.length?(exact[0].previous_revision?{revision:exact[0].previous_revision,path:exact[0].previous_path}:null):ancestor&&(ancestor.revision!==file.sha256||ancestor.path!==file.path)?{revision:ancestor.revision,path:ancestor.path}:null;const row={wiki:wiki.id,path:file.path,id,revision:file.sha256,data};
   requireThat((await wiki.store.read(file.path))?.sha256===file.sha256,'shadow_stale','The document changed during structural indexing.');
   updates.push(row);if(!exact.length)records.push(identityRecord(row,data.identity_previous));
  }catch(error){findings.push(issue(wiki.id,error,file.path));}
  for(const old of gone){remove.push({wiki:wiki.id,path:old.path});if(!claimed.has(old.id))records.push({id:old.id,path:old.path,revision:null,parser:PARSER_VERSION,previous_revision:old.revision,previous_path:old.path,blocks:[]});}
  for(const old of cached.filter(d=>scan.full_scan!==false&&!scan.paths.has(d.path)))if(!remove.some(r=>r.wiki===wiki.id&&r.path===old.path))remove.push({wiki:wiki.id,path:old.path});
  // Check all observed files again immediately before publishing revisions.
  for(const row of updates.filter(r=>r.wiki===wiki.id))requireThat((await wiki.store.read(row.path))?.sha256===row.revision,'shadow_stale','The document changed before publishing its identity.');
  findings.push(...exchange.findings.filter(f=>!records.some(r=>r.path===f.page&&r.revision===f.revision)).map(f=>({wiki:wiki.id,...f})));
  batches.push({wiki,records});
 }catch(error){findings.push(issue(wiki.id,error));for(let i=updates.length-1;i>=0;i--)if(updates[i].wiki===wiki.id)updates.splice(i,1);for(let i=remove.length-1;i>=0;i--)if(remove[i].wiki===wiki.id)remove.splice(i,1);}
 // Immutable exchange first; a failed SQLite commit can be reconstructed from it.
 // Never publish a new document observation without the matching source hash.
 let shared_bytes=0,packages=0;
 for(const batch of batches)try{const result=await publish(batch.wiki,batch.records,options);shared_bytes+=result.shared_bytes;packages+=result.packages;}catch(error){shared_bytes+=error.details?.shared_bytes??0;packages+=error.details?.packages??0;findings.push(issue(batch.wiki.id,error,error.details?.path));for(let i=updates.length-1;i>=0;i--)if(updates[i].wiki===batch.wiki.id)updates.splice(i,1);for(let i=remove.length-1;i>=0;i--)if(remove[i].wiki===batch.wiki.id)remove.splice(i,1);}
 if(updates.length||remove.length)db.commit(updates,{expected,remove});
 return {complete:findings.length===0,full_scan:scans.length===wikis.length&&scans.every(Boolean),scope:scans.some(s=>!s)?'paths':'full',...(scans.some(s=>!s)?{next:'Known paths checked. Full refresh, workflow completion or sync reconciles external edits, additions, deletions and renames; query independently checks current source bytes.'}:{}),parsed:parsedCount,unchanged,updated:updates.length,removed:remove.length,shared_bytes,packages,findings};
}

export async function readShadow(wikis,db,options={}){
 scopes(wikis);const documents=[],findings=[];
 for(const wiki of wikis)try{const scan=await currentFiles(wiki,options);let exchange={records:[],findings:[]};if(db)try{exchange=await history(wiki,options);}catch(error){findings.push(issue(wiki.id,error));}const past=exchange.records,cached=new Map((db?.documents(wiki.id)??[]).filter(d=>!d.data.origin||d.data.origin===wiki.store.root).map(d=>[d.path,d]));findings.push(...scan.findings,...exchange.findings.map(f=>({wiki:wiki.id,...f})));
  for(const file of scan.files)try{let old=cached.get(file.path);const exact=past.filter(r=>r.path===file.path&&r.revision===file.sha256);if(!exact.length)old=null;if(new Set(exact.map(r=>JSON.stringify([r.id,r.blocks.map(b=>b.id)]))).size>1){old=null;findings.push({wiki:wiki.id,page:file.path,code:'shadow_ambiguous',message:'Conflicting identities for this revision; passage retrieval remains unpersisted.'});}if(old?.revision===file.sha256&&old.data.source===file.text&&old.data.parser===PARSER_VERSION)documents.push({...old,state:'current'});
   else{const data=await parseShadow(file.text,wiki.store.services,options);data.blocks=data.blocks.map(b=>({...b,id:null,mapping:'unpersisted',predecessors:[]}));documents.push({wiki:wiki.id,path:file.path,id:null,revision:file.sha256,data,state:'fallback'});}
  }catch(error){findings.push(issue(wiki.id,error,file.path));}
 }catch(error){findings.push(issue(wiki.id,error));}
 return {documents,findings,mode:db?'sqlite':'memory',persistent:findings.length===0&&documents.every(d=>d.state==='current')&&Boolean(db)};
}

export async function pinQuote(wikis,db,{wiki,document,revision,occurrence,start,end,maxBytes=8*1024*1024}={}){
 scopes(wikis);const scope=wikis.find(w=>w.id===wiki);requireThat(scope&&db&&!db.readOnly,'shadow_access','Select an accessible wiki with a maintained local shadow.');
 const rows=db.documents(wiki).filter(d=>d.id===document&&d.revision===revision&&(!d.data.origin||d.data.origin===scope.store.root));requireThat(rows.length===1,'shadow_quote','Maintain and select one current document revision before retaining its quote.');
 const row=rows[0],past=(await history(scope)).records,exact=past.filter(r=>r.path===row.path&&r.revision===revision);requireThat(exact.length&&new Set(exact.map(r=>JSON.stringify([r.id,r.blocks.map(b=>b.id)]))).size===1,'shadow_ambiguous','Missing or conflicting histories cannot retain an unambiguous quote.');const block=row.data.blocks.find(b=>b.occurrence===occurrence);requireThat(block,'shadow_quote','Select a known occurrence.');
 requireThat((await scope.store.read(row.path))?.sha256===revision,'shadow_stale','The quoted document changed.');
 const locator={...makeLocator(wiki,document,row.data,block,{start,end}),page:row.path},text=JSON.stringify({format:SHADOW_FORMAT,kind:'quote',locator}),id=await scope.store.services.hash(text),name=PINS+'/'+id+'.json';
 const existing=await scope.store.read(name);if(existing){requireThat(existing.text===text,'shadow_quote','Conflicting quote record.');return {id,locator,shared_bytes:0};}
 let bytes=new TextEncoder().encode(text).length;for(const entry of await files(scope.store,PINS)){const file=await scope.store.read(entry.path);bytes+=file?.size??0;}
 requireThat(Number.isSafeInteger(maxBytes)&&maxBytes>0&&bytes<=maxBytes,'shadow_pin_budget','The protected quote budget is full. Existing evidence has been retained.',{bytes,maxBytes});
 requireThat((await scope.store.read(row.path))?.sha256===revision,'shadow_stale','The quoted document changed before it could be retained.');await scope.store.write(name,text,{expected:null});
 return {id,locator,shared_bytes:new TextEncoder().encode(text).length};
}

export async function resolveQuote(wikis,id){
 scopes(wikis);requireThat(hex(id),'shadow_quote','Supply a retained quote identifier.');
 for(const wiki of wikis){const pin=await wiki.store.read(PINS+'/'+id+'.json');if(!pin)continue;
  requireThat(await wiki.store.services.hash(pin.text)===id,'shadow_quote','The retained quote checksum is invalid.');const data=JSON.parse(pin.text),locator=data.locator;
  requireThat(data.format===SHADOW_FORMAT&&data.kind==='quote'&&locator?.wiki===wiki.id,'shadow_quote','The quote is not in this wiki scope.');relativePath(locator.page);
  const records=(await history(wiki)).records,scan=await currentFiles(wiki);requireThat(!scan.findings.length,'shadow_access','The current wiki cannot be read completely.');
  // Match current bytes to witnessed document identities, including renames.
  const candidates=[];
  for(const file of scan.files){const recordsForFile=records.filter(r=>r.path===file.path&&r.revision===file.sha256);if(recordsForFile.some(r=>r.id===locator.document))candidates.push({file,records:recordsForFile});}
  if(candidates.length!==1)return {id,...resolveLocator(locator,null),state:'historical',successor_state:candidates.length?'ambiguous':scan.files.some(f=>f.path===locator.page)?'unindexed':'missing',page:locator.page,wiki:wiki.id,revision:locator.revision};
  const {file,records:matching}=candidates[0];requireThat(new Set(matching.map(r=>JSON.stringify([r.id,r.blocks.map(b=>b.id)]))).size===1,'shadow_ambiguous','Conflicting document histories cannot resolve this quote.');
  let current;try{current=mapped(await parseShadow(file.text,wiki.store.services),matching[0]);}catch(error){if(error.code!=='shadow_history')throw error;return {id,...resolveLocator(locator,null),state:'historical',successor_state:'unindexed',page:locator.page,wiki:wiki.id,revision:locator.revision,next:'Refresh the shadow to migrate legacy source coordinates; the retained quotation is unchanged.'};}requireThat((await wiki.store.read(file.path))?.sha256===file.sha256,'shadow_stale','The document changed while resolving the quote.');
  return {id,...resolveLocator(locator,current),page:file.path,wiki:wiki.id,revision:locator.revision,current_revision:file.sha256,locator};
 }
 throw Object.assign(new Error('The retained quote is not available in an accessible wiki.'),{code:'shadow_access'});
}

/** Resolve a Query link from current bytes or a uniquely witnessed unchanged block. */
export async function resolvePassage(wikis,token,{project,instance}={}){
 scopes(wikis);const p=decodePassage(token);requireThat(p.project===project&&p.instance===instance,'citation_scope','This passage belongs to another project instance.');
 const wiki=wikis.find(w=>w.id===p.wiki&&w.connection===p.connection&&w.work===p.work);requireThat(wiki,'citation_scope','The cited working copy is not connected and accessible.');
 const unavailable=reason=>({state:'unavailable',reason,page:p.page,wiki:p.wiki,revision:p.revision,current:null,quote:null,retained:false});
 const checked=async(file,start,end,state)=>{
  requireThat(start>=0&&end<=file.text.length&&end>start,'citation_stale','The cited range no longer exists.');const quote=file.text.slice(start,end);
  requireThat(await wiki.store.services.hash(quote)===p.quote_hash,'citation_stale','The passage no longer matches its quoted wording.');
  requireThat((await wiki.store.read(file.path))?.sha256===file.sha256,'citation_stale','The document changed while opening the passage.');
  return {state,page:file.path,wiki:p.wiki,revision:p.revision,current_revision:file.sha256,quote,current:{start,end,id:p.block},retained:false};
 };
 const original=await wiki.store.read(p.page);if(original?.sha256===p.revision)return checked(original,p.start,p.end,'current');
 if(!p.document||!p.block)return unavailable(original?'changed':'missing');
 const records=(await history(wiki)).records,scan=await currentFiles(wiki);requireThat(!scan.findings.length,'shadow_access','The wiki cannot be checked completely.');
 const candidates=scan.files.filter(f=>records.some(r=>r.id===p.document&&r.path===f.path&&r.revision===f.sha256));
 if(candidates.length!==1)return unavailable(candidates.length?'ambiguous':original?'unindexed':'missing');
 const file=candidates[0],exact=records.filter(r=>r.path===file.path&&r.revision===file.sha256);
 requireThat(new Set(exact.map(r=>JSON.stringify([r.id,r.blocks.map(b=>b.id)]))).size===1,'shadow_ambiguous','Conflicting histories cannot resolve this passage.');
 const data=mapped(await parseShadow(file.text,wiki.store.services),exact[0]),blocks=data.blocks.filter(b=>b.id===p.block);
 if(blocks.length!==1)return unavailable('changed');const block=blocks[0],start=block.start+p.offset,end=start+p.end-p.start;
 if(end>block.end)return unavailable('changed');return checked(file,start,end,'unchanged_successor');
}
