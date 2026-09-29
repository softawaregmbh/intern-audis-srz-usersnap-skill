# AUDIS-Engine – Verhalten, das für Katalogänderungen zählt

Diese Regeln sind am AUDIS-Quellcode geprüft (Parser, Engine, Enricher-Auswertung). Sie erklären die meisten „unerklärlichen“ Snaps.

## Ablauf pro Abfrageschritt

Nach jeder Antwort läuft die Engine in dieser Reihenfolge:

1. **Enricher** (config/enricher-*.json) werten ihre Bedingungen aus und setzen oder entfernen Wissen.
2. **Trigger** aller Kataloge werden geprüft. Getriggerte Kataloge liefern Fragen.
3. **Operationen** werden ausgeführt (`=> ABSCHLUSS`, `=> EREIGNIS`).
4. **Filter:** bereits beantwortete Fragen, Bedingungen, Duplikate, `exclusive`, `final`.
5. Die **nächste Frage** wird bestimmt – Kataloge in Dateinamen-Reihenfolge, Fragen von oben nach unten.
6. **Szenarien** nominieren, daraus die **Dispositionsstufe** ableiten.
7. Tags, Injection-Buttons und Zwischendispositionen auswerten.

**Eine Frage gilt als beantwortet, sobald Wissen zu ihrem Identifier existiert** – egal woher: dieselbe Frage in einem anderen Katalog, Zusatzwissen einer Antwort (`; #id = Wert`), ein Enricher oder ein Injection-Button. Sie wird dann nicht (mehr) gestellt.

- **Absicht:** So belegt z. B. `start.audis` Fragen vor. Mit `#alter = x; #alter.agegroup = Erwachsen` entfällt die Altersfrage, mit `#atemnot = beschleunigt` die Frage nach der Art der Atemnot.
- **Nebenwirkung:** Wer irgendwo zusätzlich `; #id = …` setzt, blendet jede spätere Frage mit `-> #id` aus. Vor dem Hinzufügen von Zusatzwissen immer prüfen: `git grep -n -- "-> #id"`.
- **Gleicher Identifier, andere Frage:** Stellen zwei Kataloge dieselbe Frage mit demselben Identifier, erscheint sie nur einmal. Soll sie trotzdem erneut kommen, braucht sie einen eigenen Identifier.
- **Folgefragen einer vorbelegten Frage:** Eingerückte Folgeelemente einer Frage werden erst ausgewertet, wenn die Frage als beantwortet gilt. Ist ihr Wissen vorbelegt, laufen die Folgefragen sofort, als hätte man die Antwort gewählt. Beispiel: `[ Ja ]` unter der vorbelegten Frage wird gestellt.
- **Zusammenfassung bei Vorbelegung:** Indirekt gesetztes Wissen erzeugt keinen Eintrag in der Zusammenfassung. Der `| Text` der übersprungenen Frage fehlt dort also, ausser die Frage hat `{ forceSummary }`. Beim Vorbelegen in der Übergabe erwähnen.
- **`=> ABSCHLUSS` nach einer Anleitung:** Steht die Operation im selben Block hinter einem `INKLUDIERE` einer Handlungsanweisung, stellt AUDIS erst die Anleitung und beendet danach die Abfrage. Verifiziert bei #1880.
- **Kontextwechsel per Antwort** (`; #kontext = …`): Der bisherige Katalog verliert seinen Trigger, seine übrigen Fragen und Szenarien entfallen. Die Zusammenfassungseinträge bereits beantworteter Fragen blieben erhalten. Beobachtet mit AUDIS 2.4.0 bei #2357.

## Anleitungen (Visualisierung `instruction`)

Die Oberfläche zeigt drei Knöpfe und speichert deren Beschriftung als Primärwissen der Frage:

| Knopf | Gespeicherte Werte |
|---|---|
| „Durchgeführt, erfolgreich“ | `Durchgeführt, erfolgreich` **und** `Durchgeführt` |
| „Durchgeführt, ohne Erfolg“ | `Durchgeführt, ohne Erfolg` |
| „Nicht durchgeführt“ | `Nicht durchgeführt` |

Bedingungen wie `#…anweisung != Durchgeführt` sind also nach „erfolgreich“ nicht erfüllt, nach „ohne Erfolg“ dagegen schon. In Pfaddateien schreibt man die Beschriftung des Knopfs, siehe [simulation.md](simulation.md).

## Szenarien und Disposition

