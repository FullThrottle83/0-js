#!/usr/bin/env node
/**
 * tests/demo-source.mjs — Nivå 2/4b för de källgenererade demona: verifierar
 * i en riktig Chromium att varje migrerad demo (scripts/demo-spec.mjs)
 * fungerar BÅDE på sidan och fristående (Grundpaketet + kodvalvet,
 * ingenting annat).
 *
 * Skillnaden mot tests/demo-parity.mjs: här prövas uttryckliga påståenden om
 * vad demot ska göra ("klick visar panel två", ":open ger accentfärgad kant",
 * "ogiltigt lösenord ger röd mätare"). Paritetstestet jämför i stället
 * mätvärden mot en baslinje och kan inte säga vad som är rätt — bara att
 * ingenting ändrats.
 *
 * Testet är inventariestyrt: varje id i manifestet måste ha en kontroll för
 * både sidan och det fristående kodvalvet, annars faller testet.
 *
 * Kräver webbläsare och körs därför INTE av de snabba statiska kontrollerna:
 *   npm install
 *   npx playwright install chromium
 *   node tests/demo-source.mjs
 *
 * I miljöer där Playwrights nedladdning är blockerad kan en egen Chromium
 * anges: CHROMIUM_PATH=/sökväg/chromium CHROMIUM_ARGS="--no-sandbox …".
 *
 * Avslutar med kod 1 vid första avvikelsen.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { extractSnippets } from '../scripts/check-snippets.mjs';
import { MIGRATED_IDS } from '../scripts/demo-spec.mjs';

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

/**
 * Verktyg för en kontroll. Samma väljare fungerar i båda sammanhangen:
 * `prefix` är `#<id> ` på sidan och tomt i den fristående testsidan.
 */
function tools(page, rootSel, cardPrefix) {
  const pick = (sel) => (sel ? `${rootSel} ${sel}` : rootSel);
  return {
    page,
    prefix: rootSel,
    cardPrefix,
    /** Väljare inom hela kortet (för sidans scenografi, t.ex. .jmf). */
    cardSel: (sel) => (cardPrefix ? cardPrefix + sel : sel),
    /** Beräknad stil för första matchande element inom demots yta. */
    style: (sel, prop, pseudo = null) => page.evaluate(
      ([s, p, ps]) => {
        const el = document.querySelector(s);
        return el ? getComputedStyle(el, ps).getPropertyValue(p) : '(saknas)';
      },
      [pick(sel), prop, pseudo],
    ),
    /** Anpassad egenskap på demots rotelement (.demo-yta). */
    rootStyle: (prop) => page.evaluate(
      ([s, p]) => getComputedStyle(document.querySelector(s)).getPropertyValue(p),
      [rootSel, prop],
    ),
    /** Textinnehåll (whitespace-normaliserat). */
    text: (sel) => page.evaluate(
      (s) => (document.querySelector(s)?.textContent ?? '(saknas)').replace(/\s+/g, ' ').trim(),
      pick(sel),
    ),
    /** Attributvärde. */
    attr: (sel, name) => page.evaluate(
      ([s, n]) => document.querySelector(s)?.getAttribute(n) ?? null,
      [pick(sel), name],
    ),
    /** Antal matchande element inom demots yta. */
    count: (sel) => page.evaluate((s) => document.querySelectorAll(s).length, pick(sel)),
    /** Fältvärde (input/select). */
    value: (sel) => page.inputValue(pick(sel)),
    expect: assert,
  };
}

/**
 * Alla var() i den fristående testsidans CSS måste lösa upp till ett värde.
 * Returnerar de namn som INTE gör det — en kopia som tappat en deklaration
 * (eller som lutar sig mot en variabel som bara finns på sidan) fångas här.
 */
async function unresolvedVars(page) {
  return page.evaluate(() => {
    const probe = getComputedStyle(document.querySelector('.demo-yta'));
    const out = [];
    for (const sheet of document.styleSheets) {
      for (const rule of sheet.cssRules) {
        if (!rule.style) continue;
        for (const prop of rule.style) {
          for (const m of rule.style.getPropertyValue(prop).matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
            if (!probe.getPropertyValue(m[1]).trim()) out.push(m[1]);
          }
        }
      }
    }
    return [...new Set(out)];
  });
}

/** Alla väljare i den fristående testsidans CSS. */
async function snippetSelectors(page) {
  return page.evaluate(() => [...document.styleSheets]
    .flatMap((s) => [...s.cssRules])
    .filter((r) => r.selectorText)
    .map((r) => r.selectorText));
}

/** Vänta tills en pågående övergång har satt sig (två lika mätningar i rad). */
async function settled(page, read, arg) {
  let prev = null;
  for (let i = 0; i < 30; i++) {
    const value = await page.evaluate(read, arg);
    if (prev !== null && Math.abs(value - prev) < 0.01) return value;
    prev = value;
    await page.waitForTimeout(100);
  }
  return prev;
}

