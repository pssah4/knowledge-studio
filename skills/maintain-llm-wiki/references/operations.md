# Request contract, version 1

All actions return structured results. A refusal is not success. `inspect` lists the
supported actions and runtime capabilities. In a shell package the envelope is
`{ok:true,result:...}` or `{ok:false,error:{code,message,details}}` (exit 1 on error).
Never infer success from a lack of visible UI errors. Read back changed files.
Content, source, workflow and sync calls select an inspected `connection` ID.
Without one they use the persisted active workspace selection, or the sole connection.
Multiple connections without an active selection require a choice; no random default.
They operate on that connection's editable working wiki. Never substitute the remote
wiki folder, a guessed path or an ad-hoc filesystem write for these operations.

## Setup and connections

Begin with `{"action":"inspect"}`. If `next` is `setup`, start a guided conversation,
using known answers and shared folders. Empty folders are valid: create the wiki
structure through configure after collecting the actual answers; source files can
be added later. Collect wiki name/path/purpose/reader circle,
source folders, editor (`builtin`, `obsidian`, `both`) and author identity.
On setup read [setup-sequence.md](setup-sequence.md). Inspect returns
`setup_contract.answers_schema` and executable request shapes in
`setup_contract.requests`. Use those exact names: top-level `id`, `label`, `author`,
`editor`, `language`, `wikis`, `sources`. Each wiki carries its own `purpose` and
`audience`; folder selection uses `wikis`/`sources`, never `wiki_folders`,
`source_folders` or `work_folder`. Partial wiki entries are allowed in a draft.
After each answer call `setup.draft` with `answers` and the
exact `draft_sha256` as `expected` (null for the first save). Resume `inspect.draft`
after an interruption; never ask the person to repeat those answers.
After saving, the next draft uses the returned `sha256`. Top-level fields merge;
supplied wiki/source arrays replace the complete prior array, so retain all known
entries and their fields. Configure has a separate settings baseline (`inspect.sha256`),
not the draft hash. Never discover keys with trial writes. On a refusal, read the
specific field/expected shape and inspect; preserve saved answers, then correct only
that request. A nested `args.action` does not invoke help; use top-level `action`.

For an existing project, inspect also returns
`editor:{exists,version,current_version,update_required}`. On maintain startup, if
update_required is true, run `{"action":"editor"}` against this same project with
its existing settings. Await a committed action result, then inspect again and verify
the starter exists, its version matches current_version and update_required is false.
Only then return the current editor file link. Do not run configure or fresh for an
editor update. Ask no additional setup question; explain that an already-open HTML
tab needs reload/reopen to load the replacement. Query remains read-only and reports
an update requirement instead of running editor.

For host profiles with an explicit file-opening tool, editor.preflight returns
handoff.standalone.status:host_action_required and handoff.standalone.open with
tool and arguments. Execute that request through the actual host tool; returning
its JSON or a Chat link does not open anything. A server status of unavailable is
separate from a valid standalone file handoff. The runtime never claims browser
verification from that request. Missing/foreign/old starters yield no open request.

The editor action returns page plus project_root, entry_path and entry_uri. These
identify the canonical starter for that configured project. Use the returned concrete
path/URI with the host's actual link/open tool; do not replace it with a similarly
named wiki directory or a location remembered from an earlier setup. Node returns
absolute OS locations; vault hosts may return null location fields and use their
actual vault-relative page/native link. The generated HTML records the same location
in script#llmwiki-entry-location; metadata is a location hint, not a filesystem grant.
Verify the updated starter/version against this same root and its saved settings.

The editor app is not wiki content to publish by cp. Never copy it into a separate
wiki/source folder to keep “both editor locations” synchronized. On an explicit user
request for another launch location, use a shortcut/link to the same canonical entry;
do not duplicate its configuration or working copy. Existing independently configured
projects remain separate projects; this rule does not merge or reset them. Historical
memory describing app copies or manual source write/copy workarounds is not evidence
that those steps match the current contract.

Targeted recovery of existing browser connections after the 0.4.2 upgrade can use
`editor` with `recover_browser:{expected:<current settings SHA>,instance:<current UUID>}`.
Read the current configuration through inspect and the existing
`.llmwiki/project-instance.json` through the host's file tool first. This is an
explicit repair for the affected existing project, not a routine update or new setup.
The runtime checks both values and refuses recovery after a fresh reset; never invent
an instance or substitute new baselines to bypass that refusal. Eligible upgrades
from a pre-0.4.2 starter without a marker are handled by the runtime's migration.
Do not enable general legacy auto-binding or attach cached folders by label alone.

An explicit request to start from scratch uses configure with optional `fresh:true`.
Collect the Wiki/Sources choices and answers for this restart; existing grants may be
suggested, but saved answers and browser cache are not confirmation of those choices.
Pass the current settings digest as expected when a project already exists. Fresh
configuration creates a new technical project instance and working copy and preserves
all old files. Emptying a wiki/source folder alone does not remove its saved project
connection or browser grant. Do not infer a reset or delete old state from an empty
directory; ordinary continuation retains the existing setup.

Example configure request (adapt user answers, never use example content as answers):

```json
{
  "action":"configure","id":"wissen","label":"Mein Wissen","author":"Alice",
  "editor":"both",
  "wikis":[{"id":"wiki","label":"Wiki","path":"Wiki","purpose":"Vom Nutzer beschriebener Zweck","audience":["Alice"]}],
  "sources":[{"id":"quellen","label":"Quellen","path":"Quellen","wikis":["wiki"]}]
}
```

