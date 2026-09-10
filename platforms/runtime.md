# Runtime contract

The body describes the method; this file contains the calls for this package's host.
Never install Python, LibreOffice, Pandoc, npm packages or system software on a user machine.
All JavaScript libraries and editor assets travel in this package. A runtime supplied by
the host is still required. Check capabilities before saying setup succeeded.
Requests and results follow [operations.md](operations.md). Tool inputs are data;
never interpolate a user path or document text into shell code.

Use this installed package's entrypoint and contract, even if an earlier conversation
mentions another script. Do not modify the installed skill or invent an alternative
source writer after a runtime error. Read the structured error and retain the affected
file as open; use only supported repair/supplement operations. Read-only inspection and
the actual setup readback establish access; do not leave trial files in the user's wiki.
The wrapper's ok:true means that the call returned successfully. Completion also
depends on the action's state, source coverage, workflow, readiness and sync results;
see the completion checks in operations.md. Host previews may truncate tool output:
obtain every required passage before claiming to have read a complete source.
Preserve parser diagnostics accurately. A broken archive relationship or other reader
error does not mean the source is visual-only; actual content/visual examination is
required for that finding. Never claim an OCR pass or image reading that did not run.

For Node profiles, --input accepts a JSON object, an existing JSON file, or - for
stdin. Start with the exact inspect example below; it needs no request file. For
larger requests prefer the execution tool's structured stdin with --input -. A
single-quoted heredoc is also valid if its delimiter cannot occur in the payload.
If the tool requires a file, write it with the host file tool under the already
granted project, for example .llmwiki/requests/<unique-id>.json, and pass that path.
Do not use /tmp, /private/tmp or another ungranted directory, and do not widen
sandbox grants to transport a request. Empty granted Wiki/Sources folders are a
valid first setup: inspect returns next: setup; do not wait for source files.
Existing project-local device bindings are read automatically. --bindings FILE is
only needed for an explicitly chosen existing mapping. It accepts the current
versioned format and the legacy object mapping folder IDs to absolute paths.

Browser handles and agent filesystem access are separate. An externally selected
browser folder is persisted with path:null and a label; its native browser grant
does not reveal an absolute OS path. In Node hosts, match the existing folder ID to
the actually shared host directory and validate/update its local device binding with
the host's structured file tools, preserving other bindings. Check an existing
mapping by reading/listing that granted directory. A label alone is not proof of
identity; if several granted directories fit, ask only for that mapping. Do not
search the whole machine, guess a path, duplicate the connection, reconfigure the
project or reset settings to resolve a missing binding. Vault Operator uses its
accessible vault paths; it cannot obtain external filesystem access from a browser
grant. A missing host capability remains explicit.

In maintain, inspect.editor reports whether the project-root starter matches this
installed package. If update_required is true, call editor using the configured
project, await committed completion, and inspect again before giving its file link.
Keep existing settings and folder choices. Explain that an open browser tab needs a
reload/reopen to run the updated HTML; a new skill installation does not update the
already-running page. Query reports the required update and hands it to maintain.
The editor result supplies page, project_root, entry_path and entry_uri. Use that
canonical entry with the actual host opening/link tool; in Node, entry_path is the
absolute path. The configured project root is the root passed to the runtime and
holding its settings, not whichever connected wiki contains an old HTML copy. The
generated script#llmwiki-entry-location metadata also identifies that same location.
In vault hosts these OS location fields can be null; use the real vault-relative
entry/native file link for the selected project rather than inventing a device path.

Do not mirror/cp the editor app into a separate connected wiki, source folder or
another remembered location. Those copies do not acquire the project's settings or
working state. If the user explicitly requests a different launch location, create
only a shortcut/link to this same canonical starter. A separately configured project
or an intentional whole-project transfer is a different operation; copying its HTML
alone is not that operation. Check historical project-memory claims about two launch
locations or direct write/copy ingest against the current runtime contract before
acting; they do not establish that those workarounds are still valid.

Before a Node editor handoff call editor.preflight and follow the verified editor
handoff in operations.md and setup-handoff.md. Profiles that forbid local binding
return unavailable without trying a server. A successful folder grant does not enable listening on localhost. Never
state a process-lifetime cause unless actually evidenced. No sandbox bypass.
For Node profiles that allow it, available means the socket probe succeeded, not that the
browser or process persistence is verified. Inspect editor.start's structured state.
Vault Operator uses native editor capabilities; do not call these Node-only actions.

## Claude Code

Use the existing shell to check `node --version` (22.13+). Locate this loaded skill's
directory, not a hardcoded home path. Begin without a request file:
`node "<skill>/scripts/wiki.mjs" --root "<absolute-project>" --input '{"action":"inspect"}'`
with properly quoted argument paths. Read JSON `ok` and `result` or `error`.
Use the user's current project or an explicitly selected persistent directory.
Open or return the project-root `LLM-Wiki.html`; show its clickable absolute path.
If the runtime is missing, state the specific missing host capability; do not claim
that an unexecuted instruction changed the project. Obsidian opens the working-copy
path reported by `context`, while `sync` exchanges Markdown and review events.

## Claude Cowork

First establish the Cowork project/task and its actually shared folders. Ask for the
project folder only when it is not already known; a temporary VM directory is not a
persistent project. Inspect available mounted folders and suggest Wiki and Sources.
Use the task's existing terminal with Node 22.13+:
`node "<loaded-skill>/scripts/wiki.mjs" --root "<mounted-project>" --input '{"action":"inspect"}'`.
The agent executes requests; the person does not type commands or create request files. This package needs
no Python or user-installed document converters. After configure, verify the settings,
return the host's clickable file/artifact link to `LLM-Wiki.html` in the persistent
project, and open it with a provided host opening tool if available. Do not invent
a Cowork deep-link scheme. The standalone browser separately grants access to the project and external roots;
stored settings do not confer browser permission. Resume denied grants explicitly.

