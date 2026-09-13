import {requireDialogMode} from './intake.mjs';
/** Ingest and dialogic appropriation have distinct, persisted completion gates. */
import {buildGraph,navigationPage,resolvePage} from './core/graph.mjs';
import {parseDocument,patchHead,statementText,listValue,mirroredContent} from './core/document.mjs';
import {requireThat,nonempty,relativePath} from './core/errors.mjs';
import {refreshIndex,readiness,visibleKnowledge,sourceIntegrity} from './content.mjs';
const FORMAT='llmwiki-workflow/1',ROOT='.llmwiki/workflows';
const normalized=text=>String(text).replace(/\s+/g,' ').trim();
const sessionPath=id=>{requireThat(/^[a-f0-9]{32}$/.test(id),'session','Invalid integration session.');return ROOT+'/'+id+'.json';};
async function load(store,id){const file=await store.read(sessionPath(id));requireThat(file,'session','Integration session is missing.');const data=JSON.parse(file.text);requireThat(data.format===FORMAT&&data.id===id&&['ingest','appropriate'].includes(data.mode),'session','Unknown session format.');
 if(data.review&&!data.review.sha256)data.review.sha256=data.review_sha256;
 for(const d of data.decisions??[])if(!d.review_sha)d.review_sha=d.review_sha256;
 return {data,file};}
async function persist(store,data,file){data.updated_at=store.services.now();await store.write(sessionPath(data.id),JSON.stringify(data,null,2)+'\n',{expected:file?.sha256??null});return data;}
async function snapshot(store,page){const file=await store.read(page);requireThat(file,'page','A reviewed page is missing.',{page});
 let text=file.text;const parsed=parseDocument(text),ledger=await store.read('.llmwiki/derived-relations/'+encodeURIComponent(parsed.head.id||page)+'.json');
 // Index-generated backlink navigation must not invalidate the actual dialogue.
 // Authored relationships and content remain in the fingerprint.
 if(ledger){const managed=JSON.parse(ledger.text);if(Array.isArray(managed)&&managed.length)text=patchHead(text,{related:listValue(parsed.head.related).filter(v=>!managed.includes(v))});}
 const stable=parseDocument(text);return store.services.hash(JSON.stringify(stable.head)+'\n'+statementText(stable.body).replace(/\r\n?/g,'\n').trimEnd());}
async function current(store,snapshots){for(const [page,digest]of Object.entries(snapshots??{})){try{if(await snapshot(store,page)!==digest)return false;}catch{return false;}}return true;}
async function quote(store,record){relativePath(record.page);nonempty(record.quote,'quote');const file=await store.read(record.page),parsed=file?parseDocument(file.text):null;
 const body=parsed?.head.resource?mirroredContent(parsed.body):parsed?.body;
 requireThat(typeof body==='string'&&normalized(body).includes(normalized(record.quote)),'quote','The cited quote is not present in the complete source passage.',{page:record.page});return record.page;}
