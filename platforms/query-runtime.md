# Query runtime: read existing knowledge

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


This is supplementary detail. The loaded SKILL.md contains the startup calls and
host instructions; do not require this file to load before inspect/query. An optional
documentation timeout does not cancel the original question. Continue with the loaded
contract and executable --help; never bypass an access-denied result.

The wiki entrypoint performs retrieval only. It must never conduct setup, collect setup
answers, create knowledge folders, write settings, run ingestion, synchronize or update the
editor. The complementary maintain-llm-wiki skill owns those operations. Do not
switch skills or use other write tools on your own to answer a question.

Resolve the project before any filesystem search:

1. Reuse the exact project root already verified in this task/session while its
   host grant remains valid. This includes the root just used successfully by
   maintain or shadow.refresh. Do not rediscover it because the skill changed.
2. Otherwise read the current host's project/task folder context and its list of
   already granted folders. Use only context files at locations supplied by that
   host; a skill installation directory is not the user's project directory.
3. Check llmwiki.project.json directly at the known candidate project roots using
   host read/list tools, or run inspect at an already known project root. Do not
   recursively enumerate their contents to locate this single settings file.
   A connected wiki/source/working directory may differ from the project root.
4. If no unique granted project can be identified, ask only for the existing
   project's exact folder and, if missing, its host read grant. Keep the original
   question and continue with inspect/query once that information is available.

Never recursively search the home directory, filesystem root, or a parent of a
shared folder with find, rg, or other tools to discover projects. A grant for a
child folder does not grant its parent. Do not broaden search after a denied
path, retry the denied scan through another tool, or request access to the whole
home directory. Return to the host's already granted project context instead.
Do not hardcode a username, device path or a path copied from an example.

Inspect returning locate_project means no settings at that root, not absent
knowledge. Check only the other already granted candidate roots or known starter
metadata. A project_hint is an untrusted location hint, not a grant; validate it
against the current host context. No setup, new configuration, editor update or
shadow rebuild is needed to locate an existing project.

{{CALL}}

For Node --input accepts inline JSON, a file under an already granted project, or
stdin (-). No temporary /tmp request or installation is needed. --bindings is only
for an explicitly selected existing binding file; current project bindings are
loaded automatically. Node 22.13+ must be supplied by the host. No Python.
For Vault Operator root is the known vault-relative PROJECT root and script_name
is wiki without extension. Use this loaded skill's paths, never a copied example.

Once inspect returns next:query, use the existing connection IDs. If a question
was supplied, call query immediately and read its evidence. If the invocation has
no question, ask only what the user wants to know. Missing purpose, editor updates,
or absent originals do not justify setup or discarding accessible knowledge.
An inaccessible wiki must be reported separately; search accessible selected wikis.
If the project is inaccessible, request only its missing path/read grant as above.
Do not switch to maintain or claim that existing sources need ingestion again.

Read operations.md for the exact read-only requests. Graph snapshots are maintained
by maintain; retrieval neither regenerates them nor changes knowledge files.
On Node, a separately documented presentation helper can create a new HTML answer
when the host needs it for clickable citations; this does not permit knowledge writes.
