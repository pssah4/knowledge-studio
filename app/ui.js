// The surface itself: the folder choice, the one question of ADR-17, the
// settings, and beside them the listing, the page, the local three way
// comparison and the standing of the last run.
//
// A classic script and never a module. From a page opened out of the file
// system only a neighbouring script src loads; a dynamic import and a call
// over the network both fail there, measured in the browser family this
// surface runs in (ADR-08). The file hangs one name into the page, reads the
// core from app/core.js and the folder from app/folder.js, and asks for
// nothing else: no library, no build step, no process.
//
// The surface falls in two, and the split is load bearing. The compulsory part
// carries the folder choice, the write axis and the settings, because a folder
// release can be given nowhere else and a person who writes in their own
// editor still comes past here once (FEAT-06-07 ASR-01). The optional part
// carries listing, page, comparison and standing, and every one of them is
// replaceable by a writing tool somebody already has (ASR-02). Nothing of the
// compulsory part is reachable from the optional one, and the release is asked
// for in one place.
//
// Three things the surface never does. It never touches the shared folder: in
// the joint mode a person writes in the working folder and only runs write
// into the bundle (ADR-17). It never writes the standing: it reads the report
// of the last run and repeats it with that run's date, because without a
// standing it can compute nothing, and a promise it cannot keep is worse than
// silence (ADR-18). And it offers no field that would take a secret value: a
// setting names one and the runtime resolves it (ADR-14, FEAT-06-05 ASR-01).
//
// What needs judgement is not decided here. It goes into the queue of ADR-08
// as a numbered order under .llmwiki/outbox: a running number, a moment, a
// kind, what it is about, its payload and its state. A deterministic script or
// the agent picks it up on the next run, and the agent is never in the click
// path.
//
// The local comparison runs while a person waits: 9,7 microseconds a page for
// the block keys and 352 per block for the checksum, measured, without a
// library and without the asynchronous digest interface. The origin of a
// comparison is the bytes read when the file was opened. Where there is no
// origin, the surface lays both versions out rather than putting them together
// (ADR-18).
//
// The listing reads names, sizes and moments and never the content of a file.
// A search runs over name, title and place, and a question about content is
// sent to the talk instead, because a full text index in the page costs 11,1 MB
// and 1.044 file reads per build and there is no process to keep it between
// two turns (ASR-020, ADR-08).
//
// Every sentence a person reads stands in one table, TEXTS. No word of version
// control is in it, in any inflection, and neither long dash and no pictograph
// stands anywhere in this file (ASR-015, ADR-15). Identifiers are English, the
// sentences are German, because a person reads them.

