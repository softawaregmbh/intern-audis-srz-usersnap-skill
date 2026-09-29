#!/usr/bin/env node
/**
 * check-catalog.mjs
 *
 * Statische Prüfungen für den AUDIS-Fragenkatalog im Repository audis-srz.
 * Ersetzt nicht den AUDIS-Parser (Diagnose der VS-Code-Erweiterung bzw. AUDIS-Vorschau),
 * findet aber typische Fehlerquellen, bevor eine Änderung getestet oder committet wird.
 *
 * Der committete Stand des Katalogs gilt als Ausgangsbasis. Standardmäßig meldet das Skript
 * deshalb nur Befunde, die durch die (noch nicht committeten) Änderungen neu entstehen.
 *
 * Aufruf (im Wurzelverzeichnis des audis-srz-Repos):
 *   node <skill>/scripts/check-catalog.mjs                     neue Befunde ggü. HEAD (Standard)
 *   node <skill>/scripts/check-catalog.mjs --base origin/softaware
 *   node <skill>/scripts/check-catalog.mjs --alle              alle Befunde des gesamten Katalogs
 *
 * Optionen:
 *   --repo <pfad>   Pfad zum audis-srz-Repo (Standard: aktuelles Verzeichnis)
 *   --base <ref>    Vergleichsstand (Standard: HEAD). Zeigt zusätzlich die geänderten Dateien
 *                   und wo geänderte Kataloge inkludiert werden.
 *   --stand <ref>   Statt des Arbeitsverzeichnisses einen Git-Stand prüfen, z. B. um die
 *                   Kunden-Änderungen auf release zu prüfen:
 *                   --stand origin/release --base <gemeinsamer Stand mit softaware>
 *   --alle          Ohne Vergleich: alle Befunde des gesamten Katalogs (Analyse)
 *   --hinweise      Auch Befunde der Stufe HINWEIS ausgeben
 *
 * Exit-Code: 0 = keine neuen Fehler oder Warnungen; 1 = neue Befunde (bei --alle: nur Fehler); 2 = Aufruffehler.
 * Voraussetzungen: Node.js >= 18, git (nur für --base).
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Konstanten aus der AUDIS-Grammatik (Audis.g4) und der Engine
// ---------------------------------------------------------------------------

const SECTION_ORDER = ['Trigger', 'Suche', 'Fragen', 'Szenarien', 'Tags', 'Zusammenfassung'];

// CHAR im Lexer: a-z, A-Z, 0-9, äöüßÄÖÜ und Latin-1-Diakritika (ohne × und ÷)
const CHAR_CLASS = 'A-Za-z0-9äöüßÄÖÜ\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u00FF';
const RE_CHAR = new RegExp(`[${CHAR_CLASS}]`);
// Zeichen, die in unquotiertem Text (Token TEXT) vorkommen dürfen
const RE_TEXT_CHAR = new RegExp(`[${CHAR_CLASS} ()?!.+,:\\-/*]`);
// Zeichen, die in Text zwischen Anführungszeichen (Token QUOTEDTEXT) vorkommen dürfen
const RE_QUOTED_CHAR = new RegExp(`[${CHAR_CLASS} ()\\[\\]{}?!.+,/\\\\:\\-><&%_#'$€@~|^*]`);

const IDENT_BODY = 'A-Za-z0-9äöüßÄÖÜ.\\-';
const RE_IDENT_G = new RegExp(`#[${IDENT_BODY}]+`, 'g');

const QUESTION_OPTIONS = new Set([
  'multiselect', 'visualization', 'exclusive', 'autocomplete', 'allowFreetext', 'hideUnknownAnswer',
  'forceSummary', 'link', 'colormode', 'required', 'help', 'priority',
  // Parameter von Visualisierungen
  'icon', 'alignment', 'mediaFile', 'format', 'min', 'max',
]);
const ANSWER_OPTIONS = new Set(['help', 'link', 'priority']);
const TRIGGER_OPTIONS = new Set(['triggertype', 'triggerEvent']);
const SUMMARY_OPTIONS = new Set(['priority']);
const VISUALIZATIONS = new Set([
  'pain', 'pain-scale', 'perpetrator', 'injuries', 'body', 'bodyCoarse', 'burn', 'burnCoarse', 'hazard',
  'datetime', 'date', 'time', 'feedback', 'location', 'heartbeat', 'respiratory', 'building', 'buildingFire',
  'industrial', 'industrialFire', 'bloodpressure', 'reanimation', 'apisearch', 'age', 'counter',
  'info', 'warning', 'danger', 'instruction', 'number', 'media',
]);
const COLOR_MODES = new Set(['infoColoring', 'warningColoring', 'dangerColoring', 'dispatcherColoring']);
const ALIGNMENTS = new Set(['top', 'bottom', 'left', 'right']);
const TRIGGER_TYPES = new Set(['default', 'suggested', 'final']);

// Übersetzte Altersgruppen (DE/CH) und Körperregionen für .grouped
const AGE_GROUPS = ['Säugling', 'Kleinkind', 'Kind/Jugend', 'Erwachsen'];
const BODY_GROUPS = ['Kopfregion', 'Rumpf', 'Extremitäten', 'Arm', 'Bein', 'Gelenke'];

// Wissen, das Visualisierungen zusätzlich zum Frage-Identifier erzeugen
const BODY_VIS = new Set(['body', 'bodyCoarse', 'pain', 'injuries', 'burn', 'burnCoarse']);
const VIS_DERIVED_OPEN = {
  age: ['.age', '.days', '.weeks', '.months', '.year', '.date'],
  body: ['.simple'], bodyCoarse: ['.simple'], pain: ['.simple'], injuries: ['.simple'],
  burn: ['.simple', '.percentage', '.percentage.degree.1', '.percentage.degree.2', '.percentage.degree.3', '.percentage.degree.4'],
  burnCoarse: ['.simple', '.percentage', '.percentage.degree.1', '.percentage.degree.2', '.percentage.degree.3', '.percentage.degree.4'],
  bloodpressure: ['.systolic', '.diastolic', '.blood-pressure-type'],
  datetime: ['.hours'], date: ['.hours'], time: ['.hours'],
  building: ['.type', '.full', '.floor'], buildingFire: ['.type', '.full', '.floor'],
  industrial: ['.type', '.full', '.floor'], industrialFire: ['.type', '.full', '.floor'],
  reanimation: ['.duration', '.compression.count', '.ventilation.count', '.timestamp.start'],
  location: ['/street', '/streetNumber', '/zipCode', '/city', '/latitude', '/longitude'],
};

// Funktionen, die in Enricher- und InjectionButton-Bedingungen (Flee) bekannt sind
const FLEE_FUNCTIONS = new Set([
  'contains', 'containsAll', 'asNumeric', 'asNumericOrDefault', 'age', 'asDate', 'asText',
  'isNull', 'isNotNull', 'isKnowledgeSet', 'exists', 'product', 'sum',
]);

const SEVERITY_RANK = { FEHLER: 0, WARNUNG: 1, HINWEIS: 2 };

// ---------------------------------------------------------------------------
// Kommandozeile
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`Aufruf: node check-catalog.mjs [--repo <pfad>] [--base <git-ref>] [--stand <git-ref>] [--alle] [--hinweise]

  Standard: nur Befunde, die gegenüber dem letzten Commit (HEAD) neu sind.

  --repo <pfad>   Pfad zum audis-srz-Repo (Standard: aktuelles Verzeichnis)
  --base <ref>    Anderer Vergleichsstand als HEAD (z. B. origin/softaware)
  --stand <ref>   Git-Stand statt Arbeitsverzeichnis prüfen (z. B. origin/release)
  --alle          Ohne Vergleich: alle Befunde des gesamten Katalogs (Analyse)
  --hinweise      Auch Befunde der Stufe HINWEIS ausgeben
  --rueckfaelle   Alle Dateien des Stands darauf prüfen, ob sie wieder einem älteren Stand entsprechen
                  (spätere Commits damit rückgängig, z. B. durch einen Kunden-Release-Kandidaten)

  Im Vergleich werden geänderte Dateien immer auf solche Rückfälle geprüft.`);
}

function parseArgs(argv) {
  const opts = { repo: process.cwd(), base: null, stand: null, alle: false, hinweise: false, rueckfaelle: false, defaultBase: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo' && argv[i + 1]) opts.repo = argv[++i];
    else if (a === '--base' && argv[i + 1]) opts.base = argv[++i];
    else if (a === '--stand' && argv[i + 1]) opts.stand = argv[++i];
    else if (a === '--alle') opts.alle = true;
    else if (a === '--hinweise') opts.hinweise = true;
    else if (a === '--rueckfaelle') opts.rueckfaelle = true;
    else if (a === '-h' || a === '--help') { printHelp(); process.exit(0); }
    else { console.error(`Unbekannte oder unvollständige Option: ${a}`); printHelp(); process.exit(2); }
  }
  if (opts.alle && opts.base) { console.error('--alle und --base schließen sich aus.'); process.exit(2); }
  // Der committete Stand gilt als Ausgangsbasis: ohne Angabe gegen HEAD vergleichen
  if (!opts.alle && !opts.base) { opts.base = 'HEAD'; opts.defaultBase = true; }
  opts.repo = path.resolve(opts.repo);
  return opts;
}

// ---------------------------------------------------------------------------
// Dateiquellen (Arbeitsverzeichnis oder Git-Stand)
// ---------------------------------------------------------------------------

const RELEVANT_TOP = ['questioncatalog', 'config', 'constants.json', 'revision-settings.json'];

function git(repo, args, input) {
  const r = spawnSync('git', args, { cwd: repo, input, maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw new Error(`git konnte nicht ausgeführt werden: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} fehlgeschlagen: ${r.stderr.toString().trim()}`);
  return r.stdout;
}

function workingTreeSource(repo) {
  const files = [];
  const walk = (rel) => {
    const abs = path.join(repo, rel);
    if (!fs.existsSync(abs)) return;
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(abs)) walk(rel ? `${rel}/${name}` : name);
    } else {
      files.push(rel);
    }
  };
  for (const top of RELEVANT_TOP) walk(top);
  return {
    label: 'Arbeitsverzeichnis',
    files,
    read: (rel) => stripBom(fs.readFileSync(path.join(repo, rel), 'utf8')),
  };
}

function gitRefSource(repo, ref) {
  const list = git(repo, ['ls-tree', '-r', '-z', '--name-only', ref, '--', ...RELEVANT_TOP]).toString('utf8');
  const files = list.split('\0').filter(Boolean);
  // Alle Inhalte in einem Aufruf lesen
  const input = files.map((f) => `${ref}:${f}`).join('\n') + '\n';
  const out = git(repo, ['cat-file', '--batch'], input);
  const contents = new Map();
  let pos = 0;
  for (const f of files) {
    const nl = out.indexOf(0x0a, pos);
    const header = out.subarray(pos, nl).toString('utf8');
    const m = header.match(/^\S+ (\S+) (\d+)$/);
    if (!m) throw new Error(`Unerwartete Ausgabe von git cat-file für ${f}: ${header}`);
    const size = Number(m[2]);
    contents.set(f, stripBom(out.subarray(nl + 1, nl + 1 + size).toString('utf8')));
    pos = nl + 1 + size + 1;
  }
  return { label: ref, files, read: (rel) => contents.get(rel) ?? '' };
}

// ---------------------------------------------------------------------------
// Rückfälle: Datei entspricht wieder einem älteren Stand (spätere Commits damit rückgängig)
// ---------------------------------------------------------------------------

// Versionen je Datei aus einem git-log-Aufruf: neueste zuerst, mit Blob nach dem Commit.
function fileHistory(repo, ref) {
  const out = git(repo, ['-c', 'core.quotepath=off', 'log', '--no-merges', '--no-renames', '--raw', '--no-abbrev', '--date=short',
    '--format=%x01%H%x02%ad%x02%an%x02%s', ref, '--', ...RELEVANT_TOP]).toString('utf8');
  const history = new Map();
  let commit = null;
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('\x01')) {
      const [hash, date, author, subject] = line.slice(1).split('\x02');
      commit = { hash, date, author, subject };
      continue;
    }
    const m = line.match(/^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) [A-Z]\d*\t(.+)$/);
    if (!m || !commit) continue;
    if (!history.has(m[2])) history.set(m[2], []);
    history.get(m[2]).push({ ...commit, blob: m[1] });
  }
  return history;
}

// Entspricht der Blob einer älteren Version, obwohl die Datei danach anders war? Dann sind diese späteren Commits rückgängig.
function findRevert(versions, blob) {
  if (!versions || !blob || /^0+$/.test(blob)) return null;
  let oldest = -1;
  for (let i = versions.length - 1; i >= 0; i--) if (versions[i].blob === blob) { oldest = i; break; }
  if (oldest <= 0) return null;
  const newer = versions.slice(0, oldest);
  const undone = newer.filter((v) => v.blob !== blob);
  const by = newer.filter((v) => v.blob === blob);
  if (!undone.length) return null;
  // Nimmt jemand nur eigene frühere Änderungen zurück (z. B. ein Release-Kandidat den vorigen), ist das kein Befund.
  if (by.length && undone.every((u) => by.some((b) => b.author === u.author))) return null;
  return { stand: versions[oldest], undone, by };
}

function formatRevert(file, r) {
  const c = (v) => `${v.hash.slice(0, 7)} ${v.subject} (${v.author}, ${v.date})`;
  const lines = [`  ${file} entspricht wieder dem Stand von ${r.stand.hash.slice(0, 7)} (${r.stand.date})`];
  lines.push(`    damit rückgängig: ${r.undone.map(c).join(' · ')}`);
  if (r.by.length) lines.push(`    zurückgesetzt durch: ${r.by.map(c).join(' · ')}`);
  return lines;
}

// Unveränderte Zeilen zweier Dateistände (längste gemeinsame Teilfolge): Zeilennummer neu → Zeilennummer alt.
function unchangedLines(oldText, newText) {
  const a = oldText.split(/\r?\n/).map((l) => l.trimEnd());
  const b = newText.split(/\r?\n/).map((l) => l.trimEnd());
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const map = new Map();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { map.set(j + 1, i + 1); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return map;
}

// Blob einer Datei im Arbeitsverzeichnis (mit den Filtern des Repos, z. B. Zeilenenden) oder in einem Git-Stand.
function blobOf(repo, file, ref) {
  try {
    if (ref) return git(repo, ['rev-parse', `${ref}:${file}`]).toString().trim();
    if (!fs.existsSync(path.join(repo, file))) return null;
    return git(repo, ['hash-object', '--', file]).toString().trim();
  } catch {
    return null;
  }
}

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen für Text
// ---------------------------------------------------------------------------

/** Entfernt // und /* *\/ Kommentare außerhalb von Anführungszeichen. */
function stripComments(lines) {
  let inBlock = false;
  return lines.map((raw) => {
    let out = '';
    let inQuote = false;
    let i = 0;
    while (i < raw.length) {
      if (inBlock) {
        const end = raw.indexOf('*/', i);
        if (end < 0) { i = raw.length; break; }
        inBlock = false;
        i = end + 2;
        continue;
      }
      const ch = raw[i];
      if (ch === '"') { inQuote = !inQuote; out += ch; i++; continue; }
      if (!inQuote && raw.startsWith('//', i)) break;
      if (!inQuote && raw.startsWith('/*', i)) { inBlock = true; i += 2; continue; }
      out += ch;
      i++;
    }
    return out.replace(/\s+$/, '');
  });
}

