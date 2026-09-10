/** ADR-05: participation is a registered boolean, never a sharing permission. */
import {readFields,fieldFile} from './collection.mjs';
import {parseDocument,patchHead} from './core/document.mjs';
import {requireThat,nonempty} from './core/errors.mjs';
import {visibleKnowledge} from './content.mjs';
import {save} from './review.mjs';
const explanation='Participation selects an overview. It grants no access and hides no other page in an accessible wiki. An empty overview means no readable page currently participates; agree on participation and actual folder access.';
export async function registerParticipation(store,{field,label,author,expected}){
 nonempty(author,'author');nonempty(label,'overview label');requireThat(/^x_[a-z][a-z0-9_]*$/.test(field)&&!/(private|privat|secret|geheim|confidential|vertraulich|permission|berechtigung|restricted|geschützt|public|öffentlich)/i.test(field+' '+label),'participation','Use a neutral overview name; participation does not control confidentiality.');
 const {file,data}=await readFields(store);requireThat((file?.sha256??null)===expected,'stale','Read the field register before changing it.');requireThat(!data.fields.some(f=>f.name===field),'participation','The field is already registered.');data.fields.push({name:field,label,kind:'participation',type:'boolean',by:author});await save(store,fieldFile,JSON.stringify(data,null,2)+'\n',author,expected);return {registered:true,field,explanation,sha256:(await store.read(fieldFile)).sha256};
}
export async function participationMatches(store,head,field){const {data}=await readFields(store);return data.fields.some(f=>f.name===field&&f.kind==='participation'&&f.type==='boolean')&&head[field]===true;}
export async function setParticipation(store,{page,field,value,expected,author}){
 requireThat(typeof value==='boolean'&&visibleKnowledge(page),'participation','Set participation to true or false on a knowledge page.');const {data}=await readFields(store);requireThat(data.fields.some(f=>f.name===field&&f.kind==='participation'),'participation','Register this participation field first.');const file=await store.read(page);requireThat(file&&file.sha256===expected,'stale','The page changed.');await save(store,page,patchHead(file.text,{[field]:value}),author,expected);return {page,field,value,sha256:(await store.read(page)).sha256,explanation};
}
export async function overview(wikis,field){nonempty(field,'participation field');const pages=[],findings=[];let registered=false;
 for(const wiki of wikis){try{const {data}=await readFields(wiki.store);if(!data.fields.some(f=>f.name===field&&f.kind==='participation'))continue;registered=true;for(const entry of await wiki.store.list(''))if(entry.kind==='file'&&visibleKnowledge(entry.path))try{const file=await wiki.store.read(entry.path),p=parseDocument(file.text);if(p.head[field]===true){const current=await wiki.store.read(entry.path);requireThat(current?.sha256===file.sha256,'stale','Participating page changed.');pages.push({wiki:wiki.id,page:entry.path,title:p.head.title??entry.path,sha256:file.sha256});}}catch(e){findings.push({wiki:wiki.id,code:e.code??'access'});}}catch(e){findings.push({wiki:wiki.id,code:e.code??'access'});}}
 return {field,pages,registered,complete:!findings.length,findings,explanation};
}