(function (global) {
"use strict";

// ----------------------------------------------------------- the two parts

// The compulsory part. A folder release can be given nowhere else, the write
// axis decides where anything may be written at all, and the settings are the
// guided way into files that stay changeable by hand (FEAT-06-07).
const DUTY = ["ordner", "schreibachse", "einstellungen"];

// The optional part. Every one of these is replaceable by a writing tool a
// person already has, and after the folder choice nobody has to come back
// (FEAT-06-07 ASR-02, SC-03).
const OPTIONAL = ["ablage", "seite", "vergleich", "stand"];

const VIEWS = DUTY.concat(OPTIONAL);

// Which part a view belongs to. The page carries the same two words, so a
// reader of the markup and a reader of this file meet one name for one thing.
const PART_DUTY = "pflicht";
const PART_OPTIONAL = "wahl";

// Where the page opens. Without a bound folder it opens in the guided setup,
// with one in the listing: never an empty shell (FEAT-06-01).
const FIRST_VIEW = "ordner";
const WORKING_VIEW = "ablage";

// ------------------------------------------------------------ the folders

// The three bindings of the compulsory part. The bundle is the shared folder
// in the joint mode, the working folder is where a person writes, and a source
// store is where originals lie (ADR-17, FEAT-04-02).
const BINDING_BUNDLE = "buendel";
const BINDING_WORK = "arbeit";
const BINDING_SOURCE = "quelle";
const BINDINGS = ["buendel", "arbeit", "quelle"];

// ----------------------------------------------------------- the write axis

// The mode of the bundle, read from the contract of the shared folder and
// never from a copy in the working folder (ADR-17).
const MODE_SOLE = "eigen";
const MODE_JOINT = "gemeinsam";
const MODES = ["eigen", "gemeinsam"];

// What a measurement of the platform can say about a folder. Only a
// recognised library of somebody else proposes anything; an own folder that
// the person has shared reads as their own, and there the question catches
// what no measurement does (ADR-17, reason 5).
const KIND_OUTSIDE = "outside";
const KIND_OWN = "own";
const KIND_FOREIGN = "foreign";
const KIND_UNKNOWN = "unknown";
const FOLDER_KINDS = ["outside", "own", "foreign", "unknown"];

// -------------------------------------------------------------- the writing

// What the surface writes, and where each of the three goes. The names are the
// ones app/folder.js knows, so there is one table of places and not two.
const WRITTEN_BY_SURFACE = ["page", "note", "order"];

// What it never writes. The standing belongs to the run, and the shared folder
// belongs to the runs alone once more than one person may write (ADR-17,
// ADR-18).
const NEVER_WRITTEN = ["stand", "geteilt"];

// ------------------------------------------------------------- the settings

// The kinds of control a setting can ask for. There is no kind that takes a
// value for a secret, which is the point: a setting names one, the runtime
// resolves it (ADR-14, FEAT-06-05 ASR-01).
const SETTING_CHOICE = "choice";
const SETTING_NAME = "name";
const SETTING_FOLDER = "folder";
const SECRET_KIND = "secret_name";
const SETTING_KINDS = ["choice", "name", "folder", "secret_name"];

// Bundle knowledge travels with the bundle, device knowledge stays here. The
// rule is the first yes of FEAT-06-05: a secret, an endpoint, an absolute
// place or a device name goes to the device, and a secret only by name.
const WHERE_BUNDLE = "buendel";
const WHERE_DEVICE = "geraet";

const SETTINGS = [
  {"key": "buendelordner", "kind": "folder", "where": "geraet", "required": true},
  {"key": "arbeitsordner", "kind": "folder", "where": "geraet", "required": true},
  {"key": "quellablage", "kind": "folder", "where": "geraet", "required": true},
  {"key": "schreibachse", "kind": "choice", "where": "buendel", "required": true,
   "options": ["eigen", "gemeinsam"]},
  {"key": "anbindung", "kind": "choice", "where": "buendel", "required": true,
   "options": ["folder", "api", "git"]},
  {"key": "sprache", "kind": "choice", "where": "buendel", "required": true,
   "options": ["de", "en"]},
  {"key": "vektornaht", "kind": "choice", "where": "buendel", "required": true,
   "options": ["aus", "an"]},
  {"key": "rechner", "kind": "choice", "where": "geraet", "required": true,
   "options": ["none", "local", "endpoint"]},
  {"key": "handle", "kind": "name", "where": "geraet", "required": true},
  {"key": "zugang", "kind": "secret_name", "where": "geraet", "required": false}
];

// The two halves of the seam of ADR-14 Festlegung 4. What the bundle carries
// is a yes or a no: whether a list by content similarity may appear at all is
// a statement about the data and has to hold for every reader of that stock,
// or two of them get different answers without being told. Who computes it is
// device knowledge and stands beside it.
const SEAM_KEY = "vektornaht";
const SEAM_RUNNER = "rechner";

// The three states a person tells apart (FEAT-06-05 SC-05), derived out of
// those two and never laid down. A stored "an" would be plainly false on a
// second device that computes nothing, and a second truth is what
// FEAT-06-05 ASR-03 rules out. SC-05 asks that the three be distinguishable,
// not that three of them be clickable.
const SEAM_STATES = ["aus", "vorbereitet", "an"];

// The one runner this stage refuses. A named service stays locked until the
// question which data may reach it is answered (ADR-14 Festlegung 4), so the
// surface says that instead of showing a state that would be wrong.
const SEAM_LOCKED = "gesperrt";

// ---------------------------------------------------------------- the queue

// One order of ADR-08, in six parts. A running number so two orders sort, a
// moment, what kind of judgement it asks for, what it is about, what it
// carries, and the state a run finds it in.
const ORDER_FIELDS = ["number", "moment", "kind", "about", "payload", "state"];

// What the surface hands over instead of deciding. Setting up needs a run
// because the surface sees no path and cannot reach the state folder; the two
// runs of ADR-18 need one because they touch the shared folder; a handover of
// the write axis and a second file under one identity need a person.
const ORDER_KINDS = [
  "ersteinrichtung",
  "einstellungen",
  "abholen",
  "einbringen",
  "uebergang",
  "doppelte-kennung",
  "aufnahme"
];

// Setting up and setting are runs. The surface sees no folder place, cannot
// walk up to a domain root and cannot lay down the state folder outside the
// bundle; in the joint mode it may not touch the shared folder at all. Both
// therefore leave as an order (ADR-17, ADR-08).
const ORDER_SETTINGS = "einstellungen";

// The state a fresh order stands in. A run moves it on; the surface never does.
const ORDER_STATE = "neu";

// Six digits, as app/folder.js writes them into the file name.
const ORDER_WIDTH = 6;

// --------------------------------------------------------------- the standing

// Where a run leaves what it did. Under .llmwiki, which the hide list of
// ADR-18 already covers, so no walk and no listing stumbles over it. The
// surface reads this file and writes it never.
const REPORT_PATH = ".llmwiki/bericht.json";
const REPORT_FIELDS = [
  "moment",
  "kind",
  "mine_open",
  "theirs_open",
  "open_spots",
  "folder_kind"
];

// ------------------------------------------------------------- the head form

// The first ring makes a page, the second one binds from stable on. Both are
// the lists of llmwiki/maintain/lint.py and are carried a second time because a
// browser cannot read a Python module.
const RING_ONE = ["id", "type", "title", "description", "status", "generated"];
const RING_TWO = ["sources", "verified", "stale_after"];

// Where the closed lists of a bundle stand. The surface reads that file and
// writes it never: a register is content, and changing one is a run.
const REGISTER_PATH = "schema/TYPES.md";

// The closed list of states, and the two of them that make the second ring owed.
const PAGE_STATES = ["draft", "stable", "deprecated"];
const BOUND_STATES = ["stable", "deprecated"];

// A row of the relations section carries an identifier and not a word, so it
// reads the same in a bundle of either language.
const DIRECTIONS = ["out", "in"];

// The heading of that section is prose and exists once per shipped language.
const RELATION_TITLES = ["beziehungen", "relations"];

// Direction, kind, counterpart, reason. A row short of one of them is not a
// weaker statement about a relation, it is a lost edge, so the form leads.
const RELATION_CELLS = 4;

// ---------------------------------------------------------------- the search

// Two searches, two systems. The surface looks at these three and never at
// what stands in a file (ASR-020).
const SEARCH_FIELDS = ["name", "title", "where"];

// ------------------------------------------------------------------ the text

// Everything a person reads. German, because a person reads it; the words of
// version control are absent by rule, and so are the two long dashes and every
// pictograph.
const TEXTS = {
  "axis_question": "Kann hier außer dir jemand schreiben?",
  "axis_why": "Gefragt ist nach den Rechten an diesem Ordner, nicht danach, wer zuletzt etwas getan hat.",
  "axis_yes": "Ja, andere haben Schreibrecht",
  "axis_no": "Nein, nur ich",
  "axis_measured_foreign": "Das Gerät meldet: dieser Ordner gehört zur Ablage einer anderen Person. Damit schreibt mehr als einer, und deine Antwort braucht eine ausdrückliche Bestätigung.",
  "axis_measured_quiet": "Das Gerät kann dazu nichts sagen. Ein eigener Ordner, den du für andere freigegeben hast, sieht von hier aus wie jeder andere; darum die Frage.",
  "axis_confirm": "Ich weiß es besser als die Messung und bleibe dabei",
  "mode_eigen": "dein Bündel",
  "mode_gemeinsam": "euer gemeinsames Bündel",
  "mode_eigen_why": "Du schreibst unmittelbar in den Ordner des Bündels. Es braucht weder Arbeitsordner noch Vermerke.",
  "mode_gemeinsam_why": "Du arbeitest im Arbeitsordner. In den gemeinsamen Ordner schreiben nur Läufe, und darum trägt dort jede Änderung einen Namen.",
  "binding_buendel": "Ordner des Bündels",
  "binding_arbeit": "Arbeitsordner",
  "binding_quelle": "Quellverzeichnis",
  "binding_none": "Noch nicht gewählt",
  "binding_release": "Ordner freigeben",
  "binding_drop": "Bindung lösen",
  "binding_replace": "Ordner ersetzen",
  "setting_buendelordner": "Ordner des Bündels",
  "setting_arbeitsordner": "Arbeitsordner",
  "setting_quellablage": "Quellverzeichnis",
  "setting_schreibachse": "Wer darf schreiben",
  "setting_anbindung": "Wie das Bündel euch erreicht",
  "setting_sprache": "Sprache des Bündels",
  "setting_vektornaht": "Suche nach inhaltlicher Ähnlichkeit",
  "setting_rechner": "Wer die Ähnlichkeit rechnet",
  "setting_handle": "Dein Kürzel in Vermerken",
  "setting_zugang": "Name des Zugangs",
  "hint_zugang": "Nur der Name. Den Wert dazu holt die Laufzeit aus ihrer eigenen Ablage; ein Feld dafür gibt es auf dieser Seite nicht.",
  "hint_vektornaht": "Aus heißt: über dieses Bündel erscheint keine solche Liste. An heißt: sie darf erscheinen. Beides gilt für jeden, der dieses Bündel liest; wer sie rechnet, steht eine Zeile weiter und bleibt auf diesem Gerät.",
  "hint_handle": "Steht in jedem Vermerk, den ein Lauf anlegt, und sonst nirgends.",
  "option_schreibachse_eigen": "Nur ich",
  "option_schreibachse_gemeinsam": "Wir mehrere",
  "option_anbindung_folder": "Über einen Ordner, den ihr teilt",
  "option_anbindung_api": "Über eine Schnittstelle mit Fassungsnamen",
  "option_anbindung_git": "Über eine Ablage, die jede Fassung benennt",
  "option_sprache_de": "Deutsch",
  "option_sprache_en": "Englisch",
  "option_vektornaht_aus": "Aus",
  "option_vektornaht_an": "An",
  "seam_state": "Daraus folgt auf diesem Gerät:",
  "seam_aus": "Aus. In diesem Bündel erscheint keine Liste nach inhaltlicher Ähnlichkeit, gleich wer hier rechnet.",
  "seam_vorbereitet": "Vorbereitet, aber nicht in Betrieb. Im Bündel steht sie an, auf diesem Gerät rechnet sie niemand, und jede Antwort sagt das.",
  "seam_an": "An. Im Bündel steht sie an, und dieses Gerät ist als Rechner eingetragen. Gebaut ist die Naht in dieser Stufe nicht, und deshalb gibt die Leseseite in diesem Zustand gar keine Antwort mehr. Wähle Niemand, solange das so ist.",
  "seam_gesperrt": "Ein benannter Dienst bleibt gesperrt, solange nicht entschieden ist, welche Daten ihn erreichen dürfen. Wähle Niemand; Dieses Gerät rechnet in dieser Stufe nichts und hält die Leseseite an.",
  "option_rechner_none": "Niemand",
  "option_rechner_local": "Dieses Gerät",
  "option_rechner_endpoint": "Ein benannter Dienst",
  "settings_missing": "Das fehlt noch, und ohne das wird nichts abgelegt:",
  "settings_hand_over": "Einstellungen übernehmen",
  "settings_saved": "Gesetzt. Dieselbe Datei kannst du auch von Hand ändern, das Ergebnis ist dasselbe.",
  "settings_where_buendel": "Reist mit dem Bündel",
  "settings_where_geraet": "Bleibt auf diesem Gerät",
  "search_label": "Suchen nach Name, Titel oder Ort",
  "content_question": "Wonach eine Seite inhaltlich klingt, sieht diese Liste nicht. Solche Fragen gehören ins Gespräch mit dem Agenten.",
  "listing_empty": "In diesem Ordner steht noch nichts, was diese Seite zeigen könnte.",
  "page_notices": "Offene Vermerke zu dieser Seite",
  "page_no_notices": "Zu dieser Seite liegt kein Vermerk.",
  "page_save": "Speichern",
  "draft_back": "Beim letzten Mal blieb hier Arbeit ungespeichert. Sie steht wieder da, wo du aufgehört hast.",
  "find_none": "Nichts gefunden.",
  "find_at": "Fundstelle {at} von {of}.",
  "find_replaced": "{count} Mal ersetzt. Ein Schritt zurück nimmt alles davon auf einmal zurück.",
  "draft_drop": "Entwurf verwerfen",
  "page_new": "Seite anlegen",
  "head_missing": "Diese Kopffelder fehlen noch:",
  "relation_add": "Beziehung eintragen",
  "relation_incomplete": "Eine Beziehung braucht Richtung, Art, Gegenstelle und Begründung. Fehlt eines davon, wird die Zeile nicht geschrieben, weil sonst eine Kante verloren geht.",
  "relation_direction_out": "Geht von dieser Seite aus",
  "relation_direction_in": "Kommt auf diese Seite zu",
  "compare_open": "Eine offene Stelle: hier habt ihr beide denselben Absatz geändert. Such dir aus, was stehen bleibt.",
  "compare_quiet": "Ein anderes Werkzeug hat an anderer Stelle geschrieben. Beides steht jetzt drin, ohne dass du etwas tun musstest.",
  "compare_origin": "So stand der Absatz, als du die Seite geöffnet hast",
  "compare_mine": "Deine Fassung",
  "compare_theirs": "Die andere Fassung",
  "compare_no_origin": "Von dieser Datei liegt kein Ursprung vor. Darum wird nichts von selbst übernommen; jede Abweichung ist eine offene Stelle, und du entscheidest.",
  "standing": "{count} eigene Änderungen sind noch nicht eingebracht. So stand es im letzten Lauf vom {date}; seither hat hier niemand nachgerechnet.",
  "standing_none": "Hier ist noch kein Lauf gewesen. Wie viel offen ist, sagt diese Seite erst, wenn einer war.",
  "standing_collect": "Abholen anstoßen",
  "standing_bring": "Einbringen anstoßen",
  "order_placed": "Der Auftrag liegt bereit. Der nächste Lauf nimmt ihn auf, auch wenn gerade niemand da ist.",
  "no_contract": "Dieser Ordner trägt kein Bündel: die Datei, an der ein Bündel zu erkennen ist, liegt nicht darin. Wähl den Ordner, in dem dein Bestand steht, oder lass ein Bündel darin anlegen.",
  "order_incomplete": "Der Auftrag ist unvollständig und wurde deshalb nicht abgelegt. Ein Auftrag braucht Nummer, Zeitpunkt, Art, Bezug, Nutzlast und Zustand; fehlt eines davon, wüsste der Lauf nicht, worauf er sich bezieht.",
  "order_queue": "Wartende Aufträge",
  "shared_untouched": "In den gemeinsamen Ordner schreibt diese Seite nie. Was dorthin soll, geht über einen Lauf.",
  "first_run": "Einmal muss ein Lauf her: diese Seite sieht keinen Ordnerort und kann den Ordner für den Stand nicht anlegen. Danach kommt lokale Arbeit ohne Lauf aus."
};

// ------------------------------------------------------------- the neighbours

// The two scripts the page loads before this one. They are read through these
// two helpers so a missing neighbour says so once instead of at every call.

function core() {
  return global;
}

function folder() {
  return global.FolderAccess;
}

// ------------------------------------------------------------------ the parts

function openingView(bound) {
  return bound ? WORKING_VIEW : FIRST_VIEW;
}

function partOf(view) {
  if (DUTY.indexOf(view) !== -1) {
    return PART_DUTY;
  }
  if (OPTIONAL.indexOf(view) !== -1) {
    return PART_OPTIONAL;
  }
  return null;
}

// -------------------------------------------------------------- the write axis

function proposeMode(kind) {
  if (kind === KIND_FOREIGN) {
    return {"mode": MODE_JOINT, "why": TEXTS.axis_measured_foreign};
  }
  return {"mode": null, "why": TEXTS.axis_measured_quiet};
}

// The answer of a person turns into the mode, and a yes is a yes whatever was
// measured. A no against a recognised library of somebody else needs the
// confirmation ADR-17 asks for; without it this answers nothing rather than
// picking one of the two.
function decideMode(kind, someoneElseCanWrite, confirmed) {
  if (someoneElseCanWrite) {
    return MODE_JOINT;
  }
  if (proposeMode(kind).mode === MODE_JOINT && !confirmed) {
    return null;
  }
  return MODE_SOLE;
}

function modeLabel(mode) {
  return mode === MODE_JOINT ? TEXTS.mode_gemeinsam : TEXTS.mode_eigen;
}

// ---------------------------------------------------------------- the writing

// Where a person writes in this mode. In the joint mode that is the working
// folder and never the shared one.
// The name a bound folder carries. It is what the release window showed and
// never a path: a browser sees none, and ADR-14 keeps one out of the bundle
// anyway. A binding nothing is bound to answers with an empty name.
function folderName(binding) {
  const dir = binding === null ? null : state.dirs[binding];
  return dir ? folder().describeFolder(dir).name : "";
}

function writesInto(mode) {
  if (mode === MODE_JOINT) {
    return BINDING_WORK;
  }
  if (mode === MODE_SOLE) {
    return BINDING_BUNDLE;
  }
  return null;
}

// A mode nobody has decided is not the friendlier of the two. Until the
// question of ADR-17 has an answer, nothing is written anywhere.
function mayWrite(mode, binding) {
  if (NEVER_WRITTEN.indexOf(binding) !== -1) {
    return false;
  }
  const into = writesInto(mode);
  return into !== null && binding === into;
}

// --------------------------------------------------------------- the settings

function settingFor(key) {
  for (let index = 0; index < SETTINGS.length; index += 1) {
    if (SETTINGS[index].key === key) {
      return SETTINGS[index];
    }
  }
  return null;
}

// The control a setting asks for. There is no branch that answers with a field
// for a value, which is what ADR-14 turns into code here.
function controlFor(setting) {
  if (!setting || typeof setting.kind !== "string") {
    return null;
  }
  if (setting.kind === SECRET_KIND) {
    return SETTING_NAME;
  }
  if (setting.kind === SETTING_CHOICE) {
    return SETTING_CHOICE;
  }
  if (setting.kind === SETTING_FOLDER) {
    return SETTING_FOLDER;
  }
  return SETTING_NAME;
}

// What is owed and not there. A missing entry is named and nothing half is
// laid down: no default value takes its seat quietly (FEAT-06-07 SC-05).
function missingSettings(values) {
  const missing = [];
  const held = values || {};
  for (let index = 0; index < SETTINGS.length; index += 1) {
    const setting = SETTINGS[index];
    if (!setting.required) {
      continue;
    }
    const value = Object.prototype.hasOwnProperty.call(held, setting.key)
      ? held[setting.key]
      : "";
    if (typeof value !== "string" || value.trim() === "") {
      missing.push(setting.key);
    }
  }
  return missing;
}

// What is set goes over as one order or not at all. A missing entry stops the
// whole set: nothing half is laid down, and no default value takes the seat of
// something a person did not say (FEAT-06-07 SC-05, ADR-14).
function settingsOrder(values) {
  const missing = missingSettings(values);
  if (missing.length > 0) {
    return {"ready": false, "missing": missing, "said": TEXTS.settings_missing};
  }
  const payload = {};
  for (let index = 0; index < SETTINGS.length; index += 1) {
    const key = SETTINGS[index].key;
    payload[key] = Object.prototype.hasOwnProperty.call(values, key)
      ? values[key]
      : "";
  }
  return {
    "ready": true,
    "missing": [],
    "kind": ORDER_SETTINGS,
    "payload": payload,
    "said": TEXTS.settings_saved
  };
}

// The state of the seam, worked out of the two halves every time it is shown.
// It is derived and never stored, because the bundle half travels and the
// device half does not: the same bundle stands in "vorbereitet" here and in
// "an" on the machine next to it (ADR-14 Festlegung 4).
//
// The locked answer wins over both halves. Somebody who chose a named service
// and then read that nobody computes would have been answered with a quiet
// substitution, which is the one thing ADR-14 was written against.
function seamState(values) {
  const held = values || {};
  const allowed = held[SEAM_KEY] === SEAM_STATES[2];
  const runner = typeof held[SEAM_RUNNER] === "string" ? held[SEAM_RUNNER] : "";
  if (runner === "endpoint") {
    return SEAM_LOCKED;
  }
  if (!allowed) {
    return SEAM_STATES[0];
  }
  return runner === "local" ? SEAM_STATES[2] : SEAM_STATES[1];
}

// The one sentence that belongs to that state, so a person reads what holds
// here rather than a word (FEAT-06-05 SC-04, SC-05).
function seamSaid(values) {
  const wanted = "seam_" + seamState(values);
  return Object.prototype.hasOwnProperty.call(TEXTS, wanted) ? TEXTS[wanted] : "";
}

function labelOf(key) {
  const wanted = "setting_" + key;
  return Object.prototype.hasOwnProperty.call(TEXTS, wanted) ? TEXTS[wanted] : key;
}

function optionLabel(key, option) {
  const wanted = "option_" + key + "_" + option;
  return Object.prototype.hasOwnProperty.call(TEXTS, wanted) ? TEXTS[wanted] : option;
}

function hintOf(key) {
  const wanted = "hint_" + key;
  return Object.prototype.hasOwnProperty.call(TEXTS, wanted) ? TEXTS[wanted] : "";
}

// ------------------------------------------------------------------ the queue

function orderRecord(number, moment, kind, about, payload) {
  return {
    "number": number,
    "moment": moment,
    "kind": kind,
    "about": about,
    "payload": payload,
    "state": ORDER_STATE
  };
}

function orderComplete(record) {
  if (!record || typeof record !== "object") {
    return false;
  }
  for (let index = 0; index < ORDER_FIELDS.length; index += 1) {
    const field = ORDER_FIELDS[index];
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      return false;
    }
    const value = record[field];
    if (value === null || value === undefined || value === "") {
      return false;
    }
  }
  return ORDER_KINDS.indexOf(record.kind) !== -1;
}

// The number the next order takes: one past the highest that already lies in
// the queue. It is read off the folder and never off a counter of this page,
// because a counter starts at zero again after a reload and the second
// session would then write over the orders of the first.
function nextOrderNumber(found) {
  let highest = 0;
  for (let index = 0; index < found.length; index += 1) {
    const number = found[index].number;
    if (typeof number === "number" && number > highest) {
      highest = number;
    }
  }
  return highest + 1;
}

// The order goes down as one file with a running number and the device in its
// name, so that with a folder connection every device reads exactly the orders
// it wrote (ADR-08).
async function placeOrder(dir, number, device, kind, about, payload, moment) {
  const record = orderRecord(number, moment, kind, about, payload);
  if (!orderComplete(record)) {
    return {"placed": false, "record": record, "message": TEXTS.order_incomplete};
  }
  const name = folder().orderName(number, device);
  if (name === null) {
    return {"placed": false, "record": record, "message": folder().MESSAGES.refused};
  }
  const written = await folder().writeFile(
    dir, name, JSON.stringify(record, null, 2) + "\n", null
  );
  return {
    "placed": written.saved === true,
    "record": record,
    "name": name,
    "message": written.saved === true ? TEXTS.order_placed : written.message
  };
}

// ------------------------------------------------------- the local comparison

// Three texts in, one text plus the spots a person has to decide out. The
// origin is the bytes read when the file was opened; where there is none, the
// two versions are laid out and nothing is taken over (ADR-18).
function reconcile(origin, mine, theirs) {
  const held = typeof mine === "string" ? mine : "";
  const there = typeof theirs === "string" ? theirs : "";
  if (typeof origin !== "string") {
    return {
      "text": held,
      "merged": false,
      "hasOpenSpots": true,
      "openSpots": [{
        "base": [],
        "mine": core().splitBlocks(held),
        "theirs": core().splitBlocks(there),
        "index": 0
      }],
      "unchanged": 0,
      "takenMine": 0,
      "takenTheirs": 0,
      "message": TEXTS.compare_no_origin
    };
  }
  const joined = core().mergeBlocks(
    core().splitBlocks(origin),
    core().splitBlocks(held),
    core().splitBlocks(there)
  );
  return {
    "text": core().joinBlocks(joined.blocks),
    "merged": true,
    "hasOpenSpots": joined.hasOpenSpots,
    "openSpots": joined.openSpots,
    "unchanged": joined.unchanged,
    "takenMine": joined.takenMine,
    "takenTheirs": joined.takenTheirs,
    "message": joined.hasOpenSpots ? TEXTS.compare_open : TEXTS.compare_quiet
  };
}

// Opening a page keeps the exact characters that were on the platter. Every
// later comparison runs against them and against nothing derived from them.
async function openPage(dir, name) {
  const seen = await folder().readFile(dir, name);
  return {
    "name": seen.name,
    "text": seen.text,
    "origin": seen.text,
    "mark": seen.mark,
    "draft": false
  };
}

// A page opened again, with what somebody left unsaved laid over it. The store
// that kept it lives in app/folder.js; what is decided here is which of the two
// texts a person is put back in front of, and against what a save will compare.
//
// Both halves of the draft win. The text wins, because it is the work that was
// not saved. The text it was written over wins too: after a restart the platter
// may carry a change somebody else saved in the meantime, and comparing it with
// itself would write straight over that change (SC-07). With the older origin
// the write path sees two edits and lays the spot before the person.
//
// A draft that says what the file says is no draft. There is nothing to warn
// about, so nothing is said.
function draftOver(held, draft) {
  if (!held || !draft || typeof draft.text !== "string"
      || draft.text === held.text) {
    return held;
  }
  return {
    "name": held.name,
    "text": draft.text,
    "origin": typeof draft.origin === "string" ? draft.origin : held.origin,
    "mark": held.mark,
    "draft": true
  };
}

// Writing reads once more first. Where the platter still carries the origin,
// the write path of app/folder.js does the rest; where it does not, the three
// texts meet, and a spot both sides touched is laid before the person instead
// of being written over.
async function savePage(dir, held, text) {
  const now = await folder().readFile(dir, held.name);
  if (now.text === held.origin) {
    return await folder().writeFile(dir, held.name, text, now);
  }
  const joined = reconcile(held.origin, text, now.text);
  if (joined.hasOpenSpots) {
    return {
      "state": "open",
      "saved": false,
      "message": joined.message,
      "openSpots": joined.openSpots,
      "text": joined.text,
      "name": held.name
    };
  }
  return await folder().writeFile(dir, held.name, joined.text, now);
}

// --------------------------------------------------------------- the standing

function dayOf(moment) {
  if (typeof moment !== "string" || moment === "") {
    return null;
  }
  const cut = moment.indexOf("T");
  return cut === -1 ? moment : moment.slice(0, cut);
}

function fill(pattern, values) {
  let said = pattern;
  const keys = Object.keys(values);
  for (let index = 0; index < keys.length; index += 1) {
    said = said.split("{" + keys[index] + "}").join(String(values[keys[index]]));
  }
  return said;
}

// What the last run left behind, or nothing. This is the one place the file is
// touched, and it is read: the standing belongs to the run, and a surface that
// wrote it would be a second truth about what both sides carry (ADR-18).
async function readReport(dir) {
  try {
    const seen = await folder().readFile(dir, REPORT_PATH);
    const held = JSON.parse(seen.text);
    return held && typeof held === "object" ? held : null;
  } catch (error) {
    return null;
  }
}

// The closed lists of the bundle, read once. A bundle without a register is a
// working state: the guided form then leads with what it knows and asks for
// the rest as plain text rather than refusing to open (ADR-10).
async function readRegisterFile(dir) {
  try {
    const seen = await folder().readFile(dir, REGISTER_PATH);
    return readRegister(seen.text);
  } catch (error) {
    return {"genera": Object.create(null), "edges": Object.create(null)};
  }
}

// The standing is a repetition and never a calculation. Without a report the
// surface says so and names no figure, because a figure it cannot stand behind
// is worse than none (ADR-17, ADR-18).
function standing(report) {
  const when = report ? dayOf(report.moment) : null;
  if (!report || when === null) {
    return {"said": TEXTS.standing_none, "date": null, "counted": false};
  }
  const open = typeof report.mine_open === "number" ? report.mine_open : 0;
  return {
    "said": fill(TEXTS.standing, {"count": open, "date": when}),
    "date": when,
    "counted": true
  };
}

// ---------------------------------------------------------------- the listing

function wholeName(entry) {
  const where = typeof entry.where === "string" ? entry.where : "";
  return where === "" ? entry.name : where + "/" + entry.name;
}

function visible(name) {
  return !folder().isHidden(name);
}

// A listing of app/folder.js carries a path, a size and a moment. The surface
// needs three fields to look at, so the place comes out of the path and the
// title out of what it has already been handed. A title it has not been handed
// stays empty: fetching one would mean reading every file, which is exactly
// what the listing does not do (ASR-020).
function shelve(listing, titles) {
  const known = titles || Object.create(null);
  const shelf = [];
  for (let index = 0; index < listing.length; index += 1) {
    const item = listing[index];
    const cut = item.name.lastIndexOf("/");
    shelf.push({
      "name": cut === -1 ? item.name : item.name.slice(cut + 1),
      "where": cut === -1 ? "" : item.name.slice(0, cut),
      "title": Object.prototype.hasOwnProperty.call(known, item.name)
        ? known[item.name]
        : "",
      "size": item.size,
      "at": item.at
    });
  }
  return shelf;
}

function visibleEntries(entries) {
  const seen = [];
  for (let index = 0; index < entries.length; index += 1) {
    if (visible(wholeName(entries[index]))) {
      seen.push(entries[index]);
    }
  }
  return seen;
}

// Name, title and place. The content of a file is not read to list it and not
// read to search it; a question about content goes to the talk (ASR-020).
function findFiles(entries, query) {
  const wanted = (typeof query === "string" ? query : "").toLowerCase().trim();
  if (wanted === "") {
    return entries.slice();
  }
  const found = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    for (let field = 0; field < SEARCH_FIELDS.length; field += 1) {
      const held = entry[SEARCH_FIELDS[field]];
      if (typeof held === "string" && held.toLowerCase().indexOf(wanted) !== -1) {
        found.push(entry);
        break;
      }
    }
  }
  return found;
}

