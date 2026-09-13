/** Read-only incremental planning. Missing originals never delete acquired knowledge. */
import {inventory} from './ingest.mjs';
import {parseDocument,patchHead,listValue} from './core/document.mjs';
import {visibleKnowledge,refreshIndex,sourceIntegrity} from './content.mjs';
import {requireThat,relativePath,nonempty} from './core/errors.mjs';
import {save} from './review.mjs';
import {buildGraph,resolveEvidence} from './core/graph.mjs';

export async function plan(store,source,options={}){
  return compareInventory(store,source,await inventory(source,options),options);
}
/** A complete names snapshot avoids re-reading absent originals during monitor resume. */
export async function compareInventory(store,source,originals,{prefix='',paths,listedPaths=null}={}){
  if(prefix)relativePath(prefix);if(paths){requireThat(Array.isArray(paths),'paths','Select source-relative paths.');paths.forEach(p=>relativePath(p));}
  const selected=p=>(!prefix||p===prefix||p.startsWith(prefix+'/'))&&(!paths||paths.includes(p));
  const byName=new Map(originals.map(f=>[f.path,f])),mirrors=[];
  for(const e of await store.list(''))if(e.kind==='file'&&visibleKnowledge(e.path)){const f=await store.read(e.path),p=parseDocument(f.text);if(p.head.resource?.store===source.id)mirrors.push({page:e.path,expectedPage:f.sha256,source_id:p.head.source_id??p.head.id,resource:p.head.resource,integrity:await sourceIntegrity(store,p)});}
  const known=new Map(mirrors.map(m=>[m.resource.name,m])),changes=[];
  for(const f of originals){const prior=known.get(f.path);if(f.error){changes.push({...f,state:'unreadable'});continue;}
    if(prior){changes.push({...f,...prior,state:prior.resource.sha256!==f.sha256||prior.resource.availability==='missing'?'changed':prior.integrity.complete?'unchanged':'repair_required'});continue;}
    // A rename is only a candidate when the old original is actually absent and
    // both sides are unique. Copies with equal content remain separate sources.
    const candidates=[];for(const m of mirrors.filter(m=>selected(m.resource.name)&&m.resource.sha256===f.sha256))if(listedPaths?!listedPaths.has(m.resource.name):!await source.store.read(m.resource.name,{binary:true}))candidates.push(m);
    const unique=(!listedPaths||!originals.some(o=>o.error))&&originals.filter(o=>o.sha256===f.sha256&&!known.has(o.path)).length===1;
    changes.push({...f,state:candidates.length===1&&unique?'renamed':'new',...(candidates.length===1&&unique?candidates[0]:{}),previous_name:candidates.length===1&&unique?candidates[0].resource.name:undefined});
  }
  for(const m of mirrors)if(selected(m.resource.name)&&!byName.has(m.resource.name)&&!changes.some(c=>c.state==='renamed'&&c.page===m.page))changes.push({...m,path:m.resource.name,state:'missing'});
  const reviewable=changes.filter(c=>c.page&&c.state!=='unchanged');
  if(reviewable.length){
    const graph=await buildGraph([{id:'local',store}],{allowMissingRegister:true});
    // Citations and incoming typed links identify review candidates, not automatic
    // changes to claims. Navigation links alone do not establish dependency.
    const dependents=new Map();
    const add=(key,page,reason)=>{if(!dependents.has(key))dependents.set(key,[]);dependents.get(key).push({page,reason});};
    for(const p of graph.pages.values())for(const citation of listValue(p.head.sources)){const evidence=resolveEvidence(graph,citation,p.wiki);if(evidence)add(evidence.key,p,'source citation');}
    for(const edge of graph.edges)if(edge.valid&&edge.type)add(edge.target,graph.pages.get(edge.source),'typed relation: '+edge.type);
    for(const change of reviewable){
      const origin=[...graph.pages.values()].find(p=>p.path===change.page),seen=new Set(origin?[origin.key]:[]),queue=origin?[origin.key]:[];change.affected=[];
      while(queue.length)for(const {page,reason} of dependents.get(queue.shift())??[]){if(seen.has(page.key))continue;seen.add(page.key);queue.push(page.key);change.affected.push({page:page.path,expected:page.sha256,reason,review_required:true});}
    }
  }
  return {source:source.id,scope:{prefix,paths:paths??null},changes,counts:Object.fromEntries(['new','changed','unchanged','repair_required','renamed','missing','unreadable'].map(s=>[s,changes.filter(c=>c.state===s).length]))};
}
export async function markMissing(store,source,{page,expected,author,reason}){
  nonempty(author,'author');nonempty(reason,'reason');const f=await store.read(page);requireThat(f&&f.sha256===expected,'stale','Read the current source page.');const p=parseDocument(f.text);
  requireThat(p.head.resource?.store===source.id&&!await source.store.read(p.head.resource.name,{binary:true}),'source','The original must be absent from this source root.');
  await save(store,page,patchHead(f.text,{resource:{...p.head.resource,availability:'missing',checked_at:store.services.now(),missing_reason:reason}}),author,expected);await refreshIndex(store);
  return {page,preserved:true,deleted:0,availability:'missing'};
}
