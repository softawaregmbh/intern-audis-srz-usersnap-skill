# Arbeitsablauf: Branches, Usersnap, Abnahme

## Branches

```
softaware ──(Anwender haben abgenommen)──► release ──(finale Version)──► master
    ▲                                         │
    └──────── Rück-Merge „Release mergen“ ◄───┘
```

- **`softaware`**: Hier werden die Usersnaps bearbeitet. Commits direkt auf den Branch, bei grösseren Themen gelegentlich ein Feature-Branch mit Pull Request nach `softaware`. Auf Wunsch des Nutzers auch ein lokaler Arbeitsbranch von `softaware`, siehe „Stapel“ unten.
- **`release`**: Übernimmt `softaware` als Ganzes, sobald die Anwender alle Fixes abgenommen haben (Merge `softaware` → `release` oder PR). Ist nur ein Teil abgenommen, wird der Rest auf `softaware` nachgebessert, bis alles passt.
- **Der Kunde (SRZ)** erstellt auf `release` Release-Kandidaten (Commits `1-9-7-rc-2-<datum>-<hash>`).
  - Jeder RC setzt den Versionsstring in `9-Konfiguration.audis` hoch.
  - **Oft enthalten RCs eigene Katalogänderungen des Kunden** – bis hin zu Umbauten ganzer Bereiche (z. B. Unwettermodus) oder dem Zurücksetzen einzelner Dateien.
- **Rück-Merge:** Danach wird `release` per Pull Request („Release mergen“) nach `softaware` zurückgeführt.
- **`master`** erhält nur finale Versions-Snapshots des Kunden (`1-9-6-<datum>-<hash>`), keine Merges. Nie direkt auf `master` oder `release` committen.

### Vor dem ersten Fix einer Session

```
git fetch origin
git switch softaware
git pull --ff-only
git log --oneline origin/softaware..origin/release      # Kunden-Commits, die in softaware noch fehlen
```

- **Liefert der letzte Befehl Commits,** den Nutzer auf den ausstehenden Rück-Merge hinweisen, sonst drohen Konflikte in denselben Dateien. Nicht eigenmächtig mergen.
- **Kunden-Änderungen prüfen:** Ein Kunden-RC hat schon einmal eine ganze Enricher-Datei auf einen alten Stand zurückgesetzt, danach passte der Katalog nicht mehr dazu. Deshalb die eingehenden Änderungen prüfen:
  ```
  node <skill-ordner>/scripts/check-catalog.mjs --stand origin/release --base $(git merge-base origin/softaware origin/release)
  ```
  Das Skript meldet dabei auch Dateien, die wieder einem älteren Stand entsprechen, samt den damit rückgängig gemachten Commits.
- **Früher behobener Fehler taucht wieder auf** („Problem besteht noch immer nach dem Update“): Mit `check-catalog.mjs --alle --rueckfaelle` suchen, ob ein bereits eingemergter RC Dateien zurückgesetzt hat. Beispiel #2219: Der RC `1-8-5-rc-1` hatte `enricher-körperregion.json` auf den Stand vor drei Snap-Fixes zurückgesetzt.
- **Vor Änderungen an einer Datei:** `git log --oneline -5 origin/release -- <datei>` zeigt, ob der Kunde den Bereich zuletzt geändert hat.

## Usersnap

- **Herkunft:** SRZ-Mitarbeitende melden Snaps aus den AUDIS-Umgebungen, z. B. `demo.audis.at/srz/release/…` oder `dev.audis.at/srz/…`.
- **Inhalt eines Snaps:** Nummer, Beschreibung (oft mit dem durchgespielten Pfad), Screenshot, URL, Browser, interne Notizen, Status. Snaps können Monate alt sein.
- **Duplikate** werden verknüpft. Mehrere Snaps zum selben Thema zusammen betrachten.
- **Symptom vs. Anforderung:** Snaps beschreiben meist das beobachtete Verhalten. Das gewünschte Verhalten wird oft erst in den internen Notizen abgestimmt. Bei Unklarheit nachfragen oder in der Ticket-Notiz als offene Frage festhalten.
- **Status-Ablauf:**
  1. SRZ plant die Bearbeitung (Status z. B. „Intensivtag 22.06“), priorisiert und weist zu.
  2. Die Entwicklung committet den Fix auf `softaware` und schreibt eine interne Notiz mit Analyse, Anpassung, Testpfad und offenen Fragen. Status: „muss geprüft werden“.
  3. SRZ testet und setzt „abgeschlossen“ oder diskutiert weiter.
- Fachliche Entscheidungen (Dispo-Stufen, medizinische Inhalte, Texte gegenüber Anrufenden) trifft SRZ. Die Entwicklung schlägt vor, begründet und fragt nach.

## Reproduzieren und testen

- **AUDIS lokal:** Die AUDIS-VS-Code-Erweiterung („AUDIS Editor“) startet eine lokale AUDIS-Oberfläche mit dem geöffneten Katalogordner (Befehl „AUDIS Web UI starten“, F5; einmalig mit Lizenzschlüssel eine AUDIS-Version herunterladen).
- **Debug-Widget „Local Development“:** Zeigt pro Schritt das Wissen mit Herkunft (Katalog und Zeile), die aktiven Szenario-Regeln und die aktuelle Frage.
  - Im Abschnitt „Knowledge Stash“ lässt sich der aktuelle Zustand jederzeit speichern.
  - Ein Stash lässt sich dort auch mit „Importieren und wiederherstellen“ laden, z. B. aus den Custom Data eines Snaps. Mandant und Revision müssen zur Vorschau passen, sonst meldet der Import eine Abweichung.