// ------------------------------------------------------------- the head form

function headMissing(text) {
  let fields;
  try {
    fields = core().parseHead(text).fields;
  } catch (error) {
    return RING_ONE.slice();
  }
  const missing = [];
  for (let index = 0; index < RING_ONE.length; index += 1) {
    const key = RING_ONE[index];
    const held = Object.prototype.hasOwnProperty.call(fields, key)
      ? fields[key].value
      : null;
    if (held === null || held === undefined) {
      missing.push(key);
      continue;
    }
    if (typeof held === "string" && held.trim() === "") {
      missing.push(key);
    }
  }
  return missing;
}

// A page is laid down led or not at all. The first ring makes a page, so a set
// of values short of one of its fields writes nothing and says which one is
// missing (ADR-11, FEAT-06-07 SC-05).
function newPage(title, values) {
  const head = ["---"];
  for (let index = 0; index < RING_ONE.length; index += 1) {
    const key = RING_ONE[index];
    const value = Object.prototype.hasOwnProperty.call(values, key)
      ? values[key]
      : "";
    if (typeof value !== "string" || value.trim() === "") {
      return null;
    }
    head.push(key + ": " + quoted(value));
  }
  head.push("---");
  head.push("");
  head.push("# " + title);
  head.push("");
  return head.join("\n");
}

