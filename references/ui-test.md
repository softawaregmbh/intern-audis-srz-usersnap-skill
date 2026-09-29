# UI-Test mit Screenshots und AUDIS-Versionen (`scripts/ui-test.mjs`)

`simulate.mjs` prüft die Logik der Engine über die API. `ui-test.mjs` spielt denselben Pfad in der **echten AUDIS-Oberfläche** durch, und zwar in Edge oder Chrome, headless über das DevTools-Protokoll.

Das Skript:
- hält fest, was die Oberfläche anzeigt
- legt Screenshots im Katalog-Repo ab
- vergleicht auf Wunsch mehrere AUDIS-Versionen

Nötig ist der UI-Test für:
- **die Abnahme:** Vorher/Nachher-Screenshots jedes Katalog-Fixes für SRZ
- **Fehler, die nur die Oberfläche zeigt:** vorausgewählte Antworten, Verhalten beim Zurückspringen, Anzeige. Beispiel: Snap #2383.
- **Versionsvergleiche:** Tritt ein Verhalten erst seit einem AUDIS-Update auf? Siehe [software-oder-katalog.md](software-oder-katalog.md).

## Voraussetzungen

- **Node.js ab 22**, wegen des eingebauten WebSocket
- **Edge oder Chrome.** Sie werden automatisch gefunden, sonst `--browser <exe>` oder `AUDIS_BROWSER`.
- **Ein AUDIS-Server mit Oberfläche.** Heruntergeladene AUDIS-Versionen bringen sie mit. Die Suche nach dem Server ist dieselbe wie bei `simulate.mjs`:
  1. `--audis`
  2. `--version`
  3. `AUDIS_WEB`
  4. neueste lokale Version (Erweiterung oder Cache)

  Für Snaps die Version der Snap-Umgebung angeben: `--version <Snap-URL>`.

  Ein lokaler Entwickler-Build ohne `wwwroot` braucht zusätzlich `--oberflaeche <ordner mit index.html>`.
- **Laufende Vorschau statt eigenem Server:** `--server http://localhost:50042` nutzt die Vorschau, die die AUDIS-Erweiterung gestartet hat („AUDIS Web UI starten“), mit genau der Version, die dort installiert ist. Das ist der direkte Weg über die Erweiterung, allerdings ohne Vorher/Nachher-Vergleich.

## AUDIS-Versionen

- **Download:** Wie in der AUDIS-Erweiterung („AUDIS: Download“) lässt sich jede AUDIS-Version laden. Das Skript nutzt denselben Download-Dienst und denselben Lizenzschlüssel. Die Erweiterung speichert ihn in den VS-Code-Einstellungen unter `audis.licenseKey`; alternativ die Umgebungsvariable `AUDIS_LICENSE_KEY`. Der Schlüssel wird nie ausgegeben und nie ins Repo geschrieben.
- **Cache:** Geladene Versionen liegen im Versions-Cache, unter Windows `%LOCALAPPDATA%\audis-srz-usersnap\audis-versionen\<version>`, je rund 250 MB. Sie werden wiederverwendet.
- **Versionsprüfung:**
  - Nach dem Download prüft das Skript die tatsächliche Version, anhand von `changelog/v<version>.md` im Build.
  - Liefert der Download-Dienst eine andere als die angefragte Version (vorgekommen: für „2.4.0-rc.1“ ein 2.5.0-rc.1-Build), wird der Download verworfen.
  - `latest` wird unter der tatsächlichen Versionsnummer abgelegt.
- **Übersicht, Tags und Vorab-Laden:**
  ```
  node <skill-ordner>/scripts/audis-versionen.mjs                        # Server, Cache, Herkunft des Lizenzschlüssels
  node <skill-ordner>/scripts/audis-versionen.mjs tags                   # Release-Tags (GitHub CLI "gh")
  node <skill-ordner>/scripts/audis-versionen.mjs laden 2.3.0.3 2.4.0    # Versionen vorab laden
  node <skill-ordner>/scripts/audis-versionen.mjs umgebung https://demo.audis.at/srz/release   # Version einer Umgebung
  ```
  Nicht jede getaggte Version ist beim Download-Dienst verfügbar, dann kommt HTTP 404.
- **Unveröffentlichte Hotfixes prüfen:** siehe [software-oder-katalog.md](software-oder-katalog.md), Abschnitt „Unveröffentlichte Korrekturen prüfen“.
- **Welche Version SRZ nutzt:** In der AUDIS-Oberfläche steht die Version im Menü. Die Server-Ausgabe der Skripte nennt sie ebenfalls („AUDIS 2.4.0“). Lokale Entwickler-Builds melden teils nur eine Grundversion wie „2.3.0“, das zählt nicht als Release-Nachweis.

