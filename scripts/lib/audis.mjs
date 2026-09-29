// Gemeinsame Bausteine der Skripte: Texthilfen, Git-Stände, AUDIS-Versionen (Download wie die
// AUDIS-VS-Code-Erweiterung), Serverstart und API-Aufrufe. Node.js ab 18, keine Abhängigkeiten.

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export class UsageError extends Error {}
export class PathError extends Error {}

// Ordner im Katalog-Repo, in dem die Skripte Screenshots ablegen; wird nicht in Katalogkopien übernommen.
export const SCREENSHOT_ROOT = 'usersnaps';
const DEFAULT_DOWNLOAD_URL = 'https://audis-utilities.azurewebsites.net/api/download-versioned-audis-ui';

// ---------------------------------------------------------------- Text

export const plain = (text) =>
    String(text ?? '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/\*\*/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
export const norm = (text) => plain(text).toLowerCase();
export const eqi = (a, b) => norm(a) === norm(b);
export const short = (text, max = 72) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const tail = (log, lines = 15) => log.trim().split(/\r?\n/).slice(-lines).map((l) => `    ${l}`).join('\n');
export const slug = (text) =>
    norm(text)
        .replace(/[äöü]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue' })[c])
        .replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50);

export function parseJsonLoose(text, file) {
    const withoutComments = text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str ?? '');
    const withoutTrailingCommas = withoutComments.replace(/,(\s*[}\]])/g, '$1');
    try {
        return JSON.parse(withoutTrailingCommas.replace(/^\uFEFF/, ''));
    } catch (e) {
        throw new UsageError(`${file}: kein gültiges JSON (${e.message}).`);
    }
}

export function loadPathFile(file) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) throw new UsageError(`Pfaddatei nicht gefunden: ${resolved}`);
    const pfad = parseJsonLoose(fs.readFileSync(resolved, 'utf8'), resolved);
    if (!pfad.antworten || typeof pfad.antworten !== 'object') throw new UsageError(`${resolved}: Objekt "antworten" fehlt.`);
    pfad.datei = resolved;
    pfad.name ??= path.basename(resolved);
    if (pfad.stash) pfad.stashEntry = loadStash(path.resolve(path.dirname(resolved), pfad.stash));
    return pfad;
}

// ---------------------------------------------------------------- Knowledge Stash (Debug-Widget, Usersnap)

// Packt Hüllen wie in der AUDIS-Oberfläche aus: JSON-Text, { custom: … }, { knowledgeStash: … }.
export function unwrapStash(value) {
    let current = value;
    for (let depth = 0; depth < 4; depth++) {
        if (typeof current === 'string') {
            try {
                current = JSON.parse(current);
            } catch {
                return null;
            }
            continue;
        }
        if (!current || typeof current !== 'object' || Array.isArray(current)) return current;
        if ('custom' in current) current = current.custom;
        else if ('knowledgeStash' in current) current = current.knowledgeStash;
        else return current;
    }
    return current;
}

export function loadStash(file) {
    if (!fs.existsSync(file)) throw new UsageError(`Stash-Datei nicht gefunden: ${file}`);
    const stash = unwrapStash(parseJsonLoose(fs.readFileSync(file, 'utf8'), file));
    if (!stash || !Array.isArray(stash.knowledge)) {
        throw new UsageError(`${file}: kein Knowledge Stash (erwartet wird der knowledgeStash aus den Snap-Daten oder dem Debug-Widget).`);
    }
    return { ...stash, datei: file, name: stash.name || path.basename(file) };
}

// Knowledge Stash im Format des Debug-Widgets. Mandant und Revision müssen denen der Vorschau entsprechen
// (Felder tenantId/revisionId aus /api/settings/<mandant>), sonst lehnt der Import den Stash ab.
export function buildStash(state, { tenantId, revisionId }, name) {
    const q = state.currentQuestion;
    return {
        formatVersion: 1,
        source: 'local-development-widget',
        name,
        tenantId,
        revisionId: revisionId ?? null,
        knowledge: state.knowledge,
        timelineItems: [],
        timestamp: Date.now(),
        processStepId: state.processStepId,
        currentQuestion: q
            ? { rawText: q.rawText ?? q.text, knowledgeIdentifier: q.knowledgeIdentifier ?? null, configurationName: q.configurationName, lineNumber: q.lineNumber ?? null }
            : null,
        activeScenarioIdentifiers: (state.currentScenarios ?? []).map((s) => s.scenarioIdentifier).filter(Boolean)
    };
}

// ---------------------------------------------------------------- Git-Stände

export function git(repo, args, options = {}) {
    const result = spawnSync('git', ['-C', repo, ...args], { maxBuffer: 1 << 30, ...options });
    if (result.error) throw new UsageError(`git nicht ausführbar: ${result.error.message}`);
    if (result.status !== 0) throw new UsageError(`git ${args.join(' ')} fehlgeschlagen: ${result.stderr.toString().trim()}`);
    return result.stdout;
}

const isCatalogFile = (rel) => !rel.startsWith(`${SCREENSHOT_ROOT}/`);

export function exportWorkingTree(repo, dest) {
    const files = git(repo, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
        .toString('utf8')
        .split('\0')
        .filter((rel) => rel && isCatalogFile(rel));
    for (const rel of [...new Set(files)]) {
        const src = path.join(repo, rel);
        if (!fs.existsSync(src)) continue;
        const dst = path.join(dest, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
    }
}

export function exportRef(repo, ref, dest) {
    const entries = git(repo, ['ls-tree', '-r', '-z', '--full-tree', ref])
        .toString('utf8')
        .split('\0')
        .filter(Boolean)
        .map((line) => {
            const tab = line.indexOf('\t');
            const [, type, hash] = line.slice(0, tab).split(' ');
            return { type, hash, file: line.slice(tab + 1) };
        })
        .filter((e) => e.type === 'blob' && isCatalogFile(e.file));
    const out = git(repo, ['cat-file', '--batch'], { input: entries.map((e) => e.hash).join('\n') + '\n' });
    let offset = 0;
    for (const entry of entries) {
        const newline = out.indexOf(10, offset);
        const size = Number(out.toString('utf8', offset, newline).split(' ')[2]);
        const content = out.subarray(newline + 1, newline + 1 + size);
        offset = newline + 1 + size + 1;
        const dst = path.join(dest, entry.file);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, content);
    }
}

export function workingTreeMatches(repo, ref) {
    const status = spawnSync('git', ['-C', repo, 'status', '--porcelain', '--untracked-files=normal', '--', '.', `:!${SCREENSHOT_ROOT}`], { encoding: 'utf8' });
    if (status.status !== 0 || status.stdout.trim() !== '') return false;
    const trees = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD^{tree}', `${ref}^{tree}`], { encoding: 'utf8' });
    if (trees.status !== 0) return false;
    const [a, b] = trees.stdout.trim().split('\n');
    return a === b;
}

// Legt die Katalogstände für "vorher" und "nachher" in einem temporären Verzeichnis an.
export function prepareStands(opts) {
    // Die Kopien heissen wie das Repo: AUDIS verwendet lokal den Ordnernamen als Revision, so passen
    // gespeicherte Knowledge Stashes zur Vorschau der AUDIS-Erweiterung.
    const repoName = path.basename(git(opts.repo, ['rev-parse', '--show-toplevel']).toString('utf8').trim()) || 'katalog';
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audis-sim-'));
    const afterName = opts.stand ?? 'Arbeitsverzeichnis';
    const stands = [];
    let compare = opts.vergleich;
    if (compare && !opts.stand && workingTreeMatches(opts.repo, opts.base)) {
        console.log(`Hinweis: Arbeitsverzeichnis entspricht ${opts.base} – kein Vergleich nötig.`);
        compare = false;
    }
    if (compare) {
        const dir = path.join(root, 'vorher', repoName);
        exportRef(opts.repo, opts.base, dir);
        stands.push({ key: 'vorher', label: `vorher (${opts.base})`, dir });
    }
    const dir = path.join(root, 'nachher', repoName);
    if (opts.stand) exportRef(opts.repo, opts.stand, dir);
    else exportWorkingTree(opts.repo, dir);
    stands.push({ key: compare ? 'nachher' : 'stand', label: compare ? `nachher (${afterName})` : `Stand ${afterName}`, dir });
    return { root, stands };
}

export async function removeDir(dir) {
    // Der Server gibt Dateien teils verzögert frei.
    for (let i = 0; i < 10; i++) {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
            return;
        } catch {
            await delay(500);
        }
    }
}