/** Vänta in demots egna .3s-övergångar. */
const settle = async (t) => {
  await t.page.waitForTimeout(450);
};

/** Startvärden ur Grundpaketet (samma i båda sammanhangen). */
const baseVarsOf = (page) => page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  const get = (n) => cs.getPropertyValue(n).trim();
  return { acc: get('--acc'), bad: get('--bad'), good: get('--good'), bg2: get('--bg2'), ink: get('--ink'), dim: get('--dim'), line: get('--line') };
});

/**
 * Kontroller per demo: `page` körs mot index.html, `isolated` mot
 * Grundpaketet + kodvalvet. Båda måste finnas för varje migrerad demo.
 */
const CHECKS = {
  /* ---- piloten (PR #4) ------------------------------------------------ */
  'shape-outside': {
    page: async (t, v) => {
      t.expect(await t.style('.shape-float', 'shape-outside') === 'circle(50%)', 'shape-outside: sidan: .shape-float har shape-outside: circle(50%)');
      await t.page.locator(t.cardSel('.jmf-knapp')).click();
      t.expect(await t.style('.shape-float', 'shape-outside') === 'none', 'shape-outside: sidan: jämförarens av-läge neutraliserar formen (live-only-CSS)');
      const lage = await t.page.evaluate((p) => getComputedStyle(document.querySelector(`${p}.jmf-lage`), '::after').content, t.cardPrefix);
      t.expect(lage === '"av"', 'shape-outside: sidan: jämförarens etikett visar "av"');
    },
    isolated: async (t) => {
      const shape = await t.style('.shape-float', 'shape-outside');
      const float = await t.style('.shape-float', 'float');
      const w = await t.page.evaluate(() => document.querySelector('.shape-float').getBoundingClientRect().width);
      t.expect(shape === 'circle(50%)' && float === 'left', 'shape-outside: fristående kodvalv: cirkeln flyter med shape-outside: circle(50%)');
      t.expect(Math.round(w) === 128, `shape-outside: fristående kodvalv: cirkeln är 8rem (${w}px)`);
    },
  },
  target: {
    page: async (t) => {
      const vis = () => t.page.evaluate((p) => ['tp-1', 'tp-2', 'tp-3'].map((id) => getComputedStyle(document.querySelector(`${p}#${id}`)).display).join(','), t.cardPrefix);
      t.expect((await vis()) === 'block,none,none', ':target: sidan: panel ett är standard utan :target');
      await t.page.locator(`${t.prefix} .target-nav a[href="#tp-2"]`).click();
      t.expect((await vis()) === 'none,block,none', ':target: sidan: klick på "Två" visar bara panel två');
      t.expect((await t.page.evaluate(() => location.hash)) === '#tp-2', ':target: sidan: tillståndet lever i URL:ens hash');
      await t.page.goBack();
      t.expect((await vis()) === 'block,none,none', ':target: sidan: bakåtknappen återställer panel ett');
    },
    isolated: async (t) => {
      const vis = () => t.page.evaluate(() => ['tp-1', 'tp-2', 'tp-3'].map((id) => getComputedStyle(document.querySelector(`#${id}`)).display).join(','));
      t.expect((await vis()) === 'block,none,none', ':target: fristående kodvalv: panel ett är standard');
      await t.page.locator('.target-nav a[href="#tp-3"]').click();
      t.expect((await vis()) === 'none,none,block', ':target: fristående kodvalv: klick på "Tre" visar panel tre');
    },
  },
  'property-border-angle': {
    page: async (t) => {
      const read = () => t.page.evaluate((p) => {
        const el = document.querySelector(`${p} .glow-card`);
        const cs = getComputedStyle(el);
        return { angle: cs.getPropertyValue('--border-angle'), anim: cs.animationName, state: el.getAnimations()[0]?.playState ?? 'none' };
      }, t.prefix);
      const a = await read();
      await t.page.waitForTimeout(500);
      const b = await read();
      t.expect(a.anim === 'rotera-kant' && a.state === 'running', 'border-angle: sidan: animationen rotera-kant kör');
      t.expect(a.angle !== b.angle && /deg$/.test(a.angle), `border-angle: sidan: --border-angle interpoleras (${a.angle} → ${b.angle})`);
    },
    isolated: async (t) => {
      const read = () => t.page.evaluate(() => getComputedStyle(document.querySelector('.glow-card')).getPropertyValue('--border-angle'));
      const a = await read();
      await t.page.waitForTimeout(500);
      const b = await read();
      t.expect(a !== b, `border-angle: fristående kodvalv: kanten roterar (${a} → ${b})`);
    },
  },

  /* ---- batch 1 (denna PR) --------------------------------------------- */
  'accent-color': {
    page: async (t, v) => {
      t.expect(await t.style('input', 'accent-color') === `rgb(${hexToRgb(v.acc).join(', ')})`,
        'accent-color: sidan: kryssrutorna får accent-color ur Grundpaketet');
      const boxes = t.page.locator(t.prefix + ' input');
      t.expect(await boxes.nth(0).isChecked() && !(await boxes.nth(1).isChecked()), 'accent-color: sidan: första rutan är markerad, andra inte');
      await boxes.nth(0).uncheck();
      await boxes.nth(1).check();
      t.expect(!(await boxes.nth(0).isChecked()) && (await boxes.nth(1).isChecked()), 'accent-color: sidan: markeringen kan flyttas (native tillstånd)');
    },
    isolated: async (t, v) => {
      t.expect(await t.style('input', 'accent-color') === `rgb(${hexToRgb(v.acc).join(', ')})`,
        'accent-color: fristående kodvalv: accent-color följer Grundpaketet');
      t.expect(await t.count('input') === 2, 'accent-color: fristående kodvalv: båda kryssrutorna finns i markupen');
    },
  },
  'caret-shape-caret-color': {
    page: async (t, v) => {
      t.expect(await t.style('input', 'caret-color') === `rgb(${hexToRgb(v.acc).join(', ')})`, 'caret: sidan: caret-color är accentfärgen');
      t.expect(await t.style('input', 'caret-shape') === 'bar', 'caret: sidan: caret-shape: bar är aktiv (Chromium stöder det)');
      await t.page.locator(`${t.prefix} input`).click();
      await t.page.keyboard.type('Hej');
      t.expect(await t.value('input') === 'Hej', 'caret: sidan: fältet tar emot text (markören är synlig i fältet)');
    },
    isolated: async (t, v) => {
      t.expect(await t.style('input', 'caret-color') === `rgb(${hexToRgb(v.acc).join(', ')})`, 'caret: fristående kodvalv: caret-color följer Grundpaketet');
      t.expect(await t.attr('input', 'placeholder') === 'Klicka och skriv — markören är accentfärgad', 'caret: fristående kodvalv: platshållartexten är kvar');
    },
  },
  open: {
    page: async (t, v) => {
      t.expect(await t.page.locator(`${t.prefix} details`).first().evaluate((d) => d.open) === false, ':open: sidan: details är stängd från början');
      t.expect(await t.style('details', 'border-color') === `rgb(${hexToRgb(v.line).join(', ')})`, ':open: sidan: stängd kant har den neutrala linjefärgen');
      await t.page.locator(`${t.prefix} summary`).click();
      t.expect(await t.page.locator(`${t.prefix} details`).first().evaluate((d) => d.open) === true, ':open: sidan: klick på summary öppnar details');
      t.expect(await t.style('details', 'border-color') === `rgb(${hexToRgb(v.acc).join(', ')})`, ':open: sidan: :open ger accentfärgad kant');
      t.expect(await t.style('summary', 'color') === `rgb(${hexToRgb(v.acc).join(', ')})`, ':open: sidan: :open ger summary accentfärg');
    },
    isolated: async (t, v) => {
      await t.page.locator('summary').click();
      t.expect(await t.style('details', 'border-color') === `rgb(${hexToRgb(v.acc).join(', ')})`, ':open: fristående kodvalv: :open ger accentfärgad kant');
      t.expect((await t.text('p')).startsWith('När jag är öppen'), ':open: fristående kodvalv: texten är kvar');
    },
  },
  'appearance-base-select': {
    page: async (t) => {
      const supports = await t.page.evaluate(() => CSS.supports('appearance', 'base-select'));
      t.expect(await t.style('select', 'appearance') === (supports ? 'base-select' : 'auto'),
        `appearance: sidan: select följer @supports (base-select: ${supports})`);
      t.expect(await t.style('.select-fallback-note', 'display') === (supports ? 'none' : 'block'),
        'appearance: sidan: @supports not styr fallback-raden (kodvalvet visar båda grenarna)');
      t.expect(await t.count('option') === 3, 'appearance: sidan: de tre option-elementen finns kvar');
    },
    isolated: async (t) => {
      const supports = await t.page.evaluate(() => CSS.supports('appearance', 'base-select'));
      t.expect(await t.style('select', 'appearance') === (supports ? 'base-select' : 'auto'),
        'appearance: fristående kodvalv: @supports-blocket följde med i kodvalvet');
      t.expect(await t.style('.select-fallback-note', 'display') === (supports ? 'none' : 'block'),
        'appearance: fristående kodvalv: fallback-regeln ligger i rätt ordning');
      if (supports) {
        t.expect(await t.style('select', 'transition-property', '::picker-icon') === 'rotate',
          'appearance: fristående kodvalv: ::picker-icon har övergången rotate');
      }
    },
  },
  losenordsmatare: {
    page: async (t, v) => {
      const meter = () => t.style('.pwd-meter span', 'width');
      t.expect((await meter()) === '0px', 'lösenordsmätare: sidan: mätaren är tom innan något skrivits');
      await t.page.locator(`${t.prefix} input`).fill('abc');
      await settle(t);
      t.expect(await t.page.locator(`${t.prefix} input`).evaluate((i) => i.validity.patternMismatch) === true, 'lösenordsmätare: sidan: "abc" matchar inte pattern');
      t.expect(await t.style('.pwd-meter span', 'background-color') === `rgb(${hexToRgb(v.bad).join(', ')})`, 'lösenordsmätare: sidan: ogiltigt värde ger röd mätare (:invalid)');
      await t.page.locator(`${t.prefix} input`).fill('Abcdefg1');
      await settle(t);
      t.expect(await t.page.locator(`${t.prefix} input`).evaluate((i) => i.validity.valid) === true, 'lösenordsmätare: sidan: "Abcdefg1" är giltigt');
      t.expect(await t.style('.pwd-meter span', 'background-color') === `rgb(${hexToRgb(v.good).join(', ')})`, 'lösenordsmätare: sidan: giltigt värde ger grön mätare (:valid)');
      t.expect(await t.style('.pwd-meter span', 'width') !== '0px', 'lösenordsmätare: sidan: mätaren fylls');
    },
    isolated: async (t, v) => {
      await t.page.locator('input').fill('abc');
      await settle(t);
      t.expect(await t.style('.pwd-meter span', 'background-color') === `rgb(${hexToRgb(v.bad).join(', ')})`, 'lösenordsmätare: fristående kodvalv: :invalid ger röd mätare');
      await t.page.locator('input').fill('Abcdefg1');
      await settle(t);
      t.expect(await t.style('.pwd-meter span', 'background-color') === `rgb(${hexToRgb(v.good).join(', ')})`, 'lösenordsmätare: fristående kodvalv: :valid ger grön mätare');
      await t.page.locator('input').fill('');
      await settle(t);
      t.expect(await t.style('.pwd-meter span', 'width') === '0px', 'lösenordsmätare: fristående kodvalv: :placeholder-shown håller mätaren tom');
    },
  },
  'dubbeltumme-slider': {
    page: async (t, v) => {
      t.expect(await t.count('input[type="range"]') === 2, 'dubbeltumme: sidan: två range-reglage finns');
      t.expect(await t.attr('input[type="range"]', 'aria-label') === 'Lägsta pris', 'dubbeltumme: sidan: första reglaget har aria-label');
      t.expect(await t.style('input[type="range"]', 'pointer-events') === 'none', 'dubbeltumme: sidan: reglagen är genomsläppliga (tummarna tar emot)');
      t.expect(await t.style('.dual-track', 'background-color') === `rgb(${hexToRgb(v.line).join(', ')})`, 'dubbeltumme: sidan: spåret använder linjefärgen');
      const before = await t.value('input[type="range"]');
      await t.page.locator(`${t.prefix} input[type="range"]`).first().focus();
      await t.page.keyboard.press('ArrowRight');
      t.expect(Number(await t.value('input[type="range"]')) === Number(before) + 1, `dubbeltumme: sidan: piltangent flyttar tummen (${before} → ${await t.value('input[type="range"]')})`);
      t.expect(await t.style('input[type="range"]', 'appearance') === 'none', 'dubbeltumme: sidan: leverantörsstilen på tummen kräver appearance: none');
    },
    isolated: async (t) => {
      t.expect(await t.count('input[type="range"]') === 2, 'dubbeltumme: fristående kodvalv: båda reglagen finns i markupen');
      t.expect(await t.style('input[type="range"]', 'pointer-events') === 'none', 'dubbeltumme: fristående kodvalv: reglagen är genomsläppliga');
      t.expect(await t.style('.dual-track', 'height') === '4px', 'dubbeltumme: fristående kodvalv: spåret är 4px');
    },
  },
  'calc-size': {
    page: async (t) => {
      const h = () => t.page.evaluate((p) => document.querySelector(`${p} .calc-size-content`).getBoundingClientRect().height, t.prefix);
      t.expect((await h()) === 0, 'calc-size: sidan: innehållet är ihopfällt (höjd 0)');
      await t.page.locator(t.prefix + ' .calc-size-trigger').click();
      await settled(t.page, (p) => document.querySelector(`${p} .calc-size-content`).getBoundingClientRect().height, t.prefix);
      const open = await h();
      const invisible = await t.page.evaluate((p) => {
        const el = document.querySelector(`${p} .calc-size-content`);
        return el.scrollHeight - el.clientHeight;
      }, t.prefix);
      t.expect(open > 20, `calc-size: sidan: kryssrutan fäller ut innehållet (${open}px)`);
      t.expect(invisible === 0, `calc-size: sidan: inget innehåll klipps bort (scrollHeight − clientHeight = ${invisible}px)`);
      t.expect(await t.style('.calc-size-icon', 'transform') !== 'none', 'calc-size: sidan: ikonen roterar i öppet läge');
      await t.page.locator(t.prefix + ' .calc-size-trigger').click();
      await settled(t.page, (p) => document.querySelector(`${p} .calc-size-content`).getBoundingClientRect().height, t.prefix);
      t.expect((await h()) < 1, `calc-size: sidan: stängningen fäller ihop igen (${await h()}px)`);
    },
    isolated: async (t) => {
      t.expect(await t.page.evaluate(() => CSS.supports('height', 'calc-size(auto, size)')) === true, 'calc-size: fristående kodvalv: webbläsaren stöder calc-size()');
      await t.page.locator('.calc-size-trigger').click();
      await settled(t.page, () => document.querySelector('.calc-size-content').getBoundingClientRect().height, null);
      const invisible = await t.page.evaluate(() => {
        const el = document.querySelector('.calc-size-content');
        return el.scrollHeight - el.clientHeight;
      });
      t.expect(invisible === 0, `calc-size: fristående kodvalv: inget innehåll klipps bort vid utfällning (${invisible}px)`);
    },
  },
  attr: {
    page: async (t, v) => {
      const content = await t.page.evaluate((p) => getComputedStyle(document.querySelector(`${p} a`), '::after').content, t.prefix);
      t.expect(content === '" → exempel.se/a"', `attr: sidan: ::after visar data-url (${content})`);
      t.expect(await t.style('a', 'color') === `rgb(${hexToRgb(v.dim).join(', ')})`, 'attr: sidan: länken har dämpad färg i vila');
      await t.page.locator(t.prefix + ' a').first().hover();
      t.expect(await t.style('a', 'color') === `rgb(${hexToRgb(v.ink).join(', ')})`, 'attr: sidan: hover lyfter länken till full kontrast');
    },
    isolated: async (t, v) => {
      const all = await t.page.evaluate(() => [...document.querySelectorAll('.nd-attr a')].map((a) => getComputedStyle(a, '::after').content));
      t.expect(all.length === 2 && all[1] === '" → exempel.se/b"', `attr: fristående kodvalv: båda data-url:erna hamnar i ::after (${all.join(' | ')})`);
      t.expect(await t.style('a', 'text-decoration-line') === 'none', 'attr: fristående kodvalv: länkstilen följde med');
      t.expect(v.acc.length > 0, 'attr: fristående kodvalv: Grundpaketet ger --acc till ::after-färgen');
    },
  },
  if: {
    page: async (t, v) => {
      const supports = await t.page.evaluate(() => CSS.supports('background', 'if(style(--x: ja), red, blue)'));
      const bg = () => t.style('.kort', 'background-color');
      const color = () => t.style('.kort', 'color');
      t.expect(await t.rootStyle('--varning') === 'nej', 'if(): sidan: --varning är "nej" i utgångsläget');
      if (supports) {
        t.expect(await bg() === `rgb(${hexToRgb(v.bg2).join(', ')})`, 'if(): sidan: fallback-grenen ger vanlig kortbakgrund');
      }
      await t.page.locator(t.prefix + ' #nd-varna').check();
      t.expect(await t.rootStyle('--varning') === 'ja', 'if(): sidan: kryssrutan sätter --varning: ja via :has()');
      if (supports) {
        t.expect(await bg() === 'rgb(90, 29, 29)' && await color() === 'rgb(255, 215, 215)',
          'if(): sidan: if(style(--varning: ja) …) byter bakgrund och textfärg');
      } else {
        t.expect(await bg() === `rgb(${hexToRgb(v.bg2).join(', ')})` && await color() === `rgb(${hexToRgb(v.ink).join(', ')})`,
          'if(): sidan: utan stöd för if() används fallback-värdena (bg2/ink) — samma CSS, samma utfall i kodvalvet');
      }
    },
    isolated: async (t, v) => {
      const supports = await t.page.evaluate(() => CSS.supports('background', 'if(style(--x: ja), red, blue)'));
      await t.page.locator('#nd-varna').check();
      t.expect(await t.rootStyle('--varning') === 'ja', 'if(): fristående kodvalv: :has(#nd-varna:checked) sätter --varning');
      const bg = await t.style('.kort', 'background-color');
      t.expect(bg === (supports ? 'rgb(90, 29, 29)' : `rgb(${hexToRgb(v.bg2).join(', ')})`),
        `if(): fristående kodvalv: samma gren som på sidan (${bg})`);
    },
  },
  'light-dark': {
    page: async (t) => {
      t.expect(await t.style('.ld-light', 'background-color') === 'rgb(239, 233, 220)', 'light-dark: sidan: ljust kort blir ljust (color-scheme: light)');
      t.expect(await t.style('.ld-dark', 'background-color') === 'rgb(23, 20, 28)', 'light-dark: sidan: mörkt kort blir mörkt (color-scheme: dark)');
      t.expect(await t.style('.ld-light', 'color-scheme') === 'light', 'light-dark: sidan: color-scheme sätts per kort');
      await t.page.locator(t.cardSel('.jmf-knapp')).click();
      t.expect(await t.style('.ld-box', 'background-color') === 'rgb(23, 20, 28)', 'light-dark: sidan: jämförarens av-läge tvingar mörkt läge (live-only-CSS)');
      t.expect(await t.page.locator(t.cardSel('.jmf-lage')).evaluate((e) => getComputedStyle(e, '::after').content) === '"av"',
        'light-dark: sidan: jämförarens etikett visar "av"');
    },
    isolated: async (t) => {
      t.expect(await t.style('.ld-light', 'background-color') === 'rgb(239, 233, 220)', 'light-dark: fristående kodvalv: ljust kort');
      t.expect(await t.style('.ld-dark', 'background-color') === 'rgb(23, 20, 28)', 'light-dark: fristående kodvalv: mörkt kort');
      t.expect(await t.count('.ld-box') === 2, 'light-dark: fristående kodvalv: båda korten finns i markupen');
    },
  },
  /* ---- batch 2 (Grupp B-pilot): delad swatch-CSS ---------------------- */
  'color-mix': {
    page: async (t, v) => {
      // Den delade swatch-familjen finns på sidan …
      t.expect(await t.count('.swatch') === 5, 'color-mix: sidan: fem svatchar i raden');
      t.expect(await t.style('.swatch', 'display') === 'block', 'color-mix: sidan: .swatch är block (buggfix 2026-08-30)');
      t.expect(await t.style('.swatch', 'border-radius') === '10px', 'color-mix: sidan: .swatch har ramen från fragmentet');
      t.expect(await t.style('.swatch-yta', 'display') === 'block', 'color-mix: sidan: .swatch-yta är block — annars kollapsar höjden');
      t.expect(await t.style('.swatch-yta', 'height') === '51.1875px', 'color-mix: sidan: .swatch-yta har 3.2rem höjd');
      t.expect(await t.style('.swatch-lbl', 'background-color') === `rgb(${hexToRgb(v.bg2).join(', ')})`,
        'color-mix: sidan: .swatch-lbl får bakgrunden ur Grundpaketet');
      // … och demots egna regler ger en femkolumnsramp.
      t.expect(await t.rootStyle('display') === 'grid', 'color-mix: sidan: .cm-row är ett rutnät');
      t.expect((await t.rootStyle('grid-template-columns')).split(' ').length === 5,
        'color-mix: sidan: .cm-row har fem kolumner');
      const bgs = await t.page.evaluate((p) => [...document.querySelectorAll(`${p} .swatch-yta`)].map((e) => getComputedStyle(e).backgroundColor), t.prefix);
      t.expect(bgs.length === 5 && new Set(bgs).size === 5, `color-mix: sidan: fem distinkta färgsteg (${bgs.join(' | ')})`);
      // Labbet är sidans scenografi: --lv styr de live-only-reglerna.
      await t.page.locator(t.cardSel('.labb-steg input[data-v="0"]')).check();
      await settle(t);
      t.expect(await t.rootStyle('--lv') === '0', 'color-mix: sidan: labbet sätter --lv: 0 via :has()');
      // Med --lv: 0 ligger hela rampens topp kvar: alla fem steg blir lika.
      const flat = await t.page.evaluate((p) => [...document.querySelectorAll(`${p} .swatch-yta`)].map((e) => getComputedStyle(e).backgroundColor), t.prefix);
      t.expect(new Set(flat).size === 1,
        `color-mix: sidan: --lv: 0 jämnar ut hela rampen (${new Set(flat).size} distinkta steg, alla ${flat[0]})`);
    },
    isolated: async (t, v) => {
      t.expect(await t.count('.swatch') === 5, 'color-mix: fristående kodvalv: fem svatchar finns i markupen');
      t.expect(await t.style('.swatch', 'display') === 'block', 'color-mix: fristående kodvalv: .swatch är block');
      t.expect(await t.style('.swatch', 'border-top-width') === '1px', 'color-mix: fristående kodvalv: .swatch har ramen ur fragmentet');
      t.expect(await t.style('.swatch-yta', 'height') === '51.1875px', 'color-mix: fristående kodvalv: .swatch-yta har 3.2rem höjd');
      t.expect(await t.style('.swatch-yta', 'display') === 'block', 'color-mix: fristående kodvalv: .swatch-yta är block');
      t.expect(await t.rootStyle('display') === 'grid', 'color-mix: fristående kodvalv: .cm-row är ett rutnät');
      t.expect(await t.rootStyle('gap') === '8px', 'color-mix: fristående kodvalv: .cm-row har .5rem gap');
      const bgs = await t.page.evaluate(() => [...document.querySelectorAll('.swatch-yta')].map((e) => getComputedStyle(e).backgroundColor));
      t.expect(bgs.length === 5 && new Set(bgs).size === 5, `color-mix: fristående kodvalv: fem distinkta färgsteg (${bgs.join(' | ')})`);
      t.expect(await t.rootStyle('--lv') === '', 'color-mix: fristående kodvalv: ingen --lv-scenografi följer med');
      // Ingen variabel i kopian får vara olöst (annars saknas en deklaration).
      t.expect((await unresolvedVars(t.page)).length === 0,
        `color-mix: fristående kodvalv: alla var() löses upp (${(await unresolvedVars(t.page)).join(', ') || 'inga olösta'})`);
      // … och kopian får inte bära annan laboratorie-CSS än sin egen.
      const sel = (await snippetSelectors(t.page)).join(' ');
      t.expect(!/\.(rel-|gamut-|grad-|f-|filter-row)/.test(sel),
        `color-mix: fristående kodvalv: inga orelaterade labbregler (${sel.slice(0, 90)}…)`);
    },
  },
  'linear-gradient': {
    page: async (t, v) => {
      t.expect(await t.count('.swatch') === 1, 'linear-gradient: sidan: en enda svatch');
      t.expect(await t.style('.swatch', 'display') === 'block', 'linear-gradient: sidan: .swatch är block');
      t.expect(await t.style('.swatch-yta', 'height') === '96px', 'linear-gradient: sidan: .swatch-solo ger 6rem höjd');
      t.expect(await t.rootStyle('max-width') === '352px', 'linear-gradient: sidan: .swatch-solo ger 22rem bredd');
      t.expect((await t.style('.swatch-yta', 'background-image')).startsWith('linear-gradient(135deg'),
        'linear-gradient: sidan: .grad-1 ritar gradienten');
      t.expect((await t.style('.swatch-yta', 'background-image')).includes('rgb(255, 194, 94)'),
        'linear-gradient: sidan: gradienten börjar i accentfärgen ur Grundpaketet');
      await t.page.locator(t.cardSel('.labb-steg input[data-v="0"]')).check();
      await settle(t);
      t.expect(await t.rootStyle('--lv') === '0', 'linear-gradient: sidan: labbet sätter --lv: 0');
      t.expect((await t.style('.swatch-yta', 'background-image')).startsWith('linear-gradient(0deg'),
        'linear-gradient: sidan: --lv: 0 ger vinkel 0 (live-only-regeln)');
    },
    isolated: async (t, v) => {
      t.expect(await t.count('.swatch') === 1, 'linear-gradient: fristående kodvalv: en enda svatch');
      t.expect(await t.style('.swatch', 'border-top-width') === '1px', 'linear-gradient: fristående kodvalv: .swatch har ramen ur fragmentet');
      t.expect(await t.style('.swatch-yta', 'height') === '96px', 'linear-gradient: fristående kodvalv: .swatch-solo ger 6rem höjd');
      t.expect(await t.rootStyle('max-width') === '352px', 'linear-gradient: fristående kodvalv: .swatch-solo ger 22rem bredd');
      t.expect((await t.style('.swatch-yta', 'background-image')).startsWith('linear-gradient(135deg'),
        'linear-gradient: fristående kodvalv: .grad-1 ritar gradienten');
      t.expect(await t.rootStyle('--lv') === '', 'linear-gradient: fristående kodvalv: ingen --lv-scenografi följer med');
      t.expect((await unresolvedVars(t.page)).length === 0,
        `linear-gradient: fristående kodvalv: alla var() löses upp (${(await unresolvedVars(t.page)).join(', ') || 'inga olösta'})`);
      const sel = (await snippetSelectors(t.page)).join(' ');
      t.expect(!/\.(rel-|gamut-|grad-[2-9]|f-(blur|contrast|saturate|hue|sepia|gray|invert|drop)|filter-row|labbar)/.test(sel),
        `linear-gradient: fristående kodvalv: inga orelaterade labbregler (${sel.slice(0, 90)}…)`);
      t.expect(sel.includes('.grad-1'), 'linear-gradient: fristående kodvalv: demots egen .grad-1-regel finns kvar');
    },
  },
  donutdiagram: {
    page: async (t) => {
      t.expect((await t.style('.donut', 'mask-image')).startsWith('radial-gradient(closest-side'), 'donut: sidan: masken skär ut ringen');
      t.expect((await t.style('.donut', 'background-image')).startsWith('conic-gradient'), 'donut: sidan: konisk gradient ritar fördelningen');
      t.expect((await t.style('.donut', 'border-radius')) === '50%', 'donut: sidan: cirkeln har border-radius 50%');
      await t.page.locator(t.cardSel('.jmf-knapp')).click();
      t.expect(await t.style('.donut', 'mask-image') === 'none', 'donut: sidan: jämförarens av-läge tar bort masken');
    },
    isolated: async (t) => {
      t.expect((await t.style('.donut', 'mask-image')).startsWith('radial-gradient'), 'donut: fristående kodvalv: masken finns med');
      t.expect(await t.attr('.donut', 'role') === 'img' && (await t.attr('.donut', 'aria-label')).startsWith('Fördelning:'),
        'donut: fristående kodvalv: roll och aria-label följde med i markupen');
      t.expect(await t.count('.donut-legend b') === 3, 'donut: fristående kodvalv: tre förklaringar');
    },
  },
};

