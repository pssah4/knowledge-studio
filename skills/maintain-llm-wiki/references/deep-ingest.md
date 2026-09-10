# Einzelquelle im geführten Aneignungsdialog

Verbindlicher Standard für einen Chat-Dateianhang und „ingeste diese Datei“.
Ein ausdrücklicher Auftrag zur automatischen Bestandserschließung bleibt Modus
`ingest`; andernfalls Modus `appropriate`. Technische Aufnahme und persönliche
Aneignung haben getrennte Ergebnisse. Ein Upload ist keine Übernahmeentscheidung.

1. Kurz erklären: Quelle lesen, gegen den Bestand einordnen, gemeinsam entscheiden,
   vollständig ablegen und Erkenntnisse verknüpfen. Bestehendes Zielwiki und zugeordneten
   Quellenordner verwenden; nur mehrdeutige oder fehlende Auswahl erfragen.
2. Den tatsächlichen Anhang vollständig lesen. Passende vorhandene Notizen und Topics
   mit `query` suchen und relevante Treffer vollständig lesen. Eine kurze Einordnung
   mit belegten Gemeinsamkeiten, Neuem, Widersprüchen und offenen Fragen vorlegen.
   In einem leeren Wiki die fehlende Vergleichsgrundlage ausdrücklich benennen.
   Vor der Aufnahme `intake.start` mit Anhang-Digest, Ziel, belegter Einordnung und
   Themenkandidaten speichern (Parameter siehe operations.md).
3. Fragen: jetzt aufnehmen und durcharbeiten, zurückstellen oder verwerfen. Auf die
   tatsächliche Antwort warten. Bereits explizit gegebene Entscheidungen übernehmen;
   „ingeste diese Datei“ legt weder persönliche Erkenntnisse noch Themenauswahl fest.
   Bei zurückstellen/verwerfen die Antwort mit `intake.decide` protokollieren;
   keine Originalkopie und keine Wissensseiten schreiben.
4. Aus dem tatsächlichen Inhalt eine kleine Themenauswahl zeigen. Den Nutzer wählen
   lassen, welche Themen er vertiefen möchte. Die Themenwahl begrenzt nur die gemeinsame
   Ausarbeitung; das Quellen-Markdown muss immer den vollständigen Inhalt bewahren.
   Im Dialog Rückfragen stellen und Erkenntnisse gemeinsam entwickeln. Ergebnisform
   abstimmen: zusammenhängende Ausarbeitung, einzelne Wissensnotizen, Ergänzung einer
   vorhandenen Notiz oder zunächst nur die vollständige Quelle bewahren.
   Nach der tatsächlichen Antwort `intake.decide` mit Originalantwort, Themenwahl und
   Ergebnisform speichern. Bei „nur Quelle“ form `source-only` wählen.
5. Nach bestätigter Aufnahme Original mit `source.store` und bestätigter `intake`-ID exklusiv in der ausgewählten
   Quelle ablegen (wenn es dort nicht schon liegt). Ergebnis mit `source.read` am exakt
   zurückgegebenen source/path prüfen: Digest und Inhalt müssen zum Anhang passen.
   Kein beliebiger ähnlich benannter Mirror als Ersatz. `source.ingest` verwenden und
   den erzeugten Quelleninhalt erneut lesen. Quelle und Wiki niemals manuell kopieren,
   um ein fehlgeschlagenes Werkzeug zu umgehen. Bei fehlendem Schreibrecht die konkret
   erforderliche Quellenfreigabe erklären; keine Ablage in einem anderen Ordner erfinden.
6. `workflow.start` im Modus `appropriate` und `workflow.review` mit tatsächlichen
   Vergleichsstellen. Bereits passende breite Topics wiederverwenden, sonst fachlich
   passende Topics erstellen; Beziehungen mit Typ, Markdown-Ziel und konkretem Grund
   schreiben. `related` enthält Markdown-Links. Indizes sind keine Themenersatzseiten.
7. Die gemeinsam entwickelten Erkenntnisse und Ergebnisform bestätigen lassen, sofern
   noch nicht ausdrücklich entschieden. `workflow.decide` protokolliert ausschließlich
   die wirkliche Antwort. `workflow.finish` erst nach Speicherung der gewählten Inhalte.
   Bei „nur Quelle“ keine Erkenntnisse erfinden: persönliche Aneignung als zurückgestellt
   protokollieren und genau so berichten, nicht als vollständig integriertes Wissen.
   Quellenmirror und jede daraus abgeleitete Sensemaking-/Wissensnotiz müssen
   sich gegenseitig im Frontmatter `related` mit normalen Markdown-Links nennen.
   Die Quellen-ID in `sources` bleibt zusätzlich als stabiler Herkunftsbeleg.
   Eine begründete ausgehende `references`-Beziehung der Ausarbeitung zur Quelle
   wird beim Indexlauf in beide related-Listen übernommen; keine zweite inhaltliche
   Gegenbeziehung erfinden. Eine automatisch erzeugte Zusammenfassung oder ein
   Topic ist kein Ersatz für eine im Dialog entwickelte Sensemaking-Notiz.
8. Index, Sync und Projektgraph aktualisieren und Abschlussprüfungen aus operations.md
   durchführen. Bericht nennt Originalort, Markdownort, Themen/Beziehungen und offene
   Inhalte. Ein Dialog wurde nur geführt, wenn Antworten tatsächlich vorliegen.

## Vollständigkeit und visuelle Inhalte

Kein Python, pypdf, LibreOffice oder nachinstallierter Konverter. Bundled Reader und
wirklich verfügbare Host-Werkzeuge verwenden. Binäre PDF-Bytes, Textausgabe oder eine
Pixelstatistik sind KEINE Bildsichtung. Für jedes visuelle Gap das tatsächliche Bild
oder die Seite ansehen und Inhalt konkret wiedergeben. „Layout/dekorativ“ darf keine
pauschale Ersatzbeschreibung sein. Tabellen, Rangordnungen, Diagrammbeschriftungen,
Legenden und Beziehungen gehören zum Quelleninhalt. Ohne verfügbare Bildsichtung bleibt
`coverage_required` offen. Niemals denselben generischen Satz für viele Seiten einsetzen,
Coverage erfinden oder eine Platzhalterseite als erfolgreich integrierte Quelle zählen.

## Bezug zum Vorbild

Übernommen aus dem Ablauf von vault-operator-skills/ingest-deep: Triage gegen den
Bestand, echte Nutzerentscheidung, Themenwahl, Ergebnisform, gemeinsame Ausarbeitung
und Rückverknüpfung. Dieses Projekt behält seinen eigenen Datenvertrag und normale
Markdown-Links. Keine automatische Übernahme fremder OKF-Felder, Wikilinks oder
Blockmarker. Dauerhafte Blockadressierung bleibt das separat geplante Schattenfeature.
