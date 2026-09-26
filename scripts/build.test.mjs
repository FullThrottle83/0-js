#!/usr/bin/env node
/**
 * build.test.mjs — regressionstest för källgenereringen (scripts/build.mjs).
 *
 * Kör helt i minnet mot det committade index.html och demos/*.html:
 *   - bygget är deterministiskt och idempotent
 *   - manifestet (scripts/demo-spec.mjs) och demos/*.html är exakt samma mängd
 *   - varje migrerad demo: id, ankare, härledning, kodvalv, rows, data-live
 *   - migrerade källor delar inga CSS-regler med varandra (ingen kapitel-CSS)
 *   - DELAD CSS: fragment löses upp, skrivs exakt en gång i stilbladet och
 *     hamnar i precis de kodvalv som begär den — inte i något annat
 *   - de delade :root-variablerna (Grundpaketet) täcker källornas var()
 *   - de genererade kodvalven klarar check-snippets.mjs
 *   - alla 133 demos finns kvar, de omigrerade är fortfarande omarkerade
 *   - dokumentet innehåller ingen runtime-JavaScript
 *   - en föråldrad (stale) artefakt upptäcks — oavsett om källan eller
 *     index.html ändrats
 *   - felaktiga källor, okända/saknade fragment och saknade markörer ger
 *     tydliga fel, inte tyst utdata
 *   - regression: .swatch-yta-drift (2026-08-30) kan inte återkomma
 *
 * Testet är inventariestyrt: lägg till en demo i scripts/demo-spec.mjs och
 * påståendena nedan gäller den automatiskt. Inga listor med demo-id:n här.
 *
 * Kör: node scripts/build.test.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  build, loadSources, loadFragments, parseSource, parseFragment, renderLive, renderSnippet,
  staleDemos, applyDemo, applyFragment, resolveIncludes, usedFragments, fragmentOpen, fragmentClose,
  BuildError, DEMO_DIR, DELAT_DIR, INDEX, MAX_ROWS,
} from './build.mjs';
import { DEMO_SPEC, MIGRATED_IDS } from './demo-spec.mjs';
import { mergeBaselineDemos, applyIntentionalDiffs, INTENTIONAL_DIFFS } from '../tests/demo-parity.mjs';
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
const fragments = loadFragments();
const EXPECTED_DEMOS = 133;
const N = MIGRATED_IDS.length;
/** Alla fragment som faktiskt begärs av någon källa, i stilbladets ordning. */
const USED = usedFragments(sources, fragments);
/** Stilbladet = allt i <head> före <body>, kodvalvens text bortrensad. */
const stylesheet = (doc) => doc.slice(0, doc.indexOf('<body'));
const snippetLabel = (doc, id) => {
  const start = doc.search(new RegExp(`<article class="demo[^"]*" id="${id}">`));
  if (start < 0) return '';
  const article = doc.slice(start, doc.indexOf('</article>', start));
  return article.match(/<textarea class="kod"[^>]*aria-label="([^"]+)"/)?.[1] ?? '';
};
const snippetFor = (doc, id) => {
  const label = snippetLabel(doc, id);
  return extractSnippets(doc).find((v) => v.label === label)?.code ?? '';
};
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
      i = (end === -1 ? css.length : end + 2);
      // Kommentarer hör inte till reglerna och får inte bli en del av blocket.
      if (depth === 0) start = i;
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

/* 0. Manifestet, källfilerna och fragmenten är samma mängd --------------- */
{
  const files = [...sources.keys()].sort();
  assert(files.length === N, `demos/ innehåller ${N} källfiler (manifestet: ${N})`);
  assert(
    files.join(',') === [...MIGRATED_IDS].sort().join(','),
    `manifestet och demos/ är exakt samma mängd${files.join(',') === [...MIGRATED_IDS].sort().join(',' ? '' : ` (demos/: ${files.join(', ')})`)}`,
  );
  assert(new Set(MIGRATED_IDS).size === N, 'inga dubblerade id:n i manifestet');
  for (const d of DEMO_SPEC) {
    assert(typeof d.type === 'string' && typeof d.note === 'string' && Array.isArray(d.anchors),
      `#${d.id}: manifestposten har typ, anteckning och ankarlista`);
    assert(Array.isArray(d.shared), `#${d.id}: manifestposten har en lista över delade fragment`);
    // Manifestets `shared` ska vara exakt det källfilen faktiskt begär.
    const wanted = sources.get(d.id).includes;
    assert([...d.shared].sort().join(',') === [...wanted].sort().join(','),
      `#${d.id}: manifestets shared [${d.shared.join(' ')}] = källans data-include [${wanted.join(' ')}]`);
  }
  // Inget fragment får vara övergivet: varje fil i demos/_delat/ måste begäras.
  assert(USED.length === fragments.size,
    `alla ${fragments.size} fragment i demos/_delat/ begärs av en källa (${USED.join(', ')})`);
  for (const [name, frag] of fragments) {
    assert(frag.css.length > 0 && !/<style\b/i.test(frag.css), `#delat:${name}: fragmentet är rent CSS`);
  }
  const { errors } = checkSnippets(build(html, sources, fragments));
  assert(errors.length === 0, `check-snippets.mjs är grön på hela bygget${errors.length ? `: ${errors[0]}` : ''}`);
}

