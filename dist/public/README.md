# LLM-Wiki 0.4.26 · Plattformpakete

Installiere beide Skills für dieselbe Plattform und Version. Hinweise findest du in der [Projektanleitung](../../README.md).

| Plattform | maintain-llm-wiki | query-llm-wiki | Voraussetzungen |
| --- | --- | --- | --- |
| Claude Code | [maintain-llm-wiki.skill](claude-code/maintain-llm-wiki.skill) | [query-llm-wiki.skill](claude-code/query-llm-wiki.skill) | Node ab 22.13; zugänglicher Projektordner |
| Claude Cowork | [maintain-llm-wiki.skill](claude-cowork/maintain-llm-wiki.skill) | [query-llm-wiki.skill](claude-cowork/query-llm-wiki.skill) | Node ab 22.13 im Host; persistente freigegebene Projektordner |
| Codex | [maintain-llm-wiki.skill](codex/maintain-llm-wiki.skill) | [query-llm-wiki.skill](codex/query-llm-wiki.skill) | Node ab 22.13; Skill-Ordner unter .agents/skills/; zugängliches Projekt |
| ChatGPT | [maintain-llm-wiki.skill](chatgpt/maintain-llm-wiki.skill) | [query-llm-wiki.skill](chatgpt/query-llm-wiki.skill) | Workspace mit Skills und Node-Dateiausführung; ohne persistenten Speicher als Projektkopie |
| Vault Operator | [maintain-llm-wiki.skill](vault-operator/maintain-llm-wiki.skill) | [query-llm-wiki.skill](vault-operator/query-llm-wiki.skill) | Native execute/ctx-Bridge; zugänglicher Vault; fortsetzbare Schreibpakete innerhalb der Hostlimits |

Je Plattform beide Skills importieren und alte Fassungen ersetzen. Codex verwendet die entpackten Skill-Ordner; das zusätzliche ZIP ist das gemeinsame Claude-Code-Plugin.

Die Pakete bringen ihre JavaScript-Bibliotheken und den Editor mit. Es wird keine Software auf Nutzergeräten nachinstalliert. Hostrechte und verfügbare Ausführung müssen im Zielhost geprüft werden.

[Dateien und SHA-256](release-0.4.26.json)