Paths are project-relative. More wiki/source entries and each source's `wikis` list
express 1:1, 1:n and n:1. Existing projects require their `inspect.sha256` as `expected`.
Working copies default to `.llmwiki/working/`; a fresh instance gets a separate
working location. Do not ask users to design this technical mapping. However, an
explicitly selected working folder is authoritative: set the wiki's `workPath`
to its project-relative path, or to null with a binding for `work-<wiki-id>`.
Omitting workPath retains an existing assignment, including an external one.
A fresh setup with an explicitly selected working folder requires it to be empty;
existing working content is never silently reused or moved by fresh setup.
Cowork's project directory, host folder grants, and the skill's working-copy
assignment are distinct. Read the actual host grants and project folder context
and compare them with saved settings. A granted folder is not automatically an
assigned working copy. Never silently replace a user's selected working folder
with a host-project default. Existing copies with pending changes require a
separate preserving migration, not reconfiguration as if they were empty.
`inspect.locations` reports resolved device locations, external bindings and
configured write intent; these fields do not certify host sandbox or browser
permission. Verify access using the actual host and read back setup artifacts.
`context` with `connection` selects the actual working copy; never reconstruct it.
External device bindings: use `path:null` and a local
`.llmwiki/device-bindings.json` with `format: "llmwiki-device-bindings/1"` and
`folders: {"folder-id":"absolute host path"}`. Confirm real access; never put those
device paths into the shared project settings. The browser grants its own handles.
When a person adds an external folder in the browser, the connection can already
exist with path:null, a label and native browser access while its agent binding is
still absent. A browser FileSystemDirectoryHandle does not provide its absolute OS
path. Reconcile the existing folder ID with actually granted host folders; where the
identity is clear, validate and add only that device mapping using a structured host
file write. Preserve other mappings and confirm access with a real read/list/context
call. If the identity is ambiguous, ask which granted folder belongs to that label.
Do not recreate the connection, repeat the full setup, use fresh:true, invent a path
or delete settings. In a vault-only runtime use accessible vault paths; an external
browser grant alone does not make a folder accessible to the vault agent.
The Node entry also reads an existing legacy .llmwiki/bindings.json mapping when
the versioned file is absent; --bindings FILE explicitly selects an existing map.
No binding file or external request file needs to be created for the first inspect.
After configure, re-run inspect, check each context, and read wiki/bundle.md through
the configured connection. Previously cached browser connections are not setup
evidence. Use these real reads rather than creating a disposable test/hello.md or
other probe page in the person's knowledge.

`detach` takes `folder` and exact settings `expected`; it changes connections only,
never folders or files. `editor` installs/refreshed the root starter. `configure`
also installs it. `context`, `sync` and content actions require `connection`.
Pass the actual human author for their decisions and a distinct agent identity for
agent-authored changes; do not falsely attribute the agent's edit to the user.

## Sources and knowledge

- `source.plan`: optional `prefix` (directory), `paths` (selected source-relative files).
  Returns new/changed/unchanged/repair_required/renamed/missing/unreadable entries and exact original
  and page digests. Unchanged legacy mirrors without reading evidence return
  repair_required and must not be skipped. Use this before incremental ingest. For a unique rename, ingest
  into the returned existing `page` with `expectedPage`; identity and previous names
  survive. Identical existing copies are separate originals, not automatic merges.
- `source.missing`: `page`, exact page `expected`, `author`, `reason`. Marks absent
  provenance after rechecking the original; keeps the full mirror and acquired
  knowledge. Review dependent claims and relations; do not cascade-delete knowledge.
- `source.store`: `path`, `text` or byte array `bytes`, confirmed `intake` ID, optional `source`. The target
  is the connection default, never an arbitrary source. It exclusively creates a NEW
  attachment and refuses overwriting existing originals. Enable source `writable`
  explicitly in Settings for an attachment inbox; ordinary sources stay read-only.

- `source.inventory`: `connection`, `source` (folder ID). Lists all source-relative
  paths and digests, including explicit errors.
- `source.read`: additionally `path`. Returns complete extracted `text`, original
  metadata, `sha256`, `complete` and `gaps`. Read the entire result before curation.
- `source.ingest`: additionally `author`, content-based `description` and `expected`
  (the original digest). It writes a Markdown mirror only after full source coverage
  is verified and then returns its page/ID. Partial readings remain open without
  creating a visible source page or index entry.
  For an older or incomplete source representation, read its existing `page` first;
  supply that page and its exact `expectedPage` digest to repair or update it.
  This also re-reads an unchanged original when correcting its earlier host
  transcription or visual interpretation. The page ID and annotations remain;
  the replacement is journaled and requires renewed integration review. Without
  explicit `page` and `expectedPage`, a verified unchanged source returns `already`.
  The source ID, foreign head fields and existing annotations are retained.
  For host-only content use `supplement` with the
  same `sha256`, full `text`, and `coverage` entries `{code,part,page,description,kind,content}`
  matching every reported gap (`null` for absent part/page). `kind` is transcription,
  visual-description or decorative. `content` is the actual part-specific content
  and must occur in the full supplement text; for a decorative element explain what
  it depicts and why it conveys no additional knowledge. These records persist in
  extraction.evidence with author, timestamp and original digest. Generic assurances
  such as “59 images checked” do not establish coverage. Legacy mirrors without
  reading evidence remain readable but require re-reading before completion.
  Preserve every slide,
  note, table row, footnote, diagram meaning and original source hierarchy.
- `read`: `page`; returns the whole Markdown and exact `sha256`.
- `write`: `page`, complete `text`, `author`, `expected` (null only for a new file).
  Keep existing foreign head fields/comments; required head is id/type/status/title/
  description. The file-native register controls the allowed types and stable fields.
- `patch`: `page`, `updates`, `author`, `expected`; preserves untouched head bytes.
- `index`: refreshes only the marked generated navigation list.

Keep an inventory of the user's requested files throughout the run. Record each
original path/digest, resulting page and current state; keep failures in that inventory.
Do not deduce success from a Markdown file's existence. Interpret source results as
follows:

| Observed result | Required next step |
| --- | --- |
| source.read complete:false or nonempty gaps | Read the missing content with an actually available host tool, then submit a truthful complete supplement. |
| source.ingest state:coverage_required, stored:false, source_complete:false | No new mirror was stored. Keep path/sha256/coverage in the open inventory, read missing parts, then retry with a verified supplement. If an older source page exists, also supply its current page digest for repair. |
| source.ingest state:curation_required, stored:true, source_complete:true | The full mirror exists. Continue ontology-based comparison, relations, hubs and integration. The result still has complete:false and next:workflow.start. |
| source.ingest state:already, source_complete:true | A verified mirror exists; read its current page and inspect the integration session. complete:false still applies: this does not certify completed integration. |
| source_content or another error | Keep the item open with the actual error. A reader failure does not classify a file as visual-only. Verify its content using an available reader/host tool; never manufacture a placeholder. |

