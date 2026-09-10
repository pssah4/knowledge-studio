import {encodePassage} from './passage-links.mjs';
/** Read-only passage locators. Existing Markdown anchors only; never invent block IDs. */
const words=text=>String(text).toLocaleLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu)??[];
const label=text=>String(text).replace(/[\[\]\\\r\n]/g,' ');
export async function citation(page,store,question,{start=0,end=page.body.length}={}){
 const file_href=store.fileURL?await store.fileURL(page.path):(store.hostPath?store.hostPath(page.path):page.path).split('/').map(encodeURIComponent).join('/');
 const terms=new Set(words(question)),lines=page.body.split('\n'),passages=[];let offset=0,heading=null,fence=null,paragraph=null;
 const finish=()=>{if(!paragraph)return;const quote=paragraph.lines.join('\n').trimEnd(),tokens=new Set(words(quote)),score=[...terms].filter(t=>tokens.has(t)).length;
  if(score&&paragraph.start<end&&paragraph.end>start){const block=/\^([a-zA-Z0-9-]+)\s*$/.exec(quote),anchor=block?'^'+block[1]:paragraph.heading;
   const href=file_href+(anchor?'#'+encodeURIComponent(anchor):'');const sourceOffset=page.offset+paragraph.start;
   passages.push({quote,start:paragraph.start,end:paragraph.end,line_start:page.source.slice(0,sourceOffset).split('\n').length,line_end:page.source.slice(0,page.offset+paragraph.end).split('\n').length,anchor:anchor??null,anchor_kind:block?'block':anchor?'heading':null,href,markdown:'['+label(page.head.title??page.path)+']('+href+')',score});
  }paragraph=null;};
 for(const line of lines){const marker=/^ {0,3}(`{3,}|~{3,})/.exec(line),h=!fence&&/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
  if(marker){finish();if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence=null;}
  else if(h){finish();heading=h[1];}
  else if(!line.trim()||fence||line.startsWith('<!--'))finish();
  else{paragraph??={start:offset,end:offset,heading,lines:[]};paragraph.lines.push(line);paragraph.end=offset+line.length;}
  offset+=line.length+1;
 }finish();
 passages.sort((a,b)=>b.score-a.score||a.start-b.start);const selected=passages.slice(0,8).map(({score,...p})=>p),href=selected[0]?.href??file_href;
 return {id:page.head.source_id??page.head.id,wiki:page.wiki,page:page.path,title:page.head.title??page.path,sha256:page.sha256,file_href,href,markdown:'['+label(page.head.title??page.path)+']('+href+')',passages:selected,locator_notice:'Anchors refer only to existing headings or blocks. Quotes, line numbers and SHA-256 identify this file version; lines are not permanent addresses.'};
}

/** Read the existing canonical editor; never install or repair it from Query. */
export async function editorDestination(root,project){
 let entry=null,marker=null,entryError=null;try{entry=await root.read('LLM-Wiki.html');marker=await root.read('.llmwiki/project-instance.json');}catch(error){entryError=error.code??'editor_read_error';}let instance=null;try{const data=JSON.parse(marker?.text??'null');if(data?.project===project.id)instance=data.instance;}catch{}
 const version=entry?.text.match(/<meta name="llmwiki-editor-version" content="([^"]+)">/)?.[1],parts=version?.split('.').map(Number);
 const compatible=parts?.length===3&&parts.every(Number.isInteger)&&(parts[0]>0||parts[1]>4||parts[1]===4&&parts[2]>=23);
 const bound=instance&&entry?.text.includes('<meta name="llmwiki-entry-project" content="'+project.id+'">')&&entry?.text.includes('<meta name="llmwiki-entry-instance" content="'+instance+'">');
 let href=null;try{if(entry&&root.fileURL)href=await root.fileURL('LLM-Wiki.html');}catch(error){entryError=error.code??'editor_link_error';}
 return {instance,mode:'inline_editor',available:Boolean(href&&bound&&compatible),reason:entryError??(!entry?'editor_missing':!bound?'editor_instance_mismatch':!compatible?'editor_update_required':!href?'editor_link_unavailable':null),minimum_editor:'0.4.23',entry_href:href,use:'Place passage.markdown immediately after the supported claim. Keep editor_href intact; never reconstruct a relative wiki path. A bibliography does not replace inline evidence.'};
}
/** Attach an executable editor destination to each exact Shadow passage. */
export async function editorCitations(root,project,contexts,result){
 const {instance,...destination}=await editorDestination(root,project),href=destination.entry_href;result.citation_links=destination;
 let number=0;
 for(const citation of result.citations){
  const scope=contexts.find(c=>c.wiki.id===citation.wiki);citation.file_markdown=citation.markdown;
  for(const passage of citation.shadow.passages){
   passage.number=++number;passage.source_title=citation.title;passage.editor_href=null;passage.markdown=null;
   if(!instance||!scope)continue;
   const reference=encodePassage({version:1,project:project.id,instance,connection:scope.connection.id,work:scope.workFolder.id,wiki:passage.wiki,page:passage.page,document:passage.document,block:passage.block,revision:passage.revision,start:passage.start,end:passage.end,offset:passage.partial?passage.start-passage.block_start:0,quote_hash:await root.services.hash(passage.quote)});
   passage.reference=reference;
   if(result.citation_links.available){passage.editor_href=href+'#passage='+reference;passage.href=passage.editor_href;passage.markdown='['+passage.number+'](<'+passage.editor_href+'>)';}
  }
  citation.href=citation.shadow.passages[0]?.editor_href??null;citation.markdown=citation.shadow.passages[0]?.markdown??null;
  for(const legacy of citation.passages){legacy.file_href=legacy.href;legacy.file_markdown=legacy.markdown;const matches=citation.shadow.passages.filter(p=>p.quote===legacy.quote&&p.line_start===legacy.line_start&&p.line_end===legacy.line_end),exact=matches.length===1?matches[0]:null;legacy.href=exact?.editor_href??null;legacy.markdown=exact?.markdown??null;}
 }
 return result;
}
