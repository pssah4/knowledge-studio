// The folder access of the surface: one directory handle, kept in the browser
// store, found again after a restart, granted again by a click, read from,
// written to and watched.
//
// A classic script and never a module. From a page opened out of the file
// system only a neighbouring script src loads; a dynamic import and a call
// over the network both fail there, measured in the browser family this
// surface runs in (ADR-08). The file hangs one name into the page and asks
// for nothing else: no library, no store outside the machine, no build step.
//
// The tables below are written JSON-shaped, with quoted keys and without a
// trailing comma, because the bench under tests/ reads them without a
// JavaScript engine. The hide list is the list of ADR-18 and is measured
// against llmwiki/shared/places.py entry by entry; the name rules are measured
// against llmwiki/sync/notes.py the same way. Neither is restated here as
// a second truth, both are carried a second time because a browser cannot
// read a Python module.
//
// Writing is not a given. Between the read a person edits from and the write
// that follows lie 0,8 ms in which another editor can save, measured. The
// path therefore reads again right before writing, writes, and reads back
// right after; only a read-back that carries what was written reports saved.
// Anything else lays the place before the person again and says so.
//
// createWritable puts an intermediate file <name>.crswap beside the target,
// in the same folder, and takes it away when it closes. It is on the hide
// list, because a run that stumbled over it would report a file nobody wrote.
//
// The handle survives a restart of the browser in the store; the permission
// does not. queryPermission answers prompt after such a restart, and
// requestPermission counts only inside a click handler. The surface says that
// in one sentence rather than keeping quiet about it.
//
// The store holds a second room, for what somebody wrote and has not saved.
// It has to lie outside the bundle (ASR-05) and it has to outlive a closed
// window and a restarted device (SC-06), and the browser profile is the one
// place on this side that is both: no run over the bundle can find it, and
// nothing inside the page survives the restart. A record carries the text and
// the text it was written over. The second half is the one that is easy to
// leave out and expensive to miss: without it a save after a restart would
// compare the file against itself and write straight over what somebody else
// saved in the meantime, so the record keeps the older text and the write path
// sees two edits (SC-07). One record per file of one bundle, taken away once a
// save went through.
//
// Two views of the same bundle agree over navigator.locks and tell each other
// over BroadcastChannel. Both carry only inside one browser profile: a second
// browser, a second profile and another device see neither of them, and the
// write path is built so that this costs nothing but a repeated read.
//
// Where the folder lies on the machine is not readable. A directory handle
// answers a name and nothing else, and no line here asks for more.

