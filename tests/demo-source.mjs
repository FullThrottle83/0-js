#!/usr/bin/env node
/**
 * tests/demo-source.mjs — Nivå 2/4b för de källgenererade demona: verifierar
 * i en riktig Chromium att de tre migrerade demona (shape-outside, :target,
 * @property --border-angle) fungerar på sidan OCH att deras kopierbara
 * kodvalv fungerar fristående (Grundpaketet + kodvalvet, ingenting annat).
 *
 * Kräver webbläsare och körs därför INTE av de snabba statiska kontrollerna:
 *   npm install
 *   npx playwright install chromium
 *   node tests/demo-source.mjs
 *
 * I miljöer där Playwrights nedladdning är blockerad kan en egen Chromium
 * anges: CHROMIUM_PATH=/sökväg/chromium CHROMIUM_ARGS="--no-sandbox …".
 *
 * Verifierat, per demo:
 *  shape-outside   texten flyter runt cirkeln (shape-outside: circle(50%));
 *                  jämförarens av-läge (live-only-CSS) neutraliserar formen
 *                  men rör inte kodvalvet; fristående kodvalv ger samma form.
 *  :target         panel 1 syns utan hash; klick på "Två" visar bara panel 2;
 *                  bakåtknappen återställer; fristående kodvalv gör detsamma.
 *  --border-angle  vinkeln interpoleras (registrerad egenskap) och kanten
 *                  roterar; fristående kodvalv roterar också — det gjorde inte
 *                  det tidigare handkopierade exemplet (trasig @keyframes).
 *
 * Avslutar med kod 1 vid första avvikelsen.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { extractSnippets } from '../scripts/check-snippets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const ok = (m) => console.log(`✓ ${m}`);
const fail = (m) => { console.error(`✗ ${m}`); failures++; };
const assert = (c, m) => (c ? ok(m) : fail(m));

/** Fristående testsida: bara Grundpaketet + demots kodvalv. */
function isolated(baseCode, code) {
  const idx = code.indexOf('/* CSS */');
  const htmlPart = code.slice(0, idx).replace(/^<!-- HTML -->\n/, '');
  const cssPart = code.slice(idx);
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8"><style>${baseCode}\n${cssPart}</style></head><body><main style="padding:2rem;max-width:40rem">${htmlPart}</main></body></html>`;
}

async function main() {
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

  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const snippets = extractSnippets(html);
  const base = snippets.find((s) => s.label.includes('Grundpaketet')).code;
  const snippet = (needle) => snippets.find((s) => s.label.includes(needle)).code;
  const url = pathToFileURL(join(root, 'index.html')).href;

  const browser = await chromium.launch(launch);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  // setContent behåller föregående URL; en hash-navigering därefter skulle
  // annars inte ladda om dokumentet. Gå därför alltid via about:blank.
  const open = async (hash) => { await page.goto('about:blank'); await page.goto(`${url}#${hash}`); };
  console.log(`Chromium: ${await browser.version()}\n`);

  /* shape-outside ---------------------------------------------------- */
  {
    await open('shape-outside');
    const shape = () => page.evaluate(() => getComputedStyle(document.querySelector('#shape-outside .shape-float')).shapeOutside);
    assert((await shape()) === 'circle(50%)', 'sidan: .shape-float har shape-outside: circle(50%)');
    await page.locator('#shape-outside .jmf-knapp').click();
    assert((await shape()) === 'none', 'sidan: jämförarens av-läge neutraliserar formen (live-only-CSS)');
    const lage = await page.evaluate(() => getComputedStyle(document.querySelector('#shape-outside .jmf-lage'), '::after').content);
    assert(lage === '"av"', 'sidan: jämförarens etikett visar "av"');

    const code = snippet('shape-outside');
    assert(!code.includes('.jmfbar'), 'kodvalv: innehåller inte jämförarens live-only-regel');
    assert(!code.includes('class="jmf'), 'kodvalv: innehåller inte jämförarens markup');
    await page.setContent(isolated(base, code));
    const iso = await page.evaluate(() => {
      const f = document.querySelector('.shape-float');
      const p = document.querySelector('.shape-demo p');
      const cs = getComputedStyle(f);
      return { shape: cs.shapeOutside, float: cs.float, w: f.getBoundingClientRect().width, pLeft: p.getBoundingClientRect().left, fLeft: f.getBoundingClientRect().left };
    });
    assert(iso.shape === 'circle(50%)' && iso.float === 'left', 'fristående kodvalv: cirkeln flyter med shape-outside: circle(50%)');
    assert(Math.round(iso.w) === 128, `fristående kodvalv: cirkeln är 8rem (${iso.w}px)`);
  }

  /* :target ------------------------------------------------------------ */
  {
    await open('target');
    const vis = () => page.evaluate(() => ['tp-1', 'tp-2', 'tp-3'].map((id) => getComputedStyle(document.getElementById(id)).display).join(','));
    assert((await vis()) === 'block,none,none', 'sidan: panel ett är standard utan :target');
    await page.locator('#target .target-nav a[href="#tp-2"]').click();
    assert((await vis()) === 'none,block,none', 'sidan: klick på "Två" visar bara panel två');
    assert((await page.evaluate(() => location.hash)) === '#tp-2', 'sidan: tillståndet lever i URL:ens hash');
    await page.goBack();
    assert((await vis()) === 'block,none,none', 'sidan: bakåtknappen återställer panel ett');

    await page.setContent(isolated(base, snippet(':target')));
    assert((await vis()) === 'block,none,none', 'fristående kodvalv: panel ett är standard');
    await page.locator('.target-nav a[href="#tp-3"]').click();
    assert((await vis()) === 'none,none,block', 'fristående kodvalv: klick på "Tre" visar panel tre');
  }

  /* @property --border-angle ------------------------------------------ */
  {
    const read = (sel) => page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const cs = getComputedStyle(el);
      return { angle: cs.getPropertyValue('--border-angle'), anim: cs.animationName, state: el.getAnimations()[0]?.playState ?? 'none' };
    }, sel);
    const rotates = async (sel) => {
      const a = await read(sel);
      await page.waitForTimeout(500);
      const b = await read(sel);
      return { a, b, moving: a.angle !== b.angle && /deg$/.test(a.angle) };
    };
    await open('property-border-angle');
    await page.waitForTimeout(300);
    const live = await rotates('#property-border-angle .glow-card');
    assert(live.a.anim === 'rotera-kant' && live.a.state === 'running', 'sidan: animationen rotera-kant kör');
    assert(live.moving, `sidan: --border-angle interpoleras (${live.a.angle} → ${live.b.angle})`);

    await page.setContent(isolated(base, snippet('border-angle')));
    await page.waitForTimeout(300);
    const iso = await rotates('.glow-card');
    assert(iso.moving, `fristående kodvalv: kanten roterar (${iso.a.angle} → ${iso.b.angle})`);
  }

  await page.goto('about:blank');
  assert((await page.goto(url)) && (await page.evaluate(() => document.scripts.length)) === 0, 'sidan: document.scripts.length === 0');
  assert((await page.evaluate(() => document.querySelectorAll('article.demo').length)) === 133, 'sidan: 133 demo-kort renderade');

  await browser.close();
  console.log('');
  if (failures) {
    console.error(`${failures} avvikelse(r).`);
    process.exit(1);
  }
  console.log('Alla webbläsartest för källgenererade demos gröna.');
}

main().catch((e) => { console.error(e); process.exit(1); });