// ---------------------------------------------------------------- AUDIS-Versionen

const exeName = process.platform === 'win32' ? 'Audis.Web.exe' : 'Audis.Web';

function appDataDirs() {
    if (process.platform === 'win32') return [process.env.APPDATA].filter(Boolean);
    if (process.platform === 'darwin') return [path.join(os.homedir(), 'Library', 'Application Support')];
    return [process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')];
}
const EDITORS = ['Code', 'Code - Insiders', 'Cursor', 'Windsurf', 'VSCodium'];

export function versionsRoot() {
    if (process.env.AUDIS_VERSIONS_DIR) return path.resolve(process.env.AUDIS_VERSIONS_DIR);
    const base = process.platform === 'win32' ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local') : path.join(os.homedir(), '.cache');
    return path.join(base, 'audis-srz-usersnap', 'audis-versionen');
}

function findExeBelow(dir, depth = 3) {
    if (!fs.existsSync(dir)) return null;
    const direct = path.join(dir, exeName);
    if (fs.existsSync(direct)) return direct;
    if (depth === 0) return null;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const found = findExeBelow(path.join(dir, entry.name), depth - 1);
        if (found) return found;
    }
    return null;
}

function compareVersionsDesc(a, b) {
    const va = (a.match(/(\d+(?:\.\d+)*)$/)?.[1] ?? '0').split('.').map(Number);
    const vb = (b.match(/(\d+(?:\.\d+)*)$/)?.[1] ?? '0').split('.').map(Number);
    for (let i = 0; i < Math.max(va.length, vb.length); i++) {
        const d = (vb[i] ?? 0) - (va[i] ?? 0);
        if (d !== 0) return d;
    }
    return 0;
}

export function extensionServers() {
    const found = [];
    for (const dir of ['.vscode/extensions', '.vscode-insiders/extensions', '.cursor/extensions', '.windsurf/extensions']) {
        const root = path.join(os.homedir(), dir);
        if (!fs.existsSync(root)) continue;
        for (const name of fs.readdirSync(root).filter((n) => /^softaware\.audis-editor-/i.test(n)).sort(compareVersionsDesc)) {
            const exe = path.join(root, name, 'server', 'web', exeName);
            if (fs.existsSync(exe)) found.push({ name: `Erweiterung ${name.replace(/^softaware\./i, '')}`, exe });
        }
    }
    return found;
}

// Version eines AUDIS-Builds: die höchste Datei changelog/v<version>.md neben Audis.Web.
export function detectBuildVersion(exe) {
    const dir = path.join(path.dirname(exe), 'changelog');
    if (!fs.existsSync(dir)) return null;
    const versions = fs
        .readdirSync(dir)
        .map((f) => f.match(/^v(\d+(?:\.\d+)+)\.md$/i)?.[1])
        .filter(Boolean)
        .sort(compareVersionsDesc);
    return versions[0] ?? null;
}
const versionCore = (v) => String(v).match(/^\d+(?:\.\d+)*/)?.[0] ?? '';

export function cachedVersions() {
    const root = versionsRoot();
    if (!fs.existsSync(root)) return [];
    return fs
        .readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.endsWith('.tmp'))
        .map((e) => ({ version: e.name, exe: findExeBelow(path.join(root, e.name)) }))
        .filter((v) => v.exe)
        .map((v) => ({ ...v, build: detectBuildVersion(v.exe) }))
        .sort((a, b) => compareVersionsDesc(a.version, b.version));
}

// Release-Tags des AUDIS-Repositorys (nicht jede Version ist beim Download-Dienst verfügbar).
export function releaseTags() {
    const r = spawnSync('gh', ['api', '--paginate', 'repos/softawaregmbh/softaware-audis/tags?per_page=100', '--jq', '.[].name'], { encoding: 'utf8' });
    if (r.error || r.status !== 0) {
        throw new UsageError('Tags nicht abrufbar (GitHub CLI "gh" fehlt oder keine Berechtigung). Alternativ im AUDIS-Repository: git tag --list');
    }
    // Absteigend nach Version; ein Release steht vor seinen rc-Ständen (2.4.0 vor 2.4.0-rc.1).
    const key = (tag) => {
        const core = (tag.match(/^\d+(?:\.\d+)*/)?.[0] ?? '0').split('.').map(Number);
        const pre = tag.slice(tag.match(/^\d+(?:\.\d+)*/)?.[0].length ?? 0);
        return { core, pre, preNo: Number(pre.match(/(\d+)$/)?.[1] ?? 0) };
    };
    return r.stdout
        .split(/\r?\n/)
        .filter((t) => /^\d+\.\d+/.test(t))
        .sort((a, b) => {
            const ka = key(a);
            const kb = key(b);
            for (let i = 0; i < Math.max(ka.core.length, kb.core.length); i++) {
                const d = (kb.core[i] ?? 0) - (ka.core[i] ?? 0);
                if (d !== 0) return d;
            }
            if (!ka.pre !== !kb.pre) return ka.pre ? 1 : -1;
            return kb.preNo - ka.preNo;
        });
}

function readEditorSetting(key) {
    for (const base of appDataDirs()) {
        for (const editor of EDITORS) {
            const file = path.join(base, editor, 'User', 'settings.json');
            if (!fs.existsSync(file)) continue;
            try {
                const value = parseJsonLoose(fs.readFileSync(file, 'utf8'), file)[key];
                if (typeof value === 'string' && value.trim()) return { value: value.trim(), source: `${editor}-Einstellungen (${key})` };
            } catch {
                // unlesbare Einstellungen überspringen
            }
        }
    }
    return null;
}

