# Karte des SRZ-Katalogs (Repository audis-srz)

Fragenkatalog der Schutz & Rettung Zürich für die strukturierte Notrufabfrage in AUDIS, für Sanität (144) und Feuerwehr (118). Die Texte sind in Schweizer Schreibweise (ss statt ß: „Strasse“, „gross“) und in der Sprache `ch`.

## Wurzelverzeichnis

| Pfad | Inhalt |
|---|---|
| `questioncatalog/*.audis` | Rund 140 Kataloge |
| `questioncatalog/Handlungsanweisungen/` | Rund 80 Handlungsanweisungen („HA“) |
| `config/enricher-*.json` | Knowledge-Enricher |
| `config/injection-buttons.json` | Injection-Buttons |
| `constants.json` | Szenarien, Dispositionsstufen, Standardantworten, Abbruchgründe |
| `revision-settings.json` | Startkatalog, Visualisierungen, Zwischendisposition, Analyzer |
| `tenant-settings.json` | Mandant `srz` |
| `resources/` | Cockpit-Info, Medien |

## Einstieg und Verteilung

1. **`start.audis`:**
   - Passwortfrage (`#p`, kommt meist per URL-Parameter mit)
   - bei Unwetter-Arbeitsplätzen (`#srz.unwetter.notap`) eine eigene Unwetter-Einstiegsfrage
   - dann die Einstiegsfrage **`#was`** (`visualization = apisearch`) mit über 380 Stichwort-Antworten samt Synonymen
2. **Jede `#was`-Antwort setzt `#kontext`**, den Verteiler auf die Fachkataloge, dazu Vorbelegungen. Häufige Vorbelegungen:
   - `#abc = Pflicht` (medizinisch) bzw. `#abc = Trauma`: ABC-Abfrage über `99-Template-ABC`
   - `#deaktiviere.blutung = Ja`, `#fa.sofortiger.transport = Ja`
   - `#atemfrequenz.messung.freigabe-moeglich = B | B-NBS`
   - `#srz.fallback.med = Ja` bzw. `#srz.fallback.fw = Ja`
   - fachliche Vorbelegungen, z. B. `#trauma.verletzung = …`, `#schmerzen.wo = …`, `#alter.agegroup = Erwachsen`
   - Vorbelegtes Wissen überspringt die gleichnamigen Fragen, siehe [engine-semantics.md](engine-semantics.md).
3. **Fachkataloge** triggern auf `#kontext`, `#was`, `#trauma.verletzung`, `#absprung` usw. Viele medizinische Trigger enthalten zusätzlich `#inj.kontext != Fachanrufer && #inj.kontext != Fallübergabe`.
4. **Absprünge** zwischen Katalogen laufen über zusätzliches Wissen in Antworten: `#absprung = Trauma | Schwangerschaft | …`, `#kontext = Herzkreislaufstillstand` (bei „Keine Atmung“), `#trauma.verletzung = …`.
5. **Abschluss:** Kataloge mit `{ triggertype = final }`, z. B. Handlungsanweisungen, `6-Abschlussfrage-Gewicht-Kind`, `4-Entscheidung`.

## Nummernschema der Dateien

| Präfix | Inhalt |
|---|---|
| `0-` | CPR-Ausstieg (per Injection-Button) |
| `1-Trauma-*` | Trauma-Vorfragen: Absprung, Startfragen, Anzahl Verletzte, Zugänglichkeit |
| `2-*` | Feuerwehr/THL/ABC, Brand-Gebäudebeteiligung |
| `3-*` | Medizinische Fachkataloge, Brand 1–4, Fachanrufer, Fallübergabe, Vermittlung, Amok, GMA |
| `4-*` | Detailkataloge (Trauma-Arten, Schmerzen nach Region, Gynäkologie-Trimenon, FAST, Umwelt), `4-Entscheidung` |
| `5-*` | Massnahmen: CPR, Blutung stillen, Notausstieg, Arbeitsunfall |
| `6-*` | Abschlussfragen |
| `8-`, `9-*` | Wiederaufnahme, Konfiguration (Unwettermodus, **Versionsstring**), Gebietsabdeckung, Test-Ausstieg |
| `99-Template-*` | Bausteine, per `INKLUDIERE` eingebunden |
| `99-Vermittlung-und-PFS` | Bausteine, per `INKLUDIERE` eingebunden |
| `99-Workaround-*`, `99-Zusammenfassungstexte` | Sonderfälle |
| `Handlungsanweisungen/99-HA-*` | Anleitungen für Anrufende |