/** Ersetzt den Inhalt von "…" (inkl. Anführungszeichen) durch Füllzeichen gleicher Länge. */
function maskQuotes(s) {
  return s.replace(/"[^"]*"/g, (m) => '\u0001'.repeat(m.length));
}

/** Ersetzt den Inhalt von […] durch Füllzeichen gleicher Länge (Synonyme). */
function maskBrackets(s) {
  return s.replace(/\[[^\]]*\]/g, (m) => '\u0002'.repeat(m.length));
}

/** Teilt s an Trennzeichen, die im maskierten String m stehen. */
function splitMasked(s, m, sep) {
  const parts = [];
  let start = 0;
  for (let i = 0; i < m.length; i++) {
    if (m[i] === sep) { parts.push([s.slice(start, i), m.slice(start, i)]); start = i + 1; }
  }
  parts.push([s.slice(start), m.slice(start)]);
  return parts;
}

function stripQuotes(s) {
  const t = s.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
}

function stripMarkup(s) {
  return s.replace(/\*\*/g, '');
}

function indentOf(line) {
  const m = line.match(/^\s*/);
  return m ? m[0].length : 0;
}

/** Normalisierung von Label-Postfixes wie im AUDIS-Parser (KnowledgeIdentifierGenerator). */
function normalizeSuffix(text) {
  let s = text;
  for (const c of ['?', '-', ':', '"', '(', ')', '[', ']', '{', '}', '+', ',', '/', '\\', '<', '>']) s = s.split(c).join('');
  return s.trim().toLowerCase().replace(/ /g, '-');
}

