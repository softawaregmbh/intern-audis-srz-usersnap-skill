#!/usr/bin/env node
// Spielt Abfragepfade über die AUDIS-API mit dem echten AUDIS-Server durch – für den Vergleichsstand
// (vorher) und das Arbeitsverzeichnis (nachher), optional mit mehreren AUDIS-Versionen – und prüft
// Erwartungen an Fragen, Dispo, Wissen, Zusammenfassung und Parsermeldungen.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
    AGE_GROUP_LABELS,
    PathError,
    UsageError,
    ageGroupNumber,
    api,
    breathingSpec,
    buildStash,
    diagnostics,
    dispoOf,
    eqi,
    findAnswerSpec,
    instructionSpec,
    knowledgeDiff,
    knowledgeMap,
    labelledInput,
    loadPathFile,
    norm,
    plain,
    prepareStands,
    removeDir,
    report,
    resolveServer,
    respiratoryActionThreshold,
    runMain,
    scenariosOf,
    serverVersion,
    startServer,
    stopAll,
    summary
} from './lib/audis.mjs';

const USAGE = `Aufruf: node simulate.mjs <pfad.json> [weitere.json …] [Optionen]

Spielt die Pfade über die AUDIS-API mit dem echten AUDIS-Server durch: mit dem Vergleichsstand
(vorher) und dem Arbeitsverzeichnis (nachher). Die Server starten einmal pro Aufruf.

Optionen:
  --base <ref>        Vergleichsstand für "vorher" (Standard: HEAD)
  --stand <ref>       für "nachher" diesen Git-Stand statt des Arbeitsverzeichnisses verwenden
  --ohne-vergleich    nur den aktuellen Stand durchspielen
  --version <v>       AUDIS-Version (z. B. 2.3.0.3, latest); mehrfach angeben zum Vergleichen.
                      Fehlende Versionen werden wie in der AUDIS-Erweiterung geladen (Lizenzschlüssel).
                      Statt einer Version die Snap-URL angeben: nimmt die Version dieser Umgebung.
                      "erweiterung" = Server der AUDIS-Erweiterung. Ohne --version: neueste lokale Version.
  --audis <datei>     AUDIS-Server direkt angeben (Audis.Web.exe bzw. Ordner)
  --server <url>      laufenden AUDIS-Server verwenden, z. B. http://localhost:50042 (kein Vergleich)
  --repo <pfad>       Katalog-Repository (Standard: aktuelles Verzeichnis)
  --wissen            Wissensänderungen pro Schritt ausgeben (wie das Debug-Widget)
  --stash-speichern <datei>
                      Endzustand als Knowledge Stash speichern (Import im Debug-Widget der Vorschau:
                      „Importieren und wiederherstellen“); bei mehreren Läufen mit Zusatz im Dateinamen
  --mandant <name>    Mandant im lokalen Modus (Standard: Lokal)

Pfaddatei: "stash": "<datei>" startet den Pfad aus einem Knowledge Stash (Snap-Daten oder Debug-Widget).
Anleitungen: "Durchgeführt, erfolgreich" (kurz "Durchgeführt"), "Durchgeführt, ohne Erfolg", "Nicht durchgeführt".
Eingabefelder mit Beschriftung: "Label: Freitext", z. B. "Ja: Endometriose" für die Antwort „Ja: ___“.
Atemfrequenz-Frage: Zahl oder { "atemfrequenz": 9, "cpr": true } (Knopf „CPR empfohlen“); ob die Oberfläche
den Knopf anbietet, bildet das Skript nach ("stoppuhr" gibt es nur im UI-Test).

Exit-Code: 0 = Prüfungen erfüllt, 1 = Prüfung verfehlt, 2 = Aufruf-, Pfad- oder Serverfehler.`;

const MAX_STEPS = 250;
const MAX_SAME_QUESTION = 3;
const ORIGIN_CLIENT = 1;
const ANSWER_TYPE_INPUT = 2;
const FLAG_UNKNOWN_ANSWER = 1 << 0;
const FLAG_SUMMARY_ANSWER = 1 << 1;
const FLAG_IGNORE_IN_SUMMARY = 1 << 3;
const FLAG_INPUT_ANSWER = 1 << 4;
// Altersgruppen der Alters-Visualisierung (Beschriftungen der AUDIS-Oberfläche, de/ch).
const AGE_GROUPS = ['Säugling', 'Kleinkind', 'Kind/Jugend', 'Erwachsen'];

