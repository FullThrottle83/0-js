#!/usr/bin/env node
/**
 * tests/demo-parity.mjs — Nivå 4c: MÄTT webbläsarekvivalens mot en
 * pre-migrerings-baslinje.
 *
 * Skillnaden mot de statiska kontrollerna är hela poängen:
 *
 *   scripts/build.test.mjs  bevisar att index.html är HÄRLETT ur källorna
 *                           (determinism, härledning, stale-detektering).
 *   tests/demo-source.mjs   bevisar att demot BETER SIG som avsett på sidan
 *                           och fristående (Grundpaketet + kodvalv).
 *   tests/demo-parity.mjs   bevisar att det som faktiskt RENDERAS är
 *                           oförändrat jämfört med före migreringen:
 *                           DOM, text, attribut, geometri, beräknade stilar
 *                           och pseudoelement — i standardtillståndet och i
 *                           varje interaktivt tillstånd.
 *
 * Ingen av dem ersätter de andra. Ett statiskt test kan inte se att en regel
 * hamnat i fel kaskadordning; en mätning kan inte se att källan slutat vara
 * källan.
 *
 * Användning:
 *   node tests/demo-parity.mjs                 jämför index.html mot baslinjen
 *   node tests/demo-parity.mjs --capture       skriv baslinjen ur NUVARANDE
 *                                              dokument — körs FÖRE en
 *                                              migrering och committas.
 *                                              Med --merge (och --demo <id>)
 *                                              läggs bara de valda demos till i
 *                                              en befintlig baslinje; de övriga
 *                                              posterna lämnas orörda
 *   node tests/demo-parity.mjs --strict        kräv samma Chromium-bygge och
 *                                              noll geometriavvikelse
 *   node tests/demo-parity.mjs --require-same-browser
 *                                              fäll om aktuell webbläsare inte
 *                                              är baslinjens bygge
 *   node tests/demo-parity.mjs --document <fil>  annat dokument än index.html
 *   node tests/demo-parity.mjs --demo <id>       bara en demo (används med
 *                                              --capture --merge för att lägga
 *                                              nya demos till en befintlig
 *                                              baslinje utan att röra de andra)
 *   node tests/demo-parity.mjs --shots <katalog>  spara skärmbilder (bevis,
 *                                              committas inte)
 *
 * Baslinjen ligger i tests/baseline/demos.json och innehåller bara
 * mätvärden (ingen HTML, inga bilder). Den fångas med samma webbläsare,
 * viewport och typsnitt som jämförelsen — typsnitten är inbäddade i
 * dokumentet, så texten är densamma i varje miljö. I baslinjen sparas
 * sha256 för det dokument den fångades ur, så att ursprunget kan granskas
 * (t.ex. mot en commit i git-historiken).
 *
 * Vilka lager som är grind beror på om webbläsarbygget är detsamma som
 * baslinjens:
 *
 *   samma bygge    struktur, stilar och (med --strict) geometri jämförs exakt.
 *                  Noll avvikelse är kravet; det är läget för migreringsbeviset.
 *   annat bygge    strukturen (DOM-ordning, text, attribut, fältvärden) jämförs
 *                  exakt och fäller; stilar och geometri RAPPORTERAS, eftersom
 *                  en nyare webbläsare kan stödja fler funktioner (if(),
 *                  calc-size(), appearance: base-select) och därmed rendera
 *                  annat. CI kör så — samma grind där kräver samma bygge
 *                  (--require-same-browser).
 *
 * Två klasser av mätvärden:
 *   struktur  DOM-ordning, text, attribut, fältvärden och icke-geometriska
 *             beräknade stilar (färger, display, position, typsnitt, masker,
 *             animationer, ::before/::after-content). Dessa är miljöoberoende
 *             och jämförs EXAKT — en ändrad deklaration fäller testet.
 *   geometri  rektanglar och px-längder. Textmetrik kan skilja sig mellan
 *             Linux-byggen av samma Chromium (hinting, fontconfig), så
 *             avvikelser mäts och RAPPORTERAS: inom max(2 px, 2 %) som
 *             "inom tolerans", utanför som varning. `--strict`
 *             (eller --geometry-strict) gör även geometrin till ett krav —
 *             det är läget som används för migreringsbeviset, i en och samma
 *             webbläsarinstans (se docs/demo-kalla.md §6).
 *
 * Kräver webbläsare (Playwright/Chromium):
 *   npm install && npx playwright install chromium
 *   CHROMIUM_PATH=/sökväg/chromium node tests/demo-parity.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, dirname, join } from 'node:path';
import { MIGRATED_IDS } from '../scripts/demo-spec.mjs';
import { scenariosFor } from './demo-scenarios.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(root, 'tests/baseline/demos.json');

/** Största px-avvikelse ur en lista med geometrirapporter, för sammanfattningen. */
function maxDeviation(notes) {
  let best = null;
  for (const n of notes) {
    const m = n.match(/\((\d+\.\d+) px/);
    if (m && (!best || Number(m[1]) > best.px)) best = { px: Number(m[1]), note: n };
  }
  return best ? `${best.px} px (${best.note.split(':')[0]})` : '(okänd)';
}

/** Absolut + relativt slack för geometri (px-längder och rektanglar). */
export const GEOMETRI_SLACK_PX = 2;
export const GEOMETRI_SLACK_REL = 0.02;

/** Egenskapsnamn vars värden är längder (px) och därför jämförs som geometri. */
const LENGTH_PROPS = new Set([
  'width', 'height', 'padding', 'margin', 'border-top-width', 'border-radius', 'letter-spacing',
  'line-height', 'gap', 'grid-template-columns', 'grid-template-rows', 'top', 'left', 'inset',
]);

/** Egenskaper som mäts på varje element i demots markup. */
const STYLE_PROPS = [
  'display', 'position', 'width', 'height', 'padding', 'margin', 'border-top-width', 'border-radius',
  'background-color', 'background-image', 'color', 'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'letter-spacing', 'text-align', 'text-wrap', 'writing-mode', 'text-orientation',
  'grid-template-columns', 'grid-template-rows', 'gap', 'flex-direction', 'justify-content', 'align-items',
  'overflow', 'opacity', 'transform', 'box-shadow', 'mask-image', '-webkit-mask-image', 'appearance',
  'accent-color', 'caret-color', 'caret-shape', 'color-scheme', 'shape-outside', 'clip-path', 'float',
  'pointer-events', 'cursor', 'aspect-ratio', 'animation-name', 'transition-property', 'visibility',
];

/** Egenskaper som mäts på ::before och ::after. */
const PSEUDO_PROPS = [
  'content', 'display', 'position', 'width', 'height', 'margin', 'padding', 'background-color', 'color',
  'border-radius', 'transform', 'transition-property', 'mask-image', '-webkit-mask-image', 'top', 'left',
];

/** Mätning som körs i sidan: returnerar ett serialiserbart ögonblicksvärde. */
function snapshotInPage({ id, styleProps, pseudoProps }) {
  const rootEl = document.getElementById(id) ?? document.body;
  const demo = id ? rootEl.querySelector('.demo-yta') ?? rootEl : rootEl;
  const demoRect = demo.getBoundingClientRect();

  const path = (el) => {
    const parts = [];
    for (let cur = el; cur && cur !== demo.parentElement; cur = cur.parentElement) {
      const parent = cur.parentElement;
      if (!parent) break;
      parts.unshift(`${cur.tagName.toLowerCase()}:nth-child(${[...parent.children].indexOf(cur) + 1})`);
    }
    return parts.join('>');
  };

  const round = (n) => Math.round(n * 100) / 100;
  const readStyle = (el, el2, props) => {
    const cs = getComputedStyle(el, el2);
    const out = {};
    for (const p of props) out[p] = cs.getPropertyValue(p);
    return out;
  };

  const elements = [demo, ...demo.querySelectorAll('*')].map((el) => {
    const rect = el.getBoundingClientRect();
    // <option>/<optgroup> ritas av webbläsarens egen popup (base-select) och
    // har ingen sidlayout att mäta — geometrin hoppas över, strukturen mäts.
    const inPopup = Boolean(el.closest('select'));
    const rec = {
      path: path(el),
      tag: el.tagName.toLowerCase(),
      class: el.getAttribute('class') ?? '',
      id: el.getAttribute('id') ?? '',
      text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
      rect: inPopup ? null : { x: round(rect.x - demoRect.x), y: round(rect.y - demoRect.y), w: round(rect.width), h: round(rect.height) },
      style: readStyle(el, null, styleProps),
      before: readStyle(el, '::before', pseudoProps),
      after: readStyle(el, '::after', pseudoProps),
    };
    // Attribut som påverkar renderingen och som måste överleva migreringen.
    for (const name of ['href', 'type', 'value', 'placeholder', 'aria-label', 'role', 'checked', 'open', 'style']) {
      if (el.hasAttribute(name)) rec[`@${name}`] = el.getAttribute(name);
    }
    return rec;
  });

  return {
    elements,
    controls: [...demo.querySelectorAll('input, select, details, textarea')].map((el) => ({
      tag: el.tagName.toLowerCase(),
      value: el.value ?? '',
      checked: el.checked ?? null,
      open: el.open ?? null,
      validity: el.validity ? { valid: el.validity.valid, patternMismatch: el.validity.patternMismatch } : null,
    })),
    html: demo.innerHTML.replace(/\s+/g, ' ').trim(),
  };
}

/** Mät ett demo i ett givet tillstånd; ostabila värden filtreras bort. */
async function measure(page, id, state) {
  const first = await page.evaluate(snapshotInPage, { id, styleProps: STYLE_PROPS, pseudoProps: PSEUDO_PROPS });
  await page.waitForTimeout(state ? 700 : 250);
  const second = await page.evaluate(snapshotInPage, { id, styleProps: STYLE_PROPS, pseudoProps: PSEUDO_PROPS });

  // Värden som ändrar sig mellan två läsningar (pågående animation/transition)
  // är inte mätbara påståenden — de tas bort och rapporteras, inte jämförs.
  const unstable = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (let i = 0; i < first.elements.length; i++) {
    const a = first.elements[i];
    const b = second.elements[i];
    for (const group of ['style', 'before', 'after']) {
      for (const key of Object.keys(a[group])) {
        if (!same(a[group][key], b[group][key])) {
          unstable.push(`${a.path} ${group === 'style' ? '' : group + ' '}${key}`);
          delete a[group][key];
        }
      }
    }
    if (!same(a.rect, b.rect)) {
      unstable.push(`${a.path} rect`);
      a.rect = null;
    }
  }
  return { ...first, unstable: [...new Set(unstable)].sort() };
}

/**
 * Jämför två mätvärden.
 * Returnerar { hard, soft, compared }: strukturella avvikelser (fäller),
 * geometriska avvikelser inom slacket (rapporteras) och antalet jämförda värden.
 *
 * Värden som mätningen själv markerat som ostabila (pågående animering) är
 * inte påståenden och hoppas över i båda riktningarna.
 */
export function diffMeasurements(a, b, pathName = '', { strict = false, geometryStrict = false, styleStrict = true } = {}) {
  const hard = [];
  const soft = [];
  const geometry = [];
  const reported = [];
  let compared = 0;
  const isPx = (v) => typeof v === 'string' && /^-?\d+(\.\d+)?px$/.test(v);
  const num = (v) => Number.parseFloat(v);
  const slack = (x, y) => (strict ? 0 : Math.max(GEOMETRI_SLACK_PX, GEOMETRI_SLACK_REL * Math.max(Math.abs(x), Math.abs(y))));
  const unstableIn = (m, path, group, key) =>
    new Set(m.unstable ?? []).has(`${path} ${group === 'style' ? '' : `${group} `}${key}`) ||
    new Set(m.unstable ?? []).has(`${path} rect`);

  /** Geometri: samma värde, eller inom slacket. */
  const compareNumber = (x, y, where) => {
    compared++;
    const allowed = slack(x, y);
    const delta = Math.abs(x - y);
    if (delta === 0) return;
    if (delta <= allowed) soft.push(`${where}: ${x} → ${y} (${delta.toFixed(2)} px inom toleransen ${allowed.toFixed(2)} px)`);
    else {
      const note = `${where}: ${x} → ${y} (${delta.toFixed(2)} px utanför toleransen ${allowed.toFixed(2)} px)`;
      // Textmetrik skiljer mellan Linux-byggen av samma Chromium. Geometrin
      // mäts därför alltid och rapporteras; den fäller bara i --strict-läget,
      // där beviset gäller en och samma webbläsarinstans (se docs §6).
      if (geometryStrict) hard.push(note); else geometry.push(note);
    }
  };

  // `soft` = värdet jämförs men får avvika (annat webbläsarbygge); det hamnar
  // då i `reported` i stället för `hard`. Strukturen går alltid med soft=false.
  const walk = (x, y, where, geometric, soft = false) => {
    const record = (msg) => (soft ? reported : hard).push(msg);
    if (x === null || y === null) {
      compared++;
      if (x !== y) record(`${where}: ${JSON.stringify(x)} → ${JSON.stringify(y)}`);
      return;
    }
    if (typeof x === 'number' && typeof y === 'number') {
      if (geometric) compareNumber(x, y, where);
      else { compared++; if (x !== y) record(`${where}: ${x} → ${y}`); }
      return;
    }
    if (isPx(x) && isPx(y)) {
      if (geometric) compareNumber(num(x), num(y), where);
      else { compared++; if (x !== y) record(`${where}: ${x} → ${y}`); }
      return;
    }
    if (Array.isArray(x) || Array.isArray(y)) {
      if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) {
        compared++;
        record(`${where}: olika antal (${JSON.stringify(x).slice(0, 60)} → ${JSON.stringify(y).slice(0, 60)})`);
        return;
      }
      for (let i = 0; i < x.length; i++) walk(x[i], y[i], `${where}[${i}]`, geometric, soft);
      return;
    }
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      const isRect = Object.hasOwn(x, 'w') && Object.hasOwn(x, 'h');
      for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
        if (!(key in x)) { compared++; record(`${where}.${key}: saknades i baslinjen, finns nu (${JSON.stringify(y[key]).slice(0, 60)})`); continue; }
        if (!(key in y)) { compared++; record(`${where}.${key}: fanns i baslinjen (${JSON.stringify(x[key]).slice(0, 60)}), saknas nu`); continue; }
        walk(x[key], y[key], `${where}.${key}`, geometric || isRect, soft);
      }
      return;
    }
    compared++;
    if (x !== y) record(`${where}: ${JSON.stringify(x)} → ${JSON.stringify(y)}`);
  };

  /* 1. Strukturen: elementföljd, text, attribut, fältvärden — exakt. */
  const rest = (m) => Object.fromEntries(Object.entries(m)
    .filter(([k]) => k !== 'unstable')
    .map(([k, v]) => [k, k === 'elements' ? v.map(({ style, before, after, rect, ...r }) => r) : v]));
  walk(rest(a), rest(b), pathName, false);

  /* 2. Stilarna: textberoende längder är geometri, allt annat exakt. */
  for (let i = 0; i < Math.min(a.elements.length, b.elements.length); i++) {
    const path = a.elements[i]?.path ?? '';
    for (const group of ['style', 'before', 'after']) {
      const ga = a.elements[i][group] ?? {};
      const gb = b.elements[i][group] ?? {};
      for (const key of new Set([...Object.keys(ga), ...Object.keys(gb)])) {
        const where = `${pathName}.elements[${i}].${group === 'style' ? '' : `${group}.`}${key}`;
        if (!(key in ga) || !(key in gb)) {
          if (unstableIn(a, path, group, key) || unstableIn(b, path, group, key)) continue;
          compared++;
          const msg = `${where}: ${key in ga ? `fanns i baslinjen (${JSON.stringify(ga[key]).slice(0, 50)}), saknas nu` : `mäts nu (${JSON.stringify(gb[key]).slice(0, 50)}), saknades i baslinjen`}`;
          (styleStrict ? hard : reported).push(msg);
          continue;
        }
        const geometric = LENGTH_PROPS.has(key) || group !== 'style';
        walk(ga[key], gb[key], where, geometric, !styleStrict);
      }
    }
    const ra = a.elements[i].rect;
    const rb = b.elements[i].rect;
    if (ra && rb) walk(ra, rb, `${pathName}.elements[${i}].rect`, true);
    else if ((ra === null) !== (rb === null)) {
      if (!unstableIn(a, path, 'rect', 'rect')) {
        compared++;
        (styleStrict ? hard : reported).push(`${pathName}.elements[${i}].rect: ${ra ? 'mäts nu inte längre' : 'mäts nu (saknades i baslinjen)'}`);
      }
    }
  }

  return { hard, soft, geometry, reported, compared };
}