Einen Katalog zu einem Einstieg findet man so:

```
git grep -n "#kontext = THL Baum" -- questioncatalog
```

`#kontext`-Werte und die Kataloge, die darauf triggern (Stand September 2026):

| `#kontext` | Kataloge |
|---|---|
| Atmung | 3-Atembeschwerden-* (beschleunigt, in Ruhe, leicht, leicht-Kind, unter Anstrengung), 3-Kinder-Asthma |
| Bewusstsein | 3-Bewusstsein, 3-Kinder-AA-Synkope |
| Herzbeschwerden | 3-Herzbeschwerden |
| Herzkreislaufstillstand | 3-Herzkreislaufstillstand, 3-Bewusstsein |
| Blutung | 3-Blutung, 4-Gynaekologie-*-Trimenon |
| Gynäkologie | 3-Gynaekologie-*, 4-Gynaekologie-*-Trimenon |
| Schmerzen | 3-Schmerzen, 4-Schmerzen-* (nach Region), 3-Kinder-Schmerzen, 3-Herzbeschwerden (Brust) |
| Kopfschmerzen | 3-Kopfschmerzen |
| CVI, Neurologisches Ereignis | 3-Neurologisches-Ereignis |
| Medizinisch Sonstiges | 3-Medizinisch-Sonstiges-* (plus Unterscheidung über `#was` / `#was.detail`), 3-Kinder-Fieber |
| Intoxikation | 3-Intoxikation, 3-Kinder-Intoxikation |
| Allergie | 3-Medizinisch-Sonstiges-Allergie |
| Psychiatrie | 3-Psychiatrie |
| Pseudokrupp | 3-Kinder-Pseudokrupp |
| Trauma, Amputation | 3-Trauma-Einstieg-mit-ABC; danach 1-Trauma-*, 4-Trauma-* über `#trauma.verletzung` |
| Brand 1 bis Brand 4 | 2-Brand-Gebaeudebeteiligung, 3-Brand-1 … 3-Brand-4 |
| Brand Fahrzeug, Brand Wasserfahrzeug | 3-Brand-Fahrzeuge, 3-Brand-Wasserfahrzeug |
| exitstrategiebrand | 3-Brand-Exitstrategie |
| Gefahrenmeldeanlage, Rauchmelder | 3-GMA |
| ABC-FW | 2-ABC-FW |
| Umwelt Oel / Geruch / Gewässer / AWEL | 4-Umwelt-* |
| THL Baum / Wasser / Sachgüter | 2-THL-Baum / 2-THL-Wasser / 2-THL-Sicherung-Sachgueter bzw. im Unwettergebiet 2-THL-Unwetter |
| weitere THL-Werte (THL Personenrettung, Tierrettung, Tram, Zug, Verkehrsregelung, Wespen, Bienen, Sprungretter, Strom, Partner, ECMO IABP, Exitstrategie, sinkendes Fzg, Wasserfahrzeuge) | 2-THL-* bzw. 3-THL-Strom |
| Flugzeugabsturz, Bombendrohnung, Amok, Interventionseinsatz | 3-Flugzeugabsturz, 2-THL-Bombe, 3-Amok, 3-Interventionseinsatz |
| Verlegung, Einweisung | 3-Verlegung_Einweisung |
| Vermittlung Notfallpraxis | 3-Vermittlung |
| Organtransport, Bluttransport | 3-Organtransport, 3-Bluttransport |
| Notausstieg | 5-Notausstieg, 3-Medizinisch-Sonstiges-Unbekannter-Zustand |
| Konfiguration, Gebietsabdeckung | 9-Konfiguration, 9-Gebietsabdeckung |

