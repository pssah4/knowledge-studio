/** Compact read-only citation addresses. They select evidence; they grant no access
 * and do not archive historical text (retained pins have that separate contract). */
import {relativePath,requireThat} from './core/errors.mjs';
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export function validatePassage(p){
 requireThat(p?.version===1,'citation_link','Unsupported passage link.');
 for(const key of ['project','instance','connection','work','wiki'])requireThat(typeof p[key]==='string'&&p[key].length>0&&p[key].length<=256,'citation_link','Invalid passage scope.');
 requireThat(typeof p.page==='string'&&p.page.length<=2048,'citation_link','Invalid passage path.');relativePath(p.page);
 requireThat(hex(p.revision)&&hex(p.quote_hash)&&(p.document===null||hex(p.document))&&(p.block===null||hex(p.block)),'citation_link','Invalid passage identity.');
 requireThat([p.start,p.end,p.offset].every(Number.isSafeInteger)&&p.start>=0&&p.end>p.start&&p.end<=128*1024*1024&&p.offset>=0&&p.offset<=p.start,'citation_link','Invalid passage range.');
 return p;
}
export function encodePassage(p){
 validatePassage(p);const data=[1,p.project,p.instance,p.connection,p.work,p.wiki,p.page,p.document,p.block,p.revision,p.start,p.end,p.offset,p.quote_hash];
 const encoded=btoa(Array.from(new TextEncoder().encode(JSON.stringify(data)),b=>String.fromCharCode(b)).join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
 requireThat(encoded.length<=8192,'citation_link','Passage address is too long.');return encoded;
}
export function decodePassage(token){
 requireThat(typeof token==='string'&&token.length>0&&token.length<=8192&&/^[A-Za-z0-9_-]+$/.test(token),'citation_link','Invalid passage link.');
 let a;try{a=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(token.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))));}catch{requireThat(false,'citation_link','Invalid passage encoding.');}
 requireThat(Array.isArray(a)&&a.length===14,'citation_link','Invalid passage fields.');
 const [version,project,instance,connection,work,wiki,page,document,block,revision,start,end,offset,quote_hash]=a;return validatePassage({version,project,instance,connection,work,wiki,page,document,block,revision,start,end,offset,quote_hash});
}
