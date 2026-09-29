# Skripte des Skills

- **Voraussetzungen:** keine Abhängigkeiten, Node.js ab 18, für `ui-test.mjs` ab 22.
- **Aufruf** im Wurzelverzeichnis des Katalog-Repos. `--help` zeigt bei jedem Skript alle Optionen.
- **Exit-Codes:** 0 = in Ordnung, 1 = Befund oder Prüfung verfehlt, 2 = Aufruf-, Pfad-, Browser- oder Serverfehler.

## `check-catalog.mjs` – statische Prüfung

| Bereich | Was geprüft wird |
|---|---|
| Aufbau | Abschnitte, Reihenfolge, Metadaten-Optionen |
| Syntax | unzulässige Zeichen, `GESETZT`/`BEKANNT`, `=> INKLUDIERE` |
| Verweise | Include-Ziele, Szenarien und Ereignisse gegen `constants.json` |
| Synonyme | Komma statt `;` |
| Regeln | Szenario-Regeln ohne direkte Bedingungen, Kataloge mit Regeln, aber ohne Trigger |
| Wissen | Identifier und Werte, die in Bedingungen und Enrichern verwendet, aber nirgends gesetzt werden – inkl. Vorschlag für die richtige Schreibweise |
| Einstellungen | `revision-settings.json` lesbar; Atemanalyse-Grenzwerte (`Thresholds`) für alle Altersgruppen |
| Vergleich | Geänderter Versionsstring (mit `--base`) |
| Bindung | Unveränderte Bedingungen ohne Identifier (`[ Ja ]`), deren Bezugsfrage sich durch die Änderung verschoben hat, z. B. weil eine Frage in ein Template ausgelagert wurde |
| Rückfälle | Geänderte Dateien, die wieder einem älteren Stand entsprechen, mit den damit rückgängig gemachten Commits. Das ist kein Befund, nur ein Hinweis zum Prüfen, z. B. beim Kunden-RC. |

- **Standard:** Es meldet nur neue Befunde gegenüber dem letzten Commit (`HEAD`), denn der committete Katalog gilt als fehlerfreie Ausgangsbasis. Vorschlagslisten in Meldungen („gesetzt werden: …“) zählen für den Vergleich nicht, ein neuer Wert macht Altbefunde also nicht „neu“.
- **Include-Hinweis:** Das Skript nennt, wo geänderte Kataloge eingebunden sind.
- **Branch:** Es erwartet `softaware` oder einen Arbeitsbranch, der `softaware` enthält.
- **Optionen:**
  - `--base <ref>`: anderer Vergleichsstand, z. B. `origin/softaware` nach eigenen Commits
  - `--stand <ref>`: einen Git-Stand statt des Arbeitsverzeichnisses prüfen, z. B. Kunden-Änderungen auf `origin/release`
  - `--alle`: alle Befunde des gesamten Katalogs ohne Vergleich. Nur für gezielte Analysen auf Wunsch des Nutzers, nicht Teil eines Snap-Fixes; Altbefunde nicht ungefragt beheben.
  - `--hinweise`: auch Hinweise zeigen
  - `--rueckfaelle`: alle Dateien des Stands auf Rückfälle prüfen, also Dateien, die ein späterer Commit auf einen älteren Stand zurückgesetzt hat. Gemeldet werden nur Fälle, in denen Änderungen anderer Autoren verloren gingen. Hilft bei „Problem besteht noch immer nach dem Update“, Beispiel #2219.
  - `--repo <pfad>`: anderes Repo prüfen
- **Externes Wissen:** Wissen aus Analyzern oder dem Einsatzleitsystem, das kein Katalog setzt, steht in `scripts/external-knowledge.json`.

## `simulate.mjs` – Engine über die API

Spielt eine oder mehrere Pfaddateien mit dem echten AUDIS-Server durch: vorher (`HEAD`) gegen nachher (Arbeitsverzeichnis) oder zwischen AUDIS-Versionen. Es prüft die Erwartungen und meldet Parserfehler. Die Server starten einmal pro Aufruf. Details: [simulation.md](simulation.md).

| Option | Wirkung |
|---|---|
| `--wissen` | Wissensänderungen pro Schritt mit Herkunft und fehlender `answerId`, wie das Debug-Widget |
| `--ohne-vergleich` | nur den aktuellen Stand durchspielen |
| `--base <ref>` | Vergleichsstand für „vorher“ (Standard: `HEAD`) |
| `--stand <ref>` | für „nachher“ diesen Git-Stand statt des Arbeitsverzeichnisses |
| `--version <v>` | AUDIS-Version, z. B. `2.3.0.3` oder `latest`, oder die Snap-URL (Version dieser Umgebung); `erweiterung` = Server der AUDIS-Erweiterung. Mehrfach angeben zum Vergleichen. Fehlende Versionen werden wie in der AUDIS-Erweiterung geladen. |
| `--server <url>` | laufenden AUDIS-Server verwenden, z. B. die Vorschau (kein Vergleich) |
| `--audis <datei>` | AUDIS-Server direkt angeben (`Audis.Web.exe` oder Ordner) |
| `--stash-speichern <datei>` | Endzustand als Knowledge Stash speichern, importierbar im Debug-Widget |
| `--repo <pfad>` | Katalog-Repository (Standard: aktuelles Verzeichnis) |
| `--mandant <name>` | Mandant im lokalen Modus (Standard: `Lokal`) |

