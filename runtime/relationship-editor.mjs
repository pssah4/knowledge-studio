/** Guided relationship drafts (ADR-02/22): validate direction, ontology and target
 * before changing either YAML membership or a table. Incoming relationships are
 * authored as outgoing rows in the other note, preserving the authoritative side.
 */
import {pageKey,resolvePage} from './core/graph.mjs';
import {parseDocument,patchHead,listValue,relationRows} from './core/document.mjs';
import {edgeAllowed} from './core/ontology.mjs';
import {markdownLink} from './links.mjs';
import {requireThat} from './core/errors.mjs';
function endpoints(view,args){
 const graph=view.core,current=graph?.pages.get(pageKey(args.wiki,args.page)),other=graph?.pages.get(pageKey(args.targetWiki,args.targetPage));
 requireThat(current&&other&&current.key!==other.key&&['out','in'].includes(args.direction),'relationship','Choose a connected target and a direction.');
 const active={...current,...parseDocument(args.text)},origin=args.direction==='out'?active:other,target=args.direction==='out'?other:active,register=graph.scopes.get(origin.wiki)?.register;
 let valid=false;try{valid=edgeAllowed(register,args.type,origin.head.type,target.head.type);}catch{}
 requireThat(valid,'relationship','This relationship is not allowed for the selected document types.');return {graph,origin,target};
}
export function relationshipOptions(view,{wiki,page,text,direction}){
 const graph=view.core;if(!graph)return [];const types=new Set([...graph.scopes.values()].flatMap(s=>[...s.register?.edges.keys()??[]]));const options=[];
 for(const type of types)for(const target of graph.pages.values())try{const {origin}=endpoints(view,{wiki,page,text,direction,type,targetWiki:target.wiki,targetPage:target.path});options.push({type,definition:graph.scopes.get(origin.wiki).register.edges.get(type).definition,wiki:target.wiki,page:target.path,title:target.head.title||target.path});}catch{}
 return options;
}
export function relationshipDraft(view,args){
 const {graph,origin,target}=endpoints(view,args);requireThat(typeof args.reason==='string'&&args.reason.trim()&&args.reason.length<=2000&&!/[\r\n\x00-\x1f]/.test(args.reason),'relationship','Add a one-line explanation for this relationship.');
 const from=graph.scopes.get(origin.wiki),to=graph.scopes.get(target.wiki);
 const link=origin.wiki===target.wiki?markdownLink(origin.path,target.path,target.head.title):from.path!==null&&to.path!==null?markdownLink(from.path+'/'+origin.path,to.path+'/'+target.path,target.head.title):markdownLink('',target.wiki+'/'+target.path,target.head.title).replace('(./','(');
 requireThat(resolvePage(graph,origin,/\]\((.*)\)$/.exec(link)[1]).key===target.key,'relationship','The selected target cannot be resolved uniquely.');
 requireThat(!relationRows(origin.body).some(r=>r.direction==='out'&&r.type===args.type&&resolvePage(graph,origin,r.written).key===target.key),'relationship','This relationship already exists.');
 const eol=origin.source.includes('\r\n')?'\r\n':'\n',safe=value=>value.replace(/\|/g,'\\|'),row='| out | '+args.type+' | '+safe(link)+' | '+safe(args.reason.trim())+' |';
 let text=patchHead(origin.source,{related:[...new Set([...listValue(origin.head.related),link])]}),parsed=parseDocument(text),body=parsed.body;
 const section=/^## (?:Beziehungen|Relations)\s*\r?$/m.exec(body);
 if(section){const tail=body.slice(section.index+section[0].length),next=/^## /m.exec(tail),end=next?section.index+section[0].length+next.index:body.length;let at=end;const table=[...body.slice(section.index,end).matchAll(/^\|[^\r\n]*\|\r?$/gm)].at(-1);if(table)at=section.index+table.index+table[0].length;
  const addition=table?eol+row:eol+eol+'| Direction | Type | Target | Reason |'+eol+'| --- | --- | --- | --- |'+eol+row+eol;body=body.slice(0,at)+addition+body.slice(at);
 }else body+=(body.endsWith(eol)?'':eol)+eol+'## Beziehungen'+eol+eol+'| Richtung | Art | Gegenstelle | Begründung |'+eol+'| --- | --- | --- | --- |'+eol+row+eol;
 text=text.slice(0,parsed.offset)+body;return {wiki:origin.wiki,page:origin.path,text,before:origin.source};
}
