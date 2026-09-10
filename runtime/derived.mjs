/** Derived navigation and directed relationships. Markdown remains authoritative. */
import {buildGraph,resolvePage,graphProjection} from './core/graph.mjs';
import {parseDocument,patchHead,bodyLinks,listValue,projectMetadata,stripNavigation,mapAuthored} from './core/document.mjs';
import {save} from './review.mjs';
import {requireThat} from './core/errors.mjs';
export {markdownLink} from './links.mjs';
import {markdownLink,rewriteDocument} from './links.mjs';
export function replaceDerived(text,kind,body){
 const start='<!-- llmwiki:'+kind+':start -->',end='<!-- llmwiki:'+kind+':end -->',a=text.indexOf(start),b=text.indexOf(end);
 requireThat(a<0&&b<0||a>=0&&b>a&&text.indexOf(start,a+1)<0&&text.indexOf(end,b+1)<0,'derived','Malformed generated section: '+kind);
 const block=start+'\n'+body+'\n'+end;return a<0?text.trimEnd()+'\n\n'+block+'\n':text.slice(0,a)+block+text.slice(b+end.length);
}
export async function materializeRelations(store){
 const graph=await buildGraph([{id:'wiki',store}]);let updated=0;
 const bundle=await store.read('wiki/bundle.md'),english=bundle&&parseDocument(bundle.text).head.language==='en';
 const authored=text=>text.replace(/<!-- llmwiki:source:start -->[\s\S]*?<!-- llmwiki:source:end -->|^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*(?:\n|$)|^\|\s*in\s*\|[^\r\n]*(?:\r?\n|$)/gm,part=>/^\|\s*in\s*\|/.test(part)?'':part);
 for(const p of graph.pages.values()){
  const tracking='.llmwiki/derived-relations/'+encodeURIComponent(p.head.id||p.path)+'.json',oldTracking='.llmwiki/derived-relations/'+encodeURIComponent(p.sha256)+'.json';
  const prior=await store.read(tracking)??(!p.head.id?await store.read(oldTracking):null),managed=prior?JSON.parse(prior.text):[];
  const own=new Set();for(const v of listValue(p.head.related).filter(v=>!managed.includes(v))){const r=resolvePage(graph,p,bodyLinks(String(v))[0]?.written??v),target=graph.pages.get(r.key);own.add(target?markdownLink(p.path,target.path,target.head.title):v);}
  const authoredBody=authored(stripNavigation(p.head.resource?p.body.replace(/<!-- llmwiki:source:start -->[\s\S]*?<!-- llmwiki:source:end -->/g,''):p.body));
  const bodyTargets=new Set(bodyLinks(authoredBody).filter(l=>!l.embedded).map(l=>resolvePage(graph,p,l.written).key));
  const added=new Set();for(const e of graph.outgoing.get(p.key)||[])if(e.valid&&(e.origin==='table'||bodyTargets.has(e.target))){const target=graph.pages.get(e.target),link=markdownLink(p.path,target.path,target.head.title);if(!own.has(link))added.add(link);}
  const related=[...new Set([...own,...added])].sort();
  let text=JSON.stringify(related)===JSON.stringify(p.head.related??[])?p.source:patchHead(p.source,{related});
  text=rewriteDocument(text,p.path,p.path,{},graph);const parsed=parseDocument(text);
  let body=authored(stripNavigation(parsed.body,{legacy:true}));
  const incoming=(graph.incoming.get(p.key)||[]).filter(e=>e.valid),bySource=new Map();
  for(const e of incoming){if(!bySource.has(e.source))bySource.set(e.source,[]);bySource.get(e.source).push(e);}
  if(bySource.size){const rows=[...bySource].map(([key])=>{const source=graph.pages.get(key);return '> | '+markdownLink(p.path,source.path,source.head.title)+' |';}).sort().join('\n');
   const heading=english?'Relations':'Beziehungen';const title=english?bySource.size+' notes link here':bySource.size+' Notizen verweisen hierher';
   body=body.trimEnd()+'\n\n<!-- vault-operator:incoming-links -->\n'+(new RegExp('^## '+heading+'\\s*$','m').test(body)?'':'## '+heading+'\n\n')+'> [!relation-in]- '+title+'\n> | '+(english?'Note':'Notiz')+' |\n> | --- |\n'+rows+'\n<!-- /vault-operator:incoming-links -->\n';
  }
  if(p.head.type==='topic'&&!['wiki/index.md','WIKI.md'].includes(p.path)){
   const members=[...new Set(incoming.filter(e=>e.type==='part_of').map(e=>e.source))].map(key=>graph.pages.get(key));
   body=replaceDerived(body,'members',members.map(s=>'- '+markdownLink(p.path,s.path,s.head.title)+' — '+s.head.description).sort().join('\n')||(english?'No assigned pages yet.':'Noch keine zugeordneten Seiten.'));
  }
  const evidenceLinks=new Set();if(typeof p.head.resource?.link==='string')evidenceLinks.add(p.head.resource.link);
  for(const id of listValue(p.head.sources)){const key=(graph.evidence.get(String(id).split(/[@#]/)[0])||[])[0],evidence=graph.pages.get(key);if(evidence)evidenceLinks.add(markdownLink(p.path,evidence.path,evidence.head.title));}
  if(evidenceLinks.size)body=replaceDerived(body,'provenance','> [!source]- '+(english?'Sources and evidence':'Quellen und Belege')+'\n'+[...evidenceLinks].sort().map(link=>'> - '+link).join('\n'));
  const ledger=JSON.stringify([...added].sort()),seen=await store.read(tracking);if(seen?.text!==ledger)await store.write(tracking,ledger,{expected:seen?.sha256??null});
  text=projectMetadata(text.slice(0,parsed.offset)+body);if(text!==p.source){await save(store,p.path,text,'wiki-relations',p.sha256);updated++;}
 }
 return {updated};
}
export async function exportGraph(store){
 const graph=await buildGraph([{id:'wiki',store}]),projection=graphProjection(graph),data={format:'llmwiki-graph/1',derived:true,nodes:graphProjection(graph).pages.map(p=>({key:p.key,id:p.head.id,wiki:p.wiki,path:p.path,title:p.head.title,type:p.head.type,sha256:p.sha256})),edges:projection.edges.map(e=>({...e,semantic:Boolean(e.type),origin_page:graph.pages.get(e.source).path})),findings:[...graph.failures,...graph.findings]};
 const text=JSON.stringify(data,null,2)+'\n',path='.llmwiki/graph.json',seen=await store.read(path);if(seen?.text!==text)await store.write(path,text,{expected:seen?.sha256??null});return data;
}

/** Project-level snapshot is produced by Maintain, never by graph rendering (ADR-27). */
export async function exportProjectGraph(root,{bindings={}}={}){
 const {load,context}=await import('./project.mjs'),{project}=await load(root),wikis=[],unavailable=[];
 for(const c of project.connections){if(wikis.some(w=>w.id===c.wiki)||unavailable.some(w=>w.wiki===c.wiki))continue;
  try{const value=await context(root,c.id,{bindings});wikis.push({id:value.wiki.id,label:value.wiki.label,path:value.wiki.path??value.wiki.id,store:value.work});}
  catch(error){unavailable.push({wiki:c.wiki,code:error.code??'access',message:error.message});}
 }
 const graph=wikis.length?await buildGraph(wikis,{allowMissingRegister:true}):{pages:new Map(),edges:[],failures:[],findings:[]};
 const data={format:'llmwiki-project-graph/1',project:project.id,derived:true,wikis:project.folders.filter(f=>f.kind==='wiki').map(w=>({id:w.id,label:w.label,path:w.path})),nodes:graphProjection(graph).pages.map(p=>({key:p.key,id:p.head.id??null,wiki:p.wiki,path:p.path,title:p.head.title||p.path.split('/').at(-1).replace(/\.md$/,''),type:p.head.type??null,sha256:p.sha256})),edges:graphProjection(graph).edges.filter(e=>e.valid).map(e=>({...e,crossWiki:graph.pages.get(e.source).wiki!==graph.pages.get(e.target).wiki,origin_page:graph.pages.get(e.source).path})),findings:[...unavailable,...graph.failures,...graph.findings]};
 data.complete=!data.findings.length;
 const revision=await root.services.hash(JSON.stringify(data)),path='.llmwiki/graph.json',old=await root.read(path);
 if(old)try{const saved=JSON.parse(old.text);if(saved.revision===revision)return saved;}catch{}
 const snapshot={...data,revision,generated_at:root.services.now()};await root.write(path,JSON.stringify(snapshot,null,2)+'\n',{expected:old?.sha256??null});return snapshot;
}
