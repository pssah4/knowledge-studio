/** ADR-06/09/26: exact, reviewable changes with resumable apply and selective rollback.
 * The journal is local maintenance state, never a promise of multi-file atomicity.
 */
import {parseDocument} from './core/document.mjs';
import {readRegister} from './core/ontology.mjs';
import {save,reviews,handle} from './review.mjs';
import {relativePath,requireThat,nonempty} from './core/errors.mjs';
export const encodeBytes=bytes=>{let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);};
const decodeBytes=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
const payload=(c,value=c.text)=>c.encoding==='base64'?decodeBytes(value):value;
const journalTarget=(store,c)=>store.reviewStore?.(c.page)??{store,page:c.page};
const authored=c=>c.encoding!=='base64'&&!c.page.includes('.llmwiki/')&&(c.page.endsWith('.md')||c.page.endsWith('schema/FIELDS.json'));
async function finishReceipt(store,c,author,text,base){const target=journalTarget(store,c),dir=handle(target.store),journal=await reviews.read(dir,target.page),match=e=>e.text===text&&e.base===(base??'')&&e.author===author;if(journal.events.some(match))return;const pending=journal.pending.find(match);requireThat(pending&&await reviews.receipt(dir,pending),'receipt','The exact write needs its review receipt before completion.',{page:c.page});}
async function retireRecord(store,c,data){const target=journalTarget(store,c),value={format:'llmwiki-retirement/1',page:target.page,expected:c.after,author:data.author,stage:data.id},text=JSON.stringify(value),path='.llmwiki/retirements/'+await store.services.hash(text)+'.json';if(!await target.store.read(path))await target.store.write(path,text,{expected:null});}
const readImage=(store,c)=>store.read(c.page,{binary:c.encoding==='base64'});
const immutable=data=>Object.fromEntries(['format','kind','folder','label','author','changes','dependencies','details'].map(k=>[k,data[k]]));
const recordPath=id=>{requireThat(/^[a-f0-9-]{36}$/.test(id),'plan','Invalid change plan.');return '.llmwiki/changes/'+id+'.json';};
export async function proposal(store,{kind,folder='',label,author,changes,dependencies=[],details={}}){
 relativePath(folder,{root:true});nonempty(author,'author');nonempty(label,'stage label');requireThat(Array.isArray(changes),'changes','Provide the proposed changes.');const seen=new Set(),rows=[];
 for(const change of changes){relativePath(change.page);requireThat(!seen.has(change.page),'changes','A stage may change each file only once.');seen.add(change.page);const before=await readImage(store,change);requireThat((before?.sha256??null)===change.expected,'stale','A proposed file changed.',{page:change.page});requireThat(typeof change.text==='string','changes','Changes must preserve text files.');const old=before?(change.encoding==='base64'?encodeBytes(before.bytes):before.text):null;if(old===change.text)continue;rows.push({page:change.page,before:old,expected:change.expected,text:change.text,after:await store.services.hash(payload(change)),reversible:change.reversible!==false,...(change.encoding?{encoding:change.encoding,copy_from:change.copy_from}:{})});}
 const data={format:'llmwiki-changes/1',kind,folder,label,author,changes:rows,dependencies,details};return {...data,token:await store.services.hash(JSON.stringify(data)),complete:false};
}
export async function prepareChanges(store,preview,expected){requireThat(expected===preview.token,'stale_preview','Review the current preview before preparing this stage.');const id=store.services.uuid(),data={...preview,id,state:'prepared',applied:[],restored:[],pending:null};await store.write(recordPath(id),JSON.stringify(data),{expected:null});return {id,kind:data.kind,state:data.state,token:data.token,changes:data.changes.length,details:data.details,complete:false,next:'apply or decline'};}
export async function readChanges(store,id,kind){const file=await store.read(recordPath(id));requireThat(file,'plan','Change plan is missing.');const data=JSON.parse(file.text);requireThat(data.format==='llmwiki-changes/1'&&data.id===id&&(!kind||data.kind===kind),'plan','This plan belongs to another operation.');requireThat(await store.services.hash(JSON.stringify(immutable(data)))===data.token,'plan_integrity','The saved proposal changed. Restore its original record.');return {data,file};}
async function persist(store,data,file){return store.write(recordPath(data.id),JSON.stringify(data),{expected:file.sha256});}
async function registerInUse(store,c,data){
 if(!['schema/TYPES.md','schema/FIELDS.json'].includes(c.page))return false;
 const types=c.page==='schema/TYPES.md',before=types?(c.before?[...readRegister(c.before).genera.keys()]:[]):(c.before?JSON.parse(c.before).fields.map(f=>f.name):[]),after=types?[...readRegister(c.text).genera.keys()]:JSON.parse(c.text).fields.map(f=>f.name),removed=after.filter(f=>!before.includes(f));if(!removed.length)return false;
 for(const entry of await store.list('')){if(entry.kind!=='file'||!entry.path.endsWith('.md')||entry.path.startsWith('schema/'))continue;const file=await store.read(entry.path),initial=data.details.adopted_pages?.find(p=>p.page===entry.path);if(initial?.expected===file?.sha256)continue;try{const head=parseDocument(file.text).head;if(types?removed.includes(head.type):removed.some(f=>Object.hasOwn(head,f)))return true;}catch{return true;}}
 return false;
}
export async function operateChanges(store,{id,step,approved},kind,{check=async()=>{}}={}){
 let {data,file}=await readChanges(store,id,kind);const result=(extra={})=>({id,kind:data.kind,state:data.state,details:data.details,changes:data.changes.map(c=>({page:c.page,expected:c.expected,after:c.after})),complete:['applied','rolled_back','declined'].includes(data.state),...extra});
 if(step==='status')return result();
 if(step==='decline'){requireThat(data.state==='prepared'||data.state==='declined','state','A started stage must be rolled back.');data.state='declined';await persist(store,data,file);return result();}
 requireThat(['apply','rollback'].includes(step),'step','Choose preview, prepare, apply, decline, status or rollback.');requireThat(approved===true,'approval','Explicitly approve this stage or its rollback.');
 const checkpoint=async()=>{await persist(store,data,file);file=await store.read(recordPath(id));};
 if(step==='apply'){
  requireThat(['prepared','applying','applied'].includes(data.state),'state','A declined or rolled-back stage cannot be applied.');if(data.state==='applied')return result();await check(data);
  for(let i=0;i<data.changes.length;i++){if(data.applied.includes(i))continue;const c=data.changes[i],current=await readImage(store,c);requireThat((current?.sha256??null)===(c.apply_expected??c.expected)||data.pending===i&&current?.sha256===c.after,'stale','A file changed after preview.',{page:c.page});}
  data.state='applying';await checkpoint();
  for(let i=0;i<data.changes.length;i++){
   if(data.applied.includes(i))continue;const c=data.changes[i],current=await readImage(store,c);
   if(!(data.pending===i&&current?.sha256===c.after)){data.pending=i;await checkpoint();if(c.encoding==='base64'&&store.capabilities?.textWritesOnly)return result({complete:false,requires_host_copy:{source:store.hostPath?.(c.copy_from)??c.copy_from,destination:store.hostPath?.(c.page)??c.page,expected:c.after},next:'Copy these exact bytes with the host file tool, then resume this approved stage.'});if(authored(c)&&data.kind!=='ingest-group'){const target=journalTarget(store,c);await save(target.store,target.page,c.text,data.author,c.apply_expected??c.expected);}else await store.write(c.page,payload(c),{expected:c.apply_expected??c.expected});}
   if(authored(c)&&data.kind!=='ingest-group')await finishReceipt(store,c,data.author,c.text,c.before);
   data.applied.push(i);data.pending=null;await checkpoint();
  }
  data.state='applied';await checkpoint();return result();
 }
 requireThat(['prepared','applying','applied','rolling_back','rolled_back'].includes(data.state),'state','This stage cannot be rolled back.');if(data.state==='rolled_back')return result();
 // A process may have died after its write but before the receipt checkpoint.
 if(data.pending!==null&&!data.applied.includes(data.pending)){const c=data.changes[data.pending],current=await readImage(store,c);if(current?.sha256===c.after)data.applied.push(data.pending);else requireThat((current?.sha256??null)===(c.apply_expected??c.expected),'stale','An interrupted write changed again.',{page:c.page});data.pending=null;}
 data.state='rolling_back';await checkpoint();const conflicts=[];
 for(const i of [...new Set([...data.applied,...data.changes.flatMap((c,i)=>c.prior?[i]:[])])].reverse()){
  if(data.restored.includes(i))continue;const planned=data.changes[i],c=data.applied.includes(i)?planned:{...planned,...planned.prior};if(!c.reversible){data.restored.push(i);await checkpoint();continue;}
  const current=await readImage(store,c);
  if(data.rollback_pending===i&&(current?.sha256??null)===c.expected){if(c.before===null)requireThat((await store.read('.llmwiki/changes/'+id+'/retired/'+c.page,{binary:c.encoding==='base64'}))?.sha256===c.after,'archive_missing','Verify the archived file before completing rollback.',{page:c.page});else if(authored(c))await finishReceipt(store,c,data.author,c.before,c.text);data.restored.push(i);data.rollback_pending=null;await checkpoint();continue;}
  if(current?.sha256!==c.after){conflicts.push({page:c.page,code:'later_change',expected:c.after,current:current?.sha256??null});continue;}
  if(await registerInUse(store,c,data)){conflicts.push({page:c.page,code:'register_in_use'});continue;}
  data.rollback_pending=i;await checkpoint();
  if(c.before===null){await retireRecord(store,c,data);const archive='.llmwiki/changes/'+id+'/retired/'+c.page;
   if(!store.archive)return result({complete:false,conflicts,requires_host_move:{source:store.hostPath?.(c.page)??c.page,destination:store.hostPath?.(archive)??archive,expected:c.after},next:'Archive the exact created file with the host move tool, then resume rollback.'});
   await store.archive(c.page,archive,c.after);
  }else if(authored(c)){const target=journalTarget(store,c);await save(target.store,target.page,c.before,data.author,c.after);}else await store.write(c.page,payload(c,c.before),{expected:c.after});
  data.restored.push(i);data.rollback_pending=null;await checkpoint();
 }
 data.state=conflicts.length?'rolling_back':'rolled_back';await checkpoint();return result({conflicts,complete:!conflicts.length});
}

/** Add actual curation writes to a previously approved group before applying them. */
export async function extendChanges(store,id,changes,operation){
 const {data,file}=await readChanges(store,id,'ingest-group');requireThat(data.state==='applied','state','Finish applying this group before adding curation writes.');
 for(const next of changes){const i=data.changes.findIndex(c=>c.page===next.page),current=await store.read(next.page);requireThat((current?.sha256??null)===next.expected,'stale','Curation changed during preparation.');
  if(i>=0){const previous=data.changes[i];requireThat(previous.after===next.expected,'group_changed','A later edit belongs to another change; do not fold it into this group.',{page:next.page});data.changes[i]={...previous,text:next.text,after:await store.services.hash(next.text),apply_expected:next.expected,prior:{after:previous.after,text:previous.text}};data.applied=data.applied.filter(n=>n!==i);}
  else data.changes.push({page:next.page,before:current?.text??null,expected:next.expected,text:next.text,after:await store.services.hash(next.text),reversible:next.reversible!==false});
 }
 data.details.operations=[...data.details.operations??[],operation];data.state='applying';data.token=await store.services.hash(JSON.stringify(immutable(data)));await persist(store,data,file);return operateChanges(store,{id,step:'apply',approved:true},'ingest-group');
}