- **Alle Szenario-Regeln aller Kataloge werden bei jedem Schritt ausgewertet.** Eine Regel ist erfüllt, wenn alle ihre Zeilen erfüllt sind **und** die Trigger-Bedingungen ihres Katalogs. Letztere werden automatisch vorangestellt: Zeilen eines Trigger-Blocks mit UND, mehrere Blöcke mit ODER.
- **Folge 1:** Wer eine Bedingung aus dem Trigger in den Fragenteil verschiebt oder umgekehrt, ändert auch, wann die Szenarien des Katalogs greifen.
- **Folge 2:** Ein Katalog **ohne Trigger** hat Szenario-Regeln ohne Vorbedingung, die also global aktiv sind.
  - Deshalb tragen die Templates den Platzhalter-Trigger `#inkludebugfix = Version18`, den nie jemand setzt.
  - Neue Templates oder Handlungsanweisungen **mit** Szenarien brauchen diesen Trigger ebenfalls.
  - Ohne Szenarien ist ein Katalog ohne Trigger unproblematisch; er wird dann nur per `INKLUDIERE` gestellt.
- **Include-Regeln:** Szenarien eines per `INKLUDIERE` eingebundenen Katalogs erhalten **nur die Trigger-Bedingungen des einbindenden Katalogs**, nicht die `[ … ]`-Bedingungen, unter denen das `INKLUDIERE` steht. Ein Template-Szenario kann also greifen, obwohl der Zweig mit dem Include nie durchlaufen wurde. Beispiel: `@C-Einsatz` bei `#vermittlung.unmoeglich = Ja` aus `99-Vermittlung-und-PFS` wirkt in jedem der rund 40 Kataloge, die es einbinden.
- **Auswahl des Szenarios:** Es gewinnt die höchste Priorität der Dispositionsstufe, die ein Szenario über seine `DispositionCodes` in `constants.json` hat. Bei Gleichstand gewinnt das zuletzt nominierte bzw. im Katalog später definierte.
  - Das Senken einer Stufe (z. B. B→C) wirkt daher nur, wenn keine andere erfüllte Regel eine höhere Stufe liefert.
  - Zum Senken gehört meist ein Ausschluss in der höheren Regel.
- Ob eine Abfrage ohne Szenario beendet werden darf, steuert `IsScenarioNecessaryForInterrogationEnd` in `revision-settings.json`. Der Wert wurde schon mehrfach umgestellt, den aktuellen Stand prüfen.
- **Zwischendisposition** „Freigabe zur Disposition“: automatisch ab Priorität 1000, manuell angeboten ab 900 (`revision-settings.json`).

## Systemwissen

- `#audis.scenarios` enthält die aktuell nominierten Szenarien (ScenarioIdentifier), `#audis.dispo` die abgeleiteten Dispo-Codes.
  - Beide werden bei jeder Nominierung neu abgeleitet.
  - Bedingungen darauf bleiben innerhalb einer Abfrage erfüllt, sobald sie einmal erfüllt waren (Laufzeitzustand, kein Zurücksetzen).
