# Guided setup: execute the returned contract

Only maintain performs setup. Read runtime.md for the current host's invocation.
Use the same project root throughout. First inspect known, actually granted project
and working candidates for llmwiki.project.json; a Wiki without settings is not proof
that all project settings are absent. Follow an existing configuration and inspect
its draft/settings before any write. No machine-wide search or speculative paths.

## Collect answers without guessing fields

1. Call inspect once at the verified persistent root. On next:setup use its
   setup_contract.answers_schema and requests. On repair_setup repair that project.
2. Reuse inspect.draft and actual earlier user answers. Ask one next missing fact;
   editor first if unknown, then who can read the project folder, folders, each wiki reader circle and author. Do not
   invent purpose, reader identities or answers from example strings.
3. Save a partial draft using inspect.setup_contract.requests.draft. For example:

```json
{"action":"setup.draft","answers":{"author":"Alice","editor":"both"},"expected":null}
```

Use null only if inspect.draft_sha256 is null. After this call, use result.sha256
for the next draft. After interruptions, inspect again. Never use a settings hash
for the draft or a draft hash for configure. No trial writes to discover valid keys.

4. Record the confirmed project folder reader circle in top-level readers. A missing
answer stays unknown; it never means private. Then add folders using wikis and
sources. purpose/audience belong to each wiki:

```json
{"action":"setup.draft","answers":{"readers":["Alice"],"wikis":[{"id":"wiki","label":"Wiki","path":null,"purpose":"Actual user purpose","audience":["Alice"]}],"sources":[{"id":"quellen","label":"Quellen","path":null,"wikis":["wiki"]}]},"expected":"<latest draft sha256>"}
```

Top-level values merge; a supplied array replaces the whole previous array. Merge
new wiki facts into the previously read entries before sending it. Never drop a
previous purpose, source assignment or second wiki when collecting another answer.
All example names/answers are placeholders, not defaults or user decisions.

## Folder bindings before configure (Node hosts)

Settings paths are relative to the project or null. Absolute device paths belong
in .llmwiki/device-bindings.json, written using the host file tool in the already
granted project. Read and preserve an existing file; only add confirmed mappings.
The host's grant permits access; it does not automatically create these mappings.

```json
{"format":"llmwiki-device-bindings/1","folders":{"wiki":"<absolute granted Wiki folder>","quellen":"<absolute granted Sources folder>"}}
```

A selected persistent working folder may be the project root. The skill then manages
its working files inside .llmwiki/working/wiki in that folder. The external Wiki must
be separate; never make the Wiki itself the project root while placing its working
copy underneath it. If the already chosen project is a different directory and the
user selected an external working folder, additionally bind work-wiki to that path
and set wikis[0].workPath to null. Do not silently replace an explicit assignment.
Ask who can read every externally bound working folder and record that answer in
the wiki entry as workReaders. Without this answer, or with other readers or multiple
writers, imported editor changes keep unknown authorship until explicitly reviewed.

Sources stay read-only unless the user expressly allows new chat-attachment creation.
Vault Operator uses accessible vault-relative folders and its native runtime contract,
not absolute OS bindings. Missing host access is reported, not worked around.

## Initialize and verify

5. Once the real answers are complete, call configure using the collected canonical
   fields (id, label, author, readers, editor, wikis, sources, optional language). Each wiki
   needs id/label/path/purpose/audience. Sources need id/label/path/wikis. Use the
   configure shape from inspect.setup_contract.requests; substitute actual values.
   expected is the existing settings hash or null for confirmed first configuration.
   Do not pass draft-only answers nesting or copy its expected hash into configure.
6. Inspect again. Verify the actual project settings, resolved locations, working
   bundle purpose/readers and canonical editor path. Retain returned graph findings.
   Follow setup-handoff.md: when local binding is forbidden, do not attempt editor.start.
   A saved configuration is not proof of browser permission or an opened editor.
7. Continue the already requested task. With no task, offer one concrete next step.
   Read own-notes-and-images.md before maintenance; it need not precede empty setup.

If a request is refused, use its field/expected/next_request details and re-read
inspect. Do not try other field spellings or single-field writes as probes. On stale,
merge the latest saved answers with the actual new answer before retrying. Preserve
all files and user decisions. Do not report setup complete while verification is open.

## Contributions and full subscriptions

Ask whether the person wants to contribute selected documents or subscribe to the
whole target wiki. Full synchronization is the default for ordinary wiki setup.
For selected contributions, set scope to contributions and work to the existing
home working-folder ID. Retain that folder and its bundle identity. No new target
working copy and no full target pull are part of contribution setup.

The target must already contain wiki/bundle.md. Configure reads its identity and
reader circle, compares the latter with the actual audience answer and pins both
on the connection. A copied identity in two distinct wiki folders is rejected.
Changing an existing target identity requires the explicit rekey workflow.
Setting up a connection never confirms a document or releases new content.

A work may have at most one full connection, plus contributions or participation
connections. Two IDs or device bindings do not allow the same physical work to
have two full connections. Participation is read-only. Comments have their own
boolean setting on the contribution connection, initially false.

Contributions require a confirmed private project folder. A shared project may
not subscribe to a wiki with a narrower declared reader circle. Explain the
actual reader-circle conflict and preserve the existing folders and documents.
New configurations use llmwiki-project/2; existing /1 files remain readable and
are not rewritten just by inspect, load or context. An explicit settings save
upgrades the project format so older tools cannot run an unscoped sync on it.
