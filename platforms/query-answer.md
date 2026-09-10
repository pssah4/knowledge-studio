# Answer presentation on Node hosts

The optional `scripts/answer.mjs` is a presentation helper, separate from the
strictly read-only `scripts/wiki.mjs`. Use it when the host's runtime instructions
require a browser answer because chat cannot open the returned local editor links.
It creates only a new `.llmwiki/answers/<uuid>.html` inside the verified project.
It never modifies knowledge, originals, configuration, SQLite, shared identities
or retained pins. Creating this output needs write access to that output location;
retrieval itself still requires only read access. Do not broaden grants silently.

First finish retrieval and check `citation_links.available`. Then compose a concise
answer in the user's language. Supply JSON data to the helper with the same host
Node executable, root and optional existing bindings used for retrieval:

`node "<loaded-query-skill>/scripts/answer.mjs" --root "<verified-project>" --input '<encoded JSON request>'`

Use properly quoted JSON or structured stdin (`--input -`); do not interpolate user
or source text as shell code or write an intermediate request outside the project.
The helper takes only this schema (no arbitrary HTML, href or output path):

```json
{
  "action": "answer.export",
  "question": "Original question",
  "title": "Answer title",
  "references": ["<exact passage.reference from Query>"],
  "blocks": [
    {"type":"paragraph","text":"A single supported claim.","refs":[0]},
    {"type":"heading","text":"Reasons"},
    {"type":"list","ordered":true,"items":[{"text":"A supported reason.","refs":[0]}]},
    {"type":"table","columns":["Aspect","Finding"],"rows":[{"cells":["Mandate","Unclear"],"refs":[0]}]},
    {"type":"quote","ref":0},
    {"type":"note","text":"The sources do not establish a final programme outcome."}
  ]
}
```

References are **zero-based indexes** into `references`; numbered links are produced
automatically. Collect tokens across query calls unchanged. Every paragraph, list
item and table row requires one or more supporting refs. Keep each claim close to
its own evidence; do not attach one general source to several unrelated assertions.
Explicitly label inference in the prose and cite its premises. Use `note` only for
limitations, uncertainty or presentation notes, never to bypass factual citations.
Use `heading` only for short section names. `quote` renders the exact source wording;
do not provide a replacement quote text. All text fields are plain text, not Markdown
or HTML. HTML characters are escaped; the answer has no scripts or network assets.

At most 128 references, 512 blocks and 2 MiB input. Text fields allow 32768 characters,
headings/titles/column names 200, question/notes 4000. Lists and tables allow 256 items
or rows, tables 12 columns. Split long answers by meaning before reaching a limit.

The helper verifies every reference and constructs destinations only from the
existing compatible canonical project editor. If a source changed or became
ambiguous, no answer is exported: query the current wording and reconsider the
affected claim. A missing or old editor needs a separate Maintain update; don't
install or repair it from Query. Evidence validation verifies wording and location,
not whether a model's inference is justified.

Success returns `output_path`, size, reference count and an `open` request. If the
host provides `open_on_host`, invoke it with the returned `open.arguments`, e.g.
`{"path":"<absolute output_path>"}`. This is an existing HTML file path, **not** a
`file:` URL and contains no fragment. Do not issue a shell `open` command or start
a local server. On hosts without that tool, use their documented artifact/file
opening mechanism; never claim a successful native open without its result.

The browser answer contains a numbered source link beside each claim. A click opens
the original project editor with the complete passage fragment; source copies and
other Wiki files use the same path. The browser may need the user's normal project
or working-folder grant. The HTML file remains available after closing the browser.
It contains answer text and selected quotes, not a copy of the whole Wiki. These
output files are never automatically deleted or indexed as knowledge.

If output or host opening is denied, report that precise limitation and preserve
any successfully created artifact. Do not retry via a bypass or say the browser
opened. Chat still gets a brief delivery message and the output location, while the
full answer with working inline citations is the opened HTML artifact.
