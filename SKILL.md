---
name: audis-srz-usersnap
description: "Usersnap-Feedback (Snaps) in den AUDIS-Fragenkatalog der Schutz & Rettung Zürich (SRZ, Repository audis-srz) einarbeiten: reproduzieren, Software- von Katalogfehlern unterscheiden, minimal korrigieren, mit Prüfskript, Engine-Simulation und UI-Test verifizieren, Commit-Vorschlag und Ticket-Notiz übergeben. Verwenden bei „Snap #2410 einarbeiten“, „Usersnap fixen“ oder Snaps vom Intensivtag, bei falschen Szenarien oder Dispo-Stufen, fehlenden, falschen oder überflüssigen Fragen und Anweisungen, vorausgewählten Antworten, Synonymen der Einstiegssuche und anderen Korrekturen am SRZ-Katalog."
---

# Usersnaps im SRZ-Katalog einarbeiten

Der SRZ-Katalog steuert die Notrufabfrage in AUDIS. Snaps werden auf dem Branch `softaware` behoben und nach der Abnahme durch SRZ nach `release` übernommen. Jede Änderung wirkt auf Rettungseinsätze: **klein, nachvollziehbar, geprüft – und fachlich Unklares nicht raten.**

**Werkzeuge** im Ordner `scripts/` dieses Skills (`<skill-ordner>`), Aufruf im Wurzelverzeichnis des Katalog-Repos:
- `check-catalog.mjs`: statische Prüfung
- `simulate.mjs`: Engine über die API
- `ui-test.mjs`: echte Oberfläche mit Screenshots
- `audis-versionen.mjs`: AUDIS-Versionen wie in der AUDIS-Erweiterung

Optionen und Server-Auswahl: [references/skripte.md](references/skripte.md).

## Leitplanken

- **Nicht committen, nicht pushen.** Nur auf `softaware` arbeiten, auf Wunsch auf einem lokalen Arbeitsbranch davon. Änderungen bleiben im Arbeitsverzeichnis, der Nutzer prüft und committet selbst.
- **`Aktuelle Version`** in `questioncatalog/9-Konfiguration.audis` nie ändern, sie pflegt der Kunde.
- **Minimal ändern:** nur, was der Snap verlangt. Kein Umformatieren oder Aufräumen nebenbei.
- **Fachliche Entscheidungen trifft SRZ:** Dispo-Stufen, medizinische Inhalte, Anweisungen an Anrufende, neue Szenarien bzw. externe Codes. Bei Unklarheit vorher nachfragen. Oder die wörtlich verlangte Variante umsetzen und die Frage in der Ticket-Notiz festhalten.
  - Fehlt ein konkreter Wert („deutlich herunterstufen“): begründeten Vorschlag machen, als offene Frage kennzeichnen.
  - Weitergehende fachliche Folgen, etwa andere Dispo-Stufen, nur vorschlagen, nicht umsetzen.
- **Softwarefehler nicht im Katalog umgehen.** Liegt die Ursache in AUDIS, wird sie per Software-Update behoben. Katalog-Workarounds nur auf ausdrücklichen Wunsch.
- **`softawaregmbh/softaware-audis-issues` nur lesen,** dort hat auch der Kunde Zugriff.
- **Enricher** überschreiben kein Routing-Wissen (`#kontext`, `#was`); dafür eigene Flags und Trigger verwenden.
- **Syntax nach [references/grammar.md](references/grammar.md),** nicht nach Gedächtnis. Keine typografischen Zeichen (`„“ ’ – …`), HTML nur in `"…"`.
- **Nichts als verifiziert melden,** was die Skripte nicht bestätigt haben.

## Eingaben

- **Snap:** Nummer, Beschreibung, Screenshot mit Timeline, interne Notizen, Duplikate. Die URL zeigt die Umgebung, also Katalogstand und AUDIS-Version, z. B. `demo.audis.at/srz/release` oder `/softaware`.
  - **Simulation und UI-Test immer mit `--version <Snap-URL>`**, damit dieselbe AUDIS-Version läuft wie beim Melder.
- **`knowledgeStash`:** der Zustand beim Melden (Wissen samt Herkunft, aktuelle Frage, aktive Szenarien) aus den Custom Data des Snaps.
  - Die Kopie im internen Ticket ist meist gekürzt. Dann den Nutzer um die vollständigen Custom Data bitten.
  - Das Debug-Widget „Local Development“ der Vorschau zeigt, speichert und lädt ihn.
