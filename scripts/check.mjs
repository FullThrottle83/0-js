#!/usr/bin/env node
/**
 * check.mjs — statiska kontroller av 0-js (nivå 1 i testplanen).
 *
 * Kontrollerar det som aldrig får glida i ett skriptfritt referensprojekt:
 *   - inga <script>-element, inga javascript:-URL:er, inga inline-handlers
 *   - unika id:n och interna länkar som faktiskt pekar någonstans
 *   - varje demo-kort innehåller strukturellt exakt en stödrad och exakt
 *     ett kopierbart kodvalv, och de utlovade antalen i hero/räknare/meta
 *     stämmer med det verkliga antalet demos
 *   - ARIA-hygien (värden, roller, fokus) och att inga kontroller
 *     göms med hidden-attributet
 *   - taggnästning med stack (inte bara öppna/stängda-räkning)
 *
 * Detta är en STATISK kontroll. Den bevisar inte att något renderar rätt
 * i en webbläsare — den fångar struktur- och semantikfel tidigt.
 *
 * Kör: node scripts/check.mjs
 * Avslutar med kod 1 om något fel hittas.
 *
 * Programmatisk användning (används av scripts/check.test.mjs):
 *   import { checkDocument } from './check.mjs'
 *   const { errors, notes } = checkDocument(htmlString)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** Alla riktigt skrivna öppnings-/slut-taggar (inkl. självstängande). */
export const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'/])*?)(\/?)>/g;

export const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'source', 'track', 'wbr',
]);

/**
 * Rensa bort innehåll som inte är riktig markup innan attribut letas:
 * kodvalvens escapade exempel, <style>-blockens CSS-text, HTML-kommentarer.
 */
export function toDom(html) {
  return html
    .replace(/<textarea\b[\s\S]*?<\/textarea>/g, '<textarea></textarea>')
    .replace(/<style\b[\s\S]*?<\/style>/g, '<style></style>')
    .replace(/<!--[\s\S]*?-->/g, '');
}

/** Stack-baserad nästningskontroll. Returnerar lista med felsträngar. */
export function checkNesting(dom) {
  const errors = [];
  const stack = [];
  for (const m of dom.matchAll(TAG_RE)) {
    const [, closing, name, , selfClosed] = m;
    const key = name.toLowerCase();
    if (VOID_TAGS.has(key) || selfClosed === '/') continue;
    if (!closing) {
      stack.push(key);
    } else {
      if (stack.length === 0) {
        errors.push(`övertalig slut-tag </${key}>`);
      } else if (stack[stack.length - 1] === key) {
        stack.pop();
      } else if (stack.includes(key)) {
        // Slut-taggen matchar ett längre ned i stacken: något innan
        // den stängdes aldrig.
        const unclosed = [];
        while (stack.length && stack[stack.length - 1] !== key) {
          unclosed.push(stack.pop());
        }
        stack.pop();
        errors.push(`</${key}> stänger innan ${unclosed.map((t) => `<${t}>`).join(', ')} avslutats`);
      } else {
        errors.push(`</${key}> utan matchande öppning`);
      }
    }
  }
  for (const t of stack) errors.push(`oavslutad <${t}>`);
  return errors;
}

