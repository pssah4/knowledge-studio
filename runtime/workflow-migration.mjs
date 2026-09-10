/** Mechanical path migration preserves prior reviews only for proven unchanged preimages. */
import {statementText,parseDocument} from './core/document.mjs';
import {requireThat} from './core/errors.mjs';
const digest=(store,text)=>{const p=parseDocument(text);return store.services.hash(JSON.stringify(p.head)+'\n'+statementText(p.body).replace(/\r\n?/g,'\n').trimEnd());};
export async function migrateWorkflowPaths(store,plan){
 let files;try{files=await store.list('.llmwiki/workflows');}catch(e){if(e.code==='ENOENT'||e.name==='NotFoundError')return;throw e;}
 const changes=new Map(plan.changes.map(c=>[c.from,c]));
 function rewrite(value,key=''){
  if(typeof value==='string')return ['quote','statement','reason'].includes(key)?value:plan.mapping[value]??value;
  if(Array.isArray(value))return value.map(v=>rewrite(v,key));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[plan.mapping[k]??k,rewrite(v,k)]));
  return value;
 }
 for(const f of files)if(f.kind==='file'&&f.path.endsWith('.json')){
  const seen=await store.read(f.path),original=JSON.parse(seen.text);if(original.format!=='llmwiki-workflow/1')continue;
  const data=rewrite(original);
  for(const [before,after]of [[original.review?.snapshots,data.review?.snapshots],[original.output_snapshots,data.output_snapshots]])if(before&&after){
   for(const [page,hash]of Object.entries(before)){
    const change=changes.get(page);if(!change||await digest(store,change.before)!==hash)continue;
    const current=await store.read(change.to);requireThat(current,'migration','A moved workflow page is missing.');
    // Only this plan's exact result (plus deterministic derived navigation) is eligible.
    if(await digest(store,current.text)===await digest(store,change.text))after[change.to]=await digest(store,current.text);
   }
  }
  if(data.review&&JSON.stringify(data.review)!==JSON.stringify(original.review)){
   const prior=data.review.sha256??original.review_sha256,copy={...data.review};delete copy.sha256;
   data.review.sha256=await store.services.hash(JSON.stringify(copy));data.review_sha256=data.review.sha256;
   for(const decision of data.decisions||[])if((decision.review_sha??decision.review_sha256)===prior){decision.review_sha=data.review.sha256;decision.review_sha256=data.review.sha256;}
  }
  const text=JSON.stringify(data,null,2)+'\n';if(JSON.stringify(data)===JSON.stringify(original))continue;
  const backup='.llmwiki/moves/'+plan.id+'/state/'+f.path;if(!await store.read(backup))await store.write(backup,seen.text,{expected:null});
  await store.write(f.path,text,{expected:seen.sha256});
 }
}
