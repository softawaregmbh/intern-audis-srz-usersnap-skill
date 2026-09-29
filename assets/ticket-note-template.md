# Vorlage: interne Usersnap-Notiz

Kurz und sachlich, für SRZ-Testerinnen und -Tester verständlich, ohne Code-Jargon. Katalog- und Dateinamen nur, wenn sie beim Testen helfen. Es gibt zwei Varianten: Katalogänderung und Softwarefehler.

## Variante A: Katalogänderung

---

**Analyse:** <Was passiert heute und warum – ein bis drei Sätze, z. B. „Beim Einstieg über Sturz wechselt die Abfrage bei ‚keine Atmung‘ zu Herzkreislaufstillstand, die Detailfragen aus Trauma bleiben aber aktiv.“>

**Anpassung:** <Was wurde geändert – fachlich formuliert, z. B. „Detailfragen zu Verletzungen werden nicht mehr gestellt, wenn keine Atmung oder keine Reaktion vorliegt (Schnitt-, Stich-, Stromunfall, Sturz, Tauchunfall, VU).“>

**Testpfad:**
1. <Einstieg, z. B. „Sturz“>
2. <Antworten Schritt für Schritt>
3. Erwartet: <Frage X erscheint nicht / Szenario „B Einsatz NBS“ / Handlungsanweisung Y>

Screenshots vorher/nachher: `usersnaps/<nr>/` im Katalog-Repository.

**Offene Fragen:** <Was SRZ entscheiden soll, z. B. „Soll die Frage ‚Haben Sie das Ereignis beobachtet?‘ in diesem Fall auch entfallen?“ – sonst weglassen>

---

Status danach: „muss geprüft werden“ (setzt die Person, die den Snap bearbeitet).

## Variante B: Softwarefehler (keine Katalogänderung)

---

**Analyse:** <Was passiert und warum, ohne Code-Jargon, z. B. „Das Vorankreuzen ist ein Fehler in der AUDIS-Oberfläche: Zwei Antworten vermerken dasselbe, und AUDIS setzt diesen Vermerk ab Dispo RD-B auch selbst; die Oberfläche hält dann beide Antworten für gewählt.“> <Versionsvergleich, z. B. „Tritt in AUDIS 2.3.0.3 und 2.4.0 auf – eine Rückkehr zur Vorversion hilft nicht.“>

**Anpassung:** Keine Änderung am Fragenkatalog. Die Korrektur kommt mit AUDIS <Version, z. B. 2.4.0.1>.

**Testpfad (nach dem AUDIS-Update):**
1. <Einstieg>
2. <Antworten, ggf. „in der Timeline zurück zu …“>
3. Erwartet: <z. B. „bei ‚Wie zeigt sich die veränderte Reaktion?‘ ist nichts angekreuzt“>

Screenshots je Version: `usersnaps/<nr>/` im Katalog-Repository (falls committet).

**Offene Fragen:** <z. B. „Falls das Update nicht zeitnah kommt: Ist eine Übergangslösung im Katalog gewünscht?“ – sonst weglassen>

---

Status danach: mit Entwicklung und SRZ abstimmen. Typischerweise bleibt der Snap offen, bis das AUDIS-Update eingespielt ist, und geht dann auf „muss geprüft werden“.
