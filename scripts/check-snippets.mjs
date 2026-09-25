#!/usr/bin/env node
/**
 * check-snippets.mjs — statisk verifiering av de kopierbara kodexemplen
 * (nivå 4 i testplanen).
 *
 * Varje kodvalv i index.html består av en HTML-del och en CSS-del.
 * Skriptet avkodlar exemplen och kontrollerar:
 *
 *   - taggnästning med stack (ordning, inte bara antal) i HTML-delen
 *   - balanserade klammerblock i CSS-delen
 *   - varje var(--x) är deklarerad i exemplets egen CSS, i exemplets
 *     style-attribut, eller i grundpaketet (de delade :root-variablerna,
 *     lästa ur "Grundpaketet"-snippets egen CSS-del — basen kan därför
 *     inte glida ifrån sidan)
 *   - CSS-kommentarer räknas aldrig som körbara deklarationer
 *   - citerad dokumentationskod i <pre><code> räknas inte som körbar kod
 *
 * BEGRÄNSNINGAR — skriptet är en statisk kontroll:
 *   - Det renderar inte exemplen i en webbläsare. Att ett exempel passerar
 *     betyder inte att webbläsaren garanterat visar det rätt.
 *   - Variabelkontrollen verifierar inte CSS-kaskadens omfattning (scope,
 *     specificitet, @media); en deklaration i fel regel upptäcks inte.
 *   - En var() med fallback godkänns även utan deklaration.
 *   Isolerad browser-rendering av varje snippet är ett eget framtida
 *   delmål (nivå 4b) och påstås inte vara implementerat här.
 *
 * Kör: node scripts/check-snippets.mjs
 * Avslutar med kod 1 om något exempel inte håller måttet.
 *
 * Programmatisk användning (används av scripts/check.test.mjs):
 *   import { checkSnippets } from './check-snippets.mjs'
 *   const { errors, stats } = checkSnippets(htmlString)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TAG_RE, VOID_TAGS } from './check.mjs';

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Plocka ut alla kodvalv: etikett + avkodlat innehåll. */
export function extractSnippets(html) {
  const out = [];
  const re = /<textarea class="kod"[^>]*aria-label="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>|<textarea class="kod"[^>]*>([\s\S]*?)<\/textarea>/g;
  for (const m of html.matchAll(re)) {
    out.push({ label: m[1] || '(okänt kodvalv)', code: decodeEntities(m[2] ?? m[3] ?? '') });
  }
  return out;
}

/** Dela ett exempel i HTML- och CSS-del vid /* CSS *-markören. */
export function splitParts(code) {
  const idx = code.indexOf('/* CSS */');
  if (idx === -1) {
    const t = code.trimStart();
    return (t.startsWith('/*') || t.startsWith(':root') || t.startsWith('@'))
      ? { htmlPart: '', cssPart: code }
      : { htmlPart: code, cssPart: '' };
  }
  return { htmlPart: code.slice(0, idx), cssPart: code.slice(idx) };
}