A source.ingest refusal must not be bypassed with write, patch, shell redirection,
copying a hand-written Markdown stub or an alternative conversion script. write and
patch are for authored knowledge and guarded edits, not a substitute for provenance
and coverage verification. Guarded editorial additions outside an existing source
mirror remain possible; changing its protected content/provenance uses source.ingest.
Never manually flip extraction.complete or drop gaps.
The supplement records what was actually read, including image/diagram meaning;
“not extractable”, “will be checked later” or a list of missing images is not coverage.
If the host lacks a required reading capability, keep those files open, report the
specific missing capability, and continue independent files without claiming the
whole collection is complete. This is still unfinished ingest, not an invitation to
defer mandatory source reading to appropriation.
For example, “Presentation slide relationship is missing” is a parser diagnostic,
not evidence of an image-only slide deck. Preserve that distinction in the run report;
claim visual reading or OCR only when an actual host tool supplied that evidence.

For relationships add an authored table outside source text/code fences:
`| out | references | [Example](./example.md) | What this passage establishes for this page. |`.
Read `schema/TYPES.md`: type, domain, range and reason must all fit. Cite stable
`source_id` values in a knowledge note's `sources` list (optional `@^block-id`).
Use `part_of` for content-based hubs, `contradicts` for incompatible statements in
the same time/scope, and `superseded_by` only for actual replacement. A title match
or a newer date does not establish those relationships.

## Integration sessions

For a single chat attachment, read `references/deep-ingest.md` first. Default mode
is `appropriate`, including “ingest this file”. Triage and actual user answers precede
source.store/source.ingest. Only an explicit automatic collection-ingest instruction
selects `ingest`. Topic selection never truncates the full source mirror.


Before storing a chat attachment, call `intake.start` with `source`, proposed source-relative
`path`, original `sha256`, `author`, content-based `assessment`, `compared` (each:
`page,expected,quote,reason`) and `topics` (each: `title,reason`). Its record is private.
Present this triage and wait for actual uptake/theme/form choices. Then `intake.decide`
with `id,author,decision:{choice,reply,selected,form}`: choice is take/defer/decline;
selected lists 1-based theme numbers, form is elaboration/entries/existing/source-only.
Take needs both selections and form. `intake.status` reads the recorded state.
Pass this ID to source.store; exact target and bytes must match the confirmation.
Do not manufacture a reply. Deferred/declined intake must not store the attachment.
An already filed original can still have an intake record; do not copy it again.
Collection ingestion processes existing source-folder files directly, without source.store.
An attachment with a matching confirmed intake cannot switch to workflow mode ingest.
The later workflow.decide records the actually developed insights; uptake alone does
not authorize inventing a Sensemaking note.

Use workflow.list to resume the relevant persisted session before creating another.
After full mirrors exist: `workflow.start` with `mode` (`ingest` or `appropriate`),
`pages` and `author`. After a source change, use `replaces:[previousSessionId]`
to explicitly replace an earlier session. A successor must cover every previous
source in the same mode. Only a currently complete successor supersedes the old
session; history and author decisions remain. Failed or partial successors do
not hide unfinished work. Keep its `id`; every source in the requested inventory must be
accounted for by a completed session or an explicitly open item. Read existing relevant
knowledge with `query` and compare complete passages, then curate links and topic hubs
BEFORE the review. workflow.start returns topic_candidates (page/title/description/expected).
If candidates exist, record.topics.considered must contain the relevant examined
candidates, each with page, current expected digest, verbatim quote, decision
(reuse or not_relevant), and concrete reason. Reused pages also belong in topics.pages.
Read candidates and existing knowledge before creating a competing topic. A justified
empty topics.pages is allowed; an empty candidate review is not. For a requested collection ingest, starting this session and
finishing curation are already part of the task; do not ask whether to do them next.

`workflow.review` takes `id`, `author` and `record`:

```json
{
  "sources":{
    "wiki/report.md":{
      "assessment":"new/refines/contradicts/redundant — choose after reading",
      "reason":"Specific assessment and applicability conditions",
      "relations":"linked",
      "compared":["wiki/current.md"],
      "evidence":[{"page":"wiki/report.md","quote":"Exact source passage"},{"page":"wiki/current.md","quote":"Exact compared passage"}]
    }
  },
  "topics":{"reason":"Why these content-based hubs fit, or why no shared theme exists","pages":["wiki/subject.md"]},
  "insights":[{"statement":"An insight developed from the comparison","evidence":[{"page":"wiki/report.md","quote":"Exact supporting passage"}]}]
}
```

Every source and every compared page needs a real quote. In batches, compare each
source with at least one other source from the batch, as well as relevant existing
knowledge. A new empty wiki does not mean there is no comparison basis among sources. `relations:"none"` needs a
reason after examining the actual knowledge; it is not a shortcut for missing links.
A declared linked relationship must exist in the typed graph. Every listed topic
must group a reviewed source through a valid part_of edge. These checks also apply
to no_change closure. Search and read existing topic candidates before creating new
ones; an index is never a topic substitute.
The review snapshots source, compared pages and ontology. Any relevant change makes
it obsolete. Ingest continues autonomously to curated insights and completion.

Appropriation pauses for the actual dialogue: explain what is known, novel, doubtful
or contradictory; develop insights together. Record `workflow.decide` with `id`,
`author`, `decision:{choice:"take"|"defer"|"decline",reply:"actual user words"}`.
For take include `selected:[1,...]` (one-based insight indexes) and
`form:"elaboration"|"entries"|"existing"`. Never invent a reply, select on timeout,
or infer adoption from uploading a file. Write agreed statements separately with
their source IDs. `workflow.finish` takes `id`, `outputs` and `author`; accepted
statements and evidence must occur in those pages. Each output citing a session
source must have an outgoing Markdown link in the output’s related property.
Source IDs alone do not satisfy navigation. The index derives a collapsible incoming
link block in the source body; incoming links do not belong in related. A typed
relationship retains its type and reason in the authored out row and graph. An automatically created topic/summary is not evidence of dialogic sensemaking. In ingest mode, ALL recorded
insights must likewise occur in the output pages with their source IDs. Old reviews
without policy 2 need re-review; their evidence and history are retained. Follow `workflow.status.next`.

An integrated result requires at least one supported, materialized insight.
When a reviewed batch yields no new knowledge, `workflow.finish` may use
`outcome:"no_change"`, empty `outputs`, empty insights and a concrete `reason`.
This closes the review with `resolved:true`, **not** `complete:true`; do not report
that these sources have been integrated. Never manufacture an insight to pass a
validator. Appropriation still requires the actual user decision.

## GraphRAG and maintenance