## Codex

Install/extract the skill folder under the project's `.agents/skills/` or an existing
user skill directory. `agents/openai.yaml` supplies the interface metadata. Use the
available shell and host Node 22.13+:
`node "<loaded-skill>/scripts/wiki.mjs" --root "<absolute-project>" --input '{"action":"inspect"}'`.
Use structured file writes for request JSON and quoted argv paths. The already known
workspace is the project; ask only for missing Wiki/Sources and purpose information.
Return a clickable absolute file link to the installed `LLM-Wiki.html`. Run guarded
sync at the start and end of changes and report pending author decisions.

## ChatGPT

This package is a native skill upload for workspaces that provide Skills and a file
execution tool with Node 22.13+. Discover the actual execution/file tools and check
Node before use. With such a tool, execute the bundled `scripts/wiki.mjs` with
`--root "<accessible-project>" --input '{"action":"inspect"}'` for the first call.
Then use the request transport described above for the requested actions.
ChatGPT does not acquire access to local Finder folders from a chat path. Use an
explicitly connected persistent workspace only when the host exposes actual reads
and writes. Otherwise work on an uploaded project copy and return a project archive
and editor artifact; say it is a transferable copy, not an automatic local sync.
Never claim browser folder grants, persistent local synchronization or Node execution
when this workspace supplies none. Do not fall back to Python. Keep the explicit
source/knowledge/review files in the returned archive so another host can resume.

## Vault Operator

Use the native `run_skill_script` tool with this skill's name, `script_name: "wiki"` (without .js)
and request fields as `args`; add `root` as the chosen vault-relative project folder
(empty string for the vault root). The runtime injects `skills_root`, `skill_name`
and `skill_data_root`; do not invent or override them. The one exported function is
`execute(args, ctx)`. All vault access uses `ctx.vault`; no shell, Node or Python.

First call (retain this root for every subsequent call):

```json
{"skill_name":"maintain-llm-wiki","script_name":"wiki","args":{"action":"inspect","root":""}}
```

If you cannot locate the references, use the same tool with `args:{"action":"help","root":""}`.
It returns exact installed reference paths and request shapes without filesystem writes.
Read both references with read_file; naming a reference is not reading its content.
Never guess `op`, `request`, `project_path`, `draft`, `wikiPath`, `sourcePaths` or `editors`.
These are not substitutes for the fields below. `help` is a Vault-entry action.

With root `""`, Wiki-LLM and Quellen-LLM are siblings inside the accessible vault.
They are wiki/source paths, not a reason to change root to Wiki-LLM. If a project
already has another root, keep it and use paths relative to it. A missing file
means guided setup only when inspection reports next:setup; permission/type errors
are not evidence of an empty project. Use paths without a trailing slash.

After a user answer, persist the known subset (replace placeholders with actual
answers; wikis/sources arrays replace earlier arrays, so retain prior entries):

```json
{"skill_name":"maintain-llm-wiki","script_name":"wiki","args":{"action":"setup.draft","root":"","answers":{"author":"<author>","editor":"both","wikis":[{"id":"wiki","label":"<name>","path":"Wiki-LLM"}]},"expected":null}}
```

Complete its transaction before the next draft. Reuse the returned sha256 as
expected on the next save; inspect returns it as draft_sha256. Partial answers
belong in answers, not draft. Once purpose and audience are known:

```json
{"skill_name":"maintain-llm-wiki","script_name":"wiki","args":{"action":"configure","root":"","id":"wissen","label":"<name>","author":"<author>","editor":"both","wikis":[{"id":"wiki","label":"<name>","path":"Wiki-LLM","purpose":"<user purpose>","audience":["<reader>"]}],"sources":[{"id":"quellen","label":"Quellen","path":"Quellen-LLM","wikis":["wiki"]}]}}
```

For query, use skill_name query-llm-wiki and only read actions. Setup belongs to
maintain. Do not use fresh merely because a prior setup attempt failed. Existing
folders and draft answers are retained. After committed configure, call inspect
and context with the same root; then ingest the requested sources. An empty source
folder is valid and yields no sources, not a completed ingest of nonexistent files.

Writes are prepared with exact preimages. A result `prepared` or `pending` gives a
transaction ID. Respect `retry_after_seconds` (60), then call the same script with
`action: "transaction.resume"`, `transaction` and `root`. Continue until `complete`.
Each resume performs at most three file writes plus its checkpoint (at most eight
bridge writes including mkdir); the native limit is ten writes per minute, shared
with other scripts. Stop and retain the transaction on stale content; do not retry
with a new baseline. The bridge has no compare-and-swap primitive; preimages survive
in `.llmwiki/transactions` for explicit recovery if an external writer interferes.

Folders must be inside this accessible vault. Arbitrary external folders need to be
connected by Obsidian/the host first. DOCX/XLSX/PPTX/text readers are bundled. For PDF,
legacy Office, scans and image content, use the host's document/visual reading tool
and supply a complete transcript with coverage and the exact source digest; never
mark a shortened native ingest or a 200-row table preview as a complete source.
Choose Obsidian, built-in editor or both in the same setup; its working copy is the
editable wiki. Return a clickable vault file link for `LLM-Wiki.html` when requested.