function quoted(value) {
  return "\"" + value.split("\\").join("\\\\").split("\"").join("\\\"") + "\"";
}

// An edge is one comparison unit: an outgoing one stands as a row and as an
// entry in the reference list of the head, and both are written together or
// neither is. An incoming row is derived from the statement of another page
// and stays out of the head (ADR-02, ADR-18, lint E-112 and E-113).
function withRelation(text, direction, kind, target, why) {
  const row = relationRow(direction, kind, target, why);
  if (row === null) {
    return null;
  }
  let written = withRow(text, row);
  if (direction !== "out") {
    return written;
  }
  const held = core().headEntries(written, "related");
  if (held.indexOf(target) === -1) {
    written = core().setHeadField(written, "related", held.concat([target]));
  }
  return written;
}

// The row goes under the heading of the relations section, behind the last row
// that is already there. Where there is no section, the heading and the two
// lines a table needs are written with it.
function withRow(text, row) {
  const lines = text.split("\n");
  const heading = relationHeading(lines);
  if (heading === -1) {
    const tail = lines.length > 0 && lines[lines.length - 1] === "" ? "" : "\n";
    return text + tail + "\n## Beziehungen\n\n"
      + "| Richtung | Art | Gegenstelle | Begründung |\n"
      + "| --- | --- | --- | --- |\n" + row + "\n";
  }
  let at = heading + 1;
  let last = -1;
  while (at < lines.length) {
    if (lines[at].trim().indexOf("#") === 0) {
      break;
    }
    if (lines[at].trim().indexOf("|") === 0) {
      last = at;
    }
    at += 1;
  }
  const behind = last === -1 ? heading : last;
  const before = lines.slice(0, behind + 1);
  const after = lines.slice(behind + 1);
  return before.concat([row]).concat(after).join("\n");
}

function relationHeading(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.indexOf("#") !== 0) {
      continue;
    }
    let level = 0;
    while (level < line.length && line.charAt(level) === "#") {
      level += 1;
    }
    const title = line.slice(level).trim().toLowerCase();
    if (RELATION_TITLES.indexOf(title) !== -1) {
      return index;
    }
  }
  return -1;
}

// One decided spot, written into my own text. Taking the other version or the
// one both sides last had puts that run in place of mine, and the next
// comparison finds nothing left to ask about. Keeping mine changes no byte
// here: that is a decision about the platter and is carried out by writing
// against the fresh read.
function takeSide(text, spot, which) {
  if (which === "mine") {
    return text;
  }
  const wanted = spot[which === "base" ? "base" : "theirs"];
  const blocks = core().splitBlocks(text);
  const at = runAt(blocks, spot.mine);
  if (at === -1) {
    return text;
  }
  const before = blocks.slice(0, at);
  const after = blocks.slice(at + spot.mine.length);
  return core().joinBlocks(before.concat(wanted).concat(after));
}

// Where that run of blocks stands, by comparison key and never by raw text.
function runAt(blocks, run) {
  if (run.length === 0) {
    return -1;
  }
  for (let start = 0; start + run.length <= blocks.length; start += 1) {
    let same = true;
    for (let step = 0; step < run.length; step += 1) {
      if (blocks[start + step].key !== run[step].key) {
        same = false;
        break;
      }
    }
    if (same) {
      return start;
    }
  }
  return -1;
}

// The second ring binds from stable on, and only forward: the way back to
// draft does not reset it.
function ringTwoOwed(state) {
  return BOUND_STATES.indexOf(state) !== -1;
}

// --------------------------------------------------------- the relation form

function rowCells(line) {
  const text = typeof line === "string" ? line.trim() : "";
  if (text.indexOf("|") !== 0) {
    return null;
  }
  const parts = [];
  let current = "";
  let escaped = false;
  for (let index = 1; index < text.length; index += 1) {
    const symbol = text.charAt(index);
    if (escaped) {
      current += symbol;
      escaped = false;
      continue;
    }
    if (symbol === "\\") {
      current += symbol;
      escaped = true;
      continue;
    }
    if (symbol === "|") {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += symbol;
  }
  if (current.trim() !== "") {
    parts.push(current.trim());
  }
  return parts;
}

// A row short of one cell is a lost edge, so it is refused rather than written
// half. The refusal names what is missing; it never fills a cell itself.
function relationRow(direction, kind, target, why) {
  if (DIRECTIONS.indexOf(direction) === -1) {
    return null;
  }
  const cells = [direction, kind, target, why];
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    if (typeof cell !== "string" || cell.trim() === "") {
      return null;
    }
    if (cell.indexOf("|") !== -1) {
      return null;
    }
  }
  return "| " + cells.join(" | ") + " |";
}

