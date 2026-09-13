import {parseDocument,transferForm} from './core/document.mjs';
import {contributions} from './review.mjs';

const visible=page=>!page.split('/').some(p=>p.startsWith('.'));
const documents=entries=>entries.filter(e=>e.kind==='file'&&/\.md$/i.test(e.path)&&visible(e.path));

/** Read-only file comparison. Sync selection can mark folder additions or archive
 * departed participation pages and must never run as part of readiness. */
export async function publicationDifferences(context){
 const c=context,scope=c.syncOptions.scope??'full',pairs=[];
 if(scope==='contributions'){
  const {target,owner}=c.syncOptions.contributionMeta;
  for(const {path:page}of documents(await c.work.list(''))){
   if(page.split('/').some(p=>['schema','notices','vermerke'].includes(p)))continue;
   const local=await c.work.read(page),head=parseDocument(local.text).head;
   if(!head.id||!Array.isArray(head.contribute_to)||!head.contribute_to.includes(target.bundle_id))continue;
   const seen=await c.work.read(await contributions.recordPath(head.id,target.bundle_id));if(!seen)continue;
   const record=JSON.parse(seen.text);
   if(record.format!=='llmwiki-contribution/1'||record.closed||record.document!==head.id||record.target!==target.bundle_id||record.owner!==owner.bundle_id||record.page!==page||!(record.releases??[record.release]).some(Boolean))continue;
   pairs.push({page,destination:record.destination,local,remote:await c.remote.read(record.destination)});
  }
 }else if(scope==='participation'){
  for(const {path:page}of documents(await c.remote.list(''))){
   const remote=await c.remote.read(page);if(parseDocument(remote.text).head[c.syncOptions.participation.field]!==true)continue;
   pairs.push({page,local:await c.work.read(page),remote});
  }
 }else{
  const files=new Set([...await c.work.list(''),...await c.remote.list('')].filter(e=>e.kind==='file'&&(e.path==='schema/FIELDS.json'||/\.md$/i.test(e.path))&&visible(e.path)).map(e=>e.path));
  for(const page of files)pairs.push({page,local:await c.work.read(page),remote:await c.remote.read(page)});
 }
 const differs=({local,remote})=>scope==='contributions'?(!local||!remote||transferForm(local.text)!==transferForm(remote.text)):local?.sha256!==remote?.sha256;
 return pairs.filter(differs).map(({page,destination,local,remote})=>({wiki:c.wiki.id,connection:c.connection.id,page,...(destination?{destination}:{}),local:local?.sha256??null,remote:remote?.sha256??null}));
}
