# audis-srz-usersnap

Agent-Skill zum Einarbeiten von Usersnap-Feedback in den AUDIS-Fragenkatalog der Schutz & Rettung Zürich (Repository `audis-srz`, Branch `softaware`).

Der Skill folgt dem offenen [Agent-Skills-Format](https://agentskills.io/specification): ein Ordner mit `SKILL.md`, Referenzen und Skripten. Er funktioniert mit allen Coding-Agenten, die dieses Format unterstützen, z. B. Claude Code, GitHub Copilot in VS Code und Cursor.

**Nur intern verwenden:** Der Skill enthält das Katalog-Passwort (`#p`) und Verweise auf interne Repositorys.

## Inhalt

```
audis-srz-usersnap/
├── SKILL.md                         Ablauf und Leitplanken
├── references/
│   ├── grammar.md                   AUDIS-Grammatik (nach Parser, inkl. Abweichungen zur Doku)
│   ├── engine-semantics.md          Verhalten von Triggern, Szenarien, Enrichern
│   ├── catalog-map.md               Aufbau des SRZ-Katalogs
│   ├── fix-patterns.md              Typische Korrekturen, Anti-Muster, Checkliste
│   ├── simulation.md                Engine-Simulation, Pfaddateien, Erwartungen
│   ├── ui-test.md                   UI-Test mit Screenshots, AUDIS-Versionen
│   ├── software-oder-katalog.md     Komplexe Snaps einordnen (Beispiel #2383)
│   ├── skripte.md                   Alle Skripte und Optionen, Server-Auswahl
│   └── workflow.md                  Branches, Usersnap-Ablauf, Commits
├── assets/
│   ├── pfad-vorlage.json            Vorlage für eine Pfaddatei (Simulation und UI-Test)
│   └── ticket-note-template.md      Vorlage für die Usersnap-Notiz
└── scripts/
    ├── check-catalog.mjs            Statische Prüfung des Katalogs
    ├── simulate.mjs                 Pfad über die AUDIS-API durchspielen, vorher/nachher
    ├── ui-test.mjs                  Pfad in der echten Oberfläche, Screenshots nach usersnaps/<nr>/
    ├── audis-versionen.mjs          AUDIS-Versionen anzeigen und laden (wie die Erweiterung)
    ├── lib/audis.mjs                Gemeinsame Bausteine der Skripte
    └── external-knowledge.json      Extern gesetztes Wissen (Analyzer, AUDIS, ELS)
```

## Installation

Dieses Repository ist der Skill-Ordner. Es wird in ein Skill-Verzeichnis des Agenten geklont. Der Zielordner muss `audis-srz-usersnap` heißen, wie `name` in `SKILL.md`.

| Agent | Nur im Katalog-Repo (empfohlen) | Für alle Projekte |
|---|---|---|
| Copilot (VS Code), Cursor | `<repo>/.agents/skills/audis-srz-usersnap/` | `~/.agents/skills/audis-srz-usersnap/` |
| Claude Code | `<repo>/.claude/skills/audis-srz-usersnap/` | `~/.claude/skills/audis-srz-usersnap/` |

- **Im Katalog-Repo** belegt die Beschreibung nur dort Kontext. Den Skill-Ordner in `.git/info/exclude` eintragen, sonst landet er über `release` beim Kunden.
- **Alternativen:** Copilot liest auch `.github/skills`, Cursor `.cursor/skills`. Im Katalog-Repo ebenfalls ausschließen.

Beispiel unter Windows in der Eingabeaufforderung (`cmd`), im Wurzelverzeichnis des Katalog-Repos. Für Claude Code `.claude` statt `.agents` verwenden:

```
git clone https://github.com/softawaregmbh/intern-audis-srz-usersnap-skill.git .agents\skills\audis-srz-usersnap
echo /.agents/>> .git\info\exclude
```

- **Aktualisieren:** `git -C .agents\skills\audis-srz-usersnap pull`
- **`git clean -xfd`** im Katalog-Repo lässt den Klon stehen, weil er ein eigenes Repository ist (geprüft mit Git für Windows 2.53).
- **Mehrere Klone des Katalog-Repos oder mehrere Agenten:** den Skill einmal klonen und jeweils per Verknüpfung einbinden, z. B. `mklink /J ".agents\skills\audis-srz-usersnap" "C:\Pfad\zu\intern-audis-srz-usersnap-skill"`. `git clean -xfd` entfernt dann nur die Verknüpfung.

## Voraussetzungen

- `git`
- **Node.js:** ab Version 18 für die Skripte, ab 22 für `scripts/ui-test.mjs`
- **Browser:** Edge oder Chrome für `scripts/ui-test.mjs`; läuft headless und wird automatisch gefunden.
- **AUDIS-Server:**
  - Die Skripte laden die AUDIS-Version der Snap-Umgebung genauso wie die AUDIS-VS-Code-Erweiterung („AUDIS Editor“): `--version <Snap-URL>`, z. B. `--version https://demo.audis.at/srz/release`, oder `--version <v>` bzw. `audis-versionen.mjs laden <v>`.
  - Dafür brauchen sie den Lizenzschlüssel aus den VS-Code-Einstellungen (`audis.licenseKey`, dort legt ihn die Erweiterung ab) oder aus `AUDIS_LICENSE_KEY`.
  - Ohne `--version` nehmen sie die neueste lokale Version: den Server der Erweiterung (kommt mit dem ersten „AUDIS Web UI starten“) oder eine schon geladene Version. Die Vorschau der Erweiterung kann deshalb mit einer anderen Version laufen als die Skripte.
  - Alternativ: `--audis <Pfad zu Audis.Web.exe>`, die Umgebungsvariable `AUDIS_WEB` oder `--server <url>` für die laufende Vorschau.
  - Geladene Versionen (je rund 250 MB) liegen unter `%LOCALAPPDATA%\audis-srz-usersnap\audis-versionen\` und werden wiederverwendet.
- **`gh`** (GitHub CLI), optional, um interne Tickets zu lesen

## Ablage im Katalog-Repo

Pro Snap legt der Skill den Ordner `usersnaps/<nr>/` im Katalog-Repo an. Darin liegen:
- die Pfaddateien `snap-<nr>[-variante].json` (Test zum Nachspielen)
- die Screenshots des UI-Tests (`vorher-…`, `nachher-…`, bei Versionsvergleichen `audis-<version>-…`)
- bei Bedarf ein Knowledge Stash, den Tester im Debug-Widget der Vorschau importieren können

Umgang mit dem Ordner:
- **Katalog-Fix:** Er gehört in den Commit des Fixes, damit Review und Abnahme altes und neues Verhalten sehen.
- **Softwarefehler ohne Katalogänderung:** Der Nutzer entscheidet, ob die Analyse committet wird (Vorschlag `chore: snap #NNNN Analyse`).
- **Sichtbarkeit:** Der Ordner gelangt über `release` zum Kunden, also keine internen Details hineinlegen.
- **AUDIS** lädt ihn nicht.

## Grenzen

- **UI-Test:**
  - **Bedient:** Auswahl (auch mit zweiter Textzeile), Mehrfachauswahl, Unbekannt, Eingabefelder (auch beschriftete), Zahlenfelder, Alter, Atemanalyse (Frequenz, CPR-Knopf, Stoppuhr), Einstiegssuche (auch Titel mit „/“), Anleitungen mit ihren drei Knöpfen, Zurückspringen über die Timeline (auch mit neuer Antwort) und den Start aus einem Knowledge Stash über das Debug-Widget.
  - **Nicht bedient:** andere Spezial-Visualisierungen (Ort, Datum, Körper …), Injection-Buttons und manuelle Zwischendispositionen. Diese prüft der Skill über die API-Simulation mit vorgegebenem Wissen, den Klicktest macht dann SRZ.
  - **Pfadfehler** beenden nur den betroffenen Pfad, die übrigen laufen weiter.
- **Snap-Daten:** Den vollständigen `knowledgeStash` eines Snaps gibt es nur in Usersnap (Custom Data), die Kopie im internen Ticket ist gekürzt. Der Skill bittet dann darum.
- **Fachliche Entscheidungen** (Dispo-Stufen, medizinische Inhalte) trifft SRZ, der Skill fragt nach.
- **Softwarefehler in AUDIS** kann der Skill nachweisen, eingrenzen und mit Versionsvergleich belegen, aber nicht im Katalog-Repo beheben.
- **Git:** Der Skill committet und pusht nie; das macht der Nutzer.

## Verwendung

Im Chat des Agenten, im geöffneten `audis-srz`-Repo:

- „Arbeite Snap #2410 ein: *Beschreibung aus Usersnap*“
- „Hier sind die Snaps vom Intensivtag: …“
- „Warum kommt bei Sturz ohne Atmung noch die Frage nach dem Verletzungsort?“

Das Prüfskript lässt sich auch direkt nutzen (im Wurzelverzeichnis des Repos):

```
node <skill-ordner>/scripts/check-catalog.mjs                          # neue Befunde der aktuellen Änderungen (ggü. HEAD)
node <skill-ordner>/scripts/check-catalog.mjs --base origin/softaware  # neue Befunde inkl. eigener, noch nicht gepushter Commits

# Kunden-Änderungen auf release prüfen, die noch nicht in softaware sind
node <skill-ordner>/scripts/check-catalog.mjs --stand origin/release --base $(git merge-base origin/softaware origin/release)

node <skill-ordner>/scripts/check-catalog.mjs --alle                   # alle Befunde des gesamten Katalogs (Analyse)
node <skill-ordner>/scripts/check-catalog.mjs --alle --rueckfaelle     # Dateien, die ein späterer Commit auf einen alten Stand zurückgesetzt hat
```

Der committete Katalog gilt als Ausgangsbasis. Ohne `--alle` meldet das Skript nur, was eine Änderung neu verursacht. Dazu gehören auch unveränderte Bedingungen ohne Identifier, deren Bezugsfrage sich verschoben hat. Geänderte Dateien, die wieder einem älteren Stand entsprechen, zeigt es als Hinweis. Exit-Code 0 bedeutet keine neuen Befunde.

Die Simulation spielt einen Pfad aus einer Pfaddatei mit dem echten AUDIS-Server durch, vorher (`HEAD`) und nachher (Arbeitsverzeichnis). Der UI-Test macht dasselbe in der echten Oberfläche und legt Screenshots im Katalog-Repo ab. Format und Vorgehen: `references/simulation.md` und `references/ui-test.md`.

```
node <skill-ordner>/scripts/simulate.mjs usersnaps/2404/snap-2404.json --version https://demo.audis.at/srz/release   # vorher/nachher mit der AUDIS-Version der Snap-Umgebung
node <skill-ordner>/scripts/simulate.mjs usersnaps/2404/snap-2404.json --ohne-vergleich --wissen  # reproduzieren, Wissen pro Schritt
node <skill-ordner>/scripts/ui-test.mjs usersnaps/2404/snap-2404.json                            # Screenshots vorher/nachher
node <skill-ordner>/scripts/ui-test.mjs usersnaps/2383/snap-2383-zurueck.json --stand HEAD --ohne-vergleich --version 2.3.0.3 --version 2.4.0 --wissen
node <skill-ordner>/scripts/simulate.mjs pfad.json --ohne-vergleich --stash-speichern stash.json   # Zustand als Knowledge Stash für das Debug-Widget
node <skill-ordner>/scripts/audis-versionen.mjs                                                  # verfügbare AUDIS-Server
node <skill-ordner>/scripts/audis-versionen.mjs tags                                             # Release-Tags von AUDIS
node <skill-ordner>/scripts/audis-versionen.mjs umgebung https://demo.audis.at/srz/release       # AUDIS-Version einer Umgebung
```

Pfaddateien können außerdem mit `"stash"` aus dem Zustand eines Snaps starten, und im UI-Test mit `"umantworten"` Korrekturen über die Timeline nachspielen. Details: `references/ui-test.md`.

## Pflege

- **Neues Wissen aus Analyzern oder dem Einsatzleitsystem:** in `scripts/external-knowledge.json` eintragen, mit Quelle.
- **Neue Muster aus Snap-Fixes:** in `references/fix-patterns.md` ergänzen.
- **Änderungen an der AUDIS-Grammatik (neue AUDIS-Version):** `references/grammar.md` und die Prüfregeln im Skript anpassen.
- **Neue AUDIS-Version mit geänderter Oberfläche:** die Selektoren in `scripts/ui-test.mjs` prüfen.
  - `OBSERVE` und `answerInUi` folgen den AUDIS-E2E-Tests: `data-testid='question-title'`, `.answer-button`, `.inner.active`.
  - Anleitungen: `app-bold-capitalized-question-title`, Knöpfe nach Beschriftung (Übersetzungen `ExecuteInstructionSuccessful`, `ExecuteInstructionUnsuccessful`, `SkipInstruction`; die gespeicherten Werte bildet `instructionSpec` in `scripts/lib/audis.mjs` nach).
  - Eingabefelder: `app-answer-input app-answer-button` (blendet das Feld ein), dann `app-answer-input input`. Zahlenfelder: `app-number-question input`.
  - Atemanalyse (`OBSERVE_BREATHING`, `answerBreathingInUi`): `input#frequency-input`, `app-frequency-stopwatch-input .btn`.
- **Neue AUDIS-Version mit geänderten Grenzwert-Standards der Atemanalyse:** `RESPIRATORY_DEFAULT_ACTION` in `scripts/lib/audis.mjs` anpassen. Diesen Nachbau nutzt `simulate.mjs`; massgeblich bleibt der UI-Test.
