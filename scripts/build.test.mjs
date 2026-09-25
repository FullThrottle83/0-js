#!/usr/bin/env node
/**
 * build.test.mjs — regressionstest för källgenereringen (scripts/build.mjs).
 *
 * Kör helt i minnet mot det committade index.html och demos/*.html:
 *   - bygget är deterministiskt och idempotent
 *   - manifestet (scripts/demo-spec.mjs) och demos/*.html är exakt samma mängd
 *   - varje migrerad demo: id, ankare, härledning, kodvalv, rows, data-live
 *   - migrerade källor delar inga CSS-regler med varandra (ingen kapitel-CSS)
 *   - de delade :root-variablerna (Grundpaketet) täcker källornas var()
 *   - de genererade kodvalven klarar check-snippets.mjs
 *   - alla 133 demos finns kvar, de omigrerade är fortfarande omarkerade
 *   - dokumentet innehåller ingen runtime-JavaScript
 *   - en föråldrad (stale) artefakt upptäcks — oavsett om källan eller
 *     index.html ändrats
 *   - felaktiga källor och saknade markörer ger tydliga fel, inte tyst utdata
 *
 * Testet är inventariestyrt: lägg till en demo i scripts/demo-spec.mjs och
 * påståendena nedan gäller den automatiskt. Inga listor med demo-id:n här.
 *
 * Kör: node scripts/build.test.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  build, loadSources, parseSource, renderLive, renderSnippet, staleDemos,
  applyDemo, BuildError, DEMO_DIR, INDEX, MAX_ROWS,
} from './build.mjs';
import { DEMO_SPEC, MIGRATED_IDS } from './demo-spec.mjs';
import { checkDocument } from './check.mjs';
import { checkSnippets, extractSnippets, splitParts, declaredVars, usedVars, stripCssComments } from './check-snippets.mjs';

let failures = 0;
const ok = (m) => console.log(`✓ ${m}`);
const fail = (m) => { console.error(`✗ ${m}`); failures++; };
const assert = (c, m) => (c ? ok(m) : fail(m));
const throwsBuildError = (fn, m) => {
  try { fn(); fail(`${m} (inget fel kastades)`); } catch (e) { assert(e instanceof BuildError, `${m}: ${e.message}`); }
};

const html = readFileSync(INDEX, 'utf8');
const sources = loadSources();
const EXPECTED_DEMOS = 133;
const N = MIGRATED_IDS.length;
const canon = (s) => s.replace(/\s+/g, ' ').replace(/\s*:\s*/g, ':').replace(/\s*,\s*/g, ',')
  .replace(/\s*;\s*/g, ';').replace(/\s*\{\s*/g, '{').replace(/\s*\}\s*/g, '}').replace(/;}/g, '}').trim();

/**
 * Dela CSS i toppnivåblock (regler, @media, @supports …) med balanserade
 * klamrar. Kommentarer räknas inte. Används för att jämföra regeltext mellan
 * källor; en naiv regex skulle inte klara nästlade block.
 */
const topLevelBlocks = (css) => {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      i = (end === -1 ? css.length : end + 2) - 1;
      continue;
    }
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) { out.push(canon(css.slice(start, i + 1))); start = i + 1; }
    }
  }
  return out.filter(Boolean);
};

/** Alla källor som en Map, i manifestets ordning (deterministiskt). */
const ordered = MIGRATED_IDS.map((id) => [id, sources.get(id)]);

