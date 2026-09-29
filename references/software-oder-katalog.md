# Software- oder Katalogfehler? Komplexe Snaps einordnen

Nicht jeder Snap ist ein Katalogfehler. Manche Fehler entstehen in AUDIS selbst, in der Engine oder in der Oberfläche, oft erst durch ein Update. Solche Fehler werden **mit einem Software-Update behoben, nicht mit einer Katalogänderung**. So will es die Entwicklung: Wenn es mit der Vorversion besser funktioniert, wird die Software korrigiert.

Häufig sind es Mischfälle: Eine Katalogstruktur löst einen Fehler in AUDIS aus. Auch dann gehört die Korrektur in AUDIS. Einen Katalog-Workaround gibt es nur auf ausdrücklichen Wunsch.

## Hinweise auf einen Softwarefehler

- **Update:** „seit dem letzten Update“, „tritt plötzlich auf“, mehrere Meldungen aus der Schicht in kurzer Zeit
- **Oberfläche:** angekreuzte Antworten, die niemand gewählt hat; falsche Auswahl nach dem Zurückspringen; Darstellung, Timeline, Tastenkürzel, Anzeige der Zusammenfassung
- **Nur im UI-Test sichtbar:** Das Verhalten zeigt sich mit `ui-test.mjs`, aber nicht mit `simulate.mjs`. Dann stimmt die Logik des Servers, und die Oberfläche zeigt etwas anderes an.
- **Versionsabhängig:** Derselbe Katalog verhält sich in zwei AUDIS-Versionen unterschiedlich.
- **Katalog unauffällig:** Der betroffene Katalogteil wurde lange nicht geändert (`git log --oneline -- <datei>`), und das Prüfskript meldet nichts.

## Vorgehen

1. **Den Zustand des Melders beschaffen.** Der Wissensstand `knowledgeStash` steht in den Custom Data des Snaps (Usersnap). Die Kopie im internen GitHub-Ticket ist meist gekürzt, dann den Nutzer um die vollständigen Custom Data bitten.
   - Diese Daten lassen sich als Stash-Datei direkt verwenden: `"stash": "<datei>"` in der Pfaddatei. Die Skripte stellen den Zustand dann wieder her, genau wie „Importieren und wiederherstellen“ im Debug-Widget der Vorschau.
   - Das Debug-Widget heißt „Local Development“ und erscheint, wenn AUDIS über die Erweiterung gestartet wird. Es zeigt den `knowledgeStash` jederzeit an und kann ihn speichern und importieren.
2. **Reproduzieren:**
   - Logik mit `simulate.mjs … --ohne-vergleich --wissen`
   - Anzeige mit `ui-test.mjs … --ohne-vergleich --wissen`, siehe [ui-test.md](ui-test.md)

   Pfad aus Timeline, Stash und internen Notizen aufbauen. Abläufe mit Korrekturen spielt der UI-Test mit `"zurueck"` und `"umantworten"` nach.
3. **Wissen mit Herkunft ansehen:** `--wissen` zeigt pro Schritt, welches Wissen hinzukommt, sich ändert oder entfernt wird, samt Herkunft (Oberfläche, Enricher, geerbt …) und fehlender `answerId`. Typische Muster, siehe [engine-semantics.md](engine-semantics.md):
   - Ein Enricher überschreibt Antwortwissen.
   - Enricher-Wissen bleibt stehen oder verschwindet, je nach AUDIS-Version.
4. **Versionen vergleichen**, gleicher Katalog:
   ```
   node <skill-ordner>/scripts/ui-test.mjs <pfad.json> --stand HEAD --ohne-vergleich --version <vorversion> --version <aktuelle version>
   ```
   - **Ergebnis:** Die Screenshots je Version landen in `usersnaps/<nr>/`. Verhält sich die Vorversion richtig, ist es eine **Regression in AUDIS**.
   - **Welche Versionen es gibt:** `audis-versionen.mjs tags` listet die Release-Tags. Nicht jede Version ist beim Download-Dienst verfügbar, dann kommt HTTP 404.