async function topicCandidates(store){const topic_candidates=[];for(const e of await store.list(''))if(e.kind==='file'&&visibleKnowledge(e.path)){const f=await store.read(e.path),p=parseDocument(f.text);if(p.head.type==='topic'&&!navigationPage(e.path))topic_candidates.push({page:e.path,title:p.head.title,description:p.head.description,expected:f.sha256});}return topic_candidates;}
const replacementMode=(previous,mode)=>previous.mode===mode||mode==='appropriate'&&previous.mode==='ingest'&&previous.review?.policy===2;
export async function start(store,mode,pages,by,{replaces=[]}={}){
 requireThat(['ingest','appropriate'].includes(mode),'mode','Choose ingest or appropriate.');nonempty(by,'author');
 requireThat(Array.isArray(pages)&&pages.length,'sources','Select source pages.');const sources=[...new Set(pages)].sort();
 for(const page of sources){relativePath(page);const file=await store.read(page);requireThat(file&&visibleKnowledge(page)&&parseDocument(file.text).head.resource,'source','Integration starts from a complete source representation.',{page});
   const coverage=await sourceIntegrity(store,parseDocument(file.text));requireThat(coverage.complete,'coverage','Complete the source reading with source.ingest before starting integration.',{page,...coverage});}
 await requireDialogMode(store,sources,mode);
 requireThat(Array.isArray(replaces)&&new Set(replaces).size===replaces.length,'replacement','List unique previous integration sessions.');
 for(const id of replaces){const previous=(await load(store,id)).data;requireThat(replacementMode(previous,mode)&&previous.sources.every(page=>sources.includes(page)),'replacement','A successor must review every source of the same integration mode.');}
 const topic_candidates=await topicCandidates(store);
 const data={topic_candidates,format:FORMAT,id:store.services.uuid().replace(/-/g,''),mode,sources,replaces,by,started_at:store.services.now(),review:null,decisions:[],outputs:[],finished:false};return persist(store,data,null);
}
async function verifyStructure(store,sources,record){
 const graph=await buildGraph([{id:'wiki',store}]);
 const edges=graph.edges.filter(e=>e.valid&&e.type&&!navigationPage(graph.pages.get(e.source).path)&&!navigationPage(graph.pages.get(e.target).path));
 for(const page of sources)if(record.sources[page].relations==='linked')requireThat(edges.some(e=>graph.pages.get(e.source).path===page||graph.pages.get(e.target).path===page),'relations','The declared relationship is missing from the knowledge graph.',{page});
 for(const page of record.topics.pages)requireThat(edges.some(e=>e.type==='part_of'&&graph.pages.get(e.target).path===page&&sources.includes(graph.pages.get(e.source).path)),'topics','A reviewed topic needs a part_of relationship from a reviewed source.',{page});
}
export async function review(store,id,record,by){
 const {data,file}=await load(store,id);data.topic_candidates??=await topicCandidates(store);nonempty(by,'author');requireThat(record&&record.sources&&JSON.stringify(Object.keys(record.sources).sort())===JSON.stringify(data.sources),'review','Review every source in the session exactly once.');
 const paths=new Set([...data.sources,'schema/TYPES.md']);
 for(const page of data.sources){const sourceFile=await store.read(page),coverage=sourceFile?await sourceIntegrity(store,parseDocument(sourceFile.text)):{complete:false};requireThat(coverage.complete,'coverage','Complete the source reading with source.ingest before reviewing integration.',{page,...coverage});
   const r=record.sources[page];nonempty(r.assessment,'assessment');nonempty(r.reason,'content-based assessment reason');requireThat(['linked','none'].includes(r.relations)&&Array.isArray(r.compared)&&Array.isArray(r.evidence),'review','Record comparison, passages and the relationship decision.');
   requireThat(data.sources.length===1||r.compared.some(p=>p!==page&&data.sources.includes(p)),'comparison','Compare each batch source with at least one other source in the batch, including when no relationship is warranted.',{page});
   const quoted=new Set();for(const e of r.evidence){quoted.add(await quote(store,e));paths.add(e.page);}
   for(const p of [page,...r.compared]){requireThat(quoted.has(p),'quote','Quote the source and every compared page.',{page:p});paths.add(p);}
 }
 nonempty(record.topics?.reason,'topic review reason');requireThat(Array.isArray(record.topics.pages),'topics','List topic hubs or justify why none is appropriate.');
 if(data.topic_candidates?.length){requireThat(Array.isArray(record.topics.considered)&&record.topics.considered.length,'topics','Compare existing topic candidates before creating or rejecting hubs.');for(const candidate of record.topics.considered){requireThat(data.topic_candidates.some(t=>t.page===candidate.page),'topics','Choose a topic from the recorded candidates.');nonempty(candidate.reason,'topic reuse/rejection reason');requireThat(['reuse','not_relevant'].includes(candidate.decision),'topics','Record reuse or not_relevant for each examined candidate.');const f=await store.read(candidate.page);requireThat(f&&f.sha256===candidate.expected,'stale','Read the current topic candidate.');nonempty(candidate.quote,'topic quote');requireThat(parseDocument(f.text).body.includes(candidate.quote),'quote','Quote the actual topic candidate.');if(candidate.decision==='reuse')requireThat(record.topics.pages.includes(candidate.page),'topics','Include reused topics in the membership list.');paths.add(candidate.page);}}
 for(const page of record.topics.pages){const p=await store.read(page);requireThat(p&&parseDocument(p.text).head.type==='topic'&&!['WIKI.md','wiki/index.md'].includes(page),'topics','Use content-based topic pages, not the bundle index.');paths.add(page);}
 requireThat(Array.isArray(record.insights),'insights','Record the insights developed from the comparison.');
 for(const insight of record.insights){nonempty(insight.statement,'insight');requireThat(Array.isArray(insight.evidence)&&insight.evidence.length,'evidence','Each insight needs source passages.');for(const e of insight.evidence){await quote(store,e);paths.add(e.page);}}
 await verifyStructure(store,data.sources,record);
 const snapshots={};for(const page of paths)snapshots[page]=await snapshot(store,page);
 data.review={policy:3,by,at:store.services.now(),snapshots,record};data.review.sha256=await store.services.hash(JSON.stringify(data.review));data.review_sha256=data.review.sha256;data.finished=false;await persist(store,data,file);return status(store,id);
}
export async function status(store,id){
 const {data}=await load(store,id);let next='review',outcome='pending';
 if(data.review?.policy===3&&await current(store,data.review.snapshots)){
   next=data.mode==='appropriate'?'dialogue':'curate';
   const decision=data.decisions.filter(d=>d.review_sha===data.review.sha256).at(-1);
   if(data.mode==='appropriate'&&decision){if(decision.choice==='take')next='curate';else{next='done';outcome=decision.choice==='defer'?'deferred':'declined';}}
   if(data.finished&&await current(store,data.output_snapshots)){
     if(data.completion?.outcome==='no_change'){next='done';outcome='no_change';}
     else if(data.review.record.insights.length&&data.outputs.length){next='done';outcome='integrated';}
   }
 }
 return {id,topic_candidates:data.topic_candidates??await topicCandidates(store),mode:data.mode,next,outcome,complete:outcome==='integrated',resolved:outcome!=='pending',completion:data.completion??null,replaces:data.replaces??[],sources:data.sources,outputs:data.outputs,review:data.review,decisions:data.decisions};
}
export async function decide(store,id,decision,by){
 const {data,file}=await load(store,id),s=await status(store,id);requireThat(data.mode==='appropriate'&&s.next!=='review','decision','Review current evidence before the dialogue decision.');nonempty(by,'author');
 requireThat(['take','defer','decline'].includes(decision.choice),'decision','Choose take, defer or decline.');nonempty(decision.reply,'actual user reply');
 if(decision.choice==='take'){requireThat(Array.isArray(decision.selected)&&decision.selected.length&&decision.selected.every(i=>Number.isInteger(i)&&i>0&&i<=data.review.record.insights.length),'decision','Select the agreed insights.');requireThat(['elaboration','entries','existing'].includes(decision.form),'decision','Choose where the agreed knowledge is recorded.');}
 data.decisions.push({...decision,by,at:store.services.now(),review_sha:data.review.sha256,review_sha256:data.review.sha256});data.finished=false;await persist(store,data,file);return status(store,id);
}
export async function finish(store,id,outputs,by,{outcome='integrated',reason=null}={}){
  const {data,file}=await load(store,id),s=await status(store,id);requireThat(s.next==='curate','workflow','Complete the '+s.next+' step before finishing integration.');nonempty(by,'author');requireThat(Array.isArray(outputs),'outputs','List the curated knowledge pages.');
  requireThat(['integrated','no_change'].includes(outcome),'outcome','Choose integrated or explicitly reviewed no_change.');
  await verifyStructure(store,data.sources,data.review.record);
  if(outcome==='no_change'){
    requireThat(data.mode==='ingest'&&!outputs.length&&!data.review.record.insights.length,'outcome','No-change closure cannot discard recorded insights or an appropriation decision.');nonempty(reason,'no-change reason');
    data.outputs=[];data.output_snapshots={};data.finished=true;data.completion={outcome,reason,by,at:store.services.now()};await persist(store,data,file);return status(store,id);
  }
  requireThat(data.review.record.insights.length>0&&outputs.length>0,'integration','Integration requires a materialized insight. Use an explicit no_change outcome for a review without integration.');
 const outputPages=[];for(const page of outputs){relativePath(page);requireThat(visibleKnowledge(page)&&!data.sources.includes(page)&&!['WIKI.md','wiki/bundle.md','wiki/index.md'].includes(page),'outputs','Record insights separately from source and navigation pages.');const p=await store.read(page);requireThat(p,'outputs','An output page is missing.');outputPages.push({page,...parseDocument(p.text)});}
 {
   const decision=s.decisions.filter(d=>d.review_sha===data.review.sha256).at(-1);
   const selected=data.mode==='appropriate'?decision.selected:data.review.record.insights.map((_,i)=>i+1);
   for(const i of selected){const insight=data.review.record.insights[i-1],ids=[];for(const e of insight.evidence){const head=parseDocument((await store.read(e.page)).text).head;ids.push(head.source_id??head.id);}
     requireThat(outputPages.some(p=>normalized(p.body).includes(normalized(insight.statement))&&ids.every(id=>listValue(p.head.sources).some(c=>String(c).split(/[@#]/)[0]===id))),'outputs','An accepted insight or its source citation is missing.',{insight:i});
   }
 }
 await refreshIndex(store);const scope=[{id:'wiki',label:'Wiki',store}],ready=await readiness(scope);requireThat(ready.ready,'readiness','Wiki integration still has open content or graph gaps.',ready);
 const {buildGraph}=await import('./core/graph.mjs'),graph=await buildGraph(scope);
 const linked=(from,to)=>listValue(from.head.related).some(v=>{const m=typeof v==='string'&&/^\[[^\]]+\]\(<?([^)>]+)>?\)$/.exec(v.trim());return m&&resolvePage(graph,from,m[1]).key===to.key;});
 for(const output of outputPages){const note=graph.pages.get(JSON.stringify(['wiki',output.page]));
  for(const page of data.sources){const source=graph.pages.get(JSON.stringify(['wiki',page]));
   if(listValue(note.head.sources).some(id=>String(id).split(/[@#]/)[0]===String(source.head.source_id??source.head.id)))requireThat(linked(note,source),'related','The derived note needs an outgoing Markdown related link to its source; the source lists the incoming backlink.',{source:page,output:output.page});
  }
 }
 for(const page of data.sources){const key=JSON.stringify(['wiki',page]),edges=[...graph.outgoing.get(key)??[],...graph.incoming.get(key)??[]].filter(e=>e.valid&&e.type);
   requireThat(edges.length||data.review.record.sources[page].relations==='none','relations','Connect the source with justified relationships or record why none is warranted.',{page});}
 const output_snapshots={};for(const page of outputs)output_snapshots[page]=await snapshot(store,page);
 requireThat(await current(store,data.review.snapshots),'stale','Reviewed source contents changed during finalization.');
 data.outputs=outputs;data.output_snapshots=output_snapshots;data.finished=true;data.completion={outcome:'integrated'};data.finished_by=by;data.finished_at=store.services.now();await persist(store,data,file);return status(store,id);
}
export async function sessions(store){let entries;try{entries=await store.list(ROOT);}catch(e){if(e.code==='ENOENT')return [];throw e;}const result=[];for(const e of entries)if(e.kind==='file'&&/\/[a-f0-9]{32}\.json$/.test(e.path))try{result.push(await status(store,e.path.split('/').at(-1).slice(0,-5)));}catch(error){result.push({path:e.path,error:error.message});}
 const byID=new Map(result.filter(s=>s.id).map(s=>[s.id,s]));
 for(const successor of result.filter(s=>s.complete)){if(!successor.complete)continue;const pending=[...successor.replaces],visited=new Set();while(pending.length){const id=pending.pop();if(visited.has(id)||id===successor.id)continue;visited.add(id);const previous=byID.get(id);if(!previous||!replacementMode(previous,successor.mode)||!previous.sources.every(p=>successor.sources.includes(p)))continue;pending.push(...previous.replaces);Object.assign(previous,{next:'done',outcome:'superseded',complete:false,resolved:true,replaced_by:successor.id});}}
 return result;}

/** Fingerprint the actual returned review, not its retained historical identifier. */
export async function reviewDigest(store,review){return review?store.services.hash(JSON.stringify(review)):null;}

/** Opt-in response projection only; stored evidence and every workflow gate stay full. */
export async function summarize(store,session,{connection,work}){
 if(!session.review||!Object.hasOwn(session.review,'record'))return session;
 const {record,...metadata}=session.review;
 return {...session,review:{...metadata,record_omitted:true,
  record_summary:{sources:record?.sources&&typeof record.sources==='object'&&!Array.isArray(record.sources)?Object.keys(record.sources).length:null,insights:Array.isArray(record?.insights)?record.insights.length:null,topic_pages:Array.isArray(record?.topics?.pages)?record.topics.pages.length:null},
  detail_request:{action:'workflow.status',connection,work,id:session.id,response:'full',expected_review:await reviewDigest(store,session.review)}}};
}