## Pfaddatei: Ergänzungen für die Oberfläche

Das Format ist dasselbe wie in [simulation.md](simulation.md). Zusätzlich gibt es:

```json
{
  "name": "Snap #2383: Bewusstseinsfrage – Antworten schon angekreuzt",
  "start": { "p": "esserzett!" },
  "antworten": {
    "#was": "Atemwegsverlegung",
    "#alter": 20,
    "#geschlecht": "männlich",
    "#atemweg.blockiert": "Fremdkörper",
    "#reaktion": "veränderte Reaktion, anders als sonst",
    "#auffaellige.reaktion": "somnolent oder benommen"
  },
  "screenshots": ["#auffaellige.reaktion"],
  "zurueck": ["#auffaellige.reaktion"],
  "erwartet": {
    "vorausgewaehlt": { "#auffaellige.reaktion": [] },
    "nachZurueck": { "#auffaellige.reaktion": ["somnolent oder benommen"] }
  }
}
```

| Feld | Bedeutung |
|---|---|
| `screenshots` | Fragen, bei deren erstem Anzeigen ein Screenshot entsteht, noch bevor geantwortet wird. Das Ende des Pfads wird immer fotografiert. |
| `zurueck` | Nach dem Pfad über die Timeline zu diesen Fragen zurückspringen, wie ein Disponent. Dabei die wiederhergestellte Auswahl festhalten und einen Screenshot machen. |
| `umantworten` | Korrekturen mitten im Pfad: `[{ "vor": "#reaktion", "frage": "#atemnot", "antwort": "Leichte Atembeschwerden" }]`. Bevor die Frage `vor` beantwortet wird, springt der Test über die Timeline zu `frage` zurück und antwortet dort neu. |
| `stash` | Start aus einem Knowledge Stash (Datei relativ zur Pfaddatei), siehe unten |
| `erwartet.vorausgewaehlt` | Antworten, die beim **ersten Anzeigen** der Frage markiert sein dürfen (`[]` = keine) |
| `erwartet.nachZurueck` | Antworten, die nach dem Zurückspringen markiert sein müssen |
| `erwartet.cprKnopf` | Atemanalyse: CPR-Knopf nach dem Eintragen der Frequenz angeboten (`true`) oder nicht (`false`) |
| `erwartet.cprKnopfStoppuhr` | Atemanalyse: CPR-Knopf, nachdem die Stoppuhr ohne Atemzug gelaufen ist (`"stoppuhr"` in der Antwort) |

Alle übrigen Erwartungen (`nichtGefragt`, `dispo`, `wissen`, `zusammenfassung` …) gelten auch im UI-Test. Dispo und Wissen stammen aus den Server-Antworten, die die Oberfläche tatsächlich erhalten hat. `simulate.mjs` überspringt die Oberflächen-Erwartungen und zeigt sie mit `[–]`. `umantworten` führt nur der UI-Test aus.

### Atemanalyse (Atemfrequenz, CPR-Knopf)

Die Frage „Atemanalyse …“ (`#atemfrequenz.messung`) entscheidet in der Oberfläche, ob „CPR empfohlen“ erscheint. Hintergrund: [engine-semantics.md](engine-semantics.md), Abschnitt „Atemanalyse“.

```json
"antworten": { "#atemfrequenz.messung": { "atemfrequenz": 9, "cpr": false, "stoppuhr": 10 } },
"screenshots": ["#atemfrequenz.messung"],
"erwartet": { "cprKnopf": { "#atemfrequenz.messung": false }, "cprKnopfStoppuhr": { "#atemfrequenz.messung": true } }
```

- **`atemfrequenz`:** Wert, der ins Eingabefeld kommt. Eine Zahl allein (`"#atemfrequenz.messung": 9`) genügt.
- **`cpr`:** `true` klickt „CPR empfohlen“ wie im Snap #1494, sonst den Absende-Knopf („Zu niedrig“, „Normal“, „Zu hoch“).
- **`stoppuhr`:** Sekunden, die die Stoppuhr vorher ohne Atemzug läuft. So lässt sich prüfen, ob die Oberfläche einen Atemstillstand erkennt.
- **Screenshots:** Steht die Frage in `screenshots`, entsteht das Bild erst nach dem Eintragen, mit Grenzbereich und Knöpfen. Mit Stoppuhr kommt ein Bild nach der Wartezeit dazu.
- **Ausgabe:** `Atemfrequenz 9/min: kein CPR-Knopf, Grenzbereich 8–20/min`. Die Unterschiede vorher → nachher zeigen geänderte Grenzbereiche und CPR-Knöpfe.

