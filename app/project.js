/* Shared on-disk settings. Same closed contract as shared/projects.py. */
(function (global) {
"use strict";
const msg=(key,values)=>global.I18n.message(key,values);
const NAME = "llmwiki.project.json";
const FORMAT = "llmwiki-project/2";
const LEGACY_FORMAT = "llmwiki-project/1";
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const ROOT_ICONS=['folder','book','book-open','user','users','briefcase','library','archive','database'];
function keys(value, required, optional=[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(k => !required.includes(k) && !optional.includes(k)) || required.some(k => !Object.hasOwn(value, k))) {
    throw global.I18n.error(msg("Unknown or missing project settings."));
  }
}
function label(value) { return typeof value === "string" && value.trim().length > 0 && value.length <= 240; }
const circle=value=>Array.isArray(value)&&value.length>0&&value.length<=100&&value.every(label);
function fail(code,message){throw Object.assign(global.I18n.error(msg(message)),{code});}
function validate(data) {
  const modern=data?.format===FORMAT;
  keys(data, ["format", "id", "label", "folders", "connections"], ["editor",...(modern?["readers"]:[])]);
  if(data.readers!==undefined&&!circle(data.readers))fail('project_readers','Name the project folder reader circle.');
  if(Object.hasOwn(data,"editor") && !["builtin","obsidian","both"].includes(data.editor))throw global.I18n.error(msg("Choose an editor."));
  if (![FORMAT,LEGACY_FORMAT].includes(data.format) || typeof data.id !== "string" || !ID.test(data.id) || !label(data.label)) throw global.I18n.error(msg("Project ID or name is missing."));
  if (!Array.isArray(data.folders) || data.folders.length > 200) throw global.I18n.error(msg("Choose the project folders."));
  const folders = new Map();
  for (const f of data.folders) {
    keys(f, ["id", "label", "kind", "path", "writable", "readers", "writers"],['icon',...(modern?['readers_confirmed']:[])]);
    if(f.readers_confirmed!==undefined&&(f.kind!=='work'||typeof f.readers_confirmed!=='boolean'))fail('work_readers','Confirm the reader circle of this working folder.');
    if(f.icon!==undefined&&!ROOT_ICONS.includes(f.icon))throw new Error('Choose a supported root icon.');
    if (typeof f.id !== "string" || !ID.test(f.id) || folders.has(f.id) || !label(f.label)) throw global.I18n.error(msg("Folder IDs must be unique."));
    if (!["wiki", "work", "source"].includes(f.kind) || typeof f.writable !== "boolean") throw global.I18n.error(msg("Folder type or write permission is missing."));
    if (f.path !== null && (typeof f.path !== "string" || !f.path || /[\\:\x00]/.test(f.path) || (f.path !== "." && f.path.split("/").some(p => !p || p === ".." || p === ".")))) throw global.I18n.error(msg("Folder paths must be within the project. External folders are bound on this device."));
    for (const key of ["readers", "writers"]) if (!Array.isArray(f[key]) || f[key].length > 100 || !f[key].every(label)) throw global.I18n.error(msg("Name the people or groups who may access this folder."));
    if (!f.readers.length || (f.writable && !f.writers.length)) throw global.I18n.error(msg("Name the readers and, when writing is enabled, the writers."));
    folders.set(f.id, f);
  }
  if (!Array.isArray(data.connections) || data.connections.length > 200) throw global.I18n.error(msg("Create at least one connection."));
  const seen = new Set(),fullWorks=new Set(),fullPaths=[],bundleWikis=new Map();
  const overlaps=(a,b)=>a!==null&&b!==null&&(a===b||a==="."||b==="."||a.startsWith(b+"/")||b.startsWith(a+"/"));
  for (const c of data.connections) {
    keys(c, ["id", "label", "wiki", "works", "sources", "mode"],['default_source',...(modern?['scope','bundle_id','readers','comments','participation']:[])]);
    const scope=c.scope??'full';
    if(!['full','contributions','participation'].includes(scope))fail('connection_scope','Choose full synchronization, contributions or participation.');
    if(scope==='participation'&&(!c.participation||Object.keys(c.participation).some(k=>k!=='field')||!/^x_[a-z][a-z0-9_]*$/.test(c.participation.field)))fail('participation_field','Choose the registered participation field.');
    if(c.comments!==undefined&&typeof c.comments!=='boolean')fail('connection_comments','Choose whether comments travel to this target.');
    if((scope==='contributions'||c.bundle_id!==undefined)&&!(typeof c.bundle_id==='string'&&ID.test(c.bundle_id)))fail('bundle_id_required','Read and retain the target bundle identity.');
    if((scope==='contributions'||c.readers!==undefined)&&!circle(c.readers))fail('audience_required','Read and retain the target reader circle.');
    if(c.bundle_id!==undefined){if(bundleWikis.has(c.bundle_id)&&bundleWikis.get(c.bundle_id)!==c.wiki)fail('bundle_id_collision','Different wiki folders have the same bundle identity.');bundleWikis.set(c.bundle_id,c.wiki);}
    if(c.default_source!=null&&!c.sources.includes(c.default_source))throw new Error('Default source must belong to this wiki.');
    if (typeof c.id !== "string" || !ID.test(c.id) || seen.has(c.id) || !label(c.label)) throw global.I18n.error(msg("Connections need unique IDs and names."));
    seen.add(c.id);
    if (!["eigen", "gemeinsam"].includes(c.mode)) throw global.I18n.error(msg("Choose whether others write to the wiki."));
    if (!folders.has(c.wiki) || folders.get(c.wiki).kind !== "wiki") throw global.I18n.error(msg("Choose a wiki for this connection."));
    for (const [key, kind] of [["works", "work"], ["sources", "source"]]) {
      if (!Array.isArray(c[key]) || (key === "works" && !c[key].length) || new Set(c[key]).size !== c[key].length || c[key].some(id => !folders.has(id) || folders.get(id).kind !== kind)) throw global.I18n.error(msg("Choose the matching working and source folders."));
    }
    if(scope==='full')for(const id of c.works){const path=folders.get(id).path;if(fullWorks.has(id)||path!==null&&fullPaths.some(other=>overlaps(path,other)))fail('work_full_collision','A working folder may have only one full synchronization connection.');fullWorks.add(id);if(path!==null)fullPaths.push(path);}
    const wiki=folders.get(c.wiki);
    if(scope==='contributions'){
      if(!data.readers)fail('project_readers_unconfirmed','Confirm who can read the project folder before connecting contributions.');
      if(data.readers.length!==1||!c.works.every(id=>folders.get(id).writers.includes(data.readers[0])))fail('project_readers_shared','Contributions require a private project folder.');
    }else if(data.readers){
      const personal=data.readers.length===1&&c.works.every(id=>folders.get(id).writers.includes(data.readers[0]));
      if(!personal&&data.readers.some(reader=>!wiki.readers.includes(reader)))fail('reader_scope','The project folder reader circle exceeds the wiki reader circle.');
    }
    for(const id of c.works)if(c.mode==="gemeinsam"&&overlaps(wiki.path,folders.get(id).path))throw global.I18n.error(msg("The shared wiki and working folder must be separate."));
    for(const id of c.sources){const source=folders.get(id);if([wiki,...c.works.map(k=>folders.get(k))].some(f=>overlaps(source.path,f.path)))throw global.I18n.error(msg("Sources must not be inside a wiki or working folder, or contain either."));}
  }
  return data;
}
async function read(root) {
  const seen = await global.FolderAccess.peek(root, NAME);
  if (seen === null) return {data: null, seen: null};
  if (typeof seen.text !== "string") throw global.I18n.error(msg("No read permission for project settings."));
  if (seen.text.length > 1048576) throw global.I18n.error(msg("Project settings are too large."));
  return {data: validate(JSON.parse(seen.text)), seen: seen};
}
async function save(root, data, seen) {
  const next={...data,format:FORMAT};validate(next);
  const done = await global.FolderAccess.writeFile(root, NAME, JSON.stringify(next, null, 2) + "\n", seen);
  if (!done.saved) throw global.I18n.error(msg("Settings were not saved. Reopen them: someone changed them or write permission is missing."));
  return done;
}
async function relative(root, dir) {
  const parts = await root.resolve(dir);
  return parts === null ? null : parts.length ? parts.join("/") : ".";
}
function bindingKey(project, folder){return "project/"+encodeURIComponent(project)+"/"+encodeURIComponent(folder);}
async function resolve(root, f, project, recall=global.FolderAccess.recallFolder) {
  if (f.path === null) return recall(bindingKey(project, f.id));
  if (!root) return null;
  let dir = root;
  if (f.path !== ".") for (const part of f.path.split("/")) dir = await dir.getDirectoryHandle(part);
  return dir;
}
function connectionMeta(project,c,work,{target,home,ownerWiki=null,sources=[]}){
 const same=(a,b)=>JSON.stringify([...new Set(a??[])].sort())===JSON.stringify([...new Set(b??[])].sort());
 const full=project.connections.find(candidate=>(candidate.scope??'full')==='full'&&candidate.works.includes(work.id)),ownerFolder=full&&project.folders.find(f=>f.id===full.wiki),wiki=project.folders.find(f=>f.id===c.wiki);
 const effectiveReaders=work.path===null?(work.readers_confirmed===true?work.readers:null):project.readers,declared=work.writers.length===1?work.writers[0]:null;
 const author=declared&&same(effectiveReaders,[declared])&&same(work.readers,[declared])?declared:null;
 return {target:{bundle_id:c.bundle_id??target?.bundle_id??null,readers:c.readers??target?.readers??null,current_bundle_id:target?.bundle_id??null,current_readers:target?.readers??null,title:target?.title??wiki.label},owner:{bundle_id:home?.bundle_id??null,readers:home?.readers??null,authors:ownerFolder?.writers??work.writers,wiki:ownerWiki,connection:full?.id??null,work_readers:effectiveReaders??null},author,sources,comments:c.comments??false};
}
function syncIdentity(project,wiki,work,connection){const parts=[project.id,wiki.id,wiki.path,work.id,work.path];if(connection?.scope&&connection.scope!=='full')parts.push(connection.id,connection.scope,connection.bundle_id??null);return JSON.stringify(parts);}
global.ProjectSettings = {NAME, FORMAT, ROOT_ICONS, validate, read, save, relative, resolve, bindingKey,connectionMeta,syncIdentity};
})(typeof globalThis === "object" ? globalThis : this);