`query` takes `question`, optional `connections` (explicit accessible wiki IDs),
`filters` (wiki/type/status/owner/class/tags, AND between fields), `limit` (1–100)
and `hops` (0–4), `max_context_chars` (1000–2000000, default 120000). It returns
BM25 seeds, bounded source passages, typed graph routes, opposing
evidence, citations and any more-matches/failures. Each passage has original character
offsets and a truncation flag. `context_truncated` prevents `complete:true`; read the
full relevant page through `read` before drawing conclusions. Navigation pages are
not lexical seeds. No embedding service or durable search cache is claimed.
`graph` returns nodes, edges, reasons and findings for all selected wikis.
Any graph finding prevents query `complete:true`; this flag describes technical
retrieval integrity, never a guarantee of semantic truth.

Changed, missing, renamed or repair-required entries in `source.plan` include
`affected` pages reached through citations or incoming typed links. Read each
candidate, re-evaluate its claims against retained and current source evidence,
and update justified statements and relationships before finalizing a successor
session. A dependency is a review prompt, never permission to rewrite facts.
For duplicate entities, compare identifying facts, retain a canonical ID, add
aliases, preserve evidence and link the old page with `superseded_by`. Retarget
reviewed references explicitly. Never delete the old page to make a merge pass.
`readiness` returns `knowledge` (ready/findings), `workflows` (sessions per wiki),
`publication` (synchronized/differences), `originals` (current/changed/missing/
missing_acknowledged/unavailable), aggregate `complete` and `blocked_by`.
Unpublished files or changed/missing/unavailable originals also block completion. The blocker codes are `knowledge_findings`,
`workflow_incomplete`, `workflow_error` and `workflow_missing`, with `wiki`, `page`, `id` or
`next` where applicable. Complete is false if knowledge is not ready, any returned
workflow is incomplete or faulty, or a source page is not covered by a workflow. An earlier completed session does not
cover sources ingested later. These
fields describe the existing selected wiki state; they cannot certify coverage of an
entire requested source inventory that has not been stored. Maintain that inventory
separately. Repair open items; never make a failed check pass by deleting a requirement
or its workflow record.

## Completion checks

An ingest run is complete only when all of the following are evidenced for its
requested scope. These are checks on existing action results, not an extra API.

1. Every requested source has a current full mirror and no unresolved coverage or
   inventory/read error. Reconcile paths, not just counts. Do not drop unsupported
   files or count placeholders to make totals agree.
2. Each applicable workflow.finish succeeds, and a fresh workflow.status returns
   next:done, outcome:integrated and complete:true. Deferred/declined appropriation is
   an explicit user outcome, never an integrated source or an ingest shortcut.
3. Refresh index, synchronize every affected connection, then run readiness for the affected connections. Its complete and
   knowledge.ready must be true with no findings or blocked_by entries; inspect the
   relevant workflow sessions separately and retain the source inventory check above.
   When an earlier deferred/declined session keeps the overall wiki incomplete, report
   that explicit status separately; do not reclassify the user's decision as consent.
4. Sync every affected connection and inspect pending and conflicts. Pending writes,
   conflicts, prepared Vault transactions or a failed publish remain open. For Vault
   Operator resume each transaction through complete before using its action result.
5. Read back the actual source and knowledge pages through context-selected connections
   and refresh the project-root editor artifact using editor. Return the current host
   file link. If an already-open browser can be inspected, verify those same pages;
   otherwise state that browser visibility has not been observed. An empty editor is
   a connection/sync/visibility issue to investigate, not proof the source folder is empty.

The completion message states requested/full-mirror/integrated counts, affected wikis,
remaining file-level failures or coverage gaps, and actual sync/visibility results.
Use “incomplete” when an indispensable phase remains open. Do not label unresolved
source_coverage_unverified findings “expected” and declare the ingest complete.

## Collaboration and Obsidian

On Node, `sync` is resumable too. For EACH connection, execute every exact
`next_request` until it is null; retain all returned conflicts and pending findings.
`sync_complete` covers transfers only; graph and shadow stages also need their
continuations. `complete:false` must be explained even when the process exits 0.
A `blocked` result has no automatic next step: retry its `resume_request` at most
once, then report the named unresolved file if it blocks again. Never continue the
maintenance as complete, skip clearance, edit the checkpoint or broaden access.
A stale cursor needs a fresh sync; saved Markdown and review history remain intact.

Node controls: `budget_ms` (100–20000, default 20000), `read_timeout_ms`
(25–15000, default 15000, capped below the call budget), `max_steps`
(1–256, default 64). Normal runs use defaults. A private derived checkpoint at
`.llmwiki/sync/<connection-hash>.json` is bound to the exact returned cursor,
project instance, settings and folder bindings; it expires after 24 hours.
Completed units are reused only after their file and directory proofs still match.
All writes keep the existing clearance, immutable journal, author-chain and CAS
checks. Pending/conflict findings may contain `detail_request`; read that request
before continuing the sync. Then request each returned text field with
`detail.field` and `detail.offset` until `next_offset:null`. Do not pass a summary
as `conflict.resolve` input; it needs the full, current original conflict texts.
Vault/browser sync retains its original single-call contract.

Run `sync` before and after edits. It exchanges Markdown, baselines and immutable
author events. It does not delete. `conflicts` preserve base/mine/theirs. `pending_details` names individual files and
reasons (author_chain_missing/read_only/size_limit). Missing author chains also
include the exact comparison and can use conflict.resolve after explicit review. Show the
actual texts, differences and authors (`review.read`), then use `conflict.resolve`
with the unchanged `conflict` object, chosen `text`, `author` and `message`.
Keeping mine sends a rejection; a different text sends a proposal; accepting theirs
records acceptance. Replies travel to the other author on sync. Clocks never win.

`review.read` takes `page`, `author`, optional seen event IDs. `review.respond` takes
`page`, parent event `id`, exact current `expected`, `author`, `choice`
(`accept`/`reject`/`proposal`/`comment`/`resolve`/`reopen`), optional `text` and `message`. Resolve/reopen append immutable discussion events; they never change file content. Editor comments additionally carry a hunk anchor (quoted before/after lines, line positions, snapshot hashes); read and preserve it when answering. Partial editor acceptance keeps the remaining proposal open.
A proposed separate version is a new Markdown page through `write`, linked to its
parent in the response. Restore an earlier text only through a new guarded save;
never erase history. In Obsidian the host agent provides the same comparison and
decision dialogue. Changes made outside the journal have unknown author unless
the person explicitly identifies them; no fabricated attribution.

## Workspace choices

