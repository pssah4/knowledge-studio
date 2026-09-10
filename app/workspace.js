/* Obsidian-style workspace around the existing Markdown and guarded-write core.
   Project configuration travels on disk; handles and drafts stay on this device. */
(function (global) {
"use strict";
const msg=(key,values)=>global.I18n.message(key,values);
function tree(paths) {
  const root = [];
  for (const path of paths) {
    let children = root;
    const directory=path.endsWith("/");
    const parts = path.split("/").filter(Boolean);
    parts.forEach((name, i) => {
      let node = children.find(n => n.name === name);
      if (!node) { node = {name, path: parts.slice(0, i + 1).join("/"), children: i < parts.length - 1 || directory ? [] : null}; children.push(node); }
      if(i<parts.length-1&&!node.children)node.children=[];
      children = node.children;
    });
  }
  function sort(nodes) { nodes.sort((a,b) => Number(!a.children) - Number(!b.children) || a.name.localeCompare(b.name, "de")); nodes.forEach(n => { if(n.children) sort(n.children); }); }
  sort(root); return root;
}
function searchText(path, text, query) {
  const terms = query.toLocaleLowerCase("de").trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return null;
  const combined = (path + "\n" + text).toLocaleLowerCase("de");
  if (!terms.every(t => combined.includes(t))) return null;
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex(line => terms.some(t => line.toLocaleLowerCase("de").includes(t)));
  return {path, line: i + 1, excerpt: i >= 0 ? lines[i].slice(0, 220) : path};
}
function targetPath(from, target) {
  target = target.split("|")[0].split("#")[0];
  try { target = decodeURIComponent(target); } catch (_) { return null; }
  if (!target || /[\\:\x00]/.test(target) || target.startsWith("/")) return null;
  const parts = target.startsWith(".") ? from.split("/").slice(0, -1) : [];
  for (const part of target.split("/")) {
    if (part === "..") { if (!parts.length) return null; parts.pop(); }
    else if (part && part !== ".") parts.push(part);
  }
  if (!parts.length) return null;
  const path = parts.join("/");
  return /\.[a-z0-9]+$/i.test(path) ? path : path + ".md";
}
function changedLines(before,after){
  const a=before.split(/\r?\n/),b=after.split(/\r?\n/);
  const changed=new Set(b.map((_,i)=>i));
  // The comparison core is already used for guarded saves. Bound very large
  // displays; the modal keeps all text visible even when highlighting is broad.
  if(a.length*b.length<=4000000)for(const [,start,size] of global.matchingBlocks(a,b))for(let i=0;i<size;i++)changed.delete(start+i);
  return Array.from(changed);
}
function canWrite(folder, permission) { return Boolean(folder && folder.writable && permission); }
const F = () => global.FolderAccess;
const P = () => global.ProjectSettings;
const state = {root:null, data:null, seen:null, instance:null, pendingDetached:[], handles:new Map(), files:new Map(), connection:null, tabs:[], active:null, sheet:null, mode:"live", searchRun:0, draftWrites:Promise.resolve(), settingsDirty:false, backlinkRun:0, backlinkTimer:null, graphOpen:false, graphHidden:new Set(), graphView:null, graphRun:0, sourceView:null, reviewBusy:false, reviewRun:0, inbox:[], reviewTimer:null};
const iconAliases={book:"book-open",close:"x",link:"link",live:"square-pen",source:"code-xml",read:"book-open-check"};
const editorDesign=(()=>{try{return JSON.parse(global.document?.getElementById('llmwiki-editor-design')?.textContent||'{}');}catch(_){return {};}})();
const appearanceKey="llmwiki.ui.appearance"+(editorDesign.id?'/'+editorDesign.id:'');
const accents={neutral:null,violet:["#7054ad","#b8a1ef"],blue:["#3267b1","#8ab4ed"],green:["#44734a","#99c99d"],orange:["#a35e25","#e1b183"]};
function loadAppearance(){try{const v=JSON.parse(global.localStorage.getItem(appearanceKey)||"{}");return {accent:!editorDesign.fixedAccent&&Object.hasOwn(accents,v.accent)?v.accent:"neutral",edgeTooltips:v.edgeTooltips!==false};}catch(_){return {accent:"neutral",edgeTooltips:true};}}
const appearance=loadAppearance();
function applyAppearance(){
  const body=global.document.body,colors=accents[appearance.accent];body.dataset.accent=appearance.accent;
  for(const [key,value] of [["--ws-chosen-accent",colors&&colors[0]],["--ws-chosen-accent-dark",colors&&colors[1]]]){if(value)body.style.setProperty(key,value);else body.style.removeProperty(key);}
  if(state.graphView)state.graphView.setTooltips(appearance.edgeTooltips);
}
function saveAppearance(){applyAppearance();try{global.localStorage.setItem(appearanceKey,JSON.stringify(appearance));}catch(_){status(msg("Appearance is applied for this session only."));}}
function appearanceSettings(parent){
  parent.append(el("h3","",msg("Appearance")));
  if(editorDesign.fixedAccent)parent.append(el("p","ws-muted",editorDesign.label));else{
  const accent=select(parent,msg("Accent color"),[["neutral",msg("Neutral (default)")],["violet",msg("Violet")],["blue",msg("Blue")],["green",msg("Green")],["orange",msg("Orange")]],appearance.accent);
  accent.addEventListener("change",()=>{appearance.accent=accent.value;saveAppearance();});
  }
  const row=el("label","ws-check"),check=el("input");check.type="checkbox";check.checked=appearance.edgeTooltips;check.id="ws-edge-tooltips";row.append(check);global.I18n.appendText(row,msg("Show edge descriptions on hover"));parent.append(row);
  check.addEventListener("change",()=>{appearance.edgeTooltips=check.checked;saveAppearance();});
  const properties=select(parent,msg('Document properties'),[['visible',msg('Visible')],['hidden',msg('Hidden')]],global.localStorage.getItem('llmwiki.properties.visibility')||'visible');properties.addEventListener('change',()=>{global.localStorage.setItem('llmwiki.properties.visibility',properties.value);renderProperties();});
  parent.append(el("p","ws-muted",msg("Appearance is saved on this device and applied immediately.")));
}

// The project supplies an initial choice. Each person's override stays on this
// browser, keyed by project, and must never rewrite another person's preference.
function editorMode(data, personal){
  const valid=value=>["builtin","obsidian","both"].includes(value);
  return valid(personal)?personal:data&&valid(data.editor)?data.editor:"builtin";
}
function browserProjectKey(){return (state.data?state.data.id:"welcome")+(state.instance?"/instance/"+state.instance:"");}
function editorKey(){return "llmwiki.ui.editor/"+browserProjectKey();}
function currentEditor(){let saved=null;try{saved=global.localStorage.getItem(editorKey());}catch(_){}return editorMode(state.data,saved);}
function applyEditor(){
  const root=at("workspace-app");if(!root)return;
  const mode=currentEditor();root.classList.toggle("ws-obsidian",mode==="obsidian");root.dataset.editor=mode;
  const home=at("ws-settings-home");if(home){home.hidden=mode!=="obsidian";drawSettingsHome();}
}
function editorSettings(parent,first=false){
  parent.append(el("h3","",msg("Editor")));
  const choice=select(parent,msg("Where do you want to write?"),[["builtin",msg("Built-in editor")],["obsidian",msg("Obsidian")],["both",msg("Both in parallel")]],currentEditor());choice.id="ws-editor-choice";
  parent.append(el("p","ws-muted",msg("Your choice applies to this project on this device. You can change it at any time. Both editors use the connected files.")));
  if(first)parent.append(el("p","ws-muted",msg("Choose your editor, then connect the folders already released in your agent application.")));
  choice.addEventListener("change",async()=>{
    collect();await state.draftWrites;
    try{global.localStorage.setItem(editorKey(),choice.value);}catch(_){throw global.I18n.error(msg("The editor choice could not be saved on this device."));}
    applyEditor();
  });
}
function drawSettingsHome(){
  const home=at("ws-settings-home");if(!home)return;
  home.replaceChildren();home.append(icon("settings"),el("h1","",msg("Settings")),el("p","",msg("Write in Obsidian. Manage your folders and review changes here.")));
  if(state.data){
    home.append(el("h2","",state.data.label));
    const choices=select(home,msg("Active connection"),state.data.connections.map(c=>[c.id,c.label]),state.connection);choices.id="ws-settings-connection";
    choices.addEventListener("change",async()=>{await preserveDrafts();state.connection=choices.value;await persistActive();state.active=null;state.tabs=[];renderEmpty();renderHeader();await refresh();drawSettingsHome();});
    const c=selectedConnection();
    if(c){
      const list=el("dl","ws-settings-folders");
      for(const id of [...c.works,...c.sources]){const f=state.data.folders.find(f=>f.id===id);if(!f)continue;list.append(el("dt","",{work:msg("Working folder"),wiki:msg("LLM wiki"),source:msg("Sources & originals")}[f.kind]));const value=el("dd","",(f.kind==="work"?state.data.folders.find(w=>w.id===c.wiki).label:f.label)+" · "+(f.path===null?msg("Connected externally. Bind separately on each device."):f.path));if(!state.handles.has(id))value.append(button(msg("Connect folder"),()=>reconnect(id)));list.append(value);}
      home.append(list,el("p","ws-muted",msg("For shared work, open your working folder as an Obsidian vault. The skill receives changes from the wiki and submits your work. Settings do not start synchronization.")));
    }
  }
  const actions=el("div","ws-actions");actions.append(button(msg("Folders and settings"),()=>settings(false)));
  if(state.root)actions.append(button(msg("Review changes"),reviewFiles),button(msg("Change inbox"),reviewInbox));else actions.append(button(msg("Open project folder"),chooseProject));
  home.append(actions,el("p","ws-muted",msg("Review records belong to the connected folder. The skill's working-copy synchronization does not yet carry these conversations. Changes saved only in Obsidian may have an unknown author.")));
  const output=el("p","ws-muted");output.id="ws-settings-status";output.setAttribute("role","status");output.setAttribute("aria-live","polite");home.append(output);
}
async function reviewFiles(){
  if(!state.root)return settings(false);
  await synchronizeWikis();await refresh();const d=modal(msg("Review changes"));
  d.content.append(el("p","ws-muted",msg("Choose a file to compare saved versions and respond. This does not switch on the editor or run working-copy synchronization.")));
  const input=field(d.content,msg("Filter files"),"","search"),list=el("div","ws-review-files");d.content.append(list);
  function draw(){list.replaceChildren();let count=0;for(const id of selectedIds()){
    const folder=state.data.folders.find(f=>f.id===id);if(!folder||folder.kind!=="work")continue;
    for(const f of state.files.get(id)||[]){if(!/\.md$/i.test(f.name)||!(folder.label+"/"+f.name).toLocaleLowerCase().includes(input.value.toLocaleLowerCase()))continue;
      list.append(button((state.data.folders.find(w=>state.data.connections.some(c=>c.wiki===w.id&&c.works.includes(id)))?.label||folder.label)+" / "+f.name,async()=>{d.dialog.close();await openFile(id,f.name);await compare();}));count++;
    }
  }if(!count)list.append(el("p","ws-muted",msg("No matching files.")));}
  input.addEventListener("input",draw);draw();
}

function el(tag, cls, text) { const n=global.document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)global.I18n.appendText(n,text); return n; }
function at(id) { return global.document.getElementById(id); }
function icon(name) { const n=el("span","ws-icon"); n.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(global.WorkspaceIcons[iconAliases[name]||name]||global.WorkspaceIcons["file-text"])+'</svg>'; return n; }
function button(text, action, symbol, cls) { const n=el("button",cls||"",symbol?undefined:text); n.type="button"; if(symbol) {n.append(icon(symbol));global.I18n.setAttribute(n,"title",text);global.I18n.setAttribute(n,"aria-label",text);} n.addEventListener("click",()=>Promise.resolve().then(action).catch(report));return n; }
function report(error) {const text=global.I18n.fromError(error);status(text);const dialog=global.document.querySelector('dialog[open]');if(dialog){let output=dialog.querySelector('.ws-action-error');if(!output){output=el('p','ws-action-error ws-muted');output.setAttribute('role','alert');dialog.append(output);}global.I18n.setText(output,text);}}
function status(text) { for(const id of ["ws-status","ws-settings-status"]){const n=at(id);if(n){global.I18n.setText(n,text);if(handleCacheFailed){global.I18n.appendText(n,msg(" Browser access could not be remembered. Selected folders remain usable in this window; allow access again after reopening."));}}} }
function sharedOriginal(data,id){return data.connections.some(c=>c.wiki===id&&c.mode==="gemeinsam");}
function currentFolder() {const f=state.active&&state.data.folders.find(f=>f.id===state.active.folder);return f&&(state.active.viewer||sharedOriginal(state.data,f.id))?{...f,writable:false}:f;}
function workKey(wiki){return "llmwiki.ui.work/"+JSON.stringify([browserProjectKey(),wiki]);}
function workIds(wiki){return Array.from(new Set(state.data.connections.filter(c=>c.wiki===wiki).flatMap(c=>c.works)));}
function workingFolder(wiki){
  const ids=workIds(wiki);let chosen=null;try{chosen=global.localStorage.getItem(workKey(wiki));}catch(_){}
  return ids.includes(chosen)?chosen:ids.length===1?ids[0]:null;
}
// A logical wiki retains the physical folder identity for drafts and saves.
function wikiEntries(wiki){
  const entries=new Map();
  const work=workingFolder(wiki);
  for(const f of state.files.get(work)||[])entries.set(f.name,{...f,folder:work});
  return Array.from(entries.values());
}
function visibleEntries(){if(!state.data)return [];return state.data.folders.filter(f=>f.kind!=="work").flatMap(f=>(f.kind==="wiki"?wikiEntries(f.id):(state.files.get(f.id)||[]).map(e=>({...e,folder:f.id}))).map(e=>({...e,view:f.id})));}
async function openWikiFile(wiki,name){await refreshProject();if(!state.root)return requestProjectAccess(()=>openWikiFile(wiki,name));const c=state.data?.connections.find(c=>c.wiki===wiki);if(!c)throw global.I18n.error(msg('The folder was disconnected.'));state.connection=c.id;await persistActive();let folder=workingFolder(wiki);if(!folder){await connectWiki(wiki);folder=workingFolder(wiki);if(!folder)return;}const handle=state.handles.get(folder);if(handle&&await F().permissionState(handle,'read')!=='granted'){await reconnect(folder);if(await F().permissionState(state.handles.get(folder),'read')!=='granted')return;}await openFile(folder,name,wiki);}
function selectedConnection() {return state.data && state.data.connections.find(c=>c.id===state.connection);}
function selectedIds() {return state.data?state.data.folders.map(f=>f.id):[];}
function draftKey(tab) {return "workspace/"+[browserProjectKey(),tab.folder,String(tab.folderPath)].map(encodeURIComponent).join("/");}
function recoveredDraftKey(folder){return 'workspace-recovered/'+[browserProjectKey(),folder.id,String(folder.path)].map(encodeURIComponent).join('/');}
function collect() {
  if(!state.active||state.active.viewer||!state.sheet||state.mode==="read")return;
  if(state.mode==="source"&&at("ws-source").value===state.active.text.replace(/\r\n?/g,"\n"))return;
  state.active.text=state.mode==="source"?at("ws-source").value:(state.editorPrefix||'')+state.sheet.value;
}
// An awaited queue may have reported an IndexedDB error. Before removing the
// only in-memory copy, write every dirty tab again and require confirmation.
async function preserveDrafts(tabs=state.tabs){
  collect();await state.draftWrites;
  for(const tab of tabs)if(!tab.viewer&&tab.text!==tab.origin){
    try{
      const key=draftKey(tab);if(await F().keepDraft(key,tab.name,tab.text,tab.origin)===false)throw new Error('Draft storage unavailable');
      const stored=await F().recallDraft(key,tab.name);if(stored?.text!==tab.text||stored.origin!==tab.origin)throw new Error('Draft readback failed');
    }
    catch(_){throw global.I18n.error(msg('The unsaved draft could not be preserved. The file stays open. Save or copy your text before disconnecting or switching projects.'));}
  }
}
function changed(text,historyAction) {
  if(!state.active||state.active.viewer)return;
  const tab=state.active;
  if(state.mode==='live'&&historyAction&&tab.relationshipHistory){const parsed=global.WikiCore.parseDocument(tab.text),step=[...tab.relationshipHistory].reverse().find(r=>historyAction==='undo'?r.after===parsed.body&&r.before===text:r.before===parsed.body&&r.after===text);if(step){const patched=global.WikiCore.patchHead(tab.text,{related:historyAction==='undo'?step.relatedBefore:step.relatedAfter});state.editorPrefix=patched.slice(0,global.WikiCore.parseDocument(patched).offset);}}

  if(state.mode==='source'&&!state.historyReplay&&text!==tab.text){(tab.sourceUndo||=[]).push(tab.text);if(tab.sourceUndo.length>100)tab.sourceUndo.shift();tab.sourceRedo=[];}
  tab.text=(state.mode==='live'?(state.editorPrefix||''):'')+text;
  renderTabs();renderOutline(false);drawCompletions();if(state.mode==='live')requestAnimationFrame(renderLiveAssets);
  const key=draftKey(tab), name=tab.name, origin=tab.origin, savedText=tab.text;
  state.draftWrites=state.draftWrites.catch(()=>{}).then(()=>F().keepDraft(key,name,savedText,origin)).catch(report);
  status(msg("Saving…"));scheduleAutosave(tab);
}
function scheduleAutosave(tab){
 global.clearTimeout(tab.autosaveTimer);tab.autosaveTimer=global.setTimeout(async()=>{
  if(tab.text===tab.origin||tab.viewer||tab.root!==state.root)return;
  if(state.reviewBusy){scheduleAutosave(tab);return;}
  try{await saveActive({automatic:true,target:tab});}catch(error){status(msg('Automatic saving paused: {reason}',{reason:global.I18n.fromError(error)}));}
 },800);
}
function modal(title) {
  const d=el("dialog","ws-dialog");global.I18n.setAttribute(d,"aria-label",title);
  const header=el("header","ws-dialog-head"); header.append(el("h2","",title),button(msg("Close"),()=>d.close(),"close"));
  const content=el("div","ws-dialog-content"); const foot=el("footer","ws-dialog-foot");
  d.append(header,content,foot);global.document.body.append(d);
  d.addEventListener("close",()=>d.remove());d.showModal();return {dialog:d,content,foot};
}
function field(parent,label,value,kind) {
  const row=el("label","ws-field",label);const input=el(kind==="textarea"?"textarea":"input");if(kind&&kind!=="textarea")input.type=kind;input.value=value||"";row.append(input);parent.append(row);return input;
}
let passageRun=0;
function scrollSourceSelection(source,start){
 const style=global.getComputedStyle(source),mirror=el('div'),marker=el('span','',source.value.slice(start,start+1)||' ');
 for(const key of ['font','lineHeight','letterSpacing','padding','border','boxSizing','tabSize','wordBreak'])mirror.style[key]=style[key];
 Object.assign(mirror.style,{position:'fixed',visibility:'hidden',width:source.clientWidth+'px',whiteSpace:'pre-wrap',overflowWrap:'break-word',top:'0',left:'0'});
 mirror.append(global.document.createTextNode(source.value.slice(0,start)),marker);global.document.body.append(mirror);
 const top=marker.offsetTop;mirror.remove();source.scrollTop=Math.max(0,top-source.clientHeight/3);
 source.scrollIntoView({block:'nearest'});
}
async function highlightEvidence(result,folder,valid=()=>true){
 await openFile(folder,result.page,result.wiki);if(!valid())return;collect();
 if(!state.active||state.active.folder!==folder||state.active.name!==result.page||state.active.text!==state.active.origin||await global.WikiReviews.hash(state.active.text)!==result.current_revision)throw global.I18n.error(msg('The document or an unsaved draft changed. Open the quote again after reviewing your changes.'));
 const seen=await F().readFile(state.handles.get(folder),result.page);if(await global.WikiReviews.hash(seen.text)!==result.current_revision)throw global.I18n.error(msg('The document changed. Open the quote again.'));
 if(!valid())return;setMode('source',false);const source=at('ws-source'),domOffset=offset=>state.active.text.slice(0,offset).replace(/\r\n?/g,'\n').length,start=domOffset(result.current.start),end=domOffset(result.current.end);source.focus();source.setSelectionRange(start,end);scrollSourceSelection(source,start);
}
async function openPassage(token){
 const run=++passageRun,p=global.WikiCore.decodePassage(token);
 if(!state.root||!state.data)return requestProjectAccess(()=>openPassage(token));
 if(state.data.id!==p.project||state.instance!==p.instance)throw global.I18n.error(msg('This passage belongs to another project instance.'));
 const connection=state.data.connections.find(c=>c.id===p.connection&&c.wiki===p.wiki&&c.works.includes(p.work));
 if(!connection)throw global.I18n.error(msg('The cited working copy is not connected and accessible.'));
 const dir=state.handles.get(p.work);
 if(!dir||await F().permissionState(dir,'read')!=='granted'){
  const d=modal(msg('Allow access to the cited folder'));d.content.append(el('p','',state.data.folders.find(f=>f.id===p.work)?.label||p.work));d.foot.append(button(msg('Allow access'),async()=>{d.dialog.close();if(await reconnect(p.work))return openPassage(token);}));return;
 }
 const result=await global.WikiCore.resolvePassage([{id:p.wiki,connection:p.connection,work:p.work,store:global.WikiCore.browserStore(dir,F(),global.WikiReviews)}],token,{project:state.data.id,instance:state.instance});
 if(run!==passageRun)return;
 if(!result.current){const d=modal(msg('The cited passage is no longer uniquely available.'));d.content.append(el('p','',p.page),el('p','ws-muted',msg('This link identifies an earlier revision. Its text was not retained as a quote.')));return result;}
 await highlightEvidence(result,p.work,()=>run===passageRun&&state.instance===p.instance&&state.data?.id===p.project);if(run!==passageRun)return;status(msg(result.state==='current'?'Source passage: {page}':'Unchanged passage in a newer revision: {page}',{page:result.page}));return result;
}
function openEvidenceFragment(){const hash=global.location.hash;if(hash.startsWith('#passage='))return openPassage(hash.slice(9));const match=/^#shadow=([a-f0-9]{64})$/.exec(hash);if(match)return openQuote(match[1]);}
async function openQuote(id){
 if(!id){const d=modal(msg('Open retained quote')),input=field(d.content,msg('Quote link or identifier'),'');d.foot.append(button(msg('Show quote'),()=>{const value=input.value.trim(),passage=/#passage=([A-Za-z0-9_-]+)$/.exec(value),match=/#shadow=([a-f0-9]{64})$/.exec(value);d.dialog.close();return passage?openPassage(passage[1]):openQuote(match?match[1]:value);}));return;}
 if(!state.root||!state.data)throw global.I18n.error(msg('Connect your project before opening a quote.'));
 const wikis=[];
 for(const wiki of new Set(state.data.connections.map(c=>c.wiki))){const folder=workingFolder(wiki),dir=state.handles.get(folder);if(!dir||await F().permissionState(dir,'read')!=='granted')continue;wikis.push({id:wiki,store:global.WikiCore.browserStore(dir,F(),global.WikiReviews)});}
 const result=await global.WikiCore.resolveQuote(wikis,id),d=modal(msg(result.state==='current'?'Current version':'Earlier version'));
 d.content.append(el('p','ws-muted',result.page),el('pre','ws-shadow-quote',result.quote));
 if(!result.current)d.content.append(el('p','ws-muted',msg('No unique current passage is available. This quote retains its earlier wording.')));
 else d.foot.append(button(msg('Highlight passage'),async()=>{
  d.dialog.close();await highlightEvidence(result,workingFolder(result.wiki));
 }));
 return result;
}
function select(parent,label,values,current,multiple) {
  const row=el("label","ws-field",label), n=el("select");n.multiple=Boolean(multiple);global.I18n.setAttribute(n,"aria-label",label);
  for(const [value,text]of values){const o=el("option","",text);o.value=value;o.selected=multiple?(current||[]).includes(value):value===current;n.append(o);}
  row.append(n);parent.append(row);return n;
}
function values(n){return n.selectedValues?n.selectedValues():Array.from(n.selectedOptions).map(o=>o.value);}
function folderDropdown(parent,label,options,current,onChange,kind){
  const wrapper=el("div","ws-folder-dropdown"),caption=el("span","ws-picker-label",label);
  const menu=el("details","ws-multi-select");menu.dataset.picker=kind;
  const summary=el("summary"),selectedText=el("span"),list=el("div","ws-picker-options");
  global.I18n.setAttribute(summary,"aria-label",label);summary.append(selectedText,icon("chevron-down"));
  const selected=new Set(current.filter(id=>options.some(([key])=>key===id)));
  function draw(){
    const labels=options.filter(([id])=>selected.has(id)).map(([,text])=>text);
    selectedText.textContent=labels.length?labels.join(", "):"";
    if(!labels.length)global.I18n.setText(selectedText,msg("Choose folders"));
    summary.title=labels.join(", ");summary.setAttribute("aria-expanded",String(menu.open));
  }
  for(const [id,text]of options){const row=el("label","ws-picker-option"),input=el("input");input.type="checkbox";input.checked=selected.has(id);row.append(input,el("span","",text));list.append(row);input.addEventListener("change",()=>{if(input.checked)selected.add(id);else selected.delete(id);draw();onChange();});}
  if(!options.length)list.append(el("p","ws-muted",msg("Add a folder first.")));
  menu.append(summary,list);wrapper.append(caption,menu);parent.append(wrapper);
  menu.addEventListener("toggle",()=>summary.setAttribute("aria-expanded",String(menu.open)));
  menu.addEventListener("keydown",event=>{if(event.key==="Escape"){event.stopPropagation();menu.open=false;summary.focus();}});
  menu.addEventListener("focusout",event=>{if(event.relatedTarget&&!menu.contains(event.relatedTarget))menu.open=false;});
  draw();return {selectedValues:()=>Array.from(selected)};
}
// A starter restores its own project. A generic app may still open any project.
function entryBinding(){
  const meta=global.document.querySelector('meta[name="llmwiki-entry-project"]');
  const instance=global.document.querySelector('meta[name="llmwiki-entry-instance"]')?.content||null;
  const key="workspace-entry/"+encodeURIComponent(global.location.pathname)+(instance?'/instance/'+encodeURIComponent(instance):'');
  let saved=null;try{saved=global.localStorage.getItem(key+"/id");}catch(_){}
  return {key,entry:Boolean(meta),id:meta?(meta.content||saved||null):null,instance};
}
function entryLocation(){
  try{const value=JSON.parse(at('llmwiki-entry-location')?.textContent||'null');if(!value||typeof value!=='object')return null;
    return {project_root:typeof value.project_root==='string'?value.project_root:null,entry_uri:typeof value.entry_uri==='string'&&/^file:\/\//i.test(value.entry_uri)?value.entry_uri:null};
  }catch(_){return null;}
}
function projectAccessHint(parent){
  if(global.EditorHost){parent.append(el('p','','Bestätige den Zugriff auf die gespeicherten Ordner. Eine erneute Auswahl ist nicht nötig.'));return;}
  const location=entryLocation();
  parent.append(el('p','',msg('Choose the project folder containing llmwiki.project.json. Your wiki and sources stay connected through that project.')));
  if(location?.project_root)accessPathHelp(parent,location.project_root);
  if(location?.entry_uri&&location.entry_uri!==global.location.href){const link=el('a','ws-primary',msg('Open editor in project'));link.href=location.entry_uri;parent.append(link);}
}
function projectRootKey(id){return "workspace-project/"+encodeURIComponent(id)+(state.instance?'/instance/'+encodeURIComponent(state.instance):'');}
// A denied/blocked IndexedDB cache must not undo a successful native selection.
const liveHandles=new Map(),folderErrors=new Map();let handleCacheFailed=false;
async function handleCache(operation){
  let timer;
  try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Folder cache unavailable')),2000);})]);}
  finally{clearTimeout(timer);}
}
async function rememberHandle(key,handle){
  liveHandles.set(key,handle);
  if(handle?.hostHandle){if(key.startsWith("project/"))await global.EditorHost.bind(decodeURIComponent(key.split("/").at(-1)),handle);return;}
  if(handleCacheFailed)return;
  try{if(await handleCache(()=>F().rememberFolder(key,handle))===false)handleCacheFailed=true;}
  catch(_){handleCacheFailed=true;}
}
async function recallHandle(key){
  if(liveHandles.has(key))return liveHandles.get(key);
  if(handleCacheFailed)return null;
  try{return await handleCache(()=>F().recallFolder(key));}
  catch(_){handleCacheFailed=true;return null;}
}
function folderBindingKey(id){return P().bindingKey(browserProjectKey(),id);}
function expectedBindingName(f){try{return f.path===null?JSON.parse(at('llmwiki-entry-binding-names')?.textContent||'{}')[f.id]:null;}catch(_){return null;}}
async function folderHandle(f){if(global.EditorHost)return global.EditorHost.folder(f.id);const h=await P().resolve(state.root,f,browserProjectKey(),recallHandle),name=expectedBindingName(f);if(h&&name&&h.name.normalize('NFC')!==name.normalize('NFC')){folderErrors.set(f.id,global.I18n.error(msg('Expected folder: {name}',{name})));return null;}return h;}
function entrySettings(){
  const node=at('llmwiki-entry-settings');if(!node)return null;
  let data=P().validate(JSON.parse(node.textContent));checkProject({data});
  try{const saved=JSON.parse(global.localStorage.getItem(entryBinding().key+'/view'));
    if(saved&&saved.seed===node.textContent){const cached=P().validate(saved.data);checkProject({data:cached});data=cached;}
  }catch(_){/* optional display cache; disk settings remain authoritative */}
  return data;
}
function rememberView(){
  if(!state.root||!state.data)return;
  const node=at('llmwiki-entry-settings');if(!node)return;
  try{global.localStorage.setItem(entryBinding().key+'/view',JSON.stringify({seed:node.textContent,data:state.data}));}catch(_){}
}
function inventoryKey(f){return entryBinding().key+'/inventory/'+encodeURIComponent(JSON.stringify([f.id,f.kind,f.path]));}
function rememberInventory(id,entries){const f=state.data.folders.find(f=>f.id===id);try{global.localStorage.setItem(inventoryKey(f),JSON.stringify({seed:at('llmwiki-entry-inventory')?.dataset.revision??null,entries:entries.map(e=>({name:e.name,size:e.size,kind:e.kind}))}));}catch(_){}}
function restoreInventory(){if(!state.data)return;let seed={};try{seed=JSON.parse(at('llmwiki-entry-inventory')?.textContent||'{}');}catch(_){}
 for(const f of state.data.folders)try{const cached=JSON.parse(global.localStorage.getItem(inventoryKey(f))||'null'),entries=cached?.seed===(at('llmwiki-entry-inventory')?.dataset.revision??null)?cached.entries:seed[f.id];if(Array.isArray(entries)&&entries.every(e=>typeof e.name==='string'&&!e.name.split('/').some(p=>p==='..'||p.startsWith('.'))))state.files.set(f.id,entries);}catch(_){}
}
async function restoreActive(){if(!state.root)return;try{const seen=await F().peek(state.root,'.llmwiki/workspace-state.json'),data=seen?JSON.parse(seen.text):null,c=state.data.connections.find(c=>c.id===data?.connection);if(data?.format==='llmwiki-workspace-state/1'&&data.project===state.data.id&&data.instance===state.instance&&c?.works.includes(data.work)){state.connection=c.id;global.localStorage.setItem(workKey(c.wiki),data.work);}}catch(_){}
}
async function persistActive(){if(!state.root||await F().permissionState(state.root,'readwrite')!=='granted')return;const c=selectedConnection(),work=c&&workingFolder(c.wiki);if(!work)return;const page='.llmwiki/workspace-state.json',seen=await F().peek(state.root,page);const done=await F().writeFile(state.root,page,JSON.stringify({format:'llmwiki-workspace-state/1',project:state.data.id,instance:state.instance,connection:c.id,work}),seen);if(!done.saved)throw new Error('Active wiki could not be saved.');}
function checkProject(loaded){
  const expected=entryBinding().id;
  if(expected&&(!loaded.data||loaded.data.id!==expected))throw global.I18n.error(msg("This folder does not belong to this start file. Select its project folder."));
}
async function checkProjectInstance(root,loaded){
 try{
  if(root===state.root&&state.projectBlocked)throw global.I18n.error(msg('This start file belongs to an earlier setup. Open the current LLM-Wiki.html in your project folder.'));
  checkProject(loaded);
  const seen=await F().peek(root,'.llmwiki/project-instance.json'),expected=entryBinding().instance||(root===state.root?state.instance:null);
  if(!seen){if(expected)throw global.I18n.error(msg('This start file belongs to an earlier setup. Open the current LLM-Wiki.html in your project folder.'));return null;}
  const marker=JSON.parse(seen.text);
  if(marker.format!=='llmwiki-project-instance/1'||marker.project!==loaded.data.id||typeof marker.instance!=='string'||!marker.instance)throw global.I18n.error(msg('The project identity cannot be verified. Open the current LLM-Wiki.html in your project folder.'));
  if(expected&&marker.instance!==expected)throw global.I18n.error(msg('This start file belongs to an earlier setup. Open the current LLM-Wiki.html in your project folder.'));
  return marker.instance;
 }catch(error){if(root===state.root){state.projectBlocked=true;syncEpoch++;}throw error;}
}
async function legacyBrowserPermission(root,loaded){
  const seen=await F().peek(root,'.llmwiki/project-instance.json');if(!seen?.text||!loaded.data||!loaded.seen?.text)return null;
  const marker=JSON.parse(seen.text),permission=marker.legacy_browser,expected=entryBinding().instance;
  if(marker.format!=='llmwiki-project-instance/1'||marker.instance!==expected||marker.project!==loaded.data.id||marker.origin==='setup'||marker.origin==='reset'||!permission||permission.format!=='llmwiki-browser-migration/1'||permission.project!==loaded.data.id||!Array.isArray(permission.folders))return null;
  if(loaded.data.folders.some(f=>f.kind==='work'&&typeof f.path==='string'&&f.path.includes('/'+marker.instance+'/')))return null;
  const digest=Array.from(new Uint8Array(await global.crypto.subtle.digest('SHA-256',new TextEncoder().encode(loaded.seen.text))),b=>b.toString(16).padStart(2,'0')).join('');
  const folders=loaded.data.folders.map(({id,kind,path})=>({id,kind,path}));
  if(digest!==permission.settings_sha256||JSON.stringify(folders)!==JSON.stringify(permission.folders))return null;
  return permission;
}
async function migrateLegacyBrowser(root,loaded){
  const permission=await legacyBrowserPermission(root,loaded);if(!permission)return;
  for(const folder of loaded.data.folders){
    if(folder.path===null&&!await recallHandle(folderBindingKey(folder.id))){const legacy=await recallHandle(P().bindingKey(loaded.data.id,folder.id));if(legacy)await rememberHandle(folderBindingKey(folder.id),legacy);}
    if(folder.kind!=='work'||!F().listDrafts)continue;
    const old='workspace/'+[loaded.data.id,folder.id,String(folder.path)].map(encodeURIComponent).join('/'),current=draftKey({folder:folder.id,folderPath:folder.path});
    for(const draft of await F().listDrafts(old)){
      for(const key of [recoveredDraftKey(folder),current]){
        const existing=await F().recallDraft(key,draft.name);if(existing)continue;
        if(await F().keepDraft(key,draft.name,draft.text,draft.origin)===false)throw global.I18n.error(msg('Browser recovery could not be saved. The original drafts are kept.'));
        const restored=await F().recallDraft(key,draft.name);if(restored?.text!==draft.text||restored.origin!==draft.origin)throw global.I18n.error(msg('Browser recovery could not be saved. The original drafts are kept.'));
      }
    }
  }
}
async function restoredDrafts(){
  const found=[];if(!state.data||!F().listDrafts)return found;
  for(const folder of state.data.folders.filter(f=>f.kind==='work'))for(const key of [draftKey({folder:folder.id,folderPath:folder.path}),recoveredDraftKey(folder)])for(const record of await F().listDrafts(key)){
    if(!found.some(d=>d.folder.id===folder.id&&d.name===record.name&&d.text===record.text&&d.origin===record.origin))found.push({...record,folder});
  }
  return found;
}
async function draftRecovery(){
  const d=modal(msg('Preserved drafts')),drafts=await restoredDrafts();
  d.content.append(el('p','ws-muted',msg('Drafts stay on this device. Showing or copying one does not change any file.')));
  for(const draft of drafts)d.content.append(button(draft.name,()=>{const view=modal(draft.name),text=field(view.content,msg('Preserved text'),draft.text,'textarea');text.id='ws-recovered-draft';text.readOnly=true;text.rows=16;text.addEventListener('focus',()=>text.select());}));
  if(!drafts.length)d.content.append(el('p','ws-muted',msg('No preserved drafts for this project.')));
}
async function rememberProject(){
  const binding=entryBinding();
  await rememberHandle(binding.key,state.root);
  if(state.data&&state.data.connections.length){
    await rememberHandle(projectRootKey(state.data.id),state.root);
    try{global.localStorage.setItem(binding.key+"/id",state.data.id);}catch(_){}
  }
  if(!binding.entry)await rememberHandle("workspace-root",state.root);
}
async function loadProject(root,loaded){
  const instance=loaded.data?await checkProjectInstance(root,loaded):null;checkProject(loaded);
  await preserveDrafts();
  const legacyPending=!state.instance&&state.data?.id===loaded.data?.id?state.pendingDetached:[];
  state.root=root;state.projectBlocked=false;state.graphHidden.clear();state.handles.clear();state.files.clear();state.tabs=[];state.active=null;
  state.data=loaded.data;state.seen=loaded.seen;state.instance=instance||entryBinding().instance;
  if(state.data)await migrateLegacyBrowser(root,loaded);
  readPendingDetached();
  if(legacyPending.length){state.pendingDetached=[...legacyPending,...state.pendingDetached].filter((e,i,a)=>a.findIndex(v=>v.folder.id===e.folder.id)===i);savePendingDetached();}
  if(state.data){await persistPendingDetached();state.data=withoutPendingDetached(state.data);}
  renderHeader();renderTree();
  await rememberProject();
  if(!state.data){
    state.data={format:P().FORMAT,id:"p-"+global.crypto.randomUUID(),label:root.name,folders:[],connections:[]};
    settings(true);
  }else{state.connection=state.data.connections[0]?.id||null;await bindHandles();status("");}
}
async function chooseProject(reselect=false) {
  if(global.EditorHost){const root=await global.EditorHost.root();await loadProject(root,await P().read(root));return;}
  const workspace=at("workspace-app");workspace.inert=true;workspace.setAttribute("aria-busy","true");
  try{
    let root=reselect?null:state.root||state.accessRoot;
    if(root){if(await F().grantPermission(root,'readwrite')!=='granted')return requestProjectAccess();}
    else root=await F().chooseFolder("readwrite",{purpose:'project',startIn:state.root||state.accessRoot||undefined});if(!root)return;
    await loadProject(root,await P().read(root));state.accessRoot=root;
    if(await nextAccess()){workspace.inert=false;await guidedAccess();}
  }catch(error){if(error.name==='AbortError')status(msg('Selection cancelled. Your confirmed folders are kept.'));else throw error;}finally{workspace.inert=false;workspace.removeAttribute("aria-busy");}
}
let syncEpoch=0,syncRunning=null;const syncResults=new Map();
async function bindHandles() {
  await restoreActive();
  syncEpoch++;
  rememberView();
  state.handles.clear();state.files.clear();restoreInventory();folderErrors.clear();
  for(const f of state.data.folders){
    try{const h=await folderHandle(f);if(h&&await F().permissionState(h,"read")==="granted")state.handles.set(f.id,h);}catch(error){folderErrors.set(f.id,error);}
  }
  await synchronizeWikis();await refresh();renderHeader();applyEditor();
  if(!state.active)renderEmpty();
}
async function reconnect(id) {
  if(global.EditorHost){await global.EditorHost.confirm();if(!state.root)await chooseProject();const f=state.data.folders.find(f=>f.id===id);if(!f)return false;const handle=await folderHandle(f);if(!handle)return false;state.handles.set(id,handle);await synchronizeWikis();await refresh();applyEditor();return true;}
  return guidedAccess();
}
const assetFiles=new Map();
function visibleFile(name,kind,role){
  if(name.split('/').some(p=>p.startsWith('.'))||name===P().NAME)return false;
  if(role==='source')return true;
  if(name==='schema'||name.startsWith('schema/'))return false;
  return kind==='directory'||/\.md$/i.test(name);
}
async function refresh() {
  for(const id of selectedIds()){
    const handle=state.handles.get(id);if(!handle)continue;
    try{const f=state.data.folders.find(f=>f.id===id);const entries=await F().listFolder(handle,undefined,{directories:true,visible:(name,kind)=>visibleFile(name,kind,f.kind)||(!name.split('/').some(p=>p.startsWith('.'))&&/\.(png|jpe?g|gif|webp|avif)$/i.test(name))});assetFiles.set(id,entries.filter(e=>/\.(png|jpe?g|gif|webp|avif)$/i.test(e.name)));const shown=entries.filter(e=>visibleFile(e.name,e.kind||'file',f.kind));state.files.set(id,shown);rememberInventory(id,shown);folderErrors.delete(id);}
    catch(error){folderErrors.set(id,error);report(error);}
  }
  renderTree();if(!state.graphOpen)renderOutline();if(state.active&&state.active.viewer&&!state.graphOpen)showSourceViewer(state.active);if(state.graphOpen)await renderGraph();await pollReviews();
}
async function refreshProject(){
  if(!state.root||global.document.querySelector('dialog[open]'))return;
  const loaded=await P().read(state.root);
  if(!loaded.data){await clearUnavailableProject();return;}
  try{const instance=await checkProjectInstance(state.root,loaded);if(state.instance&&instance!==state.instance)throw global.I18n.error(msg('This start file belongs to an earlier setup. Open the current LLM-Wiki.html in your project folder.'));}
  catch(error){await clearUnavailableProject();throw error;}
  if(!state.seen||loaded.seen.text!==state.seen.text){
    await preserveDrafts();
    state.tabs=state.tabs.filter(tab=>loaded.data.folders.some(f=>f.id===tab.folder&&f.path===tab.folderPath));
    if(!state.tabs.includes(state.active))state.active=null;
    state.data=withoutPendingDetached(loaded.data);state.seen=loaded.seen;
    if(!state.data.connections.some(c=>c.id===state.connection))state.connection=state.data.connections[0]?.id||null;
    await bindHandles();
  }
}
async function refreshCurrent(){
  if(!state.root)return requestProjectAccess(refreshCurrent);
  await refreshProject();if(!state.root)return;
  await synchronizeWikis();await refresh();
}
function renderHeader() {
  global.I18n.setText(at("ws-project-name"),global.document.title);
}
function retainTreeExpansion(detail,key,fallback,force=false){
  const cache='llmwiki.ui.tree/'+browserProjectKey()+'/'+key;
  let stored=null;try{stored=global.localStorage.getItem(cache);}catch(_){}
  detail.open=force||stored===null?Boolean(force||fallback):stored==='open';
  detail.dataset.treeState=cache;
  detail.addEventListener('toggle',()=>{if(detail.isConnected)try{global.localStorage.setItem(cache,detail.open?'open':'closed');}catch(_){}});
}
function renderTree(revealSelection=false) {
  const root=at("ws-tree");if(!root)return;
  for(const detail of root.querySelectorAll('details[data-tree-state]'))try{global.localStorage.setItem(detail.dataset.treeState,detail.open?'open':'closed');}catch(_){}
  root.replaceChildren();
  for(const kind of ["wiki","source"]){
    const group=el("section","ws-tree-group");group.dataset.kind=kind;
    const head=el("header","ws-tree-head");head.append(el("h3","",{work:msg("Working folder"),wiki:msg("Wikis"),source:msg("Sources")}[kind]),button({work:msg("Add working folder"),wiki:msg("Add wiki"),source:msg("Add sources")}[kind],()=>addFolder(kind),"plus"));group.append(head);
    const scroll=el("div","ws-tree-scroll");group.append(scroll);
    for(const f of (state.data?state.data.folders:[]).filter(f=>f.kind===kind&&(kind!=='source'||state.data.connections.some(c=>c.sources.includes(f.id))))){
      const selected=state.active&&(state.active.wiki||state.active.folder)===f.id;
      const detail=el("details","ws-root");retainTreeExpansion(detail,f.id+'/root',true,revealSelection&&selected);const summary=el("summary");summary.append(icon(f.icon||"folder"),el("span","ws-tree-label",f.label));const detach=button(msg("Disconnect"),()=>detachFolder(f.id),"x","ws-detach");detach.addEventListener("click",e=>e.preventDefault());const actions=el('span','ws-root-actions');if(f.kind==='wiki')actions.append(button(msg('New folder'),()=>newFolder(f.id),'folder-plus'));actions.append(detach);summary.append(actions);detail.append(summary);
      const access=el('div','ws-root-access');access.setAttribute('popover','auto');detail.append(access);
      if(f.kind==="wiki"&&workIds(f.id).length>1&&!workingFolder(f.id))access.append(button(msg("Choose your editable copy"),()=>connectWiki(f.id)));
      if(f.kind==="source"&&!state.handles.has(f.id))access.append(button(!state.root&&f.path!==null?msg("Allow folder access"):msg("Connect folder"),()=>reconnect(f.id),null,"ws-reconnect"));
      const work=f.kind==='wiki'&&workingFolder(f.id);
      if(f.kind==='wiki'){
        const result=syncResults.get(f.id);
        if(result?.error||result?.pending||result?.conflicts?.length||!state.handles.has(f.id))access.append(button(msg(result?.conflicts?.length?'Resolve differences':result?.error?'Synchronization needs attention':result?.pending?'Changes waiting':'Connect the wiki folder to synchronize.'),()=>syncDetails(f),null,'ws-sync-note'));
      }
      if(work&&!state.handles.has(work))access.append(button(msg("Connect wiki for editing"),()=>connectWiki(f.id),null,"ws-reconnect"));
      if(folderErrors.has(f.id)){const problem=el("p","ws-folder-error",global.I18n.fromError(folderErrors.get(f.id)));problem.setAttribute('role','status');access.append(problem);}
      if(work&&folderErrors.has(work))access.append(el("p","ws-folder-error",global.I18n.fromError(folderErrors.get(work))));
      if(access.childNodes.length){const trigger=button(msg('Folder status'),event=>{},'info','ws-access-trigger');trigger.title=msg('Folder status');trigger.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();const r=trigger.getBoundingClientRect();access.style.left=r.right+'px';access.style.top=r.top+'px';if(!access.matches(':popover-open'))access.showPopover();});const show=()=>{const r=trigger.getBoundingClientRect();access.style.left=Math.min(r.right,global.innerWidth-300)+'px';access.style.top=r.top+'px';if(!access.matches(':popover-open'))access.showPopover();};trigger.addEventListener('mouseenter',show);trigger.addEventListener('focus',show);const hide=()=>setTimeout(()=>{if(access.isConnected&&!access.matches(':hover')&&!trigger.matches(':hover')&&!access.contains(global.document.activeElement)&&global.document.activeElement!==trigger&&access.matches(':popover-open'))access.hidePopover();},200);trigger.addEventListener('mouseleave',hide);access.addEventListener('mouseleave',hide);actions.insertBefore(trigger,detach);}
      {
        const entries=f.kind==="wiki"?wikiEntries(f.id):(state.files.get(f.id)||[]);

        const shown=entries.filter(e=>f.kind==='source'||!e.name.endsWith('/')||!/^(sources|topics|entities|concepts)\//.test(e.name)||entries.some(child=>!child.name.endsWith('/')&&child.name.startsWith(e.name)));
        const nodes=tree(shown.map(e=>e.name));
        function draw(nodes,parent){for(const n of nodes){if(n.children){const d=el("details","ws-branch"),s=el("summary");retainTreeExpansion(d,f.id+'/'+n.path,n.path==="wiki",revealSelection&&selected&&state.active.name.startsWith(n.path+'/'));s.append(icon("folder"),el("span","ws-tree-label",n.name));if(f.kind==='wiki')s.addEventListener('contextmenu',event=>{event.preventDefault();newFolder(f.id,n.path);});d.append(s);draw(n.children,d);parent.append(d);}else{const b=button(n.name.replace(/\.md$/i,""),()=>f.kind==="wiki"?openWikiFile(f.id,n.path):openFile(f.id,n.path),null,"ws-file");b.replaceChildren(icon("file-text"),el("span","ws-tree-label",n.name.replace(/\.md$/i,"")));b.title=n.path;if(f.kind==='wiki')b.addEventListener('contextmenu',event=>{event.preventDefault();moveDocument(f.id,n.path);});b.classList.toggle("selected",Boolean(state.active&&(state.active.wiki||state.active.folder)===f.id&&state.active.name===n.path));parent.append(b);}}}
        draw(nodes,detail);if(!nodes.length&&state.handles.has(work||f.id)&&!folderErrors.has(work||f.id))detail.append(el("p","ws-muted",msg("No files yet")));
      }
      scroll.append(detail);
    }
    root.append(group);
  }
}
function sidebarResize(panel,side){
 const grip=el('div','ws-resize ws-resize-'+side);grip.tabIndex=0;grip.setAttribute('role','separator');grip.setAttribute('aria-orientation','vertical');grip.setAttribute('aria-label',msg(side==='left'?'Folder sidebar width':'Outline sidebar width'));panel.append(grip);
 const key='llmwiki.sidebar.'+side,css=side==='left'?'--ws-sidebar-width':'--ws-outline-width';
 function set(value){const max=Math.max(180,Math.min(650,global.innerWidth*.5)),width=Math.max(160,Math.min(max,value));at('workspace-app').style.setProperty(css,width+'px');grip.setAttribute('aria-valuenow',String(Math.round(width)));grip.setAttribute('aria-valuemin','160');grip.setAttribute('aria-valuemax',String(Math.round(max)));try{global.localStorage.setItem(key,String(width));}catch{}}
 const saved=Number(global.localStorage.getItem(key));if(saved)set(saved);
 grip.addEventListener('pointerdown',event=>{event.preventDefault();const x=event.clientX,width=panel.getBoundingClientRect().width;grip.setPointerCapture(event.pointerId);const move=e=>set(width+(e.clientX-x)*(side==='left'?1:-1));const end=()=>{grip.removeEventListener('pointermove',move);};grip.addEventListener('pointermove',move);grip.addEventListener('pointerup',end,{once:true});grip.addEventListener('pointercancel',end,{once:true});});
 grip.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();set(panel.getBoundingClientRect().width+(event.key==='ArrowRight'?20:-20)*(side==='left'?1:-1));}});
}
function renderTabs() {
  const root=at("ws-tabs");if(!root)return;root.replaceChildren();
  for(const t of state.tabs){const box=el("div","ws-tab"+(t===state.active&&!state.graphOpen?" active":""));box.setAttribute("role","tab");box.setAttribute("aria-selected",String(t===state.active&&!state.graphOpen));const b=button(t.name.split("/").pop().replace(/\.md$/i,"")+(t.text!==t.origin?" *":""),()=>activate(t));b.title=t.name;box.append(b,button(msg("Close tab"),()=>closeTab(t),"close"));root.append(box);}
}
async function openFile(folder,name,wiki=null) {
  collect();const existing=state.tabs.find(t=>t.folder===folder&&t.name===name);if(existing){if(wiki)existing.wiki=wiki;activate(existing);return;}
  let dir=state.handles.get(folder);if(!dir){if(!state.root)return requestProjectAccess(()=>openFile(folder,name,wiki));await reconnect(folder);dir=state.handles.get(folder);if(!dir)return;}
  const configured=state.data.folders.find(f=>f.id===folder);
  if(!state.root||configured.kind==="source"||global.SourceViewer.kind(name)!=="text"){
    const tab={folder,wiki:null,name,text:"",origin:"",viewer:true,dir,folderPath:configured.path,projectId:state.data.id,root:state.root};state.tabs.push(tab);activate(tab);return;
  }
  if(!/\.(md|txt|csv|json)$/i.test(name)){status(msg("Open this original in Finder or Explorer: {name}",{name}));return;}
  const entry=(state.files.get(folder)||[]).find(e=>e.name===name);if(entry&&entry.size>2000000)throw global.I18n.error(msg("This file exceeds 2 MB. Open it in your local editor."));
  const seen=await F().readFile(dir,name);if(typeof seen.text!=="string")throw global.I18n.error(msg("The file cannot be read."));
  if(!wiki){const owners=state.data.connections.filter(c=>c.works.includes(folder));if(owners.length===1)wiki=owners[0].wiki;}
  const tab={folder,wiki,name,text:seen.text,origin:seen.text,mark:seen.mark,folderPath:state.data.folders.find(f=>f.id===folder).path,dir};
  const draft=await F().recallDraft(draftKey(tab),name);
  if(draft&&draft.text!==draft.origin&&typeof draft.text==="string"&&typeof draft.origin==="string"){tab.text=draft.text;tab.origin=draft.origin;}
  await initializeReview(tab,seen);state.tabs.push(tab);activate(tab);
}
function hideSourceViewer(){if(state.sourceView){state.sourceView.destroy();state.sourceView=null;}at("ws-source-viewer").hidden=true;at("workspace-app").classList.remove("ws-viewing-source");}
function showSourceViewer(tab){
  hideSourceViewer();at("workspace-app").classList.add("ws-viewing-source");at("ws-document").hidden=true;at("ws-empty").hidden=true;at("ws-source-viewer").hidden=false;
  at("ws-save").disabled=true;at("ws-editor").contentEditable="false";at("ws-source").readOnly=true;
  const configured=state.data.folders.find(f=>f.id===tab.folder);tab.dir=state.handles.get(tab.folder);
  if(!configured||configured.path!==tab.folderPath||!tab.dir){at("ws-source-viewer").append(el("p","ws-viewer-message",msg("Folder permission changed. Reopen the project.")));return;}
  at("ws-breadcrumb").textContent=currentFolder().label+" / "+tab.name;global.I18n.setText(at("ws-readonly"),msg("Read only"));
  state.sourceView=global.SourceViewer.mount(at("ws-source-viewer"),{root:state.root,dir:tab.dir,folder:currentFolder(),name:tab.name});
  renderTabs();renderTree(true);status(msg("Source preview. The original is not changed."));
}
function activate(tab){
  collect();hideGraph();hideSourceViewer();state.active=tab;at("ws-document-bar").hidden=false;if(tab.viewer){showSourceViewer(tab);return;}at("ws-empty").hidden=true;at("ws-document").hidden=false;
  state.sheet.value=tab.text;at("ws-source").value=tab.text;
  at("ws-breadcrumb").textContent=((state.data.folders.find(f=>f.id===tab.wiki)||currentFolder()).label+" / "+tab.name);
  const f=currentFolder();at("ws-editor").contentEditable=String(f.writable);at("ws-source").readOnly=!f.writable;
  at("ws-save").disabled=!f.writable;global.I18n.setText(at("ws-readonly"),f.writable?"":msg("Read only"));
  renderTabs();renderTree(true);renderOutline();setMode(state.mode,false);status(sharedOriginal(state.data,tab.folder)?msg("Shared version, read only. Receive changes with the skill to edit your working copy."):tab.text!==tab.origin?msg("Draft restored on this device."):msg("File opened."));pollReviews().catch(report);
}
async function closeTab(tab){await preserveDrafts([tab]);state.tabs=state.tabs.filter(t=>t!==tab);if(state.active===tab){state.active=null;if(state.tabs.length)activate(state.tabs[state.tabs.length-1]);else renderEmpty();}renderTabs();}
function renderEmpty(){
  hideGraph();hideSourceViewer();at("ws-document-bar").hidden=true;at("ws-empty").hidden=false;at("ws-document").hidden=true;at("ws-breadcrumb").textContent="";renderTabs();
  if(state.data){const empty=at("ws-empty");empty.replaceChildren(icon("book"),el("h1","",state.data.label),el("p","",msg("Choose a file from your wikis or sources.")));}
}
async function saveActive({automatic=false,target=state.active}={}){
  if(state.reviewBusy)return;if(state.active===target)collect();const tab=target;if(!tab||tab.viewer)return;
  if(automatic&&(!reviewAuthor||await F().permissionState(tab.dir,'readwrite')!=='granted')){status(msg('Automatic saving paused. Check your author name and folder access in Settings.'));return;}
  const submitted=tab.text;
  state.reviewBusy=true;
  try{
    await writableTab(tab);if(!await ensureAuthor())return;
    await state.draftWrites;
    const current=await F().readFile(tab.dir,tab.name);
    if(current.text!==tab.checkpoint.text){if(!automatic)await compare();status(msg("Review the changes since your last saved or accepted version."));return;}
    const merged=global.Surface.reconcile(tab.origin,submitted,current.text);
    if(merged.hasOpenSpots){if(!automatic)await compare();status(msg("Not saved. Review the changes in both versions."));return;}
    const done=await global.WikiCore.saveNote(tab.dir,tab.name,current,merged.text,reviewAuthor,F(),R(),{update:false});
    if(!done.saved){if(!automatic)await compare();status(msg("The file changed again. Reopen the comparison before deciding."));return;}
    await savedReview(tab,done,{preserveEditing:true,submitted,refreshIndex:!automatic});
  }finally{state.reviewBusy=false;setTimeout(()=>synchronizeWikis().then(refresh).catch(report),0);}
}
async function newFolder(wiki,parent='wiki'){
 const id=workingFolder(wiki);if(!state.handles.has(id)){await connectWiki(wiki);if(!state.handles.has(id))return;}
 const d=modal(msg('New folder')),input=field(d.content,msg('Folder path'),parent+'/');
 d.foot.append(button(msg('Create folder'),async()=>{await global.WikiCore.makeFolder(global.WikiCore.browserStore(state.handles.get(id),F(),R()),input.value.trim());d.dialog.close();await refresh();}));input.focus();
}
async function performMove(wiki,name,destination){
 const id=workingFolder(wiki);if(!state.handles.has(id)){await connectWiki(wiki);if(!state.handles.has(id))return;}
 const tab=state.tabs.find(t=>t.folder===id&&t.name===name);if(tab){collect();if(tab.text!==tab.origin||tab.checkpoint?.text!==tab.origin)throw global.I18n.error(msg('Save and review changes before moving the file.'));}
 if(name===destination)return;
 if(!await ensureAuthor())return;state.reviewBusy=true;
 try{const store=global.WikiCore.browserStore(state.handles.get(id),F(),R());const plan=await global.WikiCore.planMoves(store,{moves:[{from:name,to:destination}],author:reviewAuthor});const done=await global.WikiCore.applyMoves(store,plan.id);if(!done.complete)throw Error(done.message);
 if(tab){const cp={...tab.checkpoint,text:(await store.read(destination)).text};await R().checkpoint(checkpointKey(tab),destination,cp);state.tabs=state.tabs.filter(t=>t!==tab);if(state.active===tab)state.active=null;}
 await synchronizeWikis();await refresh();await openFile(id,destination,wiki);
 }finally{state.reviewBusy=false;}
}
async function moveDocument(wiki,name){
 const d=modal(msg('Move file')),input=field(d.content,msg('Destination path'),name),error=el('p','ws-muted');d.content.append(error);
 d.foot.append(button(msg('Move file'),async()=>{try{await performMove(wiki,name,input.value.trim());d.dialog.close();}catch(e){global.I18n.setText(error,global.I18n.fromError(e));}}));input.focus();
}
function renderDocumentName(){
 const input=at('ws-document-name'),tab=state.active;if(!input||!tab)return;
 input.value=tab.name.split('/').at(-1).replace(/\.md$/i,'');input.readOnly=!tab.wiki||!currentFolder().writable;
}
async function renameDocument(){
 const tab=state.active,input=at('ws-document-name');if(!tab||input.readOnly)return;const name=input.value.trim().replace(/\.md$/i,'');
 if(!name||/[\/\\]/.test(name)||name.startsWith('.')){renderDocumentName();throw global.I18n.error(msg('Choose a valid file name.'));}
 const prefix=tab.name.split('/').slice(0,-1);try{await performMove(tab.wiki,tab.name,[...prefix,name+'.md'].join('/'));}finally{renderDocumentName();}
}
async function newFile(){
  if(!state.root)return requestProjectAccess(newFile);
  const c=selectedConnection();if(!c){settings(true);return;}
  const work=workingFolder(c.wiki),handle=state.handles.get(work);if(!handle||await F().permissionState(handle,'readwrite')!=='granted'){await connectWiki(c.wiki);if(!state.handles.has(work))return;}
  const d=modal(msg("New note"));const options=state.data.folders.filter(f=>f.kind==="wiki").map(f=>[f.id,f.label]);
  const folder=select(d.content,msg("Wiki"),options,state.active&&state.active.wiki||c.wiki);const name=field(d.content,msg("File name, including optional subfolders"),"wiki/My note.md");
  d.foot.append(button(msg("Create note"),async()=>{const target=workingFolder(folder.value);if(!target)throw global.I18n.error(msg("Choose your working copy in Advanced settings"));const f=state.data.folders.find(f=>f.id===target);if(!f.writable)throw global.I18n.error(msg("This folder is read only."));let path=name.value.trim();if(!path.endsWith(".md"))path+=".md";if(F().writableName(path)===null||path.split("/").some(p=>p.startsWith(".")))throw global.I18n.error(msg("Choose a valid file name."));if(wikiEntries(folder.value).some(e=>e.name===path))throw global.I18n.error(msg("The file already exists or cannot be written."));const dir=state.handles.get(f.id);if(!dir)throw global.I18n.error(msg("Connect this wiki to edit its files."));if(await F().grantPermission(dir,"readwrite")!=="granted")throw global.I18n.error(msg("Allow write access to edit this wiki."));const latest=await P().read(state.root);await checkProjectInstance(state.root,latest);const bound=latest.data.folders.find(v=>v.id===f.id);if(!bound||!bound.writable||bound.path!==f.path)throw global.I18n.error(msg("Folder permission changed. Reopen the project."));const title=path.split("/").pop().slice(0,-3);if(!await ensureAuthor())return;const done=await global.WikiCore.saveNote(dir,path,null,global.WikiCore.newNote(dir,title,reviewAuthor,F(),R()),reviewAuthor,F(),R());if(!done.saved)throw global.I18n.error(msg("The file already exists or cannot be written."));d.dialog.close();await refresh();await openFile(f.id,path,folder.value);if(done.index_error)status(msg("The note is saved; index refresh needs attention: {reason}",{reason:done.index_error}));if(!done.recorded){state.active.pendingRecord=done.event;state.active.checkpoint.pendingRecord=done.event;await storeCheckpoint(state.active);status(msg("The file was saved, but its author record is incomplete. Open the comparison to retry the record."));}},null,"ws-primary"));name.focus();
}
function editPropertyDetails(key){
 const tab=state.active;if(!tab||state.mode==='read'||!currentFolder().writable)return;collect();const original=tab.text;
 global.PropertyDetails.open({key,source:original,modal,onApply:text=>{
  if(state.active!==tab||tab.text!==original||state.mode==='read'||!currentFolder().writable)throw global.I18n.error(msg('The note changed while the dialog was open. Reopen the property details.'));
  if(text===original)return;tab.text=text;setMode(state.mode,false);changed(state.mode==='source'?at('ws-source').value:state.sheet.value);
 }});
}
function renderProperties(){
 renderDocumentName();const root=at('ws-document-properties');root.replaceChildren();const tab=state.active;if(!tab)return;
 let parsed;try{parsed=global.WikiCore.parseDocument(tab.text);}catch(error){root.append(el('p','ws-muted',error.message));return;}
 if(!tab.registerLoading&&!Object.hasOwn(tab,'register')){tab.registerLoading=true;F().peek(state.handles.get(tab.folder),'schema/TYPES.md').then(f=>{tab.register=f?.text??null;}).catch(()=>{tab.register=null;}).finally(()=>{tab.registerLoading=false;if(state.active===tab)renderProperties();});}
 let choices={status:[...global.WikiCore.STATUS_VALUES]};try{if(tab.register)choices=global.WikiCore.propertyChoices(tab.register,parsed.head);}catch(_){}
 if(!parsed.offset||state.mode==='source'||global.localStorage.getItem('llmwiki.properties.visibility')==='hidden')return;
 const fixed={id:'text',title:'text',description:'text',type:'text',status:'text',class:'text',owner:'list',tags:'tags',aliases:'list',related:'list',sources:'list',generated:'object',resource:'object'};
 const typeKey='llmwiki.property-types/'+browserProjectKey()+'/'+(tab.wiki||tab.folder);let types={};try{types=JSON.parse(localStorage.getItem(typeKey)||'{}');}catch(_){}
 const details=el('details','ws-document-properties');details.open=localStorage.getItem('llmwiki.properties.open')!=='false';details.append(el('summary','',msg('Properties')));details.addEventListener('toggle',()=>localStorage.setItem('llmwiki.properties.open',String(details.open)));
 function display(parent,value){
  if(Array.isArray(value)){const list=el('ul','ws-property-list');for(const item of value){const li=el('li');display(li,item);list.append(li);}parent.append(list);return;}
  if(value&&typeof value==='object'){const table=el('dl','ws-property-object');for(const [k,v]of Object.entries(value)){table.append(el('dt','',k));const dd=el('dd');if(value===parsed.head.resource&&k==='name'&&typeof v==='string')dd.append(button(v,()=>openOriginal(tab,value),null,'ws-inline-link'));else display(dd,v);table.append(dd);}parent.append(table);return;}
  const text=String(value??''),re=/\[([^\]]+)\]\(<?([^)>]+)>?\)/g;let at=0;for(const m of text.matchAll(re)){parent.append(document.createTextNode(text.slice(at,m.index)));const target=m[2];if(/^https?:\/\//i.test(target)){const link=el('a','ws-inline-link',m[1]);link.href=target;link.target='_blank';link.rel='noopener noreferrer';parent.append(link);}else if(!/^[a-z][a-z0-9+.-]*:/i.test(target)||target===/\[[^\]]*\]\(<?([^)>]+)>?\)/.exec(parsed.head.resource?.link??'')?.[1])parent.append(button(m[1],()=>followLink(tab,target),null,'ws-inline-link'));else parent.append(document.createTextNode(m[0]));at=m.index+m[0].length;}parent.append(document.createTextNode(text.slice(at)));
 }
 function commit(key,value){if(state.active!==tab)return;collect();tab.text=global.WikiCore.patchHead(tab.text,{[key]:value});setMode(state.mode,false);changed(state.sheet.value);}
 const presentation=global.WikiCore.parseDocument(global.WikiCore.projectMetadata(tab.text));
 if(state.mode!=='read'&&currentFolder().writable)details.append(button(msg('Visible metadata'),()=>{
  const d=modal(msg('Visible metadata')),selected=new Set(parsed.metadata?.visible??['resource']),checks=[];
  for(const key of ['resource','source_created_at','source_modified_at','generated_at']){const label=el('label','ws-check'),input=el('input');input.type='checkbox';input.checked=selected.has(key);label.append(input,el('span','',key));d.content.append(label);checks.push([key,input]);}
  d.content.append(el('p','ws-muted',msg('Technical provenance remains in the file when hidden.')));
  d.foot.append(button(msg('Apply'),()=>{collect();tab.text=global.WikiCore.projectMetadata(tab.text,checks.filter(([,i])=>i.checked).map(([k])=>k));setMode(state.mode,false);changed(state.sheet.value);d.dialog.close();}));
 },'settings'));
 for(const [key,value]of Object.entries(presentation.visibleHead??parsed.head)){
  const row=el('div','ws-property'),label=el('label','',key);row.append(label);
  const locked=state.mode==='read'||!currentFolder().writable||['id','generated','resource','extraction','source_id','source_created_at','source_modified_at','generated_at'].includes(key);
  const inferred=Array.isArray(value)?'list':value&&typeof value==='object'?'object':typeof value==='boolean'?'checkbox':typeof value==='number'?'number':/^\d{4}-\d{2}-\d{2}T/.test(String(value))?'datetime':/^\d{4}-\d{2}-\d{2}$/.test(String(value))?'date':'text';
  const type=fixed[key]||types[key]||inferred;
  const content=el('div','ws-property-content');
  if(!fixed[key]&&!locked&&inferred!=='object'){
   const chooser=el('select','ws-property-type');chooser.setAttribute('aria-label',String(msg('Property type'))+' '+key);
   for(const [v,l]of [['text','Text'],['list','List'],['number','Number'],['checkbox','Checkbox'],['date','Date'],['datetime','Date and time']])chooser.append(new Option(String(msg(l)),v));chooser.value=type;
   chooser.addEventListener('change',()=>{const next=chooser.value;let compatible=next===inferred||['text','date','datetime'].includes(next)&&typeof value==='string'||value===null;if(!compatible){chooser.value=type;status(msg('Changing this property type would convert existing values. Edit the value in source mode first.'));return;}types[key]=next;localStorage.setItem(typeKey,JSON.stringify(types));renderProperties();});content.append(chooser);
  }
  if(locked||type==='object'){display(content,value);if(!locked)content.append(button(msg('Edit details'),()=>editPropertyDetails(key),'square-pen'));if(key==='resource'&&!parsed.head.resource?.link&&typeof parsed.head.resource?.name==='string'&&state.data.connections.some(c=>c.wiki===tab.wiki&&c.sources.includes(parsed.head.resource.store)))content.append(button(msg('Open source'),()=>openOriginal(tab,parsed.head.resource),'external-link'));}
  else if(choices[key]){
   const input=el('select');input.id='ws-property-'+key;label.htmlFor=input.id;
   const values=[...choices[key]];if(!values.includes(value))values.unshift(value);
   for(const v of values)input.append(new Option(String(v??''),String(v??'')));input.value=String(value??'');input.addEventListener('change',()=>commit(key,input.value));content.append(input);
  }else if(type==='list'||type==='tags'){
   display(content,value);if(Array.isArray(value)&&!value.every(v=>typeof v==='string'))content.append(button(msg('Edit details'),()=>editPropertyDetails(key),'square-pen'));if(Array.isArray(value)&&value.every(v=>typeof v==='string'))content.append(button(msg('Edit values'),()=>{const d=modal(key),input=field(d.content,msg('One value per line'),(Array.isArray(value)?value:[value]).filter(v=>v!==null).join('\n'),'textarea');d.foot.append(button(msg('Apply'),()=>{const next=input.value.split(/\r?\n/).filter(Boolean);commit(key,next);d.dialog.close();}));},'square-pen'));
  }else{
   const input=el('input');input.id='ws-property-'+key;label.htmlFor=input.id;input.type=type==='checkbox'?'checkbox':type==='number'?'number':type==='date'?'date':type==='datetime'?'datetime-local':'text';if(type==='number')input.step='any';if(type==='checkbox'){input.checked=value===true;input.indeterminate=value===null;}else input.value=String(value??'');
   input.addEventListener('change',()=>{try{if(!input.checkValidity())throw Error(input.validationMessage);const next=type==='checkbox'?input.checked:type==='number'?input.value===''?null:Number(input.value):input.value;commit(key,next);}catch(error){report(error);}});content.append(input);if(typeof value==='string'&&/\[[^\]]+\]\(/.test(value)){const links=el('div','ws-property-links');display(links,value);content.append(links);}
  }
  row.append(content);details.append(row);
 }
 root.append(details);
}
function setMode(mode,collectFirst=true){
 if(state.active&&state.active.viewer)return;if(collectFirst)collect();state.mode=mode;
 at('ws-editor').hidden=mode!=='live';at('ws-source').hidden=mode!=='source';at('ws-preview').hidden=mode!=='read';
 for(const b of at('ws-modes').children)b.setAttribute('aria-pressed',String(b.dataset.mode===mode));
 for(const b of global.document.querySelectorAll('.ws-toolbar button,.ws-toolbar select'))b.disabled=!b.dataset.readAction&&(mode==='read'||!state.active||!currentFolder().writable);
 if(!state.active)return;state.editorPrefix='';
 if(mode==='live'){let text=state.active.text;try{const p=global.WikiCore.parseDocument(text);state.editorPrefix=text.slice(0,p.offset);text=p.body;}catch{}state.sheet.value=text;}
 if(mode==='live')renderLiveAssets();
 if(mode==='source')at('ws-source').value=state.active.text;
 if(mode==='read')renderMarkdown(state.active.text,at('ws-preview'),state.active,0).catch(report);
 renderProperties();
}
async function compare(selected=null){return reviewDialog(selected);}

async function advancedSettings(first){
  if(!state.root&&!state.data){const d=modal(msg("Settings"));editorSettings(d.content);global.I18n.languagePicker(d.content,"ws-settings-language");appearanceSettings(d.content);authorSettings(d.content);d.foot.append(button(msg("Open project folder"),async()=>{d.dialog.close();await chooseProject();}));return;}
  if(!first&&state.root)await refreshProject();
  const draft=JSON.parse(JSON.stringify(state.data));
  const chosenHandles=new Map();
  const d=modal(first?msg("Set up your knowledge space"):msg("Settings"));d.dialog.classList.add("ws-settings");
  editorSettings(d.content,first);
  const advanced=el("details","ws-advanced");advanced.id="ws-advanced";advanced.open=Boolean(first);advanced.append(el("summary","",msg("Advanced")));
  const activeConnection=select(advanced,msg("Active connection"),draft.connections.map(c=>[c.id,c.label]),state.connection);activeConnection.id="ws-settings-active-connection";activeConnection.parentElement.hidden=first;
  if(!first)advanced.append(el("p","ws-muted",msg("Select the context for new notes. The graph includes all connected wikis.")));
  const intro=el("p","ws-muted",first?msg("Step 2 of 3: Connect your folders. Next, specify which sources and working folders belong to each wiki."):msg("Folders and connections are saved directly in the project and shared with it. No agent run is needed."));d.content.append(intro);
  global.I18n.languagePicker(d.content,"ws-settings-language");d.content.append(el("p","ws-muted",msg("Language is saved on this device. Your documents keep their original language.")));
  appearanceSettings(d.content);authorSettings(d.content);
  const pname=field(d.content,msg("Project name"),draft.label);
  d.content.append(el("p","ws-muted",msg("You can also open the working folder in Obsidian or your own editor. Manage source and wiki connections here. Grant actual access permissions in your file system or storage provider.")));
  const folderList=el("div","ws-folder-settings"),workList=el("div","ws-folder-settings");d.content.append(folderList);advanced.append(el("h3","",msg("Working folders")),el("p","ws-muted",msg("Working files appear under their wiki. These folders store your personal changes.")),workList);
  const rows=[];
  function drawFolders(){
    folderList.replaceChildren();workList.replaceChildren();rows.length=0;
    for(const f of draft.folders){
      const box=el("fieldset","ws-folder-card");box.append(el("legend","",{wiki:msg("LLM wiki"),work:msg("Working folder"),source:msg("Sources & originals")}[f.kind]));
      const name=field(box,msg("Name"),f.label);const path=el("p","ws-path",f.path===null?msg("Connected externally. Bind separately on each device."):f.path);box.append(path);
      box.append(button(msg("Choose folder"),async()=>{harvest();const h=await F().chooseFolder(f.writable?"readwrite":"read");if(!h)return;f.path=await P().relative(state.root,h);f.label=name.value||h.name;chosenHandles.set(f.id,h);global.I18n.setText(path,f.path===null?msg("External: {name}. The agent needs a device binding for {id}",{name:h.name,id:f.id}):f.path);}));
      const readers=field(box,msg("Readers (people or groups, separated by commas)"),f.readers.join(", "));
      const writers=field(box,msg("Writers"),f.writers.join(", "));
      const toggle=el("label","ws-check");const check=el("input");check.type="checkbox";check.checked=f.writable;toggle.append(check);global.I18n.appendText(toggle,msg("Allow writing with this tool"));box.append(toggle);
      box.append(button(msg("Remove folder"),()=>{harvest();if(draft.connections.some(c=>c.wiki===f.id||c.works.includes(f.id)||c.sources.includes(f.id)))throw global.I18n.error(msg("Remove this folder from its connections first."));draft.folders=draft.folders.filter(v=>v.id!==f.id);drawFolders();drawConnections();}));
      const row={f,name,readers,writers,check};rows.push(row);(f.kind==="work"?workList:folderList).append(box);
    }
  }
  function harvest(){for(const r of rows){r.f.label=r.name.value.trim();r.f.readers=r.readers.value.split(",").map(s=>s.trim()).filter(Boolean);r.f.writers=r.writers.value.split(",").map(s=>s.trim()).filter(Boolean);r.f.writable=r.check.checked;}for(const r of crows){r.c.label=r.name.value.trim();r.c.wiki=r.wiki.value;r.c.works=values(r.works);r.c.sources=values(r.sources);r.c.mode=r.mode.value;}}
  const add=el("div","ws-actions");
  for(const [kind,label]of[["work",msg("Add working folder")],["source",msg("Add sources")],["wiki",msg("Add wiki")]])(kind==="work"?advanced:add).append(button(label,async()=>{harvest();const h=await F().chooseFolder(kind==="source"?"read":"readwrite");if(!h)return;const id=kind+"-"+global.crypto.randomUUID();const f={id,label:h.name,kind,path:await P().relative(state.root,h),writable:kind!=="source",readers:[],writers:[]};draft.folders.push(f);chosenHandles.set(id,h);drawFolders();drawConnections();}));
  if(!draft.folders.length)add.append(button(msg("Create default folders"),async()=>{await checkProjectInstance(state.root,await P().read(state.root));for(const [kind,name]of[["work","Work"],["source","Sources"],["wiki","Wiki"]]){const h=await state.root.getDirectoryHandle(name,{create:true});const id=kind+"-"+global.crypto.randomUUID();draft.folders.push({id,label:name,kind,path:name,writable:kind!=="source",readers:[],writers:[]});chosenHandles.set(id,h);}drawFolders();drawConnections();},null,"ws-secondary"));
  d.content.append(add,advanced);
  const mapping=el("section","ws-mapping");mapping.id="ws-mappings";
  mapping.append(el("h3","",msg("Folder connections")),el("p","ws-muted",msg("Choose a wiki, then its working folders and sources. You can select more than one folder.")));
  d.content.insertBefore(mapping,intro.nextSibling);
  const connections=el("div");mapping.append(connections);const crows=[],personalChoices=new Map();
  function updateConnections(){
    const uses=new Map(),wikiWorks=new Map();
    for(const r of crows){
      if(!wikiWorks.has(r.wiki.value))wikiWorks.set(r.wiki.value,new Set());
      for(const id of values(r.works))wikiWorks.get(r.wiki.value).add(id);
      for(const id of [...values(r.works),...values(r.sources)]){if(!uses.has(id))uses.set(id,new Set());uses.get(id).add(r.wiki.value);}
    }
    for(const r of crows){
      const work=values(r.works),source=values(r.sources);
      r.workRatio.textContent=work.length+" : 1";r.sourceRatio.textContent="1 : "+source.length;
      const reused=[...work,...source].filter(id=>uses.get(id).size>1);
      r.reused.replaceChildren();r.reused.hidden=!reused.length;
      for(const id of reused){const f=draft.folders.find(f=>f.id===id);r.reused.append(el("span","",msg("{folder} · {count} wikis",{folder:f.label,count:uses.get(id).size})));}
      if(work.some(id=>uses.get(id).size>1))r.reused.append(el("p","",msg("Shared working folders show the same working files in each linked wiki. Choose separate working folders to keep their files separate.")));
      const available=Array.from(wikiWorks.get(r.wiki.value)),previous=personalChoices.get(r.wiki.value)||r.choice.value, preferred=workingFolder(r.wiki.value);
      r.choice.replaceChildren();
      const placeholder=el("option","",msg("Choose a folder"));placeholder.value="";r.choice.append(placeholder);
      for(const id of available){const f=draft.folders.find(f=>f.id===id),option=el("option","",f.label);option.value=id;r.choice.append(option);}
      r.choice.value=available.includes(previous)?previous:available.includes(preferred)?preferred:available.length===1?available[0]:"";
      r.choice.parentElement.hidden=available.length<2||crows.find(row=>row.wiki.value===r.wiki.value)!==r;
      const wiki=draft.folders.find(f=>f.id===r.wiki.value);
      const label=msg("Working copy for {name}",{name:wiki?wiki.label:msg("Wiki")});
      global.I18n.setAttribute(r.choice,"aria-label",label);
      global.I18n.setText(r.choiceCaption,label);
    }
  }
  function drawConnections(){
    // Preserve selections before redrawing after adding a folder.
    for(const r of crows){r.c.label=r.name.value;r.c.wiki=r.wiki.value;r.c.works=values(r.works);r.c.sources=values(r.sources);r.c.mode=r.mode.value;}
    connections.replaceChildren();crows.length=0;
    for(const c of draft.connections){
      const box=el("fieldset","ws-connection-card"),head=el("div","ws-mapping-head");
      box.append(el("legend","",msg("Connection")),head);
      const name=field(head,msg("Connection name"),c.label);
      head.append(button(msg("Remove connection"),()=>{draft.connections=draft.connections.filter(v=>v.id!==c.id);drawConnections();},"x"));
      const opts=kind=>draft.folders.filter(f=>f.kind===kind).map(f=>[f.id,f.label]);
      const flow=el("div","ws-mapping-flow");box.append(flow);
      const works=folderDropdown(flow,msg("Working folders"),opts("work"),c.works,updateConnections,"work");
      const workRatio=el("span","ws-ratio-work"),left=el("div","ws-mapping-arrow");left.append(icon("chevron-right"),workRatio);flow.append(left);
      const wiki=select(flow,msg("LLM wiki"),opts("wiki"),c.wiki);
      const sourceRatio=el("span","ws-ratio-source"),right=el("div","ws-mapping-arrow");right.append(icon("chevron-left"),sourceRatio);flow.append(right);
      const sources=folderDropdown(flow,msg("Sources & originals"),opts("source"),c.sources,updateConnections,"source");
      const mode=select(box,msg("Who writes to the wiki?"),[["eigen",msg("Only me")],["gemeinsam",msg("Multiple people")]],c.mode);
      const choice=select(box,msg("Working folder"),[],"");const choiceCaption=el("span");choice.parentElement.replaceChildren(choiceCaption,choice);
      choice.addEventListener("change",()=>{personalChoices.set(wiki.value,choice.value);updateConnections();});
      const reused=el("div","ws-reused-folders");box.append(reused);
      wiki.addEventListener("change",updateConnections);
      crows.push({c,name,wiki,works,sources,mode,workRatio,sourceRatio,reused,choice,choiceCaption});connections.append(box);
    }
    updateConnections();
  }
  mapping.append(button(msg("Add connection"),()=>{harvest();const kinds=k=>draft.folders.filter(f=>f.kind===k).map(f=>f.id);draft.connections.push({id:"c-"+global.crypto.randomUUID(),label:"My knowledge",wiki:kinds("wiki")[0]||"",works:kinds("work").slice(0,1),sources:kinds("source"),mode:"eigen"});drawConnections();}));
  if(first)d.content.append(el("p","ws-muted",msg("Setup creates folders and settings. The skill then initializes your wikis and reviews your sources. Originals are not changed.")));
  drawFolders();drawConnections();const message=el("p","ws-settings-message");message.setAttribute("role","status");d.foot.append(message);
  if(!state.root){
    for(const n of d.content.querySelectorAll('input,select,button'))n.disabled=true;
    for(const n of d.content.querySelectorAll('.ws-multi-select'))n.inert=true;
    global.I18n.setText(message,msg("Saved folder assignments. Open the project folder to check the latest settings and make changes."));
    d.foot.append(button(msg("Open project folder"),async()=>{d.dialog.close();await chooseProject();},null,"ws-primary"));return;
  }
  d.foot.append(button(msg("Save settings"),async()=>{
    try{harvest();for(const r of crows){r.c.label=r.name.value.trim();r.c.wiki=r.wiki.value;r.c.works=values(r.works);r.c.sources=values(r.sources);r.c.mode=r.mode.value;}draft.label=pname.value.trim();
      for(const c of draft.connections){const wiki=draft.folders.find(f=>f.id===c.wiki);for(const id of c.works){const w=draft.folders.find(f=>f.id===id);if(w&&wiki&&c.mode==="gemeinsam"&&w.path!==null&&w.path===wiki.path)throw global.I18n.error(msg("With multiple writers, the working folder and wiki must be separate."));}}
      await checkProjectInstance(state.root,await P().read(state.root));await validateFolderHandles(draft,chosenHandles);const saved=await P().save(state.root,draft,state.seen);for(const [id,h] of chosenHandles)await rememberHandle(folderBindingKey(id),h);for(const r of crows){try{global.localStorage.setItem(workKey(r.wiki.value),r.choice.value);}catch(_){}}state.seen={text:saved.text,mark:saved.mark};state.data=draft;state.connection=state.data.connections.some(c=>c.id===activeConnection.value)?activeConnection.value:state.data.connections[0]?.id||null;await rememberProject();await bindHandles();d.dialog.close();status(msg("Settings saved. The next skill run reads these connections."));
    }catch(error){global.I18n.setText(message,global.I18n.fromError(error));}
  },null,"ws-primary"));
  d.foot.append(button(msg("Open another project"),async()=>{d.dialog.close();await chooseProject(true);}));
}
// The library exposes wiki targets and sources. Technical working folders stay
// attached by stable ID and are never removed from disk, including on detach.
function syncOptions(wiki,epoch=syncEpoch){
  if(state.projectBlocked)return null;
  const workId=workingFolder(wiki.id),work=state.handles.get(workId),remote=state.handles.get(wiki.id),root=state.root;
  const f=state.data.folders.find(f=>f.id===workId);
  if(!work||!remote||!f?.writable)return null;
  return {work,remote,identity:JSON.stringify([state.data.id,wiki.id,wiki.path,workId,f.path]),canPublish:wiki.writable,
    alive:()=>epoch===syncEpoch&&root===state.root&&state.data.folders.some(f=>f.id===wiki.id)&&state.handles.get(workId)===work&&state.handles.get(wiki.id)===remote};
}
async function synchronizeWikis(){
  if(!state.root||!state.data||state.projectBlocked||!global.EditorSync||state.reviewBusy)return;
  await checkProjectInstance(state.root,await P().read(state.root));
  if(syncRunning)return syncRunning;
  const epoch=syncEpoch;
  syncRunning=(async()=>{
    for(const wiki of state.data.folders.filter(f=>f.kind==='wiki')){
      if(epoch!==syncEpoch)break;
      const options=syncOptions(wiki,epoch);if(!options)continue;
      try{
        if(await F().permissionState(options.work,'readwrite')!=='granted'){syncResults.set(wiki.id,{error:msg('Allow write access to edit this wiki.')});continue;}
        options.canPublish=options.canPublish&&await F().permissionState(options.remote,'readwrite')==='granted';
        const result=await global.EditorSync.run(options);syncResults.set(wiki.id,result);
      }catch(error){syncResults.set(wiki.id,{error:global.I18n.fromError(error)});}
    }
  })();
  try{await syncRunning;}finally{syncRunning=null;}
}
async function syncDetails(wiki){
  if(!state.root)return requestProjectAccess(()=>syncDetails(wiki));
  const d=modal(msg('Synchronization')),result=syncResults.get(wiki.id);
  if(result?.error)d.content.append(el('p','',result.error));
  if(result?.pending)d.content.append(el('p','ws-muted',msg('Some changes need write access or an author record. The agent can review them.')));
  for(const pending of result?.pending_details||[])if(pending.reason!=='author_chain_missing')d.content.append(el('p','ws-muted',pending.page+' · '+pending.reason));
  for(const conflict of [...result?.conflicts||[],...(result?.pending_details||[]).filter(p=>p.reason==='author_chain_missing')]){
    const card=el('article','ws-sync-conflict');card.append(el('h3','',conflict.page));
    reviewDiff(card,conflict.mine??'',conflict.theirs??'');
    card.append(el('p','ws-muted',msg('Your version is on the left, the wiki version on the right. Both are kept until you decide.')));
    let peer={author:''};try{const remote=state.handles.get(wiki.id);if(remote)peer=(await R().read(remote,conflict.page)).events.filter(e=>e.text===conflict.theirs).at(-1)||peer;}catch(_){/* Without a matching journal entry, attribution stays unknown. */}
    const reason=field(card,msg('Comment to {author}',{author:authorLabel(peer)}),'','textarea');reason.maxLength=10000;
    const message=el('p','ws-muted');card.append(message);
    async function decide(value){try{if(!await ensureAuthor())return;await checkProjectInstance(state.root,await P().read(state.root));const options=syncOptions(wiki);if(!options)throw global.I18n.error(msg('The folder was disconnected.'));const tab=state.active&&state.active.folder===workingFolder(wiki.id)&&state.active.name===conflict.page?state.active:null;if(tab)await keepLocalDraft(tab);await global.WikiCore.validateEdit(options.work,conflict.page,value,F(),R());await global.EditorSync.resolve(options,conflict,value,reviewAuthor,reason.value);await global.WikiCore.updateIndex(options.work,F(),R());await synchronizeWikis();await refresh();d.dialog.close();if(tab){await F().dropDraft(draftKey(tab),tab.name);state.tabs=state.tabs.filter(t=>t!==tab);state.active=null;await openWikiFile(wiki.id,tab.name);}}catch(error){global.I18n.setText(message,global.I18n.fromError(error));}}
    if(conflict.mine!==null)card.append(button(msg('Keep my version'),()=>decide(conflict.mine)));
    if(conflict.theirs!==null)card.append(button(msg('Take wiki version'),()=>decide(conflict.theirs)));
    card.append(button(msg('Create new version'),()=>{const edit=modal(msg('Create new version'));const text=field(edit.content,msg('Proposed text'),conflict.mine??conflict.theirs??'','textarea');edit.foot.append(button(msg('Save'),async()=>{edit.dialog.close();await decide(text.value);}));}));d.content.append(card);
  }
  if(!result)d.content.append(el('p','ws-muted',msg('Connect the wiki folder to synchronize.')));
  if(state.root&&!state.handles.has(wiki.id))d.foot.append(button(msg('Connect folder'),async()=>{await reconnect(wiki.id);d.dialog.close();}));
  else if(state.handles.has(wiki.id))d.foot.append(button(msg('Allow synchronization'),async()=>{await reconnect(wiki.id);d.dialog.close();}));
}
// One resumable access flow. Paths guide selection; only browser handles grant access.
let accessGuide=null;
function accessPath(folder){
 if(!folder)return entryLocation()?.project_root||'';
 if(folder.path!==null){const root=entryLocation()?.project_root;return root?root.replace(/[\\/]$/,'')+'/'+folder.path:folder.path;}
 try{return JSON.parse(at('llmwiki-entry-binding-locations')?.textContent||'{}')[folder.id]||expectedBindingName(folder)||folder.label;}catch(_){return folder.label;}
}
function accessPathHelp(parent,path){
 if(!path)return;
 if(!/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path)){parent.append(el('p','ws-project-path',path),el('p','ws-muted',msg('No full folder path is saved. Select the folder with this name.')));return;}
 const input=el('input','ws-access-path');input.value=path;input.readOnly=true;input.setAttribute('aria-label',msg('Folder path'));input.addEventListener('focus',()=>input.select());
 const copy=button(msg('Copy folder path'),async()=>{input.select();try{await global.navigator.clipboard.writeText(path);copy.textContent=msg('Copied');}catch(_){input.focus();input.select();}});
 const mac=/Mac|iPhone|iPad/.test(global.navigator.platform||'');
 parent.append(input,copy,el('p','ws-muted',msg(mac?'In the folder chooser press ⌘⇧G, paste this path and press Enter. Then select the folder.':'In the folder chooser focus the address field (Ctrl+L), paste this path and press Enter. Then select the folder.')));
}
function requiredAccessFolders(){
 const used=new Set((state.data?.connections||[]).flatMap(c=>[...c.works,c.wiki,...c.sources]));
 return (state.data?.folders||[]).filter(f=>used.has(f.id)).sort((a,b)=>['work','wiki','source'].indexOf(a.kind)-['work','wiki','source'].indexOf(b.kind));
}
async function nextAccess(){
 const root=state.root||state.accessRoot;
 if(!state.root||await F().permissionState(root,'readwrite')!=='granted')return {id:'project',label:msg('Project'),path:accessPath(),handle:root,mode:'readwrite'};
 for(const f of requiredAccessFolders()){
  const mode=f.kind==='source'?'read':f.writable?'readwrite':'read';let h=null;
  try{h=await folderHandle(f);}catch(_){/* Missing permission is handled by the current step. */}
  if(h&&await F().permissionState(h,mode)==='granted'){state.handles.set(f.id,h);continue;}
  return {id:f.id,folder:f,label:msg(f.kind==='source'?'Sources':f.kind==='work'?'Edit wiki':'Wiki synchronization')+' · '+f.label,path:accessPath(f),handle:h,mode};
 }
 return null;
}
function guidedAccess(){
 if(accessGuide)return accessGuide;
 let finish;const promise=new Promise(resolve=>{finish=resolve;});accessGuide=promise;
 const d=modal(msg('Allow access to your wiki project'));d.dialog.classList.add('ws-access-guide');let complete=false;
 d.dialog.addEventListener('close',()=>{accessGuide=null;finish(complete);},{once:true});
 async function render(){
  const step=await nextAccess();if(!d.dialog.open)return;
  if(!step){await bindHandles();complete=true;status(msg('All configured folders are connected.'));d.dialog.close();return;}
  d.content.replaceChildren();d.foot.replaceChildren();
  const all=requiredAccessFolders(),done=all.filter(f=>state.handles.has(f.id)).length+(state.root?1:0);
  d.content.append(el('p','ws-muted',msg('Folder access: {done} of {total}',{done,total:all.length+1})),el('h3','',step.label));
  d.content.append(el('p','',msg(step.handle?'This folder is already known. Confirm its access; no folder selection is needed.':'Select this folder once. Afterwards we continue here with any remaining permissions.')));
  if(step.handle)d.content.append(el('p','ws-project-path',step.path));else accessPathHelp(d.content,step.path);
  const failure=el('p','ws-muted');failure.setAttribute('role','status');d.content.append(failure);
  const allow=button(msg('Allow access'),()=>acquire(false),null,'ws-primary');d.foot.append(button(msg('Cancel'),()=>d.dialog.close()),allow);
  async function acquire(reselect){
   allow.disabled=true;
   try{
    // The prepared handle avoids IndexedDB awaits before the user-activation API.
    let h=step.handle;
    if(h&&!reselect){if(await F().grantPermission(h,step.mode)!=='granted')throw global.I18n.error(msg('Folder permission is missing.'));}
    else {h=await F().chooseFolder(step.mode,{purpose:step.folder?.kind||'project',startIn:step.handle||state.root||state.accessRoot||undefined});if(!h){allow.disabled=false;return;}}
    if(step.id==='project'){await loadProject(h,await P().read(h));state.accessRoot=h;}
    else {
     const expected=expectedBindingName(step.folder);if(expected&&h.name.normalize('NFC')!==expected.normalize('NFC'))throw global.I18n.error(msg('Expected folder: {name}',{name:expected}));
     if(step.folder.path===null)await rememberHandle(folderBindingKey(step.id),h);
     state.handles.set(step.id,h);
    }
    await render();
   }catch(error){if(error.name==='AbortError')failure.textContent=msg('Selection cancelled. Your confirmed folders are kept.');else global.I18n.setText(failure,global.I18n.fromError(error));allow.disabled=false;
    if(step.handle&&!d.foot.querySelector('.ws-access-reselect'))d.foot.append(button(msg('Select folder again'),()=>acquire(true),null,'ws-access-reselect'));
   }
  }
 }
 render().catch(error=>{d.content.append(el('p','',global.I18n.fromError(error)));});return promise;
}
function requestProjectAccess(then,selected=null){
 if(global.EditorHost)return (async()=>{await chooseProject();if(then)await then();})();
 return guidedAccess().then(async ready=>{if(ready&&then)await then();return ready;});
}

async function commitLibrary(draft,seen){
  await checkProjectInstance(state.root,await P().read(state.root));
  await validateFolderHandles(draft);
  const visible=new Set(draft.folders.filter(f=>f.kind==='source').map(f=>f.id));
  for(const c of draft.connections)for(const id of c.works)visible.add(id);
  const keep=tab=>visible.has(tab.folder)&&(!tab.wiki||draft.folders.some(f=>f.id===tab.wiki));
  await preserveDrafts(state.tabs.filter(tab=>!keep(tab)));
  const saved=await P().save(state.root,draft,seen);
  state.data=draft;state.seen={text:saved.text,mark:saved.mark};
  state.connection=draft.connections.some(c=>c.id===state.connection)?state.connection:draft.connections[0]?.id||null;
  state.tabs=state.tabs.filter(keep);
  if(!state.tabs.includes(state.active)){state.active=null;renderEmpty();}
  renderTabs();
  await bindHandles();await rememberProject();renderTabs();
}
async function validateFolderHandles(data,chosen=new Map()){
 const handles=new Map();for(const f of data.folders)try{handles.set(f.id,chosen.get(f.id)||await P().resolve(state.root,f,browserProjectKey(),recallHandle));}catch(_){}
 const overlap=async(a,b)=>a&&b&&(a.isSameEntry&&await a.isSameEntry(b)||a.resolve&&await a.resolve(b)!==null||b.resolve&&await b.resolve(a)!==null);
 for(const c of data.connections){for(const work of c.works)if(await overlap(handles.get(c.wiki),handles.get(work)))throw global.I18n.error(msg('The shared wiki and working folder must be separate.'));for(const source of c.sources)for(const id of [c.wiki,...c.works])if(await overlap(handles.get(source),handles.get(id)))throw global.I18n.error(msg('Sources must not be inside a wiki or working folder, or contain either.'));}
}
const detachedPath='.llmwiki/detached-folders.json';
function pendingDetachedKey(){return entryBinding().key+'/detached/'+encodeURIComponent(browserProjectKey());}
function readPendingDetached(){
  try{const entries=JSON.parse(global.localStorage.getItem(pendingDetachedKey())||'[]');state.pendingDetached=Array.isArray(entries)&&entries.length<=200?entries.filter(e=>e&&e.folder&&typeof e.folder.id==='string'&&Array.isArray(e.connections)):[];}
  catch(_){state.pendingDetached=[];}
}
function savePendingDetached(){
  try{global.localStorage.setItem(pendingDetachedKey(),JSON.stringify(state.pendingDetached));}
  catch(_){status(msg('Disconnected for this window. Browser storage is unavailable; the project settings have not changed.'));}
}
function removeConnection(data,id){
  data.folders=data.folders.filter(f=>f.id!==id);
  data.connections=data.connections.filter(c=>c.wiki!==id).map(c=>({...c,sources:c.sources.filter(v=>v!==id),...(c.default_source===id?{default_source:null}:{})}));
  return data;
}
function withoutPendingDetached(data){
  const draft=JSON.parse(JSON.stringify(data));
  for(const entry of state.pendingDetached)removeConnection(draft,entry.folder.id);
  return draft;
}
async function persistPendingDetached(){
  if(!state.root||!state.pendingDetached.length||await F().permissionState(state.root,'readwrite')!=='granted')return;
  const loaded=await P().read(state.root);await checkProjectInstance(state.root,loaded);
  const draft=loaded.data,archive=await detachedFolders();
  for(const entry of state.pendingDetached){
    const current=draft.folders.find(f=>f.id===entry.folder.id);if(!current)continue;
    if(current.path!==entry.folder.path||current.kind!==entry.folder.kind)throw global.I18n.error(msg('A folder assignment changed. Open settings before saving the pending disconnection.'));
    archive.data.entries=archive.data.entries.filter(e=>e.folder.id!==current.id);
    archive.data.entries.push({folder:current,connections:draft.connections.filter(c=>c.wiki===current.id||c.sources.includes(current.id))});
    removeConnection(draft,current.id);
  }
  const stored=await F().writeFile(state.root,detachedPath,JSON.stringify(archive.data),archive.seen);
  if(!stored.saved)throw global.I18n.error(msg('Settings were not saved. Reopen them: someone changed them or write permission is missing.'));
  const saved=await P().save(state.root,draft,loaded.seen);
  state.data=draft;state.seen={text:saved.text,mark:saved.mark};state.pendingDetached=[];savePendingDetached();
}
async function detachedFolders(){
  const seen=await F().peek(state.root,detachedPath);
  const data=seen?JSON.parse(seen.text):{format:'llmwiki-detached/1',project:state.data.id,entries:[]};
  if(data.format!=='llmwiki-detached/1'||data.project!==state.data.id||!Array.isArray(data.entries)||data.entries.length>200)throw global.I18n.error(msg('The synchronization record cannot be read.'));
  return {seen,data};
}
async function detachFolder(id){
  syncEpoch++;if(syncRunning)await syncRunning;
  const known=state.data?.folders.find(f=>f.id===id);if(!known)return;
  await preserveDrafts(state.tabs.filter(tab=>tab.folder===id||tab.wiki===id||known.kind==='wiki'&&workIds(id).includes(tab.folder)));
  const loaded=state.root?await P().read(state.root):null;if(loaded)await checkProjectInstance(state.root,loaded);
  if(!state.root||await F().permissionState(state.root,'readwrite')!=='granted'){
    collect();await state.draftWrites;
    state.pendingDetached=state.pendingDetached.filter(e=>e.folder.id!==id);
    state.pendingDetached.push({folder:known,connections:state.data.connections.filter(c=>c.wiki===id||c.sources.includes(id))});savePendingDetached();
    state.data=withoutPendingDetached(state.data);state.handles.delete(id);state.files.delete(id);
    const visible=new Set(state.data.folders.filter(f=>f.kind==='source').map(f=>f.id));for(const c of state.data.connections)for(const work of c.works)visible.add(work);
    state.tabs=state.tabs.filter(t=>visible.has(t.folder)&&(!t.wiki||state.data.folders.some(f=>f.id===t.wiki)));
    if(!state.tabs.includes(state.active)){state.active=null;renderEmpty();}
    renderTree();renderTabs();applyEditor();status(msg('Disconnected here. Allow project access in Settings to save this change for the skill. All files are kept.'));return;
  }
  const draft=loaded.data;
  const f=draft.folders.find(f=>f.id===id);if(!f)return;
  const archive=await detachedFolders();archive.data.entries=archive.data.entries.filter(e=>e.folder.id!==id);
  archive.data.entries.push({folder:f,connections:draft.connections.filter(c=>c.wiki===id||c.sources.includes(id))});
  const stored=await F().writeFile(state.root,detachedPath,JSON.stringify(archive.data),archive.seen);
  if(!stored.saved)throw global.I18n.error(msg('Settings were not saved. Reopen them: someone changed them or write permission is missing.'));
  removeConnection(draft,id);
  // No filesystem deletion, cache deletion or draft deletion belongs here.
  await commitLibrary(draft,loaded.seen);
  status(msg("Disconnected. All folders, files and drafts are kept."));
}
async function settings(first=false){
  const d=modal(msg("Settings"));d.dialog.classList.add('ws-library-settings');
  d.content.append(el('p','ws-muted',msg("Connect wikis and source folders. Your editable copies are managed automatically.")));
  editorSettings(d.content,first);
  d.content.append(button(msg(state.root?'Check folder access':'Allow project access'),()=>{d.dialog.close();requestProjectAccess();}));
  if(state.pendingDetached.length){const pending=el('section','ws-library-section');pending.append(el('p','ws-muted',msg('Disconnected here. Allow project access in Settings to save this change for the skill. All files are kept.')),button(msg('Save folder connections'),()=>{d.dialog.close();requestProjectAccess(async()=>{await persistPendingDetached();await bindHandles();await settings();});}));d.content.append(pending);}
  for(const kind of ['wiki','source']){
    const section=el('section','ws-library-section'),head=el('header','ws-library-head');
    head.append(el('h3','',msg(kind==='wiki'?'Wikis':'Sources')),button(msg(kind==='wiki'?'Add wiki':'Add sources'),async()=>{d.dialog.close();await addFolder(kind);},'plus'));section.append(head);
    for(const f of state.data?.folders.filter(f=>f.kind===kind)||[]){
      const card=el('article','ws-library-card'),row=el('div','ws-library-head');
      row.append(icon(f.icon||'folder'),el('strong','',f.label),button(msg('Disconnect'),async()=>{await detachFolder(f.id);d.dialog.close();await settings();},'x'));card.append(row);
      const rootIcon=select(card,msg('Root icon'),P().ROOT_ICONS.filter(v=>v!=='book').map(v=>[v,v]),f.icon||'folder');rootIcon.dataset.rootIcon=f.id;
      const saveChoice=async edit=>{const apply=async()=>{const loaded=await P().read(state.root);await checkProjectInstance(state.root,loaded);edit(loaded.data);await commitLibrary(loaded.data,loaded.seen);};if(!state.root||await F().permissionState(state.root,'readwrite')!=='granted'){d.dialog.close();requestProjectAccess(async()=>{await apply();await settings();});}else await apply();};
      rootIcon.addEventListener('change',async()=>{rootIcon.disabled=true;try{await saveChoice(data=>{data.folders.find(v=>v.id===f.id).icon=rootIcon.value;});}catch(error){report(error);}finally{rootIcon.disabled=false;}});
      if(kind==='wiki'){
        for(const c of state.data.connections.filter(c=>c.wiki===f.id)){
          const choices=c.sources.map(id=>state.data.folders.find(v=>v.id===id));const target=select(card,msg('Default source for attachments'),[['',msg('Select a source folder')],...choices.map(v=>[v.id,v.label])],Object.hasOwn(c,'default_source')?(c.default_source??''):(choices.length===1?choices[0].id:''));target.dataset.defaultSource=c.id;
          target.addEventListener('change',()=>saveChoice(data=>{data.connections.find(v=>v.id===c.id).default_source=target.value||null;}).catch(report));
        }
        const work=workingFolder(f.id);
        card.append(el('small','ws-muted',msg(state.handles.has(work)?'Ready to edit':'Connect this wiki to edit its files.')));
        
      }else{
        const uploads=el('label','ws-check'),allow=el('input');allow.type='checkbox';allow.checked=f.writable;uploads.append(allow,el('span','',msg('Allow adding new attachments (existing originals stay unchanged)')));card.append(uploads);allow.addEventListener('change',()=>saveChoice(data=>{const source=data.folders.find(v=>v.id===f.id);source.writable=allow.checked;if(allow.checked&&!source.writers.length)source.writers=[reviewAuthor||source.readers[0]];}).catch(report));
        
        const choices=state.data.folders.filter(f=>f.kind==='wiki');
        if(choices.length){
          card.append(el('small','ws-muted',msg('Use for these wikis')));
          for(const wiki of choices){const label=el('label','ws-check'),input=el('input');input.type='checkbox';input.checked=state.data.connections.some(c=>c.wiki===wiki.id&&c.sources.includes(f.id));label.append(input,el('span','',wiki.label));card.append(label);
            input.addEventListener('change',async()=>{const next=input.checked;input.disabled=true;try{
              const save=async()=>{
                const loaded=await P().read(state.root);await checkProjectInstance(state.root,loaded);
                if(!loaded.data.folders.some(v=>v.id===f.id)||!loaded.data.folders.some(v=>v.id===wiki.id))throw global.I18n.error(msg('The folder was disconnected.'));
                for(const c of loaded.data.connections.filter(c=>c.wiki===wiki.id)){c.sources=next?Array.from(new Set([...c.sources,f.id])):c.sources.filter(id=>id!==f.id);if(!c.sources.includes(c.default_source))c.default_source=null;}
                await commitLibrary(loaded.data,loaded.seen);
              };
              if(!state.root||await F().permissionState(state.root,'readwrite')!=='granted'){input.checked=!next;d.dialog.close();requestProjectAccess(async()=>{await save();await settings();});return;}
              await save();
            }catch(error){input.checked=!next;report(error);}finally{input.disabled=false;}});
          }
        }
      }
      section.append(card);
    }
    d.content.append(section);
  }
  d.content.append(el('p','ws-muted',msg('Disconnecting only removes the connection. Files and folders are never deleted.')));
  const details=el('details','ws-library-options');details.append(el('summary','',msg('Appearance and preferences')));appearanceSettings(details);authorSettings(details);global.I18n.languagePicker(details,'ws-settings-language');d.content.append(details);
  d.foot.append(button(msg('Edit folder connections'),()=>{d.dialog.close();if(!state.root)requestProjectAccess(()=>advancedSettings(first));else advancedSettings(first);}),button(msg('Preserved drafts'),()=>{d.dialog.close();draftRecovery().catch(report);}));
}
async function connectWiki(wiki){
  const work=workingFolder(wiki);
  if(!work){
    const ids=workIds(wiki),d=modal(msg('Choose your editable copy'));
    d.content.append(el('p','ws-muted',msg('Several existing copies are connected. Choose yours once; all others are kept.')));
    const choice=select(d.content,msg('Your copy'),ids.map(id=>{const f=state.data.folders.find(f=>f.id===id);return [id,f.label];}),ids[0]);
    d.foot.append(button(msg('Continue'),async()=>{global.localStorage.setItem(workKey(wiki),choice.value);d.dialog.close();await connectWiki(wiki);},null,'ws-primary'));return;
  }
  if(!state.root)return requestProjectAccess(()=>connectWiki(wiki));
  await reconnect(work);
}
async function addFolder(kind,selected=null){
  let chosen=selected;
  if(!chosen){try{chosen=await F().chooseFolder(kind==='source'?'read':'readwrite',{purpose:kind});}catch(error){if(error?.name==='AbortError')return;throw error;}}
  if(!chosen)return;
  if(state.root)await checkProjectInstance(state.root,await P().read(state.root));
  if(!state.root||await F().permissionState(state.root,'readwrite')!=='granted')return requestProjectAccess(()=>addFolder(kind,chosen),chosen);
  const root=state.root;
  const loaded=await P().read(root);await checkProjectInstance(root,loaded);const project=loaded.data||state.data;
  if(root!==state.root)throw global.I18n.error(msg('The project changed. Open this dialog again.'));
  const path=await P().relative(root,chosen);
  for(const f of project.folders){const h=state.handles.get(f.id);if((path!==null&&f.path===path)||(h&&chosen.isSameEntry&&await chosen.isSameEntry(h))){status(msg('This folder is already connected.'));return;}}
  // Reattaching the same physical folder restores its original working copy.
  const archive=await detachedFolders();
  for(const entry of archive.data.entries){
    const f=entry.folder;if(f.kind!==kind)continue;
    const old=await recallHandle(folderBindingKey(f.id));
    if(!(path!==null&&f.path===path)&&!(old&&chosen.isSameEntry&&await chosen.isSameEntry(old)))continue;
    const draft=JSON.parse(JSON.stringify(project));draft.folders.push(f);
    if(kind==='wiki')for(const c of entry.connections){
      if(!c.works.every(id=>draft.folders.some(f=>f.id===id)))throw global.I18n.error(msg('Connect this wiki to edit its files.'));
      draft.connections.push({...c,sources:c.sources.filter(id=>draft.folders.some(f=>f.id===id))});
    }else for(const c of draft.connections)if(entry.connections.some(prior=>prior.wiki===c.wiki))c.sources=Array.from(new Set([...c.sources,f.id]));
    await rememberHandle(folderBindingKey(f.id),chosen);await commitLibrary(draft,loaded.seen);return;
  }
  const wikis=project.folders.filter(f=>f.kind==='wiki');
  async function save(chosenWikis){
    await checkProjectInstance(root,await P().read(root));
    const draft=JSON.parse(JSON.stringify(project)),id=kind+'-'+global.crypto.randomUUID(),by=reviewAuthor||'Owner';
    draft.folders.push({id,label:chosen.name,kind,path,writable:kind!=='source',readers:[by],writers:kind==='source'?[]:[by]});
    if(kind==='wiki'){
      const work='work-'+global.crypto.randomUUID(),workPath='.llmwiki/work/'+id;
      draft.folders.push({id:work,label:chosen.name,kind:'work',path:workPath,writable:true,readers:[by],writers:[by]});
      draft.connections.push({id:'c-'+global.crypto.randomUUID(),label:chosen.name,wiki:id,works:[work],sources:[],mode:'gemeinsam'});
      P().validate(draft);
      let dir=root;for(const part of workPath.split('/'))dir=await dir.getDirectoryHandle(part,{create:true});
      await rememberHandle(folderBindingKey(work),dir);
    }else for(const c of draft.connections)if(chosenWikis.includes(c.wiki))c.sources.push(id);
    P().validate(draft);
    await rememberHandle(folderBindingKey(id),chosen);
    await commitLibrary(draft,loaded.seen);
    status(msg('Folder connected. The next skill run reads the updated settings.'));
  }
  if(kind==='source'&&wikis.length>1){
    const d=modal(msg('Use for these wikis'));d.content.append(el('p','',chosen.name));const inputs=[];
    for(const wiki of wikis){const label=el('label','ws-check'),input=el('input');input.type='checkbox';input.checked=wiki.id===selectedConnection()?.wiki;label.append(input,el('span','',wiki.label));d.content.append(label);inputs.push([wiki.id,input]);}
    const error=el('p','ws-muted');d.foot.append(error);
    const submit=button(msg('Connect folder'),async()=>{submit.disabled=true;try{await save(inputs.filter(([,i])=>i.checked).map(([id])=>id));d.dialog.close();}catch(e){global.I18n.setText(error,global.I18n.fromError(e));}finally{submit.disabled=false;}},null,'ws-primary');d.foot.append(submit);
  }else await save(wikis.map(f=>f.id));
}

async function searchAll(){
  const query=at("ws-search").value.trim(),root=at("ws-search-results");const run=++state.searchRun;root.replaceChildren();if(!query)return;
  let matches=0, unreadable=0, skipped=0;
  for(const f of visibleEntries()){
    const id=f.folder,dir=state.handles.get(id);if(!dir)continue;
    {
      if(run!==state.searchRun)return;
      if(!/\.(md|txt)$/i.test(f.name))continue;
      if(f.size>2000000){skipped+=1;continue;}
      try{const seen=await F().readFile(dir,f.name);if(typeof seen.text!=="string"){unreadable+=1;continue;}const hit=searchText(f.name,seen.text,query);if(!hit)continue;
        if(run!==state.searchRun)return;
        const b=button("",async()=>{await openFile(id,f.name,f.view);closeSearch();},null,"ws-search-hit");b.append(el("strong","",f.name),el("span","",hit.excerpt),el("small","",msg("{folder} · Line {line}",{folder:state.data.folders.find(v=>v.id===f.view).label,line:hit.line})));root.append(b);matches+=1;
        if(matches>=100){status(msg("100 results shown. Narrow your search."));return;}
      }catch(_){unreadable+=1;}
    }
  }
  status(msg("{count} results · {unreadable} unreadable files · {skipped} large files skipped",{count:matches,unreadable,skipped}));
}
function renderOutline(withBacklinks=true){
  const root=at("ws-outline");if(!root)return;root.replaceChildren();
  if(!state.active||state.active.viewer)return;
  for(const line of state.active.text.split(/\r?\n/)){const m=/^(#{1,6})\s+(.+)$/.exec(line);if(m){const b=button(m[2],()=>{setMode("live");const nodes=at("ws-editor").children;for(const n of nodes)if(n.textContent.trim()===line.trim()){n.scrollIntoView({block:"center"});break;}},null,"ws-outline-link");b.style.paddingLeft=(m[1].length*10)+"px";root.append(b);}}
  if(withBacklinks){clearTimeout(state.backlinkTimer);state.backlinkTimer=setTimeout(()=>backlinks().catch(report),150);}
}
async function backlinks(){
 if(state.graphOpen)return;
  const run=++state.backlinkRun;const tab=state.active,root=at("ws-backlinks");if(!tab||tab.viewer||!root)return;root.replaceChildren();
  if(tab.wiki&&global.WikiCore){const view=await knowledgeGraph();if(state.active!==tab||run!==state.backlinkRun)return;const incoming=[...new Set((view.core?.incoming.get(global.WikiCore.pageKey(tab.wiki,tab.name))??[]).filter(e=>e.valid).map(e=>e.source))];for(const key of incoming){const p=view.core.pages.get(key);root.append(button(p.head.title||p.path,()=>openWikiFile(p.wiki,p.path),null,'ws-backlink'));}if(!incoming.length)root.append(el('p','ws-muted',msg('No backlinks yet')));return;}
  let count=0;
  for(const f of state.files.get(tab.folder)||[]){
    if(state.active!==tab||run!==state.backlinkRun)return;if(f.name===tab.name||!f.name.endsWith(".md")||f.size>2000000)continue;
    try{const seen=await F().readFile(state.handles.get(tab.folder),f.name);const links=String(seen.text||"").matchAll(/\[\[([^\]]+)\]\]|\[[^\]]*\]\(([^)]+)\)/g);
      for(const match of links){let target=targetPath(f.name,match[1]||match[2]);if(target===tab.name||((match[1]||"").split("#")[0].split("|")[0]===tab.name.split("/").pop().replace(/\.md$/,""))){if(state.active!==tab||run!==state.backlinkRun)return;root.append(button(f.name.replace(/\.md$/,""),()=>openFile(tab.folder,f.name),null,"ws-backlink"));count+=1;break;}}
    }catch(_){/* Search exposes unreadable counts; backlinks show confirmed links only. */}
  }
  if(!count&&state.active===tab&&run===state.backlinkRun)root.append(el("p","ws-muted",msg("No backlinks yet")));
}
async function knowledgeGraph(){
 const wikis=state.data.folders.filter(f=>f.kind==='wiki'&&state.handles.has(workingFolder(f.id))),documents=[];
 for(const wiki of wikis){const dir=state.handles.get(workingFolder(wiki.id));for(const name of [...new Set(['schema/TYPES.md','.llmwiki/identity-aliases.json',...wikiEntries(wiki.id).filter(f=>f.name.endsWith('.md')).map(f=>f.name)])])try{const seen=await F().readFile(dir,name);if(typeof seen.text==='string')documents.push({wiki:wiki.id,path:name,text:seen.text});}catch(_){} }
 return global.WikiCore.fromDocuments(documents,wikis);
}
async function openOriginal(tab,resource){
 const allowed=state.data.connections.some(c=>c.wiki===tab.wiki&&c.sources.includes(resource.store));
 if(!allowed)throw global.I18n.error(msg('The folder was disconnected.'));
 return openFile(resource.store,resource.name);
}
async function followLink(tab,target){
 const resource=global.WikiCore.parseDocument(tab.text).head.resource;
 if(resource&&typeof resource.link==='string'){const match=/\[[^\]]*\]\(<?([^)>]+)>?\)/.exec(resource.link);if(match&&match[1]===target)return openOriginal(tab,resource);}

  if(tab.wiki&&global.WikiCore){const graph=await knowledgeGraph(),found=global.WikiCore.resolve(graph,tab.wiki,tab.name,target);if(!found)throw global.I18n.error(msg("Target not found: {target}",{target}));return openWikiFile(found.wiki,found.path);}
  const name=targetPath(tab.name,target);if(!name)throw global.I18n.error(msg("This link does not point to a local file."));
  const files=state.files.get(tab.folder)||[];const direct=files.find(f=>f.name===name);
  const matches=direct?[direct]:files.filter(f=>f.name.split("/").pop()===name);
  if(matches.length!==1)throw global.I18n.error(matches.length?msg("This link is ambiguous."):msg("Target not found: {target}",{target}));
  if(tab.wiki)await openWikiFile(tab.wiki,matches[0].name);
  else await openFile(tab.folder,matches[0].name);
}
/* Preview uses DOM text nodes, never HTML from a document. References and
   attachments resolve only inside the selected handle. Embeds are bounded. */
