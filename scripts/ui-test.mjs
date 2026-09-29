#!/usr/bin/env node
// Spielt Abfragepfade in der echten AUDIS-Oberfläche durch (Edge/Chrome headless über das
// DevTools-Protokoll), prüft, was die Oberfläche anzeigt (z. B. vorausgewählte Antworten), und legt
// Screenshots im Katalog-Repo ab – für vorher/nachher und/oder mehrere AUDIS-Versionen.
// Node.js ab 22 (eingebautes WebSocket), keine Abhängigkeiten.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    PathError,
    SCREENSHOT_ROOT,
    UsageError,
    api,
    breathingSpec,
    delay,
    diagnostics,
    dispoOf,
    eqi,
    findAnswerSpec,
    inputLabel,
    instructionSpec,
    knowledgeDiff,
    knowledgeMap,
    labelledInput,
    loadPathFile,
    matchesQuestion,
    norm,
    plain,
    prepareStands,
    removeDir,
    report,
    resolveServer,
    runMain,
    scenariosOf,
    serverVersion,
    slug,
    startServer,
    stopAll,
    summary,
    track
} from './lib/audis.mjs';

const USAGE = `Aufruf: node ui-test.mjs <pfad.json> [weitere.json …] [Optionen]

Spielt die Pfade in der echten AUDIS-Oberfläche durch (Browser headless), prüft die Erwartungen
und legt Screenshots im Katalog-Repo ab (Standard: ${SCREENSHOT_ROOT}/<snap-nummer>/).

Optionen:
  --base <ref>          Vergleichsstand für "vorher" (Standard: HEAD)
  --stand <ref>         für "nachher" diesen Git-Stand statt des Arbeitsverzeichnisses verwenden
  --ohne-vergleich      nur den aktuellen Stand durchspielen
  --version <v>         AUDIS-Version (z. B. 2.3.0.3, latest); mehrfach angeben zum Vergleichen.
                        Fehlende Versionen werden wie in der AUDIS-Erweiterung geladen (Lizenzschlüssel).
                        Statt einer Version die Snap-URL angeben: nimmt die Version dieser Umgebung.
                        "erweiterung" = Server der AUDIS-Erweiterung. Ohne --version: neueste lokale Version.
  --audis <datei>       AUDIS-Server direkt angeben (Audis.Web.exe bzw. Ordner)
  --server <url>        laufende AUDIS-Oberfläche verwenden, z. B. die Vorschau der Erweiterung
                        (http://localhost:50042); Katalog = was dieser Server geladen hat, kein Vergleich
  --oberflaeche <dir>   eigene Oberfläche (wwwroot) für einen lokalen Build ohne wwwroot
  --screenshots <dir>   Zielordner der Screenshots (Standard: <repo>/${SCREENSHOT_ROOT}/<snap-nummer>)
  --alle-screenshots    Screenshot bei jeder Frage (sonst: Fragen aus "screenshots" und das Ende)
  --debug-widget        Debug-Widget in den Screenshots einblenden
  --wissen              Wissensänderungen pro Schritt ausgeben (aus den Server-Antworten, mit Herkunft)
  --browser <exe>       Browser (sonst AUDIS_BROWSER, Edge oder Chrome)
  --sichtbar            Browserfenster anzeigen statt headless
  --groesse <BxH>       Fenstergrösse der Screenshots (Standard: 1600x1000)
  --repo <pfad>         Katalog-Repository (Standard: aktuelles Verzeichnis)
  --mandant <name>      Mandant im lokalen Modus (Standard: Lokal)

Pfaddatei zusätzlich: "screenshots", "zurueck" (Timeline-Sprung, Auswahl prüfen), "umantworten"
(frühere Frage über die Timeline neu beantworten) und "stash" (Start aus einem Knowledge Stash über
das Debug-Widget). Atemfrequenz-Frage: Zahl oder { "atemfrequenz": 9, "cpr": true, "stoppuhr": 10 }.
Anleitungen: "Durchgeführt, erfolgreich" (kurz "Durchgeführt"), "Durchgeführt, ohne Erfolg", "Nicht durchgeführt".
Eingabefelder mit Beschriftung: "Label: Freitext" (z. B. "Ja: Endometriose"). Zahlenfelder: Zahl.
Ein Pfadfehler beendet nur den betroffenen Pfad; die übrigen laufen weiter. Siehe references/ui-test.md.

Exit-Code: 0 = Prüfungen erfüllt, 1 = Prüfung verfehlt, 2 = Aufruf-, Pfad-, Browser- oder Serverfehler.`;

const STEP_TIMEOUT = 30_000;
const START_TIMEOUT = 120_000;
const MAX_STEPS = 250;
const INTERROGATION_CALL = /\/api\/interrogation\/[^/]+\/(start|process|restart)(\?|$)/i;

// ---------------------------------------------------------------- Browser über das DevTools-Protokoll

function findBrowser(explicit) {
    const candidates = [explicit, process.env.AUDIS_BROWSER].filter(Boolean);
    if (process.platform === 'win32') {
        const pf = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
        for (const base of pf) {
            candidates.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
            candidates.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
        }
    } else if (process.platform === 'darwin') {
        candidates.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    } else {
        candidates.push('/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser');
    }
    const found = candidates.find((c) => fs.existsSync(c));
    if (!found) throw new UsageError('Kein Browser gefunden (Edge oder Chrome). Mit --browser <exe> oder AUDIS_BROWSER angeben.');
    return found;
}

