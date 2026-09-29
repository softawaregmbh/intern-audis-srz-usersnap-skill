# AUDIS-Grammatik – Kurzreferenz für den SRZ-Katalog

Maßgeblich ist der AUDIS-Parser (ANTLR-Grammatik `Audis.g4`), nicht die offizielle Online-Doku. Wo die Doku abweicht, steht es unten unter „Abweichungen“.

## Dateiaufbau

- Abschnitte, alle optional, jeder höchstens einmal, **genau in dieser Reihenfolge**:
  `## Trigger ##`, `## Suche ##`, `## Fragen ##`, `## Szenarien ##`, `## Tags ##`, `## Zusammenfassung ##`
- Überschriften exakt so schreiben (je ein Leerzeichen innen).
- Kommentare: `// …` bis Zeilenende, `/* … */` auch mehrzeilig. Innerhalb von `"…"` ist `//` kein Kommentar.
- Katalogname = Pfad relativ zu `questioncatalog/` ohne `.audis`, immer mit `/`, z. B. `Handlungsanweisungen/99-HA-CPR`. Dateien ohne Endung `.audis` lädt AUDIS nicht.
- Unterordner ändern die Reihenfolge nicht; sortiert wird nach Dateinamen (Ziffern vor Großbuchstaben vor Kleinbuchstaben).

## Knowledge-Identifier

- `#` gefolgt von Buchstaben, Ziffern, Umlauten, `.` und `-` – kein `_`, kein Leerzeichen: `#trauma.vu.kinematik`
- Identifier überall exakt gleich schreiben (auch Groß-/Kleinschreibung).
- Werte werden in `.audis`-Bedingungen **ohne** Beachtung der Groß-/Kleinschreibung verglichen (`ja` = `Ja`). In Enricher-Bedingungen gilt das nicht, siehe [engine-semantics.md](engine-semantics.md).

## Fragen

```
Fragetext -> #identifier | Zusammenfassungs-Template
{ option; option = wert }
    * Antwort
```

- `-> #identifier` ist optional. Ohne Identifier erzeugt AUDIS einen aus Katalogname und Fragetext – solche Identifier nicht referenzieren.
- `| Text` nimmt das Wissen in die Wissenszusammenfassung auf, `| *` übernimmt den Antworttext. **Ohne Pipe erscheint die Frage nicht in der Zusammenfassung.**
- Metadaten stehen in der Zeile direkt nach der Frage – **alle Optionen in einer** `{ … }`-Zeile, getrennt durch `;`.
- Frage-Optionen: `multiselect`, `hideUnknownAnswer`, `required`, `exclusive`, `autocomplete`, `allowFreetext`, `forceSummary`, `help = Text`, `link = "https://…"`, `priority = "0…100"`, `colormode = infoColoring | warningColoring | dangerColoring | dispatcherColoring`, `visualization = …` mit den Parametern `icon = …`, `alignment = top | bottom | left | right`, `mediaFile = …`, `min = …`, `max = …`, `format = …`.
- Ohne `hideUnknownAnswer` bietet AUDIS zusätzlich „Unbekannt“ an (gespeicherter Wert `unbekannt`).
- Eine Frage ohne Antwortzeilen und ohne Visualisierung erhält die Standardantworten aus `constants.json` (`Ja`, `Nein`, `unbekannt`).
- Fett: `**Text**`. HTML nur in Anführungszeichen (siehe „Erlaubte Zeichen“).

## Antworten

Präfix: `*` neutral, `+` positiv (grün), `-` negativ (rot). Das Präfix ändert nur die Darstellung.

### Auswahlantwort

```
* [#identifier =] Text [ Synonym; Synonym; !Kontrawort ] [= Wert] [; #weiteres = Wert …] [-> @Szenario] [| Template]
```

- Gespeicherter Wert: `= Wert`, falls angegeben, sonst der Antworttext ohne `**`. HTML und Erläuterungen bleiben sonst im Wert stehen – bei solchen Texten immer `= Wert` angeben.
- Wer einen Antworttext umformuliert, ändert damit den Wert. Bestehende Bedingungen bleiben nur mit `= AlterWert` gültig.
- Synonyme **nur mit `;` trennen**. Ein Komma gehört zum Synonym, aus `[ A, B ]` wird ein einziges Synonym. Kontrawörter `!Wort` schließen Suchtreffer aus und wirken nur als eigenes Synonym.
- `; #id = Wert` setzt zusätzliches Wissen, beliebig oft.
- `-> @Szenario` nominiert direkt ein Szenario (muss in `constants.json` existieren).
- Antwort-Metadaten in der Folgezeile: `{ help = … }`, `link`, `priority`.

### Freitextantwort (zwei oder mehr Unterstriche)

| Schreibweise | Primärwissen | Freitext landet in |
|---|---|---|
| `* ___` | Frage-Identifier = Eingabe | – |
| `* Label: ___` | Frage-Identifier = `Label` | `#frage.label` |
| `* ___ = Wert` | Frage-Identifier = `Wert` | `#frage.text` |
| `* Label: ___ = Wert` | Frage-Identifier = `Wert` | `#frage.label` |
| `* #id = ___` | `#id` = Eingabe | – |

