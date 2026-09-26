// Reproducible, opt-in evidence capture for the eight filter demos.
// Not a new CI entry point and not a build step.
//
//   node docs/migrering/grupp-b-filter/evidence.mjs before|after DOCUMENT OUTPUT
//   node docs/migrering/grupp-b-filter/evidence.mjs compare OUTPUT
//
// `before` must be run against the untouched pre-migration index.html; the
// script refuses any other document (the SHA-256 is asserted below).
//
// Intentional DOM difference: the shared four-layer motif needs one common
// selector, so each filter swatch gains the class `f-motiv`. The comparison
// therefore hashes two things per sample:
//   measurementSha256      every attribute (with the single token `f-motiv`
//                          removed from class values), text, geometry and all
//                          computed styles — this is the equality assertion.
//   rawMeasurementSha256   the same data untouched, so the class difference is
//                          recorded rather than hidden.
// The class has no rule of its own; the only rule it selects is
// `.f-motiv .swatch-yta` in demos/_delat/filter-motiv.css, which carries the
// same four layers the old nine-selector rule carried.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const hash = (b) => createHash('sha256').update(b).digest('hex');
const PRE_MIGRATION_SHA256 = '7cd4d27dbe56d0a5e4e381b340fbcfac673b37b7090d6f62db13c8ca5e3214f8';
const MOTIF_CLASS = 'f-motiv';
const IDS = ['filter-blur', 'filter-contrast', 'filter-saturate', 'filter-hue-rotate',
  'filter-sepia', 'filter-grayscale', 'filter-invert', 'filter-drop-shadow'];

/** Remove the intentionally added class token from class attribute values. */
const normalize = (measured) => measured.map((e) => ({
  ...e,
  attributes: e.attributes.map(([name, value]) => (name === 'class'
    ? [name, value.split(/\s+/).filter((t) => t !== MOTIF_CLASS).join(' ')]
    : [name, value])),
}));

const [mode, document, output] = process.argv.slice(2);

if (mode === 'compare') {
  const before = JSON.parse(readFileSync(join(document, 'before.json'), 'utf8'));
  const after = JSON.parse(readFileSync(join(document, 'after.json'), 'utf8'));
  assert.equal(before.chromium, after.chromium);
  assert.deepEqual(Object.keys(before.samples), Object.keys(after.samples));
  const pngDifferent = [];
  const rawDifferent = [];
  for (const name of Object.keys(before.samples)) {
    const b = before.samples[name];
    const a = after.samples[name];
    assert.equal(b.measurementSha256, a.measurementSha256, `${name}: attributes/text/geometry/computed styles`);
    assert.deepEqual(b.motivClasses, 0, `${name}: pre-migration swatch must not carry ${MOTIF_CLASS}`);
    assert.deepEqual(a.motivClasses, 1, `${name}: migrated swatch must carry ${MOTIF_CLASS} exactly once`);
    if (b.rawMeasurementSha256 !== a.rawMeasurementSha256) {
      // The only permitted raw difference is the intended class token.
      assert.equal(b.classValues.join('|'), a.classValues.map((v) => v.split(/\s+/)
        .filter((t) => t !== MOTIF_CLASS).join(' ')).join('|'), `${name}: unexpected raw attribute difference`);
      rawDifferent.push(name);
    }
    const bp = readFileSync(join(document, 'before', `${name}.png`));
    const ap = readFileSync(join(document, 'after', `${name}.png`));
    assert.equal(hash(bp), b.pngSha256, `${name}: before PNG changed on disk`);
    assert.equal(hash(ap), a.pngSha256, `${name}: after PNG changed on disk`);
    if (!bp.equals(ap)) pngDifferent.push(name);
  }
  console.log(`${Object.keys(before.samples).length} samples · Chromium ${before.chromium}`);
  console.log(`${Object.keys(before.samples).length - pngDifferent.length}/${Object.keys(before.samples).length} PNG pairs byte-identical`);
  console.log(`${rawDifferent.length} samples carry the documented intentional class difference (${MOTIF_CLASS})`);
  console.log('All attribute/text/geometry/computed-style hashes identical after normalising that single token.');
  writeFileSync(join(document, 'pixel-differences.json'),
    `${JSON.stringify({ pngDifferent, rawDifferent }, null, 2)}\n`);
  if (pngDifferent.length) {
    console.error('PNG differences (recorded, never hidden by tolerance):\n' + pngDifferent.join('\n'));
    process.exit(1);
  }
  process.exit();
}

assert(['before', 'after'].includes(mode));
const bytes = readFileSync(document);
if (mode === 'before') {
  assert.equal(hash(bytes), PRE_MIGRATION_SHA256,
    '"before" must be the untouched pre-migration index.html — never extract the migrated one');
}
mkdirSync(join(output, mode), { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: (process.env.CHROMIUM_ARGS || '').split(/\s+/).filter(Boolean),
});
const result = {
  chromium: browser.version(),
  documentSha256: hash(bytes),
  viewportHeights: 900,
  samples: {},
};
assert.equal(result.chromium, '153.0.8010.0', 'evidence requires Chromium 153.0.8010.0');
const page = await browser.newPage();
for (const id of IDS) {
  for (const width of [375, 768, 1280]) {
    for (const theme of ['guld', 'syra']) {
      for (const state of ['default', '0', '8']) {
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
        const measured = await surface.evaluate((root) => {
          const origin = root.getBoundingClientRect();
          return [root, ...root.querySelectorAll('*')].map((e) => {
            const r = e.getBoundingClientRect();
            const cs = getComputedStyle(e);
            return {
              tag: e.tagName,
              attributes: [...e.attributes].map((a) => [a.name, a.value]),
              text: e.textContent,
              rect: [r.x - origin.x, r.y - origin.y, r.width, r.height],
              styles: Object.fromEntries([...cs].map((p) => [p, cs.getPropertyValue(p)])),
            };
          });
        });
        const png = await surface.screenshot({ path: join(output, mode, `${name}.png`), animations: 'disabled' });
        result.samples[name] = {
          pngSha256: hash(png),
          measurementSha256: hash(JSON.stringify(normalize(measured))),
          rawMeasurementSha256: hash(JSON.stringify(measured)),
          motivClasses: measured.filter((e) => (e.attributes.find(([n]) => n === 'class')?.[1] ?? '')
            .split(/\s+/).includes(MOTIF_CLASS)).length,
          classValues: measured.map((e) => e.attributes.find(([n]) => n === 'class')?.[1] ?? ''),
        };
      }
    }
  }
}
await browser.close();
writeFileSync(join(output, `${mode}.json`), JSON.stringify(result, null, 2) + '\n');
console.log(`${mode}: ${Object.keys(result.samples).length} samples (8 demos × 3 widths × 2 themes × 3 lab states); Chromium ${result.chromium}`);