`workspace.select` takes connection and optional work. It persists the active selection
in the instance-bound `.llmwiki/workspace-state.json`, shared by built-in editor and
agent. Multi-work connections require an explicit work choice. `context` returns the
actual working copy, source assignments and connection.default_source. Configure accepts
optional wiki/source `icon` (folder, book-open, user, users, briefcase, library, archive,
database) and wiki `default_source`. Existing single-source mappings remain usable;
multi-source mappings need an explicit upload default. Settings stores these fields
in llmwiki.project.json. Obsidian can open context.work; agents use the same selection,
not a separately remembered vault. Native Obsidian workspace tracking remains future work.

### `workspace.relocate`: vorhandene Arbeitskopie umziehen

`{action:"workspace.relocate", connection, work, expected, target:{id,path}}`.
`expected` ist der exakte Hash von `llmwiki.project.json`; `target.id` ist eine neue,
bisher unbenutzte Ordner-ID. `path` ist projekt-relativ oder `null` mit bereits
freigegebener Gerätebindung für diese neue ID. Der Zielordner muss existieren und
leer sein (eine `.DS_Store` wird ignoriert). Alle Projektablagen müssen auflösbar sein,
damit Überschneidungen ausgeschlossen werden können.

Die Operation kopiert und prüft den gesamten Arbeitsbestand einschließlich versteckter
Review-/Workflow-Daten und überträgt die Sync-Basis auf die neue Ordneridentität.
Erst danach werden Einstellungen, aktive Auswahl und Editor-Einstieg aktualisiert.
Sie löscht weder alte noch neue Dateien und veröffentlicht nichts. Bei Abbruch bleibt
eine Teilkopie gegebenenfalls im Ziel liegen; diese wird nicht automatisch entfernt oder
überschrieben. Im Vault-Bridge gelten weiterhin Texttransaktionen und deren Größenlimit.
Eine aktive Browser-/Obsidian-Bearbeitung während des Umzugs beenden; externe Programme
bieten keinen gemeinsamen Schreiblock. Anschließend den Editor neu öffnen und bei
Bedarf dem neu gewählten Ordner Browserzugriff geben. Bestehende Arbeitskopien nicht
per `configure.workPath` umbiegen; `configure` verweist dafür auf diese Migration.

## File organization

- `folder.create`: `path` creates a visible user folder in the selected working copy.
- `document.move.plan`: `moves:[{from,to}], author` checks all targets and returns a persisted plan ID and affected paths.
- `document.move.apply`: `id` applies/resumes that exact plan, preserves preimages under `.llmwiki/moves/`, updates links and rebuilds navigation. Stale inputs stop without overwriting them.
- `wiki.flatten.plan`: `author` prepares existing sources/topics/entities/concepts files for flat `wiki/` placement. This moves files; it does not semantically consolidate concepts or invent topics. Read and consolidate those separately.

Never implement detachment with a move or delete. Detachment only removes a binding.
For Vault Operator, prepared writes must finish their transaction first. If the
result reports `requires_host_move`, verify the source hash and use the host's
`move_file` with that exact source/destination to archive the original, then
resume `document.move.apply`. Do not replace this step with deletion or guess
a `ctx.vault.rename` method. If the host changes Markdown during its move, the
next preimage check stops for review. Keep moves small enough for host limits.

The derived `.llmwiki/graph.json` contains node paths and IDs, typed edges and
their reasons, and unresolved findings. It is rebuilt from Markdown, never edited
as an independent source of truth. Query and traversal build the same graph over
the selected accessible wikis; `index.md` remains a readable entry page.

`metadata.repair` migrates one legacy page with `page`, `expected`, `author` and,
when needed, a curated `description` (at most 25 words) and evidenced `generated`.
It archives the exact preimage, moves extraction proof into hidden storage and
removes duplicate metadata fields without changing the source mirror. Existing
creation evidence is retained; missing dates/authorship must not be guessed.

## Project graph and complete monitoring

Maintain-only {"action":"graph.refresh"} builds .llmwiki/graph.json with format
llmwiki-project-graph/1, project identity, wikis, nodes, edges (type/reason/origin),
findings, revision and generated_at. This is the only graph read by the editor.
Unchanged exports retain their revision/timestamp; Markdown remains authoritative.
Writes return graph or graph_error; a graph_error does not undo an already saved file.

Maintain-only {"action":"source.monitor"} returns pairs for ALL connections and their
assigned source roots, recursively. Each pair has plan.changes or an explicit error.
Use its connection/source IDs for ingest. It plans, it does not claim ingestion.

Node runs this action in bounded calls (default 20 seconds of reading, at most 128
source files and 64 findings per response, below 32 KiB JSON). A single read has a
2-second budget. The CLI runs a worker with the same Node executable and sandbox. After the first
read timeout, the worker starts no further reads; it saves progress with the existing
project grant and sends the result to its supervisor. The supervisor terminates the
worker, drains JSON to stdout and exits. A 35-second watchdog terminates a worker
that cannot return a saved checkpoint and reports an explicit failure.
No software installation or host timeout/permission change is needed.

Retain every response's `notes` and `pairs`, then execute the returned `next_request`
verbatim until it is null. It includes action and the exact checkpoint `cursor`.
Optional smaller budgets: `max_files` 1–256, `max_items` 1–128, `budget_ms` 100–20000,
`read_timeout_ms` 25–5000 (capped to a quarter of the call budget). Normal runs use
the defaults. A response can contain one fragment of a source pair; `plan.counts`
counts only that fragment, `total_counts` the entire pair, `page_complete` its last
fragment. Preserve advisories too. `monitor_item_too_large` identifies an item for
separate reading and keeps the scan incomplete; it never silently drops a finding.

- `scan_finished`: every connection/source task has been attempted.
- `scan_complete`: finished without unreadable sources, notes or task errors.
- `delivery_complete`: the last result fragment has been delivered.
- `complete`: delivery and scan complete, with no outstanding source/note changes.
  This monitor never performs ingestion, semantic review or acknowledgement.

`progress` names counts and the current source. A timed-out source is retained as
`unreadable` and the next call continues past it; `read_timeout`/`unresolved` identify
the immediate interruption. Finish other findings, report unresolved originals,
and start a fresh scan when those files become available. A missing binding or
blocked note/plan task stays an explicit per-connection error.