function noticeFolder(page) {
  return folder().PLACES.note + "/" + page;
}

// ------------------------------------------------------------- the register

// The closed lists of this bundle, read out of its register file. Identifiers
// only; the labels beside them are prose that is compared and never run
// (ADR-14, typregister section 3).
function readRegister(text) {
  const genera = Object.create(null);
  const edges = Object.create(null);
  const lines = String(text === null || text === undefined ? "" : text).split("\n");
  let section = null;
  let entry = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.indexOf("#") === 0) {
      let level = 0;
      while (level < line.length && line.charAt(level) === "#") {
        level += 1;
      }
      const title = line.slice(level).trim();
      if (level === 2) {
        section = title === "Genera" ? "genera" : (title === "Edges" ? "edges" : null);
        entry = null;
        continue;
      }
      if (level === 3 && section !== null) {
        entry = {"label": "", "classes": [], "edgesOut": [], "sections": [],
                 "domain": [], "range": []};
        if (section === "genera") {
          genera[title] = entry;
        } else {
          edges[title] = entry;
        }
        continue;
      }
      section = level === 1 ? null : section;
      entry = null;
      continue;
    }
    if (entry === null || line === "") {
      continue;
    }
    if (line.indexOf("-") !== 0) {
      continue;
    }
    const body = line.slice(1).trim();
    const colon = body.indexOf(":");
    if (colon === -1) {
      continue;
    }
    const key = body.slice(0, colon).trim();
    const value = body.slice(colon + 1).trim();
    if (key === "Label") {
      entry.label = value;
    } else if (key === "Classes") {
      entry.classes = bars(value);
    } else if (key === "Edges out") {
      entry.edgesOut = bars(value);
    } else if (key === "Sections") {
      entry.sections = bars(value);
    } else if (key === "Domain") {
      entry.domain = bars(value);
    } else if (key === "Range") {
      entry.range = bars(value);
    }
  }
  return {"genera": genera, "edges": edges};
}

function bars(value) {
  if (value === "") {
    return [];
  }
  const parts = value.split("|");
  const found = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index].trim();
    if (part !== "") {
      found.push(part);
    }
  }
  return found;
}

// ------------------------------------------------------------------- the page

// Everything below reaches for the document. Nothing above it does, which is
// what lets the bench run every table and every decision without a browser.

const state = {
  "view": FIRST_VIEW,
  "mode": null,
  "kind": KIND_UNKNOWN,
  "dirs": Object.create(null),
  "values": Object.create(null),
  "entries": [],
  "held": null,
  "report": null,
  "register": null,
  "spots": [],
  "titles": Object.create(null),
  "said": null,
  "confirmed": false
};

function at(name) {
  return global.document.getElementById(name);
}

// The sheet a person writes in. It is not a text field any more: the markers
// have to be displayed where they stand, and a field can only show characters
// (FEAT-08-07, SC-10). What comes back carries a value that reads and sets the
// way the field did, so everything here that only wants the text of the page
// stayed the caller it was. The surface itself lives in app/writing.js.
let sheet = null;

function pageBody() {
  const node = at("seite-text");
  if (!node || typeof global.writingSurface !== "function") {
    return null;
  }
  if (sheet === null || sheet.root !== node) {
    sheet = global.writingSurface(node);
    sheet.listen(noteDraft);
    // Typing is reported to the listeners; moving is not. app/writing.js tells
    // nobody about a move, and a move is exactly the case where somebody walks
    // back into a half typed reference with the arrow keys.
    sheet.listen(drawTargets);
    node.addEventListener("keyup", drawTargets);
    node.addEventListener("mouseup", drawTargets);
  }
  return sheet;
}

// What somebody has typed and not saved, on its way to the store. The surface
// says every change, and a store answers in about a millisecond, so writing
// once per keystroke would queue writes behind each other for no gain. Instead
// the newest text waits while one write is out and goes next: never more than
// one write in flight, and the text that reaches the store is always the last
// one typed. Nothing is lost by the waiting, because nothing here throws a text
// away, it only overtakes an older one.
let keeping = false;
let owed = null;

async function noteDraft(text) {
  const into = writesInto(state.mode);
  if (into === null || !state.held) {
    return;
  }
  const name = state.held.name;
  const origin = state.held.origin;
  owed = text;
  if (keeping) {
    return;
  }
  keeping = true;
  try {
    while (owed !== null) {
      const now = owed;
      owed = null;
      await folder().keepDraft(into, name, now, origin);
    }
  } finally {
    keeping = false;
  }
}