/** Huvudkontrollen. Returnerar { errors, notes }. */
export function checkDocument(html) {
  const errors = [];
  const notes = [];
  const error = (check, msg) => errors.push(`✗ ${check}: ${msg}`);
  const dom = toDom(html);

  /* 1. Zero-JS-löftet ------------------------------------------------ */
  {
    const scripts = (html.match(/<script[\s>]/gi) || []).length;
    if (scripts > 0) error('zero-js', `hittade ${scripts} <script>-element`);

    const jsUrls = (html.match(/href\s*=\s*"javascript:/gi) || []).length;
    if (jsUrls > 0) error('zero-js', `hittade ${jsUrls} javascript:-URL:er`);

    const handlers = dom.match(/\son(?:click|change|input|submit|reset|load|error|focus|blur|keydown|keyup|keypress|mousedown|mouseup|mouseover|mouseout|toggle|scroll|drag\w*|drop)\s*=\s*"/gi) || [];
    if (handlers.length > 0) error('zero-js', `hittade inline event handlers: ${handlers.slice(0, 5).join(', ')}`);
  }

  /* 2. Grundstruktur -------------------------------------------------- */
  {
    if (!/<html[^>]*\slang="sv"/.test(html)) error('struktur', '<html> saknar lang="sv"');
    if (!/<meta charset="utf-8">/i.test(html)) error('struktur', 'saknar <meta charset>');
    if (!/<meta name="viewport"/.test(html)) error('struktur', 'saknar viewport-meta');
    if (!/<title>[^<]+<\/title>/.test(html)) error('struktur', 'saknar <title>');
  }

  /* 3. Unika id:n och interna länkar ---------------------------------- */
  {
    const ids = [];
    const links = [];
    for (const m of dom.matchAll(TAG_RE)) {
      const [tagStr, closing, name, attrs] = m;
      if (closing) continue;
      for (const im of attrs.matchAll(/\bid="([^"]+)"/g)) ids.push(im[1]);
      if (name === 'a') {
        const href = attrs.match(/\bhref="([^"]*)"/);
        if (href && href[1].startsWith('#') && href[1].length > 1) {
          links.push(href[1].slice(1));
        }
      }
    }

    const seen = new Map();
    for (const id of ids) seen.set(id, (seen.get(id) || 0) + 1);
    const dupes = [...seen].filter(([, n]) => n > 1);
    if (dupes.length) error('id', `dubblerade id:n: ${dupes.map(([id, n]) => `${id} ×${n}`).join(', ')}`);

    const idSet = new Set(ids);
    const missing = [...new Set(links.filter((frag) => !idSet.has(frag)))];
    if (missing.length) error('länkar', `interna länkar utan mål: ${missing.map((f) => `#${f}`).join(', ')}`);
    notes.push(`${ids.length} id:n, ${idSet.size} unika`);
  }

  /* 4. Demo-kort: struktur och utlovade antal -------------------------- */
  {
    // Varje <article class="demo…"> skärs ut och måste innehålla exakt
    // en stödrad och exakt ett kodvalv — strukturellt, inte bara i antal.
    const articles = [...dom.matchAll(/<article class="demo[\s"][^>]*>/g)];
    const demoCount = articles.length;
    if (demoCount === 0) error('demos', 'hittade inga demo-kort');

    let structFail = 0;
    for (let i = 0; i < articles.length; i++) {
      const start = articles[i].index;
      const end = i + 1 < articles.length ? articles[i + 1].index : dom.length;
      const slice = dom.slice(start, end);
      const stodrad = (slice.match(/<ul class="stodrad"/g) || []).length;
      const valv = (slice.match(/<details class="kod-valv">/g) || []).length;
      if (stodrad !== 1 || valv !== 1) {
        const id = slice.match(/\bid="([^"]+)"/);
        error('demos', `kortet ${id ? `#${id[1]}` : `nr ${i + 1}`} har ${stodrad} stödrader och ${valv} kodvalv (ska vara 1 av varje)`);
        structFail++;
      }
    }
    if (structFail === 0 && demoCount > 0) {
      notes.push(`${demoCount} demos, alla med exakt en stödrad och ett kodvalv`);
    }

    const claims = [
      ['hero', new RegExp(`<b>${demoCount}</b> tekniker`)],
      ['räknare', new RegExp(`av ${demoCount} tekniker`)],
      ['meta description', new RegExp(`${demoCount} demos`)],
    ];
    for (const [where, re] of claims) {
      if (!re.test(html)) error('demos', `${where} anger inte det verkliga antalet (${demoCount}) demos`);
    }
  }

  /* 5. ARIA-hygien ---------------------------------------------------- */
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
      if (/\shidden[\s>/]/.test(m[0]) || /\shidden$/.test(m[0])) {
        error('aria', `kontroll gömd med hidden-attributet: ${m[0].slice(0, 90)}`);
      }
    }

    // Kodvalvens textareas ska ha namngivna etiketter för skärmläsare.
    const kodvalv = dom.match(/<textarea class="kod"[^>]*>/g) || [];
    const unnamed = kodvalv.filter((t) => !/aria-label="[^"]+"/.test(t));
    if (unnamed.length) error('aria', `${unnamed.length} kod-textareas saknar aria-label`);
  }

  /* 6. Taggnästning ---------------------------------------------------- */
  {
    for (const e of checkNesting(dom)) error('taggar', e);
  }

  return { errors, notes };
}

/* CLI ------------------------------------------------------------------ */
if (process.argv[1] && join(dirname(fileURLToPath(import.meta.url)), 'check.mjs') === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const { errors, notes } = checkDocument(html);

  console.log('0-js · statiska kontroller\n');
  for (const n of notes) console.log(`  · ${n}`);
  console.log('');
  if (errors.length) {
    for (const e of errors) console.error(e);
    console.error(`\n${errors.length} fel hittade.`);
    process.exit(1);
  }
  console.log('Alla kontroller gröna.');
}