- Die Bedingung `[ @Szenario ]` gibt es nicht mehr, stattdessen `#audis.scenarios = Szenario`.
- `#audis.intermediate-disposition` wird gesetzt, sobald eine Zwischendisposition greift, z. B. `Freigabe zur Disposition:RD-B-NBS`. In Pfaddateien lässt sich mit `"wissen": { "#audis.intermediate-disposition": null }` prüfen, dass bis zu einer Frage noch nichts freigegeben wurde (#2406).
- `#audis.initial.*` enthält die Startparameter aus dem Einsatzleitsystem, z. B. PLZ, Logon, GWR-Daten. URL-Parameter werden ebenfalls zu Wissen (`?p=…` → `#p`).
- **Nicht existierende System-Identifier** wie `#audis.szenario` werden nie gesetzt.

## Werte und Vergleiche

- **In `.audis`-Bedingungen** wird ohne Beachtung der Groß-/Kleinschreibung verglichen. `=` bedeutet: Wissen gesetzt und alle genannten Werte enthalten. Die übrigen Operatoren stehen in [grammar.md](grammar.md).
- **Gespeicherter Antwortwert:** `= Wert`, sonst der Antworttext ohne `**`. HTML bleibt im Wert.
- **„Unbekannt“:** Ohne `hideUnknownAnswer` wird `unbekannt` gespeichert. Explizite „Unbekannt“-Antworten werden ebenfalls auf `unbekannt` normalisiert.
- **Mehrfachauswahl** speichert mehrere Werte unter einem Identifier.

## Enricher (config/enricher-*.json)

- **Typen:**
  - `Conditional`: setzt Wissen, wenn die Bedingung erfüllt ist.
  - `Summary` / `Freetext`: wie Conditional, das Wissen landet aber zusätzlich im Zusammenfassungs-Freitext; `Priority` steuert die Reihenfolge.
- **Bedingungen** sind Flee-Ausdrücke:
  - Identifier stehen in `{#id}`, Texte in `\"…\"`.
  - Logische Operatoren: `AND`, `OR`, `NOT`; Vergleiche: `=`, `<>`, `<`, `>`, `<=`, `>=`.
  - Funktionen: `contains`, `containsAll`, `isKnowledgeSet`, `isNull`, `isNotNull`, `asNumeric`, `asNumericOrDefault`, `asDate`, `age`, `asText`.
- **Achtung, Groß-/Kleinschreibung:** `contains(...)` vergleicht exakt, und `{#id} = \"Ja\"` ist ebenfalls ein Textvergleich. Die Schreibweise muss dem gesetzten Wert genau entsprechen, anders als in `.audis`.
- **Mehrere Werte:** Hat ein Identifier mehrere Werte (Mehrfachauswahl, Körperdiagramm), ist er im Ausdruck eine Liste. Dann `contains(...)` verwenden, nicht `=`.
- `KnowledgeValue` darf Platzhalter enthalten: `\"{#alter.age} Jahre\"`.
- **Standardverhalten:**
  - `AutoUnenrich: true` (ab AUDIS 2.4.0): Gesetztes Wissen wird wieder entfernt, sobald die Bedingung nicht mehr erfüllt ist. In 2.3.0.x bleibt einmal gesetztes Enricher-Wissen stehen, auch wenn z. B. die Dispo wieder sinkt. `--wissen` zeigt das Entfernen als `- #identifier`.
  - `IsKnowledgeOverrideAllowed: true`: Enricher überschreiben vorhandenes Wissen.
  - Mehrere Enricher, die denselben Identifier setzen, überschreiben sich gegenseitig. Für parallele Merkmale deshalb getrennte Identifier verwenden (Muster `#trauma.stich.koerperstamm = ja`).
- **Überschreiben löscht die Antwort-Zuordnung:** Setzt ein Enricher einen Identifier, den vorher eine Antwort gesetzt hat, steht danach ein Wert mit Herkunft „Enricher“ und ohne `answerId`. Beispiel: `VermittlungUnmoeglich` setzt `#vermittlung.unmoeglich = Ja` ab Dispo RD-B. `simulate.mjs --wissen` zeigt Herkunft und fehlende `answerId`.
- **Folge in der Oberfläche** (AUDIS 2.3.0.1 bis 2.4.0): Beim Anzeigen einer Frage und beim Zurückspringen gilt eine Antwort als schon gewählt, wenn ein von ihr deklarierter Wert vom Server ohne passende `answerId` vorliegt (`isAnswerAlreadyKnown`, AUDIS-Code `knowledge-utils.ts`).
  - **Herkunft:** Der Server liefert Enricher-Werte in 2.3.0.x als „geerbt“, in 2.4.0 als „Enricher“.
  - **Geteilte Werte:** Deklarieren mehrere Antworten denselben Zusatzwert, werden alle markiert (Snap #2383).
  - **Nur Mehrfachauswahl:** Betroffen sind nur Mehrfachauswahl-Fragen (Umschalt-Antworten), die Einfachauswahl nicht.
  - **Folgen:** Vorausgewählte Antworten werden mit „Weiter“ mitgeschickt. Übersieht der Disponent sie, setzen sie ihr Wissen, mit Folgen für Szenarien und Dispo.
  - **Behoben** in AUDIS 2.4.0.1 für Werte, die mehrere Antworten deklarieren. Prüfen lässt sich das nur mit `ui-test.mjs`.
- **Flip-Flop bei Bedingung auf das eigene Wissen** (ab 2.4.0): Prüft ein Enricher `isNull({#x})` und setzt `#x` selbst, ist seine Bedingung im nächsten Schritt nicht mehr erfüllt. `AutoUnenrich` entfernt das Wissen dann wieder.
  - **Folge:** Das Wissen wirkt nur für einen Schritt. Das reicht für Szenarien und eine automatische Freigabe zur Disposition. Danach verschwinden Szenario und Wissen wieder.
  - **Beispiel:** `KindAtemwegsverlegung` in `enricher-abc.json`. Nach der Altersangabe kam kurz B Einsatz NBS mit Freigabe, danach doch die Frage „Wie ist die Atmung?“ (#2406).
  - **Erkennen:** `--wissen` zeigt `+ #x [Enricher]` und im nächsten Schritt `- #x`.
  - **Abhilfe:** Die Bedingung an eine Antwort knüpfen oder `"AutoUnenrich": false` setzen. Letzteres ändert den Ablauf und ist deshalb fachlich zu klären.
- **Kein Routing-Wissen überschreiben:** Enricher sollen `#kontext` oder `#was` nicht umschreiben (ein Versuch dazu wurde zurückgenommen). Stattdessen ein eigenes Flag setzen und in den Katalog-Triggern auswerten (Muster `#srz.unwetter.aktiv-gebiet`).
- **Score-Muster:** Antworten setzen `#….score = N`, ein Enricher summiert mit `asNumericOrDefault(...)` und setzt z. B. `#kritisch = Ja/Nein`. Nicht gesetzte Scores zählen 0.

## Injection-Buttons (config/injection-buttons.json)

- `Condition` (Flee) steuert die Sichtbarkeit, `InjectionKnowledge` setzt Wissen beim Klick.
- Ein ausgelöster Button bleibt in der Timeline. Ein abgelehnter wird nicht erneut angeboten.

## Revision-Einstellungen, die Katalogverhalten beeinflussen

- `QuestionCatalogToStart: start`
- `UnknownAnswer`: Text „Unbekannt“, Wert `unbekannt`
- `Visualization.AgeGroup.AgeGroupIdentifier = #alter.agegroup`
- `Respiratory`: Grenzwerte der Atemanalyse, siehe nächster Abschnitt
- `ApiSearch.PreconfiguredSearchSettings`: feste Suchtreffer für Kürzel wie „VU“ und „PW“
- `DispositionLevelColors`, `ColorModeOverrides`
- `IntermediateDispositions`
- `Analyzers`: defibrillator, hazardous-material, eta, weather, storm-mode, fr-prealarm, gwr, motorway, railway. Analyzer setzen eigenes Wissen, siehe `scripts/external-knowledge.json`.

## Atemanalyse: Grenzwerte und CPR-Knopf

Die Frage „Atemanalyse …“ (`#atemfrequenz.messung`, Visualisierung `respiratory`) wertet die Frequenz **in der Oberfläche** aus, nicht in der Engine.

- **Grenzbereich für Massnahmen** je Altersgruppe, aus `revision-settings.json` → `Visualization.Respiratory`:
  1. Eintrag der Altersgruppe in `Thresholds` (`NewBorn`, `Baby`, `ChildTeenager`, `Adult`)
  2. sonst das globale `LowerThresholdValue`/`UpperThresholdValue`, das dann für **alle** Altersgruppen gilt
  3. sonst der eingebaute Standard: Säugling 23–62, Kleinkind 18–42, Kind/Jugend 13–32, Erwachsen 10–20
- **Unter der unteren Grenze** heisst der Absende-Knopf „Zu niedrig“. Zusätzlich erscheint „Unzureichende Atmung erkannt. CPR empfohlen.“.
  - Nur dieser Knopf setzt `KnowledgeToAddBeneathLowerThreshold` (`#atemfrequenz-lowerthreshold = Ja`).
  - Ein Enricher macht daraus `#audis.inj.cpr.trigger`. Es folgen Reanimationsanleitung und A Einsatz FR.
- **Stoppuhr:** Ohne Atemzug sinkt die laufende Frequenz, bis der CPR-Knopf erscheint.
  - Fehlt in `Thresholds` eine Altersgruppe, bleibt das für diese Gruppe aus. Beobachtet mit AUDIS 2.4.0, Snaps #1494 und #2288.
  - Deshalb immer alle vier Altersgruppen eintragen; `check-catalog.mjs` warnt.
- **Die Einstufung im Katalog ist davon getrennt.** `config/enricher-atemfrequenz*.json` stuft `#atemfrequenz` als `zu niedrig`, `normal` oder `zu hoch` ein. Daraus folgen Dispo und Zusammenfassung.
  - Die beiden Grenzen dürfen sich unterscheiden. Stand September 2026 bei Erwachsenen: Oberfläche unter 8, Katalog unter 10.
  - Eine Änderung an der einen wirkt nicht auf die andere.
- **Prüfen:** `ui-test.mjs` bedient die Frage echt, auch die Stoppuhr. `simulate.mjs` bildet den Grenzbereich nach, siehe [simulation.md](simulation.md).