## Zentrale Knowledge-Identifier

| Identifier | Werte / Bedeutung | Gesetzt in |
|---|---|---|
| `#was` | Antworttext der Einstiegssuche | start.audis, Injection-Buttons |
| `#was.initial` | erster `#was`-Wert, bleibt erhalten | enricher-start.json |
| `#kontext` | Verteiler auf Fachkataloge (siehe oben) | start.audis, einzelne Antworten, Enricher |
| `#abc` | `Pflicht`, `Trauma`: ABC-Template | start.audis |
| `#alter`, `#alter.agegroup` | Alter; `Säugling`, `Kleinkind`, `Kind/Jugend`, `Erwachsen` | 99-Template-Alter-Geschlecht (`visualization = age`), Vorbelegung `#alter = x` |
| `#geschlecht` | Geschlecht | 99-Template-Alter-Geschlecht |
| `#atmung` | `normal`, `auffällig`, `unsicher`, `Nein` | 99-Template-ABC |
| `#atemnot` | `leichte Atembeschwerden`, `unter Anstrengung`, `ohne Anstrengung`, `beschleunigt`, `verlegt`, `Schnappatmung` … | 99-Template-ABC / -Atemanalyse, start.audis |
| `#atemfrequenz` | `normal`, `zu hoch`, `zu niedrig` | enricher-atemfrequenz.json (aus `#atemfrequenz.messung`) |
| `#reaktion` | `normal`, `war bewusstlos`, `auffällig`, `keine` | 99-Template-Reaktion |
| `#reaktion.weckbar` | `Ja`, `Nein` | 99-Template-Weckbar |
| `#kritisch` | `Ja`, `Nein`: Score-Summe aus Kreislaufbeschwerden | enricher-mehrfachantworten.json |
| `#vermittlung.unmoeglich` | `Ja`: keine Selbstvorstellung / Vermittlung anbieten | diverse Antworten, Enricher |
| `#selbstaendig-gehen`, `#selbstaendig.aerztliche-hilfe-holen` | Selbstvorstellung möglich | 99-Vermittlung-und-PFS |
| `#person.mobil`, `#person.draussen` | Mobilität / Person im Freien | Fragen, Injection-Button „Person draussen“ |
| `#pfs-einsatzgebiet` | `Ja` (sonst nicht gesetzt!) aus PLZ | enricher-ortsbezogen.json |
| `#srz.einsatzgebiet-srz-bf`, `#srz.einsatzgebiet-san` | `Ja` aus PLZ (`#audis.initial.zip`) | enricher-ortsbezogen.json |
| `#trauma.verletzung` | Verletzungsart (Sturz, Verkehrsunfall, Stichverletzung …) | start.audis, 3-Trauma-Einstieg-mit-ABC (apisearch) |
| `#absprung` | Sprung in andere Kataloge (`Trauma`, `Schwangerschaft`, `THL Tram` …) | Antworten |
| `#inj.kontext` | `Fachanrufer`, `Fallübergabe` | Injection-Buttons |
| `#srz.unwetter.*` | Unwettermodus: `ktzh`/`stzh`/`aktiv` (Analyzer), `aktiv-gebiet`, `notap` (Enricher) | Analyzer storm-mode, enricher-unwetter.json |
| `#eta-anzeige`, `#defi-anzeige`, `#wetter-anzeige` | Steuerflags für Assistenten/Analyzer | Antworten, Enricher |
| `#srz.test.arbeitsplatz` | Testarbeitsplatz (aus `#audis.initial.logon`) | enricher-testing.json |

## Templates (per `INKLUDIERE`)