5. **Ursache im AUDIS-Code eingrenzen**, falls der Quellcode lokal vorliegt (Repository `softawaregmbh/softaware-audis`; nach dem lokalen Pfad fragen):
   ```
   git -C <audis-repo> log --oneline <vorversion>..<version> -- <pfad>
   git -C <audis-repo> diff <vorversion> <version> -- <datei>
   ```
   Einstiegspunkte:
   - Oberfläche: `Audis/Audis.App/src/app/` (Antworten `components/answer/`, Wiederherstellung `utils/knowledge-utils.ts`, `components/answer/base-answer/utils/restore.ts`, Debug-Widget `services/local-development-widget.service.ts`)
   - Engine: `Audis/Audis.Engine/`
   - Enricher: `Audis/Audis.KnowledgeEnrichers.Core/`
   - Zusammenfassung: `Audis/Audis.Services/KnowledgeSummary/`
   - API: `Audis/Audis.Web/Endpoints/`

   **Ein Code-Diff zwischen Tags ist nur ein Hinweis.** Builds können vom Tag abweichen. Zum Beispiel liefert der Build 2.3.0.3 ein Feld aus, das der Tag 2.3.0.3 nicht enthält, weil es aus einem externen Paket stammt. Auch Server und Oberfläche wirken zusammen. Aussagen wie „Version X ist nicht betroffen“ nur mit echten Builds machen.
6. **Interne Tickets und Hotfixes prüfen**, nur lesen:
   ```
   gh issue list -R softawaregmbh/softaware-audis-issues --search "<Stichwort oder Snap-Text>"
   gh pr list -R softawaregmbh/softaware-audis --state all --search "<Ticketnummer oder hotfix>"
   ```
   - Weitergeleitete Snaps heißen dort „[USERSNAP] …“. Die Entwicklung beschreibt ihre Lösung oft schon im Ticket.
   - In `softaware-audis-issues` hat **auch der Kunde Zugriff**. Dort nichts anlegen oder kommentieren ohne ausdrücklichen Auftrag.
7. **Übergabe:**
   - Ursache, Versionsvergleich mit Screenshots und betroffene Codestelle
   - Empfehlung: Software-Update statt Katalogänderung. Gibt es einen Hotfix, ihn prüfen (Abschnitt unten) und Befunde dazu nennen.
   - Einen Katalog-Workaround nur auf ausdrücklichen Wunsch umsetzen und dabei die Nebenwirkungen nennen.
   - Ticket-Notiz in der Variante „Softwarefehler“ aus [../assets/ticket-note-template.md](../assets/ticket-note-template.md). Zum Commit von `usersnaps/<nr>/` siehe [workflow.md](workflow.md).

## Unveröffentlichte Korrekturen prüfen

1. **Veröffentlichte Version:** Ist der Hotfix beim Download-Dienst verfügbar, genügt `--version <hotfix-version>`, z. B. `--version 2.4.0 --version 2.4.0.1`. Solange er nicht veröffentlicht ist, meldet `audis-versionen.mjs laden <version>` HTTP 404.
2. **Selbst gebaut aus dem Hotfix-Branch:** Nur mit Zustimmung des Nutzers, und in einer eigenen Kopie des AUDIS-Repositorys, nicht im Arbeitsverzeichnis der Entwicklung.
   ```
   git clone <audis-repo> <kopie> && git -C <kopie> switch <hotfix-branch>
   dotnet build <kopie>/Audis/Audis.Web/Audis.Web.csproj
   cd <kopie>/Audis/Audis.App && pnpm install && pnpm run build_prod
   node <skill-ordner>/scripts/ui-test.mjs <pfad.json> --stand HEAD --ohne-vergleich \
     --audis <kopie>/Audis/Audis.Web/bin/Debug/net10.0/Audis.Web.exe --oberflaeche <kopie>/Audis/Audis.App/dist/audis/browser
   ```
   Ein solcher Build meldet teils nur eine Grundversion, z. B. „2.3.0“. In der Übergabe deshalb Branch und Commit nennen.

## Beispiel: Snap #2383 – Antworten beim Anzeigen schon angekreuzt