Pfaddatei-Feld `"stash"`: Start aus einem Knowledge Stash (Snap-Daten oder Debug-Widget). Atemanalyse: `{ "atemfrequenz": 9, "cpr": true }`; ob der CPR-Knopf erscheint, bildet das Skript nach.

## `ui-test.mjs` – echte Oberfläche mit Screenshots

Dieselben Pfaddateien und Optionen wie `simulate.mjs` (ohne `--stash-speichern`), headless in Edge oder Chrome. Details: [ui-test.md](ui-test.md).

- **Pfadfehler** (Antwort nicht bedienbar, Zeitüberschreitung) beenden nur den betroffenen Pfad: Das Skript legt einen `…-fehler.png` ab, spielt die übrigen Pfade weiter und endet mit Exit-Code 2.

- **Prüft** vorausgewählte Antworten (`erwartet.vorausgewaehlt`).
- **Timeline:** springt zurück (`"zurueck"`, `erwartet.nachZurueck`) und antwortet dort neu (`"umantworten"`).
- **Stash:** startet aus einem Knowledge Stash über das Debug-Widget (`"stash"`).
- **Atemanalyse:** trägt die Frequenz ein, hält Grenzbereich und CPR-Knopf fest, lässt auf Wunsch die Stoppuhr laufen (`erwartet.cprKnopf`, `erwartet.cprKnopfStoppuhr`).
- **Screenshots** legt es in `usersnaps/<nr>/` ab: Fragen aus `"screenshots"` und das Ende des Pfads.
- **Zusätzliche Optionen:**
  - `--screenshots <dir>`: anderer Zielordner
  - `--alle-screenshots`: Screenshot bei jeder Frage
  - `--debug-widget`: Debug-Widget in den Screenshots einblenden
  - `--oberflaeche <wwwroot>`: eigene Oberfläche, z. B. ein lokaler Build
  - `--browser <exe>`: Browser (sonst `AUDIS_BROWSER`, Edge oder Chrome)
  - `--sichtbar`: Browserfenster anzeigen
  - `--groesse <BxH>`: Fenstergröße (Standard `1600x1000`)

## `audis-versionen.mjs` – AUDIS-Versionen

- **Ohne Argumente:** verfügbare AUDIS-Server, Versions-Cache und Herkunft des Lizenzschlüssels (ohne ihn anzuzeigen)
- **`laden <version> …`:** lädt Versionen wie die AUDIS-Erweiterung, z. B. `laden 2.3.0.3 2.4.0` oder `laden https://demo.audis.at/srz/release`, und prüft dabei die gelieferte Version
- **`umgebung <url>`:** AUDIS-Version einer Umgebung, z. B. aus der Snap-URL
- **`tags`:** Release-Tags des AUDIS-Repositorys

## Server-Auswahl (`simulate.mjs`, `ui-test.mjs`)

Reihenfolge:
1. `--audis`
2. `--version` (Cache, sonst Download). Eine Snap-URL setzt das Skript über `/api/version` ihres Hosts in die Version um. Entwicklungsstände wie auf `dev.audis.at` (`2026.09.17.1`) lassen sich nicht laden, dann die nächstliegende Version angeben.
3. `AUDIS_WEB`
4. neueste lokale Version: Server der AUDIS-Erweiterung oder Versions-Cache, je nachdem, welcher neuer ist. Das Skript weist darauf hin und nennt die Version der Vorschau, wenn sie abweicht.

**Für Snaps immer die Version der Snap-Umgebung angeben** (`--version <Snap-URL>`) und die Kopfzeile „Server …: … (AUDIS x)“ prüfen:
- AUDIS-Versionen verhalten sich unterschiedlich, z. B. entfernt erst 2.4.0 Enricher-Wissen automatisch wieder (`AutoUnenrich`, siehe [engine-semantics.md](engine-semantics.md)).
- Die Vorschau der Erweiterung läuft mit der Version, die die Erweiterung mitbringt. Sie kann deshalb anders reagieren als Skript und Snap-Umgebung.

Fehlt alles, den Nutzer bitten, in der AUDIS-Erweiterung einmal „AUDIS Web UI starten“ auszuführen oder den Lizenzschlüssel zu hinterlegen: `audis.licenseKey` in den VS-Code-Einstellungen oder `AUDIS_LICENSE_KEY`.