The only monitor write is the replaceable derived checkpoint
`.llmwiki/source-monitor.json` (32 MiB limit; file names/digests/findings, no source
bodies). Original folders, authored notes and review records are never changed.
Cursors use its exact hash and are bound to project settings, device bindings and
24-hour scan age. A concurrent call, changed settings or stale cursor produces
`monitor_stale`: start a fresh scan without a cursor; never edit the checkpoint.
Finish the entire inventory before comparison. `progress.phase` advances from
`scan` to resumable `validate` to `compare`, each with a fresh call budget.
Recheck names and file metadata to
reject source drift; partial inventories cannot infer missing/unique rename states.
Unreadable candidates prevent a confident rename. Ingest still rechecks exact source
bytes before writing. A completed scan is an observation, not a filesystem lock.
Vault uses the existing single-call contract without the Node checkpoint.

## Own Markdown notes and embedded images

Read `own-notes-and-images.md`. Run sync for every connection before monitoring
external editor changes. `source.monitor` also returns `notes` for source-free wikis.
`note.plan` returns new/changed/unchanged/dependency_changed/unreadable with current
expected hashes and embedded asset states. It is read-only and never acknowledges
work. Process pending notes semantically; finish with a verified `note.review`:

```json
{"action":"note.review","connection":"wiki","page":"wiki/Meine Notiz.md","expected":"<final sha256>","author":"<actual author>","quote":"<verbatim note passage>","assessment":"<content assessment>","topics":{"reason":"<topic classification and why>"},"relations":{"decision":"linked","reason":"<why these relationships>"},"compared":[{"page":"wiki/Verwandte Notiz.md","expected":"<sha256>","quote":"<verbatim target passage>","reason":"<comparison>"}]}
```

A valid typed edge must connect the note to a compared page when decision=linked.
Use decision=none with an explained reason if no semantic relation exists. No
mandatory concept taxonomy; preserve authorship, unrelated fields and authored text.

- `attachment.plan`: per-wiki image inventory, parents, reading states, missing or
  ambiguous embeds and unreferenced originals. Does not generate image graph nodes.
- `attachment.review`: path, expected, author, kind=content|decorative, title,
  description, transcription (full, possibly empty for non-text images), interpretation
  (separate), gaps=[unresolved regions]. Content readings must appear in the parent
  Markdown before note.review. With gaps the reading remains incomplete.
- `attachment.rename`: path, expected, author. Uses a complete reading to choose the
  canonical capture-date/title/digest filename, creates bytes and repairs embeds to
  Markdown links with guards. Original remains intact. No arbitrary target path.

Binary image sync copies missing files byte-for-byte; different bytes at the same
path return pending_details with reason=asset_conflict and both hashes. Keep both
versions, choose a new semantic filename and update the embed for an explicit
resolution; do not pass images into a text conflict resolver. A Vault bridge without
writeBinary refuses binary mutation. All prepared binary transfers retain preimages
and obey the existing transaction size/write limits.

## Existing Obsidian wiki connected in the editor

Keep the existing wiki connection; resolve any missing host binding from the already
granted folders. Do not create another project or ingest own Markdown as source copies.
Sync first; source.monitor includes note.plan for wikis without sources. Read and review
new/changed notes against the existing wiki using own-notes-and-images.md. If the type
register or bundle is missing, collect the missing purpose/audience facts and call
`wiki.initialize` with `connection`, `purpose`, `audience:[...]`, `author`, optional
`language`. It creates missing administration pages in the working wiki, preserves
existing navigation/notes and refuses an invalid existing ontology. Do not reconfigure
the whole project. This operation does not itself semantically review the notes.
Run index after curation: resolvable authored Wikilinks become Markdown links, while
code and complete source quotations stay unchanged. Ambiguous/missing targets remain
findings, never guessed. Sync changes and run graph.refresh at the project root.
The editor does not run the agent when a folder is attached; it appears in the next
Maintain run. Existing files, IDs, foreign properties and attachments are preserved.

## Verified editor handoff (0.4.12)

For Node maintain, read [setup-handoff.md](setup-handoff.md) and call
`{"action":"editor.preflight"}` against the canonical configured project root
before promising the built-in editor or starting it. This is not a setup reset.
The result separates configuration, editor mode, host capability and browser evidence.
`ok:true` alone never means setup is complete. `setup_complete:false` and
`browser_verified:false` remain open until the actual editor access is verified.

- `status:setup_required`: repair only the reported existing setup fields.
- `status:native_editor`: use the returned `handoff.obsidian[].path`; do not start
  a server for Obsidian-only mode. These are the actual working copies, not sync targets.
- `status:unavailable`: no server retry. Explain `reason` accurately and guide one
  next step through the canonical standalone HTML or the configured Obsidian working
  copy. Profiles with local binding forbidden skip the attempt.
  This is not evidence of missing process persistence. Folder grants do not permit
  ports. Never disable the sandbox, change its policy or launch outside it as a workaround.
- `status:available`: a short closed socket probe succeeded. Only call
  `{"action":"editor.start","open":true}` when this is the user's local execution
  machine or an actual reachable host preview exists. A remote VM's localhost is not
  the user's localhost. Read `running`, `status`, `reason`, `browser_open` and `next`.

`editor.start` enforces the same preflight. A denied capability returns
`running:false` without a misleading success URL. A failed child reports its current
startup diagnostic; a browser opener failure leaves a running server available via
its returned personal URL. `browser_open.status:requested` only means the OS opening
request succeeded, not that the page is visible or file access works. Return that URL
only to the current user. Do not copy the token into diagnostics or shared documents.
A permitted local start also returns a project launcher and supports `editor.stop`.
Never suggest a launcher as a way around a denied host capability.

Standalone grants require Chrome or Edge with File System Access. Do not offer
Firefox as an equivalent writable fallback. Show `handoff.standalone.steps` one at
a time: canonical project first, then the external roots actually requested. Relative
working copies are already beneath the project grant. Known filesystem paths cannot
programmatically grant browser permission or eliminate native folder selection.
Keep all saved settings; do not reconfigure/copy HTML into another connected directory.

Report “Konfiguration gespeichert; Editorzugriff noch offen” while opening or grants
remain unverified. Give one concrete next step, continue an already authorized ingest
independently when possible, and never present an untested editor as fully ready.

### Upgrade of older integration reviews

0.4.11 uses review policy 3. Older completed reviews reopen at review; their sources,
outputs and decisions remain intact. Read the now-returned topic_candidates and
repeat the actual content/relationship review. Do not replay old acceptance as a new
reply. A prior policy-2 automatic ingest may be explicitly replaced with an
appropriate session over all its sources when the user wants the missing dialogue;
only a completed successor supersedes it. Ordinary current sessions keep the same
mode and full source coverage when replaced.