async function renderMarkdown(text,root,tab,depth,context={instance:state.instance,graph:null}){
  const idTargets=()=>context.graph??(context.graph=knowledgeGraph());
  root.replaceChildren();let body=global.WikiCore.parseDocument(text).body;
  const lines=body.split(/\r?\n/),footnotes=new Map(),references=[];let footFence=false;for(let i=0;i<lines.length;i++){if(/^\s*(```|~~~)/.test(lines[i]))footFence=!footFence;if(footFence)continue;const f=/^\[\^([^\]\s]+)\]:\s*(.*)$/.exec(lines[i]);if(f){let note=f[2];while(/^ {4}\S|^ {4}$/.test(lines[i+1]||''))note+='\n'+lines[++i].slice(4);footnotes.set(f[1],note);}}let fence=null,code=null,list=null,table=null,comment=false;
  function inline(text,parent){
    const re=/(!?)\[\[([^\]]+)\]\]|(!?)\[([^\]]*)\]\(([^)]+)\)|(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(~~[^~]+~~)|(==[^=]+==)|(<u>[^<>]*<\/u>)|(\$[^$\n]+\$)|(\[\^([^\]\s]+)\])/g;
    let at=0,m;
    while((m=re.exec(text))){parent.append(global.document.createTextNode(text.slice(at,m.index)));at=re.lastIndex;
      if(m[2]||m[5]){
        const target=m[2]||m[5],label=m[2]?m[2].split("|").pop():m[4],embed=m[1]||m[3];
        if(embed){const box=el("span","ws-embed",label);parent.append(box);embedTarget(tab,target,box,depth,context).catch(error=>{global.I18n.setText(box,global.I18n.fromError(error));});}
        else if(/^https?:/i.test(target)){const a=el("a","ws-inline-link",label);a.href=target;a.target="_blank";a.rel="noopener noreferrer";parent.append(a);}
        else{const b=button(label,()=>followLink(tab,target),null,"ws-inline-link");parent.append(b);if(tab.wiki&&global.WikiCore&&/^[0-9A-HJKMNP-TV-Z]{26}$/.test(label))idTargets().then(async view=>{if(context.instance!==state.instance||!b.isConnected||await F().permissionState(state.handles.get(tab.folder),'read')!=='granted')return;const p=global.WikiCore.resolve(view,tab.wiki,tab.name,target);if(p?.head.title)b.textContent=p.head.title;}).catch(()=>{});}
      }else if(m[11])parent.append(el('u','',m[11].slice(3,-4)));
      else if(m[12]){const formula=el('span');global.WikiCore.renderFormula(formula,m[12].slice(1,-1));parent.append(formula);}
      else if(m[13]){const id=m[14],number=references.includes(id)?references.indexOf(id)+1:references.push(id),sup=el('sup'),link=el('a','',String(number));link.setAttribute('role','doc-noteref');link.href='#footnote-'+encodeURIComponent(id);link.addEventListener('click',event=>{event.preventDefault();root.querySelector('[data-footnote="'+CSS.escape(id)+'"]')?.focus();});sup.append(link);parent.append(sup);}
      else{const v=m[6]||m[7]||m[8]||m[9]||m[10],tag=m[6]?"code":m[7]?"strong":m[8]?"em":m[9]?"del":"mark",cut=m[7]||m[9]||m[10]?2:1;parent.append(el(tag,"",v.slice(cut,-cut)));}
    }parent.append(global.document.createTextNode(text.slice(at)));
  }
  for(let i=0;i<lines.length;i++){
    let line=lines[i];const fm=/^\s*(```+|~~~+)/.exec(line);
    if(fm){if(fence){fence=null;code=null;}else{fence=fm[1][0];const pre=el("pre");code=el("code");pre.append(code);root.append(pre);}continue;}
    if(fence){code.append(global.document.createTextNode(line+"\n"));continue;}
    if(comment){if(line.includes('-->')){comment=false;line=line.slice(line.indexOf('-->')+3);}else continue;}
    line=line.replace(/<!--.*?-->/g,'');if(line.includes('<!--')){comment=true;line=line.slice(0,line.indexOf('<!--'));}
    const callout=/^>\s*\[!([^\]]+)\]([-+]?)\s*(.*)$/.exec(line);
    if(callout){const box=el('details','ws-callout'),summary=el('summary','',callout[3]||callout[1]),content=el('div');box.open=callout[2]!=='-';box.dataset.callout=callout[1];box.append(summary,content);root.append(box);const quoted=[];while(i+1<lines.length&&/^>/.test(lines[i+1]))quoted.push(lines[++i].replace(/^> ?/,''));await renderMarkdown(quoted.join('\n'),content,tab,depth,context);list=null;table=null;continue;}
    if(/^\[\^([^\]\s]+)\]:/.test(line)){while(/^ {4}/.test(lines[i+1]||''))i++;continue;}
    if(line.trim().startsWith('$$')){let formula=line.trim().slice(2);if(formula.endsWith('$$'))formula=formula.slice(0,-2);else{while(i+1<lines.length&&!lines[i+1].trim().endsWith('$$'))formula+='\n'+lines[++i];if(i+1<lines.length)formula+='\n'+lines[++i].replace(/\$\$\s*$/,'');}const box=el('div');global.WikiCore.renderFormula(box,formula,true);root.append(box);list=null;table=null;continue;}
    if(!line.trim()){list=null;table=null;continue;}
    if(line.includes("|")&&((lines[i+1]||"").match(/^\s*\|?\s*:?-{3,}/)||table)){
      if(!table){table=el("table");root.append(table);const row=el("tr");for(const cell of line.replace(/^\||\|$/g,"").split("|")){const th=el("th");inline(cell.trim(),th);row.append(th);}table.append(row);i+=1;}
      else{const row=el("tr");for(const cell of line.replace(/^\||\|$/g,"").split("|")){const td=el("td");inline(cell.trim(),td);row.append(td);}table.append(row);}continue;
    }
    let m=/^(#{1,6})\s+(.+)$/.exec(line);
    if(m){const h=el("h"+m[1].length);inline(m[2],h);root.append(h);list=null;continue;}
    if(/^\s*(---+|\*\*\*+)\s*$/.test(line)){root.append(el("hr"));continue;}
    m=/^\s*(?:[-*+] |\d+\. )(.*)$/.exec(line);
    if(m){if(!list){list=el(/^\s*\d/.test(line)?"ol":"ul");root.append(list);}const li=el("li"),task=/^\[([ xX])\]\s*(.*)$/.exec(m[1]);if(task){const c=el("input");c.type="checkbox";c.checked=task[1]!==" ";c.disabled=true;li.append(c);inline(task[2],li);}else inline(m[1],li);list.append(li);continue;}
    list=null;const node=el(line.startsWith(">")?"blockquote":"p");inline(line.replace(/^>\s?/ ,""),node);root.append(node);
  }
  if(footnotes.size){const section=el('section','ws-footnotes'),list=el('ol');section.setAttribute('role','doc-endnotes');section.append(el('h3','',msg('Footnotes')),list);for(const id of [...new Set([...references,...footnotes.keys()])])if(footnotes.has(id)){const item=el('li');item.dataset.footnote=id;item.tabIndex=-1;inline(footnotes.get(id),item);list.append(item);}root.append(section);}
}
async function embedTarget(tab,target,box,depth,context){
  if(depth>=2){global.I18n.setText(box,msg("Embedding depth reached: {target}",{target}));return;}
  const path=targetPath(tab.name,target);if(!path)throw global.I18n.error(msg("Only local embeds are displayed."));
  const files=[...(state.files.get(tab.folder)||[]),...(assetFiles.get(tab.folder)||[])];const resolved=global.WikiCore.resolveAsset(tab.name,target,files.map(f=>f.name));const match=files.find(f=>f.name===resolved);
  if(!match)throw global.I18n.error(msg("Embed not found: {target}",{target}));
  if(match.size>5000000)throw global.I18n.error(msg("Embed exceeds 5 MB: {target}",{target}));
  const dir=state.handles.get(tab.folder);
  if(/\.(png|jpe?g|gif|webp|avif)$/i.test(match.name)){
    let h=dir;const parts=match.name.split("/");for(const part of parts.slice(0,-1))h=await h.getDirectoryHandle(part);const file=await(await h.getFileHandle(parts[parts.length-1])).getFile();const url=URL.createObjectURL(file),img=el("img");img.alt=target;img.onload=()=>URL.revokeObjectURL(url);img.onerror=()=>URL.revokeObjectURL(url);img.src=url;box.replaceChildren(img);
  }else if(match.name.endsWith(".md")){const seen=await F().readFile(dir,match.name);await renderMarkdown(seen.text,box,{folder:tab.folder,wiki:tab.wiki,name:match.name},depth+1,context);}
  else{global.I18n.setText(box,msg("Original: {name}",{name:match.name}));}
}
function renderLiveAssets(){
 const tab=state.active;if(!tab||state.mode!=='live')return;
 const lines=Array.from(at('ws-editor').children);let fence=null,comment=false;
 for(const line of lines){line.classList.remove('ws-live-formula','ws-live-formula-editing');line.querySelector('[data-writing-decoration="formula-block"]')?.remove();}
 for(let i=0;i<lines.length;i++){
  const line=lines[i],raw=global.writingRawText(line),marker=/^ {0,3}(`{3,}|~{3,})/.exec(raw);
  line.classList.remove('ws-hidden-markup','ws-live-callout');
  if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence=null;continue;}if(fence)continue;
  if(comment||/^\s*<!--/.test(raw)){line.classList.add('ws-hidden-markup');comment=!raw.includes('-->');continue;}
  if(/^\s*\$\$\s*$/.test(raw)){
   let end=i+1;while(end<lines.length&&!/^\s*\$\$\s*$/.test(global.writingRawText(lines[end])))end++;
   if(end<lines.length){const group=lines.slice(i,end+1),formula=group.slice(1,-1).map(global.writingRawText).join('\n'),editing=group.some(n=>n.classList.contains('aktiv')),box=el('span');box.setAttribute('data-writing-decoration','formula-block');box.contentEditable='false';line.append(box);global.WikiCore.renderFormula(box,formula,true);
    // Keep the raw lines and their boxes intact, even when the whole formula
    // is active. A decoration never becomes part of the saved buffer.
    const height=box.getBoundingClientRect().height;group.forEach(n=>{n.classList.add('ws-live-formula');n.classList.toggle('ws-live-formula-editing',editing);});line.style.minHeight=Math.max(parseFloat(getComputedStyle(line).lineHeight)||0,height+4)+'px';i=end;continue;
   }
  }
  if(/^>\s*\[!(?:relation-in|source)\]-/.test(raw)){
   const group=[raw];let j=i+1;for(;j<lines.length&&/^>/.test(global.writingRawText(lines[j]));j++){group.push(global.writingRawText(lines[j]));lines[j].classList.add('ws-hidden-markup');}
   const text=group.join('\n');line.classList.add('ws-live-callout');let box=line.querySelector('[data-writing-decoration="callout"]');
   if(!box||box.dataset.markdown!==text){box?.remove();box=el('div');box.setAttribute('data-writing-decoration','callout');box.contentEditable='false';box.dataset.markdown=text;line.append(box);renderMarkdown(text,box,tab,0).catch(report);}i=j-1;
  }else line.querySelector('[data-writing-decoration="callout"]')?.remove();
 }

 for(const line of at('ws-editor').children){
  const parts=Array.from(line.children);for(let index=0;index<parts.length;index++){
   if(!parts[index].matches('.stueck.math'))continue;const group=[parts[index]];while(parts[index+1]?.matches('.stueck.math'))group.push(parts[++index]);
   const raw=group.map(n=>n.textContent).join(''),display=raw.startsWith('$$'),cut=display?2:1;if(!raw.startsWith('$')||!raw.endsWith('$'))continue;
   const last=group.at(-1);let box=last.nextElementSibling;if(box?.getAttribute('data-writing-decoration')!=='formula'){box=el('span');box.setAttribute('data-writing-decoration','formula');box.contentEditable='false';last.after(box);}
   if(box.dataset.formula!==raw){box.dataset.formula=raw;global.WikiCore.renderFormula(box,raw.slice(cut,-cut),display);}
   group.forEach(n=>n.classList.add('ws-formula-source'));box.style.display='inline-block';line.style.minHeight=Math.max(parseFloat(getComputedStyle(line).lineHeight)||0,box.getBoundingClientRect().height+4)+'px';box.style.removeProperty('display');
  }
 }
 for(const line of at('ws-editor').children){
  if(line.querySelector('.ws-live-asset'))continue;
  const re=/!\[\[([^\]]+)\]\]|!\[[^\]]*\]\(([^)]+)\)/g;
  for(const match of line.textContent.matchAll(re)){
   const target=match[1]||match[2];if(!/\.(png|jpe?g|gif|webp|avif)(?:[|#].*)?$/i.test(target))continue;
   const box=el('span','ws-live-asset');box.setAttribute('data-writing-decoration','asset');box.contentEditable='false';box.setAttribute('aria-label',target);line.append(box);
   embedTarget(tab,target,box,0).catch(error=>{box.title=global.I18n.fromError(error);box.classList.add('ws-asset-unavailable');});
  }
 }
}
async function attachImages(files,span){
 const tab=state.active;if(!tab||state.mode==='read'||!currentFolder().writable)return;
 const dir=state.handles.get(tab.folder),store=global.WikiCore.browserStore(dir,F(),R()),folder=await global.WikiCore.assetFolder(store);let links=[];
 for(const file of files){
  if(file.size>5000000)throw new Error('Bilder dürfen höchstens 5 MB groß sein.');
  const bytes=new Uint8Array(await file.arrayBuffer()),extension=global.WikiCore.imageType(bytes);if(!extension)throw new Error('Bitte ein PNG-, JPEG-, GIF-, WebP- oder AVIF-Bild auswählen.');
  const sha256=await store.services.hash(bytes),name=global.WikiCore.assetName({title:'Bild',sha256,date:new Date().toISOString().slice(0,10),extension}),path=folder+'/'+name;
  const prior=await store.read(path,{binary:true});if(prior&&prior.sha256!==sha256)throw new Error('Der Bildname ist bereits mit anderem Inhalt belegt.');if(!prior)await store.write(path,bytes,{expected:null});
  links.push('!'+global.WikiCore.markdownLink(tab.name,path,'Bild'));
 }
 if(state.active!==tab)throw new Error('Die Notiz wurde gewechselt. Das Bild bleibt gespeichert und kann erneut eingebettet werden.');
 assetFiles.set(tab.folder,await F().listFolder(dir,undefined,{visible:(p,k)=>k==='directory'||/\.(png|jpe?g|gif|webp|avif)$/i.test(p)}));
 insertEditorText(links.join('\n')+'\n',span);renderLiveAssets();
 status('Bild eingefügt. Der nächste Maintain-Lauf liest den Inhalt und vergibt einen beschreibenden Namen.');
}
function editorUndo(redo=false){
 if(!state.active||state.mode==='read')return;
 if(state.mode==='live'){redo?state.sheet.redo():state.sheet.undo();return;}
 const tab=state.active,stack=redo?tab.sourceRedo:tab.sourceUndo;if(!stack?.length)return;
 (redo?(tab.sourceUndo||=[]):(tab.sourceRedo||=[])).push(tab.text);state.historyReplay=true;
 try{at('ws-source').value=stack.pop();changed(at('ws-source').value);at('ws-source').focus();}finally{state.historyReplay=false;}
}
function findDialog(){
 if(!state.active||state.active.viewer)return;const mode=state.mode,d=modal(msg('Find and replace')),q=field(d.content,msg('Search'),''),editable=mode!=='read'&&currentFolder().writable,r=editable?field(d.content,msg('Replace with'),''):null;
 const message=el('p');d.content.append(message);let index=-1;
 d.foot.append(button(msg('Next match'),()=>{
  const node=at(mode==='source'?'ws-source':mode==='read'?'ws-preview':'ws-editor'),text=mode==='source'?node.value:mode==='live'?state.sheet.value:node.textContent,needle=q.value;
  if(!needle)return;const matches=[];let offset=0;while((offset=text.indexOf(needle,offset))>=0){matches.push(offset);offset+=needle.length;}
  if(!matches.length){global.I18n.setText(message,msg('No matches'));return;}index=(index+1)%matches.length;const start=matches[index];
  if(mode==='source')node.setSelectionRange(start,start+needle.length);
  else if(mode==='live')state.sheet.show({from:start,to:start+needle.length});
  else {const walker=global.document.createTreeWalker(node,global.NodeFilter.SHOW_TEXT),range=global.document.createRange();let total=0,first=false,current;while((current=walker.nextNode())){const end=total+current.textContent.length;if(!first&&end>=start){range.setStart(current,start-total);first=true;}if(first&&end>=start+needle.length){range.setEnd(current,start+needle.length-total);break;}total=end;}if(first){const selection=global.getSelection();selection.removeAllRanges();selection.addRange(range);range.startContainer.parentElement?.scrollIntoView({block:'center'});}}
  global.I18n.setText(message,msg('{current} of {total}',{current:index+1,total:matches.length}));
 }));
 if(editable)d.foot.append(button(msg('Replace all'),()=>{if(!q.value)return;if(mode==='live')state.sheet.replaceAll(q.value,r.value,true);else{const n=at('ws-source');n.value=n.value.split(q.value).join(r.value);changed(n.value);}collect();global.I18n.setText(message,msg('Replaced. Save to write the changes to the file.'));}));q.focus();
}
function drawCompletions(){
  const root=at("ws-completions");if(!root)return;root.replaceChildren();
  if(!state.active||state.mode!=="live"||global.document.activeElement!==at("ws-editor"))return;
  const open=state.sheet.typed();if(!open)return;
  const names=(state.files.get(state.active.folder)||[]).filter(f=>f.name.endsWith(".md")).map(f=>f.name.slice(0,-3)).sort();
  for(const name of global.writingOffers(names,open.said,8)){
    const b=button(name,()=>{state.sheet.complete(name);drawCompletions();},null,"ws-target");
    b.addEventListener("mousedown",e=>e.preventDefault());root.append(b);
  }
}
function toggleTask(event){
  const mark=event.target.closest(".zeichen.task");if(!mark||!state.active||!currentFolder().writable)return;
  event.preventDefault();collect();
  const line=mark.closest(".zeile"),index=Array.from(at("ws-editor").children).indexOf(line);
  const lines=state.sheet.value.split("\n"),offset=lines.slice(0,index).reduce((n,t)=>n+t.length+1,0);
  const match=/^\s*[-*+] \[([ xX])\]/.exec(lines[index]||"");if(!match)return;
  const position=offset+match[0].lastIndexOf("[")+1;
  state.sheet.replace({from:position,to:position+1},match[1]===" "?"x":" ");
}
function liveLink(event){
  if(!(event.ctrlKey||event.metaKey)||!state.active)return;
  const piece=event.target.closest(".wikilink,.link,.embed");if(!piece)return;
  const line=piece.closest(".zeile");if(!line)return;
  const spans=Array.from(line.children),index=spans.indexOf(piece);let begin=index,end=index;
  const kind=piece.classList.contains("wikilink")?"wikilink":piece.classList.contains("embed")?"embed":"link";
  while(begin>0&&spans[begin-1].classList.contains(kind))begin--;
  while(end+1<spans.length&&spans[end+1].classList.contains(kind))end++;
  const text=spans.slice(begin,end+1).map(n=>n.textContent).join("");
  const match=/\[\[([^\]]+)\]\]|\[[^\]]*\]\(([^)]+)\)/.exec(text);
  if(match){event.preventDefault();followLink(state.active,match[1]||match[2]).catch(report);}
}
function applyForm(form,span=null){
 if(!state.active||state.mode==='read'||!currentFolder().writable)return;
 if(state.mode==='source'){const source=at('ws-source'),done=global.writingSet(source.value,span?.from??source.selectionStart,span?.to??source.selectionEnd,form);source.value=done.text;source.focus();source.setSelectionRange(done.from,done.to);changed(source.value);}
 else{state.sheet.apply(form,span);collect();}
}
function toolbarState(){
 if(!state.active||state.mode==='read'||!state.sheet)return;const node=at(state.mode==='source'?'ws-source':'ws-editor');if(global.document.activeElement!==node)return;
 const text=state.mode==='source'?node.value:state.sheet.value,span=state.mode==='source'?{from:node.selectionStart,to:node.selectionEnd}:global.writingSpan(node);if(!span)return;
 let offset=0,forms=null;for(const line of global.marksOf(text)){for(const piece of line.segments){const end=offset+piece.text.length;if(end>span.from&&offset<Math.max(span.to,span.from+1)){const kinds=new Set(piece.kind.split(' '));forms=forms===null?kinds:new Set([...forms].filter(k=>kinds.has(k)));}offset=end;}offset+=line.ending.length;}
 for(const b of global.document.querySelectorAll('[data-format]'))if(!['link','image','table','rule'].includes(b.dataset.format))b.setAttribute('aria-pressed',String(forms?.has(b.dataset.format)||false));
}
function insertEditorText(text,span){
 if(state.mode==='read')return;
 if(state.mode==='source'){const node=at('ws-source'),where=span||{from:node.selectionStart,to:node.selectionEnd};node.setRangeText(text,where.from,where.to,'end');node.focus();changed(node.value);}
 else state.sheet.replace(span||global.writingSpan(at('ws-editor')),text);
}
async function relationshipDialog(){
 if(!state.active?.wiki||state.mode==='read'||!currentFolder().writable)return;collect();const tab=state.active,original=tab.text,view=await knowledgeGraph();if(state.active!==tab||tab.text!==original)return;
 const d=modal(msg('Relationship')),direction=select(d.content,msg('Direction'),[['out',msg('Starts from this note')],['in',msg('Points to this note')]],'out'),type=select(d.content,msg('Relationship type'),[],''),target=select(d.content,msg('Target note'),[],''),reason=field(d.content,msg('Reason'),'','textarea'),hint=el('p','ws-muted'),error=el('p');error.setAttribute('role','alert');d.content.append(hint,error);
 const labels={references:'Refers to',refines:'Refines',contradicts:'Contradicts',superseded_by:'Is superseded by',part_of:'Is part of',decides:'Decides',learned_from:'Learned from'};let options=[];
 const fill=(node,values)=>{const selected=node.value;node.replaceChildren();for(const [value,label]of values){const o=el('option','',label);o.value=value;node.append(o);}if(values.some(v=>v[0]===selected))node.value=selected;};
 function targets(){fill(target,options.filter(o=>o.type===type.value).map(o=>[JSON.stringify([o.wiki,o.page]),(state.data.folders.find(w=>w.id===o.wiki)?.label||o.wiki)+' / '+o.title+' · '+o.page]));}
 function choices(){options=global.WikiCore.relationshipOptions(view,{wiki:tab.wiki,page:tab.name,text:original,direction:direction.value});fill(type,[...new Set(options.map(o=>o.type))].map(t=>[t,labels[t]?msg(labels[t]):t]));targets();global.I18n.setText(hint,msg(direction.value==='in'?'The relationship is added to the note it starts from. That note opens for editing.':'The relationship is added to this draft and saved with your other changes.'));}
 direction.addEventListener('change',choices);type.addEventListener('change',targets);choices();
 d.foot.append(button(msg('Insert'),async()=>{try{
  if(state.active!==tab||tab.text!==original)throw global.I18n.error(msg('The note changed while the dialog was open. Reopen the dialog.'));
  if(!target.value)return;const [targetWiki,targetPage]=JSON.parse(target.value),draft=global.WikiCore.relationshipDraft(view,{wiki:tab.wiki,page:tab.name,text:original,direction:direction.value,type:type.value,targetWiki,targetPage,reason:reason.value});
  const folder=workingFolder(draft.wiki),dir=state.handles.get(folder);if(!dir||await F().permissionState(dir,'readwrite')!=='granted')throw global.I18n.error(msg('The folder was disconnected.'));
  await global.WikiCore.validateEdit(dir,draft.page,draft.text,F(),R());if(state.active!==tab||tab.text!==original)throw global.I18n.error(msg('The note changed while the dialog was open. Reopen the dialog.'));
  if(draft.wiki!==tab.wiki||draft.page!==tab.name){await openWikiFile(draft.wiki,draft.page);if(state.active?.text!==draft.before)throw global.I18n.error(msg('The note changed while the dialog was open. Reopen the dialog.'));}
  d.dialog.close();if(state.mode==='source'){at('ws-source').value=draft.text;changed(draft.text);at('ws-source').focus();}
  else{const parsed=global.WikiCore.parseDocument(draft.text),prior=global.WikiCore.parseDocument(state.active.text);(state.active.relationshipHistory||=[]).push({before:prior.body,after:parsed.body,relatedBefore:prior.head.related??[],relatedAfter:parsed.head.related});state.editorPrefix=draft.text.slice(0,parsed.offset);state.sheet.replace({from:0,to:state.sheet.value.length},parsed.body);collect();}
  renderProperties();
 }catch(e){global.I18n.setText(error,global.I18n.fromError(e));}}));reason.focus();
}
function insertFootnote(){
 if(!state.active||state.mode==='read'||!currentFolder().writable)return;const tab=state.active,original=tab.text,mode=state.mode,span=mode==='source'?{from:at('ws-source').selectionStart,to:at('ws-source').selectionEnd}:global.writingSpan(at('ws-editor'));
 const d=modal(msg('Footnote')),text=field(d.content,msg('Footnote text'),'','textarea');
 d.foot.append(button(msg('Insert'),()=>{if(!text.value.trim())return;if(state.active!==tab||tab.text!==original||state.mode!==mode)throw global.I18n.error(msg('The note changed while the dialog was open. Reopen the dialog.'));
  let id=1;while(tab.text.includes('[^'+id+']'))id++;const marker='[^'+id+']',definition='\n\n'+marker+': '+text.value.trim().replace(/\n/g,'\n    ')+'\n';d.dialog.close();
  // Preserve selected prose; append its reference and a unique definition in one undo step.
  const value=mode==='source'?at('ws-source').value:state.sheet.value,changedText=value.slice(0,span.to)+marker+value.slice(span.to)+definition;
  if(mode==='source'){at('ws-source').value=changedText;changed(changedText);at('ws-source').focus();at('ws-source').setSelectionRange(span.to+marker.length,span.to+marker.length);}
  else state.sheet.replace({from:0,to:value.length},changedText);
 }));text.focus();
}
function insertLink(image=false){
 if(!state.active||state.mode==='read')return;const tab=state.active;
 const span=state.mode==='source'?{from:at('ws-source').selectionStart,to:at('ws-source').selectionEnd}:global.writingSpan(at('ws-editor'));
 const choices=image?(assetFiles.get(tab.folder)||[]).filter(e=>!e.kind||e.kind==='file').map(e=>[JSON.stringify([tab.wiki,e.name]),e.name]):state.data.folders.filter(w=>w.kind==='wiki'&&state.handles.has(workingFolder(w.id))).flatMap(w=>wikiEntries(w.id).filter(e=>(!e.kind||e.kind==='file')&&e.name.endsWith('.md')).map(e=>[JSON.stringify([w.id,e.name]),w.label+' / '+e.name]));
 const d=modal(msg(image?'Image / attachment':'Link')),target=select(d.content,msg('File'),choices,''),label=field(d.content,msg('Label'),'');
 if(image){const upload=el('input');upload.type='file';upload.accept='image/png,image/jpeg,image/gif,image/webp,image/avif';upload.multiple=true;upload.setAttribute('aria-label','Bilder hinzufügen');d.content.append(upload);upload.addEventListener('change',()=>{const files=Array.from(upload.files);d.dialog.close();attachImages(files,span).catch(report);});}
 const scopeHint=el('p','ws-muted');d.content.append(scopeHint);function explainScope(){const wiki=target.value?JSON.parse(target.value)[0]:null,from=state.data.folders.find(w=>w.id===tab.wiki),to=state.data.folders.find(w=>w.id===wiki);global.I18n.setText(scopeHint,!image&&wiki!==tab.wiki&&from&&to&&(from.path===null||to.path===null)?msg('This link uses the connected wiki name. Separate Obsidian vaults need a matching integration to open it.'):'');}target.addEventListener('change',explainScope);explainScope();
 d.foot.append(button(msg('Insert'),()=>{if(!target.value)return;const [wiki,path]=JSON.parse(target.value),caption=label.value||path.split('/').at(-1);let written;
 if(wiki===tab.wiki)written=global.WikiCore.markdownLink(tab.name,path,caption);
 else{const from=state.data.folders.find(w=>w.id===tab.wiki),to=state.data.folders.find(w=>w.id===wiki);written=from.path!==null&&to.path!==null?global.WikiCore.markdownLink(from.path+'/'+tab.name,to.path+'/'+path,caption):global.WikiCore.markdownLink('',wiki+'/'+path,caption).replace('(./','(');}
 d.dialog.close();insertEditorText((image?'!':'')+written,span);}));
}
const R=()=>global.WikiReviews;
let reviewAuthor='';try{reviewAuthor=global.localStorage.getItem('llmwiki.ui.author')||'';}catch(_){}
function checkpointKey(tab){return R().localKey(tab.projectId+'/'+(state.instance||'legacy'),tab.folder,tab.folderPath,reviewAuthor);}
async function initializeReview(tab,seen){
  tab.projectId=tab.projectId||state.data.id;tab.root=tab.root||state.root;
  const remembered=await R().checkpoint(checkpointKey(tab),tab.name);
  if(remembered){tab.checkpoint=remembered;tab.pendingRecord=remembered.pendingRecord||null;return;}
  const journal=await R().read(tab.dir,tab.name);
  tab.checkpoint={text:seen.text,seen:Array.from(new Set([...(tab.checkpoint?tab.checkpoint.seen:[]),...journal.events.filter(e=>['change','accept'].includes(e.kind)).map(e=>e.id)])),at:new Date().toISOString(),drafts:[]};
  await R().checkpoint(checkpointKey(tab),tab.name,tab.checkpoint);
}
async function storeCheckpoint(tab){await R().checkpoint(checkpointKey(tab),tab.name,tab.checkpoint);}
async function setAuthor(value){
  value=value.trim().normalize('NFC');
  if(!value||value.length>120||/[\r\n\x00-\x1f]/.test(value))throw global.I18n.error(msg('Enter your author name.'));
  const before=reviewAuthor;reviewAuthor=value;
  try{global.localStorage.setItem('llmwiki.ui.author',value);}catch(_){status(msg('Your author name is available for this session only.'));}
  for(const tab of state.tabs){if(tab.viewer)continue;if(!before&&tab.checkpoint)await storeCheckpoint(tab);else await initializeReview(tab,{text:tab.origin});}
}
function authorSettings(parent){
  parent.append(el('h3','',msg('Collaboration')));
  const name=field(parent,msg('Your author name'),reviewAuthor);name.maxLength=120;name.id='ws-author-name';name.disabled=state.reviewBusy;
  parent.append(el('p','ws-muted',msg('Use the same author name on your devices. It is attached to your changes and responses; it is not a sign-in.')));
  name.addEventListener('change',()=>setAuthor(name.value).then(()=>pollReviews()).catch(report));
}
async function ensureAuthor(){
  if(reviewAuthor)return true;
  const d=modal(msg('Your author name')),name=field(d.content,msg('Your author name'),'');name.maxLength=120;
  d.content.append(el('p','ws-muted',msg('Your name is shown with changes and responses.')));
  const error=el('p','ws-muted');d.content.append(error);
  let accepted=false;
  const closed=new Promise(resolve=>d.dialog.addEventListener('close',()=>resolve(accepted),{once:true}));
  d.foot.append(button(msg('Use author name'),async()=>{try{await setAuthor(name.value);accepted=true;d.dialog.close();}catch(e){global.I18n.setText(error,global.I18n.fromError(e));}}));name.focus();return closed;
}
async function writableTab(tab){
  if(state.projectBlocked)throw global.I18n.error(msg('This start file belongs to an earlier setup. Open the current LLM-Wiki.html in your project folder.'));
  if(tab.root!==state.root||tab.projectId!==state.data.id)throw global.I18n.error(msg('The folder connection or write permission changed. Reopen the project.'));
  const configured=state.data.folders.find(f=>f.id===tab.folder),dir=state.handles.get(tab.folder);
  const latest=await P().read(tab.root);await checkProjectInstance(tab.root,latest);const bound=latest.data&&latest.data.folders.find(f=>f.id===tab.folder);
  if(!configured||!bound||!bound.writable||sharedOriginal(latest.data,tab.folder)||bound.path!==tab.folderPath||!dir||
    (bound.path===null&&dir!==tab.dir&&(!dir.isSameEntry||!await dir.isSameEntry(tab.dir))))throw global.I18n.error(msg('The folder connection or write permission changed. Reopen the project.'));
  if(await F().grantPermission(dir,'readwrite')!=='granted')throw global.I18n.error(msg('No write permission. Open Settings and connect the folder for writing.'));
}
async function savedReview(tab,done,{preserveEditing=false,submitted=null,refreshIndex=!preserveEditing}={}){
  if(refreshIndex&&done.saved&&done.recorded&&!done.index_deferred&&!done.index_updated&&!done.index_error)try{await global.WikiCore.updateIndex(tab.dir,F(),R());}catch(error){done.index_error=error.message;}
  const journal=await R().read(tab.dir,tab.name);
  const newer=preserveEditing&&tab.text!==submitted;
  if(!newer)tab.text=done.text;tab.origin=done.text;tab.mark=done.mark;
  tab.checkpoint={...tab.checkpoint,text:done.text,seen:Array.from(new Set([...(tab.checkpoint?tab.checkpoint.seen:[]),...journal.events.filter(e=>['change','accept'].includes(e.kind)).map(e=>e.id)])),at:new Date().toISOString()};
  tab.checkpoint.pendingRecord=done.recorded?null:done.event;
  await storeCheckpoint(tab);
  state.draftWrites=state.draftWrites.catch(()=>{}).then(()=>tab.text!==tab.origin?F().keepDraft(draftKey(tab),tab.name,tab.text,tab.origin):F().dropDraft(draftKey(tab),tab.name));await state.draftWrites;
  if(state.active===tab){if(preserveEditing&&state.mode==='live'){const p=global.WikiCore.parseDocument(tab.text);state.editorPrefix=tab.text.slice(0,p.offset);}else if(!preserveEditing){state.sheet.value=tab.text;at('ws-source').value=tab.text;setMode(state.mode,false);}renderOutline();}
  if(tab.text!==tab.origin)scheduleAutosave(tab);
  renderTabs();await pollReviews();if(state.graphOpen)await renderGraph();
  if(done.index_error)status(msg("The note is saved; index refresh needs attention: {reason}",{reason:done.index_error}));
  else if(done.recorded){status(msg(tab.text!==tab.origin?'Earlier changes saved. Your latest edits are waiting to be saved.':done.unchanged?'No changes. Your comparison baseline is up to date.':'Saved with your author name.'));tab.pendingRecord=null;}
  else{tab.pendingRecord=done.event;status(msg('The file was saved, but its author record is incomplete. Open the comparison to retry the record.'));}
}
function reviewTime(value){const date=new Date(value);return Number.isFinite(date.valueOf())?date.toLocaleString(global.I18n.language()==='de'?'de-DE':'en-GB',{dateStyle:'medium',timeStyle:'short'}):msg('Time unknown');}
function authorLabel(e){return e.author||msg('Unknown author');}
function kindLabel(kind){return msg({change:'Saved change',external:'Change from another editor',proposal:'Proposed version',reject:'Rejection',accept:'Accepted',comment:'Comment',resolve:'Resolved',reopen:'Reopened',acknowledge:'Accepted change',partial:'Accepted change'}[kind]||'Response');}
function reviewDiff(parent,before,after,events=null,actions=null){
  const changes=R().diff(before,after);
  if(!changes.length){parent.append(el('p','ws-muted',msg('No text differences.')));return;}
  const attribution=events?R().attribution(before,after,events):null;
  let position=0;
  for(const h of changes){
    if(attribution){const who=attribution[position++];const label=el('p','ws-review-attribution ws-muted');for(const e of who.authors)label.append(el('span','',msg('Changed by {author} · {time}',{author:e.author,time:reviewTime(e.at)})));if(who.unknown)label.append(el('span','',msg('Unknown author')));parent.append(label);}
    const box=el('div','ws-review-hunk');
    for(const [label,lines,sign,number] of [[msg('Before'),h.before,'-',h.beforeLine],[msg('After'),h.after,'+',h.afterLine]]){
      const side=el('section'),head=el('h4','');head.append(el('span','',label),el('small','ws-muted',msg('Line {line}',{line:number})));side.append(head);
      const pre=el('pre','ws-review-lines');if(!lines.length)pre.append(el('span','ws-muted',msg('(empty)')));
      for(const line of lines)pre.append(el('span',sign==='-'?'ws-review-removed':'ws-review-added',sign+' '+line+'\n'));
      side.append(pre);box.append(side);
    }
    if(actions){const index=changes.indexOf(h),tools=el('div','ws-review-hunk-actions');for(const [choice,label]of [['accept','Accept change'],['reject','Reject change'],['comment','Ask about this change']])tools.append(button(msg(label),()=>actions(choice,index,before,after)));box.append(tools);}
    parent.append(box);
  }
}
let reviewPollQueue=Promise.resolve();
function pollReviews(){
  // Explicit inbox refresh must finish its own read. Concurrent timer/tab reads
  // used to invalidate it and let the dialog open with an older empty snapshot.
  const next=reviewPollQueue.catch(()=>{}).then(scanReviews);
  reviewPollQueue=next;return next;
}
async function scanReviews(){
  if(!state.data||!state.root)return;
  const run=++state.reviewRun,root=state.root,items=[];let unreadable=0;
  const journals=new Map();
  for(const id of selectedIds()){
    if(state.data.folders.find(f=>f.id===id)?.kind!=="work")continue;
    const dir=state.handles.get(id);if(!dir)continue;
    const journal=await R().read(dir);if(run!==state.reviewRun||root!==state.root)return;
    journals.set(id,journal);unreadable+=journal.unreadable;
    const aliases=await R().aliases(dir);
    const pages=new Set([...journal.events.map(e=>R().currentPage(aliases,e.page)),...(state.files.get(id)||[]).filter(e=>/\.md$/i.test(e.name)&&e.size<=2000000).map(e=>e.name)]);
    for(const name of pages){
      const folder=state.data.folders.find(f=>f.id===id),events=journal.events.filter(e=>R().currentPage(aliases,e.page)===name);
      let current;try{current=await F().readFile(dir,name);}catch(error){if(error.name==='NotFoundError')continue;throw error;}
      const key=R().localKey(state.data.id+'/'+(state.instance||'legacy'),id,folder.path,reviewAuthor);
      let saved=await R().checkpoint(key,name);
      if(!saved){saved={text:current.text,seen:events.filter(e=>['change','accept'].includes(e.kind)).map(e=>e.id),at:new Date().toISOString(),drafts:[]};await R().checkpoint(key,name,saved);}
      const tasks=await R().tasks(events,reviewAuthor,saved,current.text,name);
      if(tasks.length)items.push({folder:id,event:tasks[0],events:tasks});
      const tab=state.tabs.find(t=>t.folder===id&&t.name===name&&!t.viewer);
      if(tab){
        if(state.active===tab)collect();
        const clean=tab.text===tab.origin;
        tab.latest=current;
        if(clean&&tab.text!==current.text){
          tab.text=current.text;tab.origin=current.text;tab.mark=current.mark;
          // Do not asynchronously delete recovery data here: a user can start
          // typing while IndexedDB is opening. Clean draft records are ignored
          // on restore; only an explicit successful save removes a draft.
          if(state.active===tab){setMode(state.mode,false);renderOutline();}
        }
      }
    }
  }
  if(run!==state.reviewRun||root!==state.root)return;
  state.inbox=items;state.reviewUnreadable=unreadable;
  const badge=at('ws-review-count');if(badge){badge.hidden=!items.length;badge.textContent=String(items.length);}
  const tab=state.active,banner=at('ws-review-banner');if(!tab||tab.viewer||!banner)return;
  const current=await F().readFile(tab.dir,tab.name);if(run!==state.reviewRun||state.active!==tab)return;
  tab.latest=current;
  const pending=items.filter(i=>i.folder===tab.folder&&i.event.page===tab.name);
  const changed=tab.checkpoint&&current.text!==tab.checkpoint.text;
  banner.replaceChildren();banner.hidden=!changed&&!pending.length;
  if(!banner.hidden){banner.append(el('span','',changed?msg('Changes since your last saved or accepted version.'):msg('You have responses about this document.')),button(msg('Review changes'),()=>compare(pending.length?pending[pending.length-1].event:null),'file-diff'));}
}
async function reviewInbox(){
  await pollReviews();const d=modal(msg('Change inbox'));
  if(!state.inbox.length)d.content.append(el('p','ws-muted',msg('No new changes or responses.')));
  for(const item of state.inbox){
    const e=item.event,card=el('article','ws-inbox-item');card.append(el('strong','',e.page),el('p','',msg('{kind} by {author}',{kind:kindLabel(e.kind),author:authorLabel(e)})),el('small','ws-muted',reviewTime(e.at)));
    if(e.message)card.append(el('p','',e.message));
    card.append(button(msg('Open response'),async()=>{d.dialog.close();await openFile(item.folder,e.page);await compare(e);}));d.content.append(card);
  }
  if(state.reviewUnreadable)d.content.append(el('p','ws-muted',msg('Some change records could not be read.')));
}
async function keepLocalDraft(tab){
  collect();if(tab.text===tab.origin)return;
  tab.checkpoint.drafts=tab.checkpoint.drafts||[];
  if(!tab.checkpoint.drafts.some(d=>d.text===tab.text&&d.origin===tab.origin))tab.checkpoint.drafts.push({id:global.crypto.randomUUID(),text:tab.text,origin:tab.origin,at:new Date().toISOString()});
  await storeCheckpoint(tab);
}
function recoveryDialog(tab){
  const d=modal(msg('Preserved local drafts'));
  for(const draft of tab.checkpoint.drafts||[]){const card=el('article','ws-inbox-item');card.append(el('p','',reviewTime(draft.at)),el('pre','ws-draft-excerpt',draft.text.slice(0,800)),button(msg('Reopen draft'),async()=>{await keepLocalDraft(tab);tab.text=draft.text;tab.origin=draft.origin;await F().keepDraft(draftKey(tab),tab.name,tab.text,tab.origin);if(state.active===tab){state.active=null;activate(tab);}d.dialog.close();}));d.content.append(card);}
}
async function reviewDialog(selected=null){
  collect();const tab=state.active;if(!tab||tab.viewer)return;
  const seen=await F().readFile(tab.dir,tab.name);if(typeof seen.text!=='string')throw global.I18n.error(msg('The saved version cannot be read.'));
  const journal=await R().read(tab.dir,tab.name);
  if(!tab.pendingRecord)tab.pendingRecord=tab.checkpoint.pendingRecord||null;
  const known=journal.events.filter(e=>(e.kind==='change'||e.kind==='accept'&&e.base!==e.text)&&e.text===seen.text);
  const incoming=R().incoming(journal.events,reviewAuthor,tab.checkpoint.seen);
  const responses=incoming.filter(e=>e.kind!=='change');
  selected=selected&&(journal.events.find(e=>e.id===selected.id)||(selected.kind==='external'&&selected.text===seen.text?selected:null))||responses[responses.length-1]||known[known.length-1]||null;
  const external=!known.length&&seen.text!==tab.checkpoint.text;
  if(!selected||external&&['change','accept'].includes(selected.kind))selected=R().event({kind:'external',page:tab.name,author:'',base:tab.checkpoint.text,text:seen.text});
  const d=modal(msg('Versions and changes'));d.dialog.classList.add('ws-wide','ws-review-dialog');
  const message=el('p','ws-review-message');message.setAttribute('role','status');d.foot.append(message);
  const acting=async(action)=>{if(state.reviewBusy)return;state.reviewBusy=true;try{await action();}catch(e){global.I18n.setText(message,global.I18n.fromError(e));}finally{state.reviewBusy=false;}};
  d.content.append(el('p','ws-muted',msg('Your comparison baseline is your last saved or accepted version. Opening this dialog does not accept changes.')));
  const identity=el('p','ws-review-author');identity.append(el('strong','',msg('{kind} by {author}',{kind:kindLabel(selected.kind),author:authorLabel(selected)})),el('span','ws-muted',selected.kind==='external'?msg('No matching author record is available.'):reviewTime(selected.at)));d.content.append(identity);
  if(external)d.content.append(el('p','ws-muted',msg('Saved file: author unknown.')));
  if(external)d.content.append(button(msg('This change was made by me'),()=>acting(async()=>{
   await writableTab(tab);if(!await ensureAuthor())return;
   const latest=await F().readFile(tab.dir,tab.name);if(latest.text!==seen.text)throw global.I18n.error(msg('The file changed again. Reopen the comparison before deciding.'));
   const previous=journal.events.filter(e=>['change','accept'].includes(e.kind)&&e.text!==seen.text).at(-1);
   const confirmation=R().event({kind:'change',page:tab.name,author:reviewAuthor,base:previous?.text??tab.checkpoint.text,text:seen.text,message:'Explicit author confirmation for an external editor change.'});
   await R().append(tab.dir,confirmation);
   if((await F().readFile(tab.dir,tab.name)).text!==seen.text)throw global.I18n.error(msg('The file changed again. Reopen the comparison before deciding.'));
   if(!await R().receipt(tab.dir,confirmation))throw global.I18n.error(msg('The author record could not be completed.'));
   d.dialog.close();await compare();
  })));
  if(selected.kind==='change'&&selected.text!==seen.text)d.content.append(button(msg('Show current saved version'),()=>{d.dialog.close();return compare();}));
  if(selected.message)d.content.append(el('blockquote','ws-review-comment',selected.message));
  const columns=el('div','ws-compare');
  const isProposal=['proposal','reject'].includes(selected.kind),olderChange=selected.kind==='change'&&selected.text!==seen.text;
  const candidate=isProposal||olderChange?selected.text:tab.text;
  for(const [label,text]of[[msg('Your last saved or accepted version'),tab.checkpoint.text],[msg('Saved now'),seen.text],[msg(isProposal?'Proposed version':olderChange?'Selected saved version':'Your draft'),candidate]]){const col=el('section');col.append(el('h3','',label));const pre=el('pre');const changes=new Set(changedLines(tab.checkpoint.text,text));text.split(/\r?\n/).forEach((line,i)=>pre.append(el('span',changes.has(i)?'ws-changed-line':'',line+'\n')));col.append(pre);columns.append(col);}if(candidate!==seen.text&&candidate!==tab.checkpoint.text){const conflict=el('details','ws-review-threeway');conflict.append(el('summary','',msg('Compare conflicting drafts')),columns);d.content.append(conflict);}
  const summary=el('section','ws-review-summary');summary.append(el('h3','',msg('What changed since your baseline')));reviewDiff(summary,tab.checkpoint.text,seen.text,journal.events,changeAction);d.content.append(summary);
  if(['proposal','reject','comment'].includes(selected.kind)){const proposed=el('section','ws-review-summary');proposed.append(el('h3','',msg('Proposed changes to the saved file')));reviewDiff(proposed,seen.text,selected.text,null,changeAction);d.content.append(proposed);}
  if(external){
    const old=await R().notices(tab.dir,seen.text);
    for(const note of old.filter(n=>n.text&&seen.text.includes(n.text)||n.base&&tab.checkpoint.text.includes(n.base))){const card=el('details','ws-review-event');card.append(el('summary','',msg('Recorded paragraph by {author}',{author:authorLabel(note)})),el('small','ws-muted',reviewTime(note.at)));reviewDiff(card,note.base,note.text);d.content.append(card);}
  }
  const timeline=el('details','ws-review-timeline');timeline.open=true;timeline.append(el('summary','',msg('Saved changes and comments')));
  let visibleEvents=journal.events.slice(-30);
  function drawTimeline(){
    for(const node of Array.from(timeline.children).slice(1))node.remove();
    for(const e of visibleEvents){
      const card=el('details','ws-review-event');card.dataset.eventId=e.id;
      const title=el('summary','');title.append(el('span','',msg('{kind} by {author}',{kind:kindLabel(e.kind),author:authorLabel(e)})),el('small','ws-muted',reviewTime(e.at)));card.append(title);
      if(e.message)card.append(el('p','',e.message));
      if(e.anchor){card.append(el('small','ws-muted',msg('Line {line}',{line:e.anchor.afterLine})));reviewDiff(card,e.anchor.before.join('\n'),e.anchor.after.join('\n'));}
      if(e.kind==='comment'){const closed=R().threadState(journal.events,e.thread)==='resolved';card.append(el('small','ws-muted',msg(closed?'Resolved':'Open')),button(msg(closed?'Reopen comment':'Resolve comment'),()=>acting(async()=>{await writableTab(tab);if(!await ensureAuthor())return;const thread=journal.events.filter(v=>v.thread===e.thread),parents=new Set(thread.map(v=>v.parent)),last=thread.filter(v=>!parents.has(v.id)).at(-1)||e;const action=R().reply(last,closed?'reopen':'resolve',reviewAuthor,seen.text,seen.text,'');await R().append(tab.dir,action);d.dialog.close();await compare();})));}
      const parent=journal.events.find(p=>p.id===e.parent);if(parent)card.append(el('p','ws-muted',msg('In response to {author}',{author:authorLabel(parent)})));
      const accepted=journal.events.find(p=>p.parent===e.id&&p.kind==='accept');if(accepted)card.append(el('p','ws-muted',msg('Accepted by {author}',{author:authorLabel(accepted)})));
      reviewDiff(card,e.base,e.text);
      if(e.kind!=='accept')card.append(button(msg('Review this response'),()=>{d.dialog.close();return compare(e);}));timeline.append(card);
    }
    if(visibleEvents.length<journal.events.length)timeline.append(button(msg('Show all changes'),()=>{visibleEvents=journal.events;drawTimeline();}));
  }
  drawTimeline();d.content.append(timeline);
  if(journal.incomplete||journal.unreadable)d.content.append(el('p','ws-muted',msg('Some change records are incomplete. Only confirmed writes are attributed.')));
  if(tab.pendingRecord)d.foot.append(button(msg('Retry author record'),()=>acting(async()=>{await writableTab(tab);const current=await F().readFile(tab.dir,tab.name);if(current.text!==tab.pendingRecord.text)throw global.I18n.error(msg('The file changed again. Reopen the comparison before deciding.'));if(!await R().receipt(tab.dir,tab.pendingRecord))throw global.I18n.error(msg('The author record could not be completed.'));tab.pendingRecord=null;tab.checkpoint.pendingRecord=null;await storeCheckpoint(tab);d.dialog.close();await compare();})));
  const reason=field(d.content,msg('Comment to {author} (optional)',{author:selected.author===reviewAuthor?(selected.recipients.join(', ')||String(msg('Unknown author'))):authorLabel(selected)}),'', 'textarea');reason.id='ws-review-reason';reason.maxLength=10000;
  d.content.append(el('p','ws-muted',msg('Rejecting proposes your previous confirmed text. A new version proposes your edited text. Both are sent back for review; the saved file changes only when a proposal is accepted.')));
  function currentReply(kind,base,text,message){return {...R().reply(selected,kind,reviewAuthor,base,text,message),page:tab.name};}
  async function changeAction(choice,index,before,after){
    const h=R().diff(before,after)[index],attributed=after===seen.text?R().attribution(before,after,journal.events)[index]:{authors:[selected],unknown:false},recipients=[...new Set(attributed.authors.map(e=>e.author).filter(Boolean))];
    if(choice==='comment'){
      const ask=modal(msg('Question to {author}',{author:recipients.join(', ')||String(msg('Unknown author'))})),input=field(ask.content,msg('Comment on this change'),'', 'textarea');input.maxLength=10000;
      ask.foot.append(button(msg('Send response'),()=>acting(async()=>{if(!input.value.trim())return;await writableTab(tab);if(!await ensureAuthor())return;const now=await F().readFile(tab.dir,tab.name);if(now.text!==seen.text)throw global.I18n.error(msg('The file changed again. Reopen the comparison before deciding.'));await ensureParent();const comment=currentReply('comment',seen.text,seen.text,input.value);comment.recipients=recipients.filter(a=>a!==reviewAuthor);comment.anchor={...h,revision:seen.mark||'',beforeHash:await R().hash(before),afterHash:await R().hash(after)};await R().append(tab.dir,comment);ask.dialog.close();d.dialog.close();await compare(comment);})));return;
    }
    return acting(async()=>{await writableTab(tab);if(!await ensureAuthor())return;const current=await F().readFile(tab.dir,tab.name);if(current.text!==seen.text)throw global.I18n.error(msg('The file changed again. Reopen the comparison before deciding.'));await ensureParent();
      if(choice==='accept'){
        const value=R().selectChanges(before,after,[index]);
        if(after===seen.text){const ack=currentReply('acknowledge',before,value,'');ack.anchor=h;await R().append(tab.dir,ack);tab.checkpoint.text=value;await storeCheckpoint(tab);}
        else{await keepLocalDraft(tab);await global.WikiCore.validateEdit(tab.dir,tab.name,value,F(),R());const part=currentReply('partial',seen.text,value,'');part.anchor=h;await R().append(tab.dir,part);const done=await R().save(tab.dir,tab.name,current,value,reviewAuthor,part);if(!done.saved)throw global.I18n.error(msg('The file changed again. Reopen the comparison before deciding.'));await savedReview(tab,done);}
      }else{const value=R().revertChanges(before,after,[index]),reply=currentReply('reject',seen.text,value,reason.value);reply.anchor=h;await R().append(tab.dir,reply);}
      d.dialog.close();await compare();
    });
  }
  async function ensureParent(){if(!journal.events.some(e=>e.id===selected.id)){await R().append(tab.dir,selected);journal.events.push(selected);}}
  async function finishResponse(){tab.checkpoint.seen=Array.from(new Set([...tab.checkpoint.seen,selected.id]));await storeCheckpoint(tab);d.dialog.close();await pollReviews();status(msg(selected.author?'Response recorded. The other author sees it after folder synchronization and refresh.':'Response saved with this document. The original author is unknown.'));}
  const acceptButton=button(msg('Accept all changes in this file'),()=>acting(async()=>{
    await writableTab(tab);if(!await ensureAuthor())return;
    const current=await F().readFile(tab.dir,tab.name);if(current.text!==seen.text)throw global.I18n.error(msg('The file changed again. Reopen the comparison before deciding.'));
    await keepLocalDraft(tab);await ensureParent();
    await global.WikiCore.validateEdit(tab.dir,tab.name,selected.text,F(),R());
    const done=await R().accept(tab.dir,selected,current,reviewAuthor);
    if(!done.saved)throw global.I18n.error(msg('This proposal refers to an older file. Create a new version against the current text.'));
    await savedReview(tab,done);d.dialog.close();
  }),null,'ws-primary');acceptButton.id='ws-review-accept';
  const rejectButton=button(msg('Reject'),()=>acting(async()=>{
    await writableTab(tab);if(!await ensureAuthor())return;
    const current=await F().readFile(tab.dir,tab.name);if(current.text!==seen.text)throw global.I18n.error(msg('The file changed again. Reopen the comparison before deciding.'));
    await ensureParent();await R().append(tab.dir,currentReply('reject',seen.text,tab.checkpoint.text,reason.value));await finishResponse();
  }));rejectButton.id='ws-review-reject';
  const proposeButton=button(msg('Create new version'),()=>{
    const proposal=modal(msg('Create new version'));proposal.dialog.classList.add('ws-wide');
    proposal.content.append(el('p','ws-muted',msg('Edit your counterproposal. It is sent to the other author for review.')));
    const text=field(proposal.content,msg('Proposed text'),tab.text,'textarea');text.id='ws-proposal-text';text.classList.add('ws-proposal-text');
    const note=field(proposal.content,msg('Your response (optional)'),reason.value,'textarea');note.maxLength=10000;
    const preview=el('div','ws-review-summary');proposal.content.append(preview);
    proposal.foot.append(button(msg('Preview changes'),()=>{preview.replaceChildren();reviewDiff(preview,seen.text,text.value);}));
    const failure=el('p','ws-review-message');proposal.foot.append(failure);
    proposal.foot.append(button(msg('Send new version'),async()=>{
      if(state.reviewBusy)return;state.reviewBusy=true;
      try{await writableTab(tab);if(!await ensureAuthor())return;
        const current=await F().readFile(tab.dir,tab.name);if(current.text!==seen.text)throw global.I18n.error(msg('The file changed again. Reopen the comparison before deciding.'));
        if(text.value===seen.text)throw global.I18n.error(msg('The proposed text is unchanged. Use a response or edit the proposal.'));
        await ensureParent();await R().append(tab.dir,currentReply('proposal',seen.text,text.value,note.value));proposal.dialog.close();await finishResponse();
      }catch(e){global.I18n.setText(failure,global.I18n.fromError(e));}finally{state.reviewBusy=false;}
    },null,'ws-primary'));
  });proposeButton.id='ws-review-propose';
  const respondButton=button(msg('Send response'),()=>acting(async()=>{
    await writableTab(tab);if(!await ensureAuthor())return;
    if(!reason.value.trim())throw global.I18n.error(msg('Write a response first.'));
    await ensureParent();await R().append(tab.dir,currentReply('comment',seen.text,selected.text,reason.value));await finishResponse();
  }));
  for(const b of (['comment','resolve','reopen'].includes(selected.kind)?[respondButton]:[acceptButton,rejectButton,proposeButton,respondButton])){b.disabled=!currentFolder().writable;d.foot.append(b);}
  if((tab.checkpoint.drafts||[]).length)d.foot.append(button(msg('Preserved local drafts'),()=>recoveryDialog(tab)));
}

function hideGraph(){
  state.graphOpen=false;state.graphRun++;
  if(state.graphView){state.graphView.destroy();state.graphView=null;}
  if(at("ws-graph"))at("ws-graph").hidden=true;
  if(at("ws-document-bar"))at("ws-document-bar").hidden=!state.active;
  if(at("ws-open-graph"))at("ws-open-graph").setAttribute("aria-pressed","false");
}
async function openGraph(){
  hideSourceViewer();
  collect();state.graphOpen=true;at("ws-empty").hidden=true;at("ws-document").hidden=true;at("ws-document-bar").hidden=true;at("ws-graph").hidden=false;
  at("ws-open-graph").setAttribute("aria-pressed","true");renderTabs();await renderGraph();
}
async function renderGraph(){
  await refreshProject();
  const run=++state.graphRun,area=at('ws-graph-canvas'),summary=at('ws-graph-summary'),list=at('ws-graph-wikis'),root=state.root;
  if(!root||!state.data)return;
  let snapshot,seen;
  try{seen=await F().readFile(root,'.llmwiki/graph.json');snapshot=JSON.parse(seen.text);
    if(snapshot.format!=='llmwiki-project-graph/1'||snapshot.project!==state.data.id||!Array.isArray(snapshot.nodes)||!Array.isArray(snapshot.edges)||!snapshot.revision)throw Error('Invalid project graph snapshot. Run maintain-llm-wiki to refresh it.');
  }catch(error){if(run!==state.graphRun)return;if(state.graphView){state.graphView.destroy();state.graphView=null;}state.graphSignature=null;list.replaceChildren();global.I18n.setText(summary,msg('No current project graph. Run maintain-llm-wiki to build the graph.'));return;}
  if(run!==state.graphRun||!state.graphOpen||root!==state.root)return;
  const wikis=state.data.folders.filter(f=>f.kind==='wiki'),available=new Set();
  for(const wiki of wikis){const handle=state.handles.get(workingFolder(wiki.id));if(handle&&await F().permissionState(handle,'read')==='granted')available.add(wiki.id);}
  if(run!==state.graphRun||!state.graphOpen||root!==state.root)return;
  const signature=JSON.stringify([seen.mark||seen.text,wikis.map(w=>[w.id,w.label,available.has(w.id)]),[...state.graphHidden].sort()]);
  if(state.graphView&&state.graphSignature===signature)return;
  const labels=new Map(wikis.map(w=>[w.id,w.label])),nodes=snapshot.nodes.filter(n=>!global.WikiCore.navigationPage(n.path)&&available.has(n.wiki)&&!state.graphHidden.has(n.wiki)&&typeof n.key==='string'&&typeof n.path==='string'&&F().writableName(n.path)!==null).map(n=>({path:n.key,filePath:n.path,wiki:n.wiki,wikiLabel:labels.get(n.wiki),label:n.title||n.path})),ids=new Set(nodes.map(n=>n.path));
  const graph={nodes,edges:snapshot.edges.filter(e=>ids.has(e.source)&&ids.has(e.target)),unresolved:snapshot.findings?.length||0};
  list.replaceChildren();for(const wiki of wikis){const row=el('label','ws-graph-wiki-choice'),check=el('input');check.type='checkbox';check.checked=!state.graphHidden.has(wiki.id);check.disabled=!available.has(wiki.id);check.dataset.wiki=wiki.id;check.setAttribute('aria-label',String(msg('Show wiki: {name}',{name:wiki.label})));row.append(check,el('span','',wiki.label));list.append(row);check.addEventListener('change',()=>{if(check.checked)state.graphHidden.delete(wiki.id);else state.graphHidden.add(wiki.id);renderGraph().catch(report);});}
  global.I18n.setText(summary,msg('{nodes} files · {edges} connections',{nodes:nodes.length,edges:graph.edges.length}));
  summary.append(el('span','ws-muted',' · '+String(msg('Graph updated'))+': '+reviewTime(snapshot.generated_at)));
  if(graph.unresolved)global.I18n.appendText(summary,msg(' · {count} unresolved links',{count:graph.unresolved}));
  if(state.graphView)state.graphView.destroy();state.graphSignature=signature;
  state.graphView=global.WikiGraph.mount(area,graph,{label:msg('Wiki graph'),linkLabel:msg('Link'),layoutKey:'llmwiki.graph.layout/'+browserProjectKey(),active:state.active?global.WikiGraph.key(state.active.wiki||state.active.folder,state.active.name):null,tooltips:appearance.edgeTooltips,open:id=>{const n=graph.nodes.find(n=>n.path===id);if(n&&state.handles.has(workingFolder(n.wiki)))openWikiFile(n.wiki,n.filePath).catch(report);}});
}

function closeSearch(){at("ws-search-panel").hidden=true;at("ws-search-toggle").setAttribute("aria-expanded","false");}
function focusSearch(){at("ws-sidebar").classList.remove("collapsed");at("ws-search-panel").hidden=false;at("ws-search-toggle").setAttribute("aria-expanded","true");at("ws-search").focus();}
function build(){
  const root=at("workspace-app");if(!root)return;applyAppearance();
  const rail=el("aside","ws-rail");const searchToggle=button(msg("Search"),()=>{if(at("ws-search-panel").hidden)focusSearch();else closeSearch();},"search");searchToggle.id="ws-search-toggle";searchToggle.setAttribute("aria-expanded","false");searchToggle.setAttribute("aria-controls","ws-search-panel");rail.append(button(msg("Files"),()=>{if(!at("ws-search-panel").hidden){closeSearch();at("ws-sidebar").classList.remove("collapsed");}else at("ws-sidebar").classList.toggle("collapsed");},"menu"),searchToggle);
  const graphButton=button(msg("Wiki graph"),openGraph,"network");graphButton.id="ws-open-graph";graphButton.setAttribute("aria-pressed","false");rail.append(graphButton);const inboxButton=button(msg("Change inbox"),reviewInbox,"inbox");inboxButton.id="ws-review-inbox";const badge=el("small","ws-inbox-badge");badge.id="ws-review-count";badge.hidden=true;inboxButton.append(badge);rail.append(inboxButton);
  const bottom=el("div","ws-rail-bottom");bottom.append(button(msg('Open retained quote'),()=>openQuote(),'quote'),button(msg("Settings"),()=>settings(false),"settings"));rail.append(bottom);
  const side=el("aside","ws-sidebar");side.id="ws-sidebar";const sh=el("header","ws-sidebar-head");const pname=el("strong","",global.document.title);pname.id="ws-project-name";if(/^data:image\/png;base64,/.test(editorDesign.logo||'')){const brand=el('img','ws-brand-logo');brand.src=editorDesign.logo;brand.alt=editorDesign.label;sh.append(brand);}sh.append(pname,button(msg("New note"),newFile,"file-plus"));

  const sr=el("div","ws-search-box");sr.append(icon("search"));const input=el("input");input.id="ws-search";input.type="search";global.I18n.setAttribute(input,"placeholder",msg("Search…"));global.I18n.setAttribute(input,"aria-label",msg("Search files and content"));let timer;input.addEventListener("input",()=>{clearTimeout(timer);state.searchRun+=1;timer=setTimeout(()=>searchAll().catch(report),250);});const searchKey=el("kbd","ws-search-key","esc");searchKey.setAttribute("aria-hidden","true");sr.append(input,searchKey);
  const results=el("div","ws-search-results");results.id="ws-search-results";const files=el("div","ws-tree");files.id="ws-tree";
  const sf=el("footer","ws-sidebar-foot");sf.append(button(msg("Refresh"),refreshCurrent,"refresh-cw"));global.I18n.languagePicker(sf,"ws-language");const searchPanel=el("section","ws-search-panel");searchPanel.id="ws-search-panel";searchPanel.hidden=true;searchPanel.append(sr,results);searchPanel.addEventListener("keydown",event=>{if(event.key==="Escape"){event.preventDefault();closeSearch();searchToggle.focus();}});side.append(sh,searchPanel,files,sf);
  const main=el("main","ws-main");const tabs=el("div","ws-tabs");tabs.id="ws-tabs";tabs.setAttribute("role","tablist");global.I18n.setAttribute(tabs,"aria-label",msg("Open files"));
  const bar=el("div","ws-document-bar");bar.id="ws-document-bar";bar.hidden=true;const crumb=el("span","ws-breadcrumb");crumb.id="ws-breadcrumb";const readonly=el("small","ws-muted");readonly.id="ws-readonly";const modes=el("div","ws-modes");modes.id="ws-modes";for(const [mode,label]of[["live",msg("Live preview")],["source",msg("Source")],["read",msg("Read")]]){const b=button(label,()=>setMode(mode),mode);b.dataset.mode=mode;modes.append(b);}const save=button(msg("Save"),saveActive,"save");save.id="ws-save";const actions=el("div","ws-document-actions");actions.append(button(msg("Versions and changes"),compare,"file-diff"),save);bar.append(crumb,readonly,modes,actions);
  const empty=el("section","ws-empty");empty.id="ws-empty";empty.append(icon("book"),el("p","ws-eyebrow",msg("YOUR KNOWLEDGE. YOUR FILES.")),el("h1","",msg("Room for connections.")),el("p","",msg("Connect your wikis and sources. Write here or in your own editor. Everything stays in your files.")),button(msg("Open project folder"),chooseProject,null,"ws-primary"),el("small","ws-muted",msg("Set up once. Then get straight to work.")));
  const doc=el("section","ws-document");doc.id="ws-document";doc.hidden=true;
  const toolbar=el("div","ws-toolbar"),more=el('div','ws-format-menu');more.setAttribute('popover','auto');toolbar.append(more);toolbar.setAttribute("role","toolbar");global.I18n.setAttribute(toolbar,"aria-label",msg("Format text"));
  for(const [form,label]of[["bold",msg("Bold")],["italic",msg("Italic")],["strike",msg("Strikethrough")],["underline",msg("Underline")],["highlight",msg("Highlight")],["math",msg("Formula")],["callout",msg("Callout")],["footnote",msg("Footnote")],["relationship",msg("Relationship")],["link",msg("Link")],["image",msg("Image / attachment")],["list",msg("Bullet list")],["list-ordered",msg("Numbered list")],["task",msg("Task")],["table",msg("Table")],["quote",msg("Quote")],["code",msg("Inline code")],["code-block",msg("Code")],["rule",msg("Horizontal rule")]]){const b=button(label,()=>form==='link'||form==='image'?insertLink(form==='image'):form==='footnote'?insertFootnote():form==='relationship'?relationshipDialog():applyForm(form),{relationship:'git-compare-arrows',underline:'underline',highlight:'highlighter',math:'sigma',callout:'message-square',footnote:'superscript',strike:'strikethrough',link:'link',image:'image',list:'list','list-ordered':'list-ordered',code:'code-xml',rule:'minus',bold:"bold",italic:"italic","heading-2":"heading-2",wikilink:"link",embed:"image",task:"list-todo",table:"table",quote:"quote","code-block":"code-xml"}[form]);b.dataset.format=form;b.addEventListener('mousedown',e=>e.preventDefault());if(['bold','italic','link','list'].includes(form))toolbar.append(b);else{b.append(el('span','',label));b.addEventListener('click',()=>more.hidePopover());more.append(b);}}const headings=el('select');headings.setAttribute('aria-label',msg('Heading'));headings.append(new Option(msg('Heading'),''));for(let n=1;n<=6;n++)headings.append(new Option('H'+n,'heading-'+n));let headingSpan;headings.addEventListener('pointerdown',()=>{headingSpan=state.mode==='source'?{from:at('ws-source').selectionStart,to:at('ws-source').selectionEnd}:global.writingSpan(at('ws-editor'));});headings.addEventListener('change',()=>{if(headings.value){applyForm(headings.value,headingSpan);}headings.value='';});toolbar.append(headings,button(msg('Undo'),()=>editorUndo(),'undo-2'),button(msg('Redo'),()=>editorUndo(true),'redo-2'),button(msg("Find / Replace"),findDialog,"text-search"));
  toolbar.lastElementChild.dataset.readAction='true';const moreButton=button(msg('More formatting'),()=>{const r=moreButton.getBoundingClientRect();more.style.left=Math.min(r.left,global.innerWidth-250)+'px';more.style.top=r.bottom+'px';more.togglePopover();},'menu');moreButton.addEventListener('mousedown',e=>e.preventDefault());toolbar.append(moreButton);headings.addEventListener('focus',()=>{headingSpan=state.mode==='source'?{from:at('ws-source').selectionStart,to:at('ws-source').selectionEnd}:global.writingSpan(at('ws-editor'));});
  const editor=el("div","schreibflaeche ws-editor");editor.id="ws-editor";editor.contentEditable="true";editor.setAttribute("role","textbox");global.I18n.setAttribute(editor,"aria-label",msg("Edit Markdown"));editor.setAttribute("aria-multiline","true");editor.spellcheck=true;
  const source=el("textarea","ws-source");source.id="ws-source";global.I18n.setAttribute(source,"aria-label",msg("Markdown source"));source.hidden=true;source.addEventListener('input',()=>changed(source.value));source.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())){event.preventDefault();editorUndo(event.shiftKey||event.key.toLowerCase()==='y');}});
  const preview=el("article","ws-preview");preview.id="ws-preview";preview.hidden=true;
  const content=el("div","ws-content");const writing=el("div","ws-writing");const completions=el("div","ws-completions");completions.id="ws-completions";global.I18n.setAttribute(completions,"aria-label",msg("Link targets"));const properties=el('div');properties.id='ws-document-properties';const name=el('input','ws-document-name');name.id='ws-document-name';name.setAttribute('aria-label',String(msg('File name')));name.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();renameDocument().catch(report);}if(event.key==='Escape'){renderDocumentName();name.blur();}});writing.append(name,properties,editor,completions,source,preview);
  const props=el("aside","ws-properties");const outline=el("div");outline.id="ws-outline";const back=el("div");back.id="ws-backlinks";props.append(el("h3","",msg("Outline")),outline,el("h3","",msg("Backlinks")),back);content.append(writing,props);const reviewBanner=el("div","ws-review-banner");reviewBanner.id="ws-review-banner";reviewBanner.hidden=true;reviewBanner.setAttribute("role","status");doc.append(reviewBanner,toolbar,content);
  const statusbar=el("footer","ws-status");statusbar.id="ws-status";statusbar.setAttribute("role","status");statusbar.setAttribute("aria-live","polite");global.I18n.setText(statusbar,msg("Saved locally. No account needed for this editor."));
  const graph=el("section","ws-graph");graph.id="ws-graph";graph.hidden=true;
  const graphbar=el("header","ws-graph-bar"),graphTitle=el("div");graphTitle.append(el("strong","",msg("Wiki graph")));const summary=el("small","ws-muted");summary.id="ws-graph-summary";summary.setAttribute("role","status");graphTitle.append(summary);
  const controls=el("div","ws-graph-controls");controls.append(button(msg("Zoom in"),()=>state.graphView&&state.graphView.zoom(1.25),"zoom-in"),button(msg("Zoom out"),()=>state.graphView&&state.graphView.zoom(0.8),"zoom-out"),button(msg("Fit graph"),()=>state.graphView&&state.graphView.fit(),"maximize"),button(msg("Refresh"),()=>renderGraph(),"refresh-cw"),button(msg("Close graph"),()=>{hideGraph();if(state.active)activate(state.active);else renderEmpty();},"x"));graphbar.append(graphTitle,controls);
  const canvas=el("div","ws-graph-canvas");canvas.id="ws-graph-canvas";const wikiList=el("div","ws-graph-wikis");wikiList.id="ws-graph-wikis";graph.append(graphbar,wikiList,canvas,el("p","ws-graph-help ws-muted",msg("Click a file to open it. Select wikis above. Dashed lines connect different wikis. Drag to move and scroll to zoom.")));
  const sourceViewer=el("section","ws-source-viewer");sourceViewer.id="ws-source-viewer";sourceViewer.hidden=true;main.append(tabs,bar,empty,doc,sourceViewer,graph,statusbar);const home=el("main","ws-settings-home");home.id="ws-settings-home";home.hidden=true;root.append(rail,side,main,home);sidebarResize(side,'left');sidebarResize(props,'right');applyEditor();
  state.sheet=global.writingSurface(editor);state.sheet.listen(changed);global.document.addEventListener('selectionchange',toolbarState);editor.addEventListener("click",liveLink);editor.addEventListener("mousedown",toggleTask);editor.addEventListener("keyup",drawCompletions);
  global.document.addEventListener("keydown",event=>{
    if(currentEditor()==="obsidian"||global.document.querySelector("dialog[open]"))return;
    const mod=event.ctrlKey||event.metaKey;
    if(mod&&event.key.toLowerCase()==="s"){event.preventDefault();saveActive().catch(report);}
    if(mod&&event.key.toLowerCase()==="p"){event.preventDefault();focusSearch();}
    if(state.active&&state.active.viewer)return;
    if(mod&&event.key.toLowerCase()==="f"&&!global.document.querySelector("dialog[open]")){event.preventDefault();findDialog();}
    if(mod&&['b','i'].includes(event.key.toLowerCase())&&state.active&&[at('ws-editor'),at('ws-source')].some(n=>n===event.target||n.contains(event.target))){event.preventDefault();applyForm(event.key.toLowerCase()==="b"?"bold":"italic");}
    if(mod&&event.key.toLowerCase()==="z"&&state.active&&state.mode==="live"){event.preventDefault();if(event.shiftKey)state.sheet.redo();else state.sheet.undo();}
  });
  global.addEventListener("beforeunload",event=>{collect();if(state.tabs.some(t=>t.text!==t.origin)){event.preventDefault();event.returnValue="";}});
  global.addEventListener("focus",()=>{if(state.root&&state.data&&state.connection)refreshProject().catch(report);});
  if(!F().carriesFolders())status(msg("Open this file in Chrome or Edge to grant local folder access and save directly."));
  state.reviewTimer=setInterval(()=>{if(!state.graphOpen&&!global.document.hidden&&!global.document.querySelector("dialog[open]"))pollReviews().catch(report);},12000);
  global.addEventListener('hashchange',()=>Promise.resolve(openEvidenceFragment()).catch(report));
  renderTree();restore().then(()=>openEvidenceFragment()).catch(report);
}
async function restore(){
 if(global.EditorHost)at('workspace-app').inert=true;try{
  const binding=entryBinding();
  state.instance=binding.instance;
  for(const id of ['ws-editor','ws-source']){
   const node=at(id);
   node.addEventListener('paste',event=>{const files=Array.from(event.clipboardData?.files||[]);if(!files.length)return;event.preventDefault();event.stopImmediatePropagation();const span=state.mode==='source'?{from:node.selectionStart,to:node.selectionEnd}:global.writingSpan(node);attachImages(files,span).catch(report);},true);
   node.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();});
   node.addEventListener('drop',event=>{const files=Array.from(event.dataTransfer?.files||[]);if(!files.length)return;event.preventDefault();attachImages(files,state.mode==='source'?{from:node.selectionStart,to:node.selectionEnd}:global.writingSpan(node)).catch(report);});
  }
  at('ws-editor').addEventListener('writing-render',()=>requestAnimationFrame(renderLiveAssets));
  const embedded=entrySettings();
  if(embedded){state.data=embedded;readPendingDetached();state.data=withoutPendingDetached(embedded);state.connection=state.data.connections[0]?.id||null;restoreInventory();renderHeader();renderTree();applyEditor();}
  let root=global.EditorHost?await global.EditorHost.root():await recallHandle(binding.key);
  if(!root&&binding.id)root=await recallHandle(projectRootKey(binding.id));
  if(!root&&!binding.entry)root=await recallHandle("workspace-root");
  if(!root&&binding.instance&&binding.id){
    for(const key of ['workspace-entry/'+encodeURIComponent(global.location.pathname),'workspace-project/'+encodeURIComponent(binding.id)]){
      const legacy=await recallHandle(key);if(!legacy||await F().permissionState(legacy,'read')!=='granted')continue;
      try{const loaded=await P().read(legacy);checkProject(loaded);if(await legacyBrowserPermission(legacy,loaded)){root=legacy;break;}}catch(_){/* A candidate is never authoritative before identity and migration checks. */}
    }
  }
  // The HTML contains saved assignments, not proof of current browser access.
  // A new setup may reuse folder IDs; do not revive handles before reading disk.
  if(!root){if(binding.id)showProjectAccess(null);return;}
  if(await F().permissionState(root,"read")!=="granted"){showProjectAccess(root);return;}
  try{const loaded=await P().read(root);if(!loaded.data){await clearUnavailableProject();return;}await loadProject(root,loaded);}
  catch(error){showProjectAccess(root);report(error);}
 }catch(error){if(global.EditorHost&&!state.root)showProjectAccess(null);throw error;}finally{if(global.EditorHost)at('workspace-app').inert=false;}
}
async function clearUnavailableProject(){
  state.projectBlocked=true;syncEpoch++;
  let draftFailure=null;try{await preserveDrafts();}catch(error){draftFailure=error;}
  state.root=null;state.seen=null;state.handles.clear();state.files.clear();
  // Keep the verified/embedded assignments and any open draft. A missing or
  // moved project folder must never masquerade as a deliberately empty setup.
  if(!state.data){const embedded=entrySettings();if(embedded)state.data=withoutPendingDetached(embedded);}
  renderHeader();renderTree();renderTabs();if(!state.active)renderEmpty();showProjectAccess(null);
  if(draftFailure)throw draftFailure;
  status(msg('The project folder could not be verified. Your saved assignments and drafts are kept. Open the correct project folder.'));
}
function showProjectAccess(root){
  if(global.EditorHost){const empty=at('ws-empty');empty.replaceChildren(el('p','','Der Zugriff auf die gespeicherten Ordner ist noch nicht bestätigt.'),button(msg('Allow access'),()=>requestProjectAccess(),null,'ws-primary'));return;}
  state.accessRoot=root;
  const empty=at("ws-empty");empty.replaceChildren(icon("folder"),el("h1","",msg("Open your connected project")),el("p","",msg("This start file contains saved folder assignments. Allow project access to verify them and show the current files.")));
  projectAccessHint(empty);
  if(root)empty.append(button(msg("Allow folder access"),async()=>{
    if(await F().grantPermission(root,"readwrite")!=="granted")throw global.I18n.error(msg("Folder permission is missing."));
    await loadProject(root,await P().read(root));if(await nextAccess())await guidedAccess();status("");
  },null,"ws-primary"));
  if(!root)empty.append(button(msg("Open project folder"),chooseProject));
  status("");
}
let refreshRunning=false;
if(typeof global.document!=='undefined')setInterval(async()=>{
 if(refreshRunning||!state.root||global.document.hidden||state.reviewBusy||global.document.querySelector('dialog[open]'))return;
 refreshRunning=true;try{if(state.graphOpen){await renderGraph();return;}await refreshProject();await synchronizeWikis();await refresh();}catch(error){report(error);}finally{refreshRunning=false;}
},15000);
global.Workspace={tree,searchText,targetPath,changedLines,canWrite,editorMode,build};
if(typeof global.document!=="undefined")global.document.addEventListener("DOMContentLoaded",build);
})(typeof globalThis === "object" ? globalThis : this);