class Browser {
    static async launch(exe, { headless, width, height }) {
        if (typeof WebSocket === 'undefined') throw new UsageError('Der UI-Test braucht Node.js ab 22 (eingebautes WebSocket).');
        const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audis-browser-'));
        const args = [
            headless ? '--headless=new' : null,
            '--remote-debugging-port=0',
            `--user-data-dir=${userDataDir}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-extensions',
            '--disable-sync',
            '--hide-scrollbars',
            '--mute-audio',
            `--window-size=${width},${height}`,
            '--lang=de-CH',
            'about:blank'
        ].filter(Boolean);
        const child = track(spawn(exe, args, { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: headless }));
        const portFile = path.join(userDataDir, 'DevToolsActivePort');
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
            if (fs.existsSync(portFile)) {
                const [port, wsPath] = fs.readFileSync(portFile, 'utf8').split(/\r?\n/);
                if (port && wsPath) {
                    const browser = new Browser(child, userDataDir, width, height);
                    await browser.connect(`ws://127.0.0.1:${port}${wsPath}`);
                    return browser;
                }
            }
            await delay(200);
        }
        child.kill();
        throw new UsageError(`Browser startet nicht (keine DevTools-Verbindung): ${exe}`);
    }

    constructor(child, userDataDir, width, height) {
        Object.assign(this, { child, userDataDir, width, height, nextId: 1, pending: new Map(), listeners: new Set() });
    }

    connect(url) {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(url);
            this.ws.onopen = () => resolve();
            this.ws.onerror = () => reject(new UsageError('Verbindung zum Browser fehlgeschlagen.'));
            this.ws.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                if (msg.id && this.pending.has(msg.id)) {
                    const { resolve: ok, reject: fail, method } = this.pending.get(msg.id);
                    this.pending.delete(msg.id);
                    if (msg.error) fail(new Error(`${method}: ${msg.error.message}`));
                    else ok(msg.result);
                } else if (msg.method) {
                    for (const listener of this.listeners) listener(msg);
                }
            };
        });
    }

    send(method, params = {}, sessionId) {
        const id = this.nextId++;
        this.ws.send(JSON.stringify({ id, method, params, sessionId }));
        return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
    }

    async newPage() {
        const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
        const page = new Page(this, targetId, sessionId);
        for (const domain of ['Page', 'Runtime', 'Network']) await page.send(`${domain}.enable`);
        await page.send('Emulation.setDeviceMetricsOverride', { width: this.width, height: this.height, deviceScaleFactor: 1, mobile: false });
        return page;
    }

    async close() {
        try {
            await this.send('Browser.close');
        } catch {
            // Browser bereits beendet
        }
        this.child.kill();
        await removeDir(this.userDataDir);
    }
}

class Page {
    constructor(browser, targetId, sessionId) {
        Object.assign(this, { browser, targetId, sessionId, states: [], inflight: new Map(), errors: [] });
        this.listener = (msg) => this.onEvent(msg);
        browser.listeners.add(this.listener);
    }

    send(method, params = {}) {
        return this.browser.send(method, params, this.sessionId);
    }

    onEvent(msg) {
        if (msg.sessionId !== this.sessionId) return;
        const p = msg.params;
        if (msg.method === 'Network.requestWillBeSent' && INTERROGATION_CALL.test(p.request.url)) {
            this.inflight.set(p.requestId, p.request.url);
        } else if (msg.method === 'Network.loadingFinished' && this.inflight.has(p.requestId)) {
            this.inflight.delete(p.requestId);
            this.send('Network.getResponseBody', { requestId: p.requestId })
                .then(({ body, base64Encoded }) => {
                    const text = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
                    const state = JSON.parse(text);
                    if (state && ('currentQuestion' in state || 'isComplete' in state)) this.states.push(state);
                })
                .catch((e) => this.errors.push(e.message));
        } else if (msg.method === 'Network.loadingFailed' && this.inflight.has(p.requestId)) {
            this.errors.push(`${this.inflight.get(p.requestId)}: ${p.errorText}`);
            this.inflight.delete(p.requestId);
        }
    }

    async evaluate(expression) {
        const { result, exceptionDetails } = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
        return result.value;
    }

    async click({ x, y }) {
        await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    }

    async type(text) {
        await this.send('Input.insertText', { text });
    }

    async enter() {
        const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
        await this.send('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', ...key });
        await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
    }

    async screenshot(file) {
        const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(data, 'base64'));
        return file;
    }

    async close() {
        this.browser.listeners.delete(this.listener);
        await this.browser.send('Target.closeTarget', { targetId: this.targetId }).catch(() => {});
    }
}

// Liest den sichtbaren Zustand der Frage aus dem DOM (Selektoren wie in den AUDIS-E2E-Tests).
const OBSERVE = `(() => {
    const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    // Anleitungen (instruction) zeigen ihren Titel ab AUDIS 2.4.0 in einer eigenen Komponente.
    const title = document.querySelector("[data-testid='question-title']") || document.querySelector('app-question-title')
        || document.querySelector('app-bold-capitalized-question-title .question-title .text');
    const buttons = [...document.querySelectorAll('.answer-button')].filter(visible).map((b, index) => {
        const inner = b.querySelector('.inner');
        const text = b.querySelector('.text');
        return {
            index,
            text: (text ? text.innerText : b.innerText).replace(/\\s+/g, ' ').trim(),
            active: !!(inner && inner.classList.contains('active')) || !!b.querySelector('.fa-check'),
            unknown: !!(inner && inner.classList.contains('unknown-answer'))
        };
    });
    const known = ['app-age-question', 'app-api-search-question', 'app-selection-question', 'app-instruction-question', 'app-info-question',
        'app-location-question', 'app-date-time-question', 'app-body-question', 'app-body-coarse-question', 'app-number-question',
        'app-respiratory-rate-question', 'app-reanimation-question', 'app-media-question', 'app-frequency-question',
        'app-frequency-stopwatch-question'];
    return {
        title: title ? title.innerText.replace(/\\s+/g, ' ').trim() : null,
        buttons,
        unknownButton: [...document.querySelectorAll('button.unknown-answer')].some(visible),
        submit: [...document.querySelectorAll('app-multi-selection-answer button.btn-primary, app-multi-selection-autocomplete-answer button.btn-primary')].filter(visible).map((b) => ({ disabled: b.disabled }))[0] || null,
        components: known.filter((s) => document.querySelector(s)),
        spinner: [...document.querySelectorAll('app-progress-spinner')].some(visible),
        closed: location.pathname.includes('/closed')
    };
})()`;

