#!/usr/bin/env node
/**
 * build.mjs — genererar live-demo, stilregler och kopierbart kodvalv ur EN
 * kanonisk källa per demo (antalet står i scripts/demo-spec.mjs; se
 * docs/demo-kalla.md).
 *
 * Källor:      demos/<id>.html        — markup + <style> (+ valfri <style data-live>,
 *                                        + valfria <style data-include="…">)
 *              demos/_delat/<n>.css   — delade fragment (t.ex. swatch-familjen)
 * Mall/artefakt: index.html           — publicerad enfilsprodukt; bara innehållet
 *                                       mellan markörerna skrivs om.
 *
 * Markörer i index.html:
 *   <!-- demo:ID:markup -->…<!-- /demo:ID:markup -->   live-markup i kortet
 *   /* demo:ID:css *\/…/* /demo:ID:css *\/              demo-EGEN CSS i <style>-blocket
 *   <textarea class="kod" …> i kortets kodvalv          hittas via kortets id
 *   /* delat:N:css *\/…/* /delat:N:css *\/              ett delat fragment, EN gång
 *
 * DELAD CSS (Grupp B, docs/demo-kalla.md §7)
 * ------------------------------------------
 * Regler som flera kort delar ägs av ett fragment i demos/_delat/ och skrivs
 * av bygget på EXAKT ett ställe i stilbladet — regionen /* delat:N:css *\/.
 * En källfil begär fragmentet med <style data-include="swatch">; bygget fogar
 * in fragmentets CSS i kodvalvet (efter basregeln, före demots egna CSS).
 * Konsekvenserna är avsiktliga:
 *   - en ändring i fragmentet når alla kort och alla kopior på en gång,
 *   - inget kort kan drifta från de andra (det finns bara en kopia),
 *   - ett fragment som ingen demo begär är ett fel, inte en död fil,
 *   - ett okänt fragmentnamn är ett fel, inte en tyst utelämning,
 *   - fragment kan inte innehålla markup eller inkludera varandra.
 *
 * Allt annat i index.html lämnas byte för byte orört — därför skriver bygget
 * aldrig över manuella ändringar utanför markörerna. Ändringar INUTI ett
 * markerat område i index.html är däremot fel ställe att redigera på; de
 * upptäcks av `--check` och ersätts av källan vid nästa bygge.
 *
 * Kör:   node scripts/build.mjs            skriv index.html
 *        node scripts/build.mjs --check    avsluta med kod 1 om index.html
 *                                          inte motsvarar källorna (stale)
 *
 * Programmatisk användning (scripts/build.test.mjs):
 *   import { build, parseSource, renderSnippet } from './build.mjs'
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEMO_DIR = join(ROOT, 'demos');
export const DELAT_DIR = join(DEMO_DIR, '_delat');
export const INDEX = join(ROOT, 'index.html');

/** Delad basregel som inleder varje kodvalvs CSS-del (samma i alla 133 demos). */
export const SNIPPET_BASE_CSS = '.demo-yta {position: relative; border-radius: 4px;}';
/** <textarea rows> är begränsad till 26 i hela dokumentet. */
export const MAX_ROWS = 26;

export class BuildError extends Error {}

/* Källformat ------------------------------------------------------------- */

/**
 * Tolka en källfil:
 *   [<!-- kommentar -->] markup… <style>css</style> [<style data-live>css</style>]
 *   … plus valfria <style data-include="fragment …"> (tomma; namnen pekar på
 *   filer i demos/_delat/).
 * Returnerar { markup, css, liveCss, includes }. Inget HTML-parser-bibliotek
 * behövs: formatet är vårt eget och strikt — ett fel ger ett tydligt undantag.
 */
