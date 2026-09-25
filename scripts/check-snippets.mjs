#!/usr/bin/env node
/**
 * check-snippets.mjs — verifiera de kopierbara kodexemplen (nivå 4 i testplanen).
 *
 * Varje kodvalv i index.html byggs upp av en HTML-del och en CSS-del.
 * Skriptet dekoderar exemplen och kontrollerar det en besökare faktiskt
 * möter när hen klistrar in koden i ett tomt dokument:
 *
 *   - varje var(--x) är antingen deklarerad i själva exemplet eller i
 *     grundpaketet (de delade :root-variablerna, definierade i demot
 *     "Grundpaketet" — basen läses ur dokumentet, inte ur en hårdkodad
 *     lista, så den inte kan glida)
 *   - CSS-klammerblocken är balanserade
 *   - HTML-taggar i exemplet är balanserade
 *
 * Kör: node scripts/check-snippets.mjs
 * Avslutar med kod 1 om något exempel inte håller måttet.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

const errors = [];
let checked = 0;

function error(name, msg) {
  errors.push(`✗ ${name}: ${msg}`);
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Plocka ut alla kodvalv: etikett + avkodlat innehåll. */
function extractSnippets() {
  const out = [];
  const re = /<textarea class="kod"[^>]*aria-label="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>|<textarea class="kod"[^>]*>([\s\S]*?)<\/textarea>/g;
  for (const m of html.matchAll(re)) {
    const label = m[1] || '(okänt kodvalv)';
    out.push({ label, code: decodeEntities(m[2] ?? m[3] ?? '') });
  }
  return out;
}

/** Dela ett exempel i HTML- och CSS-del vid /* CSS *-markören. */
function splitParts(code) {
  const idx = code.indexOf('/* CSS */');
  if (idx === -1) {
    return code.trimStart().startsWith('/*') || code.trimStart().startsWith(':root') || code.trimStart().startsWith('@')
      ? { htmlPart: '', cssPart: code }
      : { htmlPart: code, cssPart: '' };
  }
  return { htmlPart: code.slice(0, idx), cssPart: code.slice(idx) };
}

/**
 * <pre><code>-block i exemplens HTML-del är citerad dokumentation,
 * inte körbar kod — rensa bort dem innan vi letar beroenden och taggar.
 */
function stripQuotedCode(htmlPart) {
  return htmlPart.replace(/<pre>[\s\S]*?<\/pre>/g, '');
}

/** Samla alla --namn som deklareras någonstans i texten. */
function declaredVars(text) {
  const found = new Set();
  for (const m of text.matchAll(/@property\s+(--[A-Za-z0-9-]+)/g)) found.add(m[1]);
  for (const m of text.matchAll(/(--[A-Za-z0-9-]+)\s*:/g)) found.add(m[1]);
  return found;
}

/** Samla alla var(--namn) som används, med info om fallback finns. */
function usedVars(text) {
  const uses = [];
  for (const m of text.matchAll(/var\(\s*(--[A-Za-z0-9-]+)\s*(,([^()]*|\([^()]*\))?)?\)/g)) {
    uses.push({ name: m[1], hasFallback: Boolean(m[2]) });
  }
  return uses;
}

/** Balanskontroll av klammerblock i CSS. */
function balancedBraces(css) {
  let depth = 0;
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const ch of stripped) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** Balanskontroll av taggar i HTML-delen (escapade inre exempel är bara text). */
function balancedTags(htmlPart) {
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const depth = new Map();
  for (const m of htmlPart.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'/])*?)(\/?)>/g)) {
    const [, closing, name, , selfClosed] = m;
    const key = name.toLowerCase();
    if (voidTags.has(key) || selfClosed === '/') continue;
    depth.set(key, (depth.get(key) || 0) + (closing ? -1 : 1));
  }
  return [...depth].filter(([, d]) => d !== 0);
}

/* ------------------------------------------------------------------ */
/* Basen: grundpaketets :root-variabler, lästa ur dokumentet.         */
/* ------------------------------------------------------------------ */
const snippets = extractSnippets();
const base = snippets.find((s) => s.label.includes('Grundpaketet'));
if (!base) {
  error('grundpaket', 'hittar inte Grundpaketet-snippeten som definierar de delade variablerna');
}
const baseVars = base ? declaredVars(base.code) : new Set();

/* ------------------------------------------------------------------ */
/* Kontrollera varje exempel.                                          */
/* ------------------------------------------------------------------ */
for (const { label, code } of snippets) {
  checked++;
  const { htmlPart, cssPart } = splitParts(code);
  const liveHtml = stripQuotedCode(htmlPart);

  if (cssPart && !balancedBraces(cssPart)) {
    error(label, 'obalanserade klammerblock i CSS-delen');
  }

  const imbalance = balancedTags(liveHtml);
  if (imbalance.length) {
    error(label, `obalanserade taggar i HTML-delen: ${imbalance.map(([t, d]) => `${t} ${d > 0 ? `+${d}` : d}`).join(', ')}`);
  }

  // Beroenden: körbar CSS + live HTML (style-attribut), inte citerad kod.
  const liveCode = liveHtml + '\n' + cssPart;
  const declared = declaredVars(liveCode);
  for (const { name, hasFallback } of usedVars(liveCode)) {
    if (declared.has(name) || baseVars.has(name)) continue;
    if (hasFallback) continue; // var(--x, fallback) fungerar utan deklaration
    error(label, `använder ${name} som varken deklareras i exemplet eller i grundpaketet`);
  }
}

/* ------------------------------------------------------------------ */
console.log(`0-js · kodexempel-kontroll (${checked} exempel, ${baseVars.size} basvariabler ur Grundpaketet)\n`);
if (errors.length) {
  for (const e of errors) console.error(e);
  console.error(`\n${errors.length} fel hittade.`);
  process.exit(1);
}
console.log('Alla kopierbara exempel är självförsörjande.');
