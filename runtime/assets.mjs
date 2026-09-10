/** Embedded assets remain components of their Markdown note (ADR-28). No OCR is invented here. */
import {parseDocument,bodyLinks} from './core/document.mjs';
import {relativePath,requireThat,nonempty} from './core/errors.mjs';
import {save} from './review.mjs';
export const imagePath=p=>/\.(png|jpe?g|gif|webp|avif)$/i.test(p);
export function imageType(b){
 if(b[0]===137&&String.fromCharCode(...b.slice(1,8))==='PNG\r\n\x1a\n')return 'png';
 if(b[0]===255&&b[1]===216&&b[2]===255)return 'jpg';
 if(/^GIF8[79]a/.test(String.fromCharCode(...b.slice(0,6))))return 'gif';
 if(String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP')return 'webp';
 if(String.fromCharCode(...b.slice(4,8))==='ftyp'&&/avif|avis/.test(String.fromCharCode(...b.slice(8,32))))return 'avif';
 return null;
}
export function assetName({title,sha256,date,extension}){
 requireThat(/^[a-f0-9]{64}$/.test(sha256)&&['png','jpg','gif','webp','avif'].includes(extension),'asset','Invalid image digest or type.');
 requireThat(/^\d{4}-\d{2}-\d{2}$/.test(date),'date','Supply the capture date (not an invented meeting date).');
 const slug=(title||'Bild').normalize('NFC').replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'').slice(0,90)||'Bild';
 return date+'_'+slug+'_'+sha256.slice(0,8)+'.'+extension;
}
export function resolveAsset(page,written,files){
 let target;try{target=decodeURIComponent(written.split('|')[0].replace(/^<|>$/g,'').split('#')[0]);}catch{return null;}
 if(!target||/^[a-z]+:|^\/|\\|\x00/i.test(target))return null;
 const parts=page.split('/').slice(0,-1);for(const part of target.split('/')){if(part==='..'){if(!parts.length)return null;parts.pop();}else if(part!=='.')parts.push(part);}
 const direct=parts.join('/');if(files.includes(direct))return direct;
 if(files.includes(target))return target;
 if(target.includes('/'))return null;
 const matches=files.filter(p=>p.split('/').at(-1)===target);return matches.length===1?matches[0]:null;
}
export async function assetFolder(store){
 const config=await store.read('.obsidian/app.json');if(config)try{const name=JSON.parse(config.text).attachmentFolderPath;relativePath(name);if(!name.split('/').some(p=>p.startsWith('.')))return name;}catch{}
 const dirs=await store.list('',{recursive:false});for(const name of ['_attachments','Attachments'])if(dirs.some(e=>e.path===name&&e.kind==='directory'))return name;
 return '_attachments';
}
export async function reading(store,sha){const file=await store.read('.llmwiki/evidence/images/'+sha+'.json');return file?JSON.parse(file.text):null;}
export async function embeddedAssets(store,page,text,entries){
 const files=(entries??await store.list('')).filter(e=>e.kind==='file').map(e=>e.path),out=[];
 for(const link of bodyLinks(parseDocument(text).body).filter(l=>l.embedded)){
  if(!imagePath(link.written.split('|')[0].split('#')[0]))continue;
  const path=resolveAsset(page,link.written,files),file=path?await store.read(path,{binary:true}):null;
  const record=file?await reading(store,file.sha256):null;
  out.push({written:link.written,path,sha256:file?.sha256??null,state:!file?'missing_or_ambiguous':!record?'reading_required':record.gaps.length?'coverage_required':'reviewed',reading:record});
 }
 return out;
}
export async function planAssets(store){const entries=await store.list(''),items=new Map(),findings=[];
 for(const e of entries)if(e.kind==='file'&&/\.md$/i.test(e.path)&&!e.path.endsWith('.excalidraw.md')){
  const file=await store.read(e.path);for(const a of await embeddedAssets(store,e.path,file.text,entries)){if(!a.path){findings.push({page:e.path,...a});continue;}if(!items.has(a.path))items.set(a.path,{...a,pages:[]});items.get(a.path).pages.push(e.path);}
 }
 return {folder:await assetFolder(store),items:[...items.values()],findings,unreferenced:entries.filter(e=>e.kind==='file'&&imagePath(e.path)&&!items.has(e.path)).map(e=>({path:e.path,state:'unreferenced',next:'Keep the original. Explicitly ingest as a source or embed in a note.'}))};
}
export async function reviewAsset(store,args){
 const {path,expected,author,kind}=args;relativePath(path);nonempty(author,'author');const file=await store.read(path,{binary:true});requireThat(file?.sha256===expected,'stale','Read the current image.');
 const extension=imageType(file.bytes);requireThat(extension,'image','Only a recognized raster image can receive an image reading.');requireThat(['content','decorative'].includes(kind),'image','Classify content or decorative explicitly.');
 nonempty(args.title,'title',200);nonempty(args.description,'description');requireThat(Array.isArray(args.gaps)&&args.gaps.every(g=>typeof g==='string'&&g.trim()),'image','List unresolved visual gaps explicitly, or use an empty list.');
 if(kind==='content'){requireThat(typeof args.transcription==='string','image','Provide full transcription (empty only when there is no text).');nonempty(args.interpretation,'interpretation');}
 const date=store.services.now().slice(0,10),record={format:'llmwiki-image-reading/1',sha256:expected,original_path:path,author,at:store.services.now(),kind,title:args.title,description:args.description,transcription:args.transcription??'',interpretation:args.interpretation??'',gaps:args.gaps,capture_date:date,capture_date_basis:'integration_date'},evidence=args.gaps.length?'.llmwiki/evidence/image-attempts/'+store.services.uuid()+'.json':'.llmwiki/evidence/images/'+expected+'.json';
 const prior=await store.read(evidence);if(prior){const existing=JSON.parse(prior.text);requireThat(existing.gaps.length>0||JSON.stringify({...existing,at:record.at,author:record.author})===JSON.stringify(record),'image_review_exists','A completed image reading is immutable. Preserve it and discuss a revised interpretation in the note.');}
 await store.write(evidence,JSON.stringify(record,null,2)+'\n',{expected:prior?.sha256??null});
 return {evidence,complete:!record.gaps.length,suggested_name:assetName({title:args.title,sha256:expected,date,extension}),next:kind==='content'?'Include transcription, visual description and separate interpretation in the parent Markdown, then note.review.':'note.review'};
}
export async function renameAsset(store,{path,expected,author}){
 nonempty(author,'author');const file=await store.read(path,{binary:true});requireThat(file?.sha256===expected,'stale','Read the current attachment.');const record=await reading(store,expected);requireThat(record&&!record.gaps.length,'asset_review_required','Complete the semantic reading first.');
 const name=assetName({title:record.title,sha256:expected,date:record.capture_date,extension:imageType(file.bytes)}),to=(await assetFolder(store))+'/'+name;if(path===to)return {path:to,changed:[],original_preserved:true};
 const existing=await store.read(to,{binary:true});requireThat(!existing||existing.sha256===expected,'exists','The destination has different content.');
 const entries=await store.list(''),files=entries.filter(e=>e.kind==='file').map(e=>e.path),edits=[];
 for(const p of files.filter(p=>p.endsWith('.md')&&!p.endsWith('.excalidraw.md'))){const f=await store.read(p),parsed=parseDocument(f.text);if(parsed.head.resource)continue;
  const replace=part=>part.replace(/!\[\[([^\]]+)\]\]|!\[([^\]]*)\]\((<[^>]+>|[^\s)]+)\s*\)/g,(all,wiki,alt,target)=>{
   if(resolveAsset(p,wiki??target,files)!==path)return all;
   const from=p.split('/').slice(0,-1),dest=to.split('/');while(from.length&&dest[0]===from[0]){from.shift();dest.shift();}const relative='../'.repeat(from.length)+dest.join('/');return '!['+(alt??record.title).replace(/[\[\]\r\n]/g,'')+']('+relative.split('/').map(encodeURIComponent).join('/')+')';
  });
  let fence=null;const body=parsed.body.split(/(?<=\n)/).map(line=>{const marker=/^ {0,3}(`{3,}|~{3,})/.exec(line);if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence=null;return line;}if(fence)return line;return line.split(/(`+[^`]*`+)/).map(part=>part.startsWith('`')?part:replace(part)).join('');}).join('');
  const text=f.text.slice(0,parsed.offset)+body;if(text!==f.text)edits.push({page:p,text,expected:f.sha256});
 }
 if(!existing)await store.write(to,file.bytes,{expected:null});
 const changed=[];for(const edit of edits){await save(store,edit.page,edit.text,author,edit.expected);changed.push(edit.page);}
 return {path:to,changed,original_preserved:true,deleted:0};
}