export function parseSource(text, name = 'källa') {
  let body = text.replace(/^\uFEFF/, '');
  // Inledande dokumentationskommentar (valfri) hör inte till demot.
  body = body.replace(/^\s*<!--[\s\S]*?-->\s*/, '');

  const styles = [];
  const markup = body.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>\s*/g, (_, attrs, css) => {
    styles.push({
      live: /\bdata-live\b/.test(attrs),
      include: /\bdata-include\b/.test(attrs),
      attrs,
      css: css.replace(/^\n+|\s+$/g, ''),
    });
    return '';
  }).trim();

  if (!markup) throw new BuildError(`${name}: saknar markup`);
  if (/<style\b/.test(markup)) throw new BuildError(`${name}: <style> måste stå efter all markup`);
  if (/<script\b/i.test(text)) throw new BuildError(`${name}: <script> är inte tillåtet — projektet är zero-JS`);
  const shared = styles.filter((s) => !s.live && !s.include);
  const live = styles.filter((s) => s.live);
  const wanted = styles.filter((s) => s.include);
  if (shared.length !== 1) throw new BuildError(`${name}: ska ha exakt ett <style> (hittade ${shared.length})`);
  if (live.length > 1) throw new BuildError(`${name}: högst ett <style data-live>`);

  const includes = [];
  for (const s of wanted) {
    if (s.live) throw new BuildError(`${name}: <style> kan inte vara både data-live och data-include`);
    if (s.css.trim()) {
      throw new BuildError(`${name}: <style data-include> ska vara tomt — fragmentets CSS kommer från demos/_delat/`);
    }
    const names = (s.attrs.match(/data-include\s*=\s*"([^"]*)"/) || [, ''])[1].trim().split(/\s+/).filter(Boolean);
    if (!names.length) throw new BuildError(`${name}: <style data-include> anger inget fragment`);
    for (const n of names) {
      if (includes.includes(n)) throw new BuildError(`${name}: fragmentet ${n} anges två gånger i data-include`);
      includes.push(n);
    }
  }

  return { markup, css: shared[0].css, liveCss: live[0]?.css ?? '', includes };
}

/** Läs alla demos/<id>.html → Map<id, källa>. Sorterat = deterministiskt. */
export function loadSources(dir = DEMO_DIR) {
  const out = new Map();
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.html')).sort()) {
    const id = basename(f, '.html');
    out.set(id, parseSource(readFileSync(join(dir, f), 'utf8'), `demos/${f}`));
  }
  return out;
}

/* Delade fragment -------------------------------------------------------- */

/**
 * Ett fragment är RENT CSS. Det kan inte innehålla markup, <style> eller
 * <script>, och det kan inte inkludera andra fragment — därmed finns ingen
 * riktig cykel att göra. resolveIncludes bevakar cykler ändå, så att
 * invarianen hålls i koden och inte bara i konventionen.
 */