- **Fehlt etwas Entscheidendes,** z. B. Pfad oder erwartetes Verhalten, gezielt nachfragen.
- **Mehrere Snaps** nacheinander bearbeiten, je ein Commit; den nächsten erst nach dem Commit des Nutzers. Sollen alle gesammelt uncommittet bleiben: Stapel-Ablauf in [references/workflow.md](references/workflow.md).

## Ablauf

### 1. Ausgangslage sichern

```
git fetch origin
git switch softaware
git pull --ff-only
git status
git log --oneline origin/softaware..origin/release
```

- **Nicht sauber:** stoppen und den Nutzer fragen.
- **`origin/release` fehlt**, z. B. in einem Klon ohne GitHub-Remote: `git remote -v` prüfen und den Nutzer fragen. Den Abgleich nicht stillschweigend überspringen.
- **`release` hat Commits, die in `softaware` fehlen** (Kunden-RCs):
  - Auf den ausstehenden Rück-Merge („Release mergen“) hinweisen. Ohne Auftrag nicht selbst mergen.
  - Die Kunden-Änderungen prüfen und neue Befunde melden, denn RCs haben schon Dateien auf alte Stände zurückgesetzt:
    `node <skill-ordner>/scripts/check-catalog.mjs --stand origin/release --base $(git merge-base origin/softaware origin/release)`

### 2. Snap verstehen

- **Symptom und Anforderung trennen:** Das gewünschte Verhalten steht oft erst in den Notizen.
- **Pfad rekonstruieren:** Einstieg (`#was`), Antworten der Timeline, Altersgruppe, Kontext, URL-Parameter (werden zu Wissen).
- **Art bestimmen:**
  - **Logik:** Fragen, Dispo, Wissen, Zusammenfassung
  - **Anzeige:** Vorauswahl, Zurückspringen, Darstellung
  - Bei Anzeigeproblemen oder „seit dem letzten Update“ zuerst [references/software-oder-katalog.md](references/software-oder-katalog.md) lesen.
- **Schon erledigt?** `git log --oneline -10 origin/softaware -- <datei>`, ebenso für `origin/release`. Überholte Snaps melden statt erneut ändern. Wirkt ein früherer Fix nicht mehr, hat vielleicht ein Kunden-RC die Datei zurückgesetzt: `check-catalog.mjs --alle --rueckfaelle`.
- **Alter Snap?** Der Katalog kann seither umgebaut sein. Die Frage-ID aus den Custom Data (z. B. `2-ABC:83`) zeigt den damaligen Stand: `git log -S` bzw. `git show <commit>:<datei>`.
- **Interne Tickets:** `gh issue list -R softawaregmbh/softaware-audis-issues --search "<Stichwort>"`. Weitergeleitete Snaps heißen „[USERSNAP] …“ und enthalten oft schon eine Analyse der Entwicklung.

### 3. Stelle im Katalog finden

Orientierung: [references/catalog-map.md](references/catalog-map.md).

```
git grep -n "Textfragment aus dem Screenshot" -- questioncatalog
git grep -n -- "-> #identifier" -- questioncatalog
git grep -n "#identifier" -- questioncatalog config
```

- **Szenarien:** Regeln unter `## Szenarien ##` der beteiligten und eingebundenen Kataloge, Dispo-Prioritäten in `constants.json`.
- **Abgeleitetes Wissen** (`#kritisch`, `#atemfrequenz`, Gebiete, Unwetter, `#vermittlung.unmoeglich`): `config/enricher-*.json`.
- **Logik der Oberfläche** (Alter, Atemanalyse mit CPR-Knopf): `revision-settings.json` → `Visualization`, siehe [references/engine-semantics.md](references/engine-semantics.md).

### 4. Reproduzieren und Ursache nachvollziehen

- **Pfaddatei** nach [assets/pfad-vorlage.json](assets/pfad-vorlage.json) als `usersnaps/<nr>/snap-<nr>.json` im Katalog-Repo anlegen.
  - Inhalt: Einstieg, Antworten der Timeline, URL-Parameter wie `p`, dazu `erwartet` für das gewünschte Verhalten.
  - Optional `"stash"` (Start im Zustand des Melders) und `"umantworten"` (nur UI-Test).