Label-Postfix: Zeichen `? - : " ( ) [ ] { } + , / \ < >` entfernen, klein schreiben, Leerzeichen durch `-` ersetzen („Gewicht in kg“ → `.gewicht-in-kg`).

## Bedingungen

```
[ #id = Wert ]          Wissen gesetzt und enthält Wert
[ #id != Wert ]         Wissen nicht gesetzt ODER Wert nicht enthalten
[ #id !== Wert ]        Wissen gesetzt UND Wert nicht enthalten
[ #id => VORHANDEN ]    Wissen gesetzt
[ #id => FEHLEND ]      Wissen nicht gesetzt
[ Wert ]                ohne Identifier – siehe unten
```

- Mehrere Werte `#id = A; B` verlangen **alle** Werte. `#id != A; B` ist bereits erfüllt, wenn **nicht alle** enthalten sind. Für „keiner der Werte“ schreibt man `#id != A && #id != B`.
- `!=` ist auch erfüllt, wenn die Frage nie gestellt wurde. Ist das nicht gewollt, `!==` verwenden.
- `&&` bindet stärker als `||`; Klammern gibt es nicht. `A || B && C` bedeutet `A || (B && C)`.
- **(A || B) && C** schreibt man so:
  - in Fragen verschachteln: `[ A || B ]` und darunter eingerückt `[ C ]`
  - in Triggern, Szenarien und Zusammenfassungsregeln auf zwei Zeilen verteilen, denn Zeilen sind UND-verknüpft
- **Einrückung = Verschachtelung:** Ein Element gehört zum letzten Element (Bedingung oder Frage) mit kleinerer Einrückung. Gestellt wird immer von oben nach unten. Tabs vermeiden, sie zählen als eine Spalte.
- Eine Bedingung ohne eingerückten Inhalt ist ein Fehler, der Parser warnt.

### Bedingungen ohne Identifier

`[ Ja ]` oder `[ Nein || Unbekannt ]` bezieht AUDIS auf die zuletzt gelesene Frage mit **kleinerer** Einrückung, auch wenn sie aus einem früheren, anderen Zweig stammt. Nur wenn es keine gibt, gilt die vorherige Frage mit gleicher Einrückung.