### Start aus einem Knowledge Stash

Der `knowledgeStash` beschreibt den Zustand einer Abfrage: Wissen, aktuelle Frage, Szenarien. Er stammt aus den **Custom Data eines Snaps** oder aus dem **Debug-Widget „Local Development“** der Vorschau, das beim Start über die AUDIS-Erweiterung erscheint und den Stash jederzeit zeigt, speichert und importiert. Die Kopie im internen GitHub-Ticket ist meist gekürzt, dann den Nutzer um die vollständigen Custom Data bitten.

- **Pfaddatei:** `"stash": "stash-2383.json"`. Die Datei darf die Custom Data unverändert enthalten, die Hüllen `custom` und `knowledgeStash` werden ausgepackt.
- **UI-Test:** stellt den Stash über das Debug-Widget wieder her, mit „Importieren und wiederherstellen“. Mandant und Revision werden dabei auf die der Vorschau gesetzt, sonst lehnt der Import ihn ab. Danach geht es mit den `antworten` weiter. Die Screenshots zeigen das eingeklappte Widget.
- **`simulate.mjs`:** stellt den Stash über die API wieder her, so wie das Widget es intern tut.
- **Stash für Tester erzeugen:** `simulate.mjs … --stash-speichern <datei>` speichert den Endzustand als Stash. Tester importieren ihn in der Vorschau im Debug-Widget, Abschnitt „Knowledge Stash“ → „Importieren und wiederherstellen“, und stehen sofort an der richtigen Stelle.
  - Mandant und Revision entsprechen der Vorschau, die Revision ist der Ordnername des Katalogs, z. B. `audis-srz`.
  - Hat der Katalog-Ordner des Testers einen anderen Namen, meldet der Import die Abweichung.

## Screenshots im Repo

- **Ablage:** `<repo>/usersnaps/<snap-nummer>/`. Die Nummer stammt aus `"name"` (`#2383`), sonst aus dem Dateinamen. Anderer Ort: `--screenshots <ordner>`.
- **Dateinamen:** `<stand>-<variante>-NN-<frage>.png`.
  - **Stand:** `vorher` oder `nachher`; ohne Vergleich `ansicht`, bei mehreren Versionen `audis-<version>`.
  - **Variante:** Sie kommt aus dem Namen der Pfaddatei. Bei `snap-2383-zurueck.json` ist es `zurueck`, bei `snap-2404.json` gibt es keine.
  - **Beispiele:** `nachher-01-kennt-die-person-….png`, `audis-2.4.0-zurueck-03-zurueck-wie-zeigt-….png`
- **Ersetzen:** Ein neuer Lauf ersetzt nur die Bilder mit genau seinem Präfix.
- **Pfaddatei daneben:** Die Pfaddatei als `usersnaps/<nr>/snap-<nr>.json` danebenlegen, damit Review und Abnahme den Test nachspielen können.
- **Nicht Teil des Katalogs:** AUDIS lädt den Ordner `usersnaps/` nicht, und die Skripte übernehmen ihn nicht in Katalogkopien. Screenshots und Pfaddatei gehören in den Commit-Vorschlag. Committen macht der Nutzer.
- **Grösse:** Standard ist 1600×1000 Pixel, änderbar mit `--groesse`. Die Screenshots zeigen die Oberfläche ohne Debug-Widget, wie SRZ sie sieht. `--debug-widget` blendet es ein.

## Aufrufe

Im Wurzelverzeichnis des Katalog-Repos:

```
# Katalog-Fix: vorher (HEAD) vs. nachher (Arbeitsverzeichnis), Screenshots nach usersnaps/<nr>/
node <skill-ordner>/scripts/ui-test.mjs usersnaps/2404/snap-2404.json

# Software oder Katalog? Gleicher Katalog (HEAD), zwei AUDIS-Versionen, Wissen pro Schritt
node <skill-ordner>/scripts/ui-test.mjs usersnaps/2383/snap-2383.json --stand HEAD --ohne-vergleich --version 2.3.0.3 --version 2.4.0 --wissen

# Direkt gegen die laufende Vorschau der AUDIS-Erweiterung
node <skill-ordner>/scripts/ui-test.mjs usersnaps/2383/snap-2383.json --server http://localhost:50042

# Fehlersuche: Browser sichtbar, Screenshot bei jeder Frage
node <skill-ordner>/scripts/ui-test.mjs pfad.json --sichtbar --alle-screenshots
```

