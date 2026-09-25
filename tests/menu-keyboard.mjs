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
 * Verifierad interaktionsmodell (helt utan JavaScript på sidan):
 *  1. Med viewport ≤1119px är panelen dold och öppna-växeln synlig.
 *  2. Tab når den (visuellt dolda men fokuserbara) checkboxen #meny-oppna;
 *     fokusindikatorn projiceras på .meny-oppna-knapp.
 *  3. Space öppnar panelen; nästa Tab-stopp ligger inne i panelen.
 *  4. Fokus kan vandra genom panelens länkar; Shift+Tab tillbaka till
 *     växeln och Space stänger; fokus står kvar på växeln.
 *  5. Vid ≥1120px är panelen en statisk sidebar och växeln är display:none.
 *  6. Ändras viewporten från öppen mobilpanel till bred skärm ska panelen
 *     fortsätta visas som sidebar (inga dolda rester).
 *
 * Skriptet avslutar med kod 1 vid första avviken — det finns inga
 * tysta förbi-släpp.
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

    const box = () => page.locator('#meny-oppna');
    const panelShown = () =>
      page.evaluate(() => getComputedStyle(document.querySelector('.sidomeny')).display !== 'none');

    /* 1. Utgångsläge: panel dold, öppna-knapp synlig. */
    assert((await panelShown()) === false, 'mobil: panelen är dold innan växeln aktiveras');
    assert(
      await page.evaluate(() => getComputedStyle(document.querySelector('.site .meny-oppna-knapp')).display !== 'none'),
      'mobil: öppna-knappen är synlig'
    );

    /* 2. Tab till växeln (räkna tab-stopp tills vi når den). */
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => document.activeElement?.id === 'meny-oppna');
    }
    assert(reached, 'tangentbord: Tab når #meny-oppna');

    const outlineOnOpen = await page.evaluate(
      () => getComputedStyle(document.querySelector('.site .meny-oppna-knapp')).outlineStyle
    );
    assert(outlineOnOpen !== 'none', 'fokusindikator projiceras på öppna-knappen när växeln är fokuserad');

    /* 3. Space öppnar; fokus flyttas in i panelen vid nästa Tab. */
    await page.keyboard.press('Space');
    assert(await box().isChecked(), 'Space markerar växeln (panel öppnas)');
    assert((await panelShown()) === true, 'panelen visas när växeln är markerad');

    await page.keyboard.press('Tab');
    const focusInPanel = await page.evaluate(() =>
      document.querySelector('.sidomeny')?.contains(document.activeElement)
    );
    assert(focusInPanel, 'nästa Tab-stopp efter öppning ligger inne i panelen');

    /* 4. Stäng: Shift+Tab tillbaka till växeln, Space stänger. */
    let backOnToggle = false;
    for (let i = 0; i < 60 && !backOnToggle; i++) {
      await page.keyboard.press('Shift+Tab');
      backOnToggle = await page.evaluate(() => document.activeElement?.id === 'meny-oppna');
    }
    assert(backOnToggle, 'Shift+Tab tillbaka till växeln inifrån panelen');
    await page.keyboard.press('Space');
    assert((await box().isChecked()) === false, 'Space avmarkerar växeln (panel stängs)');
    assert((await panelShown()) === false, 'panelen döljs när växeln avmarkeras');
    assert(
      await page.evaluate(() => document.activeElement?.id === 'meny-oppna'),
      'fokus står kvar på växeln efter stängning'
    );

    /* 5. Bred viewport: statisk sidebar, växeln borta. */
    await page.setViewportSize({ width: 1280, height: 900 });
    assert((await panelShown()) === true, 'desktop: panelen är en alltid-synlig sidebar');
    assert(
      await page.evaluate(() => getComputedStyle(document.querySelector('#meny-oppna')).display === 'none'),
      'desktop: växeln är display:none'
    );

    /* 6. Öppnad mobilpanel -> bredda skärmen: panelen förblir synlig. */
    await page.setViewportSize({ width: 480, height: 800 });
    await page.evaluate(() => { document.getElementById('meny-oppna').checked = true; });
    await page.setViewportSize({ width: 1280, height: 900 });
    assert((await panelShown()) === true, 'resize öppen mobil -> bred: panelen fortsätter visas');
    await page.evaluate(() => { document.getElementById('meny-oppna').checked = false; });
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
