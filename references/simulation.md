# Pfade mit AUDIS simulieren (`scripts/simulate.mjs`)

Das Skript spielt einen Abfragepfad mit dem **echten AUDIS-Server** durch, also derselben Engine wie in der AUDIS-Vorschau der VS-Code-Erweiterung, und zwar zweimal:

- **vorher:** mit dem Vergleichsstand, Standard `HEAD`
- **nachher:** mit dem Arbeitsverzeichnis

Danach vergleicht es beide Läufe und prüft die Erwartungen aus der Pfaddatei. So lässt sich ein Snap vor der Korrektur **reproduzieren** und danach **verifizieren**.

## Voraussetzungen

- **Node.js** ab 18
- **AUDIS-Server** (`Audis.Web.exe` bzw. `Audis.Web`, die offizielle Version inklusive Oberfläche). Das Skript sucht ihn in dieser Reihenfolge:
  1. `--audis <datei>`
  2. `--version <v>`: aus dem Versions-Cache, sonst geladen wie in der AUDIS-Erweiterung; braucht den Lizenzschlüssel, siehe [ui-test.md](ui-test.md)
  3. Umgebungsvariable `AUDIS_WEB`
  4. neueste lokale Version, entweder im Ordner der AUDIS-Erweiterung (`~/.vscode/extensions/softaware.audis-editor-<version>/server/web/`, ebenso `.vscode-insiders`, `.cursor`, `.windsurf`) oder im Versions-Cache

  Für Snaps die Version der Snap-Umgebung angeben: `--version <Snap-URL>`, z. B. `--version https://demo.audis.at/srz/release`. Details: [skripte.md](skripte.md#server-auswahl-simulatemjs-ui-testmjs).

  Die Erweiterung lädt den Server beim ersten „AUDIS Web UI starten“ mit dem Lizenzschlüssel herunter. Fehlt er, den Nutzer bitten, das einmal auszuführen oder den Lizenzschlüssel zu hinterlegen. Den AUDIS-Quellcode braucht das Skript nicht.
- **Alternative:** `--server <url>` nutzt einen laufenden AUDIS-Server, z. B. die Vorschau der Erweiterung auf `http://localhost:50042`. Dann gibt es keinen Vergleich, geprüft wird der Katalog, den dieser Server geladen hat.

## Was das Skript tut

- **Katalogkopien:** Es kopiert die Stände in ein temporäres Verzeichnis: `git ls-files` für das Arbeitsverzeichnis inklusive neuer, noch nicht versionierter Dateien, und Git-Objekte für `--base`/`--stand`. Das Repo selbst bleibt unverändert.
- **Server:** Pro Stand startet es einen AUDIS-Server auf einem freien Port (`--LocalWorkingDirectory <kopie>`, Mandant `Lokal`). Nach dem Lauf beendet es die Server und löscht die Kopien.
- **Wie die Oberfläche:** Es beantwortet jede gestellte Frage mit der Antwort aus der Pfaddatei. Dabei führt es das Wissen der gewählten Antwort so zusammen wie die AUDIS-Oberfläche und schickt es an die Engine (`/api/interrogation/Lokal/Start` bzw. `/Process`).
- **Ende:** Kommt eine Frage, für die der Pfad keine Antwort hat, endet der Lauf dort. Diese „nächste Frage“ wird mit ihren Antwortmöglichkeiten angezeigt, damit man den Pfad ergänzen kann.
- **Ausgabe:** Schritte mit Dispo, Szenarien am Ende, Zusammenfassung wie in AUDIS (`/knowledgesummary`) und Parser-/Katalogmeldungen (`/settings/Lokal/Diagnostics`).
- **Hinweis:** Der Server lauscht wie beim Start durch die Erweiterung auf allen Netzwerkschnittstellen, aber nur für die Dauer des Laufs (rund 30 Sekunden). Windows kann beim ersten Mal eine Firewall-Abfrage zeigen.

## Pfaddatei

JSON, Kommentare `//` sind erlaubt.
- **Ablage:** im Katalog-Repo als `usersnaps/<nr>/snap-<nr>.json`, neben den Screenshots des UI-Tests, siehe [ui-test.md](ui-test.md). So können Review und Abnahme den Test nachspielen. AUDIS lädt den Ordner `usersnaps/` nicht.
- **Vorlage:** [../assets/pfad-vorlage.json](../assets/pfad-vorlage.json)
- **Nur für den UI-Test:** die Felder `screenshots`, `zurueck`, `umantworten`, `erwartet.vorausgewaehlt`, `erwartet.nachZurueck` und `erwartet.cprKnopfStoppuhr`. `simulate.mjs` überspringt diese Erwartungen und zeigt sie mit `[–]`.
- **`stash`:** `"stash": "<datei>"` startet den Pfad aus einem Knowledge Stash, z. B. den Custom Data eines Snaps. Siehe [ui-test.md](ui-test.md), Abschnitt „Start aus einem Knowledge Stash“.

```json
{
  "name": "Snap #2404: Einstieg Kolik",
  "start": { "p": "esserzett!" },
  "antworten": {
    "#was": "Kolik",
    "#alter": 45,
    "#geschlecht": "männlich",
    "#atmung": "Ja, normale Atmung",
    "#reaktion": "normale Reaktion",
    "Wie lange beklagt die Person schon Schmerzen": "seit Stunden/Tagen",
    "Sind die Schmerzen kolikartig": "Ja"
  },
  "erwartet": {
    "nichtGefragt": ["#schmerzen.ruecken-seitlich-kolikartig"],
    "gefragt": ["#schmerzen.bekannt"],
    "naechsteFrage": "#schmerzen.ruecken-seitlich-nierensteine",
    "dispo": "RD-C",
    "szenario": "C Einsatz",
    "wissen": { "#schmerzen.ruecken-seitlich-kolikartig": "Ja" },
    "zusammenfassung": { "enthaelt": ["Kolik"], "enthaeltNicht": [] }
  }
}
```

### `start`

URL-Parameter als Startwissen, wie `?p=esserzett!` in der Snap-URL, wird zu `#p`. Ohne `p` bleibt die Abfrage an der Passwortfrage stehen.

### `antworten`

Schlüssel bestimmen, zu welcher Frage eine Antwort gehört:
- `#identifier`: genau diese Frage
- sonst ein **Textausschnitt der Frage**, ohne Gross-/Kleinschreibung und Markup. Passen mehrere, gewinnt der längste Ausschnitt.

Werte:
- **Text oder Wert der Antwort:** zuerst exakt (Text, Rohtext oder gespeicherter Wert), sonst eindeutiger Teiltext. Mehrdeutige oder unpassende Antworten brechen mit einer Liste der Möglichkeiten ab.
- **`"Unbekannt"`:** die Unbekannt-Antwort gemäss `revision-settings.json`.
- **Liste** `["A", "B"]`: Mehrfachauswahl.
- **Eingabefeld (`___`):** Hat die Frage genau ein Eingabefeld und passt kein Antworttext, wird der Wert eingetragen. So lässt sich z. B. „Andere: Oberbauchsz“ aus einem Snap nachspielen.
- **Beschriftetes Eingabefeld:** `"Label: Freitext"`, z. B. `"Ja: Endometriose"` für die Antwort `* Ja: ___` oder `"RTW, weil: ist so"` für `* RTW, weil:___`. Nötig, wenn eine Frage mehrere Eingabefelder hat. Es macht den Pfad aber auch sonst lesbarer.
- **Zahlenfeld (`visualization = number`):** die Zahl als Text, z. B. `"40.0"`.
- **Anleitung (`visualization = instruction`):** die Beschriftung des Knopfs: `"Durchgeführt, erfolgreich"` (kurz `"Durchgeführt"`), `"Durchgeführt, ohne Erfolg"` oder `"Nicht durchgeführt"`. Die gespeicherten Werte stehen in [engine-semantics.md](engine-semantics.md).
- **Alter (`visualization = age`):** Jahre (`45`) oder Altersgruppe (`Erwachsen`, `Kind/Jugend`, `Kleinkind`, `Säugling`). Das Skript setzt `#alter`, `.age`, `.days`, `.weeks`, `.months`, `.year` und die Altersgruppe wie die Oberfläche.
  - Mit einer Altersgruppe ohne Jahre stellen manche Kataloge danach „Alter wurde nicht eingegeben!“ (`#alter.age`). Deshalb Jahre angeben, wenn das Alter für den Snap keine Rolle spielt.
- **Atemanalyse (`visualization = respiratory`):** Frequenz als Zahl (`9`), das entspricht dem Absende-Knopf. Mit `{ "atemfrequenz": 9, "cpr": true }` wird stattdessen „CPR empfohlen“ geklickt; der Knopf setzt zusätzlich `KnowledgeToAddBeneathLowerThreshold`.
  - Ob die Oberfläche den CPR-Knopf anbietet, bildet das Skript aus `revision-settings.json` nach (Grenzbereich je Altersgruppe, siehe [engine-semantics.md](engine-semantics.md)). Wird er nicht angeboten, bricht `"cpr": true` mit dem Grenzbereich ab.
  - `"stoppuhr": 10` (Sekunden ohne Atemzug) wirkt nur im UI-Test.
- **Andere Spezial-Visualisierungen** (Ort, Datum, Körper, Zähler, …): Wissen direkt vorgeben, z. B. `{ "wissen": { "#verletzung.ort": "Oberarm links", "#verletzung.ort.simple": "Oberarm" } }`. Welche Identifier die Oberfläche setzt, zeigt das Debug-Widget der AUDIS-Vorschau.

Antworten für Fragen, die nur in einem der beiden Stände kommen (z. B. eine durch den Fix entfallene Frage), gehören trotzdem in den Pfad. Sonst endet der Lauf „vorher“ dort. Nicht benutzte Antworten meldet das Skript; das zeigt entfallene Fragen zusätzlich an.

### `erwartet`

Die Erwartungen gelten für den Lauf „nachher“. Alle sind optional.

| Feld | Bedeutung |
|---|---|
| `nichtGefragt` | Fragen (Identifier oder Textausschnitt), die nicht angezeigt werden dürfen |
| `gefragt` | Fragen, die angezeigt werden müssen |
| `naechsteFrage` | Frage, bei der der Pfad endet |
| `abgeschlossen` | `true`: Abfrage endet ohne offene Frage |
| `dispo` | Dispo-Code am Ende, z. B. `RD-C`, `RD-B`, `FW-GF2` |
| `szenario` | Szenario(s) am Ende, Name wie in AUDIS angezeigt, z. B. `C Einsatz` |
| `wissen` | `{ "#id": "Wert" }` muss gesetzt sein (Wert enthalten); `null` = nicht gesetzt. `"#audis.intermediate-disposition": null` prüft, dass bis zum Pfadende noch keine Freigabe zur Disposition erfolgt ist. |
| `zusammenfassung` | `enthaelt` / `enthaeltNicht`: Textausschnitte der Zusammenfassung |
| `cprKnopf` | `{ "#atemfrequenz.messung": false }`: CPR-Knopf nach dem Eintragen der Frequenz angeboten (`true`) oder nicht; hier nachgebildet, im UI-Test beobachtet |

Zusätzlich prüft das Skript immer den **AUDIS-Parser**:
- Parserfehler lassen die Prüfung scheitern.
- Parserwarnungen lassen sie nur scheitern, wenn sie gegenüber „vorher“ neu sind.

## Aufrufe

Im Wurzelverzeichnis des Katalog-Repos:

```
node <skill-ordner>/scripts/simulate.mjs pfad.json                    # vorher (HEAD) vs. nachher (Arbeitsverzeichnis)
node <skill-ordner>/scripts/simulate.mjs pfad.json gegenprobe.json    # mehrere Pfade, Server starten nur einmal
node <skill-ordner>/scripts/simulate.mjs pfad.json --wissen           # zusätzlich Wissensänderungen mit Herkunft
node <skill-ordner>/scripts/simulate.mjs pfad.json --ohne-vergleich   # nur aktueller Stand, z. B. zum Reproduzieren
node <skill-ordner>/scripts/simulate.mjs pfad.json --ohne-vergleich --stand HEAD   # nur der committete Stand, trotz laufender Änderung
node <skill-ordner>/scripts/simulate.mjs pfad.json --ohne-vergleich --version 2.3.0.3 --version 2.4.0   # Engine zweier Versionen
node <skill-ordner>/scripts/simulate.mjs pfad.json --base origin/softaware
node <skill-ordner>/scripts/simulate.mjs pfad.json --server http://localhost:50042
node <skill-ordner>/scripts/simulate.mjs pfad.json --ohne-vergleich --stash-speichern usersnaps/2383/stash.json   # Endzustand als Knowledge Stash
```

Pro Stand und Version startet ein Server. Ein Aufruf mit Vergleich dauert rund 30 Sekunden, jeder weitere Pfad nur wenige Sekunden.

- **Knapper Arbeitsspeicher:** Ein Serverstart kann über eine Minute dauern. Bei vielen Snaps deshalb alle Pfade in **einem** Aufruf bündeln, z. B. `$(find usersnaps -name "*.json")`. Die Ausgabe in eine Datei umleiten und je Pfad auswerten, etwa die Abschnitte „Unterschiede“ und „[FEHLER]“ mit `grep`.
- **Keine parallelen Läufe:** Mehrere gleichzeitig startende AUDIS-Server bremsen sich gegenseitig aus.

Exit-Code: 0 = alle Prüfungen erfüllt, 1 = Prüfung verfehlt, 2 = Aufruf-, Pfad- oder Serverfehler.

## Vorgehen beim Snap

1. **Reproduzieren (vor der Korrektur):** Pfad aus dem Snap aufbauen (Timeline im Screenshot, URL-Parameter) und mit `--ohne-vergleich --wissen` durchspielen, bis das gemeldete Verhalten sichtbar ist. `--wissen` zeigt wie das Debug-Widget, welches Wissen jeder Schritt setzt. Fehlt eine Antwort, zeigt das Skript die nächste Frage mit ihren Antwortmöglichkeiten.
2. **Erwartungen festlegen:** Was der Snap verlangt, als `erwartet` formulieren, z. B. `nichtGefragt` oder `dispo`.
3. **Korrigieren, dann verifizieren:** ohne Optionen aufrufen. Die Erwartungen müssen erfüllt sein. Die Unterschiede vorher → nachher dürfen nur das enthalten, was der Snap verlangt. Weitere Unterschiede (Dispo, Zusammenfassung) in der Übergabe nennen.
4. **Gegenproben:** Mindestens einen weiteren Pfad durchspielen, der sich nicht ändern darf, z. B. ein ähnlicher Einstieg oder eine andere Altersgruppe. Erwartung dort: „keine Unterschiede im Pfad“.
   - **Bei Szenario-Änderungen:** auch Pfade für die benachbarten Dispo-Stufen.
   - **Wenn eine Datei umgebaut wurde** (Frage verschoben, ausgelagert oder entfernt): eine Gegenprobe durch die *anderen* Zweige derselben Datei. Bei #2355 zeigte erst der Gas/Rauch-Pfad, dass sich eine Bindung verschoben hatte.
   - **Rückfälle:** Wird eine vom Kunden-RC zurückgesetzte Datei wiederhergestellt, die mitbetroffenen Snaps mit eigenen Gegenproben belegen.
5. **Übergabe:** Ergebnis (Prüfungen, Unterschiede) aufführen. Der Pfad liefert zugleich den Testpfad der Ticket-Notiz.

## Grenzen

- **Nicht nachgebildet:** Injection-Buttons, Kommentare, Zurück-Navigation und Neubeantwortung. Der Pfad wird nur vorwärts beantwortet.
- **Zwischendispositionen:** Die automatische Freigabe setzt der Server selbst (`#audis.intermediate-disposition`, sichtbar mit `--wissen`). Manuell angebotene Freigaben werden nicht ausgelöst.
- **Spezial-Visualisierungen** ausser Alter, Atemanalyse, Zahlenfeld und Anleitung werden nicht nachgebaut. Für Körper, Ort, Datum usw. `wissen` vorgeben. Bei der Atemanalyse ist der UI-Test massgeblich, die Simulation bildet nur den Grenzbereich nach.
- **Externe Analyzer und Ortung** (`#audis.location…`) liefern lokal kein Wissen, es sei denn, es wird über `start` vorgegeben.
- **Den Klicktest in der AUDIS-Vorschau** durch SRZ ersetzt die Simulation nicht. Sie macht ihn aber in aller Regel zur Formsache.
