/** Explicit migration of legacy metadata without touching a source mirror. */
import {parseDocument,removeHeadFields,patchHead,mirroredContent} from './core/document.mjs';
import {requireThat,nonempty,relativePath} from './core/errors.mjs';
import {save} from './review.mjs';
export async function repairMetadata(store,{page,expected,author,description,generated}){
 relativePath(page);nonempty(author,'author');const seen=await store.read(page);requireThat(seen?.sha256===expected,'stale','Read the current document before metadata repair.');const p=parseDocument(seen.text),before=mirroredContent(p.body);
 requireThat(!p.head.source_id||p.head.source_id===p.head.id,'identity','Resolve distinct legacy identities explicitly; do not discard a source identifier.');
 const updates={};if(description!==undefined){nonempty(description,'description');requireThat(description.trim().split(/\s+/).length<=25,'description','Use one concise sentence with at most 25 words.');updates.description=description;}
 if(!p.head.generated){
  const known=generated??(p.head.created&&p.head.author?{by:p.head.author,at:p.head.created}:null);
  requireThat(known?.by&&Number.isFinite(Date.parse(known.at)),'provenance','Supply evidenced original generation metadata; the repair time is not the creation time.');updates.generated=known;
 }
 const archive='.llmwiki/repairs/metadata/'+seen.sha256+'.md';if(!await store.read(archive))await store.write(archive,seen.text,{expected:null});
 if(p.head.extraction){requireThat(before!==null&&p.head.resource?.sha256,'evidence','Legacy extraction proof requires its source mirror and original hash.');const proof='.llmwiki/evidence/'+encodeURIComponent(p.head.id)+'/'+p.head.resource.sha256+'/'+await store.services.hash(before)+'.json',existing=await store.read(proof),text=JSON.stringify(p.head.extraction)+'\n';requireThat(!existing||JSON.stringify(JSON.parse(existing.text))===JSON.stringify(p.head.extraction),'evidence','A different reading already exists.');if(!existing)await store.write(proof,text,{expected:null});}
 let text=removeHeadFields(patchHead(seen.text,updates),['created','updated','author','source_id','extraction']);
 const bundle=await store.read('wiki/bundle.md');if(page!=='wiki/bundle.md'&&bundle&&p.head.owner===parseDocument(bundle.text).head.owner)text=removeHeadFields(text,['owner']);
 requireThat(mirroredContent(parseDocument(text).body)===before,'mirror','A metadata repair must preserve the complete source mirror.');
 if(text!==seen.text)await save(store,page,text,author,seen.sha256);return {page,changed:text!==seen.text,backup:archive,sha256:await store.services.hash(text)};
}
