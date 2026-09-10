import {migrateWorkflowPaths} from './workflow-migration.mjs';
/** Reviewable, resumable file moves. Originals are archived before any removal. */
import {buildGraph,resolvePage} from './core/graph.mjs';
import {parseDocument,patchHead} from './core/document.mjs';
import {relativePath,requireThat,nonempty} from './core/errors.mjs';
import {rewriteDocument} from './links.mjs';
export {rewriteDocument} from './links.mjs';
import {save} from './review.mjs';
import {refreshIndex,visibleKnowledge} from './content.mjs';

export async function planMoves(store,{moves,author}){
 nonempty(author,'author');requireThat(Array.isArray(moves)&&moves.length,'moves','Choose files to move.');
 const graph=await buildGraph([{id:'wiki',store}]),mapping={},targets=new Set();
 for(const {from,to}of moves){relativePath(from);relativePath(to);requireThat(from!==to&&visibleKnowledge(from)&&visibleKnowledge(to)&&!['wiki/bundle.md','wiki/index.md','WIKI.md'].includes(from),'move','Choose an ordinary Markdown document.');requireThat(!mapping[from]&&!targets.has(to),'move','Move targets must be unique.');requireThat(graph.scopes.get('wiki').paths.has(from),'missing','Document does not exist: '+from);requireThat(!await store.read(to),'exists','Target already exists: '+to);mapping[from]=to;targets.add(to);}
 const id=store.services.uuid(),changes=[];
 for(const p of graph.pages.values()){
  const to=mapping[p.path]??p.path,text=rewriteDocument(p.source,p.path,to,mapping,graph);
  if(to!==p.path||text!==p.source)changes.push({from:p.path,to,before:p.source,expected:p.sha256,text});
 }
 const aliasFile=await store.read('.llmwiki/identity-aliases.json');let identityAliases=null;if(aliasFile){const aliases=JSON.parse(aliasFile.text);for(const a of aliases.aliases||[])a.path=mapping[a.path]??a.path;identityAliases={before:aliasFile.text,expected:aliasFile.sha256,text:JSON.stringify(aliases)};}
 const data={identityAliases,format:'llmwiki-moves/1',id,author,mapping,changes,cursor:0,complete:false};
 await store.write('.llmwiki/moves/'+id+'.json',JSON.stringify(data),{expected:null});
 return {id,moves,affected:changes.map(c=>({from:c.from,to:c.to})),complete:false};
}
export async function applyMoves(store,id){
 requireThat(/^[a-f0-9-]{36}$/.test(id),'move','Invalid move plan.');
 const path='.llmwiki/moves/'+id+'.json';let record=await store.read(path);requireThat(record,'move','Move plan is missing.');const data=JSON.parse(record.text);
 requireThat(data.format==='llmwiki-moves/1'&&data.id===id,'move','Invalid move record.');if(data.complete)return data;
 // Validate every preimage before beginning. A paused plan rechecks remaining files.
 for(const c of data.changes.slice(data.cursor)){
  const current=await store.read(c.from),destination=c.to===c.from?current:await store.read(c.to);
  requireThat(current?.sha256===c.expected||(!current&&destination?.text===c.text)||(c.from===c.to&&current?.text===c.text),'stale','A document changed after the move was planned.',{page:c.from});
  if(c.to!==c.from)requireThat(!destination||destination.text===c.text,'exists','Move target changed.',{page:c.to});
 }
 for(;data.cursor<data.changes.length;data.cursor++){
  const c=data.changes[data.cursor],archive='.llmwiki/moves/'+id+'/originals/'+c.from;
  if(!await store.read(archive))await store.write(archive,c.before,{expected:null});
  const dest=await store.read(c.to);
  if(dest?.text!==c.text)await save(store,c.to,c.text,data.author,c.to===c.from?c.expected:null);
  if(c.to!==c.from&&await store.read(c.from)){
   if(!store.archive){return {complete:false,id,requires_host_move:{source:store.hostPath?.(c.from)??c.from,destination:store.hostPath?.('.llmwiki/moves/'+id+'/retired/'+c.from)??'.llmwiki/moves/'+id+'/retired/'+c.from,expected:c.expected},message:'Move the exact original with the host move_file tool, then resume this plan. Never delete it.'};}
   await store.archive(c.from,'.llmwiki/moves/'+id+'/retired/'+c.from,c.expected);
  }
  // Keep a path alias for immutable review events and source/workflow references.
  const alias='.llmwiki/path-aliases/'+await store.services.hash(c.from)+'.json',prior=await store.read(alias);
  if(c.from!==c.to)await store.write(alias,JSON.stringify({from:c.from,to:c.to,id,expected:c.expected}),{expected:prior?.sha256??null});
  const state={...data,cursor:data.cursor+1};record=await store.read(path);await store.write(path,JSON.stringify(state),{expected:record.sha256});
 }
 if(data.identityAliases){const p='.llmwiki/identity-aliases.json',current=await store.read(p);if(current?.text!==data.identityAliases.text){const backup='.llmwiki/moves/'+id+'/state/identity-aliases.json';if(!await store.read(backup))await store.write(backup,data.identityAliases.before,{expected:null});await store.write(p,data.identityAliases.text,{expected:data.identityAliases.expected});}}
 await refreshIndex(store);await migrateWorkflowPaths(store,data);data.complete=true;record=await store.read(path);await store.write(path,JSON.stringify(data),{expected:record.sha256});return {complete:true,id,moves:data.mapping};
}
export async function makeFolder(store,path){relativePath(path);requireThat(!path.split('/').some(p=>p.startsWith('.'))&&!/^(schema|meta|notices|vermerke)(\/|$)/.test(path),'folder','Choose a visible user folder.');await store.mkdir(path);return {created:true,path};}
export async function planFlatWiki(store,{author}){
 const graph=await buildGraph([{id:'wiki',store}]);const moves=[];
 for(const p of graph.pages.values())if(/^(sources|topics|entities|concepts)\//.test(p.path)){
  const name=p.path.split('/').at(-1).normalize('NFC'),suffix=String(p.head.id||p.sha256).slice(-8),to='wiki/'+name.replace(/\.md$/,'')+' — '+suffix+'.md';moves.push({from:p.path,to});
 }
 return moves.length?planMoves(store,{moves,author}):{complete:true,moves:[]};
}
