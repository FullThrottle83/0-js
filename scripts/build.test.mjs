#!/usr/bin/env node
/**
 * build.test.mjs — regressionstest för källgenereringen (scripts/build.mjs).
 *
 * Kör helt i minnet mot det committade index.html och demos/*.html:
 *   - bygget är deterministiskt och idempotent
 *   - de migrerade demonas id:n och ankare finns kvar
 *   - live-markup och kodvalv härleds bevisligen ur källfilen
 *   - de delade :root-variablerna (Grundpaketet) täcker källornas var()
 *   - de genererade kodvalven klarar check-snippets.mjs
 *   - alla 133 demos finns kvar och check.mjs är grön
 *   - dokumentet innehåller ingen runtime-JavaScript
 *   - en föråldrad (stale) artefakt upptäcks — oavsett om källan eller
 *     index.html ändrats
 *   - felaktiga källor och saknade markörer ger tydliga fel, inte tyst utdata
 *
 * Kör: node scripts/build.test.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  build, loadSources, parseSource, renderLive, renderSnippet, staleDemos,
  applyDemo, BuildError, DEMO_DIR, INDEX, MAX_ROWS,
} from './build.mjs';
import { checkDocument } from './check.mjs';
import { checkSnippets, extractSnippets, splitParts, declaredVars, usedVars } from './check-snippets.mjs';

let failures = 0;
const ok = (m) => console.log(`✓ ${m}`);
const fail = (m) => { console.error(`✗ ${m}`); failures++; };
const assert = (c, m) => (c ? ok(m) : fail(m));
const throwsBuildError = (fn, m) => {
  try { fn(); fail(`${m} (inget fel kastades)`); } catch (e) { assert(e instanceof BuildError, `${m}: ${e.message}`); }
};

const html = readFileSync(INDEX, 'utf8');
const sources = loadSources();
const MIGRATED = ['property-border-angle', 'shape-outside', 'target'];
const EXPECTED_DEMOS = 133;

/* Piloten omfattar exakt tre demos ------------------------------------- */
assert(
  JSON.stringify([...sources.keys()]) === JSON.stringify(MIGRATED),
  `piloten omfattar exakt ${MIGRATED.join(', ')}`,
);

/* 1. Determinism ------------------------------------------------------- */
{
  const a = build(html, sources);
  const b = build(html, sources);
  assert(a === b, 'två byggen ur samma källor ger identisk utdata');
  assert(build(a, sources) === a, 'bygget är idempotent (bygg av byggt = oförändrat)');
  assert(a === html, 'committat index.html är i fas med demos/ (inte stale)');
  // Källordningen får inte påverka resultatet.
  const reversed = new Map([...sources].reverse());
  assert(build(html, reversed) === a, 'källornas ordning påverkar inte utdata');
}

