/* Selection and retirement for read-only participation views. File transfer uses
   the existing EditorSync page loop; the transport never publishes this work. */
(function(global){
'use strict';
const F=()=>global.FolderAccess,R=()=>global.WikiReviews,K=()=>global.WikiContributions;
function need(value,code){if(!value)throw Object.assign(new Error(code),{code});}
async function peek(dir,page){try{return await F().readFile(dir,page);}catch(e){if(e.name==='NotFoundError')return null;throw e;}}
async function selection(o,result){
 const field=o.participation?.field;need(/^x_[a-z][a-z0-9_]*$/.test(field),'participation_field');need(o.canPublish===false,'participation_read_only');
 const selected=new Map();for(const page of await K().files(o.remote)){
  if(!/\.md$/i.test(page)||page.split('/').some(s=>s.startsWith('.')))continue;
  const file=await peek(o.remote,page),head=global.WikiCore.parseDocument(file.text).head;if(head[field]!==true)continue;
  selected.set(page,{name:page,size:file.text.length,document:head.id??null});
 }
 result.linked=[];result.left=[];result.received_at=new Date().toISOString();
 const path='.llmwiki/participation/'+await R().hash(o.identity+'/'+field)+'.json',before=await peek(o.work,path),state=before?JSON.parse(before.text):null;
 need(!state||state.format==='llmwiki-participation-sync/1'&&state.field===field&&Array.isArray(state.pages),'participation_state_invalid');
 for(const page of state?.pages??[]){if(selected.has(page))continue;
  const archivePage=async()=>{const file=await peek(o.work,page);if(!file)return null;
   const archive='.llmwiki/participation/left/'+global.crypto.randomUUID()+'/'+page;
   if(!F().archiveFile||F().canArchive&&!F().canArchive(o.work))return {page,reason:'host_move_required',archive};
   if(!o.alive())return null;await F().archiveFile(o.work,page,archive,await R().hash(file.text));return {page,archive};
  };
  const left=o.step?await o.step(JSON.stringify(['participation_left',page]),archivePage):await archivePage();
  if(left?.reason){result.pending++;result.pending_details.push(left);}else if(left)result.left.push(left);
 }
 return {selected,path,before,field,state};
}
async function finish(o,view,result){
 const pages=[];for(const [page,entry]of view.selected){
  const local=await peek(o.work,page),remote=await peek(o.remote,page);if(!local||!remote||local.text!==remote.text)continue;
  const events=(await R().read(o.remote,page)).events,statement=global.WikiCore.statementText(remote.text),outside_process=!events.some(e=>['change','accept'].includes(e.kind)&&global.WikiCore.statementText(e.text)===statement);
  pages.push(page);result.linked.push({page,document:entry.document,wiki:o.contributionMeta?.target?.bundle_id??null,statement_sha256:await R().hash(statement),outside_process});
 }
 const old=(view.state?.pages??[]).filter(page=>!result.left.some(left=>left.page===page)&&!pages.includes(page));
 const text=JSON.stringify({format:'llmwiki-participation-sync/1',field:view.field,pages:[...pages,...old],received_at:result.received_at});
 if(o.alive()){const saved=await F().writeFile(o.work,view.path,text,view.before);need(saved.saved,'participation_stale');}
 result.complete=!result.pending&&!result.conflicts.length;
 const bundle=await peek(o.remote,'wiki/bundle.md');result.profile=bundle?{id:global.WikiCore.parseDocument(bundle.text).head.id??null,sha256:await R().hash(bundle.text)}:null;
}
global.WikiParticipationSync={selection,finish};
})(globalThis);