Alle haben den Platzhalter-Trigger `#inkludebugfix = Version18`. Einige triggern sich zusätzlich über ihr eigenes Wissen (z. B. `#alter => VORHANDEN`), damit die Antworten nach einem Kontextwechsel in der Zusammenfassung bleiben.

| Template | Zweck |
|---|---|
| `99-Template-ABC` | ABC-Abfrage (Atmung, Blutung, Reaktion) inkl. Kinder, viele Dispo-Szenarien |
| `99-Template-Alter-Geschlecht` | Alter (age-Visualisierung) und Geschlecht |
| `99-Template-Atemanalyse` | Atemdetektor / Atemfrequenz |
| `99-Template-Reaktion`, `99-Template-Weckbar` | Reaktion, Weckbarkeit |
| `99-Template-Kreislaufbeschwerden` | Mehrfachauswahl mit Scores, daraus `#kritisch` |
| `99-Template-Schmerzen-Ruheposition` | Schmerzstärke in Ruhe, `#ruheposition.schmerzen` |
| `99-Template-Blutung`, `99-Template-Blutung-stillbar` | Blutung |
| `99-Template-Sichere-Todeszeichen` | Todeszeichen |
| `99-Template-Unklare-Situation` | Unklare Lage / Notausstieg |
| `99-Template-Brandausbreitung`, `99-Template-Bahn` | Feuerwehr-Bausteine |
| `99-Vermittlung-und-PFS` | Selbstvorstellung, PFS-Einsatz, Vermittlung (Notfallarzt, Beratung, Spezialärzte); rund 40 einbindende Kataloge |

Wo ein Template eingebunden ist:

```
git grep -n "INKLUDIERE { 99-Template-Kreislaufbeschwerden }" -- questioncatalog
```

## Handlungsanweisungen (`Handlungsanweisungen/99-HA-*`)

- Meist eine Frage mit `{ visualization = instruction }`, die Schritte stehen als Antworten in Anführungszeichen: `"**Titel**<br>Erläuterung"`.
- Eingebunden werden sie per `INKLUDIERE { Handlungsanweisungen/99-HA-… }` oder über einen eigenen Trigger mit `{ triggertype = final }` (erscheint am Ende).
- Standard-Schlusssatz:
  - Sanität: `"**Bei einer Situationsveränderung wählen Sie bitte erneut 144**<br>z.B. …"`
  - Feuerwehr: `"… erneut 118 …"`

## Szenarien und Dispositionsstufen (constants.json)

Szenarien-Codes im Katalog: `@A-Einsatz`, `@A-EinsatzFR`, `@A-Einsatz-Kind`, `@A-Einsatz-Kind-FR`, `@A-Einsatz-NEO`, `@A-Einsatz-FW`, `@B-Einsatz`, `@B-Einsatz-NBS`, `@B-Einsatz-NBS-Manuell`, `@B-Einsatz-FW`, `@B-Einsatz-NBS-FW`, `@B-Einsatz-Pikett`, `@C-Einsatz`, `@C-Einsatz-FW`, `@PFS`, `@Vermittlung-*`, `@BeratungAuskunft`, `@Brand1` … `@Brand4`, `@TH1-*`, `@TH2-*`, `@TH3-*`, `@GF1-*` … `@GF4-*`, `@BMA`/`@GWA`/`@WMA`/`@SPA`, Organ- und Bluttransport, Interventionseinsatz, Test.

Prioritäten der Dispositionsstufen (höher gewinnt; Stand September 2026 – bei Bedarf in `constants.json` prüfen):

| Priorität | Codes |
|---|---|
| 1300 / 1250 / 1225 | FW-GF4 / FW-GF3 / FW-TH3 |
| 1200 | RD-A-FR, FW-THx, FW-B4 |
| 1150 | RD-A-NEO, FW-GF2 |
| 1100 | RD-A, FW-B3 |
| 1050 | FW-B2 |
| 1000 | RD-B-NBS, FW-TH2 |
| 999 | RD-B-NBS ⌛ (manuell) |
| 950 | FW-TH2-Unwetter |
| 900 | RD-B, RD-B-PIKETT, FW-B1, FW-GF1 |
| 850 | FW-TH1 |
| 800 | RD-C |
| 700 | RD-D |
| 500 | Kein-Einsatz (Vermittlung, Beratung) |