// ---------------------------------------------------------------- Antworten wie die Oberfläche bilden

function primaryValue(question, answer) {
    const knowledge = answer.knowledge?.find((k) => eqi(k.knowledgeIdentifier, question.knowledgeIdentifier));
    return knowledge?.values?.[0]?.knowledgeValue;
}

function selectionAnswer(answer) {
    const text = answer.text?.trim();
    return {
        ...answer,
        knowledge: (answer.knowledge ?? []).map((k) =>
            k.values.length === 0 && text
                ? { ...k, origin: ORIGIN_CLIENT, values: [{ answerId: answer.id, knowledgeValue: text }] }
                : { ...k, values: k.values.map((v) => ({ ...v })) }
        )
    };
}

function inputAnswer(question, answer, value) {
    const flagged = (answer.knowledge ?? []).filter((k) => ((k.metadata?.flags ?? 0) & FLAG_INPUT_ANSWER) !== 0);
    const target =
        (flagged.length === 1 ? flagged[0] : (flagged.find((k) => k.values.length === 0) ?? flagged[0])) ??
        answer.knowledge?.find((k) => eqi(k.knowledgeIdentifier, question.knowledgeIdentifier)) ??
        answer.knowledge?.[0];
    if (!target) throw new PathError(`Eingabeantwort ohne Wissen bei „${plain(question.text)}“.`);
    return {
        ...answer,
        knowledge: answer.knowledge.map((k) =>
            k === target
                ? { ...k, origin: ORIGIN_CLIENT, values: [{ answerId: answer.id, knowledgeValue: value }] }
                : { ...k, values: k.values.map((v) => ({ ...v })) }
        )
    };
}

function unknownAnswer(question, unknown) {
    const answers = question.answers ?? [];
    const answerId = `${question.id}/${answers.length + 1}`;
    const configured = answers.find((a) => eqi(a.text, unknown.text));
    const override = configured?.knowledge?.filter((k) => eqi(k.knowledgeIdentifier, question.knowledgeIdentifier)).flatMap((k) => k.values) ?? [];
    return {
        id: answerId,
        type: answers.length > 0 && answers.every((a) => a.type === ANSWER_TYPE_INPUT) ? ANSWER_TYPE_INPUT : 1,
        text: unknown.text,
        knowledge: [
            {
                knowledgeIdentifier: question.knowledgeIdentifier,
                origin: ORIGIN_CLIENT,
                metadata: { flags: FLAG_UNKNOWN_ANSWER },
                values: override.length > 0 ? override : [{ knowledgeValue: unknown.knowledgeValue, answerId }]
            },
            ...(configured?.knowledge?.filter((k) => !eqi(k.knowledgeIdentifier, question.knowledgeIdentifier)) ?? [])
        ]
    };
}

function instructionAnswer(question, spec) {
    // Knöpfe einer Anleitung wie die Oberfläche: Primärwissen mit den Werten des Knopfs, für die Zusammenfassung markiert.
    const answerId = `${question.id}/${(question.answers ?? []).length + 1}`;
    return {
        id: answerId,
        type: 1,
        text: spec.label,
        knowledge: [
            {
                knowledgeIdentifier: question.knowledgeIdentifier,
                origin: ORIGIN_CLIENT,
                metadata: { flags: FLAG_SUMMARY_ANSWER },
                values: spec.values.map((v) => ({ answerId, knowledgeValue: v }))
            }
        ]
    };
}

function knowledgeAnswer(question, spec) {
    // Direkt vorgegebenes Wissen, z. B. für Spezial-Visualisierungen (Datum, Körper, Ort).
    return {
        id: `${question.id}/1`,
        type: 1,
        text: Object.values(spec).join(', '),
        knowledge: Object.entries(spec).map(([identifier, value]) => ({
            knowledgeIdentifier: identifier.startsWith('#') ? identifier : `#${identifier}`,
            origin: ORIGIN_CLIENT,
            values: (Array.isArray(value) ? value : [value]).map((v) => ({ answerId: `${question.id}/1`, knowledgeValue: String(v) }))
        }))
    };
}

