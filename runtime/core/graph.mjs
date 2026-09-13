/** Derived, scoped knowledge graph (ADR-03/13/21/26). Files carry all authoritative facts. */
import {stripNavigation,parseDocument,bodyLinks,relationRows,listValue,compareForm} from './document.mjs';
import {readRegister,edgeAllowed} from './ontology.mjs';
import {requireThat} from './errors.mjs';
import {replicaIdentity,validateHandover,validateRekey} from './contribution-identity.mjs';
import {handle,reviews} from '../review.mjs';

export const navigationPage=path=>['WIKI.md','index.md','bundle.md','wiki/index.md','wiki/bundle.md'].includes(path);
/** Retain navigation in the resolver, exclude it from visual/exported knowledge. */
export function graphProjection(graph){const pages=[...graph.pages.values()].filter(p=>!navigationPage(p.path)&&(!p.canonical||p.canonical===p.key)),keys=new Set(pages.map(p=>p.key));return {pages,edges:graph.edges.filter(e=>keys.has(e.source)&&keys.has(e.target))};}

export const pageKey=(wiki,page)=>JSON.stringify([wiki,page]);
const technical=path=>path.split('/').some(p=>p.startsWith('.')||p.startsWith('~$'))||/^(schema|meta|notices|vermerke)\//.test(path);
const add=(map,key,value)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(value);};
function normalize(parts){const result=[];for(const part of parts){if(part==='..'){if(!result.length)return null;result.pop();}else if(part&&part!=='.')result.push(part);}return result.join('/');}