/* 1. Determinism ------------------------------------------------------- */
{
  const a = build(html, sources, fragments);
  const b = build(html, sources, fragments);
  assert(a === b, 'två byggen ur samma källor ger identisk utdata');
  assert(build(a, sources, fragments) === a, 'bygget är idempotent (bygg av byggt = oförändrat)');
  assert(a === html, `committat index.html är i fas med demos/ (${N} migrerade demos, inte stale)`);
  const reversed = new Map([...sources].reverse());
  assert(build(html, reversed, fragments) === a, 'källornas ordning påverkar inte utdata');
  const fragReversed = new Map([...fragments].reverse());
  assert(build(html, sources, fragReversed) === a, 'fragmentens ordning påverkar inte utdata');
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
    const fragCss = src.includes.map((n) => fragments.get(n).css);
    assert(decode(ta[2]) === renderSnippet(src, fragCss), `#${id}: kodvalvet är exakt renderSnippet(källa, fragment)`);
    assert(decode(ta[2]).includes(src.markup), `#${id}: kodvalvets HTML-del är källans markup, oindragen`);
    assert(decode(ta[2]).includes(src.css), `#${id}: kodvalvets CSS-del är källans <style>`);
    for (const [i, name] of src.includes.entries()) {
      assert(decode(ta[2]).includes(fragments.get(name).css),
        `#${id}: kodvalvet bär det begärda fragmentet ${name} (ordning ${i + 1} av ${src.includes.length})`);
    }
    assert(!/^\s{6}</m.test(decode(ta[2]).split('/* CSS */')[0].replace(/^<!-- HTML -->\n/, '')),
      `#${id}: kodvalvets markup har inget kortindrag kvar`);
    if (src.liveCss) {
      assert(!decode(ta[2]).includes(src.liveCss), `#${id}: <style data-live> kopieras INTE till kodvalvet`);
      assert(html.includes(src.liveCss), `#${id}: <style data-live> finns i sidans stilblad`);
    }
    assert(Boolean(src.liveCss) === spec.liveCss, `#${id}: data-live i källan stämmer med manifestet`);
    const rows = Number(ta[1].match(/rows="(\d+)"/)[1]);
    assert(rows === Math.min(renderSnippet(src, fragCss).split('\n').length, MAX_ROWS),
      `#${id}: rows följer radantalet (max ${MAX_ROWS})`);

    const cssOpen = `/* demo:${id}:css */`;
    const c = html.indexOf(cssOpen) + cssOpen.length;
    const d = html.indexOf(`/* /demo:${id}:css */`);
    const cssRegion = html.slice(c, d);
    assert(cssRegion.includes(src.css), `#${id}: stilbladet innehåller källans CSS ordagrant`);
    assert(d < html.indexOf('<body'), `#${id}: CSS-markören ligger i <head>-stilbladet, inte i kroppen`);
    assert(cssRegion.includes(src.liveCss) || !src.liveCss,
      `#${id}: <style data-live> ligger innanför CSS-markören`);
    // Demo-EGEN region: fragmentets CSS får inte duplikeras in i den.
    for (const name of src.includes) {
      for (const block of topLevelBlocks(fragments.get(name).css)) {
        assert(!topLevelBlocks(cssRegion).includes(block),
          `#${id}: fragmentet ${name} ligger i sin egen region, inte i demo-regionen (${block.slice(0, 44)}…)`);
      }
    }

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

  // Regler som kommer från ett fragment är definitionen av DELAD CSS och får
  // därmed inte heller stå i en demos egen <style>.
  const fragOwner = new Map();
  for (const [name, frag] of fragments) {
    for (const rule of topLevelBlocks(stripCssComments(frag.css))) fragOwner.set(rule, name);
  }
  const dupes = [];
  for (const [id, src] of ordered) {
    for (const rule of topLevelBlocks(stripCssComments(`${src.css}\n${src.liveCss}`))) {
      if (fragOwner.has(rule)) dupes.push(`${id} duplicerar ${fragOwner.get(rule)}: ${rule.slice(0, 50)}`);
    }
  }
  assert(dupes.length === 0, `ingen demo skriver om ett fragments regel i egen kod${dupes.length ? `: ${dupes[0]}` : ''}`);
}

