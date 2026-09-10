# Read-only retrieval contract

Node envelopes are {ok:true,result:...} or {ok:false,error:...}. Vault calls use
run_skill_script with skill_name:query-llm-wiki, script_name:wiki and args holding
the request plus the same known project root. No setup or mutation is allowed.

1. {"action":"inspect"}: locate the existing project and its connections.
   next:locate_project means settings were not found HERE; knowledge_present may
   still be true. Never infer an empty knowledge base from missing settings.
   next:query means proceed to retrieval; do not collect author/editor/purpose.
2. {"action":"context","connection":"<inspected ID>"}: read existing wiki,
   working copy and source mappings. Binding failures are access problems.
3. {"action":"query","question":"<original user question>","connections":["<ID>"],"limit":8,"hops":2,"max_context_chars":120000}
   Omit connections to search all configured wikis. filters optionally supports
   wiki, type, status, owner, class, tags. Read hits, context, relations, citations,
   findings, more_matches and context_truncated. BM25 plus typed graph expansion
   is not an embedding service. A normal Markdown link is not a semantic claim.
4. {"action":"read","connection":"<ID>","page":"<returned path>"} retrieves
   a full evidence page when an excerpt is truncated or more context is needed.
5. {"action":"graph","connections":["<ID>"]} inspects the current knowledge
   relationships read-only. The editor's saved snapshot is a separate projection.

Additional diagnostics, only when relevant: readiness (connections), workflow.list
(connection), workflow.status (connection,id), review.read (connection,page,author),
source.inventory / source.plan (connection,source,prefix or paths), source.read
(connection,source,path). Source diagnosis does not authorize source ingestion.

A partial result is not an empty result. Cite accessible evidence and name the
scope/access/extraction/context limits. Read original sources only when needed and
accessible. Do not delay an answer merely because the editor needs an update.
Do not write probes, repair settings, create an index or run sync in this skill.

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

Fragmented shared identities require skills/editor 0.4.18 or newer. Incomplete transfers remain unpersisted; complete the sync or ask maintain to refresh. Never remove shared evidence to resolve a read error.


Shadow excerpts (0.4.21): read `citations[].shadow.passages`, not the top-level
`shadow` status object. `shadow.passage_count` summarizes the available excerpts.
Each quote is an exact contiguous source range, possibly a `partial` excerpt of
a larger block. Use the supplied `pin_request` unchanged so maintain retains
that same range. A `retrieval_basis` of `heading`, `page_context` or
`relationship_context` explains how the passage was selected; it does not prove
that the quote supports an assertion. Neighboring and counterevidence passages
must be assessed in context. Empty lists carry `empty_reason`; missing or damaged
identity history still permits current unpersisted excerpts. Only maintain repairs
the history/cache. Read the full page when the supplied context is insufficient,
but do not infer SQLite failure merely from a missing lexical match.

Read-only collection/overview checks: `collection.assess` reads observed fields,
values and individual failures, including before project setup. In a project,
`source` selects an assigned original collection. `participation.overview` accepts
`field` and optional `connections`, uses registered boolean participation and
actual readable scopes, and explains empty results. `query.filters.participates`
is the registered field name. `published.check` accepts the existing MkDocs
`navigation` YAML and reports drift against authoritative document fields.
Preparation, registration, editing and rollback belong to maintain.

For Node calls in both skills, the runtime bounds filesystem reads and supervises
its worker inside the existing sandbox. A filesystem timeout is an incomplete
operation, never proof of missing knowledge. Read `error.code/message/details`;
`runtime_read_timeout` identifies the affected path. Do not retry with `2>&1`,
`; echo EXIT:$?`, `cat`, or a temporary-file redirect. Do not change the host or its
grants. For a read-only query, retain the question and retry the exact request at
most once; if it blocks again, report the affected file and the incomplete scope.
A connection-scoped query may answer a narrower, explicitly disclosed question;
never silently omit an inaccessible connection. For an interrupted mutation, inspect
current state before retrying: `partial_changes_possible` is not a rollback.
The same protection applies to the separate HTML answer helper. Never claim an
answer file was generated or opened after a failed export.