export function parseFragment(text, name = 'fragment') {
  const body = text.replace(/^\uFEFF/, '');
  if (/<[a-zA-Z!/]/.test(body.replace(/\/\*[\s\S]*?\*\//g, ''))) {
    throw new BuildError(`${name}: fragment ska vara rent CSS — ingen markup, inget <style>, inget <script>`);
  }
  const css = body.trim();
  if (!css) throw new BuildError(`${name}: fragmentet är tomt`);
  return { name, css, includes: [] };
}

/** Läs alla demos/_delat/*.css → Map<namn, fragment>. Sorterat = deterministiskt. */
export function loadFragments(dir = DELAT_DIR) {
  const out = new Map();
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.css')).sort()) {
    out.set(basename(f, '.css'), parseFragment(readFileSync(join(dir, f), 'utf8'), `demos/_delat/${f}`));
  }
  return out;
}

/** Markörer för ett delat fragment i stilbladet. */
export const fragmentOpen = (name) => `/* delat:${name}:css */`;
export const fragmentClose = (name) => `/* /delat:${name}:css */`;

/**
 * Lös upp en lista fragmentnamn till den ordning de ska skrivas i: i
 * deklareringsordning, dubbletter borttagna. Okänt namn och cykler ger
 * BuildError — aldrig en tyst utelämning.
 */
export function resolveIncludes(names = [], fragments, stack = []) {
  const out = [];
  for (const name of names) {
    if (stack.includes(name)) {
      throw new BuildError(`cyklisk data-include: ${[...stack, name].join(' → ')}`);
    }
    const frag = fragments.get(name);
    if (!frag) throw new BuildError(`okänt data-include: "${name}" — demos/_delat/${name}.css saknas`);
    for (const sub of resolveIncludes(frag.includes, fragments, [...stack, name])) {
      if (!out.includes(sub)) out.push(sub);
    }
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** Fragmentnamn i den ordning de skrivs i stilbladet: sorterat (oberoende av källordning). */
export function usedFragments(sources, fragments = new Map()) {
  const used = new Set();
  for (const [, src] of sources) {
    for (const name of resolveIncludes(src.includes, fragments)) used.add(name);
  }
  return [...used].sort();
}

/* Renderare -------------------------------------------------------------- */

export function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Live-markup: källans rader indragna till markörens nivå. */
export function renderLive(markup, indent) {
  return markup.split('\n').map((l) => (l.trim() ? indent + l : '')).join('\n');
}

/** CSS-block i <style>: delad CSS följt av eventuell live-CSS. */
export function renderCss({ css, liveCss }) {
  return liveCss ? `${css}\n\n${liveCss}` : css;
}

/**
 * Kodvalvets råa text (oescapad) — exakt vad besökaren kopierar.
 * Ordningen är basregel → delade fragment (i den ordning källan begär dem)
 * → demots egna CSS. Ett fragment läggs bara in om källan faktiskt ber om det.
 */
export function renderSnippet({ markup, css }, fragmentCss = []) {
  return `<!-- HTML -->\n${markup}\n\n/* CSS */\n\n${[SNIPPET_BASE_CSS, ...fragmentCss, css].join('\n')}`;
}

/* Infogning ------------------------------------------------------------- */

/**
 * Ligger positionen inuti ett kodvalv (textarea)? Markörer får finnas i
 * kodvalvens text — det är citerad kod, inte dokumentstruktur — och får
 * därmed inte räknas som en andra förekomst av markören i dokumentet.
 */
export function insideTextarea(html, pos) {
  return html.lastIndexOf('<textarea', pos) > html.lastIndexOf('</textarea>', pos);
}

/** Första förekomst av `needle` som INTE ligger i ett kodvalv. */
export function markerIndex(html, needle, from = 0) {
  let i = html.indexOf(needle, from);
  while (i !== -1 && insideTextarea(html, i)) i = html.indexOf(needle, i + 1);
  return i;
}

function replaceBetween(html, open, close, content, what) {
  const a = markerIndex(html, open);
  if (a === -1) throw new BuildError(`${what}: markör saknas: ${open}`);
  if (markerIndex(html, open, a + 1) !== -1) throw new BuildError(`${what}: markören förekommer flera gånger: ${open}`);
  const b = markerIndex(html, close, a);
  if (b === -1) throw new BuildError(`${what}: slutmarkör saknas: ${close}`);
  return html.slice(0, a + open.length) + content + html.slice(b);
}

/** Infoga ett delat fragment i stilbladet. Ren funktion: (html, namn, fragment) → html. */
export function applyFragment(html, name, fragment) {
  return replaceBetween(html, fragmentOpen(name), fragmentClose(name), `\n${fragment.css}\n`, `delat fragment ${name}`);
}

/** Infoga en demo i dokumentet. Ren funktion: (html, id, källa, fragment) → html. */
export function applyDemo(html, id, source, fragments = new Map()) {
  const what = `demo ${id}`;
  const wanted = resolveIncludes(source.includes, fragments);
  const fragmentCss = wanted.map((n) => fragments.get(n).css);

  // 1. Live-markup mellan markörerna, med markörens indrag.
  const open = `<!-- demo:${id}:markup -->`;
  const close = `<!-- /demo:${id}:markup -->`;
  const pos = markerIndex(html, open);
  if (pos === -1) throw new BuildError(`${what}: markör saknas: ${open}`);
  const lineStart = html.lastIndexOf('\n', pos) + 1;
  const indent = html.slice(lineStart, pos).match(/^[ \t]*/)[0];
  html = replaceBetween(html, open, close, `\n${renderLive(source.markup, indent)}\n${indent}`, what);

  // 2. CSS mellan markörerna i stilbladet.
  html = replaceBetween(html, `/* demo:${id}:css */`, `/* /demo:${id}:css */`, `\n${renderCss(source)}\n`, what);

  // 3. Kodvalvet: första <textarea class="kod"> i kortet med detta id.
  const artRe = new RegExp(`<article class="demo[^"]*" id="${id}">`);
  const art = html.match(artRe);
  if (!art) throw new BuildError(`${what}: hittar inget <article class="demo…" id="${id}">`);
  const artEnd = html.indexOf('</article>', art.index);
  const slice = html.slice(art.index, artEnd);
  const ta = slice.match(/<textarea class="kod"([^>]*)>[\s\S]*?<\/textarea>/);
  if (!ta) throw new BuildError(`${what}: kortet saknar kodvalv`);
  const snippet = renderSnippet(source, fragmentCss);
  const rows = Math.min(snippet.split('\n').length, MAX_ROWS);
  const attrs = ta[1].replace(/\brows="\d+"/, `rows="${rows}"`);
  const newTa = `<textarea class="kod"${attrs}>${escapeHtml(snippet)}</textarea>`;
  html = html.slice(0, art.index + ta.index) + newTa + html.slice(art.index + ta.index + ta[0].length);

  return html;
}

/** Hela bygget som ren funktion: (mall/artefakt, källor, fragment) → nytt dokument. */
export function build(html, sources, fragments = new Map()) {
  // 1. Delade fragment först: varje skrivs på exakt ett ställe i stilbladet.
  const wanted = usedFragments(sources, fragments);
  for (const name of fragments.keys()) {
    if (!wanted.includes(name)) {
      throw new BuildError(`demos/_delat/${name}.css refereras inte av någon demo i demos/ — ta bort filen eller lägg till data-include`);
    }
  }
  for (const name of wanted) html = applyFragment(html, name, fragments.get(name));

  // 2. Demon, i sorterad ordning (oberoende av källornas ordning).
  for (const [id, source] of [...sources].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    html = applyDemo(html, id, source, fragments);
  }

  // 3. Skydd: varje markör i dokumentet måste ha en källa, annars är något
  //    föräldralöst (t.ex. en borttagen källfil eller ett övergivet fragment).
  const doc = html.replace(/<textarea\b[\s\S]*?<\/textarea>/g, '');
  for (const m of doc.matchAll(/<!-- demo:([a-z0-9-]+):markup -->/g)) {
    if (!sources.has(m[1])) throw new BuildError(`markör för demo ${m[1]} finns i index.html men demos/${m[1]}.html saknas`);
  }
  for (const m of doc.matchAll(/\/\* delat:([a-z0-9-]+):css \*\//g)) {
    if (!wanted.includes(m[1])) {
      throw new BuildError(`markören /* delat:${m[1]}:css */ finns i index.html men ingen demo begär fragmentet`);
    }
  }
  return html;
}

/** Vilka markerade områden skiljer sig? Används av --check för tydlig rapport. */
export function staleDemos(current, generated, sources, fragments = new Map()) {
  const region = (html, id) => {
    const a = markerIndex(html, `<!-- demo:${id}:markup -->`);
    const b = markerIndex(html, `/* demo:${id}:css */`);
    const artStart = html.search(new RegExp(`<article class="demo[^"]*" id="${id}">`));
    const art = html.slice(artStart, html.indexOf('</article>', artStart));
    return [html.slice(a, html.indexOf(`<!-- /demo:${id}:markup -->`, a)),
      html.slice(b, html.indexOf(`/* /demo:${id}:css */`, b)),
      art.match(/<textarea class="kod"[\s\S]*?<\/textarea>/)?.[0]].join('\u0000');
  };
  const out = [...sources.keys()].filter((id) => region(current, id) !== region(generated, id));
  const fragRegion = (html, name) => html.slice(
    markerIndex(html, fragmentOpen(name)),
    markerIndex(html, fragmentClose(name)) + fragmentClose(name).length,
  );
  for (const name of fragments.keys()) {
    if (fragRegion(current, name) !== fragRegion(generated, name)) out.push(`delat:${name}`);
  }
  return out;
}

/* CLI ------------------------------------------------------------------ */
if (process.argv[1] && join(dirname(fileURLToPath(import.meta.url)), 'build.mjs') === process.argv[1]) {
  const check = process.argv.includes('--check');
  try {
    const sources = loadSources();
    const fragments = loadFragments();
    const current = readFileSync(INDEX, 'utf8');
    const generated = build(current, sources, fragments);
    const stale = staleDemos(current, generated, sources, fragments);
    const same = generated === current;

    console.log(`0-js · källgenerering (${sources.size} demos ur demos/, ${fragments.size} delade fragment ur demos/_delat/)\n`);
    if (check) {
      if (!same) {
        console.error(`✗ index.html är inte i fas med källorna: ${stale.join(', ') || '(okänt område)'}`);
        console.error('  Kör: npm run build');
        process.exit(1);
      }
      console.log('index.html motsvarar källorna i demos/. Inget att generera.');
    } else if (same) {
      console.log('index.html redan i fas — inget skrevs.');
    } else {
      writeFileSync(INDEX, generated);
      console.log(`Skrev index.html · uppdaterade: ${stale.join(', ')}`);
    }
  } catch (e) {
    if (e instanceof BuildError) { console.error(`✗ ${e.message}`); process.exit(1); }
    throw e;
  }
}