/* 3b. Delade fragment: uppslag, en gång i stilbladet, rätt valv ---------- */
{
  const sheet = stylesheet(html);
  const sheetBlocks = topLevelBlocks(sheet);
  for (const [name, frag] of fragments) {
    const blocks = topLevelBlocks(frag.css);
    assert(blocks.length > 0, `#delat:${name}: fragmentet innehåller minst en regel`);
    // a) Varje regel i fragmentet finns i stilbladet …
    for (const block of blocks) {
      assert(sheetBlocks.includes(block), `#delat:${name}: "${block.slice(0, 44)}…" finns i stilbladet`);
    }
    // b) … och bara en gång. (Kodvalvens text är redan bortrensad ur sheet.)
    const hits = blocks.filter((b) => sheetBlocks.filter((x) => x === b).length !== 1);
    assert(hits.length === 0,
      `#delat:${name}: varje delad regel står EXAKT en gång i stilbladet${hits.length ? ` (${hits[0].slice(0, 44)}…)` : ''}`);
    // c) Markörerna finns och ligger i <head>.
    const o = fragmentOpen(name);
    const c = fragmentClose(name);
    assert(sheet.includes(o) && sheet.includes(c), `#delat:${name}: markörerna ${o} … ${c} finns i stilbladet`);
    assert(sheet.indexOf(o) < sheet.length, `#delat:${name}: regionen ligger i <head>`);
    // d) Inget fragment får innehålla markup, <style> eller <script>.
    assert(!/<[a-zA-Z!/]/.test(frag.css.replace(/\/\*[\s\S]*?\*\//g, '')),
      `#delat:${name}: fragmentet är rent CSS`);
  }

  /* e) Ingen regel får publiceras två gånger i stilbladet. Det var just
     detta som gjorde .labbar.grad-1 dubbel när linear-gradient migrerades:
     regeln flyttade till demo-källan men glömdes kvar i det delade blocket.
     Identiska regler är ofarliga för webbläsaren men de är en upprepning —
     och upprepning är vad migreringen ska ta bort. */
  const published = topLevelBlocks(sheet);
  const seen = new Map();
  for (const b of published) seen.set(b, (seen.get(b) ?? 0) + 1);
  const repeated = [...seen].filter(([, n]) => n > 1);
  assert(repeated.length === 0,
    `stilbladet publicerar ingen regel två gånger${repeated.length ? `: ${repeated[0][0].slice(0, 54)}` : ''}`);

  // Vem som helst av de migrerade demona får bara bära de fragment den begär.
  for (const [id, src] of ordered) {
    const vault = snippetFor(html, id);
    // Jämförelsen sker på normaliserad text (canon) — valvet har radbrytningar.
    const vaultCss = canon(vault);
    for (const [name, frag] of fragments) {
      const wanted = src.includes.includes(name);
      const present = topLevelBlocks(frag.css).every((b) => vaultCss.includes(b));
      if (wanted) assert(present, `#${id}: kodvalvet innehåller fragmentet ${name}`);
      else assert(!present, `#${id}: kodvalvet innehåller INTE det orelaterade fragmentet ${name}`);
    }
  }
}

/* 4. Delade variabler --------------------------------------------------- */
{
  const base = extractSnippets(html).find((s) => s.label.includes('Grundpaketet'));
  const baseVars = declaredVars(splitParts(base.code).cssPart);
  for (const v of ['--acc', '--bg2', '--dim', '--line', '--ink', '--mono', '--hh']) {
    assert(baseVars.has(v), `Grundpaketet deklarerar ${v}`);
  }
  // Sidans egna deklarationer (t.ex. @property --lv och .labbar:has(...){--lv:n}).
  // Live-only-CSS är sidans scenografi och FÅR bero på dem; demo-CSS får inte.
  const pageVars = declaredVars(stylesheet(html));
  for (const [id, src] of ordered) {
    const own = declaredVars(src.css);
    // Ett fragment får också deklarera variabler (och gör det ibland).
    for (const name of src.includes) for (const v of declaredVars(fragments.get(name).css)) own.add(v);
    // Anpassade egenskaper som sätts i markupens style-attribut (t.ex.
    // --p1/--p2 i donutdiagram) är också demots egna deklarationer.
    for (const m of src.markup.matchAll(/\bstyle="([^"]*)"/g)) for (const v of declaredVars(m[1])) own.add(v);
    // a) Demo-CSS: bara källan, fragmenten och Grundpaketet. Inga sidberoenden.
    const ownMissing = usedVars(src.css).filter((u) => !u.hasFallback && !own.has(u.name) && !baseVars.has(u.name));
    assert(ownMissing.length === 0,
      `#${id}: demo-CSS:ens var() täcks av källan, fragmenten eller Grundpaketet${ownMissing.length ? ` (saknas: ${ownMissing.map((m) => m.name).join(', ')})` : ''}`);
    // b) Live-only-CSS: även sidans egna deklarationer är tillåtna.
    const liveMissing = usedVars(src.liveCss)
      .filter((u) => !u.hasFallback && !own.has(u.name) && !baseVars.has(u.name) && !pageVars.has(u.name));
    assert(liveMissing.length === 0,
      `#${id}: live-CSS:ens var() täcks av källan, Grundpaketet eller sidan${liveMissing.length ? ` (saknas: ${liveMissing.map((m) => m.name).join(', ')})` : ''}`);
  }
  // … och fragmentens egna var() måste också täckas.
  for (const [name, frag] of fragments) {
    const missing = usedVars(frag.css).filter((u) => !u.hasFallback
      && !declaredVars(frag.css).has(u.name) && !baseVars.has(u.name));
    assert(missing.length === 0, `#delat:${name}: fragmentets var() täcks av fragmentet eller Grundpaketet${missing.length ? ` (saknas: ${missing.map((m) => m.name).join(', ')})` : ''}`);
  }
}

/* 5. Alla 133 demos och strukturkontroll ------------------------------- */
{
  const built = build(html, sources, fragments);
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
  const built = build(html, sources, fragments);
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
  const gen = build(html, edited, fragments);
  assert(gen !== html, 'ändrad källa ⇒ genererat dokument skiljer sig från committat');
  assert(staleDemos(html, gen, edited, fragments).join(',') === target,
    `stale-rapporten pekar ut exakt rätt demo (${target})`);
  for (const id of ['rgb-from', 'oklch-display-p3', 'radial-gradient', 'conic-gradient', 'repeating-linear-gradient', 'repeating-radial-gradient']) {
    const src = sources.get(id);
    const changed = new Map(sources).set(id, {
      ...src,
      css: src.css.replace('{', '{ /* ändrad källa */'),
    });
    const generated = build(html, changed, fragments);
    assert(generated !== html && staleDemos(html, generated, changed, fragments).join(',') === id,
      `stale-detektering pekar ut endast ${id} när dess canonicala CSS ändras`);
  }

  // b) Ett DELAT fragment ändras utan ombyggnad.
  const fragName = USED[0];
  const frag = fragments.get(fragName);
  const editedFrag = new Map(fragments);
  editedFrag.set(fragName, { ...frag, css: `${frag.css}\n/* redigerad */` });
  const genFrag = build(html, sources, editedFrag);
  assert(genFrag !== html, 'ändrat delat fragment ⇒ genererat dokument skiljer sig från committat');
  assert(staleDemos(html, genFrag, sources, editedFrag).includes(`delat:${fragName}`),
    `stale-rapporten pekar ut exakt rätt fragment (delat:${fragName})`);
  // … och det gäller för VARJE demo som begär fragmentet.
  for (const [id, src] of ordered) {
    if (!src.includes.includes(fragName)) continue;
    const vault = snippetFor(genFrag, id);
    assert(vault.includes('/* redigerad */'), `#${id}: ändrat fragment når ända in i kodvalvet`);
  }

  // c) Någon redigerar live-markupen direkt i index.html i stället för i källan.
  const open = `<!-- demo:${target}:markup -->`;
  const start = html.indexOf(open) + open.length;
  const tampered = html.slice(0, start) + html.slice(start).replace(/>/, ' data-tamper="1">');
  assert(build(tampered, sources, fragments) !== tampered, 'manuell ändring inuti markörerna upptäcks som stale');
  assert(build(tampered, sources, fragments) === html, '…och bygget återställer området ur källan');

  // d) Manuell ändring UTANFÖR markörerna lämnas orörd (ingen tyst överskrivning).
  const outside = html.replace('<title>', '<title>TEST ');
  assert(build(outside, sources, fragments) === outside, 'ändring utanför markörerna bevaras byte för byte');

  // e) Kodvalvet manipuleras direkt.
  const label = new RegExp(`aria-label="[^"]*${target}`);
  const taStart = html.search(label);
  const taTamper = html.slice(0, taStart)
    + html.slice(taStart).replace(/(\.[a-z-]+) \{/i, '$1{');
  assert(taTamper !== html && build(taTamper, sources, fragments) === html,
    'manuell ändring i ett genererat kodvalv upptäcks och återställs');

  // f) En källa utan manifestpost (föräldralös) ska inte kunna smyga in.
  assert(DEMO_SPEC.length === sources.size, 'inga källfiler saknar manifestpost');

  // g) En ändrad fragmentregion i index.html upptäcks och återställs.
  const fo = fragmentOpen(fragName);
  const fc = fragmentClose(fragName);
  const fs = html.indexOf(fo) + fo.length;
  const fragTamper = html.slice(0, fs) + html.slice(fs).replace('.', 'x');
  assert(fragTamper !== html && build(fragTamper, sources, fragments) === html,
    'manuell ändring i en fragmentregion upptäcks och återställs ur fragmentfilen');
}

/* 8. Felhantering: inget tyst ----------------------------------------- */
{
  throwsBuildError(() => parseSource('<div></div>'), 'källa utan <style> avvisas');
  throwsBuildError(() => parseSource('<style>a{}</style>'), 'källa utan markup avvisas');
  throwsBuildError(() => parseSource('<div></div><style>a{}</style><style>b{}</style>'), 'två delade <style> avvisas');
  throwsBuildError(() => parseSource('<div></div><script></script><style>a{}</style>'), '<script> i källa avvisas');
  throwsBuildError(() => applyDemo(html, 'finns-inte', sources.get('target'), fragments),
    'källa utan markörer i index.html ger fel');
  throwsBuildError(() => build(html.replace('/* demo:target:css */', '/* demo:target:css-x */'), sources, fragments),
    'saknad CSS-markör ger fel');
  throwsBuildError(() => build(html, new Map([...sources].filter(([id]) => id !== 'target')), fragments),
    'markör utan källfil (föräldralös) ger fel');
  const withLive = MIGRATED_IDS.find((id) => sources.get(id).liveCss);
  const parsed = parseSource(readFileSync(join(DEMO_DIR, `${withLive}.html`), 'utf8'));
  assert(parsed.liveCss.length > 0 && !parsed.css.includes(parsed.liveCss.trim()),
    `#${withLive}: data-live-CSS hålls isär från delad CSS`);

  /* 8b. Delade fragment: okända, saknade, cykliska, tomma --------------- */
  const someId = MIGRATED_IDS.find((id) => sources.get(id).includes.length > 0);
  const some = sources.get(someId);
  const first = some.includes[0];

  // Okänt fragmentnamn i en källa.
  throwsBuildError(
    () => build(html, new Map(sources).set(someId, { ...some, includes: [...some.includes, 'finns-inte'] }), fragments),
    `#${someId}: okänt data-include ("finns-inte") avvisas`,
  );
  // Saknad fragmentfil (markören finns i index.html men filen är borta).
  const withoutFirst = new Map([...fragments].filter(([n]) => n !== first));
  throwsBuildError(() => build(html, sources, withoutFirst),
    `saknad fragmentfil (demos/_delat/${first}.css) avvisas`);
  // Ett fragment som ingen demo begär.
  const extra = new Map(fragments).set('overgivet', { name: 'overgivet', css: '.x { color: red; }', includes: [] });
  throwsBuildError(() => build(html, sources, extra), 'fragment som ingen demo begär avvisas');
  // En markör i index.html för ett fragment som inte längre begärs av någon.
  const soloName = 'swatch-solo';
  const noIncludes = new Map([...sources].map(([id, src]) => [id, {
    ...src, includes: src.includes.filter(n => n !== soloName),
  }]));
  throwsBuildError(() => build(html, noIncludes, fragments),
    `övergiven fragmentmarkör i index.html avvisas (${soloName}: alla konsumenter borttagna)`);
  // Ett fragment får inte innehålla markup.
  throwsBuildError(() => parseFragment('<div>x</div>', 'demos/_delat/x.css'), 'fragment med markup avvisas');
  throwsBuildError(() => parseFragment('<style>a{}</style>', 'demos/_delat/x.css'), 'fragment med <style> avvisas');
  throwsBuildError(() => parseFragment('   ', 'demos/_delat/x.css'), 'tomt fragment avvisas');
  // Ett fragment kan inte inkludera ett annat (ingen cykel kan uppstå) och
  // resolveIncludes bevakar cykler ändå, så att invarianten hålls i koden.
  throwsBuildError(
    () => resolveIncludes(['a'], new Map([['a', { name: 'a', css: '', includes: ['b'] }], ['b', { name: 'b', css: '', includes: ['a'] }]])),
    'cyklisk data-include avvisas (a → b → a)',
  );
  throwsBuildError(
    () => resolveIncludes(['a'], new Map([['a', { name: 'a', css: '', includes: ['a'] }]])),
    'självrefererande data-include avvisas (a → a)',
  );
  // data-include får inte bära CSS och inte upprepas.
  throwsBuildError(() => parseSource(`<div></div><style data-include="${first}">.a{}</style><style>b{}</style>`),
    'CSS i ett data-include-block avvisas');
  throwsBuildError(() => parseSource(`<div></div><style data-include="${first} ${first}"></style><style>b{}</style>`),
    'samma fragment två gånger i data-include avvisas');
  throwsBuildError(() => parseSource('<div></div><style data-include=""></style><style>b{}</style>'),
    'tomt data-include avvisas');
}

/* 9. Regression: .swatch-yta-drift (2026-08-30) -------------------------- */
{
  // Historien: buggfixen 2026-08-30 lade display:block på .swatch och
  // .swatch-yta i stilbladet men nådde aldrig de 16 kopiorna i kodvalven.
  // Ett av dem ägdes av color-mix. Här låses båda hälftena fast.
  const swatch = fragments.get('swatch');
  assert(swatch, 'fragmentet swatch finns');
  assert(topLevelBlocks(swatch.css).some((b) => /\.swatch-yta\s*\{\s*display:\s*block/.test(b)),
    'fragmentet swatch bär buggfixen: .swatch-yta { display: block; … }');
  assert(topLevelBlocks(swatch.css).some((b) => /\.swatch\s*\{\s*display:\s*block/.test(b)),
    'fragmentet swatch bär buggfixen: .swatch { display: block; … }');

  const sheet = stylesheet(html);
  const vaults = extractSnippets(html);
  const cm = vaults.find((v) => v.label.includes('color-mix'))?.code ?? '';
  assert(/\.swatch-yta\s*\{\s*display:\s*block/.test(cm),
    'color-mix: kodvalvet bär buggfixen på .swatch-yta');
  assert(!/\.swatch-yta\s*\{\s*height:\s*3\.2rem;?\s*\}/.test(cm),
    'color-mix: kodvalvet innehåller INTE den gamla driftande kopian (.swatch-yta utan display:block)');
  // Den gamla kopian får inte heller finnas kvar i stilbladet som en andra regel.
  assert(!/\.swatch-yta\s*\{\s*height:\s*3\.2rem;?\s*\}/.test(sheet),
    'stilbladet har bara en .swatch-yta-regel, och den har display:block');

  // Beviset att testet FÄLLER: ändras fragmentet utan ombyggnad är
  // index.html stale, och det genererade kodvalvet mister buggfixen.
  const drifted = new Map(fragments).set('swatch', {
    ...swatch,
    css: swatch.css.replace('.swatch-yta { display: block; height: 3.2rem; }', '.swatch-yta { height: 3.2rem; }'),
  });
  assert(drifted.get('swatch').css !== swatch.css, 'testet kan simulera driften i fragmentet');
  const staleNow = staleDemos(html, build(html, sources, drifted), sources, drifted);
  assert(staleNow.includes('delat:swatch'),
    `ändrat fragment utan ombyggnad ⇒ index.html är stale (${staleNow.join(', ') || 'inget'})`);
  assert(build(html, sources, drifted) !== html,
    '…och det genererade dokumentet skiljer sig från det committade');
}

/* 10. Register och vägvisare bevaras ------------------------------------- */
{
  const built = build(html, sources, fragments);
  const REGISTER_START = '<!-- register:start';
  const REGISTER_END = '<!-- register:end -->';
  const region = (doc) => doc.slice(doc.indexOf(REGISTER_START), doc.indexOf(REGISTER_END));
  assert(region(built) === region(html),
    'A–Ö-registret ligger utanför markörerna och påverkas inte av bygget');
  const ctx = (doc) => [...doc.matchAll(/<!-- demo-ctx:([a-z0-9-]+) -->[\s\S]*?<!-- \/demo-ctx:\1 -->/g)];
  assert(ctx(built).length === 133, `alla 133 kort har sin vägvisare (${ctx(built).length})`);
  assert(ctx(built).map((m) => m[1]).join() === ctx(html).map((m) => m[1]).join(),
    'vägvisarna är oförändrade, kort för kort');
  // Byggordningen: bygget skriver bara demo- och fragmentregionerna.
  const stripped = (doc) => doc
    .replace(/<!-- demo:[a-z0-9-]+:markup -->[\s\S]*?<!-- \/demo:[a-z0-9-]+:markup -->/g, '')
    .replace(/\/\* demo:[a-z0-9-]+:css \*\/[\s\S]*?\/\* \/demo:[a-z0-9-]+:css \*\//g, '')
    .replace(/\/\* delat:[a-z0-9-]+:css \*\/[\s\S]*?\/\* \/delat:[a-z0-9-]+:css \*\//g, '');
  assert(stripped(built) === stripped(html),
    'ingenting utanför de genererade regionerna ändras av bygget');
}

/* 11. Grupp B-piloten: vad de två demona faktiskt får -------------------- */
{
  // Explicita påståenden om piloten — inte bara inventariestyrda.
  const cmSrc = sources.get('color-mix');
  const lgSrc = sources.get('linear-gradient');
  const cmVault = extractSnippets(html).find((v) => v.label.includes('color-mix'))?.code ?? '';
  const lgVault = extractSnippets(html).find((v) => v.label.includes('linear-gradient'))?.code ?? '';

  // Delat: swatch-familjen i båda.
  assert(cmSrc.includes.join() === 'swatch' && lgSrc.includes.join() === 'swatch,swatch-solo',
    'color-mix begär swatch; linear-gradient begär swatch + swatch-solo');
  for (const v of [cmVault, lgVault]) {
    assert(v.includes('.swatch {') && v.includes('.swatch-yta {') && v.includes('.swatch-lbl {'),
      'båda valv bär den delade swatch-familjen');
  }
  // Demo-EGEN CSS finns kvar.
  assert(cmVault.includes('.cm-row { display:grid') && cmVault.includes('color-mix(in oklch, var(--acc) 25%'),
    'color-mix: .cm-row och de fem stegen är kvar i valvet');
  assert(lgVault.includes('.grad-1 .swatch-yta { background: linear-gradient(135deg'),
    'linear-gradient: .grad-1 är kvar i valvet');
  // Sidans scenografi kopieras inte.
  for (const v of [cmVault, lgVault]) {
    assert(!v.includes('.labbar'), 'valvet innehåller inte labbets .labbar-överstyrningar');
    assert(!v.includes('KAPITEL 01 · FÄRG'), 'valvet innehåller inte kapitelbanderollen');
    assert(!v.includes('jmf'), 'valvet innehåller ingen jämförar-scenografi');
  }
  // Orelaterad labb-CSS får inte finnas.
  for (const sel of ['.rel-a', '.gamut-a', '.grad-2', '.grad-3', '.grad-4', '.grad-5',
    '.f-blur', '.f-contrast', '.f-saturate', '.f-hue', '.f-sepia', '.f-gray', '.f-invert', '.f-drop',
    '.filter-row', '.rel-row', '.gamut-row', '.grad-row']) {
    assert(!cmVault.includes(sel) && !lgVault.includes(sel),
      `valven innehåller inte orelaterad labb-CSS (${sel})`);
  }
  // color-mix använder inte .swatch-solo och ska inte bära den.
  assert(!cmVault.includes('.swatch-solo'), 'color-mix: valvet bär inte .swatch-solo (demot använder den inte)');
  assert(lgVault.includes('.swatch-solo { max-width: 22rem; }'),
    'linear-gradient: valvet bär .swatch-solo (demot använder den)');
  // Kodvalven är kortare än de gamla kapitelblocken (39 respektive 33 rader CSS).
  assert(cmVault.split('\n').length < 30, `color-mix: kodvalvet är ${cmVault.split('\n').length} rader (var 44)`);
  assert(lgVault.split('\n').length < 30, `linear-gradient: kodvalvet är ${lgVault.split('\n').length} rader (var 44)`);
}

/* 11b. Grupp B batch 3: relativa färger + bred färgrymd ------------------ */
{
  const rgb = sources.get('rgb-from');
  const gamut = sources.get('oklch-display-p3');
  const vault = (id) => snippetFor(html, id);
  const rgbVault = vault('rgb-from');
  const gamutVault = vault('oklch-display-p3');

  assert(rgb.includes.join() === 'swatch' && gamut.includes.join() === 'swatch',
    'rgb-from och oklch-display-p3 begär bara det delade swatch-fragmentet');
  assert(rgb.liveCss && !gamut.liveCss,
    'endast rgb-from har live-only CSS för labbets scenografi');
  assert(rgb.css.includes('.rel-row') && rgb.css.includes('rgb(from var(--acc)')
    && rgb.css.includes('hsl(from var(--acc)'),
  'rgb-from äger sitt rutnät och relativa RGB/HSL-färger');
  assert(rgb.liveCss.includes('.labbar .rel-b') && rgb.liveCss.includes('var(--lv)')
    && !rgbVault.includes('.labbar') && !rgbVault.includes('var(--lv)'),
  'rgb-from håller --lv-överstyrningar i live-CSS, utanför kodvalvet');
  assert(gamut.css.includes('.gamut-row') && gamut.css.includes('color(display-p3 1 .55 .1)')
    && gamut.css.includes('oklch(85% .25 145)'),
  'oklch-display-p3 äger fyrkolumnslayouten samt sina oklch- och display-p3-färger');
  for (const code of [rgbVault, gamutVault]) {
    assert(code.includes('.swatch { display: block;') && code.includes('.swatch-yta { display: block;'),
      'kodvalvet innehåller den uppdaterade swatch-regeln ur fragmentet');
    assert(!/\.swatch-solo|\.cm-row|\.grad-|\.filter-row|\.f-(?:blur|contrast|saturate|hue|sepia|gray|invert|drop)/.test(code),
      'kodvalvet innehåller inte solo-, blandnings-, gradient- eller filterregler');
    assert(!code.includes('KAPITEL 01') && !code.includes('.labbar'),
      'kodvalvet innehåller varken kapitelbanderollen eller labbscenografin');
  }
  assert(rgbVault.includes('.rel-row') && rgbVault.includes('.rel-e .swatch-yta'),
    'rgb-from-kodvalvet innehåller bara sina egna relativa färgregler');
  assert(gamutVault.includes('.gamut-row') && gamutVault.includes('.gamut-d .swatch-yta'),
    'oklch-display-p3-kodvalvet innehåller sina fyra gamut-regler');
  assert(!rgbVault.includes('.gamut-') && !gamutVault.includes('.rel-'),
    'relativfärg- och gamut-kodvalven bär inte varandras CSS');
}

/* 12. Grupp B — filterfamiljen: motivägande, en publicerad kopia, rena valv */
{
  /** Den enda gemensamma klassen: motivet kan ägas av EN regel i EN fil. */
  const MOTIF_CLASS = 'f-motiv';
  /** Motivets fyra lager, i målningsordning (överst först). */
  const MOTIF_LAYERS = [
    'radial-gradient(circle at 22% 28%, #fff 0 7%, transparent 8%)',
    'radial-gradient(circle at 74% 68%, rgb(255 255 255 / .55) 0 5%, transparent 6%)',
    'repeating-linear-gradient(90deg, rgb(0 0 0 / .22) 0 6px, transparent 6px 18px)',
    'linear-gradient(120deg, var(--acc), #6ea8ff 60%, #ff6ab0)',
  ];
  const FILTERS = [
    { id: 'filter-blur', cls: 'f-blur', decl: 'blur(3px)' },
    { id: 'filter-contrast', cls: 'f-contrast', decl: 'contrast(2.1)' },
    { id: 'filter-saturate', cls: 'f-saturate', decl: 'saturate(2.6)' },
    { id: 'filter-hue-rotate', cls: 'f-hue', decl: 'hue-rotate(120deg)' },
    { id: 'filter-sepia', cls: 'f-sepia', decl: 'sepia(.85)' },
    { id: 'filter-grayscale', cls: 'f-gray', decl: 'grayscale(1)' },
    { id: 'filter-invert', cls: 'f-invert', decl: 'invert(1)' },
    { id: 'filter-drop-shadow', cls: 'f-drop', decl: 'drop-shadow(0 0 8px var(--acc)) brightness(.9)' },
  ];
  /** Alla 16 Grupp B-demos: 3 färglabb + 5 gradienter + 8 filter. */
  const GROUP_B = ['color-mix', 'rgb-from', 'oklch-display-p3',
    'linear-gradient', 'radial-gradient', 'conic-gradient', 'repeating-linear-gradient',
    'repeating-radial-gradient', ...FILTERS.map((f) => f.id)];

  /* a) Inget Group B-kort finns kvar utanför källorna. */
  assert(GROUP_B.length === 16, 'Grupp B omfattar 16 demos');
  assert(GROUP_B.every((id) => MIGRATED_IDS.includes(id)),
    `alla 16 Grupp B-demon är migrerade (${GROUP_B.filter((id) => !MIGRATED_IDS.includes(id)).join(', ') || 'inga kvar'})`);

  /* b) Motivet ägs av fragmentet och publiceras exakt en gång. */
  const frag = fragments.get('filter-motiv');
  assert(frag, 'fragmentet filter-motiv finns');
  const fragBlocks = topLevelBlocks(frag.css);
  assert(fragBlocks.length === 1 && fragBlocks[0].startsWith(`.${MOTIF_CLASS} .swatch-yta{`),
    '#delat:filter-motiv: exakt en regel, och den bärs av den gemensamma klassen');
  for (const layer of MOTIF_LAYERS) {
    assert(frag.css.includes(layer), `#delat:filter-motiv: lagret finns (${layer.slice(0, 42)}…)`);
  }
  assert(MOTIF_LAYERS.every((l, i, all) => i === 0 || frag.css.indexOf(all[i - 1]) < frag.css.indexOf(l)),
    '#delat:filter-motiv: lagren står i rätt ordning');
  const sheet = stylesheet(html);
  const sheetBlocks = topLevelBlocks(sheet);
  assert(sheetBlocks.filter((b) => b.startsWith(`.${MOTIF_CLASS} .swatch-yta{`)).length === 1,
    'motivregeln publiceras EXAKT en gång i stilbladet');
  // Den gamla nioväljar-regeln får inte finnas kvar som en andra implementation.
  assert(!sheet.includes('.filter-row .swatch-yta'),
    'den gamla nioväljar-regeln för motivet är borta (ingen redundant andra kopia)');
  assert((sheet.match(/circle at 22% 28%/g) ?? []).length === 1,
    'motivets första lager förekommer exakt en gång i hela stilbladet');
  assert((sheet.match(/circle at 74% 68%/g) ?? []).length === 1,
    'motivets andra lager förekommer exakt en gång i hela stilbladet');
  assert(sheetBlocks.filter((b) => b.startsWith('.rel-row{')).length === 1
    && sheetBlocks.filter((b) => b.startsWith('.gamut-row{')).length === 1,
  'de unika rgb-from- och gamut-layoutreglerna publiceras exakt en gång ur källorna');

  for (const f of FILTERS) {
    const src = sources.get(f.id);
    /* c) Ägandet per källa: tre delade fragment, en egen deklaration. */
    assert(src.includes.join(' ') === 'swatch swatch-solo filter-motiv',
      `#${f.id}: begär swatch + swatch-solo + filter-motiv`);
    assert(new RegExp(`class="swatch ${f.cls} ${MOTIF_CLASS}"`).test(src.markup),
      `#${f.id}: markupen bär den delade motivklassen`);
    const expectedOwnCss = f.id === 'filter-drop-shadow'
      ? `.${f.cls} { overflow: visible; } .${f.cls} .swatch-yta { filter: ${f.decl}; border-radius: 9px 9px 0 0; }`
      : `.${f.cls} .swatch-yta { filter: ${f.decl}; }`;
    assert(canon(src.css) === canon(expectedOwnCss),
      `#${f.id}: demots egen CSS är exakt den egna filter-deklarationen`);
    assert(src.liveCss.includes(`.labbar.${f.cls}`) && src.liveCss.includes('var(--lv)'),
      `#${f.id}: laboratoriets --lv-regel är live-only`);

    /* d) Kodvalvet: komplett motiv, eget filter, ingenting annat. */
    const vault = snippetFor(html, f.id);
    const css = stripCssComments(splitParts(vault).cssPart);
    for (const layer of MOTIF_LAYERS) {
      assert(vault.includes(layer), `#${f.id}: kodvalvet bär motivlagret (${layer.slice(0, 42)}…)`);
    }
    assert(MOTIF_LAYERS.every((l, i, all) => i === 0 || vault.indexOf(all[i - 1]) < vault.indexOf(l)),
      `#${f.id}: kodvalvets fyra motivlager står i rätt ordning`);
    assert(!css.includes('--lv'), `#${f.id}: kodvalvet är oberoende av sidans --lv`);
    assert(!/\.labbar|KAPITEL 01|\.cm-row|\.rel-|\.gamut-|\.grad-|\.filter-row/.test(css),
      `#${f.id}: kodvalvet bär varken sidscenografi eller främmande kapitel-CSS`);
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
    const allowed = ['.demo-yta', '.swatch', '.swatch-yta', '.swatch-lbl', '.swatch-solo',
      '.swatch-solo > .swatch', '.swatch-solo .swatch-yta', `.${MOTIF_CLASS} .swatch-yta`,
      ...(f.id === 'filter-drop-shadow' ? [`.${f.cls}`] : []), `.${f.cls} .swatch-yta`];
    assert(selectors.length === allowed.length && selectors.every((s) => allowed.includes(s)),
      `#${f.id}: exakt ägande av kodvalvets selektorer (${selectors.join(' ')})`);
    for (const other of FILTERS.filter((o) => o.id !== f.id)) {
      assert(!css.includes(`.${other.cls} `), `#${f.id}: kodvalvet innehåller inte ${other.id}s CSS`);
    }
    /* e) Både demots egen regel och labbets publiceras exakt en gång. */
    assert(sheetBlocks.filter((b) => b.startsWith(`.${f.cls} .swatch-yta{`)).length === 1,
      `#${f.id}: filterregeln publiceras exakt en gång`);
    assert(sheetBlocks.filter((b) => b.startsWith(`.labbar.${f.cls} .swatch-yta{`)).length === 1,
      `#${f.id}: laboratorieregeln publiceras exakt en gång`);
  }

  /* f) Stale: motivfragmentet ändras utan ombyggnad når alla åtta valv —
       och inget annat. */
  const editedFrag = new Map(fragments).set('filter-motiv', { ...frag, css: `${frag.css}\n/* redigerad */` });
  const genFrag = build(html, sources, editedFrag);
  assert(genFrag !== html, 'ändrat motivfragment ⇒ genererat dokument skiljer sig från committat');
  assert(staleDemos(html, genFrag, sources, editedFrag).includes('delat:filter-motiv'),
    'stale-rapporten pekar ut delat:filter-motiv');
  for (const f of FILTERS) {
    assert(snippetFor(genFrag, f.id).includes('/* redigerad */'),
      `#${f.id}: ändrat motivfragment når ända in i kodvalvet`);
  }
  for (const id of MIGRATED_IDS.filter((id) => !FILTERS.some((f) => f.id === id))) {
    assert(!snippetFor(genFrag, id).includes('/* redigerad */'),
      `#${id}: motivfragmentet läcker inte in i ett valv som inte begär det`);
  }

  /* g) Stale: en enskild filterkälla ändras ⇒ bara den pekas ut. */
  for (const f of FILTERS) {
    const src = sources.get(f.id);
    const changed = new Map(sources).set(f.id, { ...src, css: src.css.replace('{', '{ /* ändrad källa */') });
    const generated = build(html, changed, fragments);
    assert(generated !== html && staleDemos(html, generated, changed, fragments).join(',') === f.id,
      `stale-detektering pekar ut endast ${f.id} när dess kanoniska CSS ändras`);
  }

  /* h) Saknat eller okänt motivfragment avvisas — aldrig tyst utelämnat. */
  throwsBuildError(
    () => build(html, sources, new Map([...fragments].filter(([n]) => n !== 'filter-motiv'))),
    'saknad fragmentfil (demos/_delat/filter-motiv.css) avvisas',
  );
  throwsBuildError(
    () => build(html, new Map(sources).set('filter-blur', {
      ...sources.get('filter-blur'), includes: ['swatch', 'swatch-solo', 'filter-motiv- fel'],
    }), fragments),
    'okänt data-include ("filter-motiv- fel") avvisas',
  );

  /* i) Negativ regression: tas motivklassen bort ur EN källa upptäcks det —
       både av stale-kontrollen och av täckningskontrollen nedan. */
  const motifCovered = (code) => new RegExp(`class="swatch f-[a-z-]+ ${MOTIF_CLASS}"`).test(code);
  for (const f of FILTERS) {
    assert(motifCovered(snippetFor(html, f.id)), `#${f.id}: kodvalvet bär motivklassen`);
    const stripped = { ...sources.get(f.id), markup: sources.get(f.id).markup.replace(` ${MOTIF_CLASS}`, '') };
    const mutated = build(html, new Map(sources).set(f.id, stripped), fragments);
    assert(mutated !== html, `#${f.id}: borttagen motivklass gör index.html stale`);
    assert(!motifCovered(snippetFor(mutated, f.id)),
      `#${f.id}: borttagen motivklass ⇒ kodvalvet saknar motivet (täckningstestet hade fällt)`);
  }

  /* j) Inventariet runt omkring är orört. */
  const built = build(html, sources, fragments);
  assert((built.match(/<li class="reg-rad/g) ?? []).length === 134,
    `A–Ö-registret har 134 poster (${(built.match(/<li class="reg-rad/g) ?? []).length})`);
  assert((built.match(/<article class="demo[\s"]/g) ?? []).length === EXPECTED_DEMOS,
    `${EXPECTED_DEMOS} demos i det genererade dokumentet`);
}


/* All five gradient vaults own exactly one gradient, plus existing fragments. */
{
  const ids = ['linear-gradient', 'radial-gradient', 'conic-gradient', 'repeating-linear-gradient', 'repeating-radial-gradient'];
  const blocks = topLevelBlocks(stylesheet(html));
  ids.forEach((id, i) => {
    const src = sources.get(id);
    assert(src.includes.join(' ') === 'swatch swatch-solo', `${id}: both shared fragments`);
    const css = stripCssComments(splitParts(snippetFor(html, id)).cssPart);
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].map(m => m[1].trim());
    const allowed = ['.demo-yta', '.swatch', '.swatch-yta', '.swatch-lbl', '.swatch-solo', '.swatch-solo > .swatch', '.swatch-solo .swatch-yta', `.grad-${i + 1} .swatch-yta`];
    assert(selectors.length === allowed.length && selectors.every(s => allowed.includes(s)), `${id}: exact snippet selector ownership`);
    assert(!css.includes('--lv'), `${id}: no laboratory dependency`);
    for (const prefix of [`.grad-${i + 1}`, `.labbar.grad-${i + 1}`]) {
      assert(blocks.filter(b => b.startsWith(prefix + ' .swatch-yta{')).length === 1, `${id}: ${prefix} published exactly once`);
    }
  });
}

/* 13. Historiska mätbaslinjer får aldrig skrivas över av --merge -------- */
{
  const historical = { target: { default: { provenance: 'PR #4' } } };
  const incoming = { 'color-mix': { default: { provenance: 'pre-migration' } } };
  const merged = mergeBaselineDemos(historical, incoming);
  assert(Object.keys(merged).length === 2 && merged.target === historical.target
    && merged['color-mix'] === incoming['color-mix'],
    '--merge lägger till nya demo-id:n utan att ändra historiska poster');
  assert(Object.keys(historical).length === 1,
    '--merge muterar inte den inlästa baslinjen');
  let rejected = false;
  try {
    mergeBaselineDemos(historical, { target: { default: { provenance: 'overwritten' } } });
  } catch (e) {
    rejected = /target/.test(e.message) && /skriva över/.test(e.message);
  }
  assert(rejected, '--merge avvisar försök att skriva över ett befintligt demo-id');
}

/* 14. Det avsiktliga paritetsundantaget är smalt och låst åt båda håll ---- */
{
  /** Minimal mätning: en nod med en klass, plus markup-strängen. */
  const fake = (cls) => ({
    elements: [{ path: 'div:nth-child(5)>span:nth-child(1)', tag: 'span', class: cls, id: '', text: '' }],
    html: `<span class="${cls}"></span>`,
    controls: [],
    unstable: [],
  });
  const FILTER_PATH = 'div:nth-child(5)>span:nth-child(1)';
  assert(INTENTIONAL_DIFFS.length === 8 && INTENTIONAL_DIFFS.every((d) => d.path === FILTER_PATH),
    'undantagslistan omfattar exakt åtta poster, alla med klassändringen på samma nodtyp');
  const drop = INTENTIONAL_DIFFS.find((d) => d.id === 'filter-drop-shadow');
  assert(drop.styles?.length === 2
    && drop.styles.map((s) => s.prop).join(',') === 'overflow,border-radius',
    'drop-shadow-undantaget låser exakt overflow och ytan hörngeometri');
  for (const d of INTENTIONAL_DIFFS) {
    assert(MIGRATED_IDS.includes(d.id), `#${d.id}: undantaget gäller en migrerad demo`);
  }
  // a) Den deklarerade skillnaden normaliseras — och bara den.
  const notes = applyIntentionalDiffs(fake('swatch f-blur'), fake('swatch f-blur f-motiv'), 'filter-blur');
  assert(notes.length === 1, `filter-blur: en avsiktlig skillnad normaliseras (${notes.length})`);
  const untouched = applyIntentionalDiffs(fake('swatch grad-1'), fake('swatch grad-1'), 'linear-gradient');
  assert(untouched.length === 0, 'linear-gradient: inget undantag, inget normaliseras');
  const dropFake = (cls, overflow, radius) => ({
    elements: [
      { ...fake(cls).elements[0], style: { overflow } },
      { path: 'div:nth-child(5)>span:nth-child(1)>span:nth-child(1)', style: { 'border-radius': radius } },
    ],
    html: `<span class="${cls}"><span></span></span>`, controls: [], unstable: [],
  });
  const dropNotes = applyIntentionalDiffs(dropFake('swatch f-drop', 'hidden', '0px'),
    dropFake('swatch f-drop f-motiv', 'visible', '9px 9px 0px 0px'), 'filter-drop-shadow');
  assert(dropNotes.length === 3, 'drop-shadow: klass, overflow och hörngeometri normaliseras explicit');
  const normalized = fake('swatch f-blur f-motiv');
  applyIntentionalDiffs(fake('swatch f-blur'), normalized, 'filter-blur');
  assert(normalized.elements[0].class === 'swatch f-blur'
    && normalized.html === '<span class="swatch f-blur"></span>',
  'filter-blur: bara klasstoken normaliseras — markup-strängen och noden följer med');

  // b) En ODokumenterad klasskillnad på samma nod normaliseras inte: den kastar.
  const throws = (fn) => { try { fn(); return false; } catch (e) { return /avsiktlig skillnad stämmer inte/.test(e.message); } };
  assert(throws(() => applyIntentionalDiffs(fake('swatch f-blur'), fake('swatch f-blur oannonserad'), 'filter-blur')),
    'filter-blur: en odokumenterad klass på samma nod avvisas (undantaget kan inte vidgas tyst)');
  assert(throws(() => applyIntentionalDiffs(fake('swatch f-blur'), fake('swatch f-motiv'), 'filter-blur')),
    'filter-blur: en borttagen filterklass avvisas');
  const notExempt = applyIntentionalDiffs(fake('swatch grad-1'), fake('swatch grad-1 f-motiv'), 'linear-gradient');
  assert(notExempt.length === 0,
    'linear-gradient: motivklassen på ett icke-filterkort normaliseras inte — skillnaden fäller pariteten');
  // c) En omfångad baslinje (klassen redan i båda leden) döljs inte heller.
  assert(throws(() => applyIntentionalDiffs(fake('swatch f-blur f-motiv'), fake('swatch f-blur f-motiv'), 'filter-blur')),
    'filter-blur: en omfångad post-e-migrering-baslinje faller i stället för att dölja skillnaden');
  assert(throws(() => applyIntentionalDiffs(fake('swatch f-blur'), fake('swatch f-blur f-motiv f-extra'), 'filter-blur')),
    'filter-blur: en extra klass utöver den avsiktliga avvisas');
  // d) En post som pekar på en nod som inte mäts alls är ett fel.
  let missing = false;
  try { applyIntentionalDiffs(fake('swatch f-blur'), fake('swatch f-blur f-motiv'), 'filter-finns-inte'); } catch (e) { missing = true; }
  assert(!missing, 'ett demo utan deklarerat undantag normaliserar ingenting (inga fel, ingen ändring)');
  let badPath = false;
  try {
    applyIntentionalDiffs(
      { ...fake('swatch f-blur'), elements: [{ path: 'något-annat', class: 'swatch f-blur' }] },
      fake('swatch f-blur f-motiv'), 'filter-blur',
    );
  } catch (e) { badPath = /inte mäts/.test(e.message); }
  assert(badPath, 'en post vars nod inte mäts avvisas');
}

console.log('');
if (failures) {
  console.error(`${failures} test misslyckades.`);
  process.exit(1);
}
console.log(`Alla byggtest gröna (${N} migrerade demos, inventariestyrda påståenden).`);
