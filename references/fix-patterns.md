# Fix-Muster für Usersnaps im SRZ-Katalog

Abgeleitet aus rund 190 Snap-Fixes auf dem Branch `softaware` (Juni bis September 2026). Die meisten Snaps lassen sich mit einem der folgenden Muster lösen. Die Snap-Nummern verweisen auf Beispiel-Commits: `git log --all --grep "snap #2185"`.

## Symptom → typische Ursache

| Symptom im Snap | Typische Ursachen | Muster |
|---|---|---|
| Falsche Dispo-Stufe, falsches Szenario | Regel fehlt; Regel zu breit; höhere Regel greift mit; Kinder/Erwachsene nicht getrennt | 1, 2, 3 |
| Frage fehlt | Trigger greift nicht; Bedingung zu eng (Wert fehlt, z. B. `Unbekannt`); Identifier schon „beantwortet“ (Vorbelegung); `[ Wert ]` an falsche Frage gebunden | 4, 9, 13 |
| Frage kommt, obwohl unpassend | Bedingung fehlt; `!=` statt `!==`; nach Kontextwechsel bleiben alte Kataloge aktiv | 5, 6 |
| Falsche Reihenfolge | Es wird immer von oben nach unten gefragt | 7 |
| Zusammenfassung fehlt oder ist falsch | Pipe `| …` fehlt oder steht an der falschen Stelle | 8 |
| Stichwort im Einstieg nicht gefunden | Eintrag oder Synonym fehlt, Komma statt `;` | 10 |
| Text, Formulierung, Hinweis | Wording-Wunsch | 8, 11 |
| Handlungsanweisung fehlt oder falsch | HA nicht eingebunden, Trigger fehlt | 12 |
| „Kritisch“ oder Score falsch | Score fehlt in der Enricher-Summe, Antwort ohne Score | 14 |
| Regel greift nie | Wert oder Identifier falsch geschrieben (`VU` statt `Verkehrsunfall`) | 13 |
| CPR-Empfehlung bei der Atemanalyse zu früh, zu spät oder fehlend | Grenzwert in `revision-settings.json`, Altersgruppe fehlt in `Thresholds` | 15 |
| Unpassende Detailfragen bei bewusstloser Person | Fragen hängen nicht an „nicht weckbar“ | 16 |
| „Absprung zu …“, „in die Abfrage … weiterleiten“ | Antwort ohne Kontextwechsel | 17 |
| „Frage X vor Frage Y stellen“ | Reihenfolge über Kataloge hinweg | 18 |
| Antwort soll je nach Vorwissen anders gewertet werden | Wertung steckt in Antwortwissen und Regeln mehrerer Templates | 19 |
| „Problem besteht noch immer nach dem Update“ | Ein Kunden-RC hat die Datei auf einen alten Stand zurückgesetzt | 20 |
| Freigabe zur Disposition zu früh, kurz höhere Dispo | Enricher mit `isNull`-Bedingung auf das eigene Wissen (Flip-Flop), siehe [engine-semantics.md](engine-semantics.md) | 13 |

## Muster

### 1. Dispo-Stufe einer Regel korrigieren (#2185)

```
-@B-Einsatz
+@C-Einsatz
     #moegliche.ursache = Nein && #kritisch = Nein
```

Vorher prüfen, ob eine andere erfüllte Regel eine höhere Stufe liefert. Es gewinnt die höchste Priorität, siehe [catalog-map.md](catalog-map.md). Gegebenenfalls die höhere Regel mit einer Zusatzzeile ausschliessen (`#atmung.nfa != Ja`, `#insektenstich != Ja`).

### 2. Kinder und Erwachsene trennen (#2196, #2220, #2312)

```
 @A-EinsatzFR
+    #alter.agegroup = Erwachsen
     #atemfrequenz = zu hoch || #atemfrequenz = zu niedrig

+@A-Einsatz-Kind
+    #alter.agegroup !== Erwachsen
+    #atemfrequenz = zu hoch || #atemfrequenz = zu niedrig
```

