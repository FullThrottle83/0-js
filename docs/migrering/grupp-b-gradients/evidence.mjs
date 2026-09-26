// Reproducible, opt-in evidence capture; not a new CI entry point.
// node docs/migrering/grupp-b-gradients/evidence.mjs before|after DOCUMENT OUTPUT
// node docs/migrering/grupp-b-gradients/evidence.mjs compare OUTPUT
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const hash = b => createHash('sha256').update(b).digest('hex');
const [mode, document, output] = process.argv.slice(2);
if (mode === 'compare') {
  const before = JSON.parse(readFileSync(join(document, 'before.json')));
  const after = JSON.parse(readFileSync(join(document, 'after.json')));
  assert.equal(before.chromium, after.chromium);
  assert.deepEqual(Object.keys(before.samples), Object.keys(after.samples));
  const different = [];
  for (const name of Object.keys(before.samples)) {
    assert.equal(before.samples[name].measurementSha256, after.samples[name].measurementSha256, `${name}: DOM/styles/geometry`);
    const a = readFileSync(join(document, 'before', `${name}.png`));
    const b = readFileSync(join(document, 'after', `${name}.png`));
    assert.equal(hash(a), before.samples[name].pngSha256);
    assert.equal(hash(b), after.samples[name].pngSha256);
    if (!a.equals(b)) different.push(name);
  }
  console.log(`${Object.keys(before.samples).length - different.length}/${Object.keys(before.samples).length} PNG pairs byte-identical; all DOM, computed styles and relative geometry identical.`);
  if (different.length) {
    console.error('PNG differences (not hidden by tolerance):\n' + different.join('\n'));
    process.exit(1);
  }
  process.exit();
}
assert(['before', 'after'].includes(mode));
const bytes = readFileSync(document);
if (mode === 'before') assert.equal(hash(bytes), '8b1d567a0f54df0ff3261edddcd32f416efb92f9f5d0d30a203905f31756ded9');
mkdirSync(join(output, mode), { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: (process.env.CHROMIUM_ARGS || '').split(/\s+/).filter(Boolean) });
const result = { chromium: browser.version(), documentSha256: hash(bytes), samples: {} };
assert.equal(result.chromium, '153.0.8010.0');
const page = await browser.newPage();
for (const id of ['radial-gradient', 'conic-gradient', 'repeating-linear-gradient', 'repeating-radial-gradient']) {
  for (const width of [375, 768, 1280]) for (const theme of ['guld', 'syra']) for (const state of ['default', '0', '8']) {
    const name = `${id}.${width}.${theme}.${state}`;
    if (process.env.SAMPLES && !process.env.SAMPLES.split(',').includes(name)) continue;
    await page.setViewportSize({ width, height: 900 });
    await page.goto('about:blank');
    await page.goto(pathToFileURL(resolve(document)).href + '#' + id);
    await page.evaluate(() => document.fonts.ready);
    await page.locator(`#tema-${theme}`).check();
    const card = page.locator(`#${id}`);
    if (state !== 'default') await card.locator(`.labb-steg input[data-v="${state}"]`).check();
    const surface = card.locator('.demo-yta');
    await surface.scrollIntoViewIfNeeded();
    await page.waitForTimeout(450);
    const measured = await surface.evaluate(root => {
      const origin = root.getBoundingClientRect();
      return [root, ...root.querySelectorAll('*')].map(e => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return { tag: e.tagName, attributes: [...e.attributes].map(a => [a.name, a.value]), text: e.textContent,
          rect: [r.x - origin.x, r.y - origin.y, r.width, r.height],
          styles: Object.fromEntries([...cs].map(p => [p, cs.getPropertyValue(p)])) };
      });
    });
    const png = await surface.screenshot({ path: join(output, mode, `${name}.png`), animations: 'disabled' });
    result.samples[name] = { pngSha256: hash(png), measurementSha256: hash(JSON.stringify(measured)) };
  }
}
await browser.close();
writeFileSync(join(output, `${mode}.json`), JSON.stringify(result, null, 2) + '\n');
console.log(`${mode}: ${Object.keys(result.samples).length} screenshots and computed-style/DOM/geometry hashes; Chromium ${result.chromium}`);
