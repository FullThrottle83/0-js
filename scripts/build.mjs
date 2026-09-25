#!/usr/bin/env node
/**
 * build.mjs — genererar live-demo, stilregler och kopierbart kodvalv ur EN
 * kanonisk källa per demo (antalet står i scripts/demo-spec.mjs; se
 * docs/demo-kalla.md).
 *
 * Källor:      demos/<id>.html   — markup + <style> (+ valfri <style data-live>)
 * Mall/artefakt: index.html      — publicerad enfilsprodukt; bara innehållet
 *                                  mellan demo-markörerna skrivs om.
 *
 * Markörer i index.html (en uppsättning per migrerad demo):
 *   <!-- demo:ID:markup -->…<!-- /demo:ID:markup -->   live-markup i kortet
 *   /* demo:ID:css *\/…/* /demo:ID:css *\/              CSS i <style>-blocket
 *   <textarea class="kod" …> i kortets kodvalv          hittas via kortets id
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
 * Returnerar { markup, css, liveCss }. Inget HTML-parser-bibliotek behövs:
 * formatet är vårt eget och strikt — ett fel ger ett tydligt undantag.
 */
export function parseSource(text, name = 'källa') {
  let body = text.replace(/^\uFEFF/, '');
  // Inledande dokumentationskommentar (valfri) hör inte till demot.
  body = body.replace(/^\s*<!--[\s\S]*?-->\s*/, '');

  const styles = [];
  const markup = body.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>\s*/g, (_, attrs, css) => {
    styles.push({ live: /\bdata-live\b/.test(attrs), css: css.replace(/^\n+|\s+$/g, '') });
    return '';
  }).trim();

  if (!markup) throw new BuildError(`${name}: saknar markup`);
  if (/<style\b/.test(markup)) throw new BuildError(`${name}: <style> måste stå efter all markup`);
  if (/<script\b/i.test(text)) throw new BuildError(`${name}: <script> är inte tillåtet — projektet är zero-JS`);
  const shared = styles.filter((s) => !s.live);
  const live = styles.filter((s) => s.live);
  if (shared.length !== 1) throw new BuildError(`${name}: ska ha exakt ett <style> (hittade ${shared.length})`);
  if (live.length > 1) throw new BuildError(`${name}: högst ett <style data-live>`);

  return { markup, css: shared[0].css, liveCss: live[0]?.css ?? '' };
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

/** Kodvalvets råa text (oescapad) — exakt vad besökaren kopierar. */
export function renderSnippet({ markup, css }) {
  return `<!-- HTML -->\n${markup}\n\n/* CSS */\n\n${SNIPPET_BASE_CSS}\n${css}`;
}

/* Infogning ------------------------------------------------------------- */

function replaceBetween(html, open, close, content, what) {
  const a = html.indexOf(open);
  if (a === -1) throw new BuildError(`${what}: markör saknas: ${open}`);
  if (html.indexOf(open, a + 1) !== -1) throw new BuildError(`${what}: markören förekommer flera gånger: ${open}`);
  const b = html.indexOf(close, a);
  if (b === -1) throw new BuildError(`${what}: slutmarkör saknas: ${close}`);
  return html.slice(0, a + open.length) + content + html.slice(b);
}

/** Infoga en demo i dokumentet. Ren funktion: (html, id, källa) → html. */
export function applyDemo(html, id, source) {
  const what = `demo ${id}`;

  // 1. Live-markup mellan markörerna, med markörens indrag.
  const open = `<!-- demo:${id}:markup -->`;
  const close = `<!-- /demo:${id}:markup -->`;
  const pos = html.indexOf(open);
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
  const snippet = renderSnippet(source);
  const rows = Math.min(snippet.split('\n').length, MAX_ROWS);
  const attrs = ta[1].replace(/\brows="\d+"/, `rows="${rows}"`);
  const newTa = `<textarea class="kod"${attrs}>${escapeHtml(snippet)}</textarea>`;
  html = html.slice(0, art.index + ta.index) + newTa + html.slice(art.index + ta.index + ta[0].length);

  return html;
}

/** Hela bygget som ren funktion: (mall/artefakt, källor) → nytt dokument. */
export function build(html, sources) {
  for (const [id, source] of [...sources].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    html = applyDemo(html, id, source);
  }
  // Skydd: varje markör i dokumentet måste ha en källa, annars är något
  // föräldralöst (t.ex. en borttagen källfil).
  for (const m of html.matchAll(/<!-- demo:([a-z0-9-]+):markup -->/g)) {
    if (!sources.has(m[1])) throw new BuildError(`markör för demo ${m[1]} finns i index.html men demos/${m[1]}.html saknas`);
  }
  return html;
}

/** Vilka markerade områden skiljer sig? Används av --check för tydlig rapport. */
export function staleDemos(current, generated, sources) {
  const region = (html, id) => {
    const a = html.indexOf(`<!-- demo:${id}:markup -->`);
    const b = html.indexOf(`/* demo:${id}:css */`);
    const artStart = html.search(new RegExp(`<article class="demo[^"]*" id="${id}">`));
    const art = html.slice(artStart, html.indexOf('</article>', artStart));
    return [html.slice(a, html.indexOf(`<!-- /demo:${id}:markup -->`, a)),
      html.slice(b, html.indexOf(`/* /demo:${id}:css */`, b)),
      art.match(/<textarea class="kod"[\s\S]*?<\/textarea>/)?.[0]].join('\u0000');
  };
  return [...sources.keys()].filter((id) => region(current, id) !== region(generated, id));
}

/* CLI ------------------------------------------------------------------ */
if (process.argv[1] && join(dirname(fileURLToPath(import.meta.url)), 'build.mjs') === process.argv[1]) {
  const check = process.argv.includes('--check');
  try {
    const sources = loadSources();
    const current = readFileSync(INDEX, 'utf8');
    const generated = build(current, sources);
    const stale = staleDemos(current, generated, sources);
    const same = generated === current;

    console.log(`0-js · källgenerering (${sources.size} demos ur demos/)\n`);
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