/** #rrggbb → [r, g, b] (Grundpaketets variabler är hex). */
function hexToRgb(hex) {
  const m = hex.trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

async function main() {
  /* Inventariet först: varje migrerad demo måste ha båda kontrollerna. */
  for (const id of MIGRATED_IDS) {
    assert(Boolean(CHECKS[id]), `#${id}: har en webbläsarkontroll`);
    assert(Boolean(CHECKS[id]?.page && CHECKS[id]?.isolated), `#${id}: kontrollerar både sidan och det fristående kodvalvet`);
  }
  const extra = Object.keys(CHECKS).filter((id) => !MIGRATED_IDS.includes(id));
  assert(extra.length === 0, `inga kontroller för icke-migrerade demos${extra.length ? `: ${extra.join(', ')}` : ''}`);

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

  const vars = await (async () => { await open('topp'); return baseVarsOf(page); })();

  for (const id of MIGRATED_IDS) {
    const code = snippet(`Kod för ${labelOf(html, id)}`) ?? snippet(id);
    await open(id);
    await page.evaluate(() => document.fonts.ready);
    await CHECKS[id].page(tools(page, `#${id} .demo-yta`, `#${id} `), vars);

    if (id === 'shape-outside') {
      assert(!code.includes('.jmfbar'), 'shape-outside: kodvalv: innehåller inte jämförarens live-only-regel');
      assert(!code.includes('class="jmf'), 'shape-outside: kodvalv: innehåller inte jämförarens markup');
    }
    // Kodvalvet ska aldrig bära sidans scenografi.
    assert(!/\.jmfbar|class="jmf/.test(code), `#${id}: kodvalvet innehåller ingen jämförar-scenografi`);

    await page.setContent(isolated(base, code));
    await page.evaluate(() => document.fonts.ready);
    await CHECKS[id].isolated(tools(page, '.demo-yta', ''), vars);
  }

  await page.goto('about:blank');
  assert((await page.goto(url)) && (await page.evaluate(() => document.scripts.length)) === 0, 'sidan: document.scripts.length === 0');
  assert((await page.evaluate(() => document.querySelectorAll('article.demo').length)) === 133, 'sidan: 133 demo-kort renderade');
  assert((await page.evaluate(() => {
    const html = document.documentElement.outerHTML;
    return (html.match(/<!-- demo:[a-z0-9-]+:markup -->/g)?.length ?? 0)
      + (html.match(/<!-- \/demo:[a-z0-9-]+:markup -->/g)?.length ?? 0);
  })) === MIGRATED_IDS.length * 2,
  `sidan: ${MIGRATED_IDS.length} migrerade kort har markup-markörer i DOM:en`);

  await browser.close();
  console.log('');
  if (failures) {
    console.error(`${failures} avvikelse(r).`);
    process.exit(1);
  }
  console.log(`Alla webbläsartest för de ${MIGRATED_IDS.length} källgenererade demona gröna.`);
}

/** Kodvalvets aria-label byggs ur kortets titel; slå upp den ur dokumentet. */
function labelOf(html, id) {
  const a = html.search(new RegExp(`<article class="demo[^"]*" id="${id}">`));
  const art = html.slice(a, html.indexOf('</article>', a));
  const m = art.match(/<textarea class="kod"[^>]*aria-label="Kod för ([^"]+)"/);
  return m ? m[1] : id;
}

main().catch((e) => { console.error(e); process.exit(1); });