**Meldung:** Bei „Wie zeigt sich die veränderte Reaktion?“ (`99-Template-Reaktion`, Mehrfachauswahl) sind „somnolent oder benommen“ und „verwirrt“ unregelmäßig schon angekreuzt, „seit dem letzten Update“. Das zeigt sich sowohl beim ersten Anzeigen als auch nach dem Zurückspringen.

**Mechanismus**, nachgewiesen mit `--wissen`:
- Beide Antworten deklarieren `; #vermittlung.unmoeglich = Ja`.
- Ab Dispo RD-B setzt der Enricher `VermittlungUnmoeglich` denselben Wert ohne `answerId`.
- Die Oberfläche wertet diesen Wert als Auswahl jeder Antwort, die ihn deklariert (`isAnswerAlreadyKnown` in `knowledge-utils.ts`, seit 2.3.0.1).
- Mit „Weiter“ würden die vorausgewählten Antworten mitgeschickt.

**Varianten** (UI-Test, offizielle Builds, aktueller Katalog):

| Variante | 2.3.0.3 | 2.4.0 |
|---|---|---|
| Pfad aus dem Snap-Screenshot, nur vorwärts (Cerebrales Ereignis, RD-C) | nichts markiert | nichts markiert |
| Zurückspringen nach „somnolent“ (Atemwegsverlegung → Fremdkörper → veränderte Reaktion → somnolent, `"zurueck"`) | somnolent + verwirrt | somnolent + verwirrt |
| Erstes Anzeigen, Dispo vorher RD-B-NBS (Atemnot → Starke Atemnot in Ruhe → veränderte Reaktion) | somnolent + verwirrt | somnolent + verwirrt |
| Dispo erst RD-B-NBS, Atemfrage über die Timeline korrigiert (`"umantworten"`), Dispo sinkt auf RD-C | somnolent + verwirrt, **Bild wie im Snap** | nichts markiert |

- **Herkunft des Werts:** 2.3.0.3 liefert den Enricher-Wert als „geerbt“, 2.4.0 als „Enricher“. Jede Version wertet genau ihre Herkunft aus.
- **Letzte Zeile:** Ohne `AutoUnenrich` (erst ab 2.4.0) bleibt der Wert in 2.3.0.3 stehen, auch wenn die Dispo sinkt. Das erklärt den Snap-Screenshot mit RD-C.
- **Weitere Versionen:** 2.3.0.2 verhält sich wie 2.3.0.3, 2.5.0-rc.1 wie 2.4.0. Die Wiederherstellung kam laut Quellcode mit 2.3.0.1.
- **Katalog:** Enricher und geteiltes Zusatzwissen stehen seit Mai 2026 im Katalog (Kunden-Releases 1-7-4 bis 1-7-9).

**Entscheidung:**
- Kein Katalogfehler im engeren Sinn. Eine Rückkehr zu 2.3.0.3 hilft nicht, dort ist es teils sogar schlimmer.
- Behoben wird es in AUDIS mit **Hotfix 2.4.0.1** (Pull Request #1388, Branch `hotfix-2.4.0.1`): Paare aus Identifier und Wert, die mehrere Antworten einer Frage deklarieren, gelten als mehrdeutig. Werte ohne `answerId` markieren bei solchen Paaren keine Antwort mehr. Die tatsächlich gewählte Antwort bleibt über ihre `answerId` erhalten.
- **Befunde zum Hotfix:**
  - Das Changelog nennt nur das Zurückspringen, der Fix behebt aber auch das erste Anzeigen.
  - Ein Enricher-Wert, den nur eine einzelne Antwort deklariert, würde weiter vorausgewählt. Im SRZ-Katalog betrifft das derzeit keine Frage.
  - Der Hotfix bringt keine Unit-Tests mit.
- **Möglicher Workaround, nur auf Wunsch:** Die beiden Antworten setzen `#vermittlung.unmoeglich` nicht mehr. Stattdessen setzt es derselbe Enricher `VermittlungUnmoeglich`, mit um `contains({#auffaellige.reaktion}, "somnolent", "verwirrt")` erweiterter Bedingung. Ein zweiter Enricher für denselben Identifier würde sich mit ihm gegenseitig überschreiben.
