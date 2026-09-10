/** Complete source mirror, source-relative provenance and resumable coverage. */
import {document,visibleKnowledge,refreshIndex,sourceIntegrity} from './content.mjs';
import {parseDocument,patchHead,removeHeadFields} from './core/document.mjs';
import {requireThat,relativePath,nonempty} from './core/errors.mjs';
import {save} from './review.mjs';
import {markdownLink} from './links.mjs';
function originalLink(fromRoot,toRoot,page,name){
 if(typeof fromRoot!=='string'||typeof toRoot!=='string')return null;
 const from=fromRoot.replace(/\\/g,'/'),to=toRoot.replace(/\\/g,'/');
 const link=markdownLink(from+'/'+page,to+'/'+name,name.split('/').at(-1));
 if(/^[A-Za-z]:\//.test(to)&&from.slice(0,2).toLowerCase()!==to.slice(0,2).toLowerCase()){
  const url='file:///'+to.slice(0,2)+'/'+(to.slice(3)+'/'+name).split('/').map(p=>encodeURIComponent(p).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16))).join('/');return link.replace(/\]\(.*\)$/ ,']('+url+')');
 }
 return link;
}
const START='<!-- llmwiki:source:start -->',END='<!-- llmwiki:source:end -->';

export async function inventory(source,{prefix='',paths}={}){if(prefix)relativePath(prefix);if(paths){requireThat(Array.isArray(paths),'paths','Select source paths.');paths.forEach(p=>relativePath(p));}const result=[];for(const entry of await source.store.list(prefix))if(entry.kind==='file'&&(!paths||paths.includes(entry.path))){
  try{const f=await source.store.read(entry.path,{binary:true});result.push({path:entry.path,sha256:f.sha256,size:f.size,created_at:f.created_at,created_at_basis:f.created_at_basis});}
  catch(error){result.push({path:entry.path,error:error.message});}
}return result;}
export async function ingest(wiki,source,name,{author,description,extract,expected,supplement=null,page=null,expectedPage,linkRoot=wiki.root}={}){
  relativePath(name);nonempty(author,'author');nonempty(description,'description');
  const original=await source.store.read(name,{binary:true});requireThat(original,'source','The source file is missing.');
  requireThat(original.sha256===expected,'stale','The source changed after it was read.');
  for(const entry of await wiki.list(''))if(entry.kind==='file'&&visibleKnowledge(entry.path)){
    const parsed=parseDocument((await wiki.read(entry.path)).text),resource=parsed.head.resource;
    if(resource?.store===source.id&&resource?.name===name&&resource?.sha256===original.sha256&&resource.availability!=='missing'&&(await sourceIntegrity(wiki,parsed)).complete){
      // Explicit, version-checked repairs may correct a host reading even when
      // the original bytes have not changed. Ordinary ingest stays idempotent.
      if(page===entry.path&&expectedPage!==undefined)continue;
      return {state:'already',complete:false,source_complete:true,stored:true,page:entry.path,source_id:parsed.head.id,next:'workflow.start'};
    }
  }
  const reading=await extract({bytes:original.bytes,name,metadata:original});
  const initialGaps=structuredClone(reading.gaps),coverage=[];
  if(supplement){
    requireThat(supplement.sha256===original.sha256&&Array.isArray(supplement.coverage)&&nonempty(supplement.text,'complete host reading',2_000_000),'coverage','Tie the host reading to the original digest and every unresolved part.');
    for(const gap of reading.gaps){
      const c=supplement.coverage.find(c=>c.code===gap.code&&c.part===(gap.part??null)&&c.page===(gap.page??null));
      requireThat(c&&typeof c.description==='string'&&c.description.trim(),'coverage','The host reading must address every unresolved part.',gap);
      requireThat(['transcription','visual-description','decorative'].includes(c.kind)&&typeof c.content==='string'&&c.content.trim()&&supplement.text.includes(c.content),'coverage','Each unresolved part needs its own content in the host reading and a kind: transcription, visual-description or decorative.',gap);
      coverage.push({code:gap.code,part:gap.part??null,page:gap.page??null,kind:c.kind,description:c.description,content:c.content});
    }
    reading.text=reading.text?reading.text+'\n\n## Host reading of additional content\n\n'+supplement.text:supplement.text;reading.complete=true;reading.gaps=[];
  }
  // An inventory entry with unresolved content is not a knowledge page. Keep the
  // original available for host reading, without publishing a partial mirror or
  // replacing a previously complete source during an update.
  if(reading.complete!==true||reading.gaps.length)return {state:'coverage_required',complete:false,source_complete:false,stored:false,path:name,sha256:original.sha256,coverage:reading.gaps,next:'source.read'};
  requireThat(reading.text.trim(),'source_content','No source content could be read. Preserve a full host reading before ingestion.',{gaps:reading.gaps});
  requireThat(!reading.text.includes(START)&&!reading.text.includes(END),'source','The original contains reserved extraction markers; preserve them as visible escaped text in a complete host reading.');
  const safe=name.split('/').at(-1).replace(/\.md$/i,'').normalize('NFC').replace(/[\[\]#|<>?*]/g,'_');page??='wiki/'+safe+' — '+(await wiki.services.hash(source.id+'/'+name)).slice(0,8)+'.md';relativePath(page);
  const seen=await wiki.read(page);requireThat(!seen||seen.sha256===expectedPage,'exists','Read the existing source page and supply its exact expectedPage digest to repair/update it.',{page});
  const originLink=originalLink(linkRoot,source.store.root,page,name);
  const stamp=wiki.services.now(),text=document(wiki,{type:'source',title:name.split('/').at(-1),description,author,
    head:{class:'document',resource:{store:source.id,name,...(originLink?{link:originLink}:{}),sha256:original.sha256,size:original.size,...reading.metadata},
      generated:{at:stamp,by:author},extraction:{complete:reading.complete,gaps:reading.gaps,sha256:original.sha256,content_sha256:await wiki.services.hash(reading.text),evidence:{format:'llmwiki-reading/1',by:author,at:stamp,initial_gaps:initialGaps,parts:coverage}},related:[]},
    body:'# '+name.split('/').at(-1)+'\n\n## Worum es geht\n\n'+description+'\n\n## Was daraus übernommen wurde\n\nVollständiger Quelleninhalt; Einordnung und abgeleitete Erkenntnisse stehen separat.\n\n'+START+'\n## Source content\n\n'+reading.text+'\n'+END+'\n'});
  const parsed=parseDocument(text);let final=text,sourceId=parsed.head.id;
  if(seen){const prior=parseDocument(seen.text);requireThat(prior.head.type==='source'||prior.head.resource,'source','Only an existing source page can be repaired by ingestion.');
    sourceId=prior.head.source_id??prior.head.id;nonempty(sourceId,'existing source identifier');
    // Preserve every prior interpretation and foreign head field. A prior full
    // mirror is replaced only inside our own marked extraction; legacy material
    // without those markers remains available for explicit editorial cleanup.
    const begin='<!-- llmwiki:source:start -->',end='<!-- llmwiki:source:end -->';
    requireThat(!reading.text.includes(begin)&&!reading.text.includes(end),'source','Source text collides with extraction markers; use a host reading with escaped comment markers.');
    const block=begin+'\n## Source content\n\n'+reading.text+'\n'+end;
    const a=prior.body.indexOf(begin),b=prior.body.indexOf(end);requireThat(a<0&&b<0||a>=0&&b>a,'source','Existing source extraction markers are malformed.');
    const body=a<0?prior.body.trimEnd()+'\n\n'+block+'\n':prior.body.slice(0,a)+block+prior.body.slice(b+end.length);
    requireThat(prior.head.resource?.store===source.id,'source','A source update must stay within its original source root.');
    if(prior.head.resource.name!==name){requireThat(!await source.store.read(prior.head.resource.name,{binary:true}),'source','The old original still exists; ingest this copy as a separate source.');parsed.head.resource.previous_names=[...new Set([...(prior.head.resource.previous_names??[]),prior.head.resource.name])];}
    else if(prior.head.resource.previous_names)parsed.head.resource.previous_names=prior.head.resource.previous_names;
    const updates={description,resource:parsed.head.resource,generated:parsed.head.generated,extraction:parsed.head.extraction};
    const head=patchHead(seen.text,updates);final=head.slice(0,parseDocument(head).offset)+body;
  }
  // Source bytes are checked again; originals are never written by this operation.
  requireThat((await source.store.read(name,{binary:true})).sha256===expected,'stale','The original changed while it was read.');
  const record=parseDocument(final),proof=record.head.extraction;
  const evidencePath='.llmwiki/evidence/'+encodeURIComponent(record.head.id)+'/'+record.head.resource.sha256+'/'+proof.content_sha256+'.json',evidenceText=JSON.stringify(proof,null,2)+'\n',evidence=await wiki.read(evidencePath);
  if(evidence&&evidence.text!==evidenceText){const history='.llmwiki/evidence/'+encodeURIComponent(record.head.id)+'/history/'+await wiki.services.hash(evidenceText)+'.json';if(!await wiki.read(history))await wiki.write(history,evidenceText,{expected:null});}
  if(!evidence)await wiki.write(evidencePath,evidenceText,{expected:null});
  final=removeHeadFields(final,['extraction','source_id']);
  await save(wiki,page,final,author,seen?.sha256??null);await refreshIndex(wiki);
  return {state:'curation_required',complete:false,source_complete:true,stored:true,page,source_id:sourceId,coverage:reading.gaps,repaired:Boolean(seen),next:'workflow.start'};
}

/** Repair link navigation on verified existing mirrors without another extraction. */
export async function repairOriginalLinks(wiki,sources,{linkRoot=wiki.root,author='maintain-llm-wiki'}={}){
 const changed=[],skipped=[];
 for(const e of await wiki.list(''))if(e.kind==='file'&&visibleKnowledge(e.path)){
  const seen=await wiki.read(e.path),parsed=parseDocument(seen.text),resource=parsed.head.resource;if(!resource)continue;
  const source=sources.find(s=>s.id===resource.store);if(!source?.store){skipped.push({page:e.path,reason:'source_unavailable'});continue;}
  let original;try{original=await source.store.read(resource.name,{binary:true});}catch{}
  if(original?.sha256!==resource.sha256){skipped.push({page:e.path,reason:'original_changed_or_missing'});continue;}
  const link=originalLink(linkRoot,source.store.root,e.path,resource.name);if(!link||link===resource.link)continue;
  await save(wiki,e.path,patchHead(seen.text,{resource:{...resource,link}}),author,seen.sha256);changed.push(e.path);
 }
 return {changed,skipped};
}