// Lizenzschlüssel wie in der AUDIS-Erweiterung; wird nie ausgegeben.
export function findLicenseKey() {
    if (process.env.AUDIS_LICENSE_KEY?.trim()) return { value: process.env.AUDIS_LICENSE_KEY.trim(), source: 'Umgebungsvariable AUDIS_LICENSE_KEY' };
    return readEditorSetting('audis.licenseKey');
}

function machineId() {
    for (const base of appDataDirs()) {
        for (const editor of EDITORS) {
            const file = path.join(base, editor, 'machineid');
            if (fs.existsSync(file)) {
                const id = fs.readFileSync(file, 'utf8').trim();
                if (id) return id;
            }
        }
    }
    const file = path.join(versionsRoot(), 'machine-id');
    if (!fs.existsSync(file)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, randomUUID());
    }
    return fs.readFileSync(file, 'utf8').trim();
}

function extractZip(zip, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const attempts =
        process.platform === 'win32'
            ? [
                  [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', dest]],
                  ['powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`]]
              ]
            : process.platform === 'darwin'
              ? [['/usr/bin/tar', ['-xf', zip, '-C', dest]]]
              : [['unzip', ['-q', '-o', zip, '-d', dest]]];
    for (const [cmd, args] of attempts) {
        const r = spawnSync(cmd, args, { stdio: 'pipe' });
        if (r.status === 0) return;
    }
    throw new UsageError(`Entpacken fehlgeschlagen: ${zip}`);
}

// Lädt eine AUDIS-Version genauso wie die Erweiterung ("AUDIS: Download") und legt sie im Versions-Cache ab.
export async function downloadVersion(version) {
    const licenseKey = findLicenseKey()?.value;
    if (!licenseKey) {
        throw new UsageError(
            'Kein Lizenzschlüssel gefunden. Die AUDIS-Erweiterung speichert ihn in den VS-Code-Einstellungen unter "audis.licenseKey" ' +
                '(nach dem ersten „AUDIS: Download“); alternativ Umgebungsvariable AUDIS_LICENSE_KEY setzen.'
        );
    }
    const endpoint = process.env.AUDIS_DOWNLOAD_URL || readEditorSetting('audis.downloadUrl')?.value || DEFAULT_DOWNLOAD_URL;
    const body = {
        licenseKey,
        machineId: machineId(),
        version,
        os: process.platform === 'darwin' ? 'macos' : process.platform === 'linux' ? 'linux' : 'windows',
        platform: process.platform,
        arch: process.arch,
        runtimeId: process.platform === 'darwin' ? 'osx-arm64' : process.platform === 'linux' ? 'linux-x64' : 'win-x64'
    };
    console.log(`Lade AUDIS ${version} …`);
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 401) throw new UsageError('Der Lizenzschlüssel wurde abgelehnt (HTTP 401).');
    if (res.status === 404) throw new UsageError(`AUDIS-Version „${version}“ gibt es nicht (HTTP 404).`);
    if (!res.ok) throw new UsageError(`Download-Adresse nicht erhalten: HTTP ${res.status}.`);
    const raw = (await res.text()).trim();
    let url = raw;
    try {
        const parsed = JSON.parse(raw);
        url = typeof parsed === 'string' ? parsed : (parsed?.downloadUrl ?? parsed?.url ?? raw);
    } catch {
        // Antwort ist bereits die Adresse
    }
    url = new URL(url, endpoint).toString();

    const root = versionsRoot();
    fs.mkdirSync(root, { recursive: true });
    const safe = version.replace(/[^\w.-]/g, '_');
    const zip = path.join(root, `${safe}.zip`);
    const tmp = path.join(root, `${safe}.tmp`);
    const download = await fetch(url);
    if (!download.ok || !download.body) throw new UsageError(`Download fehlgeschlagen: HTTP ${download.status}.`);
    await pipeline(Readable.fromWeb(download.body), fs.createWriteStream(zip));
    await removeDir(tmp);
    extractZip(zip, tmp);
    fs.rmSync(zip, { force: true });
    const tmpExe = findExeBelow(tmp);
    if (!tmpExe) {
        await removeDir(tmp);
        throw new UsageError(`Im Download von AUDIS ${version} fehlt ${exeName}.`);
    }
    // Der Download-Dienst liefert teils eine andere Version als angefragt (z. B. für ein altes rc).
    const actual = detectBuildVersion(tmpExe);
    if (!actual) console.log(`Hinweis: Version des Builds nicht prüfbar (kein changelog-Ordner) – angefragt war ${version}.`);
    if (actual && version !== 'latest' && versionCore(actual) !== versionCore(version)) {
        await removeDir(tmp);
        throw new UsageError(`Der Download-Dienst lieferte für „${version}“ einen Build der Version ${actual}. Verworfen, damit der Cache keine falsch benannte Version enthält.`);
    }
    const target = path.join(root, version === 'latest' && actual ? actual : safe);
    await removeDir(target);
    fs.renameSync(tmp, target);
    if (version === 'latest' && actual) console.log(`„latest“ ist AUDIS ${actual}.`);
    return findExeBelow(target);
}

// node:http(s) ohne Keep-Alive statt fetch: Unter Windows bricht Node 24 bei process.exit() kurz nach einem
// HTTPS-fetch mit einer libuv-Assertion ab (Exit-Code 127).
function getText(url, timeoutMs) {
    const client = url.startsWith('https:') ? https : http;
    return new Promise((resolve, reject) => {
        const req = client.get(url, { agent: false, timeout: timeoutMs }, (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => (text += chunk));
            res.on('end', () => resolve({ status: res.statusCode, text }));
        });
        req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung')));
        req.on('error', reject);
    });
}