(function (global) {
"use strict";

// The tool's own name, as the runs write it. No name here carries an
// organisation, and none carries the base this project was built on.
const TOOL = "llmwiki";

// Where a bundle keeps its contract. The folder is confirmed by a file inside
// it, never by its name and never by where it lies.
const CONTRACT_PATH = "schema/CONTRACT.md";

// The browser store. One key per bundle, so two bundles opened from the same
// profile never read each other's handle. The second room holds what somebody
// wrote and has not saved (FEAT-08-07, SC-06): it lies in the profile of the
// browser and in no folder, which is what ASR-05 asks for, and it outlives the
// closed window and the restarted device, which nothing inside the page does.
// The version rose with that room, so a store built before it is lifted on the
// next open and keeps every handle it already held.
const DB_NAME = "llmwiki-folders";
const DB_VERSION = 2;
const STORE = "handles";
const DRAFTS = "drafts";
const ROOMS = ["handles", "drafts"];

// The hide list of ADR-18, first the entries this tool owns, then the files
// the sync clients put down themselves. An entry ending in a slash hides a
// folder with everything under it; every other entry is matched against each
// name on the way.
const HIDE_OWN = [
  "LLM-Wiki.html",
  "notices/",
  "vermerke/",
  ".llmwiki/",
  ".obsidian/",
  ".llmwiki-einbringen",
  "*.crswap",
  "*.tmp.driveupload",
  "~$*",
  ".syncthing.*.tmp"
];

const CLIENT_MARKERS = [
  ".849C9593-D756-4E56-8D6E-42412F2A707B",
  ".dropbox",
  ".dropbox.attr",
  ".dropbox.cache",
  ".stfolder",
  ".stversions",
  ".stignore",
  ".tmp.drivedownload",
  ".owncloudsync.log",
  ".sync_*.db",
  ".*.icloud",
  "desktop.ini"
];

const HIDDEN = HIDE_OWN.concat(CLIENT_MARKERS);

// What the browser leaves beside a target while it writes.
const SWAP_SUFFIX = ".crswap";

// Characters a name may not carry: the separators of both platforms and the
// ones a platform refuses. Everything below a space is no name either.
const UNSAFE_IN_NAME = ["/", "\\", ":", "*", "?", "\"", "<", ">", "|"];
const CONTROL_LIMIT = 32;

// What may stand in the handle part of a written name, and how long it may
// be. Everything else becomes a hyphen, the underscore included, so the parts
// of a name stay readable.
const HANDLE_KEEP = "A-Za-z0-9.-";
const HANDLE_LIMIT = 60;

// The three things the surface writes and where each of them goes. A page
// stands where a walk sees it; a note and an order stand where none does.
const PLACES = {
  "page": "",
  "note": "notices",
  "order": ".llmwiki/outbox"
};

// The running number of an order is its order. Six digits, and a number that
// outgrows them is refused rather than written where it sorts wrong.
const ORDER_WIDTH = 6;

// The states of the write path. Held is what a person edits from, checked is
// what a fresh read agreed to, written is out but unread, verified is read
// back. Stale and mismatch are the two ways of disagreeing, blocked is a
// missing permission and refused is a name the rules do not carry.
const STATES = [
  "idle",
  "held",
  "checked",
  "written",
  "verified",
  "stale",
  "mismatch",
  "blocked",
  "refused"
];

// What happens to a write path. Same and other are the answer of a
// comparison, and both comparisons ask the same question: does what lies
// there carry what we think it carries.
const EVENTS = [
  "read",
  "same",
  "other",
  "write",
  "present",
  "release",
  "denied",
  "grant",
  "unnamed"
];

const TRANSITIONS = {
  "idle": {"read": "held", "denied": "blocked", "unnamed": "refused"},
  "held": {"same": "checked", "other": "stale"},
  "checked": {"write": "written", "denied": "blocked"},
  "written": {"same": "verified", "other": "mismatch"},
  "verified": {"release": "idle"},
  "stale": {"present": "held"},
  "mismatch": {"present": "held"},
  "blocked": {"grant": "idle"},
  "refused": {"present": "idle"}
};

// The one state that reports saved. Nothing else does, and nothing reaches it
// except through the read before the write and the read-back after it.
const SAVED_STATE = "verified";

// The states a run ends in and a person sees.
const OUTCOMES = ["verified", "stale", "mismatch", "blocked", "refused"];

// Everything a person reads. German, because a person reads it; the words of
// version control are absent by rule, and so are the two long dashes.
const MESSAGES = {
  "verified": "Gespeichert und zurückgelesen: auf der Platte steht jetzt genau das, was du geschrieben hast.",
  "stale": "An dieser Datei hat inzwischen jemand anders gespeichert; hier ist die Stelle noch einmal, so wie sie jetzt auf der Platte steht.",
  "mismatch": "Auf der Platte steht nicht, was eben geschrieben wurde; die Stelle liegt dir noch einmal vor, und gespeichert ist sie nicht.",
  "blocked": "Für diesen Ordner liegt gerade keine Erlaubnis vor, und ohne sie liest und schreibt diese Seite nichts.",
  "refused": "Dieser Name trägt ein Zeichen, das ein Ordner nicht führen kann; wähl einen anderen, geändert wird er hier nicht.",
  "permission": "Der Ordner ist noch gebunden, nur die Erlaubnis dafür ist nach dem Neustart des Browsers wieder fällig: ein Klick auf Ordner freigeben, und du arbeitest weiter.",
  "where": "Wo dieser Ordner auf dem Gerät liegt, sieht die Seite nicht; sie kennt ihn unter dem Namen, den das Fenster beim Freigeben gezeigt hat.",
  "unsupported": "Dieser Browser gibt der Seite keinen Ordner frei; trag den Arbeitsordner von Hand in die Einstellungsdatei ein, dann läuft alles Weitere wie sonst.",
  "watching": "Der Ordner wird beobachtet: was ein anderes Werkzeug hier ablegt, taucht von selbst auf.",
  "polling": "Dieser Browser meldet Änderungen im Ordner nicht von selbst; die Seite sieht deshalb alle paar Sekunden nach.",
  "busy": "Eine zweite Ansicht dieses Bündels schreibt gerade; sobald sie fertig ist, geht es hier weiter.",
  "elsewhere": "Eine zweite Ansicht dieses Bündels hat diese Datei geschrieben; hier steht der neue Stand."
};

// How the folder is watched. The first way is asked for and never assumed;
// where it is missing, the second one looks.
const WATCH_OBSERVER = "observer";
const WATCH_POLL = "poll";

// A listing of 1.000 files costs 6,4 ms, measured, because it reads names and
// never content. Every few seconds is affordable at that price.
const POLL_MS = 4000;

// ---------------------------------------------------------------- the list

// Built once per entry of the list. Without a prototype, so a name that
// happens to read like one of its members finds nothing here.
const PATTERNS = Object.create(null);

function escaped(symbol) {
  return ".*+?^${}()|[]\\".indexOf(symbol) === -1 ? symbol : "\\" + symbol;
}

// Translated the way the Python side translates: a run of any characters, one
// single character, and everything else stands for itself. No entry of the
// list carries a character class, and the bench holds the list to that. The
// comparison is case sensitive, as it is on the machines this runs on.
function matches(name, pattern) {
  let expression = PATTERNS[pattern];
  if (expression === undefined) {
    let built = "^";
    for (let index = 0; index < pattern.length; index += 1) {
      const symbol = pattern.charAt(index);
      if (symbol === "*") {
        built += "[\\s\\S]*";
      } else if (symbol === "?") {
        built += "[\\s\\S]";
      } else {
        built += escaped(symbol);
      }
    }
    expression = new RegExp(built + "$");
    PATTERNS[pattern] = expression;
  }
  return expression.test(name);
}

// The parts of a name, as the Python side reads them: an empty part and a
// single dot carry nothing and fall away.
function parts(name) {
  return String(name).split("/").filter(function (part) {
    return part !== "" && part !== ".";
  });
}

function isHidden(name) {
  const walk = parts(name);
  for (let index = 0; index < HIDDEN.length; index += 1) {
    const entry = HIDDEN[index];
    if (entry.charAt(entry.length - 1) === "/") {
      if (walk.indexOf(entry.slice(0, entry.length - 1)) !== -1) {
        return true;
      }
    } else {
      for (let step = 0; step < walk.length; step += 1) {
        if (matches(walk[step], entry)) {
          return true;
        }
      }
    }
  }
  return false;
}

// --------------------------------------------------------------- the names

// The name a write may use, or nothing. A name the rules do not carry is
// refused and never repaired: a repaired name would write somewhere the
// person did not ask for.
function writableName(name) {
  const walk = parts(name);
  if (walk.length === 0) {
    return null;
  }
  for (let index = 0; index < walk.length; index += 1) {
    const part = walk[index];
    if (part === "..") {
      return null;
    }
    if (part.length > SWAP_SUFFIX.length &&
        part.slice(part.length - SWAP_SUFFIX.length) === SWAP_SUFFIX) {
      return null;
    }
    for (let step = 0; step < part.length; step += 1) {
      if (part.charCodeAt(step) < CONTROL_LIMIT) {
        return null;
      }
      if (UNSAFE_IN_NAME.indexOf(part.charAt(step)) !== -1) {
        return null;
      }
    }
  }
  return walk.join("/");
}

// The handle as a written name may carry it. The head of a file keeps the
// real one; this is only the part that has to survive a folder.
function handleSegment(by) {
  const cleaned = String(by).replace(new RegExp("[^" + HANDLE_KEEP + "]+", "g"), "-");
  let start = 0;
  let end = cleaned.length;
  while (start < end && cleaned.charAt(start) === "-") {
    start += 1;
  }
  while (end > start && cleaned.charAt(end - 1) === "-") {
    end -= 1;
  }
  return cleaned.slice(start, end).slice(0, HANDLE_LIMIT);
}

// The name of one order in the queue: the running number, the device, and
// nothing a person has to read. One consumer per device reads it back.
function orderName(number, device) {
  const segment = handleSegment(device);
  if (segment === "") {
    return null;
  }
  if (typeof number !== "number" || !isFinite(number) || number < 0) {
    return null;
  }
  if (Math.floor(number) !== number) {
    return null;
  }
  let padded = String(number);
  if (padded.length > ORDER_WIDTH) {
    return null;
  }
  while (padded.length < ORDER_WIDTH) {
    padded = "0" + padded;
  }
  return PLACES.order + "/" + padded + "_" + segment + ".json";
}

// The running number of an order, read back out of its file name. A name that
// does not stand in the queue, or carries no six digit number where one
// belongs, is not an order of this queue and answers nothing: a guess here
// would let any file somebody dropped in push the next number forward.
function orderNumber(name) {
  const whole = String(name);
  const start = PLACES.order + "/";
  if (whole.slice(0, start.length) !== start) {
    return null;
  }
  const rest = whole.slice(start.length);
  const cut = rest.indexOf("_");
  if (cut !== ORDER_WIDTH || !rest.endsWith(".json")) {
    return null;
  }
  const digits = rest.slice(0, cut);
  if (!/^[0-9]+$/.test(digits)) {
    return null;
  }
  return Number(digits);
}

// Every order that already lies in the queue, in the order of its numbers.
// The queue is hidden, so the walk of listFolder never reaches it and this is
// its own way in. A queue nobody has written to yet is empty and never an
// error: the folder is laid down by the first order and not before.
async function listOrders(dir) {
  const walk = PLACES.order.split("/");
  let here = dir;
  for (let index = 0; index < walk.length; index += 1) {
    try {
      here = await here.getDirectoryHandle(walk[index]);
    } catch (error) {
      return [];
    }
  }
  const found = [];
  for await (const entry of here.values()) {
    if (entry.kind === "directory") {
      continue;
    }
    const name = PLACES.order + "/" + entry.name;
    const number = orderNumber(name);
    if (number === null) {
      continue;
    }
    found.push({"name": name, "number": number});
  }
  found.sort(function (one, other) { return one.number - other.number; });
  return found;
}

// A local fingerprint and never the checksum of a bundle. It stays inside
// this page, is never written into a file and never held against one a run
// wrote. Synchronous on purpose: a listing that had to wait for a promise per
// file would cost the page its speed, and the store that offers one is out.
function fingerprint(text) {
  let sum = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    sum = sum ^ text.charCodeAt(index);
    sum = Math.imul(sum, 16777619);
  }
  return sum >>> 0;
}

function markOf(text, file) {
  return {"size": file.size, "at": file.lastModified, "sum": fingerprint(text)};
}

// --------------------------------------------------------------- the store

function openStore() {
  return new Promise(function (resolve, reject) {
    const request = global.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = function () {
      ROOMS.forEach(function (room) {
        if (!request.result.objectStoreNames.contains(room)) {
          request.result.createObjectStore(room);
        }
      });
    };
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () { reject(request.error); };
  });
}

function storeKey(bundle) {
  const name = writableName(bundle);
  return name === null ? null : TOOL + ":" + name;
}

// A draft belongs to one file of one bound folder. Both halves go through the
// name rules, so a name the rules refuse keeps no draft rather than a draft
// under a repaired name.
function draftKey(bundle, name) {
  const folder = storeKey(bundle);
  const file = writableName(name);
  return folder === null || file === null ? null : folder + ":" + file;
}

function asked(store, work) {
  return new Promise(function (resolve, reject) {
    const request = work(store);
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () { reject(request.error); };
  });
}

async function inStore(mode, work, room) {
  const which = room === undefined ? STORE : room;
  const base = await openStore();
  try {
    const deal = base.transaction(which, mode);
    const committed=new Promise((resolve,reject)=>{deal.oncomplete=resolve;deal.onabort=()=>reject(deal.error||new Error('Folder cache transaction aborted'));deal.onerror=()=>reject(deal.error);});
    const [value]=await Promise.all([asked(deal.objectStore(which),work),committed]);return value;
  } finally {
    base.close();
  }
}

// The handle keeps its own kind in the store; nothing about the folder is
// written down beside it, because nothing else about it is readable.
async function rememberFolder(bundle, handle) {
  const key = storeKey(bundle);
  if (key === null) {
    return false;
  }
  await inStore("readwrite", function (store) { return store.put(handle, key); });
  return true;
}

async function recallFolder(bundle) {
  const key = storeKey(bundle);
  if (key === null) {
    return null;
  }
  const found = await inStore("readonly", function (store) { return store.get(key); });
  return found === undefined ? null : found;
}

async function forgetFolder(bundle) {
  const key = storeKey(bundle);
  if (key === null) {
    return false;
  }
  await inStore("readwrite", function (store) { return store.delete(key); });
  return true;
}

// What somebody wrote and has not saved. It is written while they type, read
// when the file is opened again, and taken away once a save went through.
//
// The record carries the text the file held when the writing began. Without
// it a save after a restart would compare the platter against itself and
// write over whatever somebody else saved in the meantime; with it the write
// path of this file sees the difference and lays it before the person
// (FEAT-08-02, SC-07). A second write under the same name stands where the
// first one stood, so a file carries one draft and never a pile.
async function keepDraft(bundle, name, text, origin) {
  const key = draftKey(bundle, name);
  if (key === null) {
    return false;
  }
  const record = {
    "name": name,
    "text": String(text),
    "origin": origin === null || origin === undefined ? null : String(origin)
  };
  await inStore("readwrite", function (store) {
    return store.put(record, key);
  }, DRAFTS);
  return true;
}

async function recallDraft(bundle, name) {
  const key = draftKey(bundle, name);
  if (key === null) {
    return null;
  }
  const found = await inStore("readonly", function (store) {
    return store.get(key);
  }, DRAFTS);
  return found === undefined ? null : found;
}

// Enumerate only this bound folder's drafts, including files no longer present
// on disk. Legacy records keep their original keys during recovery.
async function listDrafts(bundle) {
  const folder=storeKey(bundle);if(folder===null)return [];
  const base=await openStore();
  try{
    const store=base.transaction(DRAFTS,'readonly').objectStore(DRAFTS);
    const [keys,records]=await Promise.all([asked(store,s=>s.getAllKeys()),asked(store,s=>s.getAll())]);
    return records.filter((record,i)=>typeof keys[i]==='string'&&keys[i].startsWith(folder+':')&&record&&typeof record.name==='string'&&typeof record.text==='string');
  }finally{base.close();}
}

async function dropDraft(bundle, name) {
  const key = draftKey(bundle, name);
  if (key === null) {
    return false;
  }
  await inStore("readwrite", function (store) {
    return store.delete(key);
  }, DRAFTS);
  return true;
}

// ---------------------------------------------------------- the permission

// What the browser says about a handle it kept. After a restart this is
// prompt: the handle came back, the permission did not.
async function permissionState(handle, mode) {
  if (!handle || typeof handle.queryPermission !== "function") {
    return "prompt";
  }
  return handle.queryPermission({"mode": mode || "readwrite"});
}

// Inside a click handler and nowhere else. Called outside one the browser
// answers without asking anybody, which reads like a refusal and is none.
async function grantPermission(handle, mode) {
  if (!handle || typeof handle.requestPermission !== "function") {
    return "denied";
  }
  return handle.requestPermission({"mode": mode || "readwrite"});
}

async function archiveFile(dir,from,to,expected){
 const seen=await readFile(dir,from);if(await global.WikiReviews.hash(seen.text)!==expected)throw new Error('The original changed before archiving.');
 if(await peek(dir,to))throw new Error('Archive destination already exists.');
 const done=await writeFile(dir,to,seen.text,null);if(!done.saved)throw new Error('Archive could not be saved.');
 if(await global.WikiReviews.hash((await readFile(dir,from)).text)!==expected)throw new Error('The original changed; both copies are retained.');
 const parts=from.split('/');let parent=dir;for(const part of parts.slice(0,-1))parent=await parent.getDirectoryHandle(part);await parent.removeEntry(parts.at(-1));
}
async function chooseFolder(mode, options = {}) {
  if(global.EditorHost)return global.EditorHost.choose();
  if (typeof global.showDirectoryPicker !== "function") {
    return null;
  }
  const purpose = /^(project|wiki|work|source)$/.test(options.purpose) ? options.purpose : 'folder';
  return global.showDirectoryPicker({"id": TOOL+'-'+purpose, "mode": mode || "readwrite", ...(options.startIn ? {startIn:options.startIn} : {})});
}

// Whether this browser carries the folder access at all. Where it does not,
// the surface names one way on and never two.
function carriesFolders() {
  return typeof global.showDirectoryPicker === "function" &&
    global.indexedDB !== undefined && global.indexedDB !== null;
}

// A handle answers a name and nothing more.
function describeFolder(dir) {
  return {
    "name": dir && dir.name ? dir.name : "",
    "where": MESSAGES.where
  };
}

// ------------------------------------------------- reading and writing

async function reach(dir, name, create) {
  const walk = parts(name);
  let folder = dir;
  for (let index = 0; index < walk.length - 1; index += 1) {
    folder = await folder.getDirectoryHandle(walk[index], {"create": create === true});
  }
  return folder.getFileHandle(walk[walk.length - 1], {"create": create === true});
}

// A permission for a folder can be taken away between two presses: by a
// policy on a managed device, or simply by a restarted browser. What arrives
// then is a NotAllowedError out of the handle, and it is neither a missing
// file nor a bad name: the folder is there and this page may not touch it any
// more. The write path has a state and a sentence for that, and this is what
// raises it.
function withoutPermission(error) {
  return Boolean(error) && String(error.name) === "NotAllowedError";
}

async function readBlob(dir, name) {
  const target = writableName(name);
  if (target === null) throw new TypeError("invalid source file name");
  return (await reach(dir, target, false)).getFile();
}

async function readBinary(dir,name) {
  const target=writableName(name);if(target===null)throw new TypeError('Invalid asset path');
  const file=await(await reach(dir,target,false)).getFile(),bytes=new Uint8Array(await file.arrayBuffer());
  const sha256=Array.from(new Uint8Array(await global.crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  return {name:target,bytes,sha256,mark:sha256,size:bytes.length};
}
async function writeBinary(dir,name,bytes,baseline) {
 const target=writableName(name);if(target===null||!(bytes instanceof Uint8Array))throw new TypeError('Invalid asset');
 return withLock(lockName(dir,target),async()=>{
  let before;try{before=await readBinary(dir,target);}catch(error){if(error.name!=='NotFoundError')throw error;before=null;}
  if((before?.sha256??null)!==(baseline?.sha256??null))return {saved:false,stale:true};
  const handle=await reach(dir,target,true),writable=await handle.createWritable(handle.hostHandle?{expected:before?.sha256??null}:undefined);await writable.write(bytes);await writable.close();
  const after=await readBinary(dir,target),expected=Array.from(new Uint8Array(await global.crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(after.sha256!==expected)return {saved:false,stale:true};announce(dir,target);return {...after,saved:true};
 });
}
async function readFile(dir, name) {
  const target = writableName(name);
  if (target === null) {
    throw new TypeError("this name is not one a write may use");
  }
  try {
    const handle = await reach(dir, target, false);
    const file = await handle.getFile();
    const text = new TextDecoder("utf-8", {fatal:true, ignoreBOM:true}).decode(await file.arrayBuffer());
    return {"name": target, "text": text, "mark": markOf(text, file)};
  } catch (error) {
    if (withoutPermission(error)) {
      return outcome(step("idle", "denied"), null, target);
    }
    throw error;
  }
}

// The same read, with nothing there as an answer rather than an error. A
// missing file and a missing permission never look alike: the first answers
// nothing, the second answers a state.
async function peek(dir, name) {
  try {
    return await readFile(dir, name);
  } catch (error) {
    if (error && error.name === "NotFoundError") {
      return null;
    }
    throw error;
  }
}

// The folder is confirmed by a file inside it. Its name says nothing and
// where it lies is not readable, so neither is asked.
async function confirmBundle(dir) {
  const seen = await peek(dir, CONTRACT_PATH);
  return seen !== null;
}

function step(state, event) {
  const moves = TRANSITIONS[state];
  if (!moves || !Object.prototype.hasOwnProperty.call(moves, event)) {
    return null;
  }
  return moves[event];
}

function reportsSaved(state) {
  return state === SAVED_STATE;
}

function outcome(state, seen, name) {
  return {
    "state": state,
    "saved": reportsSaved(state),
    "message": Object.prototype.hasOwnProperty.call(MESSAGES, state) ? MESSAGES[state] : "",
    "name": name,
    "text": seen === null || seen === undefined ? null : seen.text,
    "mark": seen === null || seen === undefined ? null : seen.mark
  };
}

function lockName(dir, name) {
  return TOOL + ":" + describeFolder(dir).name + "/" + name;
}

function channelName(dir) {
  return TOOL + ":" + describeFolder(dir).name;
}

// Two views of one bundle, inside one browser profile. Where the lock is
// missing the work runs anyway: a second view that the lock never reached
// still runs into the read before the write and stops there.
function withLock(name, work) {
  const locks = global.navigator ? global.navigator.locks : null;
  if (!locks || typeof locks.request !== "function") {
    return work();
  }
  return locks.request(name, work);
}

// One message, then the channel is closed again, so no view holds a channel
// it is not listening on. Inside one browser profile only.
function announce(dir, name) {
  if (typeof global.BroadcastChannel !== "function") {
    return false;
  }
  const channel = new global.BroadcastChannel(channelName(dir));
  channel.postMessage({"tool": TOOL, "kind": "written", "name": name});
  channel.close();
  return true;
}

function listen(dir, onNotice) {
  if (typeof global.BroadcastChannel !== "function") {
    return null;
  }
  const channel = new global.BroadcastChannel(channelName(dir));
  channel.onmessage = function (message) { onNotice(message.data); };
  return {"stop": function () { channel.close(); }};
}

// Read again, write, read back. The baseline is what the person edits from,
// or nothing where the file is meant to be new. Every answer of the machine
// is a state, and only one of them reports saved.
async function writeFile(dir, name, text, baseline) {
  const target = writableName(name);
  if (target === null) {
    return outcome(step("idle", "unnamed"), null, String(name));
  }
  return withLock(lockName(dir, target), async function () {
    try {
      let state = step("idle", "read");
      const before = await peek(dir, target);
      if (before !== null && before.state === "blocked") {
        return before;
      }
      const held = baseline === null || baseline === undefined ? null : baseline.text;
      const agrees = before === null ? held === null : before.text === held;
      state = step(state, agrees ? "same" : "other");
      if (state !== "checked") {
        return outcome(state, before, target);
      }
      state = step(state, "write");
      const handle = await reach(dir, target, true);
      const expected=handle.hostHandle&&before?Array.from(new Uint8Array(await global.crypto.subtle.digest('SHA-256',new TextEncoder().encode(before.text))),b=>b.toString(16).padStart(2,'0')).join(''):null;
      const writable = await handle.createWritable(handle.hostHandle?{expected}:undefined);
      await writable.write(text);
      await writable.close();
      const after = await peek(dir, target);
      state = step(state, after !== null && after.text === text ? "same" : "other");
      if (reportsSaved(state)) {
        announce(dir, target);
      }
      return outcome(state, after, target);
    } catch (error) {
      if (withoutPermission(error)) {
        return outcome(step("idle", "denied"), null, target);
      }
      throw error;
    }
  });
}

// ------------------------------------------------------------- the folder

// Names, sizes and moments. A listing never opens a file for its content:
// 1.000 files cost 6,4 ms this way, measured, and the content would cost
// megabytes for an answer nobody asked for.
async function listFolder(dir, prefix, options={}) {
  const start = prefix ? prefix : "";
  const found = [];
  for await (const entry of dir.values()) {
    const name = start === "" ? entry.name : start + "/" + entry.name;
    if (isHidden(name) || (options.visible && !options.visible(name, entry.kind))) {
      continue;
    }
    if (entry.kind === "directory") {
      if(options.directories)found.push({name:name+'/',kind:'directory'});
      const deeper = await listFolder(entry, name, options);
      for (let index = 0; index < deeper.length; index += 1) {
        found.push(deeper[index]);
      }
    } else {
      const file = entry.hostHandle&&entry.metadata?entry.metadata:await entry.getFile();
      found.push({"name": name, "size": file.size, "at": file.lastModified});
    }
  }
  return found;
}

function shapeOf(listing) {
  const marks = [];
  for (let index = 0; index < listing.length; index += 1) {
    const item = listing[index];
    marks.push(item.name + ":" + item.size + ":" + item.at);
  }
  return marks.sort().join("\n");
}

// Watched where the browser carries a watcher, looked at where it does not.
// Which of the two ran is part of the answer, because the surface says which
// one it is doing rather than promising the better one.
function watchFolder(dir, onChange) {
  if (typeof global.FileSystemObserver === "function") {
    const observer = new global.FileSystemObserver(function (records) {
      onChange(WATCH_OBSERVER, records);
    });
    observer.observe(dir, {"recursive": true});
    return {
      "kind": WATCH_OBSERVER,
      "message": MESSAGES.watching,
      "stop": function () { observer.disconnect(); }
    };
  }
  let seen = null;
  const timer = global.setInterval(function () {
    listFolder(dir).then(function (now) {
      const shape = shapeOf(now);
      if (seen !== null && shape !== seen) {
        onChange(WATCH_POLL, now);
      }
      seen = shape;
    });
  }, POLL_MS);
  return {
    "kind": WATCH_POLL,
    "message": MESSAGES.polling,
    "stop": function () { global.clearInterval(timer); }
  };
}

global.FolderAccess = {
  "TOOL": TOOL,
  "CONTRACT_PATH": CONTRACT_PATH,
  "HIDDEN": HIDDEN,
  "HIDE_OWN": HIDE_OWN,
  "CLIENT_MARKERS": CLIENT_MARKERS,
  "PLACES": PLACES,
  "STATES": STATES,
  "EVENTS": EVENTS,
  "TRANSITIONS": TRANSITIONS,
  "SAVED_STATE": SAVED_STATE,
  "OUTCOMES": OUTCOMES,
  "MESSAGES": MESSAGES,
  "WATCH_OBSERVER": WATCH_OBSERVER,
  "WATCH_POLL": WATCH_POLL,
  "matches": matches,
  "isHidden": isHidden,
  "writableName": writableName,
  "handleSegment": handleSegment,
  "orderName": orderName,
  "orderNumber": orderNumber,
  "listOrders": listOrders,
  "fingerprint": fingerprint,
  "storeKey": storeKey,
  "draftKey": draftKey,
  "rememberFolder": rememberFolder,
  "recallFolder": recallFolder,
  "forgetFolder": forgetFolder,
  "keepDraft": keepDraft,
  "recallDraft": recallDraft,
  "listDrafts": listDrafts,
  "dropDraft": dropDraft,
  "permissionState": permissionState,
  "grantPermission": grantPermission,
  "chooseFolder": chooseFolder,
  "archiveFile": archiveFile,
  "carriesFolders": carriesFolders,
  "describeFolder": describeFolder,
  "confirmBundle": confirmBundle,
  "readBinary": readBinary,
  "writeBinary": writeBinary,
  "readFile": readFile,
  "readBlob": readBlob,
  "peek": peek,
  "withoutPermission": withoutPermission,
  "writeFile": writeFile,
  "listFolder": listFolder,
  "watchFolder": watchFolder,
  "listen": listen,
  "step": step,
  "reportsSaved": reportsSaved
};

})(typeof globalThis === "object" ? globalThis : this);