- **Syntaxfehler:** Die Erweiterung zeigt sie in der Problems-Ansicht an.
- **Abnahme:** Die SRZ-Anwender testen den Stand von `softaware` ebenfalls mit der Erweiterung.
- **Als Agent ohne Oberfläche:** Pfade mit `scripts/simulate.mjs` (Engine) und `scripts/ui-test.mjs` (echte Oberfläche, headless, mit Screenshots) gegen den AUDIS-Server der Erweiterung durchspielen, siehe [simulation.md](simulation.md) und [ui-test.md](ui-test.md). Das ersetzt das Klicken beim Reproduzieren und Verifizieren. Den Klicktest in der Vorschau macht SRZ bei der Abnahme, anhand der Screenshots in `usersnaps/<nr>/` und des Testpfads.

## Commits

- **Ein Commit pro Snap:** `fix: snap #2410`.
- **Mehrere Snaps mit derselben Änderung:** `fix: snap #1135 #1136`.
- **Nachbesserungen:** weitere Commits mit derselben Nummer.
- **Unfertiges:** `fix(WIP): snap #2329`. **Rücknahme:** `revert: snap #…`.
- **Sonstiges:** `chore: …`.
- Die Commit-Message ist nur diese eine Zeile.
- **Nicht selbst committen oder pushen,** das macht der Nutzer. Commit-Nachricht vorschlagen und nur die zum Snap gehörenden Dateien nennen.
- **Ordner `usersnaps/<nr>/`** (Pfaddateien, Screenshots, ggf. Stash):
  - Beim Katalog-Fix gehört er in denselben Commit (`fix: snap #NNNN`).
  - Er wandert mit `release` in das Kunden-Repository. SRZ sieht die Bilder dann bei der Abnahme. Deshalb keine internen Details hineinlegen, etwa Code-Auszüge oder Kommentare zu Personen.
- **Softwarefehler ohne Katalogänderung:** Behebt ein AUDIS-Update den Fehler, wird der Katalog nicht geändert. Der Befund geht an die Entwicklung.
  - Ob die Analyse (`usersnaps/<nr>/`) committet wird, entscheidet der Nutzer. Vorschlag: `chore: snap #NNNN Analyse`.
  - Interne Tickets liegen in `softawaregmbh/softaware-audis-issues`: nur lesen, dort hat auch der Kunde Zugriff.
- **Kommentare im Katalog sparsam** und nur, wenn sie Nichtoffensichtliches erklären, z. B. `// Usersnap #2203: auch bei Sprachstörungen stellen`.

## Mehrere Snaps in einer Sitzung („Intensivtag“)

- **Standard:** Snaps einzeln nacheinander bearbeiten, je ein Commit. Nach jedem Snap übergeben; der Nutzer committet, bevor der nächste beginnt.
- Am Ende eine Liste mit Snap-Nummer, Commit, Kurzbeschreibung und Testpfad erstellen, um die Usersnap-Notizen zu setzen.

### Stapel: alle Snaps gesammelt, nicht committet

Wünscht der Nutzer, dass alle Lösungen gesammelt uncommittet auf einem Arbeitsbranch liegen (z. B. `usersnap-<name>`):

1. **Branch** lokal von aktuellem `softaware` anlegen (`git switch -c <name>`). Nicht pushen. `check-catalog.mjs` akzeptiert Branches, die `softaware` enthalten.
2. **Alle Snaps zuerst verstehen**, dann die Pfaddateien anlegen und **gemeinsam reproduzieren:** `simulate.mjs usersnaps/*/snap-*.json --ohne-vergleich --stand HEAD --wissen > datei`. Die Server starten nur einmal. Auf einem ausgelasteten Rechner dauert ein Serverstart rund eine Minute. Deshalb keine parallelen Agenten mit eigenen AUDIS-Servern starten.
3. **Überschneidungen beachten:** Mehrere Snaps ändern oft dieselben Templates (ABC, Reaktion, Atemanalyse) oder `start.audis`. Nach allen Änderungen **einen gemeinsamen Endlauf** über alle Pfade und Gegenproben machen. Erst er zeigt Wechselwirkungen.
4. **Lange Läufe** (Simulation aller Pfade, UI-Test) im Hintergrund starten. Den UI-Test nicht parallel zu einer Simulation laufen lassen, sonst kommt es zu Zeitüberschreitungen beim Start.
5. **Commit-Vorschlag:** Teilen sich Snaps Dateien, geht ein Commit pro Snap nur mit `git add -p`. Sonst einen gemeinsamen Commit vorschlagen: `fix: snap #2404 #2381 …`.
6. **Übergabe:** eine Übersichtstabelle (Snap, Ursache, Änderung), danach Nebenwirkungen, offene Fragen und die Ticket-Notizen kompakt je Snap. Die Grenzen des UI-Tests je Snap offen benennen, siehe [ui-test.md](ui-test.md).
