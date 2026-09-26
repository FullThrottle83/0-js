#!/usr/bin/env node
/**
 * check.test.mjs — beständiga regressionstester för kontrollskripten.
 *
 * Varje testfall injicerar en specifik defekt i index.html och kräver att
 * rätt kontrollskript rapporterar den. Om en förväntad defekt INTE fångas
 * avslutar skriptet med kod 1 — ett tyst förbi-släpp är själva felet.
 *
 * Testen kör kontrollerna i minnet (inga temporärfiler, ingen webbläsare)
 * och är därmed snabba nog att köras vid varje commit.
 *
 * Kör: node scripts/check.test.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkDocument } from './check.mjs';
import { checkSnippets } from './check-snippets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const original = readFileSync(join(root, 'index.html'), 'utf8');

let failures = 0;

/** Kör ett negativtest: mutationen ska upptäckas av angiven kontroll. */
function expectCaught(name, mutate, checker, pattern) {
  const mutated = mutate(original);
  if (mutated === original) {
    console.error(`✗ ${name}: mutationen matchade ingenting i dokumentet (testet är trasigt)`);
    failures++;
    return;
  }
  const { errors } = checker(mutated);
  const caught = errors.some((e) => pattern.test(e));
  if (caught) {
    console.log(`✓ ${name}`);
  } else {
    console.error(`✗ ${name}: defekten fångades inte (förväntade /${pattern.source}/)`);
    failures++;
  }
}

/** Kontroller som inte får ge falsklarm: odokumentet ska vara grönt. */
{
  const doc = checkDocument(original);
  const sni = checkSnippets(original);
  if (doc.errors.length === 0 && sni.errors.length === 0) {
    console.log('✓ positivt kontrollfall: odokumentet passerar båda kontrollerna');
  } else {
    console.error('✗ positivt kontrollfall: odokumentet ska vara grönt men gav fel:');
    for (const e of [...doc.errors, ...sni.errors].slice(0, 5)) console.error('   ', e);
    failures++;
  }
}

/* ------------------------------------------------------------------ */
/* Struktur- och zero-JS-defekter (check.mjs)                         */
/* ------------------------------------------------------------------ */
expectCaught(
  'runtime-skript upptäcks',
  (h) => h.replace('<div class="matare"', '<script>spårning()</script><div class="matare"', 1),
  checkDocument,
  /<script>/,
);

expectCaught(
  'inline event handler upptäcks',
  (h) => h.replace('<a class="meny-oppna-knapp"', '<a onclick="meny()" class="meny-oppna-knapp"', 1),
  checkDocument,
  /inline event handlers/,
);

expectCaught(
  'javascript:-URL upptäcks',
  (h) => h.replace('<a class="marke" href="#topp">', '<a class="marke" href="javascript:void(0)">', 1),
  checkDocument,
  /javascript:/,
);

expectCaught(
  'trasig intern ankarlänk upptäcks',
  (h) => h.replace('<a href="#farg">Färg</a>', '<a href="#finns-inte">Färg</a>', 1),
  checkDocument,
  /interna länkar utan mål/,
);

expectCaught(
  'dubblerat id upptäcks',
  (h) => h.replace('<div class="skal">', '<div class="skal" id="kompakt">', 1),
  checkDocument,
  /dubblerade id:n/,
);

expectCaught(
  'kontroll gömd med hidden upptäcks',
  (h) => h.replace('<input type="checkbox" id="kompakt">', '<input type="checkbox" id="kompakt" hidden>', 1),
  checkDocument,
  /hidden-attributet/,
);

expectCaught(
  'role=slider utan aria-valuenow upptäcks',
  (h) => h.replace(
    'tabindex="0" role="group" aria-label="Scrollbar färgblandare',
    'tabindex="0" role="slider" aria-valuemin="0" aria-valuemax="100" aria-label="Blandare',
    1,
  ),
  checkDocument,
  /aria-valuenow/,
);

expectCaught(
  'role=button på span utan tabindex upptäcks',
  (h) => h.replace('<span class="spoiler" tabindex="0"', '<span class="spoiler" role="button"', 1),
  checkDocument,
  /rollen kräver|role="button"/i,
);

expectCaught(
  'felaktigt utlovat demo-antal upptäcks',
  (h) => h.replace('<b>133</b> tekniker', '<b>90</b> tekniker', 1),
  checkDocument,
  /demos/,
);

expectCaught(
  'demo-kort utan kodvalv upptäcks',
  (h) => h.replace(/(<article class="demo[^"]*" id="rgb-from">[\s\S]*?)<details class="kod-valv">/, '$1<!-- valv borttaget --><details class="x">', 1),
  checkDocument,
  /kodvalv/,
);

expectCaught(
  'obalanserad taggnästning i dokumentet upptäcks',
  (h) => h.replace('</footer>\n</section>', '</section>', 1),
  checkDocument,
  /taggar/,
);

/* ------------------------------------------------------------------ */
/* Kodexempel-defekter (check-snippets.mjs)                           */
/* ------------------------------------------------------------------ */
expectCaught(
  'odeklarerad CSS-variabel i snippet upptäcks',
  // replaceAll: deklarationen måste bort både ur root-CSS och ur Grundpaketet
  (h) => h.replaceAll('--line: #2b2833;\n  --acc', '--acc'),
  checkSnippets,
  /--line/,
);

expectCaught(
  'obalanserade CSS-klammerblock i snippet upptäcks',
  // </textarea>-suffixet gör att mutationen träffar kodvalvet, inte live-CSS:en.
  // Strängen är kodvalvet för textspoiler, som sedan Grupp C-piloten är
  // ordagrant samma CSS som stilbladet (därav mellanslagen i klammerparen).
  (h) => h.replace(
    '.spoiler:hover span, .spoiler:focus-visible span { filter: blur(0); }</textarea>',
    '.spoiler:hover span, .spoiler:focus-visible span filter: blur(0); }</textarea>',
    1,
  ),
  checkSnippets,
  /klammerblock/,
);

expectCaught(
  'felaktig HTML-nästning i snippet upptäcks',
  (h) => h.replace('&lt;p class="demo-yta shimmer-text"&gt;Nästa generation&lt;/p&gt;', '&lt;p class="demo-yta shimmer-text"&gt;&lt;em&gt;Nästa generation&lt;/p&gt;&lt;/em&gt;', 1),
  checkSnippets,
  /nästning/,
);

expectCaught(
  'deklaration i CSS-kommentar räknas inte som körbar',
  (h) => h.replaceAll('--line: #2b2833;\n  --acc', '--acc').replace(
    '/* Grundpaket — klistra in först */',
    '/* Grundpaket — klistra in först. --line: #2b2833; är bara en kommentar. */',
    1,
  ),
  checkSnippets,
  /--line/,
);

/* ------------------------------------------------------------------ */
console.log('');
if (failures) {
  console.error(`${failures} regressionstest misslyckades.`);
  process.exit(1);
}
console.log('Alla regressionstest gröna.');