function ageAnswer(question, wanted, settings) {
    // Nachbau der Alters-Visualisierung: Jahre oder Altersgruppe → #alter, .age, .days, …, Altersgruppe.
    const id = question.knowledgeIdentifier;
    const groupIdentifier = settings?.visualization?.ageGroup?.ageGroupIdentifier || `${id}.agegroup`;
    const answerId = `${question.id}/1`;
    const entry = (identifier, value, flags) => ({
        knowledgeIdentifier: identifier,
        origin: ORIGIN_CLIENT,
        metadata: { flags },
        values: [{ answerId, knowledgeValue: String(value) }]
    });
    const group = AGE_GROUPS.find((g) => eqi(g, wanted));
    if (group) {
        return { id: answerId, type: 1, text: group, knowledge: [entry(id, group, FLAG_IGNORE_IN_SUMMARY), entry(groupIdentifier, group, FLAG_SUMMARY_ANSWER)] };
    }
    const years = Number(String(wanted).trim().replace(',', '.'));
    if (!Number.isFinite(years) || years < 0 || years > 130) return null;
    const days = Math.round(years * 365.25);
    const ageGroup = days < 365 ? 'Säugling' : years < 7 ? 'Kleinkind' : years < 16 ? 'Kind/Jugend' : 'Erwachsen';
    return {
        id: answerId,
        type: 1,
        text: `${years} Jahre (${ageGroup})`,
        knowledge: [
            entry(id, years, FLAG_SUMMARY_ANSWER),
            entry(`${id}.age`, Math.floor(years), 0),
            entry(`${id}.days`, days, 0),
            entry(`${id}.weeks`, Math.floor(days / 7), 0),
            entry(`${id}.months`, Math.floor(years * 12), 0),
            entry(`${id}.year`, new Date().getFullYear() - Math.floor(years), 0),
            entry(groupIdentifier, ageGroup, FLAG_IGNORE_IN_SUMMARY)
        ]
    };
}

function respiratoryAnswer(question, spec, settings, knowledge) {
    // Nachbau der Atemfrequenz-Visualisierung: Die Frequenz geht als Eingabe an den Server. "cpr" entspricht dem Knopf
    // „CPR empfohlen“, der zusätzlich KnowledgeToAddBeneathLowerThreshold setzt; die Oberfläche zeigt ihn nur unterhalb
    // des Grenzbereichs. "stoppuhr" gibt es nur im UI-Test.
    const groupIdentifier = settings?.visualization?.ageGroup?.ageGroupIdentifier || '#alter.agegroup';
    const group = knowledge.find((k) => eqi(k.knowledgeIdentifier, groupIdentifier))?.values?.[0]?.knowledgeValue;
    const ageGroup = ageGroupNumber(group) ?? 4;
    const grenze = respiratoryActionThreshold(settings, ageGroup);
    const cprKnopf = spec.wert < grenze[0];
    const knopf = cprKnopf ? 'Zu niedrig' : spec.wert > grenze[1] ? 'Zu hoch' : 'Normal';
    const extra = settings?.visualization?.respiratory?.knowledgeToAddBeneathLowerThreshold;
    if (spec.cpr && !cprKnopf) {
        throw new PathError(`„CPR empfohlen“ bietet die Oberfläche bei ${spec.wert}/min nicht an (Grenzbereich ${grenze.join('–')}/min, ${AGE_GROUP_LABELS[ageGroup]}).`);
    }
    if (spec.cpr && !extra?.knowledgeIdentifier) throw new PathError('"cpr": KnowledgeToAddBeneathLowerThreshold ist in revision-settings.json nicht konfiguriert.');
    const answerId = `${question.id}/${(question.answers ?? []).length + 1}`;
    const entry = (identifier, value, flags) => ({ knowledgeIdentifier: identifier, origin: ORIGIN_CLIENT, metadata: { flags }, values: [{ answerId, knowledgeValue: String(value) }] });
    return {
        answer: {
            id: answerId,
            type: ANSWER_TYPE_INPUT,
            text: String(spec.wert),
            knowledge: [entry(question.knowledgeIdentifier, spec.wert, FLAG_SUMMARY_ANSWER), ...(spec.cpr ? [entry(extra.knowledgeIdentifier, extra.knowledgeValue, 0)] : [])]
        },
        beobachtung: { wert: spec.wert, altersgruppe: AGE_GROUP_LABELS[ageGroup], grenze, cprKnopf, knopf, geklickt: spec.cpr ? 'CPR empfohlen' : knopf, stoppuhr: null, nachgebildet: true }
    };
}

