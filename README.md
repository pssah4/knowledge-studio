# Knowledge Studio · 0.4.23

Zwei KI-Skills überführen Quelldokumente und eigene Notizen in einen verknüpften
Markdown-Wissensbestand und beantworten Fragen mit nachvollziehbaren Belegen.
Du arbeitest im mitgelieferten Editor, in Obsidian oder in beiden. Persönliche und
geteilte Wikis lassen sich verbinden und bleiben dabei eigenständige Sammlungen.

**Einstieg:** [Installation](#skills-installieren) · [Einrichtung](#projekt-einrichten) ·
[Skills](#aufgaben-der-beiden-skills) · [Editor](#integrierter-editor) ·
[Obsidian](#obsidian-als-externer-editor) · [Zusammenarbeit](#zusammenarbeit-und-änderungsprüfung)

## Skills installieren

1. Öffne die [Paketübersicht](dist/public/README.md) und wähle deine Plattform. Installiere
   **beide** Skills, `maintain-llm-wiki.skill` und `query-llm-wiki.skill`, für dieselbe
   Plattform und in derselben Version.
2. Importiere die `.skill`-Dateien über die Skill-Verwaltung deiner Anwendung und
   aktiviere beide Skills. Ein gewöhnlicher Dateianhang im Chat installiert keinen
   Skill. Die Bedienelemente für den Import unterscheiden sich je nach Anwendung.
3. Bei einer Installation über Ordner verwende die vollständigen erzeugten
   Skill-Ordner einschließlich Skripten und weiteren Dateien. Codex verwendet das
   Verzeichnis `.agents/skills/` im Projekt. Das [Claude-Code-Plugin](dist/public/llm-wiki-0.4.20.zip)
   enthält alternativ beide Skills. Eine einzelne `SKILL.md` aus diesem Repository
   reicht für die Installation nicht aus.
4. Öffne dein Projekt in der Anwendung und gib die benötigten Ordner frei. Rufe
   `maintain-llm-wiki` auf: „Richte mein Wissenswiki ein.“ Die geführte Einrichtung
   beginnt direkt.

| Plattformpaket | Voraussetzungen der Anwendung |
| --- | --- |
| [Claude Cowork](dist/public/claude-cowork/) | Dauerhaft verfügbare, freigegebene Projektordner; Node ab 22.13 in der Anwendung. |
| [Claude Code](dist/public/claude-code/) | Zugänglicher Projektordner; Node ab 22.13. |
| [Codex](dist/public/codex/) | Zugängliches Projekt; Node ab 22.13; installierte Skill-Ordner. |
| [ChatGPT](dist/public/chatgpt/) | Arbeitsumgebung mit Skills und Node-Dateiausführung. Ohne dauerhaften Speicher wird eine übertragbare Projektkopie benötigt. |
| [Vault Operator](dist/public/vault-operator/) | Native JavaScript-Skill-Ausführung und Zugriff auf den Vault; verwendet Obsidian und begrenzte, fortsetzbare Schreibvorgänge. Node wird nicht benötigt. |

Die Pakete enthalten Bibliotheken, Dokumentleser und den Offline-Editor. Nutzer
müssen weder npm ausführen noch Python oder Office-Konverter installieren. Die
Anwendung stellt Laufzeit und Berechtigungen bereit. Ein im Chat genannter Pfad
allein erteilt keinen Dateizugriff.

**Aktualisierung:** Ersetze beide Skills und rufe Maintain im bestehenden Projekt
auf. Lass den Projekteditor aktualisieren und lade ihn anschließend neu oder öffne
ihn erneut. Ordner und Einstellungen bleiben erhalten; für ein Update ist weder
ein Zurücksetzen noch ein erneuter vollständiger Ingest nötig.

## Ablage und Ordner

| Bestandteil | Inhalt und Aufgabe |
| --- | --- |
| **Projekt** | Verbindungen zwischen Wikis und Quellen sowie Editoreinstellungen. Beide Skills werden in diesem Kontext gestartet. |
| **Wikiordner** | Der verbundene Wissensbestand, gegebenenfalls mit anderen geteilt. Er empfängt und liefert Änderungen über den Abgleich. |
| **Arbeitsordner mit Arbeitsfassung** | Deine bearbeitbaren, dauerhaft gespeicherten Markdown-Dateien. Agent und Editoren verwenden diese lokale Fassung. |
| **Quellenordner** | Originaldokumente als Belege. Standardmäßig nur lesend; ein Quellenordner kann mehrere Wikis versorgen. |

Die Arbeitsfassung liegt in einem Ordner auf dem Datenträger. Standardmäßig wird
sie unter `.llmwiki/working/` innerhalb des Projekts verwaltet; ein anderer
Arbeitsordner kann ausdrücklich gewählt werden. Ungespeicherte Browserentwürfe
werden getrennt von gespeicherten Dateien gehalten. Projekt- und Bearbeitungsstand
bleiben zwischen Chats erhalten.

Jedes Wiki enthält vollständige Markdown-Abbilder der Quellen, aufbereitete
Wissensseiten, eigene Notizen und Themenübersichten. `wiki/index.md` dient der
Navigation, `wiki/bundle.md` beschreibt Zweck und Leserkreis. `schema/TYPES.md`
definiert Dokumenttypen und zulässige semantische Beziehungen. Generierte Seiten
liegen flach unter `wiki/`; eigene Unterordner sind möglich. Topics und Entities
gliedern den Bestand. Konzeptnotizen bleiben eigenständige Wissensseiten.

Markdown ist der maßgebliche Wissensbestand. Suchindizes, gespeicherte Graphen,
Extraktionsnachweise und Abgleich- beziehungsweise Prüfstände liegen als technische
Daten unter `.llmwiki/`. Bewahre diese versteckten Daten zusammen mit Projekt und
Arbeitsfassungen auf, damit Diskussionen und Vergleichsstände erhalten bleiben.

## Projekt einrichten

### Geführte Einrichtung

1. Lege in Cowork zunächst ein dauerhaftes Projekt an und verbinde die erforderlichen
   Ordner mit den passenden Rechten. Leere Wiki- und Quellenordner sind ein gültiger
   Ausgangspunkt. Verbinde alle Arbeitsordner mit Lese- und Schreibrechten.
2. Rufe Maintain auf. Kläre Wikiordner, Quellenordner, Zweck, Leserkreis, Autorenname
   und Editorwahl: integrierter Editor, Obsidian oder beide. Teilantworten werden
   gespeichert. Vorhandenes Markdown lässt sich unter Erhalt von IDs, eigenen
   Eigenschaften und selbst geschriebenen Inhalten integrieren.
3. Ordne Quellen den Wikis zu. Beispielsweise kann „Recherche“ ein persönliches Wiki
   und ein Teamwiki versorgen, während „Besprechungen“ nur dem Teamwiki zugeordnet
   wird. Jedes Wiki erhält seine eigene inhaltliche Integration dieser Quellen.
4. Öffne den Editor über den von Maintain zurückgegebenen Pfad oder Link und
   bestätige die erforderlichen Browserfreigaben. Gespeicherte Einstellungen allein
   erteilen dem Browser keinen Zugriff.
5. Beauftrage den ersten Pflege- beziehungsweise Ingest-Lauf. Anschließend kannst
   du Query Fragen zum entstandenen Wissensbestand stellen.

**Später hinzufügen oder aushängen:** Verwende die Plus-Schaltflächen neben Wikis
und Quellen in der Seitenleiste oder bitte Maintain darum. Die Zuordnung erfolgt
in den Einstellungen. Das Hinzufügen startet keinen Agenten und ingestiert noch
keine Inhalte. Maintain ergänzt fehlende Wiki-Struktur und verarbeitet die
Verbindung im nächsten Lauf. Aushängen entfernt ausschließlich die Verbindung;
Originale, Wissensdateien und Entwürfe werden dabei niemals gelöscht.
Für vorhandene Bestände siehe [Bestehenden Obsidian-Vault hinzufügen](#bestehenden-obsidian-vault-hinzufügen).

Freigaben in der Anwendung, Browserrechte und gespeicherte Ordnerzuordnungen sind
getrennte Dinge. Ist ein im Browser hinzugefügter Ordner für den Agenten nicht
zugänglich, verbinde und autorisiere denselben Ordner auch in der Anwendung.
Eine Browserfreigabe verrät dem Agenten keinen absoluten Dateipfad. Setze die
bestehende Einrichtung fort, statt ein weiteres Projekt anzulegen.

## Aufgaben der beiden Skills

### Maintain: Wissen aufbauen und aktuell halten

`maintain-llm-wiki` übernimmt Einrichtung, Schreiben, Integration, Synchronisation
und Änderungsprüfung.

| Aufgabe | Beispielauftrag | Ergebnis |
| --- | --- | --- |
| Quellenbestand erschließen | „Integriere alle Recherche-Dokumente in das Teamwiki.“ | Bestandsaufnahme, vollständige Markdown-Abbilder, Vergleich von Belegen, Wissensseiten, Topics und aktualisierte Navigation. |
| Einzelne Quelle gemeinsam aneignen | „Arbeite dieses Dokument mit mir durch und hilf mir zu entscheiden, was in mein Wiki gehört.“ | Bewertung der Relevanz, Vergleich mit vorhandenem Wissen und gemeinsam erarbeitete Erkenntnisse. Du entscheidest, was übernommen, zurückgestellt oder abgelehnt wird. |
| Eigene Notizen und Bilder verarbeiten | „Integriere meine neuen Obsidian-Notizen und ihre Bilder.“ | Vollständige Lektüre, belegte Vergleiche, Metadaten, semantische Beziehungen und Topics. Eigene Notizen werden nicht als externe Quellen dupliziert. |
| Bestand pflegen | „Prüfe alle verbundenen Wikis auf geänderte Quellen und überholte Aussagen.“ | Inkrementelle Prüfung aller Quellen-Wiki-Zuordnungen, Neubewertung betroffener Aussagen und konkrete Hinweise auf fehlende oder unlesbare Originale. |
| Inhaltliche Struktur pflegen | „Verknüpfe verwandte Seiten, führe diese Entität zusammen und aktualisiere die Themenübersicht.“ | Begründete Beziehungen, erhaltene Identitäten und Herkunftsnachweise sowie aktualisierte Links und Navigation. Auch Dateiordnung und die Reparatur unvollständiger älterer Quellenabbilder werden unterstützt. |
| Arbeitsumgebung verwalten | „Verbinde dieses Wiki, gleiche Änderungen ab und zeige, wo meine Entscheidung benötigt wird.“ | Verbindungen, Editor- und Graphaktualisierung sowie Prüfung externer Änderungen und Konflikte. |

**Zwei Wege ins Wissen:** Die Bestandserschließung verarbeitet den beauftragten
Quellenbestand. Die selektive, dialogische **Aneignung** einer einzelnen Quelle
verbindet Bewertung und Einordnung mit deinen ausdrücklichen Entscheidungen.
Ein einzelner Chat-Anhang mit „Ingeste diese Datei“ startet standardmäßig diesen
Dialog. Der Upload allein ist keine Übernahmeentscheidung. Entscheidungen und
zitierte Vergleichsbelege werden gespeichert; geänderte Grundlagen erfordern eine
erneute Bewertung.

Quellenabbilder bewahren den vollständigen Inhalt einschließlich Tabellen, Folien,
Notizen und relevanter Bildbedeutung. Die Leser unterstützen gängige Textformate,
DOCX, PPTX, XLSX und PDF. Scans, Diagramme, geschützte Dateien und besondere
Office-Inhalte können eine tatsächliche visuelle Lektüre oder weitere verfügbare
Werkzeuge der Anwendung erfordern. Ungelöste Extraktionslücken bleiben offen und
zählen nicht als erfolgreiche Integration. Originaldatum, Extraktionsdatum,
Quellenaussagen und Interpretation werden getrennt erfasst.

Wähle für einen Chat-Anhang ein vorhandenes Zielwiki und einen zugeordneten
Quellenordner. Erlaube dort ausdrücklich das Anlegen neuer Anhänge; bei Bedarf
kann dieser Ordner die Standardquelle des Wikis werden. Vorhandene Originale
werden niemals überschrieben. Ein Eingangsordner für Quellen ist optional.

Eingebettete Bilder gehören zu ihrer Notiz; ihr erfasster Inhalt wird dort
festgehalten. Ein separat ingestiertes Besprechungsfoto kann dagegen eine eigene
Quelle mit vollständigem Markdown-Abbild werden. Die Originalbilder bleiben
verfügbar. Siehe [Notizen und Bilder](skills/maintain-llm-wiki/references/own-notes-and-images.md).

### Query: belegte Antworten über mehrere Wikis

`query-llm-wiki` arbeitet **ausschließlich lesend**, auch auf Ebene des ausführbaren
Skripts. Die Skill beantwortet Fragen, fasst zusammen, vergleicht, verfolgt
Beziehungen und erläutert Widersprüche:

- „Was wissen wir über dieses Thema, und welche Quellen belegen es?“
- „Vergleiche mein persönliches Wiki mit dem Teamwiki. Wo widersprechen sich die Schlussfolgerungen?“
- „Welche Belege sprechen gegen diese Empfehlung, und was bleibt unklar?“
- „Wie hängt diese Entscheidung mit der ursprünglichen Recherche und späteren Erkenntnissen zusammen?“

Die Suche verbindet lexikalische Volltextsuche (BM25) mit typisierten Graphpfaden:
GraphRAG ohne Embedding-Dienst. Der Agent liest relevante Passagen, prüft stützende,
widersprechende und ablösende Belege und zitiert Seiten mit stabilen Quellen-IDs.
Antworten unterscheiden dokumentierte Fakten, Schlussfolgerungen und persönliche
Entscheidungen. Fehlender Zugriff oder unvollständige Extraktion begrenzen eine
Antwort; sie belegen nicht, dass es keine Informationen gibt.

Query nutzt den verfügbaren Stand der Arbeitsfassungen. Rufe zuerst Maintain auf,
wenn Originale geändert wurden, externe Bearbeitungen abgeglichen werden müssen
oder die Integration noch aussteht. Query repariert keine Quellen, synchronisiert
keine Dateien, aktualisiert keinen Editor und speichert keine neuen Erkenntnisse
im Wiki.

## Quellen, Notizen und Wikis verknüpfen

| Verbindung | Verwendung |
| --- | --- |
| **Ordnerzuordnung** | Ordne einen Quellenordner bei der Einrichtung oder in den Einstellungen einem oder mehreren Wikis zu. Damit legst du fest, welche Originale Maintain für welches Wiki verarbeitet. |
| **Dokumentlink und Zitat** | Verwende gewöhnliche Markdown-Links zwischen Notizen. Integriertes Wissen verweist auf stabile Quellen-IDs und belegende Passagen; Quellenabbilder behalten Verweise auf ihre Originale. |
| **Semantische Beziehung** | Bitte Maintain, konkrete Aussagen über einen in `schema/TYPES.md` erlaubten Beziehungstyp mit einer inhaltlichen Begründung zu verbinden. Ein klickbarer Link allein ist noch keine begründete semantische Beziehung. |

Beispiel: „Verknüpfe diese Entscheidung mit den zugrunde liegenden Studien und
erkläre, welche Annahme die spätere Studie infrage stellt.“ Maintain prüft die
Passagen und zulässigen Beziehungstypen. Ausgehende Beziehungen werden einmal
erfasst; eingehende Beziehungen werden daraus abgeleitet. Quellen und übernommene
Erkenntnisnotizen erhalten außerdem gegenseitige Markdown-Links.

Verbinde für wikiübergreifende Arbeit beide Wikis und wähle sie ausdrücklich für
Abfragen oder die Graphansicht aus. Bitte Maintain, passende Beziehungen zwischen
ihnen anzulegen oder zu prüfen. Das Verbinden von Ordnern verknüpft ihre Inhalte
noch nicht. Wiki-Identitäten halten die Sammlungen auseinander; die Suche bleibt
auf ausgewählte, zugängliche Wikis begrenzt.

## Integrierter Editor

Maintain stellt im Projektordner eine projektspezifische Startdatei `LLM-Wiki.html`
bereit. Verwende immer die für dieses Projekt zurückgegebene Startdatei. Eine Kopie
in einem Quellen- oder Wikiordner ist kein gleichwertiger Projekteinstieg.

| Werkzeug | Verwendung im Alltag |
| --- | --- |
| Wiki-/Quellen-Seitenleiste | Arbeitsdateien und Originale durchsuchen, Verbindungen ergänzen und aktives Wiki auswählen. Der Agent kann diese Auswahl lesen. |
| Schreibmodi | Zwischen Markdown-Quelltext, Live-Vorschau und Leseansicht wechseln. Notizen anlegen, bearbeiten und speichern; Dokumentlinks folgen. |
| Eigenschaften | Frontmatter bearbeiten, Typ und Status wählen, Dateien umbenennen sowie verschachtelte oder gemischte YAML-Werte im Detaileditor bearbeiten. |
| Bilder und Anhänge | Dateien einfügen, Bilder einfügen oder hineinziehen. Bestehende relative Obsidian-Anhangordner werden berücksichtigt. |
| Suche | Über die Lupe Dateien finden und öffnen. |
| Multi-Wiki-Graph | Wikis auswählen, Dateien über Knoten öffnen, zoomen, Knoten anordnen und Beziehungstypen sowie Begründungen ansehen. |
| Quellenbetrachter | Unterstützte Office- und PDF-Originale offline ansehen, ohne sie zu bearbeiten. |
| Änderungsprüfung | Gespeicherte Fassungen vergleichen, einzelne Änderungen oder ganze Dateien prüfen, kommentieren und Autoren antworten. |

Der Graph zeigt den von Maintain gespeicherten Projektstand aus `.llmwiki/graph.json`.
Neue Notizen und geänderte Links erscheinen, nachdem Maintain `graph.refresh`
ausgeführt hat. Ein Neuladen des Browsers liest nur diesen gespeicherten Stand.
Anordnung und Zoom werden getrennt gespeichert. Das Bearbeiten einer Notiz startet
keine automatische semantische Analyse.

**Das Öffnen hängt von der Anwendung ab:**

- **Geeignete lokale Node-Umgebung:** Maintain prüft die Fähigkeiten, startet den
  lokalen Editorserver und liefert einen persönlichen Link. Bestätige bekannte
  Ordner. Erzeugte Startdateien `Editor starten.command` oder `Editor starten.cmd`
  öffnen das Projekt erneut.
- **Umgebung ohne lokalen Server:** Öffne die eigenständige
  HTML-Datei in **Chrome oder Edge**. Der Freigabeassistent fragt zuerst nach dem
  Projekt, danach nach externen Ordnern. Vorhandene Berechtigungen lassen sich
  wiederverwenden; beim ersten Zugriff ist eine tatsächliche Ordnerauswahl nötig.
  Diese Browserfreigabe kommt zu den erforderlichen Projektfreigaben hinzu:
  **Alle Arbeitsordner müssen auch für den Agenten mit Lese- und Schreibrechten
  verbunden sein.** Firefox ist kein schreibfähiger Ersatz für diesen Browserweg.
- **Entfernte Ausführungsumgebung:** Es wird eine erreichbare Vorschau oder der
  eigenständige HTML-/Obsidian-Weg benötigt. Eine lokale Adresse innerhalb eines
  Containers ist kein Server auf deinem Notebook. Vault Operator verwendet Obsidian.

Die Editor-Dateien funktionieren offline; Agentenfunktionen benötigen weiterhin
den Modellzugriff deiner Anwendung. Die Oberfläche unterstützt Deutsch und Englisch.
Die Oberfläche verwendet ein neutrales Design mit wählbaren Akzenten.

## Obsidian als externer Editor

### Bestehenden Obsidian-Vault hinzufügen

Verbinde den Vault-Ordner unter **Wikis** über die Plus-Schaltfläche in der
Seitenleiste oder bitte Maintain darum. Dadurch wird die Verbindung gespeichert.
Es startet **kein automatischer Agentenlauf**, es entsteht noch kein Index und der
Graph wird noch nicht aktualisiert. Vorhandenes Markdown wird als Wiki-Wissen
integriert, ohne jede Notiz zusätzlich als externes Quellenabbild zu duplizieren.

Rufe im bestehenden Projekt `maintain-llm-wiki` beispielsweise so auf:

> Integriere den neu verbundenen Obsidian-Vault „NAME“ vollständig als vorhandenes
> Wiki. Verwende seine bestehende Verbindung, erhalte meine Notizen und Anhänge und
> ergänze fehlende Wiki-Struktur, Navigationsindex und Knowledge Graph. Richte kein
> weiteres Projekt ein.

Maintain führt anschließend diese Schritte aus:

1. **Zugriff prüfen und abgleichen.** Die bestehende Verbindung den freigegebenen
   Ordnern der Anwendung zuordnen und die Dateien des Vaults in seine Arbeitsfassung
   übernehmen. Eine Browserfreigabe allein stellt noch keine Gerätebindung für den
   Agenten her. Auch der verwendete Arbeitsordner muss im Projekt
   verbunden und mit Lese- und Schreibrechten freigegeben sein.
2. **Fehlende Wiki-Struktur ergänzen.** Nur fehlende Angaben zu Zweck und Leserkreis
   abfragen. Anschließend mit `wiki.initialize` Ontologie, `wiki/bundle.md` und
   `wiki/index.md` ergänzen. Vorhandene Notizen, IDs, eigene Eigenschaften, Anhänge
   und selbst geschriebene Navigation bleiben erhalten. Das Projekt wird nicht
   zurückgesetzt und bestehende Ordner werden nicht pauschal aufgelöst.
3. **Notizen inhaltlich prüfen.** Neue oder geänderte Markdown-Dateien lesen, mit
   vorhandenem Wissen vergleichen und passende Topics sowie begründete semantische
   Beziehungen pflegen. Eingebettete Bilder werden zusammen mit ihren Notizen
   bewertet. Die Initialisierung allein schließt diese Prüfung nicht ab.
4. **Links und Navigation aktualisieren.** Nach der Aufbereitung `index` ausführen.
   Eindeutig auflösbare Wikilinks in eigenen Texten werden zu Markdown-Links;
   Code und vollständige Quellenzitate bleiben unverändert. Fehlende oder mehrdeutige
   Ziele bleiben konkrete Befunde, statt durch Vermutungen ersetzt zu werden.
5. **Abgleichen und Graph speichern.** `graph.refresh` am Projektordner ausführen.
   Der Editor liest die dort gespeicherte `.llmwiki/graph.json`. Lade ihn neu, um
   den aktualisierten Stand anzuzeigen.

**Direkt nach dem Verbinden fehlen Index oder Graph?** Möglicherweise steht der
erste Maintain-Lauf noch aus. Nach einer erfolgreich abgeschlossenen Integration
sollte `wiki/index.md` in der Arbeitsfassung vorhanden und mit dem verbundenen Wiki
abgeglichen sein. Der Projektgraph sollte dessen zugängliche Notizen enthalten.
Fehlt eines davon, lass Maintain Zugriff, Initialisierung, Index und Graph-Befunde
für dieselbe Verbindung prüfen. Ein Neuladen des Browsers führt diese Schritte
nicht aus.

Spätere Maintain-Läufe prüfen neue und geänderte Notizen inkrementell, auch bei
Wikis ohne externe Quellenordner. Das Hinzufügen oder Bearbeiten einer Notiz in
Obsidian ruft Maintain nicht automatisch auf.

### In Obsidian weiterarbeiten

1. Wähle bei der Einrichtung oder später in den Einstellungen **Obsidian** oder
   **beide parallel**.
2. Lass dir von Maintain den tatsächlichen **Pfad der Arbeitsfassung** nennen und
   öffne diesen Ordner als Obsidian-Vault. Verwende bei getrennten Arbeitsfassungen
   die jeweiligen Vaults. Ersetze diesen Pfad nicht durch den geteilten Wikiordner
   oder den gesamten Projektordner. Alle verwendeten
   Arbeitsordner müssen weiterhin im Projekt mit Lese- und Schreibrechten verbunden sein.
3. Schreibe Markdown und verwende lokale Anhänge. Wenn beide Editoren aktiviert
   sind, nutzen Browser und Obsidian dieselben gespeicherten Dateien. Ein zusätzlicher
   Export oder Import ist nicht erforderlich.
4. Rufe Maintain auf, um geteilte Änderungen zu empfangen, Bearbeitungen zu prüfen,
   Notizen und Bilder zu integrieren, freigegebene Änderungen zu übertragen und den
   Graphen zu aktualisieren. Bei ausschließlicher Obsidian-Nutzung zeigt der Agent
   Vergleiche im Gespräch und fragt nach deinen Entscheidungen.

Obsidian liefert die Bearbeitungsoberfläche. Die Installation der Skills startet
dort keinen Agenten automatisch. Ein geöffneter Vault oder eine geöffnete Notiz
wählt auch nicht automatisch das Zielwiki des Agenten; benenne es bei Unklarheit.
Bei externen Änderungen kann der Autor zunächst unbekannt sein und eine ausdrückliche
Prüfung nötig werden.

## Zusammenarbeit und Änderungsprüfung

Zusammenarbeit erfolgt **asynchron über geteilte Wikiordner**. Jede Person verwendet
eine eigene Arbeitsfassung und Autorenidentität. Änderungen aus Browser, Agent und
externem Editor treffen durch Synchronisation und Prüfung zusammen. Gleichzeitiges
Schreiben mit gemeinsam sichtbaren Cursorn wird nicht angeboten.

1. Teile den Wikiordner über deinen Ablagedienst. Jede Person verbindet ihn in ihrer
   eigenen Einrichtung. Lesen benötigt Leserechte; das Zurückschreiben benötigt
   Schreibrechte. Gib Originalquellen bei Bedarf gesondert frei. Jede Person
   verbindet außerdem ihre eigenen Arbeitsordner mit Lese- und
   Schreibrechten in ihrem Projekt.
2. Rufe Maintain vor und nach der Arbeit auf oder lasse den integrierten Browsereditor
   für dessen Abgleich geöffnet. Übertragbare Änderungen und Autoren-/Prüfereignisse
   werden zwischen Arbeitsfassung und Wiki ausgetauscht. Ungespeicherte Browserentwürfe
   bleiben lokal.
3. Prüfe Änderungen seit deinem bestätigten Stand. Übernimm einzelne Änderungen oder
   die ganze Datei, lehne ab, schlage eine andere Fassung vor oder kommentiere.
   Antworten erreichen den anderen Autor nach dem Abgleich. Das Auflösen einer
   Diskussion übernimmt nicht zugleich den vorgeschlagenen Text.
4. Vergleiche bei Konflikten **gemeinsamen Ausgangsstand, eigene Fassung und fremde
   Fassung** und entscheide bewusst. Konflikte und fehlende Autorennachweise bleiben
   sichtbar; kein Zeitstempel gewinnt automatisch. Ablehnungen und Gegenvorschläge
   bleiben nachvollziehbar.

Autorennamen dienen der Zuordnung, nicht der Authentifizierung. Angaben zum
Leserkreis erteilen keine Speicherrechte. Die Historie umfasst protokollierte
Fassungen, nicht jede externe Speicherung. Für langfristige Wiederherstellung
verwende die Versionshistorie des Ablagedienstes oder Sicherungen.

Es gibt **keinen dauerhaft laufenden Hintergrunddienst für die Synchronisation**.
Der Browser gleicht während seiner Laufzeit ab; Maintain während seiner Arbeit.
Obsidian allein führt den Skill-Abgleich nicht aus. Der lokale Editorserver stellt
nur Dateizugriff bereit. Synchronisation und Aushängen übertragen keine Löschungen;
eine lokale Datei zu entfernen löscht kein geteiltes Wissen.

Bitte Maintain, eine Arbeitsfassung bei Bedarf in einen zugänglichen leeren Ordner
umzuziehen. Beende vorher die aktive Bearbeitung. Der Zielordner muss
zuerst im Projekt verbunden und mit Lese- und Schreibrechten freigegeben werden.
Der verwaltete Umzug erhält Dateien, Entwürfe und Abgleichstände vor dem Wechsel,
ohne die alte Kopie zu löschen oder ausstehende Änderungen zu veröffentlichen.

## Pakete aus dem Quellcode erstellen

Die fertigen Pakete liegen unter [dist/public/](dist/public/README.md).
Wer selbst baut, benötigt Node ab 22.13 und führt im Repository aus:

```sh
npm ci
npm run build
```

Der Build erzeugt beide Skills für fünf Plattformen, das Claude-Code-Plugin und
[Prüfsummen](dist/public/release-0.4.23.json). Nutzer der fertigen Skills benötigen
diesen Schritt nicht. [Herkunft und Lizenzen](NOTICE.md).

## Editor-Titel und Schriftzug: 0.4.20

Der Editor heißt **Knowledge Studio**.
Der Schriftzug neben dem Logo bleibt auch nach dem Laden eines Projekts der
Studio-Name. Der Projektname erscheint weiterhin im Wissensraum und in den Einstellungen.

## Korrektur großer Schatten-Identitäten: 0.4.18

Viele kurze Absätze konnten in 0.4.17 den ersten Schattenaufbau am 512-KiB-
Paketlimit blockieren. Große Identitäten verteilen sich jetzt automatisch auf
mehrere geprüfte Pakete. Abgebrochene Übertragungen lassen sich wiederholen;
ein Rebuild erhält andere Wikis und den bisherigen gesunden Cache bis zum Ersatz.

Beide Skills und den Editor aktualisieren, danach mit Maintain erneut
**„Aktualisiere den Markdown-Schatten.“** ausführen. Keine Dokumente verschieben
und keine Identitätspakete löschen. Das gilt für alle Node-Plattformen;
Vault Operator behält seinen lesenden Rückfall.

## Markdown-Schatten: 0.4.17

Node-Plattformen halten einen lokalen SQLite-Spiegel mit Abschnitten, Revisionen
und Belegadressen. Die Markdown-Dateien bleiben unverändert. Query liest diesen
Spiegel und prüft die aktuellen Dateien; Browser und Vault verwenden ausdrücklich
einen lesenden Rückfall. Lokale Vektorsuche ist weiterhin nicht implementiert.

Zum Ausprobieren mit dem Maintain-Skill:

1. „Aktualisiere den Markdown-Schatten.“ (`shadow.refresh`)
2. Mit Query eine konkrete Frage stellen und eine gelieferte Fundstelle auswählen.
3. Mit Maintain deren `pin_request` ausführen und den Beleglink im Editor öffnen.
4. Die Aussage extern ändern: Der gespeicherte Beleg behält seinen ursprünglichen
   Wortlaut. Nach erneuter Pflege wird ein aktueller Nachfolger nur bei eindeutiger
   Zuordnung angeboten.

`shadow.status` zeigt den Zustand, `shadow.rebuild` baut den ersetzbaren Cache neu
auf. Geteilte Identitäten und gezielt gespeicherte Zitate werden mit dem Wiki
synchronisiert; die lokale SQLite-Datei bleibt außerhalb des Projekts. Details zu
Aktionen und Grenzen stehen in der [Bedienreferenz](platforms/operations.md).

## Neuerungen aus dem Review: 0.4.16

- Der Graph blendet Namen beim Herauszoomen aus. Mit Maus oder Tastaturfokus auf
  einer Notiz erscheinen deren direkte Nachbarn und Verbindungen; der übrige Graph
  tritt zurück. Die Kanten haben keine Pfeilspitzen. Der gespeicherte Graph bleibt
  die Datengrundlage; der Editor berechnet beim Tippen keinen neuen Wissensgraphen.
- Der Editor speichert nach einer kurzen Schreibpause von etwa 800 ms. Ein Entwurf
  wird zusätzlich lokal gesichert. Fehlen Autor oder Schreibzugriff, oder wurde die
  Datei zwischenzeitlich geändert, pausiert das automatische Speichern mit einem
  Hinweis. Die Änderungsprüfung entscheidet über konkurrierende Fassungen.
- In den Eigenschaften sehen Auswahllisten wie kompakte Textfelder aus. Über
  **Sichtbare Metadaten** lassen sich Originalverweise sowie Erstellungs- und
  Änderungszeit der Quelle und Erzeugungszeit der Wiki-Fassung ein-/ausblenden.
- `resource` zeigt nur die Originalverweise. Technische Werte wie Speicherzuordnung,
  Prüfsumme und Datumsherkunft bleiben zusammen mit `generated` und den Beleg-IDs
  aus `sources` in einem unsichtbaren, markierten JSON-Kommentar direkt nach dem
  Frontmatter erhalten. Dieser Kommentar gehört zur Datei und muss beim Kopieren
  oder Bearbeiten des Quelltextes erhalten bleiben. Die Runtime liest alte und neue
  Dateien. Sichtbare Datumsfelder sind flache Anzeigen dieser Herkunftsdaten.
- `sources` bezeichnet Beleg-Identitäten: Welche Quelle stützt eine Aussage?
  `related` bezeichnet ausgehende Verweise auf andere Notizen. Beides hat einen
  unterschiedlichen Zweck. Lesbare Beleg- und Originalverweise stehen zusätzlich
  im aufklappbaren Block **Quellen und Belege**. So sind sie auch in Obsidian
  anklickbar; dessen native Properties rendern Markdown-Links nicht als Markdown.
- **Beziehungen** enthält eingehende Verweise als eingeklappten Linkblock. Nur
  ausgehende Links stehen in `related`. Semantische Typen und Begründungen bleiben
  in den ausgehenden Beziehungstabellen und im Graph erhalten. Bestehende Dateien
  werden beim nächsten Pflege-/Indexlauf auf diese Darstellung umgestellt; dies
  erzeugt einmalig nachvollziehbare technische Änderungen. Unveränderte Folgeläufe
  erzeugen keine weiteren Umsortierungen oder Fassungen.
- Obsidian schreibt keine verlässliche Bearbeiteridentität in jede Datei. Bei einer
  eigenen externen Änderung wähle in der Änderungsprüfung **Diese Änderung stammt
  von mir**. Der Editor protokolliert diese ausdrückliche Bestätigung unter deinem
  Autorennamen. Fremde Änderungen werden nicht automatisch dir zugeschrieben.
- Query liefert klickbare Dateiverweise und passende Fundstellen. Existierende
  Blockanker werden bevorzugt, sonst wird auf die Überschrift verwiesen. Ohne
  vorhandenen Anker bleiben Dateilink, exaktes Zitat, Zeilen und Datei-Prüfsumme.
  Ob die Anwendung bis zum Anker scrollt, hängt vom öffnenden Host ab. Zeilennummern
  gelten nur für den zitierten Dateistand. Seit 0.4.17 ergänzt der Markdown-Schatten
  diese Navigation um gespeicherte, revisionsgebundene Belege.
