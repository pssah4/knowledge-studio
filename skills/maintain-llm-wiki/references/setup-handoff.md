# Finish setup with the editor that this host can actually open

Read runtime.md and operations.md; use only this package's calls. This reference
supersedes remembered instructions to always start a Node server after configure.

1. Read back inspect and context for the saved project and its actual connections.
   Keep the project root stable. Honor an explicitly selected workPath during
   configure; do not mistake selecting a project directory for assigning that workPath.
   An existing working copy is preserved; do not relocate it to correct a chat label.
2. For Node call editor.preflight. It reads current bindings and reports the actual
   working-copy paths for every wiki and the canonical HTML starter. It does not
   configure folders or install software. If editor_mode is obsidian, open that
   working-copy path with a real host tool or give its actual link.
3. If preflight reports local_binding_forbidden, do not attempt
   editor.start/editor.serve, repeat a failed start, request a generic folder grant
   for a network restriction, or claim that the problem is process lifetime. The
   Node entrypoint also enforces this platform constraint.
4. Where available, first verify that the execution environment and the user's
   browser share the host (or an actual preview is reachable), then editor.start.
   A running server and a successful OS open request do not prove UI readiness.
5. For standalone: open the returned canonical HTML with the host's file opening
   tool if available. Say “Öffnen angefordert” only after its success. Use Chrome
   or Edge, not Firefox for writable folder access. Guide the canonical project
   selection first. For external wiki/work/source folders, show the next requested
   path and its role. This fallback still needs native folder selection; never
   promise a displayed path can be granted by a simple agent confirmation.
6. Report configuration saved separately from editor access. Until the user or
   an actual UI test verifies access, keep that step open. With both editors selected,
   check both; an Obsidian success does not verify the built-in editor. Give one next
   action, not a menu that hides the incomplete handoff. Retain any authorized source
   task and proceed independently of UI access where possible.

Example when the host forbids a local server:
“Deine Wiki- und Quellenzuordnungen sind gespeichert. Der Browserzugriff ist noch
offen. Diese Umgebung erlaubt keinen lokalen Editorserver. Öffne die
verlinkte Startdatei in Chrome oder Edge; ich führe dich durch die erforderlichen
Ordnerfreigaben. Als Erstes wähle im Dialog den angezeigten Projektordner.”
Use actual returned paths and links, not example device paths. For Obsidian offer
only handoff.obsidian[].path, which may be a private working subfolder. Do not
silently open the sync target or promise both represent the same current contents.

## Browser access guide from 0.4.13

The canonical starter guides missing permissions in one dialog after the project
selection. Settings have one shared folder-access action. Known handles are granted
directly; working directories beneath the project are resolved without another picker.
Unknown external folders follow one by one. The guide preserves confirmed steps on
cancel. It displays current stored device paths and offers Copy folder path with
Finder ⌘⇧G / Explorer address-bar guidance. An absolute path is not a browser handle:
never promise exact first-use picker placement. Updating changed device bindings
requires updating the canonical starter so its displayed paths stay current.
