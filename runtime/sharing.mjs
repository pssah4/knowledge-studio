/** ADR-04/09/14: an explicit, resumable single-content transfer across two scoped work stores. */
import {originalLink} from './ingest.mjs';
import {markdownLink} from './links.mjs';
import {context} from './project.mjs';
import {parseDocument,newDocument,patchHead,mapAuthored,bodyLinks} from './core/document.mjs';
import {readRegister} from './core/ontology.mjs';
import {buildGraph,resolvePage} from './core/graph.mjs';
import {visibleKnowledge} from './content.mjs';
import {requireThat,relativePath} from './core/errors.mjs';
import {sync} from './review.mjs';
import {proposal,prepareChanges,operateChanges,readChanges,encodeBytes} from './change-set.mjs';
const facade=(source,target)=>({services:source.services,writable:source.writable&&target.writable,capabilities:target.capabilities,reviewStore:p=>p.startsWith('target/')?{store:target,page:p.slice(7)}:{store:source,page:p.startsWith('source/')?p.slice(7):p},hostPath:p=>p.startsWith('target/')?(target.hostPath?.(p.slice(7))??p.slice(7)):(source.hostPath?.(p.startsWith('source/')?p.slice(7):p)??p),read:(p,o)=>p.startsWith('target/')?target.read(p.slice(7),o):source.read(p.startsWith('source/')?p.slice(7):p,o),write:(p,t,o)=>p.startsWith('target/')?target.write(p.slice(7),t,o):source.write(p.startsWith('source/')?p.slice(7):p,t,o)});
function clearance(text,page){const findings=sync.contentClearance(text,page);requireThat(!findings.length,'clearance','Resolve the sharing findings before transferring this page.',{findings});}
function scopedText(source,page,sourceWiki,targetWiki,targetPage,graph,assets){
 const p=parseDocument(source),origin={wiki:sourceWiki,path:page};const link=(whole,written,label)=>{
  if(assets.has(written))return markdownLink(targetPage,assets.get(written),label);
  const resolved=resolvePage(graph,origin,written),target=graph.pages.get(resolved.key);if(!target)return whole;
  const self=target.wiki===sourceWiki&&target.path===page,remaining=target.wiki===sourceWiki&&!self;
  // A remaining page's path (and heading fragment) can name private content.
  // Only its opaque identity crosses the boundary; explicit labels are authored text.
  if(remaining)requireThat(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(target.head.id??''),'transfer_reference_identity','Assign an opaque document identity to the remaining source reference before transferring this page.');
  const href=(self?targetWiki:target.wiki)+'/'+(self?targetPage:remaining?target.head.id:target.path);
  const fragment=written.includes('#')?'#'+written.split('#').slice(1).join('#'):'';
  const anchor=remaining&&!/^#\^[A-Za-z0-9-]+$/.test(fragment)?'':fragment;
  return '['+(label||'Referenced document').replace(/[\[\]|\r\n]/g,' ')+']('+href.split('/').map(part=>encodeURIComponent(part).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16))).join('/')+anchor+')';
 };
 const convert=text=>mapAuthored(text,part=>part.replace(/(`+)[^\n]*?\1|\[\[([^\]]+)\]\]|\[([^\]]*)\]\(<?([^\s)>]+)>?(\s+"[^"\n]*")?\)/g,(whole,code,wiki,label,url,title)=>{
  if(code)return whole;if(wiki)return link(whole,wiki.split('|')[0],wiki.split('|')[1]);
  const converted=link(whole,url,label);return converted===whole?whole:converted.replace(/\)$/,()=> (title??'')+')');
 }));
 const reference=value=>typeof value!=='string'?value:value.includes('[')?convert(value):link(value,value);
 let result=source;for(const key of ['related','superseded_by'])if(p.head[key]!=null)result=patchHead(result,{[key]:Array.isArray(p.head[key])?p.head[key].map(reference):reference(p.head[key])});
 const updated=parseDocument(result),body=mapAuthored(convert(updated.body),part=>part.replace(/^(\|\s*(?:out|in)\s*\|[^|\r\n]*\|[ \t]*)([^|\r\n]*?)([ \t]*\|.*)$/gm,(whole,before,value,after)=>before+reference(value)+after));
 return result.slice(0,updated.offset)+body;
}
export async function transfer(root,c,args,options){
 const {step='preview'}=args;let details;
 if(!['preview','prepare'].includes(step))details=(await readChanges(c.work,args.id,'transfer')).data.details;
 const target=await context(root,details?.target.connection??args.target_connection,options);requireThat(c.wiki.id!==target.wiki.id&&c.work.root!==target.work.root,'transfer','Choose another wiki and working folder.');requireThat(c.canPublish&&target.canPublish,'read-only','Both wiki connections need write permission for a transfer.');
 const combined=facade(c.work,target.work);
 const check=async data=>{requireThat(JSON.stringify(data.details.source.readers)===JSON.stringify(c.wiki.readers)&&JSON.stringify(data.details.target.readers)===JSON.stringify(target.wiki.readers)&&data.details.source.work===c.workFolder.id&&data.details.target.work===target.workFolder.id,'stale','The source, target or reader circle changed.');for(const asset of data.details.assets??[])requireThat((await c.work.read(asset.source,{binary:true}))?.sha256===asset.expected,'stale','A transferred attachment changed.');requireThat((await target.work.read('schema/TYPES.md'))?.sha256===data.details.target_register,'stale','The target vocabulary changed.');for(const change of data.changes)if(change.page.startsWith('target/')&&change.encoding!=='base64')clearance(change.text,change.page);};
 if(!['preview','prepare'].includes(step)){requireThat(step!=='rollback','transfer','A completed transfer is reversed with a new transfer preview to the original wiki.');return operateChanges(combined,args,'transfer',{check});}
 const {page,target_page,author}=args;relativePath(page);relativePath(target_page);requireThat(visibleKnowledge(page)&&visibleKnowledge(target_page)&&!['WIKI.md','wiki/index.md','wiki/bundle.md'].includes(page),'transfer','Choose a knowledge page.');const original=await c.work.read(page);requireThat(original,'missing','The page is missing.');const parsed=parseDocument(original.text);requireThat(parsed.head.id&&!parsed.head.llmwiki_redirect,'transfer','The page must carry one canonical identity.');const destination=await target.work.read(target_page),redirectTarget=destination?parseDocument(destination.text).head.llmwiki_redirect:null;requireThat(!destination||redirectTarget?.wiki===c.wiki.id&&redirectTarget?.id===parsed.head.id,'exists','The destination is occupied. Only this content’s own neutral redirect may be replaced.');const reg=await target.work.read('schema/TYPES.md');requireThat(reg&&readRegister(reg.text).genera.has(parsed.head.type),'ontology','Register this document type in the destination first.');
 if(parsed.head.resource)requireThat(target.sources.some(s=>s.id===parsed.head.resource.store&&s.store),'source_scope','Connect the same original source folder in the target before transferring a source page.');
 const graph=await buildGraph([{id:c.wiki.id,store:c.work},{id:target.wiki.id,store:target.work}]);requireThat(!graph.findings.some(f=>f.code==='duplicate_id')&&!graph.failures.length,'transfer','Resolve identity/read failures before transfer.');
 const assets=new Map(),assetRows=[],assetChanges=[];
 const normalize=value=>{const result=[];for(const p of value.split('/')){if(p==='..'){if(!result.length)return null;result.pop();}else if(p&&p!=='.')result.push(p);}return result.join('/');};
 let authored='';mapAuthored(parsed.body,part=>{authored+=part;return part;});const originalTargets=new Set(bodyLinks(parsed.head.resource?.link??'').map(l=>l.written));
 for(const link of bodyLinks(authored)){if(originalTargets.has(link.written))continue;const written=link.written;if(!/\.(?:png|jpe?g|gif|webp|avif|svg|pdf|excalidraw)(?:#.*)?$/i.test(written)||/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(written))continue;
  const decoded=decodeURIComponent(written.split('#')[0]),relative=normalize(page.split('/').slice(0,-1).concat(decoded).join('/'));requireThat(relative,'attachment_scope','An attachment outside this work folder needs an explicit source connection.');let source=relative,file=await c.work.read(source,{binary:true});if(!file&&!decoded.startsWith('.')){source=decoded;relativePath(source);file=await c.work.read(source,{binary:true});}requireThat(file,'attachment','A linked attachment is missing.',{page:source});
  const targetPath=[...target_page.split('/').slice(0,-1),'assets',file.sha256.slice(0,16)+'-'+source.split('/').at(-1)].join('/'),prior=await target.work.read(targetPath,{binary:true});requireThat(!prior||prior.sha256===file.sha256,'exists','An attachment destination differs.');assets.set(written,targetPath);if(!assetRows.some(a=>a.source===source)){assetRows.push({source,target:targetPath,expected:file.sha256});assetChanges.push({page:'target/'+targetPath,expected:prior?.sha256??null,text:encodeBytes(file.bytes),encoding:'base64',copy_from:'source/'+source});}
 }
 let text=scopedText(original.text,page,c.wiki.id,target.wiki.id,target_page,graph,assets);if(parsed.head.resource){const source=target.sources.find(s=>s.id===parsed.head.resource.store),link=originalLink(target.remote.root,source.store.root,target_page,parsed.head.resource.name);if(link){const previous=parsed.head.resource.link;text=patchHead(text,{resource:{...parsed.head.resource,link}});if(previous){const p=parseDocument(text);text=text.slice(0,p.offset)+mapAuthored(p.body,part=>part.split(previous).join(link));}}}clearance(text,page);
 const redirect=newDocument({llmwiki_redirect:{wiki:target.wiki.id,id:parsed.head.id}},'[Moved document]('+target.wiki.id+'/'+parsed.head.id+')\n');
 const trace={format:'llmwiki-transfer/1',source:{connection:c.connection.id,wiki:c.wiki.id,page,work:c.workFolder.id,readers:c.wiki.readers},target:{connection:target.connection.id,wiki:target.wiki.id,page:target_page,work:target.workFolder.id,readers:target.wiki.readers},id:parsed.head.id,author,at:args.at??c.work.services.now(),expected:original.sha256,assets:assetRows,target_register:reg.sha256};
 const traceName=await c.work.services.hash(JSON.stringify(trace)),changes=[...assetChanges,{page:'target/'+target_page,expected:destination?.sha256??null,text},{page:'source/'+page,expected:original.sha256,text:redirect}];
 if(parsed.head.resource){for(const e of await c.work.list('.llmwiki/evidence/'+encodeURIComponent(parsed.head.id),{hidden:true})){if(e.kind!=='file')continue;const file=await c.work.read(e.path);clearance(file.text,e.path);const prior=await target.work.read(e.path);requireThat(!prior||prior.sha256===file.sha256,'evidence','Destination evidence differs.');if(!prior)changes.unshift({page:'target/'+e.path,expected:null,text:file.text});}}
 for(const side of ['source','target']){const shared=side==='source'?{...trace,target:Object.fromEntries(Object.entries(trace.target).filter(([key])=>key!=='page')),assets:trace.assets.map(({source,expected})=>({source,expected}))}:trace;const text=JSON.stringify({...shared,transfer:traceName});changes.push({page:side+'/.llmwiki/transfers/'+await c.work.services.hash(text)+'.json',expected:null,text});}
 const preview=await proposal(combined,{kind:'transfer',label:'Transfer one canonical page',author,changes,details:trace});const result={...preview,at:trace.at,source:trace.source,target:trace.target,losing_access:c.wiki.readers.filter(r=>!target.wiki.readers.includes(r)),gaining_access:target.wiki.readers.filter(r=>!c.wiki.readers.includes(r)),warning:'The target folder controls the new reader circle. Approval transfers the complete page. Old links reveal no target title to readers without target access.'};return step==='prepare'?prepareChanges(combined,preview,args.expected):result;
}