export function resolvePage(graph,from,written){
  let text;
  try{text=decodeURIComponent(String(written).trim()).split('|')[0].split('#')[0];}catch{return {code:'invalid_link'};}
  if(!text||/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(text)||/[\\\x00-\x1f]/.test(text))return {code:'external_link'};
  if(/^(schema|meta|notices|vermerke)\//.test(text))return {code:'technical_link'};
  const origin=typeof from==='string'?graph.pages.get(from):from;
  const scope=graph.scopes.get(origin.wiki);
  const choose=keys=>keys.length===1?{key:keys[0]}:{code:keys.length?'ambiguous_link':'unresolved_link'};
  const local=(s,value)=>{
    const path=value.endsWith('.md')?value:value+'.md';
    if(s.paths.has(path))return {key:s.paths.get(path)};
    if(s.ids.has(value))return choose(s.ids.get(value));
    return !value.includes('/')?choose(s.names.get(value.replace(/\.md$/,''))??[]):{code:'unresolved_link'};
  };
  if(text.startsWith('./')||text.startsWith('../')){
    const relative=normalize([...origin.path.split('/').slice(0,-1),...text.split('/')]);
    if(relative!==null){if(technical(relative))return {code:'technical_link'};const result=local(scope,relative);if(result.key||result.code==='ambiguous_link')return result;}
    if(scope.path!==null&&scope.path!==undefined){
      const full=normalize([...scope.path.split('/'),...origin.path.split('/').slice(0,-1),...text.split('/')]);
      if(full!==null)return choose(graph.projectPaths.get(full.endsWith('.md')?full:full+'.md')??[]);
    }
    return {code:'unresolved_link'};
  }
  const direct=local(scope,text);
  if(direct.key||direct.code==='ambiguous_link')return direct;
  if(text.includes('/')){
    const split=text.indexOf('/'),prefix=text.slice(0,split),rest=text.slice(split+1);
    const exact=graph.scopes.get(prefix);
    const matches=exact?[exact]:[...graph.scopes.values()].filter(s=>s.label===prefix||s.path===prefix);
    if(matches.length===1)return local(matches[0],rest);
    if(matches.length>1)return {code:'ambiguous_link'};
    return choose(graph.projectPaths.get(text.endsWith('.md')?text:text+'.md')??[]);
  }
  return choose(graph.names.get(text.replace(/\.md$/,''))??[]);
}

async function contributionSourceHints(store){
 const found=new Set();if(!store.services)return found;let entries=[];
 try{entries=await store.list('.llmwiki/contributions/from',{hidden:true});}catch(error){if(error.code!=='ENOENT'&&error.name!=='NotFoundError')throw error;}
 for(const entry of entries.filter(e=>e.kind==='file'&&e.path.endsWith('.json'))){
  const state=JSON.parse((await store.read(entry.path)).text),id=state?.document;
  if(state?.format==='llmwiki-contribution-state/1'&&typeof id==='string'&&typeof state.owner==='string'&&typeof state.target==='string'&&state.owner!==state.target&&typeof state.root==='string'&&entry.path==='.llmwiki/contributions/from/'+encodeURIComponent(state.owner)+'/'+encodeURIComponent(id)+'.json')found.add(id);
 }return found;
}

export async function buildGraph(wikis,{allowMissingRegister=false}={}){
  requireThat(Array.isArray(wikis)&&wikis.length>0&&new Set(wikis.map(w=>w.id)).size===wikis.length,'scope','Select unique accessible wikis.');
  const graph={pages:new Map(),scopes:new Map(),names:new Map(),projectPaths:new Map(),evidence:new Map(),edges:[],findings:[],failures:[],redirects:[]};
  for(const wiki of wikis){
    const scope={...wiki,paths:new Map(),names:new Map(),ids:new Map(),register:null};graph.scopes.set(wiki.id,scope);
    try{
      const register=await wiki.store.read('schema/TYPES.md');
      if(!register&&allowMissingRegister)graph.failures.push({wiki:wiki.id,code:'ontology',message:'Wiki has no type register; typed relations cannot be validated.'});
      else {requireThat(register,'ontology','Wiki has no type register.');scope.register=readRegister(register.text);}
      const sourceHints=await contributionSourceHints(wiki.store);
      for(const entry of await wiki.store.list('')){
        if(entry.kind!=='file'||!entry.path.endsWith('.md')||technical(entry.path))continue;
        try{
          const file=await wiki.store.read(entry.path), parsed=parseDocument(file.text);
          if(parsed.head.llmwiki_redirect){graph.redirects.push({wiki:wiki.id,path:entry.path,target:parsed.head.llmwiki_redirect});continue;}
          const key=pageKey(wiki.id,entry.path),page={...parsed,key,wiki:wiki.id,path:entry.path,sha256:file.sha256};
          // The document-only browser projection can supply journal events; real
          // stores always use the same receipt and path-alias reader as sync.
          const journal=file.events?{events:file.events,pending:[]}:wiki.store.services?await reviews.read(handle(wiki.store),entry.path):{events:[],pending:[]};
          const events=journal.events.filter(e=>e.source?.document===String(page.head.id??'')||e.kind!=='contribution_root'),handovers=[];
          if(page.head.id&&wiki.store.services){
           const folder='.llmwiki/contributions/handover/'+encodeURIComponent(page.head.id);let acts=[];
           try{acts=await wiki.store.list(folder,{recursive:false,hidden:true});}catch(error){if(error.code!=='ENOENT'&&error.name!=='NotFoundError')throw error;}
           for(const act of acts.filter(a=>a.kind==='file'&&a.path.endsWith('.json')))try{const record=JSON.parse((await wiki.store.read(act.path)).text);if(record.document===String(page.head.id)&&act.path===folder+'/'+record.id+'.json'&&validateHandover(record,events))handovers.push(record);}catch(error){graph.findings.push({code:'handover_invalid',wiki:wiki.id,page:entry.path,message:error.message});}
          }
          const rekeys=[];if(wiki.store.services){const bundleEvents=(await reviews.read(handle(wiki.store),'wiki/bundle.md')).events;let entries=[];try{entries=await wiki.store.list('.llmwiki/contributions/rekey',{recursive:false,hidden:true});}catch(error){if(error.code!=='ENOENT'&&error.name!=='NotFoundError')throw error;}
           for(const entry of entries.filter(v=>v.kind==='file'&&v.path.endsWith('.json'))){const trace=JSON.parse((await wiki.store.read(entry.path)).text);if(validateRekey(trace,bundleEvents))rekeys.push({trace,events:bundleEvents});}
          }
          const identity=replicaIdentity(events,{handovers,rekeys});
          if(handovers.length&&!identity)page.handover=handovers[0];
          if(identity?.conflict){page.replica_conflict=true;graph.findings.push({code:'owner_conflict',wiki:wiki.id,page:entry.path});}
          else if(identity){page.replica=identity;page.replica_covered=events.some(e=>e.norm===1&&['contribution_root','change','accept'].includes(e.kind)&&compareForm(e.text)===compareForm(file.text));}
          else if(!page.handover&&(page.head.shared_copy&&!page.head.shared_copy.until||journal.pending.some(e=>e.kind==='contribution_root')||sourceHints.has(String(page.head.id??'')))){page.replica_pending=true;graph.findings.push({code:'replica_pending',reason:'replica_root_missing',wiki:wiki.id,page:entry.path});}
          graph.pages.set(key,page);scope.paths.set(entry.path,key);
          const name=entry.path.split('/').pop().slice(0,-3);add(scope.names,name,key);add(graph.names,name,key);
          const id=String(page.head.id??'').trim();if(id)add(scope.ids,id,key);
          const evidence=String(page.head.source_id??page.head.id??'').trim();if(evidence)add(graph.evidence,evidence,key);
          if(wiki.path!==null&&wiki.path!==undefined){const p=normalize([...wiki.path.split('/'),...entry.path.split('/')]);if(p!==null)add(graph.projectPaths,p,key);}
        }catch(error){graph.failures.push({wiki:wiki.id,page:entry.path,code:error.code??'read',message:error.message});}
      }
    }catch(error){graph.failures.push({wiki:wiki.id,code:error.code??'read',message:error.message});}
  }
  for(const scope of graph.scopes.values()){
    const record=await scope.store.read('.llmwiki/identity-aliases.json');if(!record)continue;
    try{const data=JSON.parse(record.text);requireThat(data.format==='llmwiki-identity-aliases/1'&&Array.isArray(data.aliases),'identity','Invalid identity aliases.');
      for(const alias of data.aliases){const key=scope.paths.get(alias.path);requireThat(key&&typeof alias.id==='string'&&alias.id.trim(),'identity','Alias target is missing.');
        if(!scope.ids.has(alias.id)){add(scope.ids,alias.id,key);add(graph.evidence,alias.id,key);}
      }
    }catch(error){graph.findings.push({wiki:scope.id,code:'identity_alias_invalid',message:error.message});}
  }
  canonicalizeReplicas(graph);
  for(const r of graph.redirects){const target=graph.scopes.get(r.target.wiki),keys=target?.ids.get(r.target.id)??[],key=keys.length===1?keys[0]:null,page=graph.pages.get(key);if(!page)continue;const origin=graph.scopes.get(r.wiki);origin.paths.set(r.path,key);if(!origin.ids.has(r.target.id))origin.ids.set(r.target.id,[key]);const name=r.path.split('/').at(-1).replace(/\.md$/,'');if(!origin.names.has(name))origin.names.set(name,[key]);if(origin.path!=null)add(graph.projectPaths,origin.path+'/'+r.path,key);}
  for(const [id,keys] of graph.evidence)if(keys.length>1)graph.findings.push({code:'duplicate_id',id,pages:keys});
  const seen=new Set();
  for(const page of graph.pages.values()){
    if(navigationPage(page.path)||page.canonical&&page.canonical!==page.key)continue;
    const authored=stripNavigation(page.head.resource?page.body.replace(/<!-- llmwiki:source:start -->[\s\S]*?<!-- llmwiki:source:end -->/g,''):page.body);
    const rows=relationRows(authored),typed=new Set(rows.filter(r=>r.direction==='out').map(r=>r.written.split('#')[0]));
    const candidates=[...rows.filter(r=>r.direction==='out').map(r=>({...r,origin:'table'})),
      ...listValue(page.head.related).filter(v=>typeof v==='string').map(v=>({written:bodyLinks(v)[0]?.written??v,type:'',reason:'',origin:'head'})),
      ...bodyLinks(authored.replace(/^\|\s*in\s*\|[^\n]*(?:\n|$)/gm,'')).map(v=>({...v,type:'',reason:'',origin:'text'}))];
    for(const written of listValue(page.head.superseded_by).filter(v=>typeof v==='string'))candidates.push({written:bodyLinks(written)[0]?.written??written,type:'superseded_by',reason:'superseded_by',origin:'head'});
    for(const edge of candidates){
      if(edge.embedded&&/\.(?:png|jpe?g|gif|webp|avif|pdf|excalidraw)(?:#.*)?$/i.test(edge.written))continue;
      if(edge.origin!=='table'&&!edge.type&&typed.has(edge.written.split('#')[0]))continue;
      const resolved=resolvePage(graph,page,edge.written);
      if(!resolved.key){if(!['external_link','technical_link'].includes(resolved.code))graph.findings.push({code:page.replica_covered&&resolved.code==='unresolved_link'?'link_outside_circle':resolved.code,wiki:page.wiki,page:page.path,written:edge.written});continue;}
      const target=graph.pages.get(resolved.key);if(navigationPage(target.path))continue;let valid=true;
      if(edge.type){
        try{valid=edge.valid!==false&&Boolean(edge.reason.trim())&&edgeAllowed(graph.scopes.get(page.wiki).register,edge.type,page.head.type,target.head.type);}
        catch{valid=false;}
        if(!valid)graph.findings.push({code:'invalid_relation',wiki:page.wiki,page:page.path,type:edge.type,target:target.path,line:edge.line});
      }
      if(page.key===target.key){graph.findings.push({code:'self_link',wiki:page.wiki,page:page.path});continue;}
      const identity=JSON.stringify([page.key,target.key,edge.type,edge.reason]);if(seen.has(identity))continue;seen.add(identity);
      graph.edges.push({...edge,source:page.key,target:target.key,valid});
    }
  }
  // Reciprocal related links navigate an authored semantic edge; they do not
  // assert another untyped relationship in its reverse direction.
  const pair=e=>JSON.stringify([e.source,e.target].sort());
  const typedPairs=new Set(graph.edges.filter(e=>e.valid&&e.type).map(pair));
  graph.edges=graph.edges.filter(e=>e.type||!typedPairs.has(pair(e)));
  graph.outgoing=new Map();graph.incoming=new Map();
  for(const edge of graph.edges){add(graph.outgoing,edge.source,edge);add(graph.incoming,edge.target,edge);}
  const transitive=graph.edges.filter(e=>e.valid&&e.type&&graph.scopes.get(graph.pages.get(e.source).wiki).register.edges.get(e.type)?.transitive);
  for(const edge of transitive){const visited=new Set(),queue=[edge.target];let cycle=false;
    while(queue.length){const key=queue.pop();if(key===edge.source){cycle=true;break;}if(visited.has(key))continue;visited.add(key);for(const next of graph.outgoing.get(key)??[])if(next.valid&&next.type===edge.type)queue.push(next.target);}
    if(cycle)graph.findings.push({code:'relation_cycle',type:edge.type,source:edge.source,target:edge.target});
  }
  return graph;
}

function canonicalizeReplicas(graph){
 const groups=new Map(),mapping=new Map();for(const page of graph.pages.values()){const id=String(page.head.id??'');if(id)add(groups,id,page);}
 const ref=page=>({key:page.key,wiki:page.wiki,path:page.path,sha256:page.sha256});
 for(const [id,pages]of groups){
  if(pages.length<2)continue;
  const replicas=pages.filter(p=>p.replica),homes=pages.filter(p=>!p.replica&&!p.replica_pending&&!p.replica_conflict);
  if(replicas.length===0||homes.length>1||pages.some(p=>p.replica_pending||p.replica_conflict)||new Set(replicas.map(p=>p.replica.owner)).size!==1)continue;
  // Repeated copies in one wiki are still an identity collision.
  if(new Set(pages.map(p=>p.wiki)).size!==pages.length)continue;
  const home=homes[0];
  if(home&&!replicas.every(p=>listValue(home.head.contribute_to).includes(p.replica.target)||graph.pages.get(graph.scopes.get(home.wiki).paths.get('wiki/bundle.md'))?.head.id===p.replica.owner))continue;
  const canonical=home??replicas.slice().sort((a,b)=>a.key.localeCompare(b.key))[0];
  canonical.replicas=pages.filter(p=>p!==canonical).map(ref);
  for(const page of pages){page.canonical=canonical.key;mapping.set(page.key,canonical.key);}
  if(pages.some(p=>compareForm(p.source)!==compareForm(canonical.source)))graph.findings.push({code:'replica_pending',id,replicas:pages.map(ref)});
 }
 const arrayMap=map=>{for(const [key,values]of map)map.set(key,[...new Set(values.map(value=>mapping.get(value)??value))]);};
 for(const scope of graph.scopes.values()){for(const [path,key]of scope.paths)scope.paths.set(path,mapping.get(key)??key);arrayMap(scope.names);arrayMap(scope.ids);}
 arrayMap(graph.names);arrayMap(graph.projectPaths);arrayMap(graph.evidence);
}

export function resolveEvidence(graph,identifier,wiki){
  const raw=String(identifier),split=raw.search(/[@#]/),id=split<0?raw:raw.slice(0,split),anchor=split<0?'':raw.slice(split+1).replace(/^\^/,'');
  let keys=graph.evidence.get(id)??[];
  // A duplicate identity is never repaired by arbitrarily selecting a folder.
  if(keys.length!==1)return null;
  const page=graph.pages.get(keys[0]);
  if(anchor){const escaped=anchor.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');if(!new RegExp('(?:\\^'+escaped+'(?:\\s|$)|^#{1,6}\\s+'+escaped+'\\s*$)','m').test(page.body))return null;}
  return {id,wiki:page.wiki,page:page.path,title:page.head.title??'',anchor,text:page.body,key:page.key};
}