function resolveOne(question, wanted, context) {
    const { unknown, settings } = context;
    if (question.visualization === 'respiratory') {
        const breathing = breathingSpec(wanted);
        if (breathing) {
            const { answer, beobachtung } = respiratoryAnswer(question, breathing, settings, context.knowledge);
            context.atemfrequenz = beobachtung;
            return answer;
        }
    }
    if (wanted && typeof wanted === 'object') {
        if (!wanted.wissen || typeof wanted.wissen !== 'object') throw new PathError(`Antwortobjekt ohne "wissen" bei „${plain(question.text)}“.`);
        return knowledgeAnswer(question, wanted.wissen);
    }
    if (question.visualization === 'age') {
        const age = ageAnswer(question, wanted, settings);
        if (age) return age;
        throw new PathError(`Alter „${wanted}“ bei „${plain(question.text)}“: Jahre (z. B. 45) oder ${AGE_GROUPS.join(', ')} angeben.`);
    }
    if (question.visualization === 'instruction') {
        const spec = instructionSpec(wanted);
        if (spec) return instructionAnswer(question, spec);
    }
    const w = norm(wanted);
    const answers = question.answers ?? [];
    const selections = answers.filter((a) => a.type !== ANSWER_TYPE_INPUT);
    const inputs = answers.filter((a) => a.type === ANSWER_TYPE_INPUT);
    const exact = selections.filter((a) => norm(a.text) === w || norm(a.rawText) === w || norm(primaryValue(question, a)) === w);
    if (exact.length >= 1) return selectionAnswer(exact[0]);
    const labelled = labelledInput(inputs, wanted);
    if (labelled) return inputAnswer(question, labelled.answer, labelled.value);
    if (unknown && (w === norm(unknown.text) || w === norm(unknown.knowledgeValue))) return unknownAnswer(question, unknown);
    const partial = selections.filter((a) => norm(a.text).includes(w));
    if (partial.length === 1) return selectionAnswer(partial[0]);
    if (partial.length > 1) {
        throw new PathError(`Antwort „${wanted}“ ist bei „${plain(question.text)}“ mehrdeutig: ${partial.slice(0, 12).map((a) => `„${plain(a.text)}“`).join(', ')}`);
    }
    if (inputs.length === 1) return inputAnswer(question, inputs[0], String(wanted));
    const options = selections.slice(0, 20).map((a) => `„${plain(a.text)}“`).join(', ');
    throw new PathError(
        `Antwort „${wanted}“ passt zu keiner Antwort von „${plain(question.text)}“ (${question.knowledgeIdentifier}).` +
            (options ? ` Möglich: ${options}${selections.length > 20 ? ', …' : ''}` : '') +
            (inputs.length ? ' (Eingabefeld vorhanden)' : '')
    );
}

function mergeAnswers(knowledge, answers) {
    const grouped = new Map();
    for (const k of answers.flatMap((a) => a.knowledge ?? [])) {
        const entry = grouped.get(k.knowledgeIdentifier);
        if (entry) entry.values.push(...k.values);
        else grouped.set(k.knowledgeIdentifier, { knowledgeIdentifier: k.knowledgeIdentifier, values: [...k.values], origin: ORIGIN_CLIENT, metadata: k.metadata, summaryRepresentation: k.summaryRepresentation });
    }
    const replaced = new Set(grouped.keys());
    return [...knowledge.filter((k) => !replaced.has(k.knowledgeIdentifier)), ...grouped.values()];
}

function buildRequest(state, knowledge, selectedAnswers) {
    return {
        id: state.id,
        externalId: state.externalId,
        userId: state.userId,
        processStepId: state.processStepId,
        currentQuestion: state.currentQuestion,
        selectedAnswers,
        knowledge,
        currentBranch: state.currentBranch,
        nominatedScenarios: (state.nominatedScenarios ?? []).map((s) => ({ scenarioIdentifier: s.scenario?.scenarioIdentifier, nominatedAtProcessStepId: s.nominatedAtProcessStepId })),
        currentCatalogSearchOptions: state.currentCatalogSearchOptions,
        intermediateDisposition: null,
        data: null,
        timeline: state.timeline,
        injectionState: state.injectionState,
        runtimeState: state.runtimeState
    };
}

