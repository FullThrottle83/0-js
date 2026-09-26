// Standalone evidence: each generated snippet + Grundpaketet, in its own
// document. Writes one screenshot and one computed-style/pixel report per
// filter into docs/migrering/grupp-b-filter/standalone/.
//
//   node docs/migrering/grupp-b-filter/standalone.mjs [OUTPUT]
//
// Opt-in documentation, not a CI entry point. Requires Chromium 153.0.8010.0
// (CHROMIUM_PATH) — the same build as the parity baseline.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { extractSnippets } from '../../../scripts/check-snippets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = process.argv[2] ? resolve(process.argv[2]) : join(dirname(fileURLToPath(import.meta.url)), 'standalone');
const IDS = ['filter-blur', 'filter-contrast', 'filter-saturate', 'filter-hue-rotate',
  'filter-sepia', 'filter-grayscale', 'filter-invert', 'filter-drop-shadow'];

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const snippets = extractSnippets(html);
const base = snippets.find((s) => s.label.includes('Grundpaketet')).code;
const hash = (b) => createHash('sha256').update(b).digest('hex');

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: (process.env.CHROMIUM_ARGS || '').split(/\s+/).filter(Boolean),
});
const result = { chromium: browser.version(), documentSha256: hash(readFileSync(join(ROOT, 'index.html'))), samples: {} };
assert.equal(result.chromium, '153.0.8010.0');
const page = await browser.newPage({ viewport: { width: 640, height: 320 } });

for (const id of IDS) {
  const code = snippets.find((s) => s.label.toLowerCase().startsWith(`kod för ${id.replace('filter-', 'filter: ')}`)
    || s.label.toLowerCase().includes(id))?.code;
  assert.ok(code, `snippet för ${id} saknas`);
  const idx = code.indexOf('/* CSS */');
  await page.setContent(`<!doctype html><html lang="sv"><head><meta charset="utf-8"><style>${base}\n${code.slice(idx)}</style></head>`
    + `<body><main style="padding:2rem;max-width:40rem">${code.slice(0, idx).replace(/^<!-- HTML -->\n/, '')}</main></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  const measured = await page.evaluate(() => {
    const root = document.querySelector('.demo-yta');
    const surface = root.querySelector('.swatch-yta');
    const swatch = root.querySelector('.swatch');
    const cs = getComputedStyle(surface);
    const r = surface.getBoundingClientRect();
    const layers = [...cs.backgroundImage.matchAll(/([a-z-]+gradient)\(/g)].map((m) => m[1]);
    // Ofiltrerat prov: samma markup och samma delade motiv, utan demots filter.
    const probe = root.cloneNode(true);
    const filterClass = [...swatch.classList].find((c) => c.startsWith('f-') && c !== 'f-motiv');
    probe.querySelector('.swatch').classList.remove(filterClass);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;background:#000';
    host.append(probe);
    document.body.append(host);
    const ref = getComputedStyle(host.querySelector('.swatch-yta')).filter;
    host.remove();
    return {
      width: r.width, height: r.height,
      filter: cs.filter,
      backgroundLayers: layers,
      resolved: ['--acc', '--line', '--dim', '--bg2', '--mono']
        .map((name) => [name, getComputedStyle(document.documentElement).getPropertyValue(name).trim()]),
      lv: getComputedStyle(root).getPropertyValue('--lv').trim(),
      selectors: [...document.styleSheets].flatMap((s) => [...s.cssRules]).filter((r) => r.selectorText).map((r) => r.selectorText),
      swatchClass: swatch.className,
      unfilteredProbe: ref,
      otherFilters: [...document.styleSheets].flatMap((s) => [...s.cssRules])
        .filter((r) => /\.f-[a-z]+ .swatch-yta/.test(r.selectorText ?? '')).map((r) => r.selectorText),
    };
  });
  const png = await page.locator('.demo-yta').screenshot({ path: join(OUT, `${id}.png`), animations: 'disabled' });
  result.samples[id] = { ...measured, pngSha256: hash(png) };
}

await browser.close();
writeFileSync(join(OUT, 'computed-styles.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`standalone: ${Object.keys(result.samples).length} snippets rendered; Chromium ${result.chromium}`);