- Kinder: `#alter.agegroup !== Erwachsen` (gesetzt und nicht erwachsen).
- Kinder-Codes: `A-Einsatz-Kind`, `A-Einsatz-Kind-FR`; B-Fälle bei Kindern meist `B-Einsatz-NBS`.
- Mit Feuerwehr: `-FW`-Varianten (`B-Einsatz-FW`, `B-Einsatz-NBS-FW`, `C-Einsatz-FW`), wenn z. B. `#trauma.vu.fw.benoetigt = Ja`.

### 3. (A oder B) und C in Szenarien (#1997, #2171)

`&&` bindet stärker als `||`. Deshalb nicht in eine Zeile schreiben, sondern auf Zeilen verteilen:

```
-@B-Einsatz
-    #trauma.vu.kinematik = tief && #trauma.vu.mehrere.verletzte = Ja
+@B-Einsatz
+    #trauma.vu.kinematik = tief || #trauma.vu.kinematik = Unbekannt
+    #trauma.vu.mehrere.verletzte = Ja
```

### 4. Fehlende Antwortwerte in Bedingungen ergänzen (#1997, #2171, #2204)

```
-        [ #trauma.vu.kinematik = tief ]
+        [ #trauma.vu.kinematik = tief || #trauma.vu.kinematik = Unbekannt ]
```

Zu jeder Bedingung klären: Was passiert bei „Unbekannt“ bzw. `unsicher`? Mit `!==` statt `!=` greift die Bedingung nicht, solange die Frage nicht beantwortet ist.

### 5. Folgefragen ausblenden, wenn die Person nicht atmet oder nicht reagiert (#1584)

Nach einem Kontextwechsel (z. B. zu Herzkreislaufstillstand) bleiben früher getriggerte Kataloge aktiv. Detailfragen deshalb an den Zustand binden:

```
+[ #atmung !== Nein && #reaktion !== keine ]
+
+    Welche Beschwerden hat die Person? -> #tauchunfall.beschwerden | *
+    …
```

Beim Einrücken ganzer Blöcke Bedingungen ohne Identifier (`[ 230V || Unbekannt ]`) auf explizite Identifier umstellen, denn ihre Bezugsfrage kann sich sonst ändern.

### 6. Selbstvorstellung oder Vermittlung unterdrücken (#563, #2234, #2322)

```
-        * Schwangerschaft
+        * Schwangerschaft; #vermittlung.unmoeglich = ja; #absprung = Schwangerschaft
…
+                [ #vermittlung.unmoeglich != ja ]
                     Können Sie sich **selbstständig** … vorstellen? -> #selbstaendig.aerztliche-hilfe-holen
```

`99-Vermittlung-und-PFS` prüft `#vermittlung.unmoeglich` bereits. Selbst geschriebene Selbstvorstellungsfragen brauchen die Bedingung zusätzlich.

### 7. Reihenfolge ändern (#2179)

Fragen werden von oben nach unten gestellt. Die Reihenfolge ändert man durch Verschieben des Blocks, inklusive Bedingungen und Einrückung.

### 8. Texte umformulieren, Wert behalten (#2109, #2254, #2281)

```
-        * Ebenerdig | ebenerdig gestürzt
+        * "Ebenerdig<br/><small>Sturz aus dem Stand, vom Stuhl, vom Bett usw.</small>" = Ebenerdig | ebenerdig gestürzt
```