async function playPath(server, pfad) {
    const { base, tenant } = server;
    const settings = await api(base, 'GET', `/settings/${tenant}`).catch(() => null);
    const unknown = settings?.unknownAnswer ?? { text: 'Unbekannt', knowledgeValue: 'unbekannt' };
    const initialKnowledge = Object.entries(pfad.start ?? {}).map(([key, value]) => ({
        knowledgeIdentifier: key.startsWith('#') ? key : `#${key}`,
        origin: ORIGIN_CLIENT,
        values: [{ answerId: null, knowledgeValue: String(value) }]
    }));
    let state = await api(base, 'POST', `/interrogation/${tenant}/Start`, { interrogationId: randomUUID(), initialKnowledge, tryResume: false });

    // Knowledge Stash wiederherstellen wie das Debug-Widget: laufende Abfrage mit dem Wissen des Stash verarbeiten.
    let start = null;
    if (pfad.stashEntry) {
        state = await api(base, 'POST', `/interrogation/${tenant}/Process`, buildRequest(state, structuredClone(pfad.stashEntry.knowledge), []));
        start = { name: pfad.stashEntry.name, frage: state.currentQuestion, dispo: dispoOf(state) };
    }

    const steps = [];
    const usedKeys = new Set();
    const seen = new Map();
    let end = null;
    for (let i = 0; i < MAX_STEPS && !end; i++) {
        const question = state.currentQuestion;
        if (state.isComplete || !question) {
            end = { art: 'abgeschlossen' };
            break;
        }
        const spec = findAnswerSpec(question, pfad.antworten);
        if (!spec) {
            end = { art: 'offen', frage: question };
            break;
        }
        const count = (seen.get(question.id) ?? 0) + 1;
        seen.set(question.id, count);
        if (count > MAX_SAME_QUESTION) {
            throw new PathError(`„${plain(question.text)}“ wird immer wieder gestellt – die Antwort „${typeof spec.value === 'object' ? JSON.stringify(spec.value) : spec.value}“ wird nicht übernommen.`);
        }
        usedKeys.add(spec.key);
        const context = { unknown, settings, knowledge: state.knowledge, atemfrequenz: null };
        const answers = [].concat(spec.value).map((w) => resolveOne(question, w, context));
        let knowledge = mergeAnswers(state.knowledge, answers);
        if (!knowledge.some((k) => k.knowledgeIdentifier === question.knowledgeIdentifier)) {
            knowledge = [...knowledge, { knowledgeIdentifier: question.knowledgeIdentifier, values: [], origin: ORIGIN_CLIENT }];
        }
        const next = await api(base, 'POST', `/interrogation/${tenant}/Process`, buildRequest(state, knowledge, answers));
        const breathing = context.atemfrequenz;
        steps.push({
            frage: question,
            antwort: breathing ? `${breathing.wert}/min, Knopf „${breathing.geklickt}“` : answers.map((a) => plain(a.text ?? a.rawText)).join(', '),
            dispo: dispoOf(next),
            wissen: knowledgeDiff(state.knowledge, next.knowledge),
            ...(breathing ? { atemfrequenz: breathing } : {})
        });
        state = next;
    }
    if (!end) throw new PathError(`Mehr als ${MAX_STEPS} Schritte – Pfad endet nicht.`);
    return {
        start,
        finalState: state,
        vorschau: { tenantId: settings?.tenantId ?? tenant, revisionId: settings?.revisionId ?? null },
        steps,
        end,
        dispo: dispoOf(state),
        szenarien: scenariosOf(state),
        wissen: knowledgeMap(state.knowledge),
        zusammenfassung: await summary(base, tenant, state),
        diagnose: await diagnostics(base, tenant),
        unbenutzt: Object.keys(pfad.antworten).filter((k) => !usedKeys.has(k))
    };
}

// ---------------------------------------------------------------- Hauptprogramm