## Portable metadata and directed navigation (0.4.16)

Technical generated/resource/sources values remain authoritative in an inert
llmwiki:metadata JSON comment directly after YAML. Runtime reads merge them with
visible properties; always edit through patchHead/projectMetadata, never drop this
comment when replacing a body. Raw source IDs are evidence references, not topic
relationships. A plain related link is navigation, not evidence or a semantic reason.
Visible resource contains only original links. Optional source_created_at,
source_modified_at and generated_at are flat display projections. Do not invent dates.
A collapsed Sources and evidence callout makes original and evidence links clickable
in Obsidian reading mode; native Obsidian Properties do not render Markdown links.
Outgoing links belong in related; all incoming links are derived in the closed
relation-in callout under Beziehungen/Relations using Markdown links and the
vault-operator:incoming-links markers. Never add reverse related entries just to
make backlinks. Preserve existing authored links and source mirrors.


## Markdown shadow and retained quotes

On Node hosts (22.13 or later), maintain a private, project-bound SQLite cache
outside the project. Markdown remains authoritative and is never rewritten to add
shadow IDs. Browser/Vault reports `sqlite_unavailable` and performs read-only
structural retrieval from current Markdown; persistent maintenance requires Node.

- `{"action":"shadow.refresh"}` updates selected accessible connections (`connection`
  may restrict scope). Unchanged files are not reparsed. After external edits or a
  source-monitor workflow, run this at the end of maintenance. Write, patch, index,
  ingest, applied document moves, workflow completion and sync refresh automatically.
- `{"action":"shadow.status"}` reads freshness and findings without creating a cache.
- `{"action":"shadow.rebuild"}` explicitly replaces the disposable cache, rebuilding
  from current Markdown and shared identity records. Retained evidence survives.
- To retain a concrete quotation, submit the returned passage's `pin_request` to the
  maintain skill (`shadow.pin`, `wiki`, `document`, `revision`, `occurrence`). The
  result contains the quote ID and an editor link when an entry file is available.
- `{"action":"shadow.resolve","id":"<quote-id>"}` is read-only. Keep historical
  wording separate from its current successor; never silently substitute a match.
  The editor's **Open retained quote** button also accepts the ID or returned link.

The cache defaults to 128 MiB of serialized document data, with bounded SQLite
page overhead. `cache_bytes` overrides this budget on shadow actions (1 KiB–1 GiB).
Parsing defaults to 8 MiB per document; a scan is bounded to 10,000 files/64 MiB.
Quote retention defaults to 8 MiB per wiki (`maxBytes` on `shadow.pin`). A full
budget is reported without removing retained evidence. Save/ingest results remain
valid when a subsequent shadow refresh reports incomplete; inspect `result.shadow`.

Sync exchanges only content-addressed identity packages and deliberately retained
quotes under `.llmwiki/shadow/changes/` and `.llmwiki/shadow/pins/` inside each wiki.
These directories belong in backups: a lost local cache can be rebuilt; deleted
shared evidence cannot be recreated from a newer document. SQLite, locks and full
old-document copies are never exchanged. Duplicate or conflicting identities
remain unresolved. Structural matching and BM25 do not imply semantic equivalence;
vector retrieval is a separate, unimplemented feature.


### Shadow recovery and transport (0.4.18)

Large document identities are automatically split across packages of at most
512 KiB by default. This is a transport limit, not a document-size limit.
`maxBatchBytes` on refresh/rebuild configures package size (4 KiB–8 MiB); normal
operation needs no override. `cache_bytes` only controls SQLite, and `maxBytes`
on pin only controls retained quotes. Do not guess a larger SQLite budget for
a transport error. `help` includes `shadow_contract` with these distinctions.

Update **both skills and the editor** to 0.4.18 or newer before exchanging
fragmented identities. Old complete identity packages remain supported. Only
complete, checksum-verified fragment sets are usable as durable identities.
An interrupted transfer reports `shadow_exchange_incomplete`; finish sync or
repeat refresh. Existing packages are reused. Refresh can repair missing shared
identity packages from an intact matching cache without changing block IDs.
If both shared evidence and its cache were deleted, old identities cannot always
be reconstructed: restore them from a backup if historical references matter.

**Never delete `changes/` or `pins/`, and never remove or temporarily move source
Markdown to work around a shadow error. Identity packages are durable evidence,
even without pins.** Rebuild does not remove shared evidence. Healthy cached
scopes remain until replacement succeeds; rebuilding one connection preserves
other scopes. `complete:false` and `findings` describe the affected wiki, phase
and budget where available. Successful other wikis remain usable.

Use the host-provided Node executable directly; no Python, global installation
or local server is needed. The SQLite ExperimentalWarning is emitted by Node
on stderr and is not a failure; evaluate the JSON result and process exit status.
Browser editor reads exchanged quote records; all Node skill profiles
maintain SQLite. Vault Operator retains its explicit read-only fallback.


### Known changes and exact excerpts (0.4.21)

`{"action":"shadow.refresh","connection":"wiki","paths":["wiki/Note.md"]}`
checks known, previously indexed paths. Omit `paths` for a full reconciliation.
New or missing paths, a missing cache, or rebuild automatically use a full scan.
`full_scan:false` / `scope:"paths"` means only the named paths were checked;
`complete` refers to that scope. Known write/patch results with an explicit
connection use this path automatically. Index, workflow completion, sync and
unqualified refresh continue to reconcile the entire accessible wiki. Do not
replace these final full scans with file events or mtime comparisons. Query
always checks current source content independently and never writes the cache.

For a query excerpt inside a large block, execute the exact `pin_request`, including
its `start` and `end` when present. Do not expand it to the whole occurrence.
Both skills and the editor must be 0.4.21 or newer for partial-quote successor
highlighting. Older full-block pins and identity packages stay readable.
Unchanged unique blocks retain IDs based on durable history. Two ordered
unchanged neighbors can suggest candidates for intervening changed blocks;
these candidates have new IDs and are never silently chosen as successors.
No fulltext-dependent split/merge inference is made after a cache loss.

The BOM coordinate correction uses selector version `markdown-structure/2`.
After updating, run one full shadow.refresh to migrate current metadata.
Existing packages and pins are retained; unchanged uniquely matched block IDs
survive. A legacy selector is never highlighted unless its original range can
be verified. No new Markdown parser library is included.

## Inline citations in answers