/* 2. Id:n och ankare ---------------------------------------------------- */
{
  const built = build(html, sources);
  const ids = new Set([...built.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const id of MIGRATED) assert(ids.has(id), `kortet #${id} finns kvar`);
  for (const id of ['tp-1', 'tp-2', 'tp-3']) assert(ids.has(id), `ankarmålet #${id} finns kvar`);
  for (const id of ['tp-1', 'tp-2', 'tp-3']) {
    assert(built.includes(`<a href="#${id}">`), `länken till #${id} finns kvar`);
  }
  for (const id of MIGRATED) {
    assert(built.includes(`<a href="#${id}">`), `indexlänken till #${id} finns kvar`);
    assert(new RegExp(`<article class="demo[^"]*" id="${id}">`).test(built), `#${id} är fortfarande ett demo-kort`);
  }
  // Kodvalvens escapade text räknas inte som markup.
  const dom = built.replace(/<textarea\b[\s\S]*?<\/textarea>/g, '');
  const count = (s, re) => (s.match(re) || []).length;
  for (const id of [...MIGRATED, 'tp-1', 'tp-2', 'tp-3']) {
    assert(count(dom, new RegExp(`\\bid="${id}"`, 'g')) === 1, `id="${id}" förekommer exakt en gång i markupen`);
  }
}

/* 3. Härledning ur källan ---------------------------------------------- */
{
  const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  for (const id of MIGRATED) {
    const src = sources.get(id);
    const open = `<!-- demo:${id}:markup -->`;
    const a = html.indexOf(open) + open.length;
    const b = html.indexOf(`<!-- /demo:${id}:markup -->`);
    const live = html.slice(a, b);
    assert(live.includes(renderLive(src.markup, '      ')), `#${id}: live-markup är källans markup (indragen)`);
    assert(live.replace(/\s+/g, ' ').trim() === src.markup.replace(/\s+/g, ' ').trim(),
      `#${id}: live-markup innehåller inget utöver källan`);

    const art = html.slice(html.search(new RegExp(`<article class="demo[^"]*" id="${id}">`)));
    const ta = art.slice(0, art.indexOf('</article>')).match(/<textarea class="kod"([^>]*)>([\s\S]*?)<\/textarea>/);
    assert(decode(ta[2]) === renderSnippet(src), `#${id}: kodvalvet är exakt renderSnippet(källa)`);
    assert(decode(ta[2]).includes(src.markup), `#${id}: kodvalvets HTML-del är källans markup, oindragen`);
    assert(decode(ta[2]).includes(src.css), `#${id}: kodvalvets CSS-del är källans <style>`);
    if (src.liveCss) {
      assert(!decode(ta[2]).includes(src.liveCss), `#${id}: <style data-live> kopieras INTE till kodvalvet`);
      assert(html.includes(src.liveCss), `#${id}: <style data-live> finns i sidans stilblad`);
    }
    const rows = Number(ta[1].match(/rows="(\d+)"/)[1]);
    assert(rows === Math.min(renderSnippet(src).split('\n').length, MAX_ROWS), `#${id}: rows följer radantalet (max ${MAX_ROWS})`);

    const cssOpen = `/* demo:${id}:css */`;
    const c = html.indexOf(cssOpen) + cssOpen.length;
    const d = html.indexOf(`/* /demo:${id}:css */`);
    assert(html.slice(c, d).includes(src.css), `#${id}: stilbladet innehåller källans CSS ordagrant`);
    assert(d < html.indexOf('<body'), `#${id}: CSS-markören ligger i <head>-stilbladet, inte i kroppen`);
  }
}

/* 4. Delade variabler --------------------------------------------------- */
{
  const base = extractSnippets(html).find((s) => s.label.includes('Grundpaketet'));
  const baseVars = declaredVars(splitParts(base.code).cssPart);
  for (const v of ['--acc', '--bg2', '--dim', '--line', '--ink', '--mono', '--hh']) {
    assert(baseVars.has(v), `Grundpaketet deklarerar ${v}`);
  }
  for (const id of MIGRATED) {
    const src = sources.get(id);
    const own = declaredVars(src.css);
    const missing = usedVars(src.css).filter((u) => !u.hasFallback && !own.has(u.name) && !baseVars.has(u.name));
    assert(missing.length === 0, `#${id}: alla var() i källan täcks av källan eller Grundpaketet${missing.length ? ` (saknas: ${missing.map((m) => m.name).join(', ')})` : ''}`);
  }
}

/* 5. Kodvalven klarar den befintliga statiska kontrollen --------------- */
{
  const { errors } = checkSnippets(build(html, sources));
  const own = errors.filter((e) => MIGRATED.some((id) => e.includes(id)) || /shape-outside|:target|border-angle/.test(e));
  assert(own.length === 0, `de genererade kodvalven klarar check-snippets.mjs${own.length ? `: ${own[0]}` : ''}`);
  assert(errors.length === 0, 'inga andra kodvalv påverkas av bygget');
}

/* 6. 133 demos och strukturkontroll ----------------------------------- */
{
  const built = build(html, sources);
  const n = (built.match(/<article class="demo[\s"]/g) || []).length;
  assert(n === EXPECTED_DEMOS, `${n} demos i det genererade dokumentet (förväntat ${EXPECTED_DEMOS})`);
  const { errors } = checkDocument(built);
  assert(errors.length === 0, `check.mjs är grön på genererat dokument${errors.length ? `: ${errors[0]}` : ''}`);
}

