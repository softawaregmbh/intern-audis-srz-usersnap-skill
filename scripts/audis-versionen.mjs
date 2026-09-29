#!/usr/bin/env node
// Zeigt die verfügbaren AUDIS-Server und lädt AUDIS-Versionen wie die AUDIS-VS-Code-Erweiterung
// ("AUDIS: Download", mit Lizenzschlüssel) in den Versions-Cache der Skripte.

import {
    UsageError,
    cachedVersions,
    detectBuildVersion,
    downloadVersion,
    environmentVersion,
    extensionServers,
    findLicenseKey,
    releaseTags,
    runMain,
    versionsRoot
} from './lib/audis.mjs';

const USAGE = `Aufruf: node audis-versionen.mjs [laden <version> … | umgebung <url> | tags]

Ohne Argumente: zeigt die AUDIS-Server, die simulate.mjs und ui-test.mjs verwenden können,
und woher der Lizenzschlüssel kommt (ohne ihn anzuzeigen).

  laden <version> …   lädt Versionen wie die AUDIS-Erweiterung in den Cache,
                      z. B. "laden 2.3.0.3 2.4.0" oder "laden latest". Statt einer Version geht auch die
                      Adresse einer AUDIS-Umgebung (Snap-URL). Liefert der Download-Dienst eine andere
                      Version als angefragt, wird der Download verworfen.
  umgebung <url>      zeigt die AUDIS-Version einer Umgebung, z. B. "umgebung https://demo.audis.at/srz/release"
  tags                listet die Release-Tags des AUDIS-Repositorys (über die GitHub CLI "gh");
                      nicht jede Version ist beim Download-Dienst verfügbar (dann HTTP 404)`;

async function main() {
    const args = process.argv.slice(2);
    if (args[0] === '-h' || args[0] === '--help') {
        console.log(USAGE);
        return 0;
    }
    if (args[0] === 'laden') {
        if (args.length < 2) throw new UsageError('laden erwartet mindestens eine Version.');
        for (const arg of args.slice(1)) {
            const version = /^https?:\/\//i.test(arg) ? await environmentVersion(arg) : arg;
            console.log(`AUDIS ${version}: ${await downloadVersion(version)}`);
        }
        return 0;
    }
    if (args[0] === 'umgebung') {
        if (args.length !== 2) throw new UsageError('umgebung erwartet genau eine Adresse.');
        await environmentVersion(args[1]);
        return 0;
    }
    if (args[0] === 'tags') {
        const tags = releaseTags();
        console.log(tags.length ? tags.join('\n') : '(keine Tags gefunden)');
        return 0;
    }
    if (args.length) throw new UsageError(`Unbekanntes Argument ${args[0]}.`);

    console.log(`Versions-Cache: ${versionsRoot()}`);
    const cached = cachedVersions();
    for (const v of cached) console.log(`  AUDIS ${v.version}${v.build && v.build !== v.version ? ` (Build meldet ${v.build}!)` : ''}: ${v.exe}`);
    if (!cached.length) console.log('  (leer)');
    console.log('AUDIS-Erweiterung:');
    const ext = extensionServers();
    for (const e of ext) console.log(`  ${e.name} (AUDIS ${detectBuildVersion(e.exe) ?? '?'}): ${e.exe}`);
    if (!ext.length) console.log('  (kein heruntergeladener Server gefunden)');
    if (process.env.AUDIS_WEB) console.log(`AUDIS_WEB: ${process.env.AUDIS_WEB}`);
    const key = findLicenseKey();
    console.log(`Lizenzschlüssel: ${key ? `vorhanden (${key.source})` : 'nicht gefunden – "audis.licenseKey" in den VS-Code-Einstellungen oder AUDIS_LICENSE_KEY'}`);
    return 0;
}

runMain(main, USAGE);
