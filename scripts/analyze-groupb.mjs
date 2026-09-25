#!/usr/bin/env node
/* Analys (ej del av bygget): kartlägg kapitel 01-reglerna mot Grupp B-demos. */
import { readFileSync } from 'node:fs';
import { extractSnippets, splitParts, stripCssComments } from '../scripts/check-snippets.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const GROUP_B = [
  'color-mix', 'rgb-from', 'oklch-display-p3',
  'linear-gradient', 'radial-gradient', 'conic-gradient',
  'repeating-linear-gradient', 'repeating-radial-gradient',
  'filter-blur', 'filter-contrast', 'filter-saturate', 'filter-hue-rotate',
  'filter-sepia', 'filter-grayscale', 'filter-invert', 'filter-drop-shadow',
];

const styleStart = html.indexOf('/* ============================================================\n   KAPITEL 01 · FÄRG');
const styleEnd = html.indexOf('/* ============================================================\n   KAPITEL 02');
const chapter = html.slice(styleStart, styleEnd);

function topLevelBlocks(css) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css.startsWith('/*', i)) { const e = css.indexOf('*/', i + 2); i = (e === -1 ? css.length : e + 2); start = i; continue; }
    if (css[i] === '{') depth++;
    else if (css[i] === '}') { depth--; if (depth === 0) { out.push(css.slice(start, i + 1).trim()); start = i + 1; } }
  }
  return out.filter((b) => b && !b.startsWith('/*'));
}
const blocks = topLevelBlocks(chapter);
console.log(`# kapitel 01: ${blocks.length} toppnivåblock`);

const selectorsOf = (block) => block.slice(0, block.indexOf('{')).split(',').map((s) => s.trim()).filter(Boolean);

const cardOf = (id) => {
  const a = html.search(new RegExp(`<article class="demo[^"]*" id="${id}">`));
  return html.slice(a, html.indexOf('</article>', a));
};
/** Hitta .demo-yta-elementet med balanserade taggar. */
function demoYtaOf(art) {
  const i = art.indexOf('<div class="demo-yta');
  if (i === -1) return '';
  let depth = 0, j = i;
  const re = /<\/?div\b[^>]*>/g;
  re.lastIndex = i;
  let m;
  while ((m = re.exec(art))) {
    if (m[0][1] === '/') depth--;
    else depth++;
    if (depth === 0) { j = m.index + m[0].length; break; }
  }
  return art.slice(i, j);
}
const classesIn = (s) => new Set([...s.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

const rows = [];
for (const id of GROUP_B) {
  const art = cardOf(id);
  const markup = demoYtaOf(art);
  const ta = art.match(/<textarea class="kod"[^>]*>([\s\S]*?)<\/textarea>/);
  const code = decode(ta[1]);
  const { htmlPart, cssPart } = splitParts(code);
  const cls = classesIn(markup);
  rows.push({ id, markup, vaultHtml: htmlPart.replace(/^<!-- HTML -->\n/, '').trim(), vaultCss: cssPart, cls: [...cls] });
}

/* Vilka block väljs av respektive demos markup? */
console.log('\n# Användning av kapitelreglerna per demo');
for (const r of rows) {
  const used = blocks.filter((b) => selectorsOf(b).some((sel) => {
    // enkel behovsanalys: sista kaskad-klassen i väljaren finns i markupen
    const cls = [...sel.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
    return cls.length > 0 && cls.every((c) => r.cls.includes(c));
  }));
  console.log(`${r.id}: [${r.cls.join(' ')}] → ${used.length} block`);
  for (const u of used) console.log(`    ${u.split('\n')[0].slice(0, 90)}`);
}

/* Vilka block finns i varje valv? */
console.log('\n# Valvets CSS-block vs live-block');
for (const r of rows) {
  const vb = topLevelBlocks(r.vaultCss).map((b) => b.replace(/\s+/g, ' '));
  console.log(`${r.id}: ${vb.length} block i valvet`);
}

/* Exakta valvs-CSS för color-mix och filter-blur */
for (const id of ['color-mix', 'filter-blur', 'linear-gradient']) {
  const r = rows.find((x) => x.id === id);
  console.log(`\n===== ${id} valv-CSS =====\n${r.vaultCss}`);
  console.log(`===== ${id} live-markup =====\n${r.markup}`);
}