/* 0. Manifestet och källfilerna är samma mängd -------------------------- */
{
  const files = [...sources.keys()].sort();
  assert(files.length === N, `demos/ innehåller ${N} källfiler (manifestet: ${N})`);
  assert(
    files.join(',') === [...MIGRATED_IDS].sort().join(','),
    `manifestet och demos/ är exakt samma mängd${files.join(',') === [...MIGRATED_IDS].sort().join(',') ? '' : ` (demos/: ${files.join(', ')})`}`,
  );
  assert(new Set(MIGRATED_IDS).size === N, 'inga dubblerade id:n i manifestet');
  for (const d of DEMO_SPEC) {
    assert(typeof d.type === 'string' && typeof d.note === 'string' && Array.isArray(d.anchors),
      `#${d.id}: manifestposten har typ, anteckning och ankarlista`);
  }
  const { errors } = checkSnippets(build(html, sources));
  assert(errors.length === 0, `check-snippets.mjs är grön på hela bygget${errors.length ? `: ${errors[0]}` : ''}`);
}

/* 1. Determinism ------------------------------------------------------- */
{
  const a = build(html, sources);
  const b = build(html, sources);
  assert(a === b, 'två byggen ur samma källor ger identisk utdata');
  assert(build(a, sources) === a, 'bygget är idempotent (bygg av byggt = oförändrat)');
  assert(a === html, `committat index.html är i fas med demos/ (${N} migrerade demos, inte stale)`);
  const reversed = new Map([...sources].reverse());
  assert(build(html, reversed) === a, 'källornas ordning påverkar inte utdata');
}

