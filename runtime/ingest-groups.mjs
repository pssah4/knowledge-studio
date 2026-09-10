/** ADR-12/25/26: approve independent groups using the actual ingestion write set. */
import {OverlayStore} from './adapters/vault.mjs';
import {ingest} from './ingest.mjs';
import {requireThat,nonempty,relativePath} from './core/errors.mjs';
import {proposal,prepareChanges,operateChanges,extendChanges,readChanges} from './change-set.mjs';
import {visibleKnowledge} from './content.mjs';
const decode=value=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Uint8Array.from(atob(value),c=>c.charCodeAt(0)));
export async function ingestGroup(c,args,{extract}={}){
 const {step='preview',sources,author,label}=args;
 const check=async data=>{for(const dep of data.dependencies){const source=c.sources.find(s=>s.id===dep.source);requireThat(source?.store&&(await source.store.read(dep.path,{binary:true}))?.sha256===dep.expected,'stale','A group original changed after preview.',{source:dep.source,path:dep.path});}};
 if(!['preview','prepare'].includes(step))return operateChanges(c.work,args,'ingest-group',{check});
 nonempty(author,'author');nonempty(label,'group label');requireThat(Array.isArray(sources)&&sources.length&&sources.length<=100,'group','Choose 1–100 source files per group.');const selected=[],seen=new Set();
 for(const item of sources){relativePath(item.path);const source=c.sources.find(s=>s.id===item.source);requireThat(source?.store,'access','Select an assigned readable original folder.');const key=JSON.stringify([source.id,item.path]);requireThat(!seen.has(key),'group','A source may occur only once per group.');seen.add(key);const file=await source.store.read(item.path,{binary:true});requireThat(file,'source','An original is missing.');selected.push({source:source.id,path:item.path,expected:file.sha256,description:item.description??label,...(item.page?{page:item.page}:{}),...(item.expectedPage?{expectedPage:item.expectedPage}:{}),...(item.supplement?{supplement:item.supplement}:{})});}
 const token=await c.work.services.hash(JSON.stringify({label,author,sources:selected,connection:c.connection,wiki:c.wiki,work:c.workFolder}));
 if(step==='preview')return {token,readers:c.wiki.readers,sources:selected,complete:false,read_only:true,next:'prepare then review the exact changes before apply; no original or knowledge file has changed'};
 requireThat(args.expected===token,'stale_preview','The selected group changed; review it again.');const overlay=new OverlayStore(c.work),outputs=[];
 for(const item of selected){const source=c.sources.find(s=>s.id===item.source);outputs.push(await ingest(overlay,source,item.path,{...item,author,extract,linkRoot:c.remote.root}));}
 const changes=[];for(const row of overlay.state.changes.values()){
  // Navigation is rebuilt from current pages after apply, so independently
  // prepared groups never restore a stale index over another group's result.
  if(row.page==='wiki/index.md'||row.page.startsWith('.llmwiki/graph')||row.page.startsWith('.llmwiki/derived-relations/'))continue;
  requireThat(typeof row.text==='string','group','Only text knowledge writes belong to an ingestion group.');const before=row.before===null?null:decode(row.before);
  if(before!==row.text)changes.push({page:row.page,expected:row.expected,text:row.text,reversible:visibleKnowledge(row.page)||row.page.startsWith('.llmwiki/workflows/')});
 }
 const preview=await proposal(c.work,{kind:'ingest-group',label,author,changes,dependencies:selected.map(s=>({source:s.source,path:s.path,expected:s.expected})),details:{sources:selected,outputs,readers:c.wiki.readers,semantic_complete:false,next:'workflow.start; a complete source mirror is not completed semantic integration'}});
 const plan=await prepareChanges(c.work,preview,preview.token);return {...plan,changes:preview.changes.map(c=>({page:c.page,before:c.before,after:c.text,reversible:c.reversible})),outputs};
}

export async function recordGroupOperation(c,args,run){
 const {data}=await readChanges(c.work,args.group,'ingest-group');requireThat(data.state==='applied','state','Finish or resume the current group before curation.');const overlay=new OverlayStore(c.work),result=await run(overlay),changes=[];
 for(const row of overlay.state.changes.values()){if(row.page==='wiki/index.md'||row.page.startsWith('.llmwiki/graph')||row.page.startsWith('.llmwiki/derived-relations/'))continue;requireThat(typeof row.text==='string','group','Group curation retains text writes.');changes.push({page:row.page,expected:row.expected,text:row.text,reversible:visibleKnowledge(row.page)||row.page.startsWith('.llmwiki/workflows/')});}
 const group=await extendChanges(c.work,args.group,changes,{action:args.action,author:args.author??null});return {...result,group};
}
