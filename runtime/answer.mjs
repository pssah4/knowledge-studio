/** Static answer presentation. Evidence and editor validation are read-only;
 * text is agent-authored, quotations and link destinations are runtime-authored. */
import {requireThat} from './core/errors.mjs';
import {load,context} from './project.mjs';
import {editorDestination} from './citations.mjs';
import {decodePassage} from './passage-links.mjs';
import {resolvePassage} from './shadow-project.mjs';

const check=(ok,message)=>requireThat(ok,'answer_input',message);
const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function shape(value,keys){check(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.includes(k)),'Use the documented answer fields only.');}
function text(value,max=32768){check(typeof value==='string'&&value.trim().length>0&&value.length<=max,'Answer text is empty or exceeds its limit.');return escape(value);}
function array(value,max){check(Array.isArray(value)&&value.length>0&&value.length<=max,'Answer list is empty or exceeds its limit.');return value;}

export async function renderAnswer(root,request,{bindings={}}={}){
 shape(request,['action','question','title','references','blocks']);check(request.action==='answer.export','Use action answer.export in the presentation helper.');
 const question=text(request.question,4000),title=text(request.title??'Antwort mit Quellen',200),references=array(request.references,128),blocks=array(request.blocks,512);
 check(new TextEncoder().encode(JSON.stringify(request)).length<=2*1024*1024,'Answer input exceeds 2 MiB.');
 const tokens=references.map(token=>{check(typeof token==='string','Copy passage.reference unchanged.');return decodePassage(token);});
 const {project}=await load(root),destination=await editorDestination(root,project);
 requireThat(destination.available,'answer_editor','A compatible canonical project editor is required.',{reason:destination.reason,minimum_editor:destination.minimum_editor});
 const scopes=new Map(),verified=new Map(),evidence=[];
 for(let i=0;i<tokens.length;i++){
  const p=tokens[i],token=references[i];requireThat(p.project===project.id&&p.instance===destination.instance,'citation_scope','This passage belongs to another project instance.');
  const key=JSON.stringify([p.connection,p.work]);
  if(!scopes.has(key)){const c=await context(root,p.connection,{bindings,work:p.work});scopes.set(key,{id:c.wiki.id,connection:c.connection.id,work:c.workFolder.id,store:c.work});}
  if(!verified.has(token)){
   const resolved=await resolvePassage([scopes.get(key)],token,{project:project.id,instance:destination.instance});
   requireThat(resolved.current&&typeof resolved.quote==='string','answer_evidence','A cited passage is no longer verifiable. Query the current wording before exporting.',{index:i,state:resolved.state,reason:resolved.reason});
   verified.set(token,{...resolved,number:verified.size+1,href:destination.entry_href+'#passage='+token});
  }
  evidence.push(verified.get(token));
 }
 const ref=index=>{check(Number.isSafeInteger(index)&&index>=0&&index<evidence.length,'Reference index is outside the references array.');return evidence[index];};
 const link=index=>{const e=ref(index);return '<a class="citation" href="'+escape(e.href)+'" target="_blank" rel="noopener" title="'+escape(e.page+' — '+e.quote.slice(0,400))+'" aria-label="'+escape('Beleg '+e.number+': '+e.page)+'">['+e.number+']</a>';};
 const links=indices=>' '+[...new Set(array(indices,128))].map(link).join(' ');
 const claim=value=>{shape(value,['text','refs']);return text(value.text)+links(value.refs);};
 const body=blocks.map(block=>{
  check(block&&typeof block==='object','Each answer block needs a type.');
  switch(block.type){
   case 'heading':shape(block,['type','text']);return '<h2>'+text(block.text,200)+'</h2>';
   case 'paragraph':shape(block,['type','text','refs']);return '<p>'+text(block.text)+links(block.refs)+'</p>';
   case 'list':{shape(block,['type','ordered','items']);check(block.ordered===undefined||typeof block.ordered==='boolean','ordered must be boolean.');const tag=block.ordered?'ol':'ul';return '<'+tag+'>'+array(block.items,256).map(item=>'<li>'+claim(item)+'</li>').join('')+'</'+tag+'>';}
   case 'table':{shape(block,['type','columns','rows']);const columns=array(block.columns,12);return '<div class="table"><table><thead><tr>'+columns.map(c=>'<th scope="col">'+text(c,200)+'</th>').join('')+'<th scope="col">Beleg</th></tr></thead><tbody>'+array(block.rows,256).map(row=>{shape(row,['cells','refs']);check(Array.isArray(row.cells)&&row.cells.length===columns.length,'Table rows must match the columns.');return '<tr>'+row.cells.map(c=>'<td>'+text(c)+'</td>').join('')+'<td>'+links(row.refs)+'</td></tr>';}).join('')+'</tbody></table></div>';}
   case 'quote':shape(block,['type','ref']);return '<blockquote><p>'+escape(ref(block.ref).quote)+'</p><cite>'+escape(ref(block.ref).page)+' '+link(block.ref)+'</cite></blockquote>';
   case 'note':shape(block,['type','text']);return '<aside>'+text(block.text,4000)+'</aside>';
   default:check(false,'Unknown answer block type.');
  }
 }).join('\n');
 const brand=typeof __LLMWIKI_BRAND__!=='undefined'?__LLMWIKI_BRAND__:'Knowledge Studio';
 const html='<!doctype html>\n<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><title>'+title+' · '+brand+'</title><style>body{margin:0;background:#f6f7f9;color:#19232f;font:18px/1.6 system-ui,sans-serif}main{max-width:860px;margin:0 auto;padding:40px 28px 80px;background:white;min-height:100vh;box-sizing:border-box}header{border-bottom:1px solid #d7dde4;margin-bottom:32px;padding-bottom:20px}header small{color:#536473}h1{font-size:1.7em;line-height:1.2}h2{font-size:1.2em;margin-top:2em}p,li,td{white-space:pre-wrap;overflow-wrap:anywhere}li{margin:.65em 0}.citation{white-space:nowrap;color:#064fb5;text-decoration:none;font-size:.85em;font-weight:650;padding:.1em .25em;border-radius:4px;background:#eef4ff}.citation:hover,.citation:focus-visible{outline:2px solid #064fb5}blockquote{margin:1.5em 0;padding:.2em 1em;border-left:4px solid #a3bbd8;background:#f5f8fc}cite{font-size:.8em;font-style:normal}aside{padding:12px 16px;border:1px solid #d7dde4;border-radius:8px;color:#425363}.table{overflow:auto}table{border-collapse:collapse;width:100%;font-size:.9em}th,td{padding:10px;text-align:left;vertical-align:top;border-bottom:1px solid #d7dde4}@media print{body,main{background:white}main{padding:0}.citation{color:#064fb5}}</style></head><body><main><header><small>'+brand+'</small><h1>'+title+'</h1><p>'+question+'</p><small>Die nummerierten Belege öffnen die geprüfte Textstelle im Projekteditor. Beim ersten Öffnen den Projektordner im Browser freigeben.</small></header>'+body+'</main></body></html>\n';
 return {html,references:verified.size};
}