Ein Szenario kann mehrere Codes haben (z. B. `A-Einsatz-FW` = RD-A + FW-THx). Neue Szenarien brauchen einen Eintrag in `constants.json` mit `ScenarioIdentifier`, `Name`, `DispositionCodes` und `ExternalApiIdentifier`. Letzteres ist der Code für das Einsatzleitsystem, z. B. `13.1.1.3`. Code und Stufe gibt SRZ vor.

## Enricher-Dateien (config/)

| Datei | Inhalt |
|---|---|
| `enricher-start.json` | `#was.initial`, Texte „Initiale Notrufmeldung“ / Wechsel |
| `enricher-mehrfachantworten.json` | Score-Summen, daraus `#kritisch`, `#allergie.kritisch`, `#fast.kritisch`, Schwangerschaft, APGAR … |
| `enricher-atemfrequenz*.json` | Atemfrequenz je Altersgruppe, daraus `normal` / `zu hoch` / `zu niedrig` |
| `enricher-bedingungen.json` | Fieber- und Blutdruckkategorien, Kälte, Verbrennungsfläche, ETA |
| `enricher-körperregion.json` | Gruppierung von Körperstellen (Schmerz, Stich, Schuss, Biss, Stumpf) |
| `enricher-ortsbezogen.json` | PLZ-Gebiete (PFS, SRZ Sanität/Feuerwehr, Flughafen) |
| `enricher-unwetter.json` | Unwetter-Arbeitsplätze, aktives Gebiet, Einstieg THL Unwetter |
| `enricher-dispo-code.json` | Wissen aus `#audis.dispo`: GWR-Daten, ETA, Rettungseinsatz, `#vermittlung.unmoeglich = Ja` ab RD-B (`VermittlungUnmoeglich`, überschreibt gleichnamiges Antwortwissen, siehe engine-semantics.md) |
| `enricher-alter-geschlecht.json` | Alterstext für die Zusammenfassung |
| `enricher-testing.json` | Testarbeitsplätze |
| weitere | abc, assistenten, brand, gefahrgut, gesetzt, schmerzen, schwangerschaft, suffix |

## Injection-Buttons

CPR, med. Fachanruf (`#inj.kontext = Fachanrufer`), Fallübergabe, Vermittlung, Keine Information (Notausstieg), Person draussen, Testeinsatz SAN/FW, Assistenten aktualisieren.

## Unwettermodus

1. `9-Konfiguration` setzt `#srz.unwetter.set-ktzh` bzw. `#srz.unwetter.set-stzh`. Der Analyzer storm-mode macht daraus systemweit `#srz.unwetter.ktzh` / `stzh` / `aktiv`.
2. `enricher-unwetter.json` leitet `#srz.unwetter.aktiv-gebiet` ab: Stadt = SRZ-BF-Gebiet plus Stadtmodus, Kanton = ausserhalb plus Kantonsmodus.
3. Im aktiven Gebiet triggert für THL Baum / Wasser / Sachgüter direkt `2-THL-Unwetter`. Die normalen Kataloge schliessen das über `#srz.unwetter.aktiv-gebiet != Ja` im Trigger aus.
4. Unwetter-Arbeitsplätze (`#srz.unwetter.notap`, aus `#audis.initial.logon`) erhalten in `start.audis` eine eigene Einstiegsfrage.

## Versionsstring

`questioncatalog/9-Konfiguration.audis` enthält `* Aktuelle Version: **1.x.y-rc.n**`. Diese Zeile **pflegt ausschliesslich der Kunde** bei seinen Release-Kandidaten – nie ändern.