- **Logik:** `node <skill-ordner>/scripts/simulate.mjs usersnaps/<nr>/snap-<nr>.json --ohne-vergleich --wissen --version <Snap-URL>` ([references/simulation.md](references/simulation.md))
  - Fehlt eine Antwort, nennt das Skript die nächste Frage mit ihren Möglichkeiten. Den Pfad ergänzen, bis das gemeldete Verhalten sichtbar ist.
  - `--wissen` zeigt das Wissen pro Schritt mit Herkunft, wie das Debug-Widget.
- **Anzeige:** `node <skill-ordner>/scripts/ui-test.mjs usersnaps/<nr>/snap-<nr>.json --ohne-vergleich --wissen --version <Snap-URL>` ([references/ui-test.md](references/ui-test.md))
- **Reproduziert** ist der Snap erst, wenn die Erwartungen auf dem ungeänderten Stand scheitern.
- **Ursache** mit [references/engine-semantics.md](references/engine-semantics.md) nachvollziehen und in ein bis zwei Sätzen festhalten: Welche Antworten und Enricher setzen welches Wissen, welche Trigger greifen, welches Szenario gewinnt?
- **Häufige Fallen:**
  - Fragen mit vorhandenem Wissen entfallen.
  - Szenario-Regeln erben die Trigger ihres Katalogs, bei Includes die des einbindenden Katalogs.
  - `[ Wert ]` ohne Identifier bindet an die letzte Frage mit **kleinerer** Einrückung derselben Datei; Fragen aus `INKLUDIERE` zählen nicht.
  - `&&` bindet stärker als `||`.
  - `!=` ist auch bei fehlendem Wissen erfüllt.
- **Nicht reproduzierbar?** Nachfragen statt raten. Mögliche Gründe: anderer Pfad, Stand `release`, andere AUDIS-Version, nicht nachgebildete Oberflächenfunktionen ([references/ui-test.md](references/ui-test.md)).

### 5. Software oder Katalog?

Bei Anzeigefehlern, „seit dem letzten Update“ oder wenn nur der UI-Test den Fehler zeigt: denselben Katalog in der Vorversion und der aktuellen AUDIS-Version durchspielen. Versionen listet `audis-versionen.mjs tags`.

```
node <skill-ordner>/scripts/ui-test.mjs usersnaps/<nr>/snap-<nr>.json --stand HEAD --ohne-vergleich --version <vorversion> --version <aktuell> --wissen
```

- **Vorversion richtig:** Das ist eine Regression in AUDIS, **keine Katalogänderung.** Ursache und Codestelle eingrenzen und mit Versions-Screenshots übergeben.
- **Beide gleich:** Das Update ist nicht der Auslöser. Liegt die Ursache trotzdem in AUDIS, ebenfalls übergeben. Sonst weiter mit Schritt 6.
- **Nur echte Builds entscheiden,** nicht Code-Diffs: „Version X ist nicht betroffen“ aus einem Diff hat bei #2383 in die Irre geführt.
- **Details, Hotfixes, Beispiel #2383:** [references/software-oder-katalog.md](references/software-oder-katalog.md).

### 6. Korrigieren

- **Muster** aus [references/fix-patterns.md](references/fix-patterns.md) wählen. Einrückung mit Leerzeichen, im Stil der Umgebung.
- **Umformulierte Antworten:** Wert mit `= AlterWert` stabil halten.
- **Geänderte Werte oder Identifier:** alle Verwendungen anpassen.
- **Templates** wirken in allen einbindenden Katalogen.
- **Kommentare** nur für Nichtoffensichtliches, z. B. `// Usersnap #2203: auch bei Sprachstörungen stellen`.

### 7. Prüfen und verifizieren

Verifiziert ist ein Fix erst, wenn **alle drei** Prüfungen bestehen:

1. **Statisch:** `node <skill-ordner>/scripts/check-catalog.mjs` meldet „Keine neuen Befunde“.
   - Das Skript vergleicht mit `HEAD`. Jeden neuen Befund beheben oder begründen. Wissen aus einem Analyzer gehört z. B. in `scripts/external-knowledge.json`.
   - Die gemeldeten Include-Stellen mitprüfen, bei Bedarf mit eigenem Pfad.
   - `git diff` gegenlesen: Einrückung, Operatoren, Werte, Tippfehler.
2. **Engine:** `node <skill-ordner>/scripts/simulate.mjs usersnaps/<nr>/snap-<nr>.json usersnaps/<nr>/gegenprobe.json --version <Snap-URL>`
   - Vorher (`HEAD`) gegen nachher: alle Prüfungen `[ok]`, keine Parserfehler.
   - Die Unterschiede enthalten nur das Verlangte. Nebenwirkungen auf Dispo, Szenarien oder Zusammenfassung benennen und in der Ticket-Notiz festhalten.
   - Mindestens eine Gegenprobe ohne Unterschiede, z. B. ein ähnlicher Einstieg, eine andere Altersgruppe oder ein einbindender Katalog.
