/** Incremental semantic review of authored Markdown, independent of source folders. */
import {parseDocument,statementText,relationRows} from './core/document.mjs';
import {requireThat,nonempty,relativePath} from './core/errors.mjs';
import {embeddedAssets} from './assets.mjs';
import {buildGraph} from './core/graph.mjs';
export const ownPage=(path,head)=>/\.md$/i.test(path)&&!path.split('/').some(p=>p.startsWith('.')||['schema','meta','notices','vermerke','_attachments','Attachments'].includes(p))&&!/(^|\/)(?:bundle|index|WIKI)\.md$/i.test(path)&&!path.endsWith('.excalidraw.md')&&!head.resource;
async function snapshot(store,page,entries){const file=await store.read(page);if(!file)return null;const parsed=parseDocument(file.text),hash=await store.services.hash(statementText(file.text).trimEnd()),assets=await embeddedAssets(store,page,file.text,entries);return {file,parsed,hash,assets};}
async function ledgerPath(store,page,head){return '.llmwiki/note-reviews/'+await store.services.hash(String(head.id??head.uid??page))+'.json';}
const assetState=assets=>assets.map(a=>({written:a.written,path:a.path,sha256:a.sha256}));
export async function planNotes(store){const entries=await store.list(''),changes=[];
 for(const entry of entries)if(entry.kind==='file'&&/\.md$/i.test(entry.path))try{
  const s=await snapshot(store,entry.path,entries);if(!ownPage(entry.path,s.parsed.head))continue;
  const prior=await store.read(await ledgerPath(store,entry.path,s.parsed.head)),record=prior?JSON.parse(prior.text):null;let state=!record?'new':record.hash!==s.hash?'changed':'unchanged';
  if(state==='unchanged'){
   if(JSON.stringify(record.assets)!==JSON.stringify(assetState(s.assets)))state='dependency_changed';
   for(const d of record.compared){const file=await store.read(d.page);if(!file||await store.services.hash(statementText(file.text).trimEnd())!==d.hash)state='dependency_changed';}
  }
  changes.push({page:entry.path,expected:s.file.sha256,state,assets:s.assets.map(({reading,...a})=>a),last_review:record?.at??null});
 }catch(error){changes.push({page:entry.path,state:'unreadable',error:{code:error.code,message:error.message}});}
 return {changes,counts:Object.fromEntries(['new','changed','unchanged','dependency_changed','unreadable'].map(s=>[s,changes.filter(c=>c.state===s).length])),complete:changes.every(c=>c.state==='unchanged')};
}
export async function reviewNote(store,args){
 const {page,expected,author,quote,assessment,topics,relations,compared}=args;relativePath(page);nonempty(author,'author');nonempty(quote,'quote');nonempty(assessment,'assessment');nonempty(topics?.reason,'topic decision');nonempty(relations?.reason,'relation decision');
 requireThat(['none','linked'].includes(relations?.decision)&&Array.isArray(compared),'review','Supply compared pages and a linked/none relation decision.');
 const s=await snapshot(store,page);requireThat(s&&s.file.sha256===expected,'stale','Read the current note before semantic integration.');requireThat(ownPage(page,s.parsed.head),'note','Source mirrors use their source integration workflow.');requireThat(s.parsed.body.includes(quote),'evidence','The note quote must occur verbatim in its body.');
 const dependencies=[];
 for(const d of compared){relativePath(d.page);requireThat(d.page!==page,'evidence','Compare with another knowledge page.');const f=await store.read(d.page);requireThat(f&&f.sha256===d.expected,'stale','A compared page changed.');nonempty(d.quote,'comparison quote');nonempty(d.reason,'comparison reason');requireThat(parseDocument(f.text).body.includes(d.quote),'evidence','Comparison quotes must be verifiable.');dependencies.push({...d,hash:await store.services.hash(statementText(f.text).trimEnd())});}
 for(const a of s.assets){requireThat(a.state==='reviewed','asset_review_required','Read all non-decorative images and resolve missing or ambiguous embeds first.',{page,asset:a.path??a.written,state:a.state});
  if(a.reading.kind==='content')for(const value of [a.reading.transcription,a.reading.description,a.reading.interpretation].filter(Boolean))requireThat(s.parsed.body.includes(value),'asset_content_missing','Include the full image reading and its separate interpretation in the note so retrieval can find it.',{asset:a.path});
 }
 if(relations.decision==='linked'){
  const graph=await buildGraph([{id:'local',store}],{allowMissingRegister:true});
  const edges=graph.edges.filter(e=>e.valid&&e.type&&graph.pages.get(e.source)?.path===page);
  requireThat(edges.some(e=>dependencies.some(d=>d.page===graph.pages.get(e.target)?.path)),'relation','A linked decision requires a valid typed relation to an evidenced compared page.');
 }else requireThat(!relationRows(s.parsed.body).some(r=>r.direction==='out'),'relation','A note with outbound typed relations needs a linked review.');
 const record={format:'llmwiki-note-review/1',page,hash:s.hash,expected,author,at:store.services.now(),quote,assessment,topics,relations,compared:dependencies,assets:assetState(s.assets)};
 // Recheck all inputs immediately before recording; review never rewrites a user's note.
 requireThat((await store.read(page))?.sha256===expected,'stale','The note changed during review.');for(const d of dependencies)requireThat((await store.read(d.page))?.sha256===d.expected,'stale','A comparison changed during review.');
 const name=await ledgerPath(store,page,s.parsed.head),prior=await store.read(name);await store.write(name,JSON.stringify(record,null,2)+'\n',{expected:prior?.sha256??null});return {page,integrated:true,evidence:name};
}
