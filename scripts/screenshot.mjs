#!/usr/bin/env node
/**
 * screenshot.mjs — ta en skärmbild av referensen för README/repo.
 *
 * Kräver en riktig webbläsare:
 *   npm install        (installerar playwright som devDependency)
 *   node scripts/screenshot.mjs
 *
 * Skriver doc/screenshot.png (hero) och doc/screenshot-full.png (hela sidan).
 * I CI körs detta av workflowen och bilderna laddas upp som artefakter.
 */

import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docDir = join(root, 'doc');

async function run() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('Kunde inte läsa in playwright. Kör först: npm install');
    process.exit(1);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

  const fileUrl = 'file://' + join(root, 'index.html');
  await page.goto(fileUrl, { waitUntil: 'networkidle' });
  // Låt inbäddade typsnitt och eventuelle scroll-animationer stabiliseras.
  await page.waitForTimeout(600);

  if (!existsSync(docDir)) mkdirSync(docDir);

  // Hero-vy: det första intrycket.
  await page.screenshot({ path: join(docDir, 'screenshot.png') });

  // Fullständig vy (hela dokumentet).
  await page.screenshot({ path: join(docDir, 'screenshot-full.png'), fullPage: true });

  await browser.close();
  console.log('Skrev doc/screenshot.png och doc/screenshot-full.png');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