3. **Oberfläche:** `node <skill-ordner>/scripts/ui-test.mjs usersnaps/<nr>/snap-<nr>.json --version <Snap-URL>`
   - Das Skript legt `vorher-…`- und `nachher-…`-Screenshots in `usersnaps/<nr>/` ab. Die Fragen dafür über `"screenshots"` wählen.
   - Die Screenshots ansehen: Zeigen sie das gemeldete bzw. korrigierte Verhalten?
   - Kann das Skript eine Frage nicht bedienen (z. B. Körperdiagramm): Variante `snap-<nr>-ui.json`, die davor endet. Sonst in der Übergabe nennen, was nur per Engine verifiziert ist.

**Kein AUDIS-Server verfügbar:** den Fix nicht als verifiziert melden. Den Nutzer bitten, einmal „AUDIS Web UI starten“ in der AUDIS-Erweiterung auszuführen oder den Lizenzschlüssel zu hinterlegen ([references/skripte.md](references/skripte.md)).

### 8. Commit vorbereiten

Dem Nutzer vorschlagen, **nicht ausführen:**

```
git add <geänderte Katalogdateien> usersnaps/<nr>
git commit -m "fix: snap #NNNN"
```

- **Varianten:** mehrere Snaps `fix: snap #1135 #1136`, Unfertiges `fix(WIP): snap #NNNN`. Die Nachricht ist nur diese eine Zeile ([references/workflow.md](references/workflow.md)).
- **Softwarefehler ohne Katalogänderung:** Ob die Analyse committet wird, entscheidet der Nutzer (Vorschlag `chore: snap #NNNN Analyse`).
- **Kunden-Repository:** `usersnaps/<nr>/` gelangt über `release` zum Kunden, also keine internen Details hineinlegen.

### 9. Übergabe

1. **Ursache** (kurz). Bei Softwarefehlern mit Versionsvergleich und Codestelle.
2. **Änderung:** Dateien und fachliche Wirkung. Bei Softwarefehlern: keine Katalogänderung, Software-Update empfohlen.
3. **Verifikation:** Ergebnisse der drei Prüfungen inkl. Gegenproben, Unterschiede vorher → nachher, Liste der Screenshots
4. **Commit-Vorschlag** (nicht committet)
5. **Ticket-Notiz** nach [assets/ticket-note-template.md](assets/ticket-note-template.md), Variante Katalogänderung oder Softwarefehler, mit Testpfad aus der Pfaddatei.
   - Optional ein Stash für Tester (`simulate.mjs --stash-speichern`). Sie importieren ihn im Debug-Widget.
6. **Offene Punkte,** z. B. Rück-Merge oder Rückfrage an SRZ

## Referenzen

| Datei | Wann lesen |
|---|---|
| [references/grammar.md](references/grammar.md) | vor jeder Änderung an `.audis`-Dateien |
| [references/engine-semantics.md](references/engine-semantics.md) | Trigger, Szenarien, Enricher, Herkunft des Wissens |
| [references/catalog-map.md](references/catalog-map.md) | Orientierung: Einstieg, Identifier, Templates, Enricher, Dispo-Prioritäten |
| [references/fix-patterns.md](references/fix-patterns.md) | Korrektur wählen, Checkliste vor der Übergabe |
| [references/workflow.md](references/workflow.md) | Branches, Kunden-RCs, Usersnap-Ablauf, Debug-Widget, Commits |
| [references/simulation.md](references/simulation.md) | Engine-Simulation, Pfaddateien, Erwartungen |
| [references/ui-test.md](references/ui-test.md) | UI-Test, Screenshots, Knowledge Stash, AUDIS-Versionen, Grenzen |
| [references/software-oder-katalog.md](references/software-oder-katalog.md) | Software- oder Katalogfehler, Hotfixes, Beispiel #2383 |
| [references/skripte.md](references/skripte.md) | alle Skripte und Optionen, Server-Auswahl |
| [assets/pfad-vorlage.json](assets/pfad-vorlage.json) | Vorlage für eine Pfaddatei |
| [assets/ticket-note-template.md](assets/ticket-note-template.md) | Ticket-Notiz für die Übergabe |