// Anzeige der Atemfrequenz-Frage: eingetragener Wert, CPR-Knopf, Grenzbereich, Absende-Knopf.
const OBSERVE_BREATHING = `(() => {
    const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
    const input = document.querySelector('input#frequency-input');
    const buttons = [...document.querySelectorAll('button')].filter(visible).map((b) => clean(b.innerText)).filter(Boolean);
    const grenzbereich = [...document.querySelectorAll('span, p, div')].filter(visible).map((e) => clean(e.innerText))
        .filter((t) => /^Grenzbereich/i.test(t)).sort((a, b) => a.length - b.length)[0] ?? null;
    return {
        wert: input ? input.value : null,
        cprKnopf: buttons.find((t) => /CPR empfohlen/i.test(t)) ?? null,
        knopf: buttons.find((t) => /^(zu niedrig|normal|zu hoch|weiter)$/i.test(t)) ?? null,
        grenzbereich,
        buttons
    };
})()`;

// Liefert die Mitte eines Elements (nach scrollIntoView) für einen echten Mausklick.
const locate = (selector, index = 0, textMatch = null) => `(() => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    let list = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(visible);
    const wanted = ${JSON.stringify(textMatch)};
    if (wanted !== null) {
        // Erste Zeile oder ganzer Text: Antworten mit "<br><small>…" zeigen eine zweite Zeile.
        const textEl = (el) => el.querySelector('app-highlighted-text') || el.querySelector('.text') || el;
        const firstLine = (el) => norm(textEl(el).innerText.split('\\n')[0]);
        const fullText = (el) => norm(textEl(el).innerText);
        list = list.filter((el) => firstLine(el) === norm(wanted) || fullText(el) === norm(wanted));
    }
    const el = list[${index}];
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`;

// Wie locate, aber das erste sichtbare Element, dessen Text den Ausschnitt enthält.
const locateContaining = (selector, fragment) => `(() => {
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const visible = (el) => !!el && el.getClientRects().length > 0;
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(visible).find((e) => norm(e.innerText).includes(${JSON.stringify(fragment)}));
    if (!el) return null;
    const target = el.querySelector('.cursor-pointer') || el;
    target.scrollIntoView({ block: 'center', inline: 'center' });
    const r = target.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`;

// Debug-Widget „Local Development“: Knowledge Stash importieren und wiederherstellen (wie ein Entwickler von Hand).
// Mandant und Revision werden auf die lokale Vorschau umgestellt, sonst lehnt der Import den Stash ab.
async function restoreStashInUi(page, settings, stash) {
    const payload = JSON.stringify({ ...stash, datei: undefined, tenantId: settings?.tenantId ?? 'Lokal', revisionId: settings?.revisionId ?? null });
    const panelOpen = () => page.evaluate(`!!document.querySelector('.local-development-widget .debug-panel')`);
    if (!(await panelOpen())) {
        await page.click(await waitFor(() => page.evaluate(locate('.local-development-widget button.debug-toggle')), 'Debug-Widget „Local Development“'));
        await waitFor(panelOpen, 'Debug-Widget öffnet sich nicht');
    }
    if (!(await page.evaluate(`!!document.querySelector('.stash-import-input')`))) {
        await page.click(await waitFor(() => page.evaluate(locateContaining('.local-development-widget button.section-header', 'knowledge stash')), 'Abschnitt „Knowledge Stash“ im Debug-Widget'));
    }
    await page.click(await waitFor(() => page.evaluate(locate('.stash-import-input')), 'Eingabefeld des Knowledge Stash'));
    await page.type(payload);
    await page.click(await waitFor(() => page.evaluate(locate('.stash-import-button')), '„Importieren und wiederherstellen“'));
}

async function closeDebugWidget(page) {
    if (await page.evaluate(`!!document.querySelector('.local-development-widget .debug-panel')`)) {
        const toggle = await page.evaluate(locate('.local-development-widget button.debug-toggle'));
        if (toggle) await page.click(toggle);
        await delay(300);
    }
}

// ---------------------------------------------------------------- Pfad in der Oberfläche durchspielen

async function waitFor(check, what, timeout = STEP_TIMEOUT) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
        last = await check();
        if (last) return last;
        await delay(150);
    }
    throw new PathError(`Zeitüberschreitung: ${what}`);
}