Place a numbered source link immediately after every factual claim based on the
wiki: `The team lacked a decision mandate. [1]` (with [1] as an actual Markdown
link). Lists need a link on each supported item; tables need links in the relevant
row/cell. Distinguish synthesis from direct quotes and cite the supporting passages.
A source directory at the end does not replace these inline links.

Use `citations[].shadow.passages[].markdown` for the selected exact passage.
Its `editor_href` is the complete canonical editor URL, including `#passage=...`.
Copy that destination unchanged. You may renumber link labels across several Query
calls, but never rebuild URLs from filenames, use relative `wiki/...` paths, drop
the fragment or invent anchors. Do not output the whole answer in a code/text block;
return normal Markdown so the host renders the links. Include a short source title
when it helps the reader choose between supporting documents.

The editor opens the matching Markdown source copy or wiki document and highlights
the original range, after current project/folder access is confirmed. The link binds
the project instance, working copy, revision and quote hash. An old link follows
only an unambiguously unchanged block; edited, missing or ambiguous text is reported
instead of highlighting another passage. Query creates these links without writing
pins. The compact link does not archive deleted wording; explicit retained pins
continue to preserve historical quotations independently.

If returned context is insufficient, read the relevant file and query its specific
supporting wording to obtain the exact passage link before citing that new claim.
Check `retrieval_basis` and findings: a graph neighbor is context, not proof.

Check `citation_links.available/reason`. An old/missing editor requires a separate
Maintain editor update; Query must not update it or invent a working link. Retrieval
can still answer with quoted wording and disclose this specific link limitation.
Use the host's supported clickable link rendering. When runtime.md specifies a
Node browser-answer workflow, the separate presentation helper creates and opens
a new HTML answer with these inline references; knowledge retrieval remains
read-only. The host's chat link limitation must still be disclosed. Never invent
an application URI or localhost link. Browser/Vault read-only retrieval remains
available.

`shadow.resolve` accepts `{action:"shadow.resolve",reference:"<passage.reference>"}`
for a Query address, or `id` for a retained pin. Both are strictly read-only.

## Existing collections, participation and scoped transfer

`collection.assess` reads `folder` (default root) without changing files. It works
before setup on the granted root, or on the selected connection's work folder;
`source` selects an assigned read-only original folder. The result names every
page, observed field/value, known vocabulary, duplicate identities/names and each
read failure. Readers describe the selected folder; labels never grant access.

`collection.upgrade`, `collection.map`, `published.adopt`, `sharing.move` and
`ingest.group` use reviewable stages. Start with `step:"preview"`. Review the
complete result and repeat the same inputs with `step:"prepare", expected:<token>`.
For transfers also repeat the returned `at`. Preparation stores only a private
plan. Show its exact changes before `step:"apply", id, approved:true`. A missing
approval does not apply anything. `step:"decline", id` rejects an unstarted plan;
`step:"status", id` inspects it. Resume the same ID after an interruption.
A changed preimage, source, reader circle or required register blocks application.
Never substitute a new expected hash to force an old approval through.

- `collection.upgrade`: `folder, stage, author, changes:[{page,expected,text}]`.
  Each named stage changes only Markdown in that folder and preserves identities,
  original mirrors and provenance. `step:"rollback", id, approved:true` restores
  the exact owned beforeimages. Later edits are reported as conflicts and retained;
  other folders are not restored. A vocabulary still used by another document is
  retained with register_in_use. Rollback can be resumed.
- `collection.map`: `folder, author, mappings:[{field,to,values:[{from,to}]}]`.
  Explicitly decide every observed field. `to:"keep"` retains a foreign field;
  mapped fields require every observed value. Registered core fields or existing
  extension definitions are valid targets. An unknown type can be retained with
  `to:"type", inherit:true` and an identical from/to value; this registers the
  inherited genus. Multiple type/class/status values require an explicit `value`
  chosen from their mapped meanings. Comments and body text survive. Mapping
  decisions and vocabulary changes are part of the same reversible stage.
- `published.adopt`: `navigation, author` reads an existing MkDocs YAML `nav`
  and `docs_dir` (default `docs`). It retains body text, paths and configuration,
  writes registered `publication_group` and `publication_order` fields, and lists
  unlisted pages. Unsupported navigation syntax is refused rather than guessed.
  `published.check` with `navigation` reports later drift. Document fields are
  authoritative after adoption; reconcile generator navigation with those fields.
  Run the site's existing build and URL/link checks before approving a real site;
  a file-preservation result alone does not prove production availability.
- `participation.register`: `field:"x_<name>", label, author, expected` registers
  a boolean in `schema/FIELDS.json` (expected null only when absent). Use neutral
  names, without promises of privacy or access control. `participation.set` takes
  `page,field,value:true|false,author,expected`. `participation.overview` takes
  `field,connections`; it shows only currently readable participating pages and
  explains an empty result. `query.filters.participates` accepts the registered
  field name; normal relationship and counterevidence retrieval still applies.
- `ingest.group`: `label, author, sources:[{source,path,description?,page?,expectedPage?,supplement?}]`
  previews exact original hashes and readers. Prepare returns actual source-mirror
  writes for review; each group is approved independently. Curation requests
  (`write`, `patch`, `source.ingest`, `workflow.start/review/decide/finish`) include
  `group:<approved id>` to retain their actual writes in that group's journal.
  Existing semantic workflow gates remain mandatory. `ingest.take_back` takes
  `id, approved:true`; it reverts owned writes, preserves later edits and other
  groups, and never edits original files. A subsequent explicit sync archives matching
  published afterimages and preserves changed remote versions as conflicts.
  Immutable review/evidence history stays
  available. A stored source mirror is still not completed semantic integration.
- `sharing.move`: `page,target_connection,target_page,author` previews both
  reader circles, readers gaining/losing access and the complete page. Approval
  transfers one canonical identity between working wikis; sync remains the
  explicit publication step for both connections. The original location becomes
  a neutral, scoped redirect, resolved only with target access. Both stores retain
  direction, author and timestamp. Linked local assets retain their bytes; source
  representations require the same original connection at the destination.
  Reverse a completed transfer with a new reviewed transfer in the other direction.

Vault writes still use the enclosing transaction protocol: prepared/pending means
resume that transaction before any other action. A text-only bridge may return
`requires_host_copy` for a binary attachment, or `requires_host_move` to archive a
newly created page during rollback. Perform only that exact scoped host operation,
verify the requested digest, then resume the stage. Missing capabilities are an
explicit incomplete result; never replace archiving with deletion.
