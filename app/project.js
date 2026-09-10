/* Shared on-disk settings. Same closed contract as shared/projects.py. */
(function (global) {
"use strict";
const msg=(key,values)=>global.I18n.message(key,values);
const NAME = "llmwiki.project.json";
const FORMAT = "llmwiki-project/1";
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const ROOT_ICONS=['folder','book','book-open','user','users','briefcase','library','archive','database'];
function keys(value, required, optional=[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(k => !required.includes(k) && !optional.includes(k)) || required.some(k => !Object.hasOwn(value, k))) {
    throw global.I18n.error(msg("Unknown or missing project settings."));
  }
}
function label(value) { return typeof value === "string" && value.trim().length > 0 && value.length <= 240; }
function validate(data) {
  keys(data, ["format", "id", "label", "folders", "connections"], ["editor"]);
  if(Object.hasOwn(data,"editor") && !["builtin","obsidian","both"].includes(data.editor))throw global.I18n.error(msg("Choose an editor."));
  if (data.format !== FORMAT || typeof data.id !== "string" || !ID.test(data.id) || !label(data.label)) throw global.I18n.error(msg("Project ID or name is missing."));
  if (!Array.isArray(data.folders) || data.folders.length > 200) throw global.I18n.error(msg("Choose the project folders."));
  const folders = new Map();
  for (const f of data.folders) {
    keys(f, ["id", "label", "kind", "path", "writable", "readers", "writers"],['icon']);
    if(f.icon!==undefined&&!ROOT_ICONS.includes(f.icon))throw new Error('Choose a supported root icon.');
    if (typeof f.id !== "string" || !ID.test(f.id) || folders.has(f.id) || !label(f.label)) throw global.I18n.error(msg("Folder IDs must be unique."));
    if (!["wiki", "work", "source"].includes(f.kind) || typeof f.writable !== "boolean") throw global.I18n.error(msg("Folder type or write permission is missing."));
    if (f.path !== null && (typeof f.path !== "string" || !f.path || /[\\:\x00]/.test(f.path) || (f.path !== "." && f.path.split("/").some(p => !p || p === ".." || p === ".")))) throw global.I18n.error(msg("Folder paths must be within the project. External folders are bound on this device."));
    for (const key of ["readers", "writers"]) if (!Array.isArray(f[key]) || f[key].length > 100 || !f[key].every(label)) throw global.I18n.error(msg("Name the people or groups who may access this folder."));
    if (!f.readers.length || (f.writable && !f.writers.length)) throw global.I18n.error(msg("Name the readers and, when writing is enabled, the writers."));
    folders.set(f.id, f);
  }
  if (!Array.isArray(data.connections) || data.connections.length > 200) throw global.I18n.error(msg("Create at least one connection."));
  const seen = new Set();
  for (const c of data.connections) {
    keys(c, ["id", "label", "wiki", "works", "sources", "mode"],['default_source']);
    if(c.default_source!=null&&!c.sources.includes(c.default_source))throw new Error('Default source must belong to this wiki.');
    if (typeof c.id !== "string" || !ID.test(c.id) || seen.has(c.id) || !label(c.label)) throw global.I18n.error(msg("Connections need unique IDs and names."));
    seen.add(c.id);
    if (!["eigen", "gemeinsam"].includes(c.mode)) throw global.I18n.error(msg("Choose whether others write to the wiki."));
    if (!folders.has(c.wiki) || folders.get(c.wiki).kind !== "wiki") throw global.I18n.error(msg("Choose a wiki for this connection."));
    for (const [key, kind] of [["works", "work"], ["sources", "source"]]) {
      if (!Array.isArray(c[key]) || (key === "works" && !c[key].length) || new Set(c[key]).size !== c[key].length || c[key].some(id => !folders.has(id) || folders.get(id).kind !== kind)) throw global.I18n.error(msg("Choose the matching working and source folders."));
    }
    const overlaps=(a,b)=>a!==null&&b!==null&&(a===b||a==="."||b==="."||a.startsWith(b+"/")||b.startsWith(a+"/"));
    const wiki=folders.get(c.wiki);
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
  validate(data);
  const done = await global.FolderAccess.writeFile(root, NAME, JSON.stringify(data, null, 2) + "\n", seen);
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
global.ProjectSettings = {NAME, FORMAT, ROOT_ICONS, validate, read, save, relative, resolve, bindingKey};
})(typeof globalThis === "object" ? globalThis : this);
