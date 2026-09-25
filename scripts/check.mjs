#!/usr/bin/env node
/**
 * check.mjs — statiska kontroller av 0-js (nivå 1 i testplanen).
 *
 * Kontrollerar det som aldrig får glida i ett skriptfritt referensprojekt:
 *   - inga <script>-element, inga javascript:-URL:er, inga inline-handlers
 *   - unika id:n och interna länkar som faktiskt pekar någonstans
 *   - antal demos kontra de antal som utlovas i hero, räknare och meta
 *   - varje demo har stödrad och kopierbart kodvalv
 *   - ARIA-hygien (värden, roller, fokus) och att inga kontroller
 *     göms med hidden-attributet
 *
 * Kör: node scripts/check.mjs
 * Avslutar med kod 1 om något fel hittas.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

const errors = [];
const notes = [];

function error(check, msg) {
  errors.push(`✗ ${check}: ${msg}`);
}

/**
 * DOM-nivå: rensa bort sådant som inte är riktig markup innan vi letar
 * attribut — kodvalvens escapade exempel, <style>-blockens CSS-text och
 * HTML-kommentarer.
 */
const dom = html
  .replace(/<textarea\b[\s\S]*?<\/textarea>/g, '<textarea></textarea>')
  .replace(/<style\b[\s\S]*?<\/style>/g, '<style></style>')
  .replace(/<!--[\s\S]*?-->/g, '');

/** Alla riktigt skrivna öppnings-/slut-taggar (inkl. självstängande). */
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'/])*?)(\/?)>/g;