function answerText(question, wanted, unknownText) {
    // Ermittelt den angezeigten Antworttext zur Pfadangabe (Text, Wert, Unbekannt, eindeutiger Teiltext).
    const w = norm(wanted);
    if (unknownText && (w === norm(unknownText) || w === 'unbekannt')) return { unknown: true, text: unknownText };
    const answers = (question.answers ?? []).filter((a) => a.type !== 2);
    const valueOf = (a) => a.knowledge?.find((k) => eqi(k.knowledgeIdentifier, question.knowledgeIdentifier))?.values?.[0]?.knowledgeValue;
    const exact = answers.find((a) => norm(a.text) === w || norm(a.rawText) === w || norm(valueOf(a)) === w);
    if (exact) return { text: plain(exact.text ?? exact.rawText) };
    const partial = answers.filter((a) => norm(a.text).includes(w));
    if (partial.length === 1) return { text: plain(partial[0].text) };
    if (partial.length > 1) throw new PathError(`Antwort „${wanted}“ ist bei „${plain(question.text)}“ mehrdeutig.`);
    const inputs = (question.answers ?? []).filter((a) => a.type === 2);
    // Eingabefeld: "Label: Freitext" wählt das beschriftete Feld, sonst das einzige Feld der Frage.
    const labelled = labelledInput(inputs, wanted);
    if (labelled) return { input: labelled.value, label: labelled.label };
    if (inputs.length) return { input: String(wanted), label: inputs.length === 1 ? inputLabel(inputs[0]) : null };
    throw new PathError(`Antwort „${wanted}“ passt zu keiner Antwort von „${plain(question.text)}“ (${question.knowledgeIdentifier}).`);
}