- **Die Bindung gilt pro Datei:** Fragen, die per `INKLUDIERE` eingefügt werden, zählen nicht. Wer eine Frage aus einer Datei in ein Template auslagert, verschiebt damit die Bindung späterer `[ Wert ]`-Bedingungen derselben Datei (verifiziert bei #2355). `check-catalog.mjs` meldet unveränderte Bedingungen, deren Bezugsfrage sich verschoben hat.
- Solche Bedingungen daher **immer tiefer einrücken als ihre Frage**.
- Nach Umbauten der Verschachtelung, oder wenn Zweifel bestehen, den Identifier ausschreiben: `[ #frage = Ja ]`.
- Der Wert muss der gespeicherte Wert sein (`= Wert` der Antwort), nicht der Antworttext.

Beispiel für den Fehler, mit dem echten Parser nachgewiesen:

```
    [ Nein ]
        Hilfeanweisung Reanimation anzeigen?     (Spalte 8)
        { hideUnknownAnswer }

        [ Ja ]                                   (Spalte 8 → bindet an eine frühere Frage auf Spalte 4!)
            INKLUDIERE { Handlungsanweisungen/99-HA-CPR }
```

Richtig ist `[ Ja ]` auf Spalte 12, also tiefer als die Frage.

## Operationen und Include

```
=> ABSCHLUSS                        Befragung beenden
=> EREIGNIS "Name"                  Ereignis (muss in constants.json unter Events stehen)
INKLUDIERE { Katalog, Katalog }     Katalog einbinden – ohne "=>"
```

Die Fragen des Katalogs werden an dieser Stelle eingefügt, Szenario-, Tag- und Zusammenfassungsregeln werden übernommen. Welche Vorbedingungen die übernommenen Regeln bekommen, steht in [engine-semantics.md](engine-semantics.md). Die Trigger des eingebundenen Katalogs werden ignoriert.

## Trigger

```
## Trigger ##

{ triggertype = final }
#a = X
#b != Y

#c = Z
```

- Zeilen innerhalb eines Blocks: UND. Blöcke, getrennt durch Leerzeilen: ODER.
- **Eine reine Kommentarzeile trennt ebenfalls Blöcke**, sie wirkt wie eine Leerzeile.
- Metadaten stehen als erste Zeile eines Blocks: `triggertype = default | suggested | final`, `triggerEvent = "…"`.
  - `final`: Der Katalog wird erst vorgeschlagen, wenn alle anderen abgeschlossen sind.
  - `suggested`: eigener Tab neben der Hauptabfrage.
- Bedingungen im Trigger stehen ohne eckige Klammern.

## Suche

```
## Suche ##

CPR
    #audis.hotkey = CPR
```

## Szenarien und Tags

```
## Szenarien ##

@Szenario-Code
    #bedingung = X
    #weitere = Y || #andere = Z
```

- Die Bedingungszeilen folgen **direkt** auf den Code, ohne Leer- oder Kommentarzeile dazwischen. Alle Zeilen sind UND-verknüpft.
- Der Code muss exakt als `ScenarioIdentifier` in `constants.json` existieren, sonst lädt die Konfiguration nicht.
- Tags funktionieren analog mit `~Tag`. Der SRZ-Katalog nutzt keine Tags.

## Zusammenfassung

```
## Zusammenfassung ##

Person befindet sich draussen
    { priority = "50" }
    #audis.inj.draussen.trigger = Ja
```

Text mit Sonderzeichen oder `{#id}`-Platzhaltern gehört in Anführungszeichen.

## Visualisierungen (Auszug)

| Wert | Zweck | Zusätzliches Wissen |
|---|---|---|
| `instruction`, `info`, `warning`, `danger` | Anweisung / Hinweis (`icon`, `alignment`, `mediaFile`) | Wert je nach Schaltfläche, z. B. „Durchgeführt“, „Nicht durchgeführt“ |
| `apisearch` | Suchfeld über die Antworten (Einstieg `#was`) | – |
| `age` | Alter | `.age .days .weeks .months .year .date`; Altersgruppe unter `#alter.agegroup` |
| `body`, `bodyCoarse`, `pain`, `injuries`, `burn`, `burnCoarse` | Körperdiagramm | `.simple` (ohne links/rechts, vorne/hinten), `.grouped`; bei `burn` zusätzlich `.percentage…` |
| `date`, `time`, `datetime` | Zeitpunkt | `.hours` (volle Stunden seit dem Zeitpunkt) |
| `number` | Zahl (`min`, `max`, `format`) | – |
| `bloodpressure` | Blutdruck | `.systolic .diastolic .blood-pressure-type` |
| `respiratory`, `heartbeat` | Frequenzmessung | Schwellwert-Wissen aus `revision-settings.json` |
| `buildingFire`, `industrialFire` | Gebäudeteile markieren | `.type .full .floor` |
| weitere | `reanimation`, `hazard`, `location`, `media`, `counter`, `feedback`, `pain-scale` | |

- Altersgruppen-Werte: `Säugling`, `Kleinkind`, `Kind/Jugend`, `Erwachsen`.
- `.grouped`-Werte: `Kopfregion`, `Rumpf`, `Extremitäten`, `Arm`, `Bein`, `Gelenke`.
- Körperteile kommen übersetzt (CH): Der Direktwert lautet z. B. „Oberarm links“, `.simple` nur „Oberarm“. In Enrichern und Bedingungen nach Körperteil daher `.simple` verwenden.

## Erlaubte Zeichen (häufige Fehlerquelle)

**Unquotierter Text** (Fragen, Antworten, Werte, Synonyme, `help`):
- Erlaubt sind Buchstaben inkl. `äöüß` und Latin-1-Akzente, Ziffern, Leerzeichen, `( ) ? ! . + , : - /` sowie `**` für fett.
- Er muss mit Buchstabe, Ziffer oder `**` beginnen.
- `;`, `=`, `|`, `#`, `[`, `]` haben Syntaxbedeutung und dürfen nicht im Text stehen.

**Text in `"…"`:**
- Zusätzlich erlaubt: `[ ] { } \ > < & % _ # ' $ € @ ~ | ^`. HTML (`<br>`, `<small>`, `<ul><li>`) gehört deshalb in Anführungszeichen.
- Er muss ebenfalls mit Buchstabe, Ziffer oder `**` beginnen.
- `;` und `=` sind auch hier nicht erlaubt.

**Nirgends erlaubt:** typografische Anführungszeichen `„ “ ” « »`, `’`, Halbgeviertstrich `–`, `…`, `°`, geschütztes Leerzeichen, einzelnes `*`. Texte aus Usersnap, E-Mail oder Word deshalb zeichenweise prüfen. `scripts/check-catalog.mjs` meldet solche Zeichen.

## Abweichungen der offiziellen Doku vom Parser

- `=> GESETZT` und `=> BEKANNT` gibt es seit AUDIS 2.2.10 nicht mehr. Ersatz: `=> VORHANDEN`; `BEKANNT` entspricht `=> VORHANDEN && #id != unbekannt`.
- `INKLUDIERE { … }` steht **ohne** `=>`.
- Synonyme werden mit `;` getrennt, auch wenn Doku-Beispiele Kommas zeigen.
- `[ @Szenario ]` als Bedingung ist ungültig; stattdessen `[ #audis.scenarios = Szenario ]`.
- `!=` mit mehreren Werten verhält sich wie oben beschrieben („nicht alle enthalten“), nicht wie in der Doku („keiner enthalten“).