function parseArgs(argv) {
    const opts = { repo: process.cwd(), base: 'HEAD', stand: null, vergleich: true, server: null, audis: null, versionen: [], wissen: false, stashSpeichern: null, mandant: 'Lokal', pfade: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const value = () => {
            if (i + 1 >= argv.length) throw new UsageError(`${a} erwartet einen Wert.`);
            return argv[++i];
        };
        if (a === '--base') opts.base = value();
        else if (a === '--stand') opts.stand = value();
        else if (a === '--ohne-vergleich') opts.vergleich = false;
        else if (a === '--server') opts.server = value().replace(/\/+$/, '');
        else if (a === '--audis') opts.audis = value();
        else if (a === '--version') opts.versionen.push(value());
        else if (a === '--repo') opts.repo = path.resolve(value());
        else if (a === '--wissen') opts.wissen = true;
        else if (a === '--stash-speichern') opts.stashSpeichern = path.resolve(value());
        else if (a === '--mandant') opts.mandant = value();
        else if (a === '-h' || a === '--help') {
            console.log(USAGE);
            process.exit(0);
        } else if (a.startsWith('--')) throw new UsageError(`Unbekannte Option ${a}.`);
        else opts.pfade.push(a);
    }
    if (opts.pfade.length === 0) throw new UsageError('Pfaddatei fehlt.');
    return opts;
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const pfade = opts.pfade.map(loadPathFile);
    const runsByPath = pfade.map(() => []);
    for (const p of pfade) {
        if (p.umantworten?.length) console.log(`Hinweis: "umantworten" in ${path.basename(p.datei)} wird nur von ui-test.mjs ausgeführt.`);
    }

    if (opts.server) {
        const server = { base: `${opts.server}/api`, tenant: opts.mandant };
        server.version = await serverVersion(server.base);
        console.log(`Server: ${opts.server} (AUDIS ${server.version}, laufende Instanz, kein Vergleich)`);
        for (let p = 0; p < pfade.length; p++) runsByPath[p].push({ stand: 'stand', server: 'laufend', label: 'laufender Server', result: await playPath(server, pfade[p]) });
    } else {
        const versions = opts.versionen.length ? opts.versionen : [null];
        const servers = [];
        for (const v of versions) servers.push(await resolveServer({ audis: opts.audis, version: v }));
        const { root, stands } = prepareStands(opts);
        try {
            const jobs = servers.flatMap((server, index) => stands.map((stand) => ({ server, serverKey: `${index}:${server.name}`, stand })));
            const started = await Promise.all(jobs.map((job) => startServer(job.server, job.stand.dir, job.stand.label, { tenant: opts.mandant })));
            jobs.forEach((job, i) => console.log(`Server ${job.stand.label}: ${job.server.name} (AUDIS ${started[i].version})`));
            try {
                for (let p = 0; p < pfade.length; p++) {
                    for (let j = 0; j < jobs.length; j++) {
                        const suffix = servers.length > 1 ? ` · AUDIS ${started[j].version}` : '';
                        runsByPath[p].push({ stand: jobs[j].stand.key, server: jobs[j].serverKey, label: `${jobs[j].stand.label}${suffix}`, result: await playPath(started[j], pfade[p]) });
                    }
                }
            } finally {
                started.forEach((s) => s.stop());
            }
        } finally {
            stopAll();
            await removeDir(root);
        }
    }

    let exit = 0;
    for (let p = 0; p < pfade.length; p++) {
        console.log(`\n################ AUDIS-Pfadsimulation – ${pfade[p].name}`);
        exit = Math.max(exit, report(runsByPath[p], pfade[p], { wissen: opts.wissen }));
    }

    if (opts.stashSpeichern) {
        // Endzustand als Knowledge Stash; mehrere Läufe bekommen Pfad und Stand im Dateinamen.
        const all = runsByPath.flatMap((runs, p) => runs.map((run) => ({ run, pfad: pfade[p] })));
        const ext = path.extname(opts.stashSpeichern) || '.json';
        const stem = opts.stashSpeichern.slice(0, opts.stashSpeichern.length - path.extname(opts.stashSpeichern).length);
        console.log('');
        for (const { run, pfad } of all) {
            const suffix = all.length > 1 ? `-${path.basename(pfad.datei).replace(/\.[^.]+$/, '')}-${run.stand}${run.server.startsWith('0:') || run.server === 'laufend' ? '' : `-${run.server.split(':')[0]}`}` : '';
            const file = `${stem}${suffix}${ext}`;
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, JSON.stringify(buildStash(run.result.finalState, run.result.vorschau, `${pfad.name} – ${run.label}`), null, 2) + '\n');
            console.log(`Knowledge Stash gespeichert: ${file}`);
        }
    }
    return exit;
}

runMain(main, USAGE);
