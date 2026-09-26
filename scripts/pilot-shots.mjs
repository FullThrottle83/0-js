#!/usr/bin/env node
/**
 * pilot-shots.mjs — skärmbildsbevis för Grupp B-piloten (color-mix +
 * linear-gradient). Inte en grind: ett dokumentationsverktyg för migreringen.
 *
 *   node scripts/pilot-shots.mjs <utkatalog> [fore|efter]
 *
 * Tar elementskärmbilder av de två demots yta (.demo-yta) vid 375/768/1280 px,
 * i standardtillståndet och i labbets noll-/åttaläge, för två av sidans fyra
 * teman (guld = standard, syra). Utkatalogen jämförs sedan byte för byte
 * mellan före- och efter-körningen (cmp).
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2];
if (!outDir) { console.error('användning: node scripts/pilot-shots.mjs <utkatalog> [fore|efter]'); process.exit(1); }
const demos = ['color-mix', 'linear-gradient'];
const themes = ['guld', 'syra'];
const widths = [375, 768, 1280];

async function run() {
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch {
    console.error('Kunde inte läsa in playwright. Kör först: npm install && npx playwright install chromium');
    process.exit(1);
  }
  const browser = await chromium.launch({ headless: true });
  const url = pathToFileURL(join(root, 'index.html')).href;
  let n = 0;
  try {
    for (const theme of themes) {
      for (const width of widths) {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        await page.goto('about:blank');
        await page.goto(`${url}#topp`, { waitUntil: 'load' });
        if (theme !== 'guld') await page.locator(`#tema-${theme}`).check();
        await page.evaluate(() => document.fonts.ready);
        for (const id of demos) {
          await page.goto('about:blank');
          await page.goto(`${url}#${id}`, { waitUntil: 'load' });
          await page.evaluate(() => document.fonts.ready);
          await page.locator(`#${id}`).scrollIntoViewIfNeeded();
          await page.waitForTimeout(250);
          const yta = page.locator(`#${id} .demo-yta`);
          for (const [label, step] of [['standard', null], ['lv-0', '0'], ['lv-8', '8']]) {
            if (step) {
              await page.locator(`#${id} .labb-steg input[data-v="${step}"]`).check();
              await page.waitForTimeout(250);
            }
            const file = join(outDir, `${id}.${label}.${theme}.${width}.png`);
            await yta.screenshot({ path: file, animations: 'disabled' });
            n++;
          }
        }
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  mkdirSync(outDir, { recursive: true });
  console.log(`Skrev ${n} skärmbilder till ${outDir}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