/** Ta bort CSS-kommentarer — de är inte körbar kod. */
export function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Ta bort HTML-kommentarer. */
export function stripHtmlComments(htmlPart) {
  return htmlPart.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * <pre><code>-block i exemplens HTML-del är citerad dokumentation,
 * inte körbar kod — rensa bort dem innan vi letar beroenden och taggar.
 */
export function stripQuotedCode(htmlPart) {
  return htmlPart.replace(/<pre>[\s\S]*?<\/pre>/g, '');
}

/** Samla alla --namn som deklareras i körbar CSS (kommentarer ignorerade). */
export function declaredVars(css) {
  const found = new Set();
  const live = stripCssComments(css);
  for (const m of live.matchAll(/@property\s+(--[A-Za-z0-9-]+)/g)) found.add(m[1]);
  for (const m of live.matchAll(/(--[A-Za-z0-9-]+)\s*:/g)) found.add(m[1]);
  return found;
}

/** Samla alla var(--namn) i körbar CSS, med info om fallback finns. */
export function usedVars(css) {
  const uses = [];
  const live = stripCssComments(css);
  for (const m of live.matchAll(/var\(\s*(--[A-Za-z0-9-]+)\s*(,([^()]*|\([^()]*\))?)?\)/g)) {
    uses.push({ name: m[1], hasFallback: Boolean(m[2]) });
  }
  return uses;
}

/** Balanskontroll av klammerblock i CSS (kommentarer bortrensade). */
export function balancedBraces(css) {
  let depth = 0;
  for (const ch of stripCssComments(css)) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/**
 * Stack-baserad taggnästning för HTML-delen. Fångar fel ordning
 * (t.ex. <div><span></div></span>), inte bara obalanserat antal.
 * Returnerar en lista med felsträngar (tom = ok).
 */
export function nestedTags(htmlPart) {
  const errors = [];
  const stack = [];
  for (const m of htmlPart.matchAll(TAG_RE)) {
    const [, closing, name, , selfClosed] = m;
    const key = name.toLowerCase();
    if (VOID_TAGS.has(key) || selfClosed === '/') continue;
    if (!closing) {
      stack.push(key);
    } else if (stack.length === 0) {
      errors.push(`övertalig </${key}>`);
    } else if (stack[stack.length - 1] === key) {
      stack.pop();
    } else if (stack.includes(key)) {
      const unclosed = [];
      while (stack.length && stack[stack.length - 1] !== key) unclosed.push(stack.pop());
      stack.pop();
      errors.push(`</${key}> stänger innan ${unclosed.map((t) => `<${t}>`).join(', ')} avslutats`);
    } else {
      errors.push(`</${key}> utan matchande öppning`);
    }
  }
  for (const t of stack) errors.push(`oavslutad <${t}>`);
  return errors;
}

/** Huvudkontrollen. Returnerar { errors, stats }. */
export function checkSnippets(html) {
  const errors = [];
  const error = (name, msg) => errors.push(`✗ ${name}: ${msg}`);

  const snippets = extractSnippets(html);
  const base = snippets.find((s) => s.label.includes('Grundpaketet'));
  if (!base) error('grundpaket', 'hittar inte Grundpaketet-snippeten som definierar de delade variablerna');
  const baseVars = base ? declaredVars(splitParts(base.code).cssPart) : new Set();

  let checked = 0;
  for (const { label, code } of snippets) {
    checked++;
    const { htmlPart, cssPart } = splitParts(code);
    const liveHtml = stripHtmlComments(stripQuotedCode(htmlPart));

    // Körbar CSS = CSS-delen + style-attribut i live-HTML:en.
    let liveCss = cssPart;
    for (const sm of liveHtml.matchAll(/\bstyle="([^"]*)"/g)) liveCss += '\n' + sm[1];

    if (cssPart && !balancedBraces(cssPart)) {
      error(label, 'obalanserade klammerblock i CSS-delen');
    }

    for (const e of nestedTags(liveHtml)) {
      error(label, `felaktig HTML-nästning: ${e}`);
    }

    const declared = declaredVars(liveCss);
    for (const { name, hasFallback } of usedVars(liveCss)) {
      if (declared.has(name) || baseVars.has(name)) continue;
      if (hasFallback) continue; // var(--x, fallback) fungerar utan deklaration
      error(label, `använder ${name} som varken deklareras i exemplet eller i grundpaketet`);
    }
  }

  return { errors, stats: { checked, baseVars: baseVars.size } };
}

/* CLI ------------------------------------------------------------------ */
if (process.argv[1] && join(dirname(fileURLToPath(import.meta.url)), 'check-snippets.mjs') === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const { errors, stats } = checkSnippets(html);

  console.log(`0-js · kodexempel-kontroll (${stats.checked} exempel, ${stats.baseVars} basvariabler ur Grundpaketet)\n`);
  console.log('  Obs: statisk kontroll — ingen webbläsare-rendering, ingen scope-analys.');
  if (errors.length) {
    for (const e of errors) console.error(e);
    console.error(`\n${errors.length} fel hittade.`);
    process.exit(1);
  }
  console.log('Alla kopierbara exempel klarar de statiska kontrollerna.');
}
