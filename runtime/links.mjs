/** Portable Markdown links; source mirrors and code examples stay byte-identical. */
import {resolvePage} from './core/graph.mjs';
import {parseDocument,patchHead} from './core/document.mjs';
export function markdownLink(from,to,label){
 const a=from.split('/').slice(0,-1),b=to.split('/');while(a.length&&b.length&&a[0]===b[0]){a.shift();b.shift();}
 const target=(a.length?'../'.repeat(a.length):'./')+b.map(p=>encodeURIComponent(p).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16))).join('/');
 return '['+String(label??to).replace(/[\[\]\\|\r\n]/g,' ')+']('+target+')';
}
export function rewriteDocument(source,from,to,mapping,graph){
 const page={wiki:'wiki',path:from},parsed=parseDocument(source);
 const rewrite=(whole,written,label)=>{
  const resolved=resolvePage(graph,page,written),target=graph.pages.get(resolved.key);if(!target)return whole;
  const hash=written.indexOf('#'),anchor=hash<0?'':written.slice(hash);
  return markdownLink(to,mapping[target.path]??target.path,label||target.head.title).replace(/\)$/,(anchor||'')+')');
 };
 const convert=text=>text.replace(/<!-- llmwiki:source:start -->[\s\S]*?<!-- llmwiki:source:end -->|^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*(?:\n|$)|(`+)[^\n]*?\2|(!?)\[\[([^\]]+)\]\]|(!?)\[([^\]]*)\]\(<?([^\s)>]+)>?\)/gm,(whole,fence,inline,embed,wiki,image,label,url)=>{
  if(fence||inline||whole.startsWith('<!--'))return whole;
  if(wiki){const [written,title]=wiki.split('|');return(embed||'')+rewrite(whole.replace(/^!/,''),written,title);}
  return(image||'')+rewrite(whole.replace(/^!/,''),url,label);
 });
 const changes={};for(const key of ['related','superseded_by'])if(parsed.head[key])changes[key]=(Array.isArray(parsed.head[key])?parsed.head[key]:[parsed.head[key]]).map(value=>{
   const raw=String(value);return raw.includes('[')?convert(raw):rewrite(raw,raw);
 });
 const patched=Object.keys(changes).length?patchHead(source,changes):source,p=parseDocument(patched);
 return patched.slice(0,p.offset)+convert(p.body);
}
