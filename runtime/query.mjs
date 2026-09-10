/** Lexical seeds + ontology-aware graph expansion + mandatory counter-reading.
 * Answers are composed by the host agent from these full passages and citations.
 * No embedding service, network call or silent clipping of source text.
 */
import {citation} from './citations.mjs';
import {buildGraph} from './core/graph.mjs';
import {listValue} from './core/document.mjs';
import {requireThat,nonempty} from './core/errors.mjs';
import {sourceIntegrity} from './content.mjs';
import {readShadow} from './shadow-project.mjs';
import {makeLocator,parseShadow} from './shadow.mjs';
import {sectionRanking,sectionWindow,shadowTerms} from './shadow-search.mjs';
const tokens=text=>String(text).toLocaleLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu)??[];
export async function query(wikis,{question,filters={},limit=8,hops=2,max_context_chars=120000}={},options={}){
 nonempty(question,'question');requireThat(Number.isInteger(limit)&&limit>0&&limit<=100&&Number.isInteger(hops)&&hops>=0&&hops<=4,'query','Choose 1–100 seeds and 0–4 relationship steps.');
 requireThat(Number.isInteger(max_context_chars)&&max_context_chars>=1000&&max_context_chars<=2000000,'query','Choose a context budget between 1000 and 2000000 characters.');
 requireThat(Object.keys(filters).every(k=>['wiki','type','status','owner','class','tags'].includes(k)),'filter','Unknown search filter.');
 const graph=await buildGraph(wikis),terms=shadowTerms(question),docs=[];
 const shadow=options.shadow??await readShadow(wikis,null),shadowDocs=new Map(shadow.documents.map(d=>[JSON.stringify([d.wiki,d.path]),d]));
 for(const [key,row] of shadowDocs){const page=graph.pages.get(key);if(!page){shadowDocs.delete(key);continue;}if(row.revision!==page.sha256||row.data.source!==page.source){
  try{const data=await parseShadow(page.source,graph.scopes.get(page.wiki).store.services);data.blocks=data.blocks.map(b=>({...b,id:null,mapping:'unpersisted',predecessors:[]}));shadowDocs.set(key,{wiki:page.wiki,path:page.path,id:null,revision:page.sha256,data,state:'fallback'});shadow.persistent=false;shadow.reason='changed_files';}
  catch(error){shadowDocs.delete(key);shadow.findings.push({wiki:page.wiki,page:page.path,code:error.code??'shadow',message:error.message});}
 }}
 for(const page of graph.pages.values()){
   if(['WIKI.md','wiki/index.md','wiki/bundle.md'].includes(page.path))continue;
   if(Object.entries(filters).some(([k,v])=>!listValue(v).some(wanted=>listValue(k==='wiki'?page.wiki:page.head[k]).includes(wanted))))continue;
   const title=tokens([page.head.title,...listValue(page.head.aliases)].join(' ')),description=tokens(page.head.description??''),body=tokens(page.body),frequencies=new Map();for(const word of body)frequencies.set(word,(frequencies.get(word)??0)+1);
   docs.push({page,title,description,frequencies,length:body.length});
 }
 const average=docs.reduce((s,d)=>s+d.length,0)/Math.max(1,docs.length),counts=new Map(terms.map(t=>[t,docs.filter(d=>d.frequencies.has(t)||d.title.includes(t)||d.description.includes(t)).length]));
 const bestSections=new Map();
 for(const section of sectionRanking(docs.map(d=>shadowDocs.get(d.page.key)).filter(Boolean),question)){const key=JSON.stringify([section.document.wiki,section.document.path]);if(!bestSections.has(key))bestSections.set(key,section);}
 const ranked=docs.map(d=>{let score=0;for(const term of terms){const tf=d.frequencies.get(term)??0,n=counts.get(term),idf=Math.log(1+(docs.length-n+0.5)/(n+0.5));score+=idf*(tf*2.2/(tf+1.2*(0.25+0.75*d.length/Math.max(1,average)))+(d.title.includes(term)?3:0)+(d.description.includes(term)?1.5:0));}return {key:d.page.key,score:score+(bestSections.get(d.page.key)?.score??0)};}).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));
 const hits=ranked.slice(0,limit),selected=new Set(hits.map(h=>h.key)),routes=new Map(hits.map(h=>[h.key,{kind:'search',depth:0}]));let frontier=hits.map(h=>h.key);
 for(let depth=1;depth<=hops;depth++){const next=[];for(const key of frontier)for(const edge of [...graph.outgoing.get(key)??[],...graph.incoming.get(key)??[]]){
   if(!edge.valid||!edge.type)continue;const neighbor=edge.source===key?edge.target:edge.source;if(!selected.has(neighbor)){selected.add(neighbor);next.push(neighbor);routes.set(neighbor,{kind:'relationship',depth,type:edge.type,reason:edge.reason,via:key});}
 }frontier=next;}
 // Counterevidence is included even when the caller asks for zero expansion.
 for(const key of [...selected])for(const edge of [...graph.outgoing.get(key)??[],...graph.incoming.get(key)??[]])if(edge.valid&&['contradicts','superseded_by'].includes(edge.type)){
   const other=edge.source===key?edge.target:edge.source;selected.add(other);if(!routes.has(other))routes.set(other,{kind:'counter-reading',type:edge.type,reason:edge.reason,via:key});
 }
 const context=[],coverageFindings=[],allowance=Math.floor(max_context_chars/Math.max(1,selected.size));
 for(const key of selected){const p=graph.pages.get(key);let start=0,end=p.body.length;
   const section=bestSections.get(key),structure=shadowDocs.get(key);
   if(end>allowance){if(section&&structure?.revision===p.sha256){({start,end}=sectionWindow(structure,section.index,allowance,p.offset,question));}
    else{let best=-1;for(let offset=0;offset<p.body.length;offset+=Math.max(1,allowance)){const words=new Set(tokens(p.body.slice(offset,offset+allowance))),score=terms.reduce((n,t)=>n+Number(words.has(t)),0);if(score>best){best=score;start=offset;}}end=Math.min(p.body.length,start+allowance);}}
   const head=structuredClone(p.head);if(head.extraction?.evidence)head.extraction.evidence={format:head.extraction.evidence.format,by:head.extraction.evidence.by,parts:head.extraction.evidence.parts?.length};
   if(p.head.resource){const check=await sourceIntegrity(graph.scopes.get(p.wiki).store,p);coverageFindings.push(...check.findings.map(code=>({code,wiki:p.wiki,page:p.path})));}
   context.push({key,wiki:p.wiki,page:p.path,title:p.head.title,head,text:p.body.slice(start,end),headings:section?.block.headings??[],passage:{start,end,total_chars:p.body.length},truncated:start!==0||end!==p.body.length,sha256:p.sha256,route:routes.get(key)});
 }
 // A second source check is the final authority, including permission changes.
 for(let i=context.length-1;i>=0;i--){const c=context[i];try{if((await graph.scopes.get(c.wiki).store.read(c.page))?.sha256!==c.sha256)throw Error('The cited document changed during retrieval.');}catch(error){coverageFindings.push({wiki:c.wiki,page:c.page,code:'citation_stale',message:error.message});context.splice(i,1);}}
 const safeKeys=new Set(context.map(c=>c.key)),relations=graph.edges.filter(e=>e.valid&&e.type&&safeKeys.has(e.source)&&safeKeys.has(e.target));
 const result={question,method:'section BM25 + file BM25 + typed graph + counter-reading',hits: hits.filter(h=>context.some(c=>c.key===h.key)).map(h=>({...h,wiki:graph.pages.get(h.key).wiki,page:graph.pages.get(h.key).path})),context,relations,
   shadow:{mode:shadow.mode,reason:shadow.reason??'read_only_fallback',persistent:shadow.persistent,findings:shadow.findings},
   citations:await Promise.all(context.map(async p=>{const page=graph.pages.get(p.key),c=await citation(page,graph.scopes.get(p.wiki).store,question,p.passage),row=shadowDocs.get(p.key);
    c.passages=c.passages.filter(b=>b.start>=p.passage.start&&b.end<=p.passage.end&&b.quote.length<=allowance);
    if(row?.revision===p.sha256){
     const start=page.offset+p.passage.start,end=page.offset+p.passage.end;
     const blocks=row.data.blocks.filter(b=>start<end&&b.kind!=='heading'&&b.start<end&&b.end>start).map(b=>{const direct=tokens(b.quote).some(t=>terms.includes(t)),heading=tokens(b.headings.join(' ')).some(t=>terms.includes(t));return {block:b,basis:direct?'text':heading?'heading':p.route.kind==='search'?'page_context':'relationship_context',score:Number(direct)*2+Number(heading)};}).sort((a,b)=>b.score-a.score||a.block.start-b.block.start).slice(0,8);
     c.shadow={state:row.state,empty_reason:blocks.length?null:start===end?'context_budget_exhausted':'no_structural_content_in_context',passages:blocks.map(({block:b,basis})=>{const locator=makeLocator(p.wiki,row.id,row.data,b,{start:Math.max(b.start,start),end:Math.min(b.end,end)});return {...locator,page:p.page,retrieval_basis:basis,persisted:row.state==='current',pin_request:row.state==='current'?{action:'shadow.pin',wiki:p.wiki,document:row.id,revision:row.revision,occurrence:b.occurrence,...(locator.partial?{start:locator.start,end:locator.end}:{})}:null};})};
    }else c.shadow={state:'unavailable',empty_reason:'structure_unavailable',passages:[]};return c;})),
   total_matches:ranked.length,more_matches:ranked.length>hits.length,max_context_chars,context_truncated:context.some(p=>p.truncated),next:context.some(p=>p.truncated)?'read full cited pages before conclusions':null,
   complete:graph.failures.length===0&&graph.findings.length===0&&!coverageFindings.length&&!shadow.findings.length&&!context.some(p=>p.truncated),findings:[...graph.failures,...graph.findings,...coverageFindings,...shadow.findings]};
 result.shadow.passage_count=result.citations.reduce((n,c)=>n+c.shadow.passages.length,0);
 return result;
}
