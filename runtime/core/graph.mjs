/** Derived, scoped knowledge graph (ADR-03/13/21/26). Files carry all authoritative facts. */
import {stripNavigation,parseDocument,bodyLinks,relationRows,listValue} from './document.mjs';
import {readRegister,edgeAllowed} from './ontology.mjs';
import {requireThat} from './errors.mjs';

export const navigationPage=path=>['WIKI.md','index.md','bundle.md','wiki/index.md','wiki/bundle.md'].includes(path);
/** Retain navigation in the resolver, exclude it from visual/exported knowledge. */
export function graphProjection(graph){const pages=[...graph.pages.values()].filter(p=>!navigationPage(p.path)),keys=new Set(pages.map(p=>p.key));return {pages,edges:graph.edges.filter(e=>keys.has(e.source)&&keys.has(e.target))};}

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

export async function buildGraph(wikis,{allowMissingRegister=false}={}){
  requireThat(Array.isArray(wikis)&&wikis.length>0&&new Set(wikis.map(w=>w.id)).size===wikis.length,'scope','Select unique accessible wikis.');
  const graph={pages:new Map(),scopes:new Map(),names:new Map(),projectPaths:new Map(),evidence:new Map(),edges:[],findings:[],failures:[]};
  for(const wiki of wikis){
    const scope={...wiki,paths:new Map(),names:new Map(),ids:new Map(),register:null};graph.scopes.set(wiki.id,scope);
    try{
      const register=await wiki.store.read('schema/TYPES.md');
      if(!register&&allowMissingRegister)graph.failures.push({wiki:wiki.id,code:'ontology',message:'Wiki has no type register; typed relations cannot be validated.'});
      else {requireThat(register,'ontology','Wiki has no type register.');scope.register=readRegister(register.text);}
      for(const entry of await wiki.store.list('')){
        if(entry.kind!=='file'||!entry.path.endsWith('.md')||technical(entry.path))continue;
        try{
          const file=await wiki.store.read(entry.path), parsed=parseDocument(file.text);
          const key=pageKey(wiki.id,entry.path),page={...parsed,key,wiki:wiki.id,path:entry.path,sha256:file.sha256};
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
  for(const [id,keys] of graph.evidence)if(keys.length>1)graph.findings.push({code:'duplicate_id',id,pages:keys});
  const seen=new Set();
  for(const page of graph.pages.values()){
    if(navigationPage(page.path))continue;
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
      if(!resolved.key){if(!['external_link','technical_link'].includes(resolved.code))graph.findings.push({code:resolved.code,wiki:page.wiki,page:page.path,written:edge.written});continue;}
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

export function resolveEvidence(graph,identifier,wiki){
  const raw=String(identifier),split=raw.search(/[@#]/),id=split<0?raw:raw.slice(0,split),anchor=split<0?'':raw.slice(split+1).replace(/^\^/,'');
  let keys=graph.evidence.get(id)??[];
  // A duplicate identity is never repaired by arbitrarily selecting a folder.
  if(keys.length!==1)return null;
  const page=graph.pages.get(keys[0]);
  if(anchor){const escaped=anchor.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');if(!new RegExp('(?:\\^'+escaped+'(?:\\s|$)|^#{1,6}\\s+'+escaped+'\\s*$)','m').test(page.body))return null;}
  return {id,wiki:page.wiki,page:page.path,title:page.head.title??'',anchor,text:page.body,key:page.key};
}
