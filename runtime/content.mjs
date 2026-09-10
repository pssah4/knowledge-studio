import {markdownLink,materializeRelations,exportGraph,replaceDerived} from './derived.mjs';
/** File-native notes, bundle setup, navigation and completion checks. */
import registerText from './assets/default-register.mjs';
import {projectMetadata,stripNavigation,parseDocument,newDocument,listValue,mirroredContent,sectionText,patchHead,bodyLinks,relationRows} from './core/document.mjs';
import {readRegister} from './core/ontology.mjs';
import {buildGraph,resolveEvidence,resolvePage} from './core/graph.mjs';
import {requireThat,nonempty,relativePath} from './core/errors.mjs';
import {save} from './review.mjs';

export const STATUS_VALUES=Object.freeze(['draft','stable','deprecated']);
export function identity(services){let n=BigInt(Date.parse(services.now()));for(const byte of services.random(10))n=(n<<8n)|BigInt(byte);const alphabet='0123456789ABCDEFGHJKMNPQRSTVWXYZ';let id='';for(let i=0;i<26;i++){id=alphabet[Number(n&31n)]+id;n>>=5n;}return id;}
export function document(store,{type,title,description,author,head={},body}){
  for(const [label,value]of Object.entries({type,title,description,author}))nonempty(value,label);
  // Metadata stays concise, while the body preserves the complete source. The
  // collaboration journal enforces the same two-million-character file limit.
  nonempty(body,'body',2_000_000);
  return projectMetadata(newDocument({id:identity(store.services),type,status:'draft',title,description:description.trim().split(/\s+/).slice(0,25).join(' '),generated:{by:author,at:store.services.now()},...(type==='bundle'?{owner:author}:{}),related:[],...head},body));
}
export async function createBundle(store,{title,purpose,audience,author,language='de',preserveExisting=false}){
  nonempty(purpose,'purpose');nonempty(title,'title');nonempty(author,'author');
  requireThat(Array.isArray(audience)&&audience.length&&audience.every(v=>typeof v==='string'&&v.trim()),'audience','Name the reader circle.');
  if(preserveExisting&&await store.read('schema/TYPES.md'))readRegister((await store.read('schema/TYPES.md')).text);
  if(!preserveExisting&&await store.read('schema/TYPES.md')){
    readRegister((await store.read('schema/TYPES.md')).text);const existing=await store.read('wiki/bundle.md');requireThat(existing,'bundle','An existing register has no bundle page; repair it explicitly.');
    let text=patchHead(existing.text,{description:purpose.trim().split(/\s+/).slice(0,25).join(' '),readers:audience,language});
    const replaceSection=(body,names,title,value)=>{const lines=body.split('\n'),start=lines.findIndex(line=>names.some(name=>line.trim()==='## '+name));if(start<0)return body.trimEnd()+'\n\n## '+title+'\n\n'+value+'\n';let end=start+1;while(end<lines.length&&!/^## /.test(lines[end]))end++;lines.splice(start,end-start,'## '+title,'',value,'');return lines.join('\n');};
    text=replaceSection(text,['Zweck','Purpose'],'Zweck',purpose);text=replaceSection(text,['Leserkreis','Readers'],'Leserkreis',audience.join(', '));
    if(text!==existing.text)await save(store,'wiki/bundle.md',text,author,existing.sha256);return {created:false,updated:text!==existing.text};
  }
  const texts={
    'schema/TYPES.md':store.services.registerText??registerText,
    'schema/CONTRACT.md':'# Markdown data contract\n\nThe authoritative ontology is [Typenregister](./TYPES.md). Knowledge pages use UTF-8 Markdown with a YAML mapping. Required head: id (ULID), type, status (draft/stable), title and description. Stable pages satisfy the genus requirements and sections. Foreign fields and their comments remain intact.\n\nSources retain the COMPLETE source content under `## Source content`; descriptions and interpretations are separate. `resource` displays only source links. Technical resource values (store, name, sha256, created_at, created_at_basis, modified_at), generated and sources remain in an inert llmwiki:metadata JSON comment directly after YAML. Runtime parsing merges that provenance with visible Properties. Never discard the comment. `generated.at` is the extraction time, never the original creation date. `id` is stable across moves; `sources` cite IDs with optional @^block anchors. Unknown creation dates are null with basis unknown.\n\n## Relationships\n\n| Direction | Type | Target | Reason |\n| --- | --- | --- | --- |\n\nAuthored out rows need a registered type, resolvable target and a content-grounded reason. Only outgoing links belong in related. Incoming links are derived in a closed relation-in callout under Beziehungen/Relations, using Markdown links and vault-operator:incoming-links markers. Original and evidence links also appear in a collapsed source callout; indexes are derived. Contradictions require matching scope/time; dates alone never mean supersession.\n\n## Collaboration\n\nEdits require the exact read baseline and an immutable author event with completion receipt under .llmwiki/reviews. Divergent versions survive until an explicit decision. Detachment and sync never delete content.\n',
    'wiki/bundle.md':document(store,{type:'bundle',title,description:purpose,author,head:{language,readers:audience},body:'# '+title+'\n\n## Zweck\n\n'+purpose+'\n\n## Leserkreis\n\n'+audience.join(', ')+'\n\n## Registrierte Profile\n\n[Typenregister](../schema/TYPES.md) · [Datenvertrag](../schema/CONTRACT.md)\n'}),
    'wiki/index.md':document(store,{type:'topic',title:'Verzeichnis',description:'Alle Wissensseiten dieses Wikis.',author,head:{aliases:[]},body:'# Verzeichnis\n\n## Worum es geht\n\nDie Navigation wird aus den Markdown-Dateien abgeleitet.\n'}),
    'WIKI.md':document(store,{type:'topic',title,description:purpose,author,head:{aliases:[]},body:'# '+title+'\n\n[Zweck und Leserkreis](./wiki/bundle.md) · [Verzeichnis](./wiki/index.md)\n'})
  };
  for(const [page,text]of Object.entries(texts)){const current=await store.read(page);requireThat(preserveExisting||!current,'exists','Bundle setup would replace an existing file.',{page});}
  for(const [page,text]of Object.entries(texts))if(!await store.read(page))await save(store,page,text,author,null);
  await refreshIndex(store);return {created:true,pages:Object.keys(texts)};
}
export const visibleKnowledge=page=>/\.md$/i.test(page)&&!page.split('/').some(p=>p.startsWith('.'))&&!/^(schema|meta|notices|vermerke)\//.test(page);
export async function refreshIndex(store){
  await materializeRelations(store);
  const page='wiki/index.md',current=await store.read(page);requireThat(current,'index','Create the wiki index first.');
  const files=(await store.list('')).filter(e=>e.kind==='file'&&visibleKnowledge(e.path)&&e.path!==page).map(e=>e.path).sort();
  const start='<!-- llmwiki:index:start -->',end='<!-- llmwiki:index:end -->';
  const groups=new Map();
  for(const p of files){const {head}=parseDocument((await store.read(p)).text);if(p==='WIKI.md'||p.startsWith('test/'))continue;
    const group=({bundle:'Über dieses Wiki',topic:'Themen',entity:'Gegenstände und Personen',source:'Quellen'})[head.type]||'Weitere Wissensseiten';
    if(!groups.has(group))groups.set(group,[]);
    groups.get(group).push('- '+markdownLink(page,p,head.title)+' · `'+head.type+'` — '+String(head.description??'').replace(/[\r\n]/g,' '));}
  const order=['Über dieses Wiki','Themen','Gegenstände und Personen','Quellen','Weitere Wissensseiten'];
  const block=start+'\n'+order.filter(name=>groups.has(name)).map(name=>'### '+name+'\n\n'+groups.get(name).join('\n')).join('\n\n')+'\n'+end;
  const a=current.text.indexOf(start),b=current.text.indexOf(end);requireThat((a===-1&&b===-1)||(a>=0&&b>a&&current.text.indexOf(start,a+1)===-1&&current.text.indexOf(end,b+1)===-1),'index','The generated index markers are malformed.');
  const text=a<0?current.text.trimEnd()+'\n\n'+block+'\n':current.text.slice(0,a)+block+current.text.slice(b+end.length);
  if(text!==current.text)await save(store,page,text,'wiki-index',current.sha256);await exportGraph(store);return {updated:text!==current.text,pages:files.length};
}
export async function validateNote(store,{page,text},{allowPlainExisting=false,fallbackRegister=false}={}){
  relativePath(page);requireThat(visibleKnowledge(page),'page','Knowledge is stored as visible Markdown.');
  const parsed=parseDocument(text),registered=await store.read('schema/TYPES.md'),register=readRegister(registered?.text??(fallbackRegister?store.services.registerText??registerText:''));
  const existing=await store.read(page),prior=existing?parseDocument(existing.text):null;
  if(allowPlainExisting&&prior&&Object.keys(prior.head).length===0&&Object.keys(parsed.head).length===0)return {plain:true};
  const sourceFields=['resource','extraction','source_id'];
  if(parsed.head.type==='source'||prior?.head.type==='source'||sourceFields.some(key=>Object.hasOwn(parsed.head,key)||prior&&Object.hasOwn(prior.head,key))){
    // A generic Markdown write is an editorial action, not evidence that an
    // original was read. Only ingestion can create or replace its mirror.
    requireThat(prior&&['id','type',...sourceFields].every(key=>JSON.stringify(parsed.head[key])===JSON.stringify(prior.head[key]))&&mirroredContent(parsed.body)===mirroredContent(prior.body),
      'source_ingest_required','Use source.ingest to create or repair a source representation; write may only add editorial content without changing its original mirror or provenance.');
  }
  for(const key of ['id','title','description','type','status'])nonempty(parsed.head[key],key);
  requireThat(prior?.head.id===parsed.head.id||/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(parsed.head.id),'identity','New page identities must be valid ULIDs; preserve existing legacy identities during repair.');
  requireThat(parsed.head.description.trim().split(/\s+/).length<=25,'description','Use at most 25 words in the description.');
  requireThat(parsed.head.generated?.by&&Number.isFinite(Date.parse(parsed.head.generated?.at)),'generated','Generation metadata must retain author and date.');
  requireThat(Array.isArray(parsed.head.related),'related','Related must be a Markdown link list.');
  const genus=register.genera.get(parsed.head.type);requireThat(genus,'ontology','Choose a registered document type.');
  requireThat(STATUS_VALUES.includes(parsed.head.status),'status','Choose draft, stable or deprecated.');
  if(parsed.head.status==='stable')for(const key of genus.required)requireThat(parsed.head[key]!==undefined&&parsed.head[key]!==null,'head','Required stable field missing: '+key);
  return parsed;
}
export async function writeNote(store,{page,text,author,expected}){
  await validateNote(store,{page,text});
  const result=await save(store,page,text,author,expected);await refreshIndex(store);return {page,sha256:(await store.read(page)).sha256};
}
export async function readingEvidence(store,{head,body}){
 if(head.extraction)return head.extraction;const mirror=mirroredContent(body);
 if(mirror===null||!head.resource?.sha256||!head.id)return null;
 const record=await store.read('.llmwiki/evidence/'+encodeURIComponent(head.id)+'/'+head.resource.sha256+'/'+await store.services.hash(mirror)+'.json');
 try{return JSON.parse(record?.text??'null');}catch{return null;}
}
export async function sourceIntegrity(store,parsed){
  const {head,body}=parsed,findings=[],resource=head.resource,mirror=mirroredContent(body);
  const extraction=await readingEvidence(store,parsed);
  if(!resource||typeof resource!=='object')findings.push('source_provenance_missing');
  if(!head.id)findings.push('source_identity_missing');
  if(!resource||!Object.hasOwn(resource,'created_at_basis'))findings.push('source_dates_missing');
  if(extraction?.complete!==true||!Array.isArray(extraction?.gaps)||extraction.gaps.length)findings.push('source_coverage_unverified');
  const evidence=extraction?.evidence;
  if(evidence?.format!=='llmwiki-reading/1'||!Array.isArray(evidence.initial_gaps)||!Array.isArray(evidence.parts)||!evidence.by)findings.push('source_reading_evidence_missing');
  else if(evidence.initial_gaps.some(g=>!evidence.parts.some(p=>p.code===g.code&&p.part===(g.part??null)&&p.page===(g.page??null)&&['transcription','visual-description','decorative'].includes(p.kind)&&typeof p.content==='string'&&p.content.trim()&&mirror?.includes(p.content))))findings.push('source_reading_evidence_incomplete');
  if(mirror===null||!mirror.trim())findings.push('source_content_missing');
  if(mirror===null||await store.services.hash(mirror)!==extraction?.content_sha256)findings.push('source_mirror_changed');
  if(!/^[a-f0-9]{64}$/.test(resource?.sha256??'')||extraction?.sha256!==resource.sha256)findings.push('source_provenance_unverified');
  return {complete:findings.length===0,findings};
}
export async function readiness(wikis){
  const graph=await buildGraph(wikis),findings=[...graph.failures,...graph.findings],source_pages=[];
  for(const scope of graph.scopes.values()){
    const bundle=await scope.store.read('wiki/bundle.md'),index=await scope.store.read('wiki/index.md');
    const purpose=bundle?sectionText(parseDocument(bundle.text).body,['Zweck','Purpose']):'';
    if(!purpose||/Noch nicht geschrieben|Not yet written/i.test(purpose))findings.push({code:'bundle_purpose_missing',wiki:scope.id});
    if(!index)findings.push({code:'directory_missing',wiki:scope.id});
    for(const page of graph.pages.values())if(page.wiki===scope.id){
      const issue=code=>findings.push({code,wiki:scope.id,page:page.path});
      if(!page.head.title||!page.head.description||!scope.register?.genera.has(page.head.type))issue('metadata_missing');
      if(!page.head.id)issue('identity_missing');
      if(!page.head.generated?.by||!Number.isFinite(Date.parse(page.head.generated?.at)))issue('generated_missing');
      if(String(page.head.description??'').trim().split(/\s+/).length>25)issue('description_too_long');
      if(['created','updated','author','source_id','extraction'].some(k=>Object.hasOwn(page.head,k)))issue('unregistered_generated_fields');
      if(!STATUS_VALUES.includes(page.head.status))issue('status_invalid');
      if(page.path!=='wiki/index.md'&&!index?.text.includes(markdownLink('wiki/index.md',page.path,page.head.title))&&page.path!=='WIKI.md'&&!page.path.startsWith('test/'))issue('directory_entry_missing');
      if(page.head.type==='source'||page.head.resource){
        source_pages.push({wiki:scope.id,page:page.path});
        for(const code of (await sourceIntegrity(scope.store,page)).findings)issue(code);
      }
      const out=(graph.outgoing.get(page.key)||[]).filter(e=>e.type&&e.origin==='table'&&e.valid),related=new Set(listValue(page.head.related).map(v=>resolvePage(graph,page,bodyLinks(String(v))[0]?.written??v).key));
      for(const edge of out){
        if(!related.has(edge.target))issue('related_missing_for_out');
        const target=graph.pages.get(edge.target),incoming=/<!-- vault-operator:incoming-links -->([\s\S]*?)<!-- \/vault-operator:incoming-links -->/.exec(target.body)?.[1]??'';
        if(!bodyLinks(incoming).some(r=>resolvePage(graph,target,r.written).key===page.key))issue('incoming_relation_missing');
      }
      const incomingEdges=(graph.incoming.get(page.key)||[]).filter(e=>e.type&&e.origin==='table'&&e.valid);
      for(const target of related)if(target&&!out.some(e=>e.target===target)&&!incomingEdges.some(e=>e.source===target))issue('related_reason_missing');
      if(page.head.type==='topic'&&!['wiki/index.md','WIKI.md'].includes(page.path)){
        const explanation=stripNavigation(page.body,{legacy:true}).split(/\r?\n/).filter(l=>!/^\s*(?:#|\||[-*] )/.test(l)).join(' ').trim();
        if(explanation.split(/\s+/).length<10)issue('topic_explanation_missing');
      }
      for(const id of listValue(page.head.sources))if(!resolveEvidence(graph,id,page.wiki))issue('evidence_unresolved');
    }
  }
  return {ready:!findings.length,findings,pages:graph.pages.size,source_pages};
}
