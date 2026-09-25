#!/usr/bin/env node
/**
 * tests/menu-keyboard.mjs — Nivå 2: verifierar mobilmenyns tangentbords-
 * interaktion i en riktig webbläsare (Playwright + Chromium).
 *
 * Kräver webbläsare och körs därför INTE av de snabba statiska kontrollerna:
 *   npm install
 *   npx playwright install chromium
 *   node tests/menu-keyboard.mjs
 *
 * Menyn är en :target-disclosure (panelen visas när URL:ens hash är
 * #sidomeny). Verifierad interaktionsmodell, helt utan JavaScript på sidan:
 *  1. Med viewport ≤1119px är panelen dold och öppna-länken synlig.
 *  2. Tab når öppna-länken; den får sidans globala :focus-visible-outline.
 *  3. Enter öppnar panelen (hash #sidomeny); första Tab-stoppet i panelen
 *     är stäng-länken.
 *  4. Aktiveras en riktig indexlänk stängs panelen automatiskt (target
 *     flyttas till sektionen) och sidan scrollar till målet.
 *  5. Stäng-länken (#topp) stänger panelen utan navigering.
 *  6. Vid ≥1120px är panelen en statisk sidebar och växellänkarna är
 *     display:none — även om hashen är #sidomeny.
 *  7. Ändras viewporten från öppen mobilpanel till bred skärm förblir
 *     panelen synlig som sidebar.
 *
 * Skriptet avslutar med kod 1 vid första avvikelsen — inga tysta
 * förbi-släpp. Det kräver en riktig Chromium; i sandlådor utan webbläsare
 * körs det i stället i CI:s webbläsarjobb.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

function fail(msg) {
  console.error(`✗ ${msg}`);
  failures++;
}
function ok(msg) {
  console.log(`✓ ${msg}`);
}
function assert(cond, msg) {
  cond ? ok(msg) : fail(msg);
}

async function tabUntil(page, predicate, limit = 80) {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(predicate)) return true;
  }
  return false;
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('Kunde inte läsa in playwright. Kör först: npm install && npx playwright install chromium');
    process.exit(1);
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 480, height: 800 } });
    await page.goto('file://' + join(root, 'index.html'), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);

    const panelVisible = () =>
      page.evaluate(() => getComputedStyle(document.getElementById('sidomeny')).display !== 'none');

    /* 1. Utgångsläge: panel dold, öppna-länk synlig. */
    assert((await panelVisible()) === false, 'mobil: panelen är dold utan #sidomeny i hashen');
    assert(
      await page.evaluate(
        () => getComputedStyle(document.querySelector('.site .meny-oppna-knapp')).display !== 'none'
      ),
      'mobil: öppna-länken är synlig'
    );

    /* 2. Tab till öppna-länken; fokuserad länk ska ha synlig outline. */
    const reachedOpen = await tabUntil(
      page,
      () => document.activeElement?.classList?.contains('meny-oppna-knapp') &&
            document.activeElement.closest('.site') !== null
    );
    assert(reachedOpen, 'tangentbord: Tab når öppna-länken i sidhuvudet');
    const outline = await page.evaluate(
      () => getComputedStyle(document.querySelector('.site .meny-oppna-knapp')).outlineStyle
    );
    assert(outline !== 'none', 'öppna-länken får synlig fokusindikator');

    /* 3. Enter öppnar: hashen blir #sidomeny och panelen visas. */
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.hash === '#sidomeny', null, { timeout: 4000 });
    assert(true, 'Enter sätter hashen till #sidomeny');
    assert(await panelVisible(), 'panelen visas när den är :target');

    /* Första Tab in i panelen ska landa på stäng-länken. */
    const reachedClose = await tabUntil(
      page,
      () => document.activeElement?.classList?.contains('meny-stang')
    );
    assert(reachedClose, 'Tab in i panelen: första stoppet är stäng-länken');

    /* 4. Aktivera en riktig indexlänk: panelen ska stängas och sidan
          scrolla till målet. */
    const firstLink = page.locator('nav.index a').first();
    const targetId = await firstLink.getAttribute('href');
    await firstLink.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      (id) => location.hash === id,
      targetId,
      { timeout: 4000 }
    );
    assert(true, `indexlänkens target (${targetId}) blev ny hash`);
    assert((await panelVisible()) === false, 'panelen stängs automatiskt när en indexlänk aktiveras');
    await page.waitForFunction(
      (id) => {
        const el = document.getElementById(id.slice(1));
        const top = el.getBoundingClientRect().top;
        return top > -40 && top < 260;
      },
      targetId,
      { timeout: 6000 }
    );
    assert(true, 'sidan scrollade till målet (scroll-margin respekteras)');

    /* 5. Öppna igen och stäng via stäng-länken. */
    await page.locator('.site .meny-oppna-knapp').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.hash === '#sidomeny', null, { timeout: 4000 });
    assert(await panelVisible(), 'panelen kan öppnas igen');
    await page.locator('.meny-stang').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.hash === '#topp', null, { timeout: 4000 });
    assert((await panelVisible()) === false, 'stäng-länken (#topp) stänger panelen');

    /* 6. Bred viewport: statisk sidebar oavsett hash, växellänkar borta. */
    await page.setViewportSize({ width: 1280, height: 900 });
    assert(await panelVisible(), 'desktop: panelen är en alltid-synlig sidebar');
    assert(
      await page.evaluate(
        () => getComputedStyle(document.querySelector('.site .meny-oppna-knapp')).display === 'none'
      ),
      'desktop: öppna-länken är display:none'
    );
    await page.evaluate(() => { location.hash = '#sidomeny'; });
    assert(await panelVisible(), 'desktop: sidebar synlig även med #sidomeny i hashen');
    await page.evaluate(() => { history.replaceState(null, '', location.pathname); });

    /* 7. Öppnad mobilpanel -> bred skärm: panelen förblir synlig. */
    await page.setViewportSize({ width: 480, height: 800 });
    await page.evaluate(() => { location.hash = '#sidomeny'; });
    await page.waitForFunction(
      () => getComputedStyle(document.getElementById('sidomeny')).display !== 'none',
      null,
      { timeout: 4000 }
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    assert(await panelVisible(), 'resize öppen mobil -> bred: panelen fortsätter visas');
  } finally {
    await browser.close();
  }

  if (failures > 0) {
    console.error(`\n${failures} kontroll(er) misslyckades.`);
    process.exit(1);
  }
  console.log('\nMenyns tangentbordsinteraktion verifierad.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