async function playPathUi(server, pfad, browser, run, opts) {
    const page = await browser.newPage();
    const shots = [];
    const shotDir = run.screenshotDir;
    let shotNo = 0;
    const takeShot = async (name) => {
        shotNo++;
        const file = path.join(shotDir, `${run.prefix}-${String(shotNo).padStart(2, '0')}-${slug(name) || 'ansicht'}.png`);
        await delay(400);
        await page.screenshot(file);
        shots.push(file);
        return path.relative(opts.repo, file).replace(/\\/g, '/');
    };
    try {
        const settings = await api(server.base, 'GET', `/settings/${server.tenant}`).catch(() => null);
        const unknownText = settings?.unknownAnswer?.text ?? 'Unbekannt';
        const widget = opts.debugWidget || !!pfad.stashEntry;
        const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(pfad.start ?? {}).map(([k, v]) => [k.replace(/^#/, ''), String(v)])), debugWidget: String(widget) });
        await page.send('Page.navigate', { url: `${server.origin}/${server.tenant}/interrogation?${query}` });

        const steps = [];
        const usedKeys = new Set();
        const umErledigt = new Set();
        let seen = 0;
        let end = null;
        // Timeline-Sprung zu einer früher beantworteten Frage (nur in der Oberfläche, ohne Serveraufruf).
        const jumpBackTo = async (frage) => {
            const text = norm(frage.text ?? frage.rawText);
            const item = await waitFor(() => page.evaluate(locateContaining('app-knowledge-timeline-item', text.slice(0, 40))), `Timeline-Eintrag „${plain(frage.text)}“`);
            await page.click(item);
            await waitFor(async () => {
                const v = await page.evaluate(OBSERVE);
                return v.title && norm(v.title).includes(text.slice(0, 40)) && !v.spinner ? v : null;
            }, `Zurückspringen zu „${plain(frage.text)}“`);
            await delay(500);
            return page.evaluate(OBSERVE);
        };
        // Neuester Zustand ab Index "seen", dessen Frage sich von "questionId" unterscheidet
        // (periodische Abfragen der Oberfläche zur selben Frage werden übergangen).
        const newerState = (questionId) => {
            for (let k = page.states.length - 1; k >= seen; k--) {
                const s = page.states[k];
                if (s.isComplete || !s.currentQuestion || s.currentQuestion.id !== questionId) return s;
            }
            return null;
        };
        // Der erste Start nach dem Serverstart dauert auf ausgelasteten Rechnern deutlich länger als ein Schritt.
        let state = await waitFor(() => newerState(undefined), 'AUDIS startet die Abfrage nicht (keine Antwort auf /Start)', START_TIMEOUT);

        // Knowledge Stash (Snap-Daten oder Debug-Widget) über das Debug-Widget importieren und wiederherstellen.
        let start = null;
        if (pfad.stashEntry) {
            await waitFor(async () => {
                const v = await page.evaluate(OBSERVE);
                return v.title && !v.spinner ? v : null;
            }, 'AUDIS-Oberfläche lädt nicht');
            const before = page.states.length;
            await restoreStashInUi(page, settings, pfad.stashEntry);
            state = await waitFor(() => page.states.length > before && page.states[page.states.length - 1], 'Wiederherstellen des Knowledge Stash (keine Antwort des Servers – Stash ungültig oder Mandant/Revision passen nicht; Meldung im Screenshot prüfen)');
            if (!opts.debugWidget) await closeDebugWidget(page);
            start = { name: pfad.stashEntry.name, frage: state.currentQuestion, dispo: dispoOf(state) };
        }

        for (let i = 0; i < MAX_STEPS && !end; i++) {
            seen = page.states.length;
            const question = state.currentQuestion;
            if (state.isComplete || !question) {
                end = { art: 'abgeschlossen', screenshots: [await takeShot('ende')] };
                break;
            }
            // Warten, bis die Oberfläche die Frage zeigt, dann den ersten Eindruck festhalten.
            const title = norm(question.text ?? question.rawText);
            const view = await waitFor(async () => {
                const v = await page.evaluate(OBSERVE);
                return v.title && (norm(v.title).includes(title.slice(0, 40)) || title.includes(norm(v.title).slice(0, 40))) && !v.spinner ? v : null;
            }, `Frage „${plain(question.text)}“ erscheint nicht in der Oberfläche`);
            await delay(500);
            const settled = await page.evaluate(OBSERVE);
            const vorausgewaehlt = settled.buttons.filter((b) => b.active).map((b) => b.text);
            // "umantworten": bevor die Frage "vor" beantwortet wird, über die Timeline zu "frage" zurück und neu antworten.
            const um = (pfad.umantworten ?? []).find((u) => !umErledigt.has(u) && matchesQuestion(question, u.vor));
            if (um) {
                umErledigt.add(um);
                const prev = steps.find((s) => matchesQuestion(s.frage, um.frage));
                if (!prev) throw new PathError(`"umantworten": Frage ${um.frage} wurde vorher im Pfad nicht beantwortet.`);
                const prevView = await jumpBackTo(prev.frage);
                const shown = answerText(prev.frage, um.antwort, unknownText);
                const target = (prev.frage.answers ?? []).find((a) => norm(a.text) === norm(shown.text));
                if (!target) throw new PathError(`"umantworten": Antwort „${um.antwort}“ gibt es bei „${plain(prev.frage.text)}“ nicht als Auswahl.`);
                const before = page.states.length;
                const knowledgeBefore = state.knowledge;
                const reanswered = () =>
                    page.states
                        .slice(before)
                        .reverse()
                        .find((s) => (s.knowledge ?? []).some((k) => k.knowledgeIdentifier === prev.frage.knowledgeIdentifier && (k.values ?? []).some((v) => v.answerId === target.id))) ?? null;
                const described = await answerInUi(page, prev.frage, [um.antwort], prevView, unknownText, reanswered);
                state = await waitFor(reanswered, `Neue Antwort „${um.antwort}“ bei „${plain(prev.frage.text)}“ wird nicht übernommen`);
                steps.push({
                    frage: prev.frage,
                    antwort: `${described} (über die Timeline neu beantwortet)`,
                    dispo: dispoOf(state),
                    vorausgewaehlt: [],
                    wissen: knowledgeDiff(knowledgeBefore, state.knowledge),
                    screenshots: [await takeShot(`neu ${prev.frage.text}`)]
                });
                continue;
            }
            const wantShot = opts.alleScreenshots || (pfad.screenshots ?? []).some((key) => matchesQuestion(question, key));
            const stepShots = [];
            const spec = findAnswerSpec(question, pfad.antworten);
            if (!spec) {
                end = { art: 'offen', frage: question, vorausgewaehlt, screenshots: [await takeShot(`ende ${question.text}`)] };
                break;
            }
            usedKeys.add(spec.key);
            const wanted = [].concat(spec.value);
            // Die Atemfrequenz-Frage wird erst nach dem Eintragen fotografiert (CPR-Knopf, Grenzbereich).
            const ctx = { takeShot, wantShot, stepShots, atemfrequenz: null };
            if (wantShot && !(isBreathingQuestion(question, view) && breathingSpec(wanted[0]))) stepShots.push(await takeShot(question.text ?? question.rawText));
            const knowledgeBefore = state.knowledge;
            const described = await answerInUi(page, question, wanted, view, unknownText, () => newerState(question.id), ctx);
            state = await waitFor(
                () => newerState(question.id),
                `„${plain(question.text)}“ bleibt stehen – die Antwort „${describeWanted(wanted)}“ wurde in der Oberfläche nicht übernommen`
            );
            steps.push({
                frage: question,
                antwort: described,
                dispo: dispoOf(state),
                vorausgewaehlt,
                wissen: knowledgeDiff(knowledgeBefore, state.knowledge),
                screenshots: stepShots,
                ...(ctx.atemfrequenz ? { atemfrequenz: ctx.atemfrequenz } : {})
            });
        }
        if (!end) throw new PathError(`Mehr als ${MAX_STEPS} Schritte – Pfad endet nicht.`);
        const offen = (pfad.umantworten ?? []).filter((u) => !umErledigt.has(u));
        if (offen.length) throw new PathError(`"umantworten" nicht ausgeführt, die Frage "vor" kam nicht: ${offen.map((u) => u.vor).join(', ')}`);

        // Zurückspringen über die Timeline und die wiederhergestellte Auswahl festhalten.
        const zurueck = [];
        for (const key of [].concat(pfad.zurueck ?? [])) {
            const step = steps.find((s) => matchesQuestion(s.frage, key));
            if (!step) throw new PathError(`"zurueck": Frage ${key} wurde im Pfad nicht beantwortet.`);
            const view = await jumpBackTo(step.frage);
            zurueck.push({
                frage: step.frage,
                vorausgewaehlt: view.buttons.filter((b) => b.active).map((b) => b.text),
                screenshots: [await takeShot(`zurueck ${step.frage.text}`)]
            });
        }
        return {
            ui: true,
            start,
            steps,
            end,
            zurueck,
            dispo: dispoOf(state),
            szenarien: scenariosOf(state),
            wissen: knowledgeMap(state.knowledge),
            zusammenfassung: await summary(server.base, server.tenant, state),
            diagnose: await diagnostics(server.base, server.tenant),
            unbenutzt: Object.keys(pfad.antworten).filter((k) => !usedKeys.has(k)),
            screenshots: shots
        };
    } catch (e) {
        try {
            const file = await takeShot('fehler');
            e.message += `\n  Screenshot des Fehlerzustands: ${file}`;
        } catch {
            // kein Screenshot möglich
        }
        throw e;
    } finally {
        await page.close();
    }
}

const isBreathingQuestion = (question, view) => question.visualization === 'respiratory' || view.components.includes('app-frequency-stopwatch-question');
const describeWanted = (wanted) => wanted.map((w) => (w && typeof w === 'object' ? JSON.stringify(w) : w)).join(', ');

// Atemfrequenz-Frage: optional die Stoppuhr ohne Atemzug laufen lassen, dann die Frequenz eintragen, die Anzeige
// festhalten (CPR-Knopf, Grenzbereich) und mit dem Hauptknopf bzw. „CPR empfohlen“ absenden.
async function answerBreathingInUi(page, question, spec, ctx) {
    const range = (text) => {
        const m = /(\d+)\s*[–-]\s*(\d+)/.exec(text ?? '');
        return m ? [Number(m[1]), Number(m[2])] : null;
    };
    const shot = async (name) => {
        if (!ctx?.wantShot) return;
        ctx.stepShots.push(await ctx.takeShot(name));
    };
    await waitFor(() => page.evaluate(locate('input#frequency-input')), 'Eingabefeld der Atemfrequenz');
    let stoppuhr = null;
    if (spec.stoppuhr) {
        await page.click(await waitFor(() => page.evaluate(locate('app-frequency-stopwatch-input .btn')), '„Start“ der Stoppuhr'));
        await delay(spec.stoppuhr * 1000);
        stoppuhr = { sekunden: spec.stoppuhr, cprKnopf: !!(await page.evaluate(OBSERVE_BREATHING)).cprKnopf };
        await shot(`stoppuhr ${spec.stoppuhr}s`);
    }
    await page.evaluate(`(() => {
        const el = document.querySelector('input#frequency-input');
        el.focus();
        el.value = ${JSON.stringify(String(spec.wert))};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await delay(800);
    const view = await page.evaluate(OBSERVE_BREATHING);
    await shot(`atemfrequenz ${spec.wert}`);
    if (spec.cpr && !view.cprKnopf) throw new PathError(`„CPR empfohlen“ wird bei ${spec.wert}/min nicht angeboten (${view.grenzbereich ?? 'kein Grenzbereich angezeigt'}).`);
    const target = spec.cpr ? view.cprKnopf : view.knopf;
    if (!target) throw new PathError(`Kein Knopf zum Absenden der Atemfrequenz gefunden (sichtbar: ${view.buttons.join(' | ')}).`);
    const button = await page.evaluate(locate('button', 0, target));
    if (!button) throw new PathError(`Knopf „${target}“ ist nicht klickbar.`);
    await page.click(button);
    if (ctx) ctx.atemfrequenz = { wert: spec.wert, grenze: range(view.grenzbereich), cprKnopf: !!view.cprKnopf, knopf: view.knopf, geklickt: target, stoppuhr };
    return `${spec.wert}/min, Knopf „${target}“`;
}

async function answerInUi(page, question, wanted, view, unknownText, answered, ctx = null) {
    const vis = question.visualization;
    const breathing = isBreathingQuestion(question, view) ? breathingSpec(wanted[0]) : null;
    if (breathing) return answerBreathingInUi(page, question, breathing, ctx);
    if (wanted.some((w) => w && typeof w === 'object')) {
        throw new PathError(`Antwortobjekt bei „${plain(question.text)}“: direkt vorgegebenes "wissen" gibt es nur in simulate.mjs.`);
    }
    if (vis === 'apisearch') {
        const target = answerText(question, wanted[0], unknownText);
        const input = await waitFor(() => page.evaluate(locate('app-api-search-question input')), 'Suchfeld der Einstiegssuche');
        // Der volle Titel findet Einträge mit „/“ nicht („Synkope / Kreislaufdysregulation“ → keine Suchergebnisse),
        // daher nacheinander: voller Titel, Teil vor dem ersten „/“, erstes Wort.
        const queries = [...new Set([target.text, target.text.split('/')[0].trim(), target.text.split(/[\s/(),]+/)[0]].filter(Boolean))];
        let item = null;
        for (const [n, query] of queries.entries()) {
            await page.click(input);
            await page.evaluate(`(() => { const el = document.querySelector('app-api-search-question input'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
            await page.type(query);
            const last = n === queries.length - 1;
            try {
                item = await waitFor(() => page.evaluate(locate('.k-list-item, li[role="option"]', 0, target.text)), `Suchergebnis „${target.text}“ (Suche „${query}“)`, last ? STEP_TIMEOUT : 5000);
                break;
            } catch (e) {
                if (last) throw e;
            }
        }
        await page.click(item);
        // Je nach Version übernimmt die Auswahl sofort oder erst mit Enter.
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline && !answered()) await delay(150);
        if (!answered()) await page.enter();
        return target.text;
    }
    if (vis === 'age' || view.components.includes('app-age-question')) {
        const input = await waitFor(() => page.evaluate(locate('app-age-question input')), 'Eingabefeld des Alters');
        await page.click(input);
        await page.type(String(wanted[0]));
        await page.enter();
        return `${wanted[0]}`;
    }
    // Anleitung: Knöpfe „Durchgeführt, erfolgreich“, „Durchgeführt, ohne Erfolg“, „Nicht durchgeführt“.
    const instruction = view.components.includes('app-instruction-question') ? instructionSpec(wanted[0]) : null;
    if (instruction) {
        const button = await waitFor(() => page.evaluate(locate('button', 0, instruction.label)), `Knopf „${instruction.label}“ der Anleitung`);
        await page.click(button);
        return instruction.label;
    }
    // Zahlenfeld (visualization = number): Wert eintragen und mit Enter absenden; „Unbekannt“ geht über den Knopf.
    if ((vis === 'number' || view.components.includes('app-number-question')) && wanted.length === 1 && norm(wanted[0]) !== 'unbekannt' && norm(wanted[0]) !== norm(unknownText)) {
        const input = await waitFor(() => page.evaluate(locate('app-number-question input')), 'Zahlenfeld');
        // Das Feld kann vorbelegt sein (z. B. „16“ nach „Erwachsen (ab 16 Jahre)“): erst leeren, dann eintragen.
        await page.evaluate(`(() => { const el = document.querySelector('app-number-question input'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await page.click(input);
        await page.type(String(wanted[0]));
        const weiter = await page.evaluate(locate('app-number-question button', 0, 'Weiter'));
        if (weiter) await page.click(weiter);
        else await page.enter();
        return String(wanted[0]);
    }
    const targets = wanted.map((w) => answerText(question, w, unknownText));
    if (targets.length === 1 && targets[0].unknown) {
        const button = (await page.evaluate(locate('button.unknown-answer'))) ?? (await page.evaluate(locate('.answer-button .inner.unknown-answer')));
        if (!button) throw new PathError(`Keine Unbekannt-Antwort bei „${plain(question.text)}“.`);
        await page.click(button);
        return unknownText;
    }
    if (targets.length === 1 && targets[0].input !== undefined) {
        // Eingabeantworten zeigen zuerst einen Knopf („Sonstiges“, „Text eingeben“); erst der Klick blendet das Feld ein.
        if (!(await page.evaluate(locate('app-answer-input input')))) {
            // Ohne Beschriftung (reines „___“) heisst der Knopf „Text eingeben“: dann den einzigen Eingabeknopf nehmen.
            const toggle = (targets[0].label ? await page.evaluate(locate('app-answer-input app-answer-button', 0, targets[0].label)) : null)
                || (await page.evaluate(locate('app-answer-input app-answer-button')));
            if (toggle) await page.click(toggle);
        }
        const input = await waitFor(() => page.evaluate(locate('app-answer-input input')), `Eingabefeld${targets[0].label ? ` „${targets[0].label}“` : ''}`);
        await page.click(input);
        await page.type(targets[0].input);
        await page.enter();
        return targets[0].input;
    }
    if (view.submit) {
        // Mehrfachauswahl: Auswahl auf die gewünschten Antworten bringen, dann „Weiter“.
        const wantedTexts = new Set(targets.map((t) => norm(t.text)));
        const current = await page.evaluate(OBSERVE);
        for (const b of current.buttons.filter((x) => !x.unknown)) {
            if (b.active !== wantedTexts.has(norm(b.text))) {
                await page.click(await page.evaluate(locate('.answer-button', b.index)));
                await delay(150);
            }
        }
        await page.click(await waitFor(() => page.evaluate(locate('app-multi-selection-answer button.btn-primary, app-multi-selection-autocomplete-answer button.btn-primary')), '„Weiter“'));
        return targets.map((t) => t.text).join(', ');
    }
    const target = targets[0];
    const button = (await page.evaluate(locate('.answer-button', 0, target.text))) ?? (await page.evaluate(locate('button', 0, target.text)));
    if (!button) {
        throw new PathError(`Antwort „${target.text}“ ist in der Oberfläche nicht klickbar (Visualisierung ${vis ?? 'Standard'}). Für Spezial-Visualisierungen simulate.mjs mit "wissen" verwenden.`);
    }
    await page.click(button);
    return target.text;
}

// ---------------------------------------------------------------- Hauptprogramm

function parseArgs(argv) {
    const opts = {
        repo: process.cwd(), base: 'HEAD', stand: null, vergleich: true, audis: null, server: null, versionen: [], oberflaeche: null, screenshots: null,
        alleScreenshots: false, debugWidget: false, wissen: false, browser: null, sichtbar: false, breite: 1600, hoehe: 1000, mandant: 'Lokal', pfade: []
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const value = () => {
            if (i + 1 >= argv.length) throw new UsageError(`${a} erwartet einen Wert.`);
            return argv[++i];
        };
        if (a === '--base') opts.base = value();
        else if (a === '--stand') opts.stand = value();
        else if (a === '--ohne-vergleich') opts.vergleich = false;
        else if (a === '--version') opts.versionen.push(value());
        else if (a === '--audis') opts.audis = value();
        else if (a === '--server') opts.server = value().replace(/\/+$/, '');
        else if (a === '--oberflaeche') opts.oberflaeche = path.resolve(value());
        else if (a === '--screenshots') opts.screenshots = path.resolve(value());
        else if (a === '--alle-screenshots') opts.alleScreenshots = true;
        else if (a === '--debug-widget') opts.debugWidget = true;
        else if (a === '--wissen') opts.wissen = true;
        else if (a === '--browser') opts.browser = value();
        else if (a === '--sichtbar') opts.sichtbar = true;
        else if (a === '--groesse') {
            const m = value().match(/^(\d+)x(\d+)$/);
            if (!m) throw new UsageError('--groesse erwartet BREITExHOEHE, z. B. 1600x1000.');
            [opts.breite, opts.hoehe] = [Number(m[1]), Number(m[2])];
        } else if (a === '--repo') opts.repo = path.resolve(value());
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

function screenshotDirFor(opts, pfad) {
    if (opts.screenshots) return opts.screenshots;
    const nr = pfad.name.match(/#\s*(\d{2,})/)?.[1] ?? path.basename(pfad.datei).replace(/\.[^.]+$/, '');
    return path.join(opts.repo, SCREENSHOT_ROOT, nr);
}

// Variante aus dem Dateinamen der Pfaddatei ("snap-2383-zurueck.json" → "zurueck"), damit mehrere
// Pfade im selben Screenshot-Ordner sich nicht überschreiben.
function variantOf(pfad) {
    const base = path.basename(pfad.datei).replace(/\.[^.]+$/, '');
    const m = base.match(/^snap[-_]?\d+[-_]?(.*)$/i);
    return slug(m ? m[1] : base);
}

// Präfix der Screenshot-Dateien eines Laufs; entfernt vorher die Bilder genau dieses Präfixes.
function screenshotPrefix(dir, parts, pfad) {
    const prefix = [...parts, variantOf(pfad)].filter(Boolean).join('-') || 'ansicht';
    const own = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{2}-.*\\.png$`);
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (own.test(f)) fs.rmSync(path.join(dir, f));
    return prefix;
}

async function runAgainstServer(opts, pfade) {
    // Laufende Oberfläche (z. B. Vorschau der AUDIS-Erweiterung): ein Lauf, kein Vergleich.
    const server = { origin: opts.server, base: `${opts.server}/api`, tenant: opts.mandant };
    server.version = await serverVersion(server.base);
    const browserExe = findBrowser(opts.browser);
    const browser = await Browser.launch(browserExe, { headless: !opts.sichtbar, width: opts.breite, height: opts.hoehe });
    console.log(`Server: ${opts.server} (AUDIS ${server.version}, laufende Instanz) · Browser: ${browserExe}`);
    let exit = 0;
    try {
        for (const pfad of pfade) {
            const dir = screenshotDirFor(opts, pfad);
            const prefix = screenshotPrefix(dir, ['ansicht'], pfad);
            const run = { stand: 'stand', server: 'laufend', label: `laufender Server (AUDIS ${server.version})` };
            try {
                run.result = await playPathUi(server, pfad, browser, { screenshotDir: dir, prefix }, opts);
            } catch (e) {
                if (!(e instanceof PathError)) throw e;
                run.fehler = e.message;
            }
            console.log(`\n################ AUDIS-UI-Test – ${pfad.name}`);
            exit = Math.max(exit, reportOrFailure([run], pfad, opts));
            console.log(`Screenshots: ${path.relative(opts.repo, dir).replace(/\\/g, '/') || '.'}`);
        }
    } finally {
        await browser.close();
    }
    return exit;
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const pfade = opts.pfade.map(loadPathFile);
    if (opts.server) return runAgainstServer(opts, pfade);
    const versions = opts.versionen.length ? opts.versionen : [null];
    const servers = [];
    for (const v of versions) servers.push(await resolveServer({ audis: opts.audis, version: v }));
    const browserExe = findBrowser(opts.browser);
    const { root, stands } = prepareStands(opts);
    const runsByPath = pfade.map(() => []);
    let browser = null;
    try {
        const jobs = servers.flatMap((server, index) => stands.map((stand) => ({ server, serverKey: `${index}:${server.name}`, stand })));
        const started = await Promise.all(
            jobs.map((job) => startServer(job.server, job.stand.dir, job.stand.label, { tenant: opts.mandant, webRoot: opts.oberflaeche, debugWidget: opts.debugWidget || pfade.some((p) => p.stashEntry) }))
        );
        jobs.forEach((job, i) => console.log(`Server ${job.stand.label}: ${job.server.name} (AUDIS ${started[i].version})`));
        for (const s of started) {
            const index = await fetch(`${s.origin}/${opts.mandant}/interrogation`).then((r) => (r.ok ? r.text() : '')).catch(() => '');
            if (!/<app-root|<html/i.test(index)) {
                throw new UsageError(`Der AUDIS-Server (AUDIS ${s.version}) liefert keine Oberfläche aus. Eine AUDIS-Version mit Oberfläche verwenden (--version) oder für einen lokalen Build --oberflaeche <wwwroot> angeben.`);
            }
        }
        browser = await Browser.launch(browserExe, { headless: !opts.sichtbar, width: opts.breite, height: opts.hoehe });
        console.log(`Browser: ${browserExe}`);
        for (let p = 0; p < pfade.length; p++) {
            const dir = screenshotDirFor(opts, pfade[p]);
            for (let j = 0; j < jobs.length; j++) {
                const versionPart = servers.length > 1 ? `audis-${started[j].version}` : null;
                const standPart = jobs[j].stand.key === 'stand' ? (versionPart ? null : 'ansicht') : jobs[j].stand.key;
                // Alte Screenshots genau dieses Laufs entfernen, damit keine veralteten Bilder liegen bleiben.
                const prefix = screenshotPrefix(dir, [standPart, versionPart], pfade[p]);
                const label = `${jobs[j].stand.label}${servers.length > 1 ? ` · AUDIS ${started[j].version}` : ''}`;
                try {
                    const result = await playPathUi(started[j], pfade[p], browser, { screenshotDir: dir, prefix }, opts);
                    runsByPath[p].push({ stand: jobs[j].stand.key, server: jobs[j].serverKey, label, result });
                } catch (e) {
                    // Pfadfehler betreffen nur diesen Lauf; die übrigen Pfade laufen weiter.
                    if (!(e instanceof PathError)) throw e;
                    runsByPath[p].push({ stand: jobs[j].stand.key, server: jobs[j].serverKey, label, fehler: e.message });
                }
            }
        }
        started.forEach((s) => s.stop());
    } finally {
        if (browser) await browser.close();
        stopAll();
        await removeDir(root);
    }

    let exit = 0;
    for (let p = 0; p < pfade.length; p++) {
        console.log(`\n################ AUDIS-UI-Test – ${pfade[p].name}`);
        exit = Math.max(exit, reportOrFailure(runsByPath[p], pfade[p], opts));
        console.log(`Screenshots: ${path.relative(opts.repo, screenshotDirFor(opts, pfade[p])).replace(/\\/g, '/') || '.'}`);
    }
    return exit;
}

// Bericht eines Pfads; ist ein Lauf an einem Pfadfehler gescheitert, nur die Fehler ausgeben (Exit 2).
function reportOrFailure(runs, pfad, opts) {
    const failed = runs.filter((r) => r.fehler);
    if (!failed.length) return report(runs, pfad, { wissen: opts.wissen });
    for (const r of failed) console.log(`Pfadfehler (${r.label}): ${r.fehler}`);
    return 2;
}

runMain(main, USAGE);
