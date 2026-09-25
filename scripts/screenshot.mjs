#!/usr/bin/env node
/**
 * screenshot.mjs — skärmbilder av referensen för README/repo.
 *
 * Kräver en riktig webbläsare:
 *   npm install                 (installerar playwright som devDependency)
 *   npx playwright install chromium
 *   node scripts/screenshot.mjs
 *
 * Skriver två små, användbara bilder till doc/:
 *   - hero.png  : hjälte-vyn (första intrycket)
 *   - demo.png  : ett representativt demo-kort (interaktion + kodvalv)
 *
 * En fullständig bild av hela dokumentet är dyr (mycket stor PNG) och görs
 * BARA om miljön uttryckligen ber om den via FULLPAGE=1:
 *   FULLPAGE=1 node scripts/screenshot.mjs   -> doc/full.png
 *
 * I CI är detta ett valfritt, icke-blockerande jobb. Misslyckas det ska de
 * statiska kontrollerna fortfarande köra — de är separata jobb.
 */

import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docDir = join(root, 'doc');
const fullPage = process.env.FULLPAGE === '1';

async function run() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('Kunde inte läsa in playwright. Kör först: npm install');
    process.exit(1);
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });

    const fileUrl = 'file://' + join(root, 'index.html');
    await page.goto(fileUrl, { waitUntil: 'load' });
    // Låt inbäddade typsnitt stabiliseras innan vi fotar.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);

    if (!existsSync(docDir)) mkdirSync(docDir, { recursive: true });

    // 1) Hjälte-vyn.
    await page.screenshot({ path: join(docDir, 'hero.png') });
    console.log('Skrev doc/hero.png');

    // 2) Ett representativt demo-kort: popover-beviset har både figur,
    //    manus och kodvalv.
    const kort = page.locator('#popover-attributet');
    if (await kort.count()) {
      await kort.first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(docDir, 'demo.png') });
      console.log('Skrev doc/demo.png');
    }

    // 3) Hela sidan, endast vid uttrycklig begäran.
    if (fullPage) {
      await page.screenshot({ path: join(docDir, 'full.png'), fullPage: true });
      console.log('Skrev doc/full.png');
    }
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