// AUDIS-Version einer Umgebung, z. B. aus der Snap-URL https://demo.audis.at/srz/release/…; der Host liefert sie unter /api/version.
export async function environmentVersion(url) {
    let origin;
    try {
        origin = new URL(url).origin;
    } catch {
        throw new UsageError(`Keine gültige Adresse: ${url}`);
    }
    const res = await getText(`${origin}/api/version`, 15000).catch((e) => {
        throw new UsageError(`AUDIS-Version von ${origin} nicht abrufbar: ${e.message}`);
    });
    const text = res.status === 200 ? res.text.replace(/"/g, '').trim() : '';
    if (!/^\d+(?:\.\d+)+$/.test(text)) throw new UsageError(`${origin} liefert unter /api/version keine AUDIS-Version (HTTP ${res.status}). Die Version mit --version <x> angeben.`);
    // Entwicklungsstände (z. B. dev.audis.at: 2026.09.17.1) liefert der Download-Dienst nicht.
    if (/^20\d\d\./.test(text)) {
        throw new UsageError(`${origin} läuft mit dem Entwicklungsstand ${text}, den der Download-Dienst nicht liefert. Die nächstliegende Version mit --version <x> angeben (Liste: audis-versionen.mjs tags).`);
    }
    console.log(`${origin} läuft mit AUDIS ${text}.`);
    return text;
}

const newerFirst = (a, b) => compareVersionsDesc(versionCore(a.build ?? '0'), versionCore(b.build ?? '0'));

// Server-Auswahl: --audis > --version (Cache, sonst Download; auch Adresse einer AUDIS-Umgebung) > AUDIS_WEB > neueste lokale Version (Erweiterung oder Cache).
export async function resolveServer({ audis, version }) {
    if (audis) {
        const stat = fs.statSync(audis, { throwIfNoEntry: false });
        const exe = stat?.isDirectory() ? findExeBelow(audis) : stat?.isFile() ? path.resolve(audis) : null;
        if (!exe) throw new UsageError(`AUDIS-Server nicht gefunden: ${audis}`);
        return { name: path.basename(path.dirname(exe)) === 'net10.0' ? 'lokaler Build' : exe, exe };
    }
    if (version && /^https?:\/\//i.test(version)) return resolveServer({ version: await environmentVersion(version) });
    const ext = extensionServers()[0];
    if (version === 'erweiterung') {
        if (ext) return ext;
        throw new UsageError('Kein Server der AUDIS-Erweiterung gefunden. In VS Code einmal „AUDIS Web UI starten“ ausführen.');
    }
    if (version) {
        const cached = cachedVersions().find((v) => v.version === version.replace(/[^\w.-]/g, '_'));
        if (cached && version !== 'latest') return { name: `AUDIS ${version}`, exe: cached.exe };
        return { name: `AUDIS ${version}`, exe: await downloadVersion(version) };
    }
    if (process.env.AUDIS_WEB) return resolveServer({ audis: process.env.AUDIS_WEB });
    // Ohne --version die neueste lokale Version, damit eine alte Erweiterung nicht stillschweigend anderes Verhalten liefert.
    const local = [
        ext && { ...ext, build: detectBuildVersion(ext.exe) },
        ...cachedVersions().map((v) => ({ name: `AUDIS ${v.version}`, exe: v.exe, build: v.build ?? v.version }))
    ]
        .filter(Boolean)
        .sort(newerFirst);
    if (local.length) {
        const [chosen] = local;
        console.log(`Hinweis: Ohne --version läuft die neueste lokale Version (AUDIS ${chosen.build ?? '?'}). Für einen Snap die Version seiner Umgebung angeben, z. B. --version https://demo.audis.at/srz/release`);
        if (ext && chosen.exe !== ext.exe) console.log(`Hinweis: Die Vorschau der AUDIS-Erweiterung läuft mit AUDIS ${local.find((s) => s.exe === ext.exe).build ?? '?'} und kann sich anders verhalten.`);
        return chosen;
    }
    throw new UsageError(
        'AUDIS-Server nicht gefunden. Möglichkeiten: in VS Code „AUDIS Web UI starten“ der AUDIS-Erweiterung einmal ausführen, ' +
            '--version <x> (lädt wie die Erweiterung, braucht den Lizenzschlüssel), --audis <Pfad zu Audis.Web.exe>, ' +
            'AUDIS_WEB setzen oder --server <url> für einen laufenden Server.'
    );
}

// ---------------------------------------------------------------- Server

function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

const runningChildren = new Set();
export function stopAll() {
    for (const child of runningChildren) {
        try {
            child.kill();
        } catch {
            // bereits beendet
        }
    }
    runningChildren.clear();
}
process.on('exit', stopAll);
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        stopAll();
        process.exit(2);
    });
}
export function track(child) {
    runningChildren.add(child);
    child.on('exit', () => runningChildren.delete(child));
    return child;
}