Exit-Code: 0 = Prüfungen erfüllt, 1 = Prüfung verfehlt, 2 = Aufruf-, Pfad-, Browser- oder Serverfehler.

## Ausgabe lesen

- `Start aus Knowledge Stash „…“ → „Frage“`: der wiederhergestellte Zustand
- `! beim Anzeigen schon markiert: …`: Diese Antworten waren beim ersten Anzeigen der Frage schon angekreuzt. Das ist fast immer ein Fehler.
- `… (über die Timeline neu beantwortet)`: ein Schritt aus `umantworten`
- `Zurück zu „…“: markiert …`: die Auswahl nach dem Zurückspringen über die Timeline
- **Mit `--wissen`:** pro Schritt die Wissensänderungen aus den Server-Antworten: `+` neu, `~` geändert, `-` entfernt, jeweils mit Herkunft und fehlender `answerId`
- **Unterschiede vorher → nachher bzw. zwischen Versionen:** entfallene oder neue Fragen, Vorauswahl, Dispo, Szenarien, Zusammenfassung, Parsermeldungen
- **Bei einem Fehler:** Das Skript legt einen Screenshot `…-fehler.png` des Zustands ab und nennt ihn in der Meldung.

## Unterstützte Bedienung und Grenzen

- **Unterstützt:**
  - Einfach- und Mehrfachauswahl, bei Mehrfachauswahl mit „Weiter“
  - Antworten mit zweiter Zeile (`"Text<br><small>…</small>"`): Die erste Zeile oder der ganze Text genügt
  - Unbekannt
  - Eingabefelder, auch beschriftete (`"Label: Freitext"`). Das Skript klickt zuerst den Knopf („Sonstiges“, „Text eingeben“), der das Feld einblendet.
  - Zahlenfelder (`visualization = number`)
  - Alter
  - Atemanalyse mit Frequenz, CPR-Knopf und Stoppuhr
  - Einstiegssuche (`apisearch`): Findet der volle Titel nichts (Titel mit „/“ wie „Synkope / Kreislaufdysregulation“), sucht das Skript mit dem Teil vor dem „/“ und dem ersten Wort weiter
  - Anleitungen (`instruction`): Knöpfe „Durchgeführt, erfolgreich“, „Durchgeführt, ohne Erfolg“, „Nicht durchgeführt“; auch als Pfadende
  - Zurückspringen über die Timeline, auch mit neuer Antwort (`umantworten`)
  - Start aus einem Knowledge Stash (Debug-Widget)
- **Andere Spezial-Visualisierungen** (Ort, Datum, Körper …) und `{ "wissen": … }`-Antworten bricht das Skript mit einer Meldung ab.
  - **Wenn der Snap-Zustand schon vorher sichtbar ist** (z. B. die Dispo nach der Reaktionsfrage), eine Variante `snap-<nr>-ui.json` anlegen, die vor dieser Frage endet. Der End-Screenshot zeigt die Dispo in der Fusszeile.
  - **Sonst** die Logik mit `simulate.mjs` und `"wissen"` prüfen, den Klicktest SRZ überlassen und das in der Übergabe nennen.
- **Pfadfehler betreffen nur ihren Pfad:** Das Skript legt `…-fehler.png` ab und spielt die übrigen Pfade weiter. Fehler-Screenshots vor der Übergabe löschen.
- **Neue Visualisierung ergänzen:** Komponente und Selektoren im ausgelieferten Oberflächen-Code suchen (`wwwroot/main-*.js` der AUDIS-Version im Cache), dann `answerInUi` in `scripts/ui-test.mjs` erweitern, nach dem Muster von `answerBreathingInUi`.
- **Nicht bedient:** Injection-Buttons, Zwischendispositionen, Kommentare und „Abfrage beenden“.
- **Zeitverhalten:** Der Test wartet auf die Server-Antwort und die angezeigte Frage. Bei langsamen Rechnern hilft ein erneuter Lauf, `--sichtbar` zeigt, wo es hängt.
  - „AUDIS startet die Abfrage nicht (keine Antwort auf /Start)“ kommt vor, wenn gleichzeitig eine Simulation läuft. Den UI-Test dann allein wiederholen.