- HTML und Erläuterungen immer in Anführungszeichen, mit `= Wert`.
- Ändert sich der Wert, alle Verwendungen suchen und anpassen: `git grep -n "#identifier"`.
- Zusammenfassung: `| Text` pro Antwort, `| *` übernimmt den Antworttext, `| Text` an der Frage gilt für alle Antworten (#2249).

### 9. Frage vorbelegen oder überspringen

Eine Frage entfällt, sobald ihr Identifier Wissen hat, z. B. `* Asthmaanfall […]; #atmung.vorerkrankung = Asthma` in `start.audis`. Umgekehrt: Taucht eine Frage nicht auf, prüfen, ob der Identifier schon vorbelegt ist. Die Suche nach `; #identifier =` oder das Debug-Widget in der AUDIS-Vorschau zeigen es.

### 10. Einstiegssuche (`start.audis`, `#was`) (#2241, #2295, #2330)

```
* Holzbeige raucht / brennt [ Totholz; Brennholz; Holzstapel; Brennholzstapel ]; #kontext = Brand 2; #srz.fallback.fw = Ja
```

- Synonyme **nur mit `;` trennen**. Kontrawörter `!Unfall` stehen als eigenes Synonym.
- Ein neuer Eintrag übernimmt die Vorbelegungen eines vergleichbaren Eintrags (`#abc`, `#deaktiviere.blutung`, `#fa.sofortiger.transport`, `#atemfrequenz.messung.freigabe-moeglich`, `#srz.fallback.med/fw`).
- Ein neues Stichwort mit eigenem Verlauf braucht einen passenden `#kontext`-Trigger oder einen neuen Katalog (#2295: `3-Interventionseinsatz` + Szenarien in `constants.json`).

### 11. Einheitliche Hinweistexte (#2282)

Schlusssatz jeder Handlungsanweisung: `"**Bei einer Situationsveränderung wählen Sie bitte erneut 144**<br>z.B. …"` (Feuerwehr: 118).

### 12. Neue Handlungsanweisung (#1135, #1443, #1220, #1430)

```
## Trigger ##
{ triggertype = final }
#was = Hyperthermie

## Fragen ##

Hilfsanweisungen Hyperthermie
{ visualization = instruction; icon = medkit }
    * "**Person in den Schatten oder einen kühlen Raum bringen**"
    * "**Bei einer Situationsveränderung wählen Sie bitte erneut 144**<br>z.B. …"
```

- Ablage in `Handlungsanweisungen/`. Eingebunden wird sie mit eigenem `final`-Trigger oder per `INKLUDIERE { Handlungsanweisungen/99-HA-… }` im passenden Zweig.
- Ohne Trigger und ohne Szenarien ist die Datei nur über das Include erreichbar – das ist in Ordnung.

### 13. Werte und Identifier konsistent halten (#2136, #2148, #2223, #1879)

- Szenario-Bedingung und Antwortwert müssen übereinstimmen (`#amok.dringlichkeit = A Einsatz`, nicht `A-Einsatz`).
- Nicht verschiedene Schreibweisen für dasselbe verwenden (`#trauma.verletzung = Verkehrsunfall`, nicht `VU`).
- Tippfehler in Identifiern in allen Verwendungen korrigieren (`#brand.persoen-an-bord` → `#brand.personen-an-bord`).
- Setzen mehrere Enricher denselben Identifier, überschreiben sie sich. Dann getrennte Flags verwenden (`#trauma.stich.koerperstamm = ja`).
- `scripts/check-catalog.mjs` findet solche Abweichungen.

### 14. Scores und Enricher (#2170, #2239, #2179)

- Neue Antwort in einer Score-Frage: Score-Wissen setzen (`; #hypothermie.keine.score = 1`) und in **beiden** Summen-Enrichern (`…Kritisch` und `…NichtKritisch`) ergänzen.
- „Nein“-Antworten zählen meist 0.
- Körperteile in Enrichern über `.simple` abfragen (`contains({#schmerzen.wo.simple}, "Oberarm", …)`), da Direktwerte „Oberarm links“ lauten.
- Enricher vergleichen Texte exakt, Groß-/Kleinschreibung beachten.

### 15. Grenzwerte der Atemanalyse (#1494, #2288)

- **Symptom:** „Bei 9/min wird bereits eine REA angeleitet“ (#1494). Die Oberfläche bot „CPR empfohlen“ an, der Klick führte zu Reanimation und A Einsatz FR.
- **Korrektur:** In `revision-settings.json` → `Visualization.Respiratory.Thresholds` den Wert der betroffenen Altersgruppe ändern. #1494 senkte die untere Grenze für Erwachsene von 10 auf 6; SRZ setzte sie später in einem Release Candidate auf 8.
- **Immer alle vier Altersgruppen eintragen** (`NewBorn`, `Baby`, `ChildTeenager`, `Adult`), sonst erkennt die Stoppuhr bei den fehlenden Gruppen keinen Atemstillstand (#2288).
- **Nur die Oberfläche ändern, wenn nur sie gemeldet ist.** Die Einstufung `#atemfrequenz` in `config/enricher-atemfrequenz*.json` bestimmt die Dispo. Sie mitzuändern, stuft Einsätze herab; das ist eine fachliche Entscheidung von SRZ und gehört als Option in die Ticket-Notiz.
- **Zahl ohne Vorgabe** („deutlich herunterstufen“): begründeten Vorschlag machen und als offene Frage kennzeichnen.
- **Prüfen:** `ui-test.mjs` mit `{ "atemfrequenz": 9 }` und `erwartet.cprKnopf`, Gegenproben für eine andere Altersgruppe und mit Stoppuhr, siehe [ui-test.md](ui-test.md).

### 16. Bewusstlose Person: Anleitung statt Detailfragen (#1880, #1868)

```
// Usersnap #1880: bewusstlose Person kann keine Angaben zu den Schmerzen machen
[ #reaktion.weckbar = Nein && #atmung != Nein && #atemfrequenz != zu niedrig ]
    INKLUDIERE { Handlungsanweisungen/99-HA-Seitenlage }

    => ABSCHLUSS
```

- AUDIS stellt die Anleitung zuerst und beendet die Abfrage danach (verifiziert).
- **Mit `=> ABSCHLUSS` immer den CPR-Ablauf ausnehmen:** keine Atmung oder zu tiefe Atemfrequenz.
- **Ohne Abschluss** (#1868): die Detailfrage mit `[ #reaktion.weckbar != Nein ]` umschliessen und die Anleitung einbinden, wie `3-Bewusstsein` es bei „nicht weckbar“ tut. Kataloge, die an der entfallenen Antwort hängen (z. B. `4-FAST` an der Hauptbeschwerde), entfallen mit.

### 17. Absprung in einen anderen Ablauf per Antwort (#2357, #2406)

```
* Oberbauchschmerzen; #kontext = Schmerzen; #schmerzen.wo = Abdomen
```

- **Vorbelegung:** die des passenden Einstiegs in `start.audis` übernehmen, hier „Bauchschmerzen“.
- **Schon Erfragtes** (ABC) bleibt als Wissen erhalten und wird nicht erneut gefragt.
- **Der bisherige Katalog** verliert seinen Trigger: Seine restlichen Fragen und Szenarien entfallen. Die Zusammenfassung der bereits beantworteten Fragen blieb erhalten (#2357, AUDIS 2.4.0).
- **Widersprüche** in derselben Antwort mitkorrigieren, z. B. `#atmung = normal`, wenn der Einstieg „auffällig“ vorbelegt hat, die Antwort aber „keine Atemnot“ lautet (#2406).

### 18. Frage vorziehen (#2355)

- **So:** Dieselbe Frage mit demselben Identifier an der früheren Stelle unter passender Bedingung einfügen. Die spätere Kopie gilt dann als beantwortet. Dazu den Kommentar „Gleiche Frage wie in …, Antworten synchron halten“.
- **Nicht so:** Die Frage in ein Template auslagern und an beiden Stellen einbinden.
  - Bedingungen ohne Identifier in der Ursprungsdatei binden danach an eine andere Frage, siehe [grammar.md](grammar.md).
  - Bei #2355 hätte das `[ Rauch/Dampf ]` in `3-Intoxikation` umgebunden. Bei Gas/Rauch wäre dann A statt B mit FW herausgekommen.
  - `check-catalog.mjs` warnt vor solchen Verschiebungen.

### 19. Antworten je nach Vorwissen anders werten (#2355)

- **Zwei Varianten** derselben Frage mit gleichem Identifier unter sich ausschliessenden Bedingungen anlegen. Beispiel: bei Alkohol oder Drogen neutrale Antworten, ohne `-` und ohne `#vermittlung.unmoeglich`.
- **Alle Regeln anpassen:** Die gespeicherten Werte bleiben gleich, Regeln auf diese Werte greifen also weiter. Deshalb den Ausschluss in **allen** Regeln ergänzen: `git grep -n "#auffaellige.reaktion"` findet B in `99-Template-Reaktion` und B-NBS in `99-Template-Atemanalyse`.
- **Reihenfolge:** Das Vorwissen muss vor der Frage bekannt sein, sonst zuerst Muster 18 anwenden.

### 20. Vom Kunden-RC zurückgesetzte Datei wiederherstellen (#2219)

```
node <skill>/scripts/check-catalog.mjs --alle --rueckfaelle     # Datei und rückgängig gemachte Commits
git restore --source=<rc-commit>^ -- <datei>                    # Stand vor dem RC
```

- **Nur ohne Rückfrage,** wenn der Rückfall offensichtlich ungewollt ist, etwa weil der Katalog die Identifier der neueren Fassung erwartet. Sonst nachfragen.
- **In der Übergabe:** alle mitbetroffenen Snaps nennen, bei #2219 waren das #2230, #2210, #1879 und #2179.
- **Nebenwirkungen:** mit Gegenproben belegen, z. B. „Stich Brust wieder A Einsatz“.

## Anti-Muster (so nicht)

- **Frage in ein Template auslagern, um sie an zwei Stellen zu nutzen:** Die Bindung von `[ Wert ]` in der Ursprungsdatei verschiebt sich (Muster 18).
- **Enricher, dessen Bedingung `isNull({#x})` prüft und der `#x` selbst setzt:** Ab AUDIS 2.4.0 entfernt `AutoUnenrich` das Wissen im nächsten Schritt wieder (Flip-Flop, #2406).

- **Enricher, die `#kontext` oder `#was` überschreiben** (automatischer Kontextwechsel): nach Review zurückgenommen (#2225–#2228). Besser ein eigenes Flag setzen und Trigger darauf aufbauen.
- **Ausschluss in den Trigger statt in die Fragen:** Der Trigger gilt auch für die Szenarien des Katalogs. Soll nur das Fragen verhindert werden, die Bedingung um die Fragen legen (4-Trauma-VU, #2058).
- **`[ Ja ]` auf gleicher Einrückung wie die Frage:** bindet an eine falsche Frage, siehe [grammar.md](grammar.md).
- **Kommentarzeile mitten in einem Trigger-Block:** teilt den Block (ODER statt UND).
- **Typografische Zeichen** (`„“ ’ – … °`) oder HTML ausserhalb von Anführungszeichen.
- **Zusatzwissen `; #id = …` ohne Prüfung,** ob damit eine spätere Frage `-> #id` wegfällt.
- **Aufräumen nebenbei** (fremde Umformatierungen, Reihenfolgen, Kommentare): Das erschwert Review und Rück-Merge.
- **Fachliche Folgen mitändern, die der Snap nicht verlangt**, etwa Dispo-Stufen über angepasste Grenzwerte oder Enricher. Solche Änderungen als Option in die Ticket-Notiz schreiben.
- **Versionsstring ändern** (`9-Konfiguration.audis`, „Aktuelle Version“).

## Checkliste vor der Übergabe

- [ ] Snap-Verhalten verstanden und die Ursache im Katalog benannt
- [ ] Minimal geändert; keine fremden Stellen angefasst
- [ ] Werte und Identifier stimmen mit den setzenden Antworten bzw. Enrichern überein
- [ ] `&&`/`||`-Priorität und Einrückung geprüft
- [ ] Bei Templates und Includes: alle einbindenden Kataloge bedacht
- [ ] Fragen verschoben oder entfernt: `check-catalog.mjs` meldet keine verschobene Bindung; eine Gegenprobe führt durch die übrigen Zweige der geänderten Datei
- [ ] Szenario-Änderungen gegen Dispo-Prioritäten geprüft, bei Bedarf Kinder- und FW-Varianten
- [ ] `node <skill>/scripts/check-catalog.mjs` meldet „Keine neuen Befunde“ (oder begründet)
- [ ] `node <skill>/scripts/simulate.mjs <pfad.json>`: Der Snap-Pfad scheitert vorher und besteht nachher. Die Unterschiede enthalten nur das Verlangte, die Gegenprobe zeigt keine Unterschiede.
- [ ] `node <skill>/scripts/ui-test.mjs <pfad.json>`: Screenshots `vorher-…`/`nachher-…` in `usersnaps/<nr>/` angesehen, sie zeigen das gemeldete bzw. korrigierte Verhalten
- [ ] Bei Verdacht auf Softwarefehler: Versionsvergleich gemacht, Katalog nicht als Workaround geändert
- [ ] Testpfad für die Abnahme notiert (aus der Pfaddatei)