async function main() {
  const args = process.argv.slice(2);
  const capture = args.includes('--capture');
  const merge = args.includes('--merge');
  const shotsIdx = args.includes('--shots') ? args.indexOf('--shots') : -1;
  const shotsDir = shotsIdx === -1 ? null : args[shotsIdx + 1];
  const strict = args.includes('--strict');
  const geometryStrict = strict || args.includes('--geometry-strict');
  const requireSameBrowser = args.includes('--require-same-browser');
  const documentIdx = args.includes('--document') ? args.indexOf('--document') : -1;
  const documentPath = documentIdx === -1 ? join(root, 'index.html') : args[documentIdx + 1];
  const demoIdx = args.includes('--demo') ? args.indexOf('--demo') : -1;
  const only = demoIdx === -1 ? null : args[demoIdx + 1];

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('Kunde inte läsa in playwright. Kör först: npm install && npx playwright install chromium');
    process.exit(1);
  }
  const launch = { headless: true };
  if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
  if (process.env.CHROMIUM_ARGS) launch.args = process.env.CHROMIUM_ARGS.split(/\s+/).filter(Boolean);

  const ids = only ? MIGRATED_IDS.filter((id) => id === only) : MIGRATED_IDS;
  if (only && ids.length === 0) {
    console.error(`✗ ${only} är inte registrerad i scripts/demo-spec.mjs`);
    process.exit(1);
  }
  if (shotsDir) mkdirSync(shotsDir, { recursive: true });

  const url = pathToFileURL(documentPath).href;
  const documentBytes = readFileSync(documentPath);
  const documentSha256 = createHash('sha256').update(documentBytes).digest('hex');
  const browser = await chromium.launch(launch);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const version = await browser.version();

  const measured = {};
  for (const id of ids) {
    const states = [{ name: null, apply: null }, ...scenariosFor(id)];
    measured[id] = {};
    for (const state of states) {
      await page.goto('about:blank');
      await page.goto(`${url}#${id}`);
      await page.evaluate(() => document.fonts.ready);
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      if (state.apply) {
        await state.apply({ page, root: page.locator(`#${id} .demo-yta`), card: page.locator(`#${id}`) });
        await page.waitForTimeout(450);
      }
      measured[id][state.name ?? 'default'] = await measure(page, id, state.name);
      if (shotsDir) {
        await page.locator(`#${id} .demo-yta`).screenshot({ path: join(shotsDir, `${id}${state.name ? '.' + state.name : ''}.png`), animations: 'disabled' });
      }
    }
  }
  await browser.close();

  if (capture) {
    const payload = {
      _readme: [
        'Mätbaslinje för tests/demo-parity.mjs. Fångad FÖRE migreringen av de demos som listas i scripts/demo-spec.mjs.',
        'Innehåller DOM-ordning, text, attribut, geometri (relativt .demo-yta), beräknade stilar och pseudoelement i',
        `standardtillståndet och i varje interaktivt tillstånd. Struktur, text, attribut och icke-geometriska stilar`,
        `jämförs exakt; längder och rektanglar med max(${GEOMETRI_SLACK_PX} px, ${GEOMETRI_SLACK_REL * 100} %) slack (--strict: 0).`,
        'Uppdatera aldrig filen efter en migrering utan att först ha verifierat att renderingen är oförändrad.',
      ],
      chromium: version,
      viewport: { width: 1280, height: 900 },
      capturedAt: new Date().toISOString().slice(0, 10),
      document: documentPath === join(root, 'index.html') ? 'index.html' : `(extern fil) ${basename(documentPath)}`,
      documentSha256,
      demos: measured,
    };
    // --merge: lägg bara de valda demos till i en BEFINTLIG baslinje. De
    // poster som redan finns lämnas orörda — en historisk baslinje ska inte
    // skrivas om för att dölja vad en senare migration ändrat. Varje
    // sammanslagning loggas i mergeLog, så att en post med ett annat
    // ursprungsdokument än toppnivåns hash går att spåra.
    if (merge && existsSync(BASELINE)) {
      const existing = JSON.parse(readFileSync(BASELINE, 'utf8'));
      if (existing.chromium !== version) {
        console.error(`✗ --merge kräver samma Chromium-bygge som baslinjen (${existing.chromium} ≠ ${version}).`);
        process.exit(1);
      }
      const before = Object.keys(existing.demos).sort().join(',');
      existing.demos = { ...existing.demos, ...measured };
      const after = Object.keys(existing.demos).sort().join(',');
      existing.mergeLog = [...(existing.mergeLog ?? []), {
        capturedAt: payload.capturedAt,
        chromium: version,
        document: payload.document,
        documentSha256,
        added: Object.keys(measured).sort(),
      }];
      writeFileSync(BASELINE, JSON.stringify(existing, null, 1) + '\n');
      console.log('Baslinje sammanslagen: tests/baseline/demos.json');
      console.log(`  före: ${before}`);
      console.log(`  efter: ${after}`);
      console.log(`  tillagt ur ${payload.document} (sha256 ${documentSha256.slice(0, 8)}…): ${Object.keys(measured).sort().join(', ')}`);
      return;
    }
    mkdirSync(dirname(BASELINE), { recursive: true });
    writeFileSync(BASELINE, JSON.stringify(payload, null, 1) + '\n');
    console.log(`Baslinje skriven: tests/baseline/demos.json (${ids.length} demos, Chromium ${version})`);
    return;
  }

  if (!existsSync(BASELINE)) {
    console.error('✗ tests/baseline/demos.json saknas. Fånga den först: node tests/demo-parity.mjs --capture');
    process.exit(1);
  }
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const sameBrowser = baseline.chromium === version;
  const styleStrict = sameBrowser;
  console.log(`Chromium: ${version} (baslinje: ${baseline.chromium}, ${baseline.capturedAt})`);
  console.log(`Dokument: ${documentPath === join(root, 'index.html') ? 'index.html' : documentPath}`);
  if (baseline.documentSha256) {
    const sameDoc = baseline.documentSha256 === documentSha256;
    console.log(`Baslinjens dokument-hash: ${baseline.documentSha256}`);
    console.log(`Aktuellt dokuments hash:  ${documentSha256}${sameDoc ? ' (identiskt)' : ' (ändrat av migreringen — det är det testet mäter)'}`);
  }
  if (!sameBrowser) {
    console.warn(`⚠ Webbläsarbygget skiljer sig från baslinjens (${version} mot ${baseline.chromium}).`);
    console.warn('  Struktur, text, attribut och fältvärden jämförs exakt och fäller.');
    console.warn('  Stilar och geometri RAPPORTERAS — ett nyare bygge kan stödja fler funktioner och rendera annat.');
    console.warn('  Fullständig grind kräver baslinjens bygge: node tests/demo-parity.mjs --require-same-browser\n');
  }
  console.log(`Läge: ${strict ? 'strikt (0 px slack)' : `geometri inom max(${GEOMETRI_SLACK_PX} px, ${GEOMETRI_SLACK_REL * 100} %)`}${sameBrowser ? '' : ' · annat webbläsarbygge (stilar rapporteras)'}\n`);

  let failures = 0;
  let compared = 0;
  const valuesWithinTolerance = [];
  const valuesOutsideTolerance = [];
  const valuesReported = [];
  const verbose = process.argv.includes('--verbose');
  const missing = ids.filter((id) => !baseline.demos[id]);
  for (const id of missing) {
    console.error(`✗ ${id}: saknas i baslinjen — kör --capture på pre-migrerings-dokumentet`);
    failures++;
  }
  for (const id of ids.filter((i) => baseline.demos[i])) {
    const states = Object.keys(baseline.demos[id]);
    const problems = [];
    const softNotes = [];
    const geometryNotes = [];
    const reportedNotes = [];
    for (const state of states) {
      const current = measured[id][state];
      if (!current) { problems.push(`tillståndet "${state}" mäts inte längre`); continue; }
      const diff = diffMeasurements(baseline.demos[id][state], current, state === 'default' ? id : `${id}[${state}]`, { strict, geometryStrict, styleStrict });
      compared += diff.compared;
      problems.push(...diff.hard);
      softNotes.push(...diff.soft);
      geometryNotes.push(...diff.geometry);
      reportedNotes.push(...diff.reported);
    }
    for (const s of softNotes) valuesWithinTolerance.push(s);
    for (const r of reportedNotes) valuesReported.push(r);
    for (const state of Object.keys(measured[id])) {
      if (!(state in baseline.demos[id])) {
        problems.push(`nytt tillstånd "${state}" saknas i baslinjen — fånga baslinjen från pre-migrerings-dokumentet`);
      }
    }
    if (problems.length) {
      failures++;
      console.error(`✗ ${id}: ${problems.length} avvikelse(r) mot baslinjen`);
      for (const p of problems.slice(0, 8)) console.error(`    ${p}`);
      if (problems.length > 8) console.error(`    … och ${problems.length - 8} till`);
    } else {
      const unstable = Object.values(measured[id]).flatMap((m) => m.unstable ?? []);
      const soft = softNotes.length;
      const reported = reportedNotes.length;
      console.log(`✓ ${id}: ${states.length} tillstånd ${problems.length ? 'avviker' : 'identiska med baslinjen'}${soft ? ` (${soft} geometrivärden inom tolerans)` : ''}${geometryNotes.length ? ` (${geometryNotes.length} geometrivärden utanför toleransen — varning)` : ''}${reported ? ` (${reported} stilvärden rapporterade — annat bygge)` : ''}${unstable.length ? `, ${unstable.length} ostabila värden undantogs` : ''}`);
      if (geometryNotes.length && verbose) for (const g of geometryNotes.slice(0, 5)) console.log(`    ! ${g}`);
      if (reported && verbose) for (const r of reportedNotes.slice(0, 5)) console.log(`    ~ ${r}`);
      valuesOutsideTolerance.push(...geometryNotes);
      if (soft && verbose) for (const s of softNotes) console.log(`    · ${s}`);
    }
  }

  console.log('');
  if (valuesReported.length) {
    console.warn(`⚠ ${valuesReported.length} stilvärden avviker från baslinjen (rapporteras, inte grind: annat webbläsarbygge).`);
    console.warn('  Kör i baslinjens webbläsare för fullständig jämförelse: node tests/demo-parity.mjs --require-same-browser');
  }
  if (valuesOutsideTolerance.length) {
    console.warn(`⚠ ${valuesOutsideTolerance.length} geometrivärden ligger utanför toleransen (textmetrik mellan byggen).`);
    console.warn('  Största avvikelse: ' + maxDeviation(valuesOutsideTolerance));
    console.warn('  Kör om samma webbläsarinstans med --strict (0 px slack) för exakt bevis, eller --verbose för listan.');
  }
  if (!sameBrowser && (requireSameBrowser || strict)) {
    console.error(`✗ Webbläsarbygget skiljer sig från baslinjens (${version} mot ${baseline.chromium}); --strict/--require-same-browser kräver samma bygge.`);
    process.exit(1);
  }
  if (failures) {
    console.error(`${failures} demo(n) avviker från baslinjen.`);
    process.exit(1);
  }
  const soft = valuesWithinTolerance.length;
  console.log(`${compared} värden jämförda mot baslinjen — inga strukturella avvikelser${strict ? ' (strikt läge)' : ''}${sameBrowser ? '' : ` (samma bygge som baslinjen krävs för stiljämförelsen: ${baseline.chromium}, nu ${version})`}.`);
  console.log(soft
    ? `${soft} geometrivärden ligger inom toleransen${strict ? '' : ` (max ${GEOMETRI_SLACK_PX} px, ${GEOMETRI_SLACK_REL * 100} %)`} — kör med --verbose för listan.`
    : 'Geometrin är identisk (0 px avvikelse).');
}

if (process.argv[1] && join(dirname(fileURLToPath(import.meta.url)), 'demo-parity.mjs') === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