/* 2. Härledning ur källan, per migrerad demo ---------------------------- */
{
  const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const dom = html.replace(/<textarea\b[\s\S]*?<\/textarea>/g, '');
  const idsInDom = [...dom.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const linksInDom = [...dom.matchAll(/<a\b[^>]*\bhref="#([^"]+)"/g)].map((m) => m[1]);

  for (const [id, src] of ordered) {
    const spec = DEMO_SPEC.find((d) => d.id === id);
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
    assert(!/^\s{6}</m.test(decode(ta[2]).split('/* CSS */')[0].replace(/^<!-- HTML -->\n/, '')),
      `#${id}: kodvalvets markup har inget kortindrag kvar`);
    if (src.liveCss) {
      assert(!decode(ta[2]).includes(src.liveCss), `#${id}: <style data-live> kopieras INTE till kodvalvet`);
      assert(html.includes(src.liveCss), `#${id}: <style data-live> finns i sidans stilblad`);
    }
    assert(Boolean(src.liveCss) === spec.liveCss, `#${id}: data-live i källan stämmer med manifestet`);
    const rows = Number(ta[1].match(/rows="(\d+)"/)[1]);
    assert(rows === Math.min(renderSnippet(src).split('\n').length, MAX_ROWS), `#${id}: rows följer radantalet (max ${MAX_ROWS})`);

    const cssOpen = `/* demo:${id}:css */`;
    const c = html.indexOf(cssOpen) + cssOpen.length;
    const d = html.indexOf(`/* /demo:${id}:css */`);
    assert(html.slice(c, d).includes(src.css), `#${id}: stilbladet innehåller källans CSS ordagrant`);
    assert(d < html.indexOf('<body'), `#${id}: CSS-markören ligger i <head>-stilbladet, inte i kroppen`);
    assert(html.slice(c, d).includes(src.liveCss) || !src.liveCss,
      `#${id}: <style data-live> ligger innanför CSS-markören`);

    /* id:n och ankare i källan: unika i dokumentet och pekade på */
    const markupIds = [...src.markup.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    const markupLinks = [...src.markup.matchAll(/<a\b[^>]*\bhref="#([^"]+)"/g)].map((m) => m[1]);
    for (const mid of new Set(markupIds)) {
      assert(idsInDom.filter((x) => x === mid).length === 1, `#${id}: id="${mid}" förekommer exakt en gång i markupen`);
    }
    for (const mid of new Set(markupLinks)) {
      assert(idsInDom.includes(mid), `#${id}: ankarlänken #${mid} har ett mål i dokumentet`);
      assert(linksInDom.filter((x) => x === mid).length >= 1, `#${id}: länken till #${mid} finns kvar`);
    }
    for (const anchor of spec.anchors) {
      assert(new Set(markupIds).has(anchor), `#${id}: manifestets ankare #${anchor} finns i källans markup`);
    }
    assert(idsInDom.filter((x) => x === id).length === 1, `#${id}: kortets eget id finns exakt en gång`);
    assert(linksInDom.includes(id), `#${id}: indexlänken till #${id} finns kvar`);
    assert(new RegExp(`<article class="demo[^"]*" id="${id}">`).test(html), `#${id}: är fortfarande ett demo-kort`);
  }
}

/* 3. Ingen delad CSS mellan migrerade källor ---------------------------- */
{
  const owner = new Map();
  const clashes = [];
  for (const [id, src] of ordered) {
    for (const rule of topLevelBlocks(stripCssComments(`${src.css}\n${src.liveCss}`))) {
      if (owner.has(rule) && owner.get(rule) !== id) clashes.push(`${owner.get(rule)} ↔ ${id}: ${rule.slice(0, 60)}`);
      owner.set(rule, id);
    }
  }
  assert(clashes.length === 0,
    `ingen CSS-regel delas mellan migrerade källor (${owner.size} regler kontrollerade)${clashes.length ? `: ${clashes[0]}` : ''}`);
}

/* 4. Delade variabler --------------------------------------------------- */
{
  const base = extractSnippets(html).find((s) => s.label.includes('Grundpaketet'));
  const baseVars = declaredVars(splitParts(base.code).cssPart);
  for (const v of ['--acc', '--bg2', '--dim', '--line', '--ink', '--mono', '--hh']) {
    assert(baseVars.has(v), `Grundpaketet deklarerar ${v}`);
  }
  for (const [id, src] of ordered) {
    const own = declaredVars(src.css);
    // Anpassade egenskaper som sätts i markupens style-attribut (t.ex.
    // --p1/--p2 i donutdiagram) är också demots egna deklarationer.
    for (const m of src.markup.matchAll(/\bstyle="([^"]*)"/g)) for (const v of declaredVars(m[1])) own.add(v);
    const missing = usedVars(`${src.css}\n${src.liveCss}`)
      .filter((u) => !u.hasFallback && !own.has(u.name) && !baseVars.has(u.name));
    assert(missing.length === 0, `#${id}: alla var() i källan täcks av källan eller Grundpaketet${missing.length ? ` (saknas: ${missing.map((m) => m.name).join(', ')})` : ''}`);
  }
}

/* 5. Alla 133 demos och strukturkontroll ------------------------------- */
{
  const built = build(html, sources);
  const n = (built.match(/<article class="demo[\s"]/g) || []).length;
  assert(n === EXPECTED_DEMOS, `${n} demos i det genererade dokumentet (förväntat ${EXPECTED_DEMOS})`);
  const marked = new Set([...built.matchAll(/<!-- demo:([a-z0-9-]+):markup -->/g)].map((m) => m[1]));
  assert(marked.size === N, `${marked.size} kort är markerade (${N} migrerade)`);
  assert(EXPECTED_DEMOS - marked.size === EXPECTED_DEMOS - N,
    `${EXPECTED_DEMOS - N} kort är fortfarande omarkerade (migreras i senare batchar)`);
  const { errors } = checkDocument(built);
  assert(errors.length === 0, `check.mjs är grön på genererat dokument${errors.length ? `: ${errors[0]}` : ''}`);
}

/* 6. Zero-JS ----------------------------------------------------------- */
{
  const built = build(html, sources);
  assert(!/<script[\s>]/i.test(built), 'inga <script>-element i det genererade dokumentet');
  assert(!/\son[a-z]+\s*=\s*"/i.test(built.replace(/<textarea\b[\s\S]*?<\/textarea>/g, '')), 'inga inline-handlers i det genererade dokumentet');
  assert(!/href\s*=\s*"javascript:/i.test(built), 'inga javascript:-URL:er');
  assert(ordered.every(([, s]) => !/<script/i.test(s.markup + s.css + s.liveCss)), 'källorna innehåller ingen <script>');
}

/* 7. Stale-detektering --------------------------------------------------- */
{
  const first = MIGRATED_IDS[0];
  const target = MIGRATED_IDS.find((id) => id === 'target') ?? first;
  const t = sources.get(target);

  // a) Källan ändras utan ombyggnad.
  const edited = new Map(sources);
  edited.set(target, { ...t, css: t.css.replace('.target-stack', '.target-stack "x"') !== t.css
    ? t.css.replace('{', '{ /* redigerad */', 1)
    : t.css });
  const gen = build(html, edited);
  assert(gen !== html, 'ändrad källa ⇒ genererat dokument skiljer sig från committat');
  assert(staleDemos(html, gen, edited).join(',') === target, `stale-rapporten pekar ut exakt rätt demo (${target})`);

  // b) Någon redigerar live-markupen direkt i index.html i stället för i källan.
  const open = `<!-- demo:${target}:markup -->`;
  const start = html.indexOf(open) + open.length;
  const tampered = html.slice(0, start) + html.slice(start).replace(/>/, ' data-tamper="1">');
  assert(build(tampered, sources) !== tampered, 'manuell ändring inuti markörerna upptäcks som stale');
  assert(build(tampered, sources) === html, '…och bygget återställer området ur källan');

  // c) Manuell ändring UTANFÖR markörerna lämnas orörd (ingen tyst överskrivning).
  const outside = html.replace('<title>', '<title>TEST ');
  assert(build(outside, sources) === outside, 'ändring utanför markörerna bevaras byte för byte');

  // d) Kodvalvet manipuleras direkt.
  const label = new RegExp(`aria-label="[^"]*${target}`);
  const taStart = html.search(label);
  const taTamper = html.slice(0, taStart)
    + html.slice(taStart).replace(/(\.[a-z-]+) \{/i, '$1{');
  assert(taTamper !== html && build(taTamper, sources) === html, 'manuell ändring i ett genererat kodvalv upptäcks och återställs');

  // e) En källa utan manifestpost (föräldralös) ska inte kunna smyga in.
  assert(DEMO_SPEC.length === sources.size, 'inga källfiler saknar manifestpost');
}

/* 8. Felhantering: inget tyst ----------------------------------------- */
{
  throwsBuildError(() => parseSource('<div></div>'), 'källa utan <style> avvisas');
  throwsBuildError(() => parseSource('<style>a{}</style>'), 'källa utan markup avvisas');
  throwsBuildError(() => parseSource('<div></div><style>a{}</style><style>b{}</style>'), 'två delade <style> avvisas');
  throwsBuildError(() => parseSource('<div></div><script></script><style>a{}</style>'), '<script> i källa avvisas');
  throwsBuildError(() => applyDemo(html, 'finns-inte', sources.get('target')), 'källa utan markörer i index.html ger fel');
  throwsBuildError(() => build(html.replace('/* demo:target:css */', '/* demo:target:css-x */'), sources), 'saknad CSS-markör ger fel');
  throwsBuildError(() => build(html, new Map([...sources].filter(([id]) => id !== 'target'))), 'markör utan källfil (föräldralös) ger fel');
  const withLive = MIGRATED_IDS.find((id) => sources.get(id).liveCss);
  const parsed = parseSource(readFileSync(join(DEMO_DIR, `${withLive}.html`), 'utf8'));
  assert(parsed.liveCss.length > 0 && !parsed.css.includes(parsed.liveCss.trim()),
    `#${withLive}: data-live-CSS hålls isär från delad CSS`);
}

console.log('');
if (failures) {
  console.error(`${failures} test misslyckades.`);
  process.exit(1);
}
console.log(`Alla byggtest gröna (${N} migrerade demos, inventariestyrda påståenden).`);
