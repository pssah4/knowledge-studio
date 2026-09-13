/* FEAT-04-06: disclose an exact contribution packet before its explicit release.
   The shared API owns preparation and validation; this dialog never transfers files. */
(function(global){
'use strict';
const I=()=>global.I18n,K=()=>global.WikiContributions,msg=(key,values)=>I().message(key,values);
function el(tag,className,value){const node=document.createElement(tag);if(className)node.className=className;if(value!==undefined)I().appendText(node,value);return node;}
function button(key,run){const node=el('button','',msg(key));node.type='button';node.addEventListener('click',run);return node;}
function ownModal(title){
 const origin=document.activeElement,dialog=el('dialog','ws-dialog ws-contribution-dialog');I().setAttribute(dialog,'aria-label',title);
 const header=el('header','ws-dialog-head'),content=el('div','ws-dialog-content'),foot=el('footer','ws-dialog-foot');header.append(el('h2','',title),button('Close',()=>dialog.close()));dialog.append(header,content,foot);document.body.append(dialog);
 dialog.addEventListener('close',()=>{dialog.remove();if(origin?.isConnected)origin.focus();},{once:true});dialog.showModal();return {dialog,content,foot};
}
function literal(parent,value,label){const text=typeof value==='string'?value:JSON.stringify(value,null,2);if(label)parent.append(el('h4','',label));const pre=el('pre','ws-contribution-text',text??'');Object.assign(pre.style,{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:'24rem',overflow:'auto'});parent.append(pre);return pre;}
function section(parent,key){const node=el('section','ws-contribution-section');node.append(el('h3','',msg(key)));parent.append(node);return node;}
function errorMessage(error){
 const keys={takeover_reason:"Explain why this document should be taken over.",contribution_record_missing:"Share this document with this target before changing its contribution lifecycle.",replica_missing:"This target has not received a copy of the document yet.",takeover_pending:"The announced objection period has not ended.",handover_pending:"Decide what happens to the other contribution targets before handing over this document.",retirement_changed:"The home and target statements differ. Review their changes before retiring the contribution.",handover_changed:"The home and target statements differ. Review their changes before handing over the document.",rekey_invalid:"Enter the new bundle identity and at least one reader.",takeover_missing:"Enter the ID of an existing takeover announcement.",lifecycle_review_stale:'The reviewed content changed. Review it again before confirming.',contribution_review_stale:'The reviewed content changed. Review it again before confirming.',contribution_stale:'The reviewed content changed. Review it again before confirming.',audience_changed:'The target reader circle changed. Check the connection before reviewing again.',bundle_id_changed:'The target bundle identity changed. Check the connection before reviewing again.'};
 return keys[error?.code]?msg(keys[error.code]):I().fromError(error);
}
async function open({options,page,folder,author,modal=ownModal,onConfirmed}){
 const d=modal(msg(folder?'Review folder contributions':'Review contribution'));d.dialog.classList.add('ws-contribution-dialog');
 const preview=el('div','ws-contribution-preview'),error=el('p','ws-property-error');error.setAttribute('role','alert');d.content.append(preview,error);
 const again=button('Review again',()=>prepare()),next=button('Review selected documents',()=>prepare()),confirm=button('Confirm this preview',()=>approve());confirm.className='ws-primary';again.hidden=true;next.hidden=true;confirm.disabled=true;d.foot.append(button('Cancel',()=>d.dialog.close()),again,next,confirm);
 let current=null,busy=false,generation=0,mode='propose',modeControl;const person=author??options.contributionMeta?.author,selected=new Set(),requiredPages=new Set(page?[page]:[]);
 if(folder){
  const row=el('label','ws-field',msg('New files in this folder'));modeControl=el('select');I().setAttribute(modeControl,'aria-label',msg('New files in this folder'));
  for(const [value,key]of [['propose','Suggest new files'],['automatic','Mark new files automatically']]){const option=el('option','',msg(key));option.value=value;modeControl.append(option);}row.append(modeControl);d.content.prepend(row);
  modeControl.addEventListener('change',()=>{mode=modeControl.value;prepare();});
 }
 function render(packet){
  preview.replaceChildren();const target=packet.target??options.contributionMeta?.target;
  const destination=section(preview,'Contribution target');destination.append(el('p','',target?.title??options.contributionMeta?.target?.title??target?.bundle_id),el('p','',target?.bundle_id));destination.append(el('p','',msg('Readers: {readers}',{readers:(target?.readers??[]).join(', ')})));
  preview.append(el('p','ws-muted',msg('Only the content shown here is approved. Later changes need another review.')));
  if(folder)preview.append(el('p','ws-muted',msg('Automatic marking still requires approval of each new preview.')));
  const packets=packet.files?packet.files.map(file=>file.review):[packet];
  if(folder)for(const file of packets)if(file.page.startsWith(folder.replace(/\/$/,'')+'/'))requiredPages.add(file.page);
  const sharedPages=new Set(packets.map(item=>item.page));for(const item of packets)renderDocument(item,sharedPages);
  if(packet.markings?.length){
   const markings=section(preview,'Files selected but not approved');
   for(const mark of packet.markings){const row=el('article','ws-contribution-marking');row.append(el('p','',mark.page+' → '+mark.destination),el('p','ws-muted',msg('This file is selected for this target, but its content is not approved or sent.')));literal(row,{[mark.field]:mark.before},msg('Current target selection'));literal(row,{[mark.field]:mark.after},msg('Requested target selection'));markings.append(row);}
  }
  if(packet.findings?.length){const findings=section(preview,'Files held back');for(const item of packet.findings){findings.append(el('p','',item.page));findings.append(el('p','ws-muted',errorMessage(Object.assign(new Error(item.reason),{code:item.reason}))));}}
  if(!packets.length)preview.append(el('p','ws-muted',msg('No documents are ready to share.')));
 }
 function renderDocument(packet,sharedPages){
  const body=el('article','ws-contribution-document');preview.append(body);
  const paths=section(body,'Document and destination');paths.append(el('p','',packet.page+' → '+packet.destination));
  const further=new Set((packet.links??[]).filter(link=>link.page&&!link.attachment&&!sharedPages.has(link.page)).map(link=>link.page));if(further.size)paths.append(el('p','ws-contribution-further',msg('More linked pages: {count}',{count:further.size})));
  literal(section(body,'Content to share'),packet.text);
  literal(section(body,'Replica notice'),packet.display??{});
  literal(section(body,'Journal entries to share'),packet.events??[]);
  if(packet.identity_changes?.length)literal(body,packet.identity_changes);
  const links=section(body,'Links in this content');links.append(el('p','ws-muted',msg('Unselected links remain in the shared text, including their labels and written paths.')));
  for(const link of packet.links??[]){
   const row=el('div','ws-contribution-link');
   if(link.page&&!link.attachment){const label=el('label','ws-check'),check=el('input');check.type='checkbox';check.checked=selected.has(link.page)||requiredPages.has(link.page);check.disabled=requiredPages.has(link.page);label.append(check,el('span','',link.written));row.append(label);check.addEventListener('change',()=>{if(check.checked)selected.add(link.page);else selected.delete(link.page);current=null;confirm.disabled=true;next.hidden=false;});}
   else literal(row,link.written);
   if(link.target)row.append(el('p','',link.target));links.append(row);
  }
  const assets=section(body,'Required attachments');for(const asset of packet.assets??[]){const row=el('label','ws-check'),check=el('input');check.type='checkbox';check.checked=true;check.disabled=true;row.append(check,el('span','',asset.path));assets.append(row);if(asset.text!==undefined)literal(assets,asset.text);else assets.append(el('p','ws-muted',msg('Binary attachment, {bytes} bytes',{bytes:asset.size??'?'})));}
  literal(section(body,'Source details and other properties'),packet.fields??{});
 }
 async function prepare(){
  if(busy)return;busy=true;const run=++generation;current=null;confirm.disabled=true;again.hidden=true;next.hidden=true;if(modeControl)modeControl.disabled=true;I().setText(error,'');I().setText(preview,msg('Preparing contribution preview…'));
  try{const pages=[...selected],packet=folder?await K().folder(options,{path:folder,mode,step:'review',pages,author:person}):await K().review(options,{...(pages.length?{pages:[page,...pages]}:{page}),author:person});if(run!==generation||!d.dialog.isConnected)return;current=packet;render(packet);confirm.disabled=Boolean(packet.files&&!packet.files.length);}
  catch(failure){if(d.dialog.isConnected){preview.replaceChildren();I().setText(error,errorMessage(failure));again.hidden=false;}}
  finally{busy=false;if(modeControl)modeControl.disabled=false;}
 }
 async function approve(){
  if(busy||!current)return;busy=true;confirm.disabled=true;again.hidden=true;I().setText(error,'');
  try{const args={id:current.id,digest:current.digest,author:person},result=folder?await K().folder(options,{...args,step:'confirm'}):await K().confirm(options,args);d.dialog.close();await onConfirmed?.(result);}
  catch(failure){if(d.dialog.isConnected){I().setText(error,errorMessage(failure));again.hidden=false;}}
  finally{busy=false;}
 }
 d.dialog.addEventListener('close',()=>{generation++;current=null;},{once:true});await prepare();return d;
}
async function status({options,page,container,onReview}){
 const value=await K().status(options,{page}),target=options.contributionMeta?.target??{};
 global.PropertyDetails.renderContributionStatus({container,status:{...value,target:{...target,bundle_id:typeof value.target==='string'?value.target:target.bundle_id}},onReview});return value;
}
async function lifecycle({options,action,page,author,args={},takeoverModes=null,modal=ownModal,onConfirmed}){
 const d=modal(msg('Review contribution lifecycle')),preview=el('div','ws-contribution-preview'),form=el('div'),error=el('p','ws-property-error');error.setAttribute('role','alert');d.content.append(form,preview,error);preview.tabIndex=-1;preview.setAttribute('role','region');I().setAttribute(preview,'aria-label',msg('Lifecycle decision'));
 const labels={retire:'Retire contribution',handover:'Hand over document',fork:'Fork target document',takeover:'Take over document',rekey:'Update bundle binding'},person=author??options.contributionMeta?.author,controls=[];
 let current=null,busy=false,generation=0,resuming=false;
 d.content.prepend(el('h3','',msg(labels[action]??action)));
 const prepareButton=button('Review this change',()=>prepare()),again=button('Review again',()=>prepare()),confirm=button('Confirm this preview',()=>approve());confirm.className='ws-primary';again.hidden=true;confirm.disabled=true;
 d.foot.append(button('Cancel',()=>d.dialog.close()),prepareButton,again,confirm);
 function invalidate(){if(busy||resuming)return;current=null;confirm.disabled=true;prepareButton.hidden=false;again.hidden=true;preview.replaceChildren();I().setText(error,'');}
 function input(key,value='',choices=null){const row=el('label','ws-field',msg(key)),node=el(choices?'select':'textarea');I().setAttribute(node,'aria-label',msg(key));
  if(choices)for(const [value,label]of choices){const option=el('option','',msg(label));option.value=value;node.append(option);}else node.rows=key==='New readers, one per line'?4:2;
  node.value=value;row.append(node);form.append(row);controls.push(node);node.addEventListener('input',invalidate);node.addEventListener('change',invalidate);return node;
 }
 let mode,reason,takeover,role,to,readers;
 if(action==='takeover'){
  mode=input('Takeover step',args.mode??'request',[['request','Announce takeover'],['object','Object to takeover'],['complete','Complete takeover after deadline'],['acknowledge','Acknowledge completed takeover'],['repair','Restore recorded objection']].filter(([value])=>!takeoverModes||takeoverModes.includes(value)));
  reason=input('Reason for takeover',args.reason??'');takeover=input('Takeover announcement ID',args.takeover??'');
  function fields(){reason.parentElement.hidden=mode.value!=='request';takeover.parentElement.hidden=mode.value==='request';}mode.addEventListener('change',fields);fields();
 }else if(action==='rekey'){
  role=input('Bundle to update',args.role??'target',[['target','Contribution target'],['owner','Home bundle']]);to=input('New bundle ID',args.to??'');readers=input('New readers, one per line',(args.readers??[]).join('\n'));
 }
 function render(packet){
  preview.replaceChildren();const fields=section(preview,'Lifecycle decision'),names={action:'Action',mode:'Takeover step',document:'Document ID',owner:'Home bundle',target:'Contribution target',page:'Home document',destination:'Target document',archive:'Archive destination',new_document:'New document ID',effective_at:'Objection deadline',takeover:'Takeover announcement ID',role:'Bundle to update',from:'Previous bundle ID',to:'New bundle ID',readers:'New reader circle',invalidated_releases:'Releases invalidated'};
  const list=el('dl');fields.append(list);
  for(const [key,label]of Object.entries(names)){if(packet[key]===undefined)continue;list.append(el('dt','',msg(label)),el('dd','',key==='action'?msg(labels[packet[key]]??packet[key]):key==='role'?msg(packet[key]==='owner'?'Home bundle':'Contribution target'):key==='mode'?msg({request:'Announce takeover',object:'Object to takeover',complete:'Complete takeover after deadline',acknowledge:'Acknowledge completed takeover',repair:'Restore recorded objection'}[packet[key]]):Array.isArray(packet[key])?packet[key].join(', '):String(packet[key])));}
  if(packet.warning)preview.append(el('p','ws-muted',msg(packet.warning)));
  preview.append(el('p','ws-muted',msg('Only the changes shown here are approved. Later changes need another review.')));
  const changes=section(preview,'Files changed by this decision');
  for(const change of packet.changes??[]){const item=el('article','ws-contribution-change'),location=change.side==='work'?options.work?.name:change.side==='remote'?options.remote?.name:change.side==='project'?options.project?.name:options.ownerRemote?.name;
   const heading=el('h4','',(location??change.side)+' / '+change.path);heading.style.textTransform='none';heading.style.letterSpacing='normal';item.append(heading);item.append(el('p','',msg(change.action==='archive'?'Archive file':change.action==='event'?'Record journal entry':change.action==='receipt'?'Record journal receipt':'Write file')));
   if(change.archive)item.append(el('p','',msg('Archive destination')+': '+change.archive));if(change.text!==undefined)literal(item,change.text);changes.append(item);
  }
 }
 async function prepare(){
  if(busy||resuming)return;busy=true;const run=++generation;current=null;confirm.disabled=true;again.hidden=true;prepareButton.disabled=true;for(const input of controls)input.disabled=true;I().setText(error,'');I().setText(preview,msg('Preparing contribution preview…'));
  try{const values={...args,page,author:person,step:'review',...(mode?{mode:mode.value,...(mode.value==='request'?{reason:reason.value}:{takeover:takeover.value.trim()})}:{}),...(role?{role:role.value,to:to.value.trim(),readers:readers.value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean)}:{})};
   const packet=await global.WikiContributionLifecycle[action](options,values);if(run!==generation||!d.dialog.isConnected)return;current=packet;render(packet);confirm.disabled=false;prepareButton.hidden=true;preview.style.scrollMarginTop=((d.dialog.querySelector('.ws-dialog-head')?.getBoundingClientRect().height??0)+16)+'px';preview.scrollIntoView({block:'start'});preview.focus({preventScroll:true});
  }catch(failure){if(d.dialog.isConnected){preview.replaceChildren();I().setText(error,errorMessage(failure));again.hidden=false;}}
  finally{busy=false;prepareButton.disabled=false;for(const input of controls)input.disabled=false;}
 }
 async function approve(){
  if(busy||!current)return;busy=true;confirm.disabled=true;again.hidden=true;for(const input of controls)input.disabled=true;I().setText(error,'');
  try{const result=await global.WikiContributionLifecycle[action](options,{step:'confirm',id:current.id,digest:current.digest,author:person});
   if(!result.complete){resuming=true;literal(preview,result.requires_host_move??result, msg('Remaining file operation'));I().setText(error,msg('This decision is not complete. Finish the displayed file move, then continue the same confirmed decision.'));I().setText(confirm,msg('Continue confirmed change'));confirm.disabled=false;return;}
   d.dialog.close();await onConfirmed?.(result);
  }catch(failure){if(d.dialog.isConnected){I().setText(error,errorMessage(failure));if(resuming)confirm.disabled=false;else{current=null;again.hidden=false;}}}
  finally{busy=false;for(const input of controls)input.disabled=resuming;}
 }
 d.dialog.addEventListener('close',()=>{generation++;current=null;},{once:true});
 if(action!=='takeover'&&action!=='rekey')await prepare();return d;
}
global.ContributionUI={open,status,lifecycle};
})(globalThis);