/* 7. Zero-JS ----------------------------------------------------------- */
{
  const built = build(html, sources);
  assert(!/<script[\s>]/i.test(built), 'inga <script>-element i det genererade dokumentet');
  assert(!/\son[a-z]+\s*=\s*"/i.test(built.replace(/<textarea\b[\s\S]*?<\/textarea>/g, '')), 'inga inline-handlers i det genererade dokumentet');
  assert(!/href\s*=\s*"javascript:/i.test(built), 'inga javascript:-URL:er');
  assert([...sources.values()].every((s) => !/<script/i.test(s.markup + s.css + s.liveCss)), 'källorna innehåller ingen <script>');
}

/* 8. Stale-detektering --------------------------------------------------- */
{
  // a) Källan ändras utan ombyggnad.
  const edited = new Map(sources);
  const t = sources.get('target');
  edited.set('target', { ...t, css: t.css.replace('gap:.6rem', 'gap:.7rem') });
  const gen = build(html, edited);
  assert(gen !== html, 'ändrad källa ⇒ genererat dokument skiljer sig från committat');
  assert(JSON.stringify(staleDemos(html, gen, edited)) === '["target"]', 'stale-rapporten pekar ut exakt rätt demo');

  // b) Någon redigerar live-markupen direkt i index.html i stället för i källan.
  const tampered = html.replace('<a href="#tp-1">Ett</a>', '<a href="#tp-1">Etta</a>');
  assert(build(tampered, sources) !== tampered, 'manuell ändring inuti markörerna upptäcks som stale');
  assert(build(tampered, sources) === html, '…och bygget återställer området ur källan');

  // c) Manuell ändring UTANFÖR markörerna lämnas orörd (ingen tyst överskrivning).
  const outside = html.replace('<title>', '<title>TEST ');
  assert(build(outside, sources) === outside, 'ändring utanför markörerna bevaras byte för byte');

  // d) Kodvalvet manipuleras direkt.
  const taStart = html.indexOf('aria-label="Kod för :target');
  const taTamper = html.slice(0, taStart) + html.slice(taStart).replace('.target-stack { position: relative; }', '.target-stack { position: static; }');
  assert(taTamper !== html && build(taTamper, sources) === html, 'manuell ändring i ett genererat kodvalv upptäcks och återställs');
}

/* 9. Felhantering: inget tyst ----------------------------------------- */
{
  throwsBuildError(() => parseSource('<div></div>'), 'källa utan <style> avvisas');
  throwsBuildError(() => parseSource('<style>a{}</style>'), 'källa utan markup avvisas');
  throwsBuildError(() => parseSource('<div></div><style>a{}</style><style>b{}</style>'), 'två delade <style> avvisas');
  throwsBuildError(() => parseSource('<div></div><script></script><style>a{}</style>'), '<script> i källa avvisas');
  throwsBuildError(() => applyDemo(html, 'finns-inte', sources.get('target')), 'källa utan markörer i index.html ger fel');
  throwsBuildError(() => build(html.replace('/* demo:target:css */', '/* demo:target:css-x */'), sources), 'saknad CSS-markör ger fel');
  throwsBuildError(() => build(html, new Map([...sources].filter(([id]) => id !== 'target'))), 'markör utan källfil (föräldralös) ger fel');
  const parsed = parseSource(readFileSync(join(DEMO_DIR, 'shape-outside.html'), 'utf8'));
  assert(parsed.liveCss.includes('.jmfbar') && !parsed.css.includes('.jmfbar'), 'data-live-CSS hålls isär från delad CSS');
}

console.log('');
if (failures) {
  console.error(`${failures} test misslyckades.`);
  process.exit(1);
}
console.log('Alla byggtest gröna.');