/* ------------------------------------------------------------------ */
/* 1. Zero-JS-löftet                                                  */
/* ------------------------------------------------------------------ */
{
  const scripts = (html.match(/<script[\s>]/gi) || []).length;
  if (scripts > 0) error('zero-js', `hittade ${scripts} <script>-element`);

  const jsUrls = (html.match(/href\s*=\s*"javascript:/gi) || []).length;
  if (jsUrls > 0) error('zero-js', `hittade ${jsUrls} javascript:-URL:er`);

  // Inline event handlers, t.ex. onclick="…".
  const handlers = dom.match(/\son(?:click|change|input|submit|reset|load|error|focus|blur|keydown|keyup|keypress|mousedown|mouseup|mouseover|mouseout|toggle|scroll|drag\w*|drop)\s*=\s*"/gi) || [];
  if (handlers.length > 0) error('zero-js', `hittade inline event handlers: ${handlers.slice(0, 5).join(', ')}`);
}

/* ------------------------------------------------------------------ */
/* 2. Grundstruktur                                                    */
/* ------------------------------------------------------------------ */
{
  if (!/<html[^>]*\slang="sv"/.test(html)) error('struktur', '<html> saknar lang="sv"');
  if (!/<meta charset="utf-8">/i.test(html)) error('struktur', 'saknar <meta charset>');
  if (!/<meta name="viewport"/.test(html)) error('struktur', 'saknar viewport-meta');
  if (!/<title>[^<]+<\/title>/.test(html)) error('struktur', 'saknar <title>');
}

/* ------------------------------------------------------------------ */
/* 3. Unika id:n och interna länkar                                    */
/* ------------------------------------------------------------------ */
{
  const ids = [];
  const broken = [];
  for (const m of dom.matchAll(TAG_RE)) {
    const [tagStr, closing, name, attrs, selfClosed] = m;
    if (closing) continue;
    const idMatches = [...attrs.matchAll(/\bid="([^"]+)"/g)];
    for (const im of idMatches) ids.push(im[1]);
    if (/^a$/i.test(name) && selfClosed !== '/') {
      const href = attrs.match(/\bhref="([^"]*)"/);
      if (href && href[1].startsWith('#') && href[1].length > 1) {
        broken.push({ frag: href[1].slice(1), tag: tagStr.slice(0, 80) });
      }
    }
  }

  const seen = new Map();
  for (const id of ids) seen.set(id, (seen.get(id) || 0) + 1);
  const dupes = [...seen].filter(([, n]) => n > 1);
  if (dupes.length) error('id', `dubblerade id:n: ${dupes.map(([id, n]) => `${id} ×${n}`).join(', ')}`);

  const idSet = new Set(ids);
  const missing = [...new Set(broken.filter((b) => !idSet.has(b.frag)).map((b) => `#${b.frag}`))];
  if (missing.length) error('länkar', `interna länkar utan mål: ${missing.join(', ')}`);
  notes.push(`${ids.length} id:n, ${idSet.size} unika`);
}

/* ------------------------------------------------------------------ */
/* 4. Antal demos kontra utlovade antal                                */
/* ------------------------------------------------------------------ */
{
  const demoCount = (dom.match(/<article class="demo[\s"]/g) || []).length;
  if (demoCount === 0) error('demos', 'hittade inga demo-kort');

  const claims = [
    ['hero', new RegExp(`<b>${demoCount}</b> tekniker`)],
    ['räknare', new RegExp(`av ${demoCount} tekniker`)],
    ['meta description', new RegExp(`${demoCount} demos`)],
  ];
  for (const [where, re] of claims) {
    if (!re.test(html)) error('demos', `${where} anger inte det verkliga antalet (${demoCount}) demos`);
  }

  const valvCount = (dom.match(/<details class="kod-valv">/g) || []).length;
  if (valvCount !== demoCount) error('demos', `${demoCount} demos men ${valvCount} kodvalv — varje demo ska ha exakt ett kopierbart exempel`);

  const stodradCount = (dom.match(/<ul class="stodrad"/g) || []).length;
  if (stodradCount !== demoCount) error('demos', `${demoCount} demos men ${stodradCount} stödrader`);

  notes.push(`${demoCount} demos, ${valvCount} kodvalv, ${stodradCount} stödrader`);
}

/* ------------------------------------------------------------------ */
/* 5. ARIA-hygien                                                      */
/* ------------------------------------------------------------------ */
{
  // En slider/scrollbar som anger min/max måste också ange sitt värde.
  for (const m of dom.matchAll(/<[a-zA-Z][a-zA-Z0-9-]*[^>]*role="(slider|scrollbar)"[^>]*>/g)) {
    const tag = m[0];
    if (/aria-valuemin|aria-valuemax/.test(tag) && !/aria-valuenow/.test(tag)) {
      error('aria', `role="${m[1]}" anger värdegränser men inget aria-valuenow: ${tag.slice(0, 90)}…`);
    }
  }

  // Interaktiva roller kräver något fokusbart (tabindex eller native-element).
  const nativeFocusable = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary']);
  for (const m of dom.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)[^>]*\srole="(button|checkbox|radio|switch|tab|menuitem)"[^>]*>/g)) {
    const [, name, role] = m;
    if (nativeFocusable.has(name.toLowerCase())) continue;
    if (!/tabindex="0"/.test(m[0])) {
      error('aria', `role="${role}" på <${name}> utan tabindex: ${m[0].slice(0, 90)}…`);
    }
  }

  // Formulärkontroller får inte gömmas med hidden — det tar bort dem
  // från tab-ordningen (tidigare bugg i mobilmenyn).
  for (const m of dom.matchAll(/<(input|select|textarea|button)\b[^>]*>/g)) {
    if (/\shidden[\s>]/.test(m[0]) || /\shidden$/.test(m[0])) {
      error('aria', `kontroll gömd med hidden-attributet: ${m[0].slice(0, 90)}`);
    }
  }

  // Kodvalvens textareas ska ha namngivna etiketter för skärmläsare.
  const kodvalv = (dom.match(/<textarea class="kod"[^>]*>/g) || []);
  const unnamed = kodvalv.filter((t) => !/aria-label="[^"]+"/.test(t));
  if (unnamed.length) error('aria', `${unnamed.length} kod-textareas saknar aria-label`);
}

/* ------------------------------------------------------------------ */
/* 6. Taggbalans                                                       */
/* ------------------------------------------------------------------ */
{
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const depth = new Map();
  for (const m of dom.matchAll(TAG_RE)) {
    const [, closing, name, , selfClosed] = m;
    const key = name.toLowerCase();
    if (voidTags.has(key) || selfClosed === '/') continue;
    depth.set(key, (depth.get(key) || 0) + (closing ? -1 : 1));
  }
  for (const [tag, d] of depth) {
    if (d !== 0) {
      error('taggar', `obalans i <${tag}>: ${d > 0 ? `${d} oavslutade` : `${-d} övertaliga slut-taggar`}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Resultat                                                            */
/* ------------------------------------------------------------------ */
console.log('0-js · statiska kontroller\n');
for (const n of notes) console.log(`  · ${n}`);
console.log('');
if (errors.length) {
  for (const e of errors) console.error(e);
  console.error(`\n${errors.length} fel hittade.`);
  process.exit(1);
}
console.log('Alla kontroller gröna.');