function levenshtein(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function suggest(word, candidates, limit = 3) {
  const w = word.toLowerCase();
  const max = Math.max(2, Math.floor(w.length * 0.25));
  const scored = [];
  for (const c of candidates) {
    const d = levenshtein(w, c.toLowerCase(), max);
    if (d <= max) scored.push([d, c]);
  }
  scored.sort((x, y) => x[0] - y[0] || x[1].localeCompare(y[1]));
  return scored.slice(0, limit).map((x) => x[1]);
}

/** Prüft Zeichen eines Textstücks gegen die erlaubte Zeichenklasse. */
function firstBadChar(text, re) {
  for (const ch of text) {
    if (!re.test(ch)) return ch;
  }
  return null;
}

function describeChar(ch) {
  const code = ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
  const names = {
    ' ': 'geschütztes Leerzeichen', '\t': 'Tabulator', '–': 'Halbgeviertstrich', '—': 'Geviertstrich',
    '„': 'typografisches Anführungszeichen', '“': 'typografisches Anführungszeichen',
    '”': 'typografisches Anführungszeichen', '’': 'typografischer Apostroph', '«': 'Guillemet',
    '»': 'Guillemet', '…': 'Auslassungszeichen', '°': 'Gradzeichen',
  };
  return `„${ch}“ (U+${code}${names[ch] ? ', ' + names[ch] : ''})`;
}

// ---------------------------------------------------------------------------
// JSON mit Kommentaren lesen
// ---------------------------------------------------------------------------

function parseJsonLoose(text) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      out += ch;
      if (ch === '\\') { out += text[++i] ?? ''; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (ch === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (ch === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 1; continue; }
    out += ch;
  }
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(out);
}

function lineOfText(text, needle) {
  const idx = text.indexOf(needle);
  if (idx < 0) return 0;
  return text.slice(0, idx).split('\n').length;
}

// ---------------------------------------------------------------------------
// Analyse
// ---------------------------------------------------------------------------

function analyze(source) {
  const findings = [];
  const add = (severity, file, line, message) => findings.push({ severity, file, line, message });

  const knowledge = new Map(); // id -> { values: Map(lower -> original), open, multi, sources }
  const ensure = (id) => {
    if (!knowledge.has(id)) knowledge.set(id, { values: new Map(), open: false, multi: false, sources: [] });
    return knowledge.get(id);
  };
  const setValue = (id, value, src) => {
    const k = ensure(id);
    const v = String(value).trim();
    if (v) k.values.set(v.toLowerCase(), v);
    if (src) k.sources.push(src);
  };
  const setOpen = (id, src) => {
    const k = ensure(id);
    k.open = true;
    if (src) k.sources.push(src);
  };

  const usages = []; // { id, op, values, file, line, kind: 'audis'|'flee', exact }
  const includes = []; // { from, target, file, line }
  const bindings = []; // Bedingungen ohne Identifier: { file, line, expr, scope } – für den Vergleich vorher/nachher
  const catalogs = new Map(); // name -> { file, hasTrigger, rules, triggerUsed }

  // --- constants.json ---------------------------------------------------------
  let constants = {};
  if (source.files.includes('constants.json')) {
    try { constants = parseJsonLoose(source.read('constants.json')); } catch (e) {
      add('FEHLER', 'constants.json', 0, `JSON nicht lesbar: ${e.message}`);
    }
  } else {
    add('FEHLER', 'constants.json', 0, 'constants.json fehlt – ist --repo das audis-srz-Repo?');
  }
  const scenarioIds = new Set((constants.Scenarios ?? []).map((s) => s.ScenarioIdentifier));
  const dispoCodes = (constants.DispositionLevels ?? []).map((d) => d.DispositionCode);
  const events = new Set(constants.Events ?? []);
  const defaultAnswerValues = (constants.DefaultAnswers ?? []).map((a) => a.KnowledgeValue);
  for (const s of scenarioIds) setValue('#audis.scenarios', s, 'constants.json');
  for (const d of dispoCodes) setValue('#audis.dispo', d, 'constants.json');
  for (const [, id] of Object.entries(constants.InitialKnowledgeIdentifiers ?? {})) setOpen(id, 'constants.json');

  // --- revision-settings.json ------------------------------------------------
  let revision = {};
  if (source.files.includes('revision-settings.json')) {
    try { revision = parseJsonLoose(source.read('revision-settings.json')); } catch (e) {
      add('FEHLER', 'revision-settings.json', 0, `JSON nicht lesbar: ${e.message}`);
    }
  }
  const unknownValue = revision.UnknownAnswer?.KnowledgeValue ?? 'unbekannt';
  const showUnknown = revision.UnknownAnswer?.ShowUnknownAnswer !== false;
  const ageGroupId = revision.Visualization?.AgeGroup?.AgeGroupIdentifier;
  if (ageGroupId) for (const g of AGE_GROUPS) setValue(ageGroupId, g, 'revision-settings.json');
  const resp = revision.Visualization?.Respiratory ?? {};
  for (const key of ['KnowledgeToAddBeneathLowerThreshold', 'KnowledgeToAddAboveUpperThreshold']) {
    if (resp[key]?.KnowledgeIdentifier) setValue(resp[key].KnowledgeIdentifier, resp[key].KnowledgeValue ?? '', 'revision-settings.json');
  }
  // Atemanalyse: Fehlt in "Thresholds" eine Altersgruppe, erkennt die Stoppuhr der Oberfläche für diese Gruppe keinen
  // Atemstillstand (kein CPR-Knopf, beobachtet mit AUDIS 2.4.0).
  if (Array.isArray(resp.Thresholds) && resp.Thresholds.length > 0) {
    const names = ['NewBorn', 'Baby', 'ChildTeenager', 'Adult'];
    const present = new Set(resp.Thresholds.map((t) => (typeof t.AgeGroup === 'number' ? names[t.AgeGroup - 1] : String(t.AgeGroup ?? '')).toLowerCase()));
    const missing = names.filter((g) => !present.has(g.toLowerCase()));
    if (missing.length) {
      add('WARNUNG', 'revision-settings.json', lineOfText(source.read('revision-settings.json'), '"Thresholds"'),
        `Visualization.Respiratory.Thresholds ohne ${missing.join(', ')}: Für diese Altersgruppen erkennt die Stoppuhr der Atemanalyse keinen Atemstillstand, der CPR-Knopf fehlt. Alle vier Altersgruppen eintragen.`);
    }
  }
  for (const d of revision.IntermediateDispositions ?? []) {
    for (const k of d.Disposition?.Knowledge ?? []) for (const v of k.Values ?? []) setValue(k.KnowledgeIdentifier, v, 'revision-settings.json');
  }

  // --- Extern gesetztes Wissen (AUDIS, Einsatzleitsystem, Analyzer) ------------
  let external = { praefixe: [], identifier: [], platzhalter: [] };
  const extPath = path.join(SCRIPT_DIR, 'external-knowledge.json');
  if (fs.existsSync(extPath)) external = parseJsonLoose(fs.readFileSync(extPath, 'utf8'));
  const idsOf = (list) => (list ?? []).map((e) => (typeof e === 'string' ? e : e.id)).filter(Boolean);
  for (const id of idsOf(external.identifier)) setOpen(id, 'external-knowledge.json');
  // Platzhalter (absichtlich nie gesetzt, z. B. Dummy-Trigger oder Feature-Schalter): nicht als Fehler melden
  const placeholders = new Set(idsOf(external.platzhalter));
  const isExternalPrefix = (id) => idsOf(external.praefixe).some((p) => id.startsWith(p));

  // --- Enricher und Injection-Buttons -----------------------------------------
  const fleeConditions = []; // { file, line, condition }
  const handleEnrichers = (file, obj, text) => {
    for (const [name, enr] of Object.entries(obj ?? {})) {
      const data = enr?.EnricherData ?? {};
      if (!enr?.Type && !enr?.FullName) add('FEHLER', file, lineOfText(text, `"${name}"`), `Enricher „${name}“ ohne Type`);
      if (typeof data.Condition === 'string') fleeConditions.push({ file, line: lineOfText(text, `"${name}"`), condition: data.Condition, name });
      for (const k of data.KnowledgeToAdd ?? []) {
        if (!k.KnowledgeIdentifier) continue;
        const v = String(k.KnowledgeValue ?? '');
        if (v.includes('{#')) {
          setOpen(k.KnowledgeIdentifier, file);
          for (const m of v.matchAll(/\{(#[^}]+)\}/g)) usages.push({ id: m[1], op: null, values: [], file, line: lineOfText(text, `"${name}"`), kind: 'flee' });
        } else setValue(k.KnowledgeIdentifier, v, file);
      }
    }
  };
  const handleButtons = (file, arr, text) => {
    for (const b of Array.isArray(arr) ? arr : []) {
      const line = lineOfText(text, `"${b.Name}"`);
      if (!b.Name || !b.DisplayName) add('FEHLER', file, line, 'InjectionButton ohne Name oder DisplayName');
      if (typeof b.Condition === 'string') fleeConditions.push({ file, line, condition: b.Condition, name: b.Name });
      for (const k of b.InjectionKnowledge ?? []) for (const v of k.Values ?? []) setValue(k.KnowledgeIdentifier, v, file);
    }
  };
  for (const f of source.files.filter((f) => f.startsWith('config/') && f.endsWith('.json'))) {
    const base = path.posix.basename(f);
    const text = source.read(f);
    let obj;
    try { obj = parseJsonLoose(text); } catch (e) { add('FEHLER', f, 0, `JSON nicht lesbar: ${e.message}`); continue; }
    if (base.startsWith('enricher')) handleEnrichers(f, obj, text);
    else if (base.startsWith('injection')) handleButtons(f, obj, text);
  }
  if (revision.KnowledgeEnrichers) handleEnrichers('revision-settings.json', revision.KnowledgeEnrichers, source.read('revision-settings.json'));
  if (revision.InjectionButtons) handleButtons('revision-settings.json', revision.InjectionButtons, source.read('revision-settings.json'));

  // --- Kataloge ------------------------------------------------------------------
  const finalizeLater = []; // Fragen; Wissen wird erst nach dem Einlesen aller Kataloge abgeleitet
  const audisFiles = source.files.filter((f) => f.startsWith('questioncatalog/'));
  for (const f of audisFiles) {
    if (!f.endsWith('.audis')) add('WARNUNG', f, 0, 'Datei ohne Endung .audis im Ordner questioncatalog – wird von AUDIS nicht als Katalog geladen');
  }
  const catalogNameOf = (f) => f.slice('questioncatalog/'.length).replace(/\.audis$/, '');
  for (const f of audisFiles.filter((f) => f.endsWith('.audis'))) {
    parseCatalog(f, catalogNameOf(f), source.read(f));
  }

  // ------------------------------------------------------------------------------
  function parseCatalog(file, catalogName, text) {
    const rawLines = text.split(/\r?\n/);
    const code = stripComments(rawLines);
    const cat = { file, hasTrigger: false, ruleCount: 0 };
    catalogs.set(catalogName, cat);

    // Abschnitte bestimmen
    const sections = []; // { name, start, end }
    let lastOrder = -1;
    const seen = new Set();
    code.forEach((l, idx) => {
      const t = l.trim();
      if (!t.startsWith('##')) return;
      const m = t.match(/^##\s*(.*?)\s*##$/);
      if (!m) { add('FEHLER', file, idx + 1, `Ungültige Abschnittsüberschrift „${t}“`); return; }
      const name = m[1];
      if (t !== `## ${name} ##` || !SECTION_ORDER.includes(name)) {
        add('FEHLER', file, idx + 1, `Abschnittsüberschrift „${t}“ ungültig – erlaubt sind exakt: ${SECTION_ORDER.map((s) => `## ${s} ##`).join(', ')}`);
        return;
      }
      if (seen.has(name)) add('FEHLER', file, idx + 1, `Abschnitt „${name}“ mehrfach vorhanden`);
      const order = SECTION_ORDER.indexOf(name);
      if (order < lastOrder) add('FEHLER', file, idx + 1, `Abschnitt „${name}“ steht an falscher Stelle – Reihenfolge: ${SECTION_ORDER.join(', ')}`);
      lastOrder = Math.max(lastOrder, order);
      seen.add(name);
      if (sections.length) sections[sections.length - 1].end = idx;
      sections.push({ name, start: idx + 1, end: code.length });
    });
    const firstHeading = sections.length ? sections[0].start - 1 : code.length;
    for (let i = 0; i < firstHeading; i++) {
      if (code[i].trim()) { add('FEHLER', file, i + 1, 'Inhalt vor der ersten Abschnittsüberschrift'); break; }
    }

    for (const sec of sections) {
      const idxs = [];
      for (let i = sec.start; i < sec.end; i++) idxs.push(i);
      if (sec.name === 'Trigger') parseTriggers(file, idxs, code, rawLines, cat);
      else if (sec.name === 'Suche') parseSearch(file, idxs, code);
      else if (sec.name === 'Fragen') parseQuestions(file, catalogName, idxs, code);
      else if (sec.name === 'Szenarien') parseRules(file, idxs, code, 'scenario', cat);
      else if (sec.name === 'Tags') parseRules(file, idxs, code, 'tag', cat);
      else if (sec.name === 'Zusammenfassung') parseSummary(file, idxs, code, cat);
    }

    if (cat.ruleCount > 0 && !cat.hasTrigger) {
      add('WARNUNG', file, 0, 'Katalog enthält Szenario-/Tag-/Zusammenfassungsregeln, aber keinen Trigger – diese Regeln sind dann ohne Vorbedingung global aktiv (Templates brauchen einen Dummy-Trigger wie „#inkludebugfix = Version18“)');
    }
  }

  // --- Bedingungen ----------------------------------------------------------------
  function parseConditionExpr(file, line, expr, ctx) {
    // ctx: { bareScope: id|null }
    const parts = expr.split(/&&|\|\|/);
    for (const partRaw of parts) {
      const part = partRaw.trim();
      if (!part) { add('FEHLER', file, line, `Leerer Teilausdruck in Bedingung „${expr.trim()}“`); continue; }
      const m = part.match(new RegExp(`^(#[${IDENT_BODY}]+)\\s*(!==|!=|=>|=)\\s*(.*)$`));
      if (m) {
        const [, id, op, rhs] = m;
        if (op === '=>') {
          const kw = rhs.trim();
          if (kw === 'GESETZT' || kw === 'BEKANNT') {
            add('FEHLER', file, line, `„=> ${kw}“ gibt es seit AUDIS 2.2.10 nicht mehr – „=> VORHANDEN“ bzw. „=> FEHLEND“ verwenden (BEKANNT ≙ „=> VORHANDEN && ${id} != unbekannt“)`);
          } else if (kw !== 'VORHANDEN' && kw !== 'FEHLEND') {
            add('FEHLER', file, line, `Nach „=>“ ist nur VORHANDEN oder FEHLEND erlaubt (gefunden: „${kw}“)`);
          }
          usages.push({ id, op, values: [], file, line, kind: 'audis' });
        } else {
          const values = rhs.split(';').map((v) => v.trim());
          if (values.some((v) => !v)) add('FEHLER', file, line, `Leerer Vergleichswert in „${part}“`);
          for (const v of values) checkTextToken(file, line, v, 'Vergleichswert');
          usages.push({ id, op, values: values.filter(Boolean), file, line, kind: 'audis' });
        }
      } else if (part.startsWith('#')) {
        add('FEHLER', file, line, `Vergleich ohne gültigen Operator: „${part}“ (erlaubt: =, !=, !==, => VORHANDEN/FEHLEND)`);
      } else {
        // Nackte Werte: beziehen sich auf die übergeordnete bzw. vorherige Frage
        const values = part.split(';').map((v) => v.trim()).filter(Boolean);
        for (const v of values) checkTextToken(file, line, v, 'Vergleichswert');
        if (ctx?.bareScope) usages.push({ id: ctx.bareScope, op: '=', values, file, line, kind: 'audis', bare: true });
        else if (ctx?.allowBare) add('WARNUNG', file, line, `Bedingung „${part}“ ohne Identifier und ohne erkennbare Bezugsfrage`);
        else add('FEHLER', file, line, `Bedingung „${part}“ ohne Identifier ist hier nicht erlaubt`);
      }
    }
  }

  function checkTextToken(file, line, text, what) {
    const t = text.trim();
    if (!t) return;
    const bad = firstBadChar(t, RE_TEXT_CHAR);
    if (bad) add('FEHLER', file, line, `${what} „${t}“ enthält ${describeChar(bad)} – in unquotiertem Text nicht erlaubt`);
    else if (!RE_CHAR.test(t[0]) && !t.startsWith('**')) add('FEHLER', file, line, `${what} „${t}“ muss mit Buchstabe, Ziffer oder ** beginnen`);
  }

  function checkQuoted(file, line, lineCode) {
    for (const m of lineCode.matchAll(/"([^"]*)"/g)) {
      const inner = m[1];
      if (!inner) { add('FEHLER', file, line, 'Leerer Text in Anführungszeichen'); continue; }
      if (/^https?:\/\//.test(inner) || /^[a-zA-Z]:/.test(inner)) continue; // Links (LINKTEXT)
      const withoutBold = inner.replace(/\*\*/g, '');
      const bad = firstBadChar(withoutBold, RE_QUOTED_CHAR) || (withoutBold.includes('*') ? '*' : null);
      if (bad) add('FEHLER', file, line, `Text in Anführungszeichen enthält ${describeChar(bad)} – dort nicht erlaubt`);
      else if (!RE_CHAR.test(inner[0]) && !inner.startsWith('**')) add('FEHLER', file, line, `Text in Anführungszeichen muss mit Buchstabe, Ziffer oder ** beginnen: „${inner.slice(0, 40)}“`);
    }
    if ((lineCode.match(/"/g) ?? []).length % 2 === 1) add('FEHLER', file, line, 'Ungerade Anzahl Anführungszeichen');
  }

  function parseMetadata(file, line, t, allowed, target) {
    const inner = t.replace(/^\{/, '').replace(/\}\s*$/, '');
    if (!t.trim().endsWith('}')) add('FEHLER', file, line, 'Metadaten ohne schließende }');
    const masked = maskQuotes(inner);
    const meta = {};
    for (const [raw] of splitMasked(inner, masked, ';')) {
      const opt = raw.trim();
      if (!opt) continue;
      const m = opt.match(/^([A-Za-z-]+)\s*(?:=\s*(.*))?$/);
      if (!m) { add('FEHLER', file, line, `Ungültige Metadaten-Option „${opt}“`); continue; }
      const [, key, valRaw] = m;
      const val = valRaw?.trim();
      if (!allowed.has(key)) {
        add('FEHLER', file, line, `Unbekannte Metadaten-Option „${key}“ (hier erlaubt: ${[...allowed].join(', ')})`);
        continue;
      }
      meta[key] = val ?? true;
      if (key === 'visualization' && val && !VISUALIZATIONS.has(val)) add('FEHLER', file, line, `Unbekannte Visualisierung „${val}“`);
      if (key === 'colormode' && val && !COLOR_MODES.has(val)) add('FEHLER', file, line, `Unbekannter colormode „${val}“ (erlaubt: ${[...COLOR_MODES].join(', ')})`);
      if (key === 'alignment' && val && !ALIGNMENTS.has(val)) add('FEHLER', file, line, `Ungültiges alignment „${val}“`);
      if (key === 'triggertype' && val && !TRIGGER_TYPES.has(val)) add('FEHLER', file, line, `Ungültiger triggertype „${val}“ (erlaubt: default, suggested, final)`);
      if (key === 'priority' && val && !/^"(0|100|[1-9][0-9]?)"$/.test(val)) add('FEHLER', file, line, `priority muss eine Zahl 0–100 in Anführungszeichen sein (gefunden: ${val})`);
      if (key === 'triggerEvent' && val) {
        const ev = stripQuotes(val);
        if (!events.has(ev)) add('FEHLER', file, line, `Ereignis „${ev}“ ist nicht in constants.json unter Events definiert`);
      }
      if (key === 'link' && val && !/^"(https?:\/\/|[a-zA-Z]:)/.test(val)) add('FEHLER', file, line, 'link muss ein Link in Anführungszeichen sein (http://, https:// oder Laufwerk)');
      if (['help', 'icon', 'mediaFile', 'format', 'min', 'max'].includes(key) && val) checkTextToken(file, line, val, `Wert von ${key}`);
    }
    if (target) Object.assign(target, meta);
    return meta;
  }

  // --- Trigger ------------------------------------------------------------------
  function parseTriggers(file, idxs, code, rawLines, cat) {
    let blockLines = 0; // Zeilen im aktuellen Trigger-Block
    let commentAfterBlock = null; // Kommentarzeile direkt nach Blockzeilen (ohne Leerzeile dazwischen)
    for (const i of idxs) {
      const t = code[i].trim();
      const rawT = rawLines[i].trim();
      if (!t) {
        // Leerzeilen und reine Kommentarzeilen beenden einen Trigger-Block
        if (rawT && blockLines > 0 && commentAfterBlock === null) commentAfterBlock = i + 1;
        else if (!rawT) commentAfterBlock = null;
        blockLines = 0;
        continue;
      }
      if (commentAfterBlock !== null) {
        add('HINWEIS', file, commentAfterBlock, 'Kommentarzeile zwischen Triggerzeilen trennt den Trigger in zwei Blöcke (wirkt wie Leerzeile → ODER statt UND)');
        commentAfterBlock = null;
      }
      if (t.startsWith('{')) {
        if (blockLines > 0) add('FEHLER', file, i + 1, 'Trigger-Metadaten müssen am Anfang eines Trigger-Blocks stehen');
        parseMetadata(file, i + 1, t, TRIGGER_OPTIONS, null);
        cat.hasTrigger = true;
        blockLines++;
        continue;
      }
      checkQuoted(file, i + 1, t);
      if (t.startsWith('[')) add('FEHLER', file, i + 1, 'Im Trigger-Abschnitt stehen Bedingungen ohne eckige Klammern');
      parseConditionExpr(file, i + 1, t, { allowBare: false });
      cat.hasTrigger = true;
      blockLines++;
    }
  }

  // --- Suche --------------------------------------------------------------------
  function parseSearch(file, idxs, code) {
    let hasTerm = false;
    for (const i of idxs) {
      const t = code[i].trim();
      if (!t) continue;
      const m = t.match(new RegExp(`^(#[${IDENT_BODY}]+)\\s*=\\s*(.+)$`));
      if (m) {
        if (!hasTerm) add('FEHLER', file, i + 1, 'Wissen im Suche-Abschnitt ohne vorangehenden Suchbegriff');
        for (const v of m[2].split(';')) setValue(m[1], v.trim(), `${file}:${i + 1}`);
      } else {
        checkTextToken(file, i + 1, t, 'Suchbegriff');
        hasTerm = true;
      }
    }
  }

  // --- Szenarien / Tags -----------------------------------------------------------
  function parseRules(file, idxs, code, kind, cat) {
    const prefix = kind === 'scenario' ? '@' : '~';
    let current = null; // { line, conditions, closed }
    const finish = () => {
      if (current && current.conditions === 0) add('FEHLER', file, current.line, `${kind === 'scenario' ? 'Szenario' : 'Tag'} „${current.code}“ ohne Bedingung (Bedingungen müssen direkt in den Folgezeilen stehen – keine Leer- oder Kommentarzeile dazwischen)`);
      current = null;
    };
    for (const i of idxs) {
      const t = code[i].trim();
      if (!t) {
        if (current) current.closed = true;
        continue;
      }
      if (t.startsWith(prefix)) {
        finish();
        const codeStr = t;
        current = { line: i + 1, code: codeStr, conditions: 0, closed: false };
        cat.ruleCount++;
        const m = codeStr.match(new RegExp(`^${prefix === '@' ? '@' : '~'}([${IDENT_BODY}]+)(-?\\{(#[${IDENT_BODY}]+)\\})?$`));
        if (!m) { add('FEHLER', file, i + 1, `Ungültiger ${kind === 'scenario' ? 'Szenario' : 'Tag'}-Code „${codeStr}“`); continue; }
        if (m[3]) usages.push({ id: m[3], op: null, values: [], file, line: i + 1, kind: 'audis' });
        if (kind === 'scenario') {
          const id = codeStr.slice(1);
          if (!scenarioIds.has(id)) add('FEHLER', file, i + 1, `Szenario „${id}“ ist nicht in constants.json definiert (AUDIS lädt die Konfiguration dann nicht)${sugg(id, scenarioIds)}`);
        }
        continue;
      }
      if (!current) { add('FEHLER', file, i + 1, `Bedingung ohne vorangehenden ${kind === 'scenario' ? 'Szenario' : 'Tag'}-Code`); continue; }
      if (current.closed) { add('FEHLER', file, i + 1, `Bedingung nach Leer- oder Kommentarzeile – gehört nicht mehr zu „${current.code}“`); continue; }
      checkQuoted(file, i + 1, t);
      parseConditionExpr(file, i + 1, t, { allowBare: false });
      current.conditions++;
    }
    finish();
  }

  // --- Zusammenfassung ------------------------------------------------------------
  function parseSummary(file, idxs, code, cat) {
    let current = null;
    const finish = () => {
      if (current && current.conditions === 0) add('FEHLER', file, current.line, `Zusammenfassungstext „${current.text}“ ohne Bedingung`);
      current = null;
    };
    for (const i of idxs) {
      const t = code[i].trim();
      if (!t) { if (current) current.closed = true; continue; }
      if (t.startsWith('{')) {
        if (!current) add('FEHLER', file, i + 1, 'Metadaten ohne Zusammenfassungstext');
        parseMetadata(file, i + 1, t, SUMMARY_OPTIONS, null);
        continue;
      }
      if (t.startsWith('#')) {
        if (!current) { add('FEHLER', file, i + 1, 'Bedingung ohne Zusammenfassungstext'); continue; }
        if (current.closed) { add('FEHLER', file, i + 1, 'Bedingung nach Leerzeile – gehört nicht mehr zum Zusammenfassungstext'); continue; }
        checkQuoted(file, i + 1, t);
        parseConditionExpr(file, i + 1, t, { allowBare: false });
        current.conditions++;
        continue;
      }
      finish();
      current = { line: i + 1, text: t, conditions: 0, closed: false };
      cat.ruleCount++;
      checkQuoted(file, i + 1, t);
      for (const m of t.matchAll(/\{(#[^}]+)\}/g)) usages.push({ id: m[1], op: null, values: [], file, line: i + 1, kind: 'audis' });
      const rest = t.replace(/"[^"]*"/g, ' ').replace(/\{#[^}]+\}/g, ' ');
      if (rest.trim()) checkTextToken(file, i + 1, rest.replace(/\s+/g, ' '), 'Zusammenfassungstext');
    }
    finish();
  }

  // --- Fragen -------------------------------------------------------------------
  function parseQuestions(file, catalogName, idxs, code) {
    const questionsByColumn = new Map(); // wie KnowledgeScopeListener: Spalte -> letzte Frage
    let lastQuestion = null;
    let lastKind = null; // 'question' | 'answer' | 'meta' | 'condition' | 'include' | 'operation'
    const openConditions = []; // { line, indent }

    const closeConditions = (indent, line) => {
      // Bedingungen, deren Inhalt fehlt (nächstes Element nicht tiefer eingerückt)
      while (openConditions.length && openConditions[openConditions.length - 1].indent >= indent) {
        const c = openConditions.pop();
        if (!c.hasChild) add('WARNUNG', file, c.line, 'Bedingung ohne eingerückten Inhalt (folgendes Element ist nicht tiefer eingerückt)');
      }
      if (openConditions.length) openConditions[openConditions.length - 1].hasChild = true;
    };

    for (const i of idxs) {
      const lineCode = code[i];
      const t = lineCode.trim();
      if (!t) continue;
      const indent = indentOf(lineCode);
      const lineNo = i + 1;

      if (t.startsWith('{')) {
        if (lastKind === 'question') parseMetadata(file, lineNo, t, QUESTION_OPTIONS, lastQuestion.meta);
        else if (lastKind === 'answer' || lastKind === 'meta-answer') parseMetadata(file, lineNo, t, ANSWER_OPTIONS, null);
        else if (lastKind === 'meta') add('FEHLER', file, lineNo, 'Zweite Metadaten-Zeile – alle Optionen in eine { … }-Zeile schreiben');
        else add('FEHLER', file, lineNo, 'Metadaten ohne vorangehende Frage oder Antwort');
        lastKind = lastKind === 'question' ? 'meta' : lastKind === 'answer' ? 'meta-answer' : lastKind;
        continue;
      }

      // Antwort: beginnt mit *, + oder - (eine Zeile mit ** am Anfang ist fett formatierter Fragetext)
      if (/^[+-]/.test(t) || (t.startsWith('*') && !t.startsWith('**'))) {
        if (!['question', 'meta', 'answer', 'meta-answer'].includes(lastKind) || !lastQuestion) {
          add('FEHLER', file, lineNo, 'Antwort ohne vorangehende Frage');
        } else {
          parseAnswer(file, lineNo, t, lastQuestion);
        }
        lastKind = 'answer';
        continue;
      }

      closeConditions(indent, lineNo);

      if (t.startsWith('[')) {
        checkQuoted(file, lineNo, t);
        const close = t.lastIndexOf(']');
        if (close < 0) { add('FEHLER', file, lineNo, 'Bedingung ohne schließende ]'); continue; }
        if (t.slice(close + 1).trim()) add('FEHLER', file, lineNo, `Text nach der Bedingung: „${t.slice(close + 1).trim()}“`);
        const expr = t.slice(1, close);
        // Bezugsfrage für nackte Werte wie im AUDIS-Parser bestimmen
        let scope = null;
        const smaller = [...questionsByColumn.keys()].filter((c) => c < indent);
        if (smaller.length) scope = questionsByColumn.get(Math.max(...smaller))?.id ?? null;
        else if (questionsByColumn.has(indent)) scope = questionsByColumn.get(indent)?.id ?? null;
        if (expr.split(/&&|\|\|/).some((p) => p.trim() && !p.trim().startsWith('#'))) {
          bindings.push({ file, line: lineNo, expr: expr.replace(/\s+/g, ' ').trim(), scope });
        }
        parseConditionExpr(file, lineNo, expr, { bareScope: scope, allowBare: true });
        openConditions.push({ line: lineNo, indent, hasChild: false });
        lastKind = 'condition';
        continue;
      }

      if (/^=>\s*INKLUDIERE\b/.test(t)) {
        add('FEHLER', file, lineNo, '„=> INKLUDIERE“ ist ungültig – INKLUDIERE { … } wird ohne => geschrieben');
      }
      const inc = t.match(/^(?:=>\s*)?INKLUDIERE\s*\{([^}]*)\}\s*$/);
      if (inc || /^(?:=>\s*)?INKLUDIERE\b/.test(t)) {
        if (!inc) { add('FEHLER', file, lineNo, `Ungültige INKLUDIERE-Anweisung: „${t}“`); lastKind = 'include'; continue; }
        for (const target of inc[1].split(',').map((s) => s.trim()).filter(Boolean)) {
          includes.push({ from: catalogName, target: target.replace(/\.audis$/, ''), file, line: lineNo });
        }
        lastKind = 'include';
        continue;
      }

      if (t.startsWith('=>')) {
        const op = t.slice(2).trim();
        if (op === 'ABSCHLUSS') { /* ok */ }
        else if (op.startsWith('EREIGNIS')) {
          const m = op.match(/^EREIGNIS\s+"([^"]*)"$/);
          if (!m) add('FEHLER', file, lineNo, 'EREIGNIS erwartet einen Namen in Anführungszeichen: => EREIGNIS "Name"');
          else if (!events.has(m[1])) add('FEHLER', file, lineNo, `Ereignis „${m[1]}“ ist nicht in constants.json unter Events definiert`);
        } else add('FEHLER', file, lineNo, `Unbekannte Operation „${t}“ (erlaubt: => ABSCHLUSS, => EREIGNIS "…")`);
        lastKind = 'operation';
        continue;
      }

      // Frage
      checkQuoted(file, lineNo, t);
      const q = parseQuestionHeader(file, lineNo, t, catalogName);
      q.indent = indent;
      q.meta = {};
      q.answers = [];
      q.file = file;
      q.line = lineNo;
      questionsByColumn.set(indent, q);
      lastQuestion = q;
      lastKind = 'question';
      finalizeLater.push(q);
    }
    closeConditions(-1, 0);
  }

  function parseQuestionHeader(file, line, t, catalogName) {
    const masked = maskQuotes(t);
    let head = t;
    let summary = null;
    const pipe = masked.indexOf('|');
    if (pipe >= 0) { head = t.slice(0, pipe); summary = t.slice(pipe + 1).trim(); }
    let text = head.trim();
    let id = null;
    const mh = maskQuotes(head);
    const arrow = mh.lastIndexOf('->');
    if (arrow >= 0) {
      text = head.slice(0, arrow).trim();
      const target = head.slice(arrow + 2).trim();
      const m = target.match(new RegExp(`^(#[${IDENT_BODY}]+)$`));
      if (!m) add('FEHLER', file, line, `Nach „->“ muss ein Knowledge-Identifier stehen (gefunden: „${target}“)`);
      else id = m[1];
    }
    const textUnquoted = text.replace(/"[^"]*"/g, '');
    if (textUnquoted.trim()) {
      const cleaned = textUnquoted.replace(/:\s*$/, '');
      if (cleaned.trim()) checkTextToken(file, line, cleaned.replace(/\s+/g, ' '), 'Fragetext');
    }
    if (summary && summary !== '*') checkTextToken(file, line, summary, 'Zusammenfassungs-Template');
    if (!id && text) {
      id = `#${catalogName.toLowerCase()}.${normalizeSuffix(stripQuotes(text))}`;
    }
    return { id, text, summary };
  }

  function parseAnswer(file, line, t, q) {
    checkQuoted(file, line, t);
    const body = t.slice(1).trim();
    // mq: Anführungszeichen maskiert; mqb: zusätzlich Synonymklammern maskiert
    const cut = (s, from, to) => ({ s: s.s.slice(from, to), mq: s.mq.slice(from, to), mqb: s.mqb.slice(from, to) });
    const mqAll = maskQuotes(body);
    let main = { s: body, mq: mqAll, mqb: maskBrackets(mqAll) };
    // Zusammenfassungs-Template
    const pipe = main.mqb.indexOf('|');
    if (pipe >= 0) {
      const tpl = body.slice(pipe + 1).trim();
      if (tpl !== '*' && tpl) checkTextToken(file, line, tpl, 'Zusammenfassungs-Template');
      main = cut(main, 0, pipe);
    }
    // In Segmente an ; teilen (außerhalb von Anführungszeichen und Synonymklammern)
    const segs = [];
    let start = 0;
    for (let i = 0; i <= main.mqb.length; i++) {
      if (i === main.mqb.length || main.mqb[i] === ';') { segs.push(cut(main, start, i)); start = i + 1; }
    }
    // Szenario-Implikation im letzten Segment
    const lastIdx = segs.length - 1;
    const im = segs[lastIdx].mqb.match(/->\s*@/);
    if (im) {
      const pos = segs[lastIdx].mqb.indexOf(im[0]);
      const scenarioCode = segs[lastIdx].s.slice(pos).replace(/^->\s*@/, '').trim();
      segs[lastIdx] = cut(segs[lastIdx], 0, pos);
      if (!scenarioIds.has(scenarioCode)) add('FEHLER', file, line, `Szenario „${scenarioCode}“ ist nicht in constants.json definiert${sugg(scenarioCode, scenarioIds)}`);
    }

    // Erstes Segment: Auswahl oder Eingabe
    let seg0 = segs[0];
    let explicitId = null;
    const em = seg0.mqb.match(new RegExp(`^\\s*(#[${IDENT_BODY}]+)\\s*=`));
    if (em) {
      explicitId = em[1];
      seg0 = cut(seg0, em[0].length);
    }
    const target = explicitId ?? q.id;
    const isInput = /__/.test(seg0.mqb);
    const answer = { line, isInput, target, extra: [] };
    q.answers.push(answer);

    if (isInput) {
      const inputPos = seg0.mqb.indexOf('__');
      const before = cut(seg0, 0, inputPos);
      let afterStart = inputPos;
      while (seg0.mqb[afterStart] === '_') afterStart++;
      const after = cut(seg0, afterStart);
      let label = null;
      const colon = before.mqb.lastIndexOf(':');
      if (colon >= 0) label = before.s.slice(0, colon).trim();
      else if (before.s.trim()) add('FEHLER', file, line, `Freitext-Antwort: Label muss mit „:“ vor den Unterstrichen stehen („${before.s.trim()}“)`);
      let custom = null;
      const eq = after.mqb.indexOf('=');
      if (eq >= 0) custom = after.s.slice(eq + 1).trim();
      else if (after.s.trim()) add('FEHLER', file, line, `Unerwarteter Text nach Freitextfeld: „${after.s.trim()}“`);
      if (label && !label.startsWith('"')) checkTextToken(file, line, label, 'Antwort-Label');
      if (custom) checkTextToken(file, line, custom, 'Wert');
      answer.label = label ? stripMarkup(stripQuotes(label)) : null;
      answer.custom = custom;
    } else {
      // Auswahl: Text [Synonyme] = Wert
      let sel = seg0;
      let custom = null;
      const eq = sel.mqb.indexOf('=');
      if (eq >= 0) {
        custom = sel.s.slice(eq + 1).trim();
        sel = cut(sel, 0, eq);
      }
      let text = sel.s;
      let synonyms = null;
      const br = sel.mq.indexOf('[');
      if (br >= 0) {
        const end = sel.mq.indexOf(']', br);
        synonyms = sel.s.slice(br + 1, end < 0 ? undefined : end);
        if (end < 0) add('FEHLER', file, line, 'Synonymliste ohne schließende ]');
        else if (sel.s.slice(end + 1).trim()) add('FEHLER', file, line, `Unerwarteter Text nach der Synonymliste: „${sel.s.slice(end + 1).trim()}“`);
        text = sel.s.slice(0, br);
      }
      const answerText = text.trim();
      if (!answerText) add('FEHLER', file, line, 'Antwort ohne Text');
      else if (!answerText.startsWith('"')) checkTextToken(file, line, answerText, 'Antworttext');
      if (custom !== null) {
        if (!custom) add('FEHLER', file, line, 'Leerer Wert nach „=“');
        else checkTextToken(file, line, custom, 'Wert');
      }
      if (synonyms !== null) {
        if (synonyms.includes(',')) add('WARNUNG', file, line, 'Komma in der Synonymliste – Synonyme werden nur durch „;“ getrennt; so entsteht ein einziges langes Synonym und Kontra-Wörter („!Wort“) wirken nicht');
        for (const s of synonyms.split(';').map((x) => x.trim()).filter(Boolean)) {
          if (s.startsWith('!')) checkTextToken(file, line, s.slice(1), 'Kontra-Wort');
          else checkTextToken(file, line, s, 'Synonym');
        }
      }
      answer.value = custom ?? stripMarkup(stripQuotes(answerText));
    }

    // Weitere Segmente: zusätzliches Wissen
    for (const seg of segs.slice(1)) {
      const m = seg.mqb.match(new RegExp(`^\\s*(#[${IDENT_BODY}]+)\\s*=`));
      if (!m) { add('FEHLER', file, line, `Zusätzliches Wissen muss die Form „#identifier = Wert“ haben (gefunden: „${seg.s.trim()}“)`); continue; }
      const value = seg.s.slice(m[0].length).trim();
      if (!value) { add('FEHLER', file, line, `Leerer Wert für ${m[1]}`); continue; }
      if (!value.startsWith('"')) checkTextToken(file, line, value, `Wert für ${m[1]}`);
      answer.extra.push({ id: m[1], value: stripMarkup(stripQuotes(value)) });
    }
  }

  // --- Wissen aus Fragen ableiten ---------------------------------------------------------
  for (const q of finalizeLater) {
    const src = `${q.file}:${q.line}`;
    const vis = q.meta.visualization;
    if (!q.id) continue;
    const k = ensure(q.id);
    k.sources.push(src);
    if (q.meta.multiselect) k.multi = true;
    // apisearch und counter liefern nur die Antworten des Katalogs – die Wertemenge bleibt geschlossen
    const answerBasedVis = vis === 'apisearch' || vis === 'counter';
    if (vis === 'counter') for (const a of q.answers) if (!a.isInput) setOpen(`${q.id}.${normalizeSuffix(a.value ?? '')}`, src);
    if (vis && typeof vis === 'string' && !answerBasedVis) {
      setOpen(q.id, src);
      for (const suf of VIS_DERIVED_OPEN[vis] ?? []) setOpen(q.id + suf, src);
      if (vis === 'age' && !ageGroupId) for (const g of AGE_GROUPS) setValue(`${q.id}.agegroup`, g, src);
      if (BODY_VIS.has(vis)) for (const g of BODY_GROUPS) setValue(`${q.id}.grouped`, g, src);
    } else if (q.answers.length === 0) {
      for (const v of defaultAnswerValues) setValue(q.id, v, src);
    }
    if (q.meta.autocomplete && q.meta.allowFreetext) { setOpen(q.id, src); setOpen(`${q.id}.text`, src); }
    if (showUnknown && !q.meta.hideUnknownAnswer && !(vis && ['info', 'warning', 'danger', 'instruction', 'media'].includes(vis))) {
      setValue(q.id, unknownValue, src);
    }
    for (const a of q.answers) {
      const asrc = `${q.file}:${a.line}`;
      if (a.isInput) {
        if (a.custom) {
          setValue(a.target, a.custom, asrc);
          setOpen(`${a.target}.${a.label ? normalizeSuffix(a.label) : 'text'}`, asrc);
        } else if (a.label) {
          setValue(a.target, a.label, asrc);
          setOpen(`${a.target}.${normalizeSuffix(a.label)}`, asrc);
        } else {
          setOpen(a.target, asrc);
        }
      } else {
        setValue(a.target, a.value, asrc);
      }
      if (q.meta.multiselect) ensure(a.target).multi = true;
      for (const e of a.extra) {
        setValue(e.id, e.value, asrc);
        if (a.isInput && a.custom) setOpen(`${e.id}.text`, asrc);
      }
    }
  }

  // --- Flee-Bedingungen (Enricher, InjectionButtons) auswerten ---------------------------
  for (const fc of fleeConditions) {
    const c = fc.condition;
    let depth = 0;
    let balanced = true;
    for (const ch of c.replace(/"[^"]*"/g, '')) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (depth < 0) balanced = false;
    }
    if (depth !== 0 || !balanced) add('FEHLER', fc.file, fc.line, `Klammern in der Bedingung von „${fc.name}“ nicht ausgeglichen`);
    if ((c.match(/"/g) ?? []).length % 2) add('FEHLER', fc.file, fc.line, `Ungerade Anzahl Anführungszeichen in der Bedingung von „${fc.name}“`);
    for (const m of c.replace(/"[^"]*"/g, '""').matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
      if (['AND', 'OR', 'NOT', 'XOR', 'and', 'or', 'not', 'xor'].includes(m[1])) continue;
      if (!FLEE_FUNCTIONS.has(m[1])) add('WARNUNG', fc.file, fc.line, `Unbekannte Funktion „${m[1]}“ in der Bedingung von „${fc.name}“`);
    }
    for (const m of c.matchAll(/\{(#[^}]+)\}/g)) usages.push({ id: m[1], op: null, values: [], file: fc.file, line: fc.line, kind: 'flee' });
    for (const m of c.matchAll(/\{(#[^}]+)\}\s*(=|<>)\s*"([^"]*)"/g)) {
      usages.push({ id: m[1], op: m[2] === '=' ? '=' : '!=', values: [m[3]], file: fc.file, line: fc.line, kind: 'flee', fleeEquals: true });
    }
    for (const m of c.matchAll(/containsAll\s*\(\s*\{(#[^}]+)\}\s*,([^)]*)\)|contains\s*\(\s*\{(#[^}]+)\}\s*,([^)]*)\)/g)) {
      const id = m[1] ?? m[3];
      const vals = [...(m[2] ?? m[4]).matchAll(/"([^"]*)"/g)].map((x) => x[1]);
      usages.push({ id, op: '=', values: vals, file: fc.file, line: fc.line, kind: 'flee' });
    }
  }

  // --- Includes prüfen -------------------------------------------------------------------------
  const catalogNamesLower = new Map([...catalogs.keys()].map((n) => [n.toLowerCase(), n]));
  for (const inc of includes) {
    if (catalogs.has(inc.target)) continue;
    const ci = catalogNamesLower.get(inc.target.toLowerCase());
    if (ci) add('WARNUNG', inc.file, inc.line, `INKLUDIERE { ${inc.target} }: Schreibweise weicht vom Dateinamen ab („${ci}“)`);
    else add('FEHLER', inc.file, inc.line, `INKLUDIERE { ${inc.target} }: Katalog nicht gefunden${sugg(inc.target, catalogs.keys())}`);
  }

  // --- Verwendungen gegen gesetztes Wissen prüfen ------------------------------------------------
  const knownIds = [...knowledge.keys()];
  const knownLower = new Map(knownIds.map((id) => [id.toLowerCase(), id]));
  const reportedMissing = new Set();
  for (const u of usages) {
    if (!u.id) continue;
    const k = knowledge.get(u.id);
    if (!k) {
      if (isExternalPrefix(u.id) || placeholders.has(u.id)) continue;
      const key = `${u.file}|${u.line}|${u.id}`;
      if (reportedMissing.has(key)) continue;
      reportedMissing.add(key);
      const ci = knownLower.get(u.id.toLowerCase());
      if (ci) add('WARNUNG', u.file, u.line, `${u.id}: Schreibweise weicht ab – gesetzt wird ${ci}`);
      else add('WARNUNG', u.file, u.line, `${u.id} wird nirgends gesetzt (weder im Katalog noch in config/, noch als bekanntes Systemwissen)${sugg(u.id, knownIds)}`);
      continue;
    }
    if (u.fleeEquals && k.multi) {
      add('WARNUNG', u.file, u.line, `${u.id} kann mehrere Werte haben (Mehrfachauswahl) – im Enricher contains(…) statt = verwenden`);
    }
    if (k.open || !u.op || u.op === '=>' || !u.values.length) continue;
    const values = [...k.values.values()];
    for (const v of u.values) {
      if (u.kind === 'flee') {
        if (values.includes(v)) continue;
        const ci = values.find((x) => x.toLowerCase() === v.toLowerCase());
        if (ci) add('WARNUNG', u.file, u.line, `${u.id}: Enricher vergleichen exakt – „${v}“ passt nicht zu gesetztem Wert „${ci}“ (Groß-/Kleinschreibung)`);
        else add('WARNUNG', u.file, u.line, `${u.id}: Wert „${v}“ wird nirgends gesetzt${valueHint(v, values)}`);
      } else {
        if (k.values.has(v.toLowerCase())) continue;
        const bareNote = u.bare
          ? ` (Bedingung ohne Identifier: AUDIS bindet sie an die letzte Frage mit kleinerer Einrückung, hier ${u.id} – steht sie auf gleicher Einrückung wie die gemeinte Frage, tiefer einrücken oder Identifier ausschreiben)`
          : '';
        add('WARNUNG', u.file, u.line, `${u.id}: Wert „${v}“ wird nirgends gesetzt${bareNote}${valueHint(v, values)}`);
      }
    }
  }

  return { findings, catalogs, includes, knowledge, bindings };
}

function sugg(word, candidates) {
  const s = suggest(word, [...candidates]);
  return s.length ? ` – meintest du ${s.map((x) => `„${x}“`).join(' / ')}?` : '';
}

function valueHint(v, values) {
  const s = suggest(v, values);
  if (s.length) return ` – ähnlich: ${s.map((x) => `„${x}“`).join(' / ')}`;
  const list = values.slice(0, 8).map((x) => `„${x}“`).join(', ');
  return values.length ? ` – gesetzt werden: ${list}${values.length > 8 ? ', …' : ''}` : '';
}

// ---------------------------------------------------------------------------
// Ausgabe
// ---------------------------------------------------------------------------

function findingKey(f) {
  // Vorschlagslisten („– gesetzt werden: …“, „– ähnlich: …“) ändern sich, sobald irgendwo ein Wert dazukommt;
  // für den Vergleich vorher/nachher zählt nur der Befund selbst.
  const message = f.message.replace(/ – (gesetzt werden|ähnlich): .*$/, '');
  return `${f.severity}|${f.file}|${message}`;
}

function sortFindings(list) {
  return list.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.file.localeCompare(b.file) || a.line - b.line);
}

function formatFinding(f) {
  const loc = f.line ? `${f.file}:${f.line}` : f.file;
  return `  ${f.severity.padEnd(7)}  ${loc}  ${f.message}`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(path.join(opts.repo, 'questioncatalog'))) {
    console.error(`Kein Ordner questioncatalog in ${opts.repo} – bitte im audis-srz-Repo ausführen oder --repo angeben.`);
    process.exit(2);
  }

  let current;
  let currentSource;
  try {
    currentSource = opts.stand ? gitRefSource(opts.repo, opts.stand) : workingTreeSource(opts.repo);
    current = analyze(currentSource);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const subject = opts.stand ? `Stand ${opts.stand}` : 'Arbeitsverzeichnis';
  let report = current.findings;
  const lines = [];
  lines.push(`AUDIS-Katalogprüfung – ${opts.repo} (${subject})`);

  let base = null;
  let baseSource = null;
  if (opts.base) {
    try {
      baseSource = gitRefSource(opts.repo, opts.base);
      base = analyze(baseSource);
    } catch (e) {
      if (!opts.defaultBase) {
        console.error(e.message);
        process.exit(2);
      }
      // Kein Git-Stand verfügbar (z. B. kein Repository): alle Befunde ausgeben
      lines.push('Kein Vergleich mit HEAD möglich (kein Git-Repository oder noch kein Commit) – es werden alle Befunde ausgegeben.');
      opts.base = null;
    }
  }

  if (base) {
    lines.push(`Vergleich: ${subject} gegenüber ${opts.base} (nur neue Befunde)`);

    // Branch-Hinweis (nur bei Prüfung des Arbeitsverzeichnisses)
    if (!opts.stand) {
      try {
        const branch = git(opts.repo, ['rev-parse', '--abbrev-ref', 'HEAD']).toString().trim();
        // Arbeitsbranch auf Basis von softaware (auf Wunsch des Nutzers) ist in Ordnung
        const containsSoftaware = ['softaware', 'origin/softaware'].some((ref) => {
          try { git(opts.repo, ['merge-base', '--is-ancestor', ref, 'HEAD']); return true; } catch { return false; }
        });
        if (branch === 'HEAD') lines.push('Achtung: kein Branch ausgecheckt (losgelöster HEAD) – Snap-Fixes gehören auf „softaware“.');
        else if (branch !== 'softaware' && containsSoftaware) lines.push(`Arbeitsbranch „${branch}“ (enthält softaware).`);
        else if (branch !== 'softaware') lines.push(`Achtung: aktueller Branch ist „${branch}“ – Snap-Fixes gehören auf „softaware“.`);
      } catch { /* ohne git-Branch weiter */ }
    }

    // Geänderte Dateien
    let changed = [];
    try {
      if (opts.stand) {
        changed = git(opts.repo, ['diff', '--name-only', '-z', opts.base, opts.stand, '--', ...RELEVANT_TOP]).toString('utf8').split('\0').filter(Boolean).sort();
      } else {
        const diff = git(opts.repo, ['diff', '--name-only', '-z', opts.base, '--', ...RELEVANT_TOP]).toString('utf8').split('\0').filter(Boolean);
        const untracked = git(opts.repo, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...RELEVANT_TOP]).toString('utf8').split('\0').filter(Boolean);
        changed = [...new Set([...diff, ...untracked])].sort();
      }
    } catch (e) {
      lines.push(`(Geänderte Dateien konnten nicht ermittelt werden: ${e.message})`);
    }
    lines.push('');
    lines.push(changed.length ? 'Geänderte Dateien:' : 'Keine geänderten Katalog- oder Konfigurationsdateien.');
    for (const f of changed) lines.push(`  ${f}`);

    // Wo werden geänderte Kataloge inkludiert?
    const changedCatalogs = changed.filter((f) => f.startsWith('questioncatalog/') && f.endsWith('.audis'))
      .map((f) => f.slice('questioncatalog/'.length).replace(/\.audis$/, ''));
    const usageLines = [];
    for (const name of changedCatalogs) {
      const users = [...new Set(current.includes.filter((i) => i.target === name).map((i) => i.from))].sort();
      if (users.length) usageLines.push(`  ${name} wird inkludiert in (${users.length}): ${users.join(', ')}`);
    }
    if (usageLines.length) {
      lines.push('');
      lines.push('Achtung – geänderte Kataloge werden an anderer Stelle inkludiert (Auswirkungen dort mitprüfen):');
      lines.push(...usageLines);
    }

    // Unveränderte Bedingungen ohne Identifier, deren Bezugsfrage sich durch die Änderung verschoben hat (z. B. weil
    // eine Frage in ein Template ausgelagert wurde: Fragen aus INKLUDIERE zählen für die Bindung nicht)
    for (const file of changed.filter((f) => f.endsWith('.audis'))) {
      const cur = current.bindings.filter((b) => b.file === file);
      const old = new Map(base.bindings.filter((b) => b.file === file).map((b) => [b.line, b]));
      if (!cur.length || !old.size) continue;
      const lineMap = unchangedLines(baseSource.read(file), currentSource.read(file));
      for (const b of cur) {
        const o = old.get(lineMap.get(b.line));
        if (!o || o.expr !== b.expr || (o.scope ?? null) === (b.scope ?? null)) continue;
        current.findings.push({
          severity: 'WARNUNG', file: b.file, line: b.line,
          message: `Bedingung „[ ${b.expr} ]“ ohne Identifier bezieht sich jetzt auf ${b.scope ?? 'keine Frage'} statt auf ${o.scope ?? 'keine Frage'} – AUDIS bindet sie an die letzte Frage mit kleinerer Einrückung derselben Datei (Fragen aus INKLUDIERE zählen nicht); Absicht prüfen oder Identifier ausschreiben`,
        });
      }
    }

    // Geänderte Dateien, die wieder einem älteren Stand entsprechen
    try {
      const history = fileHistory(opts.repo, opts.stand ?? 'HEAD');
      const revertLines = [];
      for (const f of changed) {
        const r = findRevert(history.get(f), blobOf(opts.repo, f, opts.stand));
        if (r) revertLines.push(...formatRevert(f, r));
      }
      if (revertLines.length) {
        lines.push('');
        lines.push('Achtung – geänderte Dateien entsprechen wieder einem älteren Stand (Absicht prüfen, z. B. bei Kunden-Release-Kandidaten):');
        lines.push(...revertLines);
      }
    } catch (e) {
      lines.push(`(Rückfall-Prüfung nicht möglich: ${e.message})`);
    }

    // Versionsstring (pflegt der Kunde) – nur bei eigenen Änderungen im Arbeitsverzeichnis prüfen
    const versionFile = 'questioncatalog/9-Konfiguration.audis';
    if (!opts.stand && changed.includes(versionFile)) {
      try {
        const oldText = git(opts.repo, ['show', `${opts.base}:${versionFile}`]).toString('utf8');
        const newText = fs.readFileSync(path.join(opts.repo, versionFile), 'utf8');
        const vOld = (oldText.match(/Aktuelle Version:.*$/m) ?? [''])[0].trim();
        const vNew = (newText.match(/Aktuelle Version:.*$/m) ?? [''])[0].trim();
        if (vOld !== vNew) {
          current.findings.push({ severity: 'FEHLER', file: versionFile, line: lineOfText(newText, 'Aktuelle Version'), message: 'Zeile „Aktuelle Version“ geändert – der Versionsstring wird ausschließlich vom Kunden gepflegt' });
        }
      } catch { /* Datei im Basisstand nicht vorhanden */ }
    }

    // Nur neue Befunde (Multimengen-Differenz über Schweregrad, Datei und Meldung)
    const baseCount = new Map();
    for (const f of base.findings) baseCount.set(findingKey(f), (baseCount.get(findingKey(f)) ?? 0) + 1);
    report = [];
    for (const f of current.findings) {
      const k = findingKey(f);
      const n = baseCount.get(k) ?? 0;
      if (n > 0) baseCount.set(k, n - 1);
      else report.push(f);
    }
  }

  if (opts.rueckfaelle) {
    try {
      const ref = opts.stand ?? 'HEAD';
      const history = fileHistory(opts.repo, ref);
      const revertLines = [];
      for (const f of [...history.keys()].sort()) {
        const r = findRevert(history.get(f), blobOf(opts.repo, f, ref));
        if (r) revertLines.push(...formatRevert(f, r));
      }
      lines.push('');
      lines.push(revertLines.length
        ? `Rückfälle in ${ref} – Dateien entsprechen wieder einem älteren Stand, spätere Commits sind damit rückgängig:`
        : `Rückfälle in ${ref}: keine.`);
      lines.push(...revertLines);
    } catch (e) {
      lines.push(`(Rückfall-Prüfung nicht möglich: ${e.message})`);
    }
  }

  sortFindings(report);
  const visible = report.filter((f) => opts.hinweise || f.severity !== 'HINWEIS');
  const hidden = report.length - visible.length;
  lines.push('');
  lines.push(opts.base ? (visible.length ? 'Neue Befunde:' : 'Keine neuen Befunde.') : (visible.length ? 'Befunde:' : 'Keine Befunde.'));
  for (const f of visible) lines.push(formatFinding(f));
  const count = (s) => report.filter((f) => f.severity === s).length;
  lines.push('');
  lines.push(`Zusammenfassung: ${count('FEHLER')} Fehler, ${count('WARNUNG')} Warnungen, ${count('HINWEIS')} Hinweise${hidden ? ` (${hidden} Hinweise ausgeblendet – --hinweise zeigt sie an)` : ''}`);
  lines.push('Hinweis: Das Skript ersetzt nicht die Prüfung mit dem AUDIS-Parser (VS-Code-Erweiterung) und den Test in der AUDIS-Vorschau.');
  console.log(lines.join('\n'));
  // Im Vergleich gilt jede neue Warnung als Befund; bei --alle nur Fehler
  const failed = count('FEHLER') > 0 || (opts.base && count('WARNUNG') > 0);
  process.exit(failed ? 1 : 0);
}

main();