function clear(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function made(tag, className, said) {
  const node = global.document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (said !== undefined && said !== null) {
    node.textContent = said;
  }
  return node;
}

function show(view) {
  state.view = view;
  for (let index = 0; index < VIEWS.length; index += 1) {
    const section = at(VIEWS[index]);
    if (section) {
      section.hidden = VIEWS[index] !== view;
    }
  }
  const buttons = global.document.querySelectorAll("[data-view]");
  for (let index = 0; index < buttons.length; index += 1) {
    const button = buttons[index];
    button.setAttribute(
      "aria-current", button.getAttribute("data-view") === view ? "page" : "false"
    );
  }
}

function say(name, said) {
  const node = at(name);
  if (node) {
    node.textContent = said;
  }
}

function drawBindings() {
  const list = at("ordner-liste");
  if (!list) {
    return;
  }
  clear(list);
  for (let index = 0; index < BINDINGS.length; index += 1) {
    const binding = BINDINGS[index];
    const row = made("li", "binding");
    row.appendChild(made("span", "binding-name", TEXTS["binding_" + binding]));
    const dir = state.dirs[binding];
    row.appendChild(made(
      "span", "binding-place", dir ? folder().describeFolder(dir).name : TEXTS.binding_none
    ));
    const release = made("button", "release", dir ? TEXTS.binding_replace : TEXTS.binding_release);
    release.setAttribute("type", "button");
    release.setAttribute("data-action", "freigeben");
    release.setAttribute("data-binding", binding);
    row.appendChild(release);
    if (dir) {
      const drop = made("button", "drop", TEXTS.binding_drop);
      drop.setAttribute("type", "button");
      drop.setAttribute("data-action", "loesen");
      drop.setAttribute("data-binding", binding);
      row.appendChild(drop);
    }
    list.appendChild(row);
  }
  say("ordner-hinweis", folder().MESSAGES.where);
}

function drawAxis() {
  say("schreibachse-frage", TEXTS.axis_question);
  say("schreibachse-warum", TEXTS.axis_why);
  say("schreibachse-messung", proposeMode(state.kind).why);
  const chosen = at("schreibachse-lage");
  if (chosen) {
    chosen.textContent = state.mode === null
      ? ""
      : modeLabel(state.mode) + ". " + TEXTS["mode_" + state.mode + "_why"];
  }
  const confirm = at("schreibachse-bestaetigung");
  if (confirm) {
    confirm.hidden = proposeMode(state.kind).mode !== MODE_JOINT;
  }
}

function drawSettings() {
  const list = at("einstellungen-liste");
  if (!list) {
    return;
  }
  clear(list);
  for (let index = 0; index < SETTINGS.length; index += 1) {
    const setting = SETTINGS[index];
    const row = made("div", "setting");
    const label = made("label", "setting-label", labelOf(setting.key));
    label.setAttribute("for", "setting-" + setting.key);
    row.appendChild(label);
    row.appendChild(made(
      "span", "setting-where", TEXTS["settings_where_" + setting.where]
    ));
    row.appendChild(control(setting));
    const hint = hintOf(setting.key);
    if (hint !== "") {
      row.appendChild(made("p", "setting-hint", hint));
    }
    list.appendChild(row);
  }
  drawSeam(list);
  drawMissing();
}

// The derived state, drawn under the two settings it comes out of. It stands
// there and not behind a switch: the state a person has to tell apart is the
// one the two halves make together, and neither half shows it alone.
function drawSeam(list) {
  const row = made("div", "setting");
  row.appendChild(made("span", "setting-label", TEXTS.seam_state));
  row.appendChild(made("p", "setting-hint", seamSaid(state.values)));
  list.appendChild(row);
}

function control(setting) {
  const kind = controlFor(setting);
  const held = Object.prototype.hasOwnProperty.call(state.values, setting.key)
    ? state.values[setting.key]
    : "";
  if (kind === SETTING_CHOICE) {
    const box = made("select", "setting-choice");
    box.id = "setting-" + setting.key;
    box.setAttribute("data-setting", setting.key);
    for (let index = 0; index < setting.options.length; index += 1) {
      const option = made("option", null, optionLabel(setting.key, setting.options[index]));
      option.value = setting.options[index];
      if (setting.options[index] === held) {
        option.selected = true;
      }
      box.appendChild(option);
    }
    return box;
  }
  if (kind === SETTING_FOLDER) {
    const button = made("button", "setting-folder", TEXTS.binding_release);
    button.id = "setting-" + setting.key;
    button.setAttribute("type", "button");
    button.setAttribute("data-action", "freigeben");
    button.setAttribute("data-setting", setting.key);
    return button;
  }
  const field = made("input", "setting-name");
  field.id = "setting-" + setting.key;
  field.setAttribute("type", "text");
  field.setAttribute("data-setting", setting.key);
  field.value = held;
  return field;
}

function drawMissing() {
  const node = at("einstellungen-fehlend");
  if (!node) {
    return;
  }
  clear(node);
  const missing = missingSettings(state.values);
  node.hidden = missing.length === 0;
  if (missing.length === 0) {
    return;
  }
  node.appendChild(made("p", "missing-said", TEXTS.settings_missing));
  const list = made("ul", "missing-list");
  for (let index = 0; index < missing.length; index += 1) {
    const setting = settingFor(missing[index]);
    list.appendChild(made(
      "li", null, labelOf(missing[index]) + ", " + TEXTS["settings_where_" + setting.where]
    ));
  }
  node.appendChild(list);
}

function drawListing() {
  const list = at("ablage-liste");
  if (!list) {
    return;
  }
  clear(list);
  const field = at("ablage-suche");
  const found = findFiles(visibleEntries(state.entries), field ? field.value : "");
  if (found.length === 0) {
    list.appendChild(made("li", "empty", TEXTS.listing_empty));
    return;
  }
  for (let index = 0; index < found.length; index += 1) {
    const entry = found[index];
    const row = made("li", "entry");
    const open = made("button", "entry-open", entry.title ? entry.title : entry.name);
    open.setAttribute("type", "button");
    open.setAttribute("data-action", "oeffnen");
    open.setAttribute("data-name", wholeName(entry));
    row.appendChild(open);
    row.appendChild(made("span", "entry-where", entry.where));
    list.appendChild(row);
  }
}

function drawPage() {
  const body = pageBody();
  if (body) {
    body.value = state.held ? state.held.text : "";
  }
  say("seite-name", state.held ? state.held.name : "");
  drawDraft(Boolean(state.held && state.held.draft));
  drawOwed(state.held ? headMissing(state.held.text) : []);
  drawHeadForm();
  drawRelationForm();
}

function drawDraft(carried) {
  const said = at("seite-entwurf");
  if (!said) {
    return;
  }
  said.hidden = !carried;
  say("seite-entwurf-satz", carried ? TEXTS.draft_back : "");
  const way = said.querySelector
    ? said.querySelector("[data-action=\"entwurf-verwerfen\"]")
    : null;
  if (way) {
    way.textContent = TEXTS.draft_drop;
  }
}

function drawOwed(owed) {
  const missing = at("seite-kopf");
  if (!missing) {
    return;
  }
  clear(missing);
  missing.hidden = owed.length === 0;
  if (owed.length === 0) {
    return;
  }
  missing.appendChild(made("p", null, TEXTS.head_missing));
  missing.appendChild(made("p", "owed", owed.join(", ")));
}

// The head form, led. Where a field has a closed list it is a list, and the
// list comes out of the register of this bundle rather than out of this file.
function drawHeadForm() {
  const form = at("seite-kopfform");
  if (!form) {
    return;
  }
  clear(form);
  for (let index = 0; index < RING_ONE.length; index += 1) {
    const key = RING_ONE[index];
    const label = made("label", "kopf-label", key);
    label.setAttribute("for", "kopf-" + key);
    form.appendChild(label);
    form.appendChild(headControl(key));
  }
}

function headControl(key) {
  const options = headChoices(key);
  if (options === null) {
    const field = made("input", "kopf-name");
    field.id = "kopf-" + key;
    field.setAttribute("type", "text");
    field.setAttribute("data-head", key);
    return field;
  }
  const box = made("select", "kopf-choice");
  box.id = "kopf-" + key;
  box.setAttribute("data-head", key);
  for (let index = 0; index < options.length; index += 1) {
    const option = made("option", null, options[index]);
    option.value = options[index];
    box.appendChild(option);
  }
  return box;
}

// The closed list behind a head field, or nothing where the field is free
// text. A value outside its list is an error and never a near miss (ADR-14).
function headChoices(key) {
  if (key === "status") {
    return PAGE_STATES.slice();
  }
  if (key === "generated") {
    return ["false", "true"];
  }
  if (key === "type" && state.register) {
    return Object.keys(state.register.genera);
  }
  return null;
}

function drawRelationForm() {
  const held = at("beziehung-richtung");
  if (!held) {
    return;
  }
  fillChoice(held, DIRECTIONS);
  fillChoice(at("beziehung-art"), edgeChoices());
  fillChoice(at("beziehung-ziel"), targetNames(state.entries));
}

// The names on the shelf, whole, in the order the shelf carries them. One
// source for the target of a relation and for the offer in the running text.
// Two lists drift apart, and a name that stands in one and not in the other is
// a reference into the void with an explanation attached.
function targetNames(entries) {
  const list = entries || [];
  const out = [];
  for (let index = 0; index < list.length; index += 1) {
    out.push(wholeName(list[index]));
  }
  return out;
}

// Which edges may leave this page, out of its own genus. Where the genus is
// unknown the whole register is offered rather than a guess.
function edgeChoices() {
  if (!state.register) {
    return [];
  }
  const genus = state.held === null
    ? ""
    : core().headField(state.held.text, "type", "");
  const known = state.register.genera;
  if (Object.prototype.hasOwnProperty.call(known, genus)) {
    return known[genus].edgesOut;
  }
  return Object.keys(state.register.edges);
}

function fillChoice(box, options) {
  if (!box) {
    return;
  }
  clear(box);
  for (let index = 0; index < options.length; index += 1) {
    const option = made("option", null, options[index]);
    option.value = options[index];
    box.appendChild(option);
  }
}

function drawNotices(notices) {
  const aside = at("seite-vermerke");
  if (!aside) {
    return;
  }
  clear(aside);
  aside.appendChild(made("h3", null, TEXTS.page_notices));
  if (!notices || notices.length === 0) {
    aside.appendChild(made("p", "empty", TEXTS.page_no_notices));
    return;
  }
  for (let index = 0; index < notices.length; index += 1) {
    aside.appendChild(made("article", "notice", notices[index]));
  }
}

function drawSpots(joined) {
  const list = at("vergleich-stellen");
  if (!list) {
    return;
  }
  clear(list);
  state.spots = joined.openSpots;
  say("vergleich-lage", joined.message);
  for (let index = 0; index < joined.openSpots.length; index += 1) {
    const spot = joined.openSpots[index];
    const row = made("li", "spot");
    row.appendChild(side("base", TEXTS.compare_origin, spot.base, index));
    row.appendChild(side("mine", TEXTS.compare_mine, spot.mine, index));
    row.appendChild(side("theirs", TEXTS.compare_theirs, spot.theirs, index));
    list.appendChild(row);
  }
}

function side(which, heading, blocks, spot) {
  const box = made("div", "side side-" + which);
  box.appendChild(made("h4", null, heading));
  box.appendChild(made("pre", null, core().joinBlocks(blocks || [])));
  const take = made("button", "take", heading);
  take.setAttribute("type", "button");
  take.setAttribute("data-action", "uebernehmen");
  take.setAttribute("data-side", which);
  take.setAttribute("data-spot", String(spot));
  box.appendChild(take);
  return box;
}

function drawStanding() {
  const said = standing(state.report);
  say("stand-satz", said.said);
  say("stand-hinweis", TEXTS.shared_untouched);
}

// The one place a folder release is asked for. It runs inside the click, which
// is the only place the browser hands one out, and it stands in the compulsory
// part because a person with their own editor still has to come past it once
// (ADR-08, FEAT-06-07 ASR-01).
async function releaseFolder(binding) {
  // Nach einem Neustart des Browsers ueberlebt das Handle und die Erlaubnis
  // dafuer nicht. Der Satz dazu sagt, ein Druck reiche; der einzige Weg
  // hierher oeffnete aber immer erst das Auswahlfenster und erteilte die
  // Erlaubnis auf dem frisch gewaehlten Handle, nie auf dem gemerkten.
  const standing = state.dirs[binding];
  if (standing) {
    const answer = await folder().permissionState(standing, "readwrite");
    if (answer !== "denied") {
      const again = await folder().grantPermission(standing, "readwrite");
      if (again === "granted") {
        drawBindings();
        drawListing();
        return standing;
      }
    }
  }
  let dir = null;
  try {
    dir = await folder().chooseFolder("readwrite");
  } catch (error) {
    // Ein geschlossenes Auswahlfenster ist eine Entscheidung und kein Fehler.
    // Der Browser lehnt dafuer mit AbortError ab und antwortet nie mit
    // nichts, und ohne diesen Zweig blieb die Ablehnung offen stehen.
    if (!error || String(error.name) !== "AbortError") {
      say("ordner-hinweis", folder().MESSAGES.blocked);
    }
    return null;
  }
  if (dir === null) {
    say("ordner-hinweis", folder().carriesFolders()
        ? folder().MESSAGES.blocked : folder().MESSAGES.unsupported);
    return null;
  }
  const granted = await folder().grantPermission(dir, "readwrite");
  if (granted !== "granted") {
    say("ordner-hinweis", folder().MESSAGES.blocked);
    return null;
  }
  // Ein Ordner wird durch eine Datei in ihm bestaetigt, nie durch seinen
  // Namen. Fuer die Arbeitsflaeche gilt das nicht: dort steht kein Vertrag.
  if (binding === BINDING_BUNDLE && !(await folder().confirmBundle(dir))) {
    say("ordner-hinweis", TEXTS.no_contract);
    return null;
  }
  state.dirs[binding] = dir;
  await folder().rememberFolder(binding, dir);
  if (binding === BINDING_BUNDLE) {
    state.mode = null;
  }
  drawBindings();
  drawSettings();
  return dir;
}

async function dropFolder(binding) {
  delete state.dirs[binding];
  await folder().forgetFolder(binding);
  drawBindings();
  drawSettings();
}

// What needs judgement leaves as an order and waits. Nothing here reaches into
// a run, and no click costs a turn of the agent (ADR-08).
async function handOver(kind, about, payload) {
  const into = writesInto(state.mode);
  const dir = into === null ? null : state.dirs[into];
  if (!dir) {
    return null;
  }
  // The reference, fourth of the six parts ADR-08 names. Where a caller has
  // nothing more precise than the folder the order concerns, the folder is
  // it: the queue lies in that folder, and its name is the only thing a
  // browser sees of it. An empty reference would be turned down by
  // orderComplete and nothing would ever reach the disk.
  const named = String(about === null || about === undefined ? "" : about).trim();
  const bezug = named === "" ? String(dir.name || "").trim() : named;
  const number = nextOrderNumber(await folder().listOrders(dir));
  const laid = await placeOrder(
    dir, number, state.values.handle || TEXTS.binding_none,
    kind, bezug, payload, new Date().toISOString()
  );
  say("stand-hinweis", laid.message);
  return laid;
}

// A form somebody set, over what they had marked. The name of the form is all
// that travels from the page; where the mark stands and what the characters
// are stays in app/writing.js, which is the only place that reads the text.
function setForm(name) {
  const body = pageBody();
  if (!body || typeof body.apply !== "function") {
    return false;
  }
  return body.apply(name) !== false;
}

// One step back over what somebody wrote, or one forward again. The history
// lives in app/writing.js, because it is the file that rebuilds the lines and
// therefore the file that took the browser's own history away.
function stepBack(which) {
  const body = pageBody();
  if (!body || typeof body.undo !== "function") {
    return false;
  }
  return which === "vor" ? body.redo() : body.undo();
}

// ------------------------------------------------------------------ the offer

// Which pages fit what somebody has begun to type between two brackets. The
// question what is being typed belongs to app/writing.js, because it is a
// question about the text; which names there are belongs here, because the
// shelf belongs to the open bundle. Nothing is offered where nothing is being
// typed: a list that stands there always is a list that is always in the way.
function drawTargets() {
  const box = at("seite-ziele");
  if (!box) {
    return false;
  }
  clear(box);
  const body = pageBody();
  if (!body || typeof body.typed !== "function"
      || typeof global.writingOffers !== "function") {
    return false;
  }
  const open = body.typed();
  if (!open) {
    return false;
  }
  const names = global.writingOffers(targetNames(state.entries), open.said);
  for (let index = 0; index < names.length; index += 1) {
    const item = made("li");
    const button = made("button", null, names[index]);
    button.type = "button";
    button.setAttribute("data-action", "ziel");
    button.setAttribute("data-ziel", names[index]);
    item.appendChild(button);
    box.appendChild(item);
  }
  return names.length > 0;
}

// A name taken from the offer, put where the hand already is. The press never
// takes the focus, so the caret is still standing between the brackets when
// this runs. The offer is drawn again right after: the pair is shut now, so
// nothing is being typed any more and the list goes away by itself.
function takeTarget(name) {
  const body = pageBody();
  if (!body || typeof body.complete !== "function") {
    return false;
  }
  const done = body.complete(name);
  drawTargets();
  return done !== false;
}

// ------------------------------------------------------------------ the search

// What somebody is searching for, and which of the found places they stand on.
// The places themselves are not kept here. A replacement moves every place
// behind it, so a list kept from a moment ago would put the mark over a stretch
// that has since become somebody else's word. They are asked for again after
// every step, and only the number of the place survives one.
const finding = {"needle": "", "into": "", "fold": false, "at": -1};

// Which place a step lands on. The list is walked in a ring, because a search
// that stops at the end makes a person start it over; and the place they stood
// on may be gone, because a replacement leaves fewer places than there were a
// moment ago, so a number past the end lands on the first again.
function nextFind(count, at, step) {
  if (count <= 0) {
    return -1;
  }
  if (at < 0 || at >= count) {
    return step < 0 ? count - 1 : 0;
  }
  return (at + step + count) % count;
}

function readFinding() {
  const needle = at("seite-suche");
  const into = at("seite-ersatz");
  const fold = at("seite-suche-egal");
  finding.needle = needle && typeof needle.value === "string" ? needle.value : "";
  finding.into = into && typeof into.value === "string" ? into.value : "";
  finding.fold = Boolean(fold && fold.checked);
}

// Three of seven, said out loud. Without it a person presses the control again
// and again and never learns whether they are going in circles.
function drawFinding(count) {
  if (finding.needle === "") {
    say("seite-suche-lage", "");
  } else if (count === 0 || finding.at < 0) {
    say("seite-suche-lage", TEXTS.find_none);
  } else {
    say("seite-suche-lage",
        fill(TEXTS.find_at, {"at": finding.at + 1, "of": count}));
  }
}

// One step through what the search found, and the mark laid over the place it
// landed on.
function stepFind(step) {
  const body = pageBody();
  if (!body || typeof body.finds !== "function") {
    return false;
  }
  readFinding();
  const places = body.finds(finding.needle, finding.fold);
  finding.at = nextFind(places.length, finding.at, step);
  drawFinding(places.length);
  if (finding.at < 0) {
    return false;
  }
  return body.show(places[finding.at]);
}

// This one place written over, and the search moved on. Which place comes next
// is decided by where the caret ended and never by counting: replacing a by ab
// leaves the place standing, and a count would send somebody around the same
// word forever.
function replaceHere() {
  const body = pageBody();
  if (!body || typeof body.replace !== "function") {
    return false;
  }
  readFinding();
  const places = body.finds(finding.needle, finding.fold);
  if (finding.at < 0 || finding.at >= places.length) {
    return stepFind(1);
  }
  const done = body.replace(places[finding.at], finding.into);
  const left = body.finds(finding.needle, finding.fold);
  let index = 0;
  while (index < left.length && left[index].from < (done === false ? 0 : done.to)) {
    index += 1;
  }
  finding.at = left.length === 0 ? -1 : (index >= left.length ? 0 : index);
  drawFinding(left.length);
  if (finding.at < 0) {
    return true;
  }
  return body.show(left[finding.at]);
}

// Every place written over at once. The sentence says the number and says that
// one step back takes all of them, because that is the thing somebody wants to
// know the moment after they pressed it.
function replaceEverywhere() {
  const body = pageBody();
  if (!body || typeof body.replaceAll !== "function") {
    return false;
  }
  readFinding();
  const count = body.replaceAll(finding.needle, finding.into, finding.fold);
  finding.at = -1;
  say("seite-suche-lage", count === 0 ? TEXTS.find_none
      : fill(TEXTS.find_replaced, {"count": count}));
  return count > 0;
}

function wire() {
  const root = global.document;
  // A press moves the focus, and a moved focus drops what a person marked. So
  // the press holds the focus where it stood; otherwise the control would be
  // the thing that emptied its own input.
  root.addEventListener("mousedown", function (event) {
    // Nur ein Knopf. ``data-form`` traegt zwei Bedeutungen: app/writing.js
    // setzt es auf jede Zeile der Schreibflaeche, um zu sagen, was die Zeile
    // ist, und app/index.html auf die Knoepfe der Leiste. Ohne die
    // Einschraenkung fing dieser Horcher jeden Klick in den Text ab.
    const found = event.target.closest
      ? event.target.closest("button[data-form], button[data-action]")
      : null;
    if (found) {
      event.preventDefault();
    }
  });
  root.addEventListener("click", function (event) {
    const form = event.target.closest
      ? event.target.closest("button[data-form]")
      : null;
    if (form) {
      setForm(form.getAttribute("data-form"));
      return;
    }
    const found = event.target.closest ? event.target.closest("[data-view]") : null;
    if (found) {
      show(found.getAttribute("data-view"));
      return;
    }
    const button = event.target.closest ? event.target.closest("[data-action]") : null;
    if (!button) {
      return;
    }
    const action = button.getAttribute("data-action");
    if (action === "freigeben") {
      releaseFolder(button.getAttribute("data-binding") || BINDING_BUNDLE);
    } else if (action === "loesen") {
      dropFolder(button.getAttribute("data-binding"));
    } else if (action === "oeffnen") {
      takeUp(button.getAttribute("data-name"));
    } else if (action === "speichern") {
      keep();
    } else if (action === "anlegen") {
      layDown();
    } else if (action === "zurueck" || action === "vor") {
      stepBack(action);
    } else if (action === "entwurf-verwerfen") {
      dropDraftAndOpen();
    } else if (action === "ziel") {
      takeTarget(button.getAttribute("data-ziel"));
    } else if (action === "suche-zurueck") {
      stepFind(-1);
    } else if (action === "suche-vor") {
      stepFind(1);
    } else if (action === "ersetzen") {
      replaceHere();
    } else if (action === "ersetzen-alle") {
      replaceEverywhere();
    } else if (action === "beziehung") {
      addRelation();
    } else if (action === "uebernehmen") {
      decide(button.getAttribute("data-side"),
             Number(button.getAttribute("data-spot")));
    } else if (action === "uebernehmen-einstellungen") {
      handOverSettings();
    } else if (action === "abholen" || action === "einbringen") {
      handOver(action, folderName(writesInto(state.mode)), {});
    }
  });
  // The keys everybody presses after typing over a word. A browser keeps its
  // own history over a field, and in every other field of this page that
  // history is the better one and stays untouched. Only inside the writing
  // area is it gone, because every keystroke rebuilds the lines that changed.
  root.addEventListener("keydown", function (event) {
    const key = String(event.key || "").toLowerCase();
    if (key !== "z" && key !== "y") {
      return;
    }
    if (event.metaKey !== true && event.ctrlKey !== true) {
      return;
    }
    const body = pageBody();
    if (!body || !body.root.contains || !body.root.contains(event.target)) {
      return;
    }
    event.preventDefault();
    stepBack(key === "y" || event.shiftKey === true ? "vor" : "zurueck");
  });
  root.addEventListener("change", function (event) {
    const answer = event.target.getAttribute
      ? event.target.getAttribute("data-antwort")
      : null;
    if (answer !== null) {
      answered(answer, event.target);
      return;
    }
    const key = event.target.getAttribute
      ? event.target.getAttribute("data-setting")
      : null;
    if (key === null) {
      return;
    }
    state.values[key] = event.target.value;
    drawMissing();
  });
  const field = at("ablage-suche");
  if (field) {
    field.addEventListener("input", drawListing);
  }
  const said = at("ablage-hinweis");
  if (said) {
    said.textContent = TEXTS.content_question;
  }
}

// The answer of a person, and only after one has been given. Before that the
// surface holds no mode at all rather than picking the friendlier of the two.
function answered(which, control) {
  if (which === "sicher") {
    state.confirmed = control.checked === true;
  } else {
    state.said = which === "ja";
  }
  state.mode = state.said === null
    ? null
    : decideMode(state.kind, state.said, state.confirmed);
  state.values.schreibachse = state.mode === null ? "" : state.mode;
  drawAxis();
  drawMissing();
}

// What the settings mask says after the handover, for all three ways it ends.
// Reporting the setting as done where no order was laid down is the one a
// person cannot recover from: nothing happened, and nothing said so.
function settingsSaid(laid, done) {
  if (done === null) {
    return TEXTS.first_run;
  }
  if (done.placed !== true) {
    return done.message;
  }
  return laid.said;
}

async function handOverSettings() {
  const laid = settingsOrder(state.values);
  drawMissing();
  if (!laid.ready) {
    return null;
  }
  const done = await handOver(
    laid.kind, folderName(writesInto(state.mode)), laid.payload
  );
  say("einstellungen-lage", settingsSaid(laid, done));
  return done;
}

// A new page, led by the head form. A set of values short of one field of the
// first ring writes nothing at all.
async function layDown() {
  const into = writesInto(state.mode);
  const dir = into === null ? null : state.dirs[into];
  const name = at("seite-neu");
  if (!dir || !name || name.value.trim() === "") {
    return null;
  }
  const values = {};
  const boxes = global.document.querySelectorAll("[data-head]");
  for (let index = 0; index < boxes.length; index += 1) {
    values[boxes[index].getAttribute("data-head")] = boxes[index].value;
  }
  const owed = [];
  for (let index = 0; index < RING_ONE.length; index += 1) {
    const key = RING_ONE[index];
    const held = Object.prototype.hasOwnProperty.call(values, key)
      ? values[key]
      : "";
    if (typeof held !== "string" || held.trim() === "") {
      owed.push(key);
    }
  }
  const text = newPage(values.title || name.value, values);
  if (text === null) {
    drawOwed(owed);
    return null;
  }
  const written = await folder().writeFile(dir, name.value.trim(), text, null);
  say("seite-lage", written.message);
  if (written.saved === true) {
    state.held = {"name": written.name, "text": text, "origin": text,
                  "mark": written.mark};
    drawPage();
  }
  return written;
}

// One relation, written into both halves it stands in or into neither.
function addRelation() {
  const body = pageBody();
  if (!body) {
    return;
  }
  const written = withRelation(
    body.value,
    value("beziehung-richtung"),
    value("beziehung-art"),
    value("beziehung-ziel"),
    value("beziehung-grund")
  );
  if (written === null) {
    say("seite-lage", TEXTS.relation_incomplete);
    return;
  }
  body.place(written);
  say("seite-lage", "");
}

function value(name) {
  const node = at(name);
  return node ? node.value : "";
}

// One decided spot. Taking the other version or the one both sides last had
// puts it into the text a person then saves; keeping mine writes over the
// platter, and both go through the same write path.
function decide(which, at_index) {
  const body = pageBody();
  const spot = state.spots[at_index];
  if (!body || !spot) {
    return;
  }
  body.place(takeSide(body.value, spot, which));
  show("seite");
}

async function takeUp(name) {
  const into = writesInto(state.mode);
  const dir = into === null ? null : state.dirs[into];
  if (!dir || !name) {
    return;
  }
  state.held = draftOver(await openPage(dir, name),
                         await folder().recallDraft(into, name));
  state.titles[name] = core().headField(state.held.text, "title", "");
  drawPage();
  show("seite");
}

// The way out of a draft. Without it somebody who wants the saved file back
// would have to delete their own text by hand, which is the one thing this
// whole part exists to prevent.
async function dropDraftAndOpen() {
  const into = writesInto(state.mode);
  if (into === null || !state.held) {
    return;
  }
  const name = state.held.name;
  await folder().dropDraft(into, name);
  await takeUp(name);
}

// Was nach einem Speichern gehalten wird. Ging es durch, ist der neue Stand
// zugleich der Ursprung. Ging es nicht durch, bleibt das stehen, was jemand
// getippt hat: drawPage schreibt state.held.text zurueck auf die Flaeche, und
// waehrend des Tippens schreibt nichts den Text dorthin. Ein Stand, der
// abgewiesen wurde, haette die Arbeit sonst weggeworfen, ohne dass ein Schritt
// zurueck sie noch erreicht.
function heldAfterSave(held, typed, done) {
  if (done && done.saved === true) {
    return {"name": done.name, "text": done.text, "origin": done.text,
            "mark": done.mark, "draft": false};
  }
  if (!held) {
    return held;
  }
  return {"name": held.name, "text": typed, "origin": held.origin,
          "mark": held.mark, "draft": true};
}

async function keep() {
  const into = writesInto(state.mode);
  const dir = into === null ? null : state.dirs[into];
  const body = pageBody();
  if (!dir || !state.held || !body) {
    return;
  }
  const done = await savePage(dir, state.held, body.value);
  if (done.state === "open") {
    drawSpots({"openSpots": done.openSpots, "message": done.message});
    show("vergleich");
    return;
  }
  if (done.saved === true) {
    await folder().dropDraft(into, done.name);
  }
  state.held = heldAfterSave(state.held, body.value, done);
  say("seite-lage", done.message);
  drawPage();
}

// The page opens in a state that can be worked in: without a bound folder the
// guided setup, with one the listing. Never an empty shell (FEAT-06-01).
function start() {
  if (global.document.body && global.document.body.getAttribute("data-workspace") === "true") return;
  wire();
  // Ein Browser, der einer Seite keinen Ordner freigibt, erfaehrt das beim
  // Oeffnen und bekommt genau einen Ersatzweg (FEAT-06-07). Satz und Pruefung
  // standen beide da und wurden von niemandem gerufen.
  if (!folder().carriesFolders()) {
    say("ordner-hinweis", folder().MESSAGES.unsupported);
  }
  drawBindings();
  drawAxis();
  drawSettings();
  drawListing();
  drawPage();
  drawNotices([]);
  drawStanding();
  show(openingView(Boolean(state.dirs[BINDING_BUNDLE])));
  recall();
}

// What the browser store kept from the last time. The handle survives a
// restart, the permission does not, so a folder that comes back stands there
// with the one sentence about the click that brings it back (K-333).
async function recall() {
  for (let index = 0; index < BINDINGS.length; index += 1) {
    const binding = BINDINGS[index];
    const held = await folder().recallFolder(binding);
    if (!held) {
      continue;
    }
    state.dirs[binding] = held;
    const answer = await folder().permissionState(held, "readwrite");
    if (answer !== "granted") {
      say("ordner-hinweis", folder().MESSAGES.permission);
    }
  }
  const work = state.dirs[BINDING_WORK] || state.dirs[BINDING_BUNDLE];
  if (work) {
    state.report = await readReport(work);
    state.kind = state.report && typeof state.report.folder_kind === "string"
      ? state.report.folder_kind
      : KIND_UNKNOWN;
    // Ohne erneut erteilte Erlaubnis wirft die Auflistung, und dann liefe
    // keine der Zeichnungen darunter mehr: die Seite bliebe auf dem Stand
    // stehen, den sie hatte, als noch kein Ordner gebunden war.
    try {
      state.entries = shelve(await folder().listFolder(work), state.titles);
      state.register = await readRegisterFile(work);
    } catch (error) {
      say("ordner-hinweis", folder().withoutPermission(error)
          ? folder().MESSAGES.permission : folder().MESSAGES.blocked);
    }
  }
  drawBindings();
  drawListing();
  drawStanding();
  show(openingView(Boolean(state.dirs[BINDING_BUNDLE])));
}

global.Surface = {
  "DUTY": DUTY,
  "OPTIONAL": OPTIONAL,
  "VIEWS": VIEWS,
  "BINDINGS": BINDINGS,
  "MODES": MODES,
  "FOLDER_KINDS": FOLDER_KINDS,
  "SETTINGS": SETTINGS,
  "SETTING_KINDS": SETTING_KINDS,
  "SECRET_KIND": SECRET_KIND,
  "SEAM_STATES": SEAM_STATES,
  "SEAM_LOCKED": SEAM_LOCKED,
  "ORDER_FIELDS": ORDER_FIELDS,
  "ORDER_KINDS": ORDER_KINDS,
  "ORDER_STATE": ORDER_STATE,
  "ORDER_SETTINGS": ORDER_SETTINGS,
  "ORDER_WIDTH": ORDER_WIDTH,
  "REPORT_PATH": REPORT_PATH,
  "REPORT_FIELDS": REPORT_FIELDS,
  "RING_ONE": RING_ONE,
  "RING_TWO": RING_TWO,
  "PAGE_STATES": PAGE_STATES,
  "BOUND_STATES": BOUND_STATES,
  "DIRECTIONS": DIRECTIONS,
  "RELATION_TITLES": RELATION_TITLES,
  "RELATION_CELLS": RELATION_CELLS,
  "REGISTER_PATH": REGISTER_PATH,
  "SEARCH_FIELDS": SEARCH_FIELDS,
  "WRITTEN_BY_SURFACE": WRITTEN_BY_SURFACE,
  "NEVER_WRITTEN": NEVER_WRITTEN,
  "FIRST_VIEW": FIRST_VIEW,
  "WORKING_VIEW": WORKING_VIEW,
  "TEXTS": TEXTS,
  "openingView": openingView,
  "partOf": partOf,
  "proposeMode": proposeMode,
  "decideMode": decideMode,
  "modeLabel": modeLabel,
  "writesInto": writesInto,
  "mayWrite": mayWrite,
  "settingFor": settingFor,
  "controlFor": controlFor,
  "missingSettings": missingSettings,
  "seamState": seamState,
  "seamSaid": seamSaid,
  "settingsOrder": settingsOrder,
  "labelOf": labelOf,
  "optionLabel": optionLabel,
  "orderRecord": orderRecord,
  "orderComplete": orderComplete,
  "heldAfterSave": heldAfterSave,
  "nextOrderNumber": nextOrderNumber,
  "settingsSaid": settingsSaid,
  "folderName": folderName,
  "placeOrder": placeOrder,
  "reconcile": reconcile,
  "openPage": openPage,
  "savePage": savePage,
  "draftOver": draftOver,
  "nextFind": nextFind,
  "targetNames": targetNames,
  "readReport": readReport,
  "standing": standing,
  "visible": visible,
  "shelve": shelve,
  "visibleEntries": visibleEntries,
  "findFiles": findFiles,
  "headMissing": headMissing,
  "newPage": newPage,
  "withRelation": withRelation,
  "takeSide": takeSide,
  "ringTwoOwed": ringTwoOwed,
  "rowCells": rowCells,
  "relationRow": relationRow,
  "noticeFolder": noticeFolder,
  "readRegister": readRegister,
  "start": start
};

if (typeof global.document !== "undefined") {
  global.document.addEventListener("DOMContentLoaded", start);
}

})(typeof globalThis === "object" ? globalThis : this);