export async function startServer(server, catalogDir, label, { tenant = 'Lokal', webRoot = null, debugWidget = false } = {}) {
    const port = await freePort();
    const env = {
        ...process.env,
        Application__Port: String(port),
        Application__NotifyEndpointsEnabled: 'false',
        Application__NotifyAnalyzersEnabled: 'false',
        GlobalSettings__IsDebugWidgetEnabled: String(debugWidget),
        // Neuere AUDIS-Versionen starten ausserhalb der Entwicklungsumgebung nur mit Schlüssel für /verification.
        Verification__InboundApiKeys__0: randomBytes(16).toString('hex')
    };
    if (webRoot) env.ASPNETCORE_WEBROOT = path.resolve(webRoot);
    const child = track(
        spawn(server.exe, ['--LocalWorkingDirectory', catalogDir], { cwd: path.dirname(server.exe), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    );
    let log = '';
    const append = (data) => {
        log = (log + data.toString()).slice(-40000);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    let exitCode = null;
    child.on('exit', (code) => {
        exitCode = code ?? -1;
    });
    child.on('error', (e) => {
        exitCode = -1;
        append(`\n${e.message}`);
    });
    const origin = `http://localhost:${port}`;
    const base = `${origin}/api`;
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
        if (exitCode !== null) throw new UsageError(`AUDIS-Server (${label}) wurde beendet (Code ${exitCode}):\n${tail(log)}`);
        try {
            const res = await fetch(`${base}/interrogation/${tenant}/DispositionLevels`);
            if (res.ok) return { origin, base, tenant, version: await serverVersion(base), stop: () => child.kill(), log: () => log };
        } catch {
            // Server startet noch
        }
        await delay(500);
    }
    child.kill();
    throw new UsageError(`AUDIS-Server (${label}) antwortet nicht:\n${tail(log)}`);
}

export async function serverVersion(base) {
    // /version liefert je nach AUDIS-Version reinen Text oder einen JSON-String.
    return fetch(`${base}/version`)
        .then((r) => (r.ok ? r.text() : '?'))
        .then((t) => t.replace(/"/g, '').trim() || '?')
        .catch(() => '?');
}

export async function api(base, method, route, body) {
    let res;
    try {
        res = await fetch(`${base}${route}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    } catch (e) {
        throw new UsageError(`AUDIS-Server nicht erreichbar (${base}): ${e.message}`);
    }
    const text = await res.text();
    if (!res.ok) throw new UsageError(`${method} ${route}: HTTP ${res.status} ${text.slice(0, 1500)}`);
    return text ? JSON.parse(text) : null;
}

// Parser- und Katalogmeldungen; Zeilen kommen 0-basiert und werden 1-basiert ausgegeben.
export async function diagnostics(base, tenant) {
    const raw = await api(base, 'GET', `/settings/${tenant}/Diagnostics`).catch(() => []);
    const lines = [];
    const at = (catalog, entry) => {
        const line = Number.isInteger(entry.line) ? `:${entry.line + 1}` : '';
        const symbol = entry.symbol ? ` (bei „${entry.symbol}“)` : '';
        return `${catalog ?? '?'}${line}: ${plain(entry.message)}${symbol}`;
    };
    for (const d of Array.isArray(raw) ? raw : []) {
        const catalog = d.questionCatalogName ?? d.catalogName;
        if (Array.isArray(d.errors) || Array.isArray(d.warnings)) {
            for (const e of d.errors ?? []) lines.push({ art: 'Fehler', text: at(catalog, e) });
            for (const w of d.warnings ?? []) lines.push({ art: 'Warnung', text: at(catalog, w) });
        } else {
            lines.push({ art: d.severity === 0 ? 'Fehler' : 'Hinweis', text: plain(d.message ?? JSON.stringify(d)) });
        }
    }
    return lines;
}

export async function summary(base, tenant, state) {
    const result = await api(base, 'POST', `/knowledgesummary/${tenant}/Generate`, {
        interrogationId: state.id,
        knowledge: state.knowledge,
        runtimeState: state.runtimeState
    }).catch((e) => ({ fehler: e.message }));
    if (result?.fehler) return [`(Zusammenfassung nicht verfügbar: ${result.fehler})`];
    const items = result?.knowledgeSummary ?? result;
    if (!items) return [];
    if (typeof items === 'string') return items.split(/\r?\n/).filter(Boolean);
    if (!Array.isArray(items)) return [plain(JSON.stringify(items))];
    return items.map((item) => {
        const values = Array.isArray(item.items) ? item.items.join(', ') : (item.items ?? item.text ?? '');
        return plain(item.prefix ? `${item.prefix}: ${values}` : values);
    });
}

export const dispoOf = (state) => state?.currentScenariosMaxDispositionLevel?.dispositionCode ?? '-';
export const scenariosOf = (state) =>
    (state?.currentScenarios ?? []).map((s) => s.name ?? s.scenarioIdentifier ?? s.externalApiIdentifier ?? JSON.stringify(s));
export const knowledgeMap = (knowledge) =>
    new Map((knowledge ?? []).map((k) => [k.knowledgeIdentifier, (k.values ?? []).map((v) => v.knowledgeValue).join(' | ')]));

// Herkunft des Wissens (KnowledgeOrigin) wie im Debug-Widget.
const ORIGINS = ['geerbt', 'Oberfläche', 'Analyzer', 'Leitstelle', 'Injection-Button', 'Enricher', 'Standalone'];
function describeKnowledge(k) {
    const values = (k.values ?? []).map((v) => v.knowledgeValue).join(' | ');
    const tags = [];
    if (k.origin !== undefined && k.origin !== 1) tags.push(ORIGINS[k.origin] ?? `Herkunft ${k.origin}`);
    if ((k.values ?? []).length && k.values.every((v) => !v.answerId)) tags.push('ohne answerId');
    return tags.length ? `${values}  [${tags.join(', ')}]` : values;
}

export function knowledgeDiff(before, after) {
    const a = new Map((before ?? []).map((k) => [k.knowledgeIdentifier, describeKnowledge(k)]));
    const b = new Map((after ?? []).map((k) => [k.knowledgeIdentifier, describeKnowledge(k)]));
    const lines = [];
    for (const [id, value] of b) {
        if (!a.has(id)) lines.push(`+ ${id} = ${value}`);
        else if (a.get(id) !== value) lines.push(`~ ${id} = ${a.get(id)} → ${value}`);
    }
    for (const id of a.keys()) if (!b.has(id)) lines.push(`- ${id}`);
    return lines;
}

// ---------------------------------------------------------------- Pfad und Erwartungen

export function findAnswerSpec(question, answers) {
    const identifier = norm(question.knowledgeIdentifier);
    const text = norm(question.text ?? question.rawText);
    let best = null;
    for (const [key, value] of Object.entries(answers)) {
        if (key.startsWith('#')) {
            if (norm(key) === identifier) return { key, value };
        } else if (text.includes(norm(key)) && (!best || key.length > best.key.length)) {
            best = { key, value };
        }
    }
    return best;
}

export const matchesQuestion = (question, key) =>
    key.startsWith('#') ? eqi(question.knowledgeIdentifier, key) : norm(question.text ?? question.rawText).includes(norm(key));

export const shownQuestions = (result) => [...result.steps.map((s) => s.frage), ...(result.end.frage ? [result.end.frage] : [])];

// ---------------------------------------------------------------- Atemfrequenz (Visualisierung "respiratory")

// Grenzbereich für Massnahmen wie in der AUDIS-Oberfläche (respiratory-threshold-config.util.ts): Eintrag der
// Altersgruppe in "Thresholds" vor globalem Lower/UpperThresholdValue vor eingebautem Standard.
// Altersgruppen: 1 Säugling (NewBorn), 2 Kleinkind (Baby), 3 Kind/Jugend (ChildTeenager), 4 Erwachsen (Adult).
export const AGE_GROUP_LABELS = { 1: 'Säugling', 2: 'Kleinkind', 3: 'Kind/Jugend', 4: 'Erwachsen' };
const AGE_GROUP_NAMES = { newborn: 1, baby: 2, childteenager: 3, adult: 4 };
const RESPIRATORY_DEFAULT_ACTION = { 1: [23, 62], 2: [18, 42], 3: [13, 32], 4: [10, 20] };

export function ageGroupNumber(value) {
    if (value == null) return null;
    if (Number.isInteger(Number(value)) && AGE_GROUP_LABELS[Number(value)]) return Number(value);
    const label = Object.entries(AGE_GROUP_LABELS).find(([, l]) => eqi(l, value));
    return label ? Number(label[0]) : (AGE_GROUP_NAMES[norm(value)] ?? null);
}

export function respiratoryActionThreshold(settings, ageGroup) {
    const respiratory = settings?.visualization?.respiratory;
    const fallback = RESPIRATORY_DEFAULT_ACTION[ageGroup] ?? RESPIRATORY_DEFAULT_ACTION[4];
    if (!respiratory) return fallback;
    const entry = (respiratory.thresholds ?? []).find((t) => ageGroupNumber(t.ageGroup) === ageGroup);
    const pick = (...values) => values.find((v) => v != null && v > 0);
    const lower = pick(entry?.lowerThresholdValue, respiratory.lowerThresholdValue);
    const upper = pick(entry?.upperThresholdValue, respiratory.upperThresholdValue);
    if (lower == null && upper == null) return fallback;
    return [lower ?? fallback[0], upper ?? fallback[1]];
}

// Antwort auf die Atemfrequenz-Frage: Zahl oder { "atemfrequenz": 9, "cpr": true, "stoppuhr": 10 }.
// null bei anderen Angaben (Unbekannt, direkt vorgegebenes "wissen").
export function breathingSpec(wanted) {
    const number = (v) => Number(String(v).trim().replace(',', '.'));
    if (wanted && typeof wanted === 'object' && !Array.isArray(wanted)) {
        if (wanted.atemfrequenz === undefined) return null;
        const wert = number(wanted.atemfrequenz);
        if (!Number.isFinite(wert) || wert < 0) throw new PathError(`"atemfrequenz": ${JSON.stringify(wanted.atemfrequenz)} ist keine Frequenz.`);
        const stoppuhr = wanted.stoppuhr === undefined ? null : number(wanted.stoppuhr);
        if (stoppuhr !== null && !(stoppuhr > 0)) throw new PathError(`"stoppuhr": ${JSON.stringify(wanted.stoppuhr)} – Sekunden ohne Atemzug angeben.`);
        return { wert, cpr: wanted.cpr === true, stoppuhr };
    }
    const wert = number(wanted);
    return typeof wanted !== 'boolean' && String(wanted).trim() !== '' && Number.isFinite(wert) && wert >= 0 ? { wert, cpr: false, stoppuhr: null } : null;
}

// ---------------------------------------------------------------- Anleitungen und Eingabefelder

// Knöpfe einer Anleitung (Visualisierung "instruction") und die Werte, die die Oberfläche als Primärwissen sendet
// (Übersetzungen ExecuteInstructionSuccessful + ExecuteInstruction, ExecuteInstructionUnsuccessful, SkipInstruction).
// Deshalb gilt nach „Durchgeführt, erfolgreich“ auch #id = Durchgeführt.
const INSTRUCTION_BUTTONS = [
    { label: 'Durchgeführt, erfolgreich', values: ['Durchgeführt, erfolgreich', 'Durchgeführt'], aliases: ['durchgeführt', 'erfolgreich'] },
    { label: 'Durchgeführt, ohne Erfolg', values: ['Durchgeführt, ohne Erfolg'], aliases: ['ohne erfolg'] },
    { label: 'Nicht durchgeführt', values: ['Nicht durchgeführt'], aliases: [] }
];

// Antwort auf eine Anleitung: Knopfbeschriftung (oder kurz "Durchgeführt"); null bei anderen Angaben.
export function instructionSpec(wanted) {
    if (typeof wanted !== 'string') return null;
    const w = norm(wanted);
    return INSTRUCTION_BUTTONS.find((b) => norm(b.label) === w || b.aliases.includes(w)) ?? null;
}

// Beschriftung einer Eingabeantwort: „Sonstiges: ___“ → „Sonstiges“, reines „___“ → „“.
export const inputLabel = (answer) =>
    plain(answer.text ?? answer.rawText ?? '')
        .replace(/:?\s*_{2,}.*$/, '')
        .replace(/:\s*$/, '')
        .trim();

// Pfadangabe „Label: Freitext“ einer bestimmten Eingabeantwort zuordnen, z. B. "Ja: Endometriose" für „Ja: ___“.
export function labelledInput(inputs, wanted) {
    const m = /^([^:]+):\s*([\s\S]*)$/.exec(String(wanted));
    if (!m) return null;
    const answer = inputs.find((a) => inputLabel(a) && eqi(inputLabel(a), m[1]));
    return answer ? { answer, value: m[2].trim(), label: inputLabel(answer) } : null;
}

export const breathingObservations = (result) => result.steps.filter((s) => s.atemfrequenz).map((s) => ({ frage: s.frage, ...s.atemfrequenz }));

export function describeBreathing(b) {
    const grenze = b.grenze ? `Grenzbereich ${b.grenze.join('–')}/min` : 'kein Grenzbereich angezeigt';
    return `${b.cprKnopf ? 'CPR-Knopf angeboten' : 'kein CPR-Knopf'}, ${grenze}${b.nachgebildet ? ' (nachgebildet)' : ''}`;
}

export function checkExpectations(result, erwartet) {
    if (!erwartet) return [];
    const checks = [];
    const shown = shownQuestions(result);
    const add = (ok, text) => checks.push({ ok, text });
    for (const key of erwartet.nichtGefragt ?? []) {
        const hit = shown.find((q) => matchesQuestion(q, key));
        add(!hit, `nicht gefragt: ${key}${hit ? ` – wurde gestellt: „${short(plain(hit.text))}“` : ''}`);
    }
    for (const key of erwartet.gefragt ?? []) add(shown.some((q) => matchesQuestion(q, key)), `gefragt: ${key}`);
    if (erwartet.naechsteFrage) {
        const q = result.end.frage;
        add(!!q && matchesQuestion(q, erwartet.naechsteFrage), `nächste Frage: ${erwartet.naechsteFrage}${q ? ` (ist: „${short(plain(q.text))}“)` : ' (ist: keine)'}`);
    }
    if (erwartet.abgeschlossen !== undefined) {
        add((result.end.art === 'abgeschlossen') === Boolean(erwartet.abgeschlossen), `Abfrage ${erwartet.abgeschlossen ? '' : 'nicht '}abgeschlossen`);
    }
    if (erwartet.dispo) add(eqi(result.dispo, erwartet.dispo), `Dispo ${erwartet.dispo} (ist: ${result.dispo})`);
    for (const s of [].concat(erwartet.szenario ?? [])) add(result.szenarien.some((x) => eqi(x, s)), `Szenario ${s} (ist: ${result.szenarien.join(', ') || '–'})`);
    for (const [id, value] of Object.entries(erwartet.wissen ?? {})) {
        const actual = result.wissen.get(id);
        if (value === null) add(actual === undefined, `Wissen ${id} nicht gesetzt (ist: ${actual ?? '–'})`);
        else add(actual !== undefined && actual.split(' | ').some((v) => eqi(v, value)), `Wissen ${id} = ${value} (ist: ${actual ?? '–'})`);
    }
    const text = norm(result.zusammenfassung.join('\n'));
    for (const t of erwartet.zusammenfassung?.enthaelt ?? []) add(text.includes(norm(t)), `Zusammenfassung enthält „${t}“`);
    for (const t of erwartet.zusammenfassung?.enthaeltNicht ?? []) add(!text.includes(norm(t)), `Zusammenfassung enthält nicht „${t}“`);
    // Nur im UI-Test beobachtbar; in der API-Simulation als übersprungen markiert (zählt nicht als Fehler).
    const uiOnly = (text) => checks.push({ ok: true, skip: true, text: `${text}: nur im UI-Test prüfbar, hier übersprungen` });
    // Auswahl nach dem Zurückspringen über die Timeline.
    for (const [key, wanted] of Object.entries(erwartet.nachZurueck ?? {})) {
        if (!result.ui) {
            uiOnly(`nach Zurückspringen zu ${key}`);
            continue;
        }
        const visit = (result.zurueck ?? []).find((z) => matchesQuestion(z.frage, key));
        const expected = [].concat(wanted).map(norm).sort();
        if (!visit) add(false, `nach Zurückspringen zu ${key}: kein "zurueck" auf diese Frage im Pfad`);
        else add(JSON.stringify(visit.vorausgewaehlt.map(norm).sort()) === JSON.stringify(expected), `nach Zurückspringen zu ${key} markiert: ${expected.length ? expected.join(', ') : 'keine'} (ist: ${visit.vorausgewaehlt.join(', ') || 'keine'})`);
    }
    // Antworten, die beim ersten Anzeigen einer Frage schon markiert sind.
    for (const [key, wanted] of Object.entries(erwartet.vorausgewaehlt ?? {})) {
        if (!result.ui) {
            uiOnly(`vorausgewählt bei ${key}`);
            continue;
        }
        const step = [...result.steps, ...(result.end.frage ? [{ frage: result.end.frage, vorausgewaehlt: result.end.vorausgewaehlt }] : [])].find((s) => matchesQuestion(s.frage, key));
        if (!step) {
            add(false, `vorausgewählt bei ${key}: Frage wurde nicht angezeigt`);
        } else if (!step.vorausgewaehlt) {
            add(false, `vorausgewählt bei ${key}: keine Beobachtung`);
        } else {
            const actual = step.vorausgewaehlt.map(norm).sort();
            const expected = [].concat(wanted).map(norm).sort();
            add(JSON.stringify(actual) === JSON.stringify(expected), `vorausgewählt bei ${key}: ${expected.length ? expected.join(', ') : 'keine'} (ist: ${step.vorausgewaehlt.join(', ') || 'keine'})`);
        }
    }
    // CPR-Knopf der Atemfrequenz-Frage: im UI-Test beobachtet, in der API-Simulation nach der Oberfläche nachgebildet.
    const breathing = breathingObservations(result);
    for (const [key, wanted] of Object.entries(erwartet.cprKnopf ?? {})) {
        const b = breathing.find((x) => matchesQuestion(x.frage, key));
        if (!b) add(false, `CPR-Knopf bei ${key}: keine Atemfrequenz eingegeben`);
        else add(b.cprKnopf === Boolean(wanted), `CPR-Knopf bei ${key} ${wanted ? '' : 'nicht '}angeboten (ist bei ${b.wert}/min: ${describeBreathing(b)})`);
    }
    for (const [key, wanted] of Object.entries(erwartet.cprKnopfStoppuhr ?? {})) {
        if (!result.ui) {
            uiOnly(`CPR-Knopf nach Stoppuhr bei ${key}`);
            continue;
        }
        const b = breathing.find((x) => matchesQuestion(x.frage, key));
        if (!b?.stoppuhr) add(false, `CPR-Knopf nach Stoppuhr bei ${key}: Stoppuhr lief nicht ("stoppuhr" in der Antwort angeben)`);
        else add(b.stoppuhr.cprKnopf === Boolean(wanted), `CPR-Knopf nach ${b.stoppuhr.sekunden} s Stoppuhr ohne Atemzug bei ${key} ${wanted ? '' : 'nicht '}angeboten (ist: ${b.stoppuhr.cprKnopf ? 'angeboten' : 'nicht angeboten'})`);
    }
    return checks;
}

export function diagnosticChecks(runs) {
    // Parserfehler scheitern immer; Warnungen nur, wenn sie gegenüber "vorher" neu sind.
    const after = runs[runs.length - 1].result.diagnose;
    const beforeRun = runs.find((r) => r.stand === 'vorher');
    const before = beforeRun ? new Set(beforeRun.result.diagnose.map((d) => `${d.art}\u0000${d.text}`)) : null;
    const checks = [];
    for (const d of after) {
        if (d.art === 'Fehler') checks.push({ ok: false, text: `Parserfehler: ${d.text}` });
        else if (d.art === 'Warnung' && before && !before.has(`${d.art}\u0000${d.text}`)) checks.push({ ok: false, text: `neue Parserwarnung: ${d.text}` });
    }
    if (checks.length === 0) checks.push({ ok: true, text: before ? 'AUDIS-Parser: keine Fehler, keine neuen Warnungen' : 'AUDIS-Parser: keine Fehler' });
    return checks;
}

export function printComparison(before, after, labels) {
    console.log(`\n== Unterschiede ${labels.before} → ${labels.after} ==`);
    const key = (q) => `${q.knowledgeIdentifier}\u0000${norm(q.text ?? q.rawText)}`;
    const beforeShown = shownQuestions(before);
    const afterShown = shownQuestions(after);
    const beforeKeys = new Set(beforeShown.map(key));
    const afterKeys = new Set(afterShown.map(key));
    const lines = [];
    for (const q of beforeShown) if (!afterKeys.has(key(q))) lines.push(`  − entfällt: „${short(plain(q.text ?? q.rawText))}“ (${q.knowledgeIdentifier})`);
    for (const q of afterShown) if (!beforeKeys.has(key(q))) lines.push(`  + neu: „${short(plain(q.text ?? q.rawText))}“ (${q.knowledgeIdentifier})`);
    const preselected = (r) => new Map([...r.steps, ...(r.end.frage ? [{ frage: r.end.frage, vorausgewaehlt: r.end.vorausgewaehlt }] : [])].filter((s) => s.vorausgewaehlt).map((s) => [key(s.frage), s]));
    const pb = preselected(before);
    for (const [k, s] of preselected(after)) {
        const b = pb.get(k);
        if (b && b.vorausgewaehlt.join('|') !== s.vorausgewaehlt.join('|')) {
            lines.push(`  vorausgewählt bei „${short(plain(s.frage.text))}“: ${b.vorausgewaehlt.join(', ') || 'keine'} → ${s.vorausgewaehlt.join(', ') || 'keine'}`);
        }
    }
    for (const z of after.zurueck ?? []) {
        const b = (before.zurueck ?? []).find((x) => key(x.frage) === key(z.frage));
        if (b && b.vorausgewaehlt.join('|') !== z.vorausgewaehlt.join('|')) {
            lines.push(`  nach Zurückspringen zu „${short(plain(z.frage.text))}“ markiert: ${b.vorausgewaehlt.join(', ') || 'nichts'} → ${z.vorausgewaehlt.join(', ') || 'nichts'}`);
        }
    }
    const breathingBefore = new Map(breathingObservations(before).map((b) => [key(b.frage), b]));
    for (const a of breathingObservations(after)) {
        const b = breathingBefore.get(key(a.frage));
        if (!b) continue;
        if (describeBreathing(b) !== describeBreathing(a)) lines.push(`  Atemfrequenz ${a.wert}/min bei „${short(plain(a.frage.text))}“: ${describeBreathing(b)} → ${describeBreathing(a)}`);
        if (b.stoppuhr && a.stoppuhr && b.stoppuhr.cprKnopf !== a.stoppuhr.cprKnopf) {
            const cpr = (s) => (s.cprKnopf ? 'CPR-Knopf angeboten' : 'kein CPR-Knopf');
            lines.push(`  Stoppuhr ${a.stoppuhr.sekunden} s ohne Atemzug bei „${short(plain(a.frage.text))}“: ${cpr(b.stoppuhr)} → ${cpr(a.stoppuhr)}`);
        }
    }
    if (before.dispo !== after.dispo) lines.push(`  Dispo: ${before.dispo} → ${after.dispo}`);
    const sb = before.szenarien.join(', ');
    const sa = after.szenarien.join(', ');
    if (sb !== sa) lines.push(`  Szenarien: ${sb || '–'} → ${sa || '–'}`);
    const zb = new Set(before.zusammenfassung);
    const za = new Set(after.zusammenfassung);
    for (const z of before.zusammenfassung) if (!za.has(z)) lines.push(`  Zusammenfassung − ${z}`);
    for (const z of after.zusammenfassung) if (!zb.has(z)) lines.push(`  Zusammenfassung + ${z}`);
    const db = new Set(before.diagnose.map((d) => `${d.art}: ${d.text}`));
    const da = new Set(after.diagnose.map((d) => `${d.art}: ${d.text}`));
    for (const d of da) if (!db.has(d)) lines.push(`  Parser + ${d}`);
    for (const d of db) if (!da.has(d)) lines.push(`  Parser − ${d}`);
    const endB = before.end.frage ? key(before.end.frage) : before.end.art;
    const endA = after.end.frage ? key(after.end.frage) : after.end.art;
    if (endB !== endA) {
        const describe = (r) => (r.end.frage ? `„${short(plain(r.end.frage.text))}“` : r.end.art);
        lines.push(`  Ende: ${describe(before)} → ${describe(after)}`);
    }
    console.log(lines.length ? lines.join('\n') : '  keine Unterschiede im Pfad');
}

export function printRun(run, options = {}) {
    const { result } = run;
    console.log(`\n== ${run.label} ==`);
    if (result.start) {
        const q = result.start.frage;
        console.log(`  Start aus Knowledge Stash „${result.start.name}“ → ${q ? `„${short(plain(q.text ?? q.rawText))}“ (${q.knowledgeIdentifier})` : 'keine Frage'} · Dispo ${result.start.dispo}`);
    }
    result.steps.forEach((step, i) => {
        const q = `${short(plain(step.frage.text ?? step.frage.rawText))} (${step.frage.knowledgeIdentifier})`;
        console.log(`${String(i + 1).padStart(3)}  ${q}`);
        if (step.vorausgewaehlt?.length) console.log(`       ! beim Anzeigen schon markiert: ${step.vorausgewaehlt.join(', ')}`);
        console.log(`       → ${short(step.antwort, 60)}   [Dispo ${step.dispo}]`);
        const b = step.atemfrequenz;
        if (b) {
            if (b.stoppuhr) console.log(`       Stoppuhr ${b.stoppuhr.sekunden} s ohne Atemzug: ${b.stoppuhr.cprKnopf ? 'CPR-Knopf angeboten' : 'kein CPR-Knopf'}`);
            console.log(`       Atemfrequenz ${b.wert}/min${b.altersgruppe ? ` (${b.altersgruppe})` : ''}: ${describeBreathing(b)}`);
        }
        if (options.wissen) for (const line of step.wissen ?? []) console.log(`         ${line}`);
        for (const shot of step.screenshots ?? []) console.log(`       Screenshot: ${shot}`);
    });
    if (result.end.art === 'offen') {
        const q = result.end.frage;
        console.log(`  Ende: nächste Frage ohne Antwort im Pfad: „${plain(q.text ?? q.rawText)}“ (${q.knowledgeIdentifier})`);
        if (result.end.vorausgewaehlt?.length) console.log(`        ! beim Anzeigen schon markiert: ${result.end.vorausgewaehlt.join(', ')}`);
        const opts = (q.answers ?? []).map((a) => (a.type === 2 ? '(Eingabe)' : `„${plain(a.text)}“`));
        const shown = opts.slice(0, 15).join(' · ') + (opts.length > 15 ? ` · … (${opts.length})` : '');
        const extra = [q.visualization && `Visualisierung ${q.visualization}`, !q.hideUnknownAnswer && 'Unbekannt möglich'].filter(Boolean).join(', ');
        console.log(`        Antworten: ${shown || '–'}${extra ? ` [${extra}]` : ''}`);
    } else {
        console.log(`  Ende: Abfrage ${result.end.art}`);
    }
    for (const shot of result.end.screenshots ?? []) console.log(`  Screenshot: ${shot}`);
    for (const z of result.zurueck ?? []) {
        console.log(`  Zurück zu „${short(plain(z.frage.text))}“: markiert ${z.vorausgewaehlt.join(', ') || 'nichts'}`);
        for (const shot of z.screenshots) console.log(`  Screenshot: ${shot}`);
    }
    console.log(`  Dispo: ${result.dispo} · Szenarien: ${result.szenarien.join(', ') || '–'}`);
    console.log('  Zusammenfassung:');
    for (const line of result.zusammenfassung.length ? result.zusammenfassung : ['–']) console.log(`    ${line}`);
    if (result.unbenutzt?.length) console.log(`  Nicht verwendete Antworten: ${result.unbenutzt.join(' · ')}`);
    if (result.diagnose.length) {
        console.log('  AUDIS-Parser/Diagnose:');
        for (const d of result.diagnose) console.log(`    ${d.art}: ${d.text}`);
    } else {
        console.log('  AUDIS-Parser/Diagnose: keine Befunde');
    }
}

// Gemeinsamer Abschluss: Vergleiche, Prüfungen, Ergebnis und Exit-Code.
export function report(runs, pfad, options = {}) {
    // runs: { stand: 'vorher' | 'nachher' | 'stand', server: Schlüssel des AUDIS-Servers, label, result }
    for (const run of runs) printRun(run, options);
    const befores = runs.filter((r) => r.stand === 'vorher');
    const afterRuns = runs.filter((r) => r.stand !== 'vorher');
    const beforeOf = (run) => befores.find((b) => b.server === run.server);
    for (const after of afterRuns) {
        const before = beforeOf(after);
        if (before) printComparison(before.result, after.result, { before: before.label, after: after.label });
    }
    for (let i = 1; i < afterRuns.length; i++) printComparison(afterRuns[0].result, afterRuns[i].result, { before: afterRuns[0].label, after: afterRuns[i].label });
    let failed = 0;
    let total = 0;
    for (const run of afterRuns) {
        const before = beforeOf(run);
        const checks = [...diagnosticChecks(before ? [before, run] : [run]), ...checkExpectations(run.result, pfad.erwartet)];
        console.log(`\n== Prüfungen (${run.label}) ==`);
        for (const c of checks) console.log(`  ${c.skip ? '[–]     ' : c.ok ? '[ok]    ' : '[FEHLER]'} ${c.text}`);
        failed += checks.filter((c) => !c.ok).length;
        total += checks.filter((c) => !c.skip).length;
    }
    const note = pfad.erwartet ? '' : ' (keine Erwartungen in der Pfaddatei)';
    console.log(`\nErgebnis: ${failed === 0 ? `alle Prüfungen erfüllt${note}` : `${failed} von ${total} Prüfungen verfehlt`}`);
    return failed > 0 ? 1 : 0;
}

export function runMain(main, usage) {
    main().then(
        (code) => process.exit(code),
        (e) => {
            stopAll();
            if (e instanceof UsageError || e instanceof PathError) {
                console.error(`\n${e instanceof PathError ? 'Pfadfehler' : 'Fehler'}: ${e.message}`);
                if (e instanceof UsageError && usage && /fehlt|Option|Argumente|erwartet einen Wert/.test(e.message)) console.error(`\n${usage}`);
            } else {
                console.error(e);
            }
            process.exit(2);
        }
    );
}
