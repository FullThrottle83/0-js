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
  'rgb-from': {
    page: async (t, v) => {
      const row = await t.page.evaluate((p) => {
        const root = document.querySelector(p);
        const colors = [...root.querySelectorAll('.swatch-yta')].map((e) => getComputedStyle(e).backgroundColor);
        const rects = [...root.querySelectorAll('.swatch-yta')].map((e) => {
          const r = e.getBoundingClientRect(); return [r.width, r.height];
        });
        return { colors, rects, supportsRgb: CSS.supports('color', 'rgb(from rgb(10 20 30) r g b / .45)'),
          supportsHsl: CSS.supports('color', 'hsl(from red h s calc(l - 22))') };
      }, t.prefix);
      t.expect(await t.count('.swatch') === 5, 'rgb-from: sidan: fem relativa färgsvatchar finns');
      t.expect(row.supportsRgb && row.supportsHsl, 'rgb-from: Chromium stöder de använda rgb(from …) och hsl(from …)-uttrycken');
      t.expect(row.colors[0] === `rgb(${hexToRgb(v.acc).join(', ')})`,
        `rgb-from: sidan: bassteget följer --acc (${row.colors[0]})`);
      t.expect(row.colors.length === 5 && new Set(row.colors).size === 5,
        `rgb-from: sidan: relativa färger ger fem färgvariationer (${row.colors.join(' | ')})`);
      t.expect(row.rects.every(([w, h]) => w > 0 && h > 0),
        `rgb-from: sidan: alla ytor har mått större än noll (${JSON.stringify(row.rects)})`);
      await t.page.locator(t.cardSel('.labb-steg input[data-v="0"]')).check();
      await settle(t);
      const flat = await t.page.evaluate((p) => {
        const normalize = (color) => {
          const rgb = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)/);
          if (rgb) return rgb.slice(1, 4).map(Number).join(',');
          const srgb = color.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
          return srgb ? srgb.slice(1, 4).map((c) => Math.round(Number(c) * 255)).join(',') : color;
        };
        return [...document.querySelectorAll(`${p} .swatch-yta`)].map((e) => normalize(getComputedStyle(e).backgroundColor));
      }, t.prefix);
      t.expect(await t.rootStyle('--lv') === '0' && new Set(flat).size === 1,
        `rgb-from: sidan: laboratoriets lv-0 visar samma basfärg i alla kanaler (${flat.join(' | ')})`);
      await t.page.locator(t.cardSel('.labb-steg input[data-v="8"]')).check();
      await settle(t);
      const expanded = await t.page.evaluate((p) => [...document.querySelectorAll(`${p} .swatch-yta`)].map((e) => getComputedStyle(e).backgroundColor), t.prefix);
      t.expect(await t.rootStyle('--lv') === '8' && new Set(expanded).size === 5,
        'rgb-from: sidan: laboratoriets lv-8 visar fem beräknade variationer');
    },
    isolated: async (t, v) => {
      const colors = await t.page.evaluate(() => [...document.querySelectorAll('.swatch-yta')].map((e) => getComputedStyle(e).backgroundColor));
      t.expect(await t.count('.swatch') === 5, 'rgb-from: fristående: fem svatchar finns från källmarkupen');
      t.expect(await t.rootStyle('display') === 'grid' && (await t.rootStyle('grid-template-columns')).split(' ').length === 5,
        'rgb-from: fristående: eget rutnät i fem kolumner');
      t.expect(colors[0] === `rgb(${hexToRgb(v.acc).join(', ')})` && new Set(colors).size === 5,
        `rgb-from: fristående: Grundpaketets accent och relativa uttryck ger fem färger (${colors.join(' | ')})`);
      t.expect(await t.rootStyle('--lv') === '', 'rgb-from: fristående: ingen laboratorievariabel --lv krävs');
      t.expect((await unresolvedVars(t.page)).length === 0,
        `rgb-from: fristående: alla CSS-variabler löses upp (${(await unresolvedVars(t.page)).join(', ') || 'inga olösta'})`);
      const selectors = (await snippetSelectors(t.page)).join(' ');
      t.expect(!/\.labbar|\.gamut-|\.cm-row|\.grad-|\.filter-row|\.f-(blur|contrast|saturate|hue|sepia|gray|invert|drop)|\.swatch-solo/.test(selectors),
        'rgb-from: fristående: inga labb-, gamut-, blandnings-, solo-, gradient- eller filterregler följer med');
    },
  },
  'oklch-display-p3': {
    page: async (t) => {
      const result = await t.page.evaluate((p) => {
        const swatches = [...document.querySelectorAll(`${p} .swatch-yta`)];
        return {
          colors: swatches.map((e) => getComputedStyle(e).backgroundColor),
          rects: swatches.map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; }),
          oklch: CSS.supports('color', 'oklch(72% .30 45)'),
          p3: CSS.supports('color', 'color(display-p3 1 .55 .1)'),
        };
      }, t.prefix);
      t.expect(await t.count('.swatch') === 4, 'oklch/display-p3: sidan: fyra färgprover finns');
      t.expect(result.oklch && result.p3, 'oklch/display-p3: Chromium stöder båda direkta färgsyntaxyperna');
      const expected = ['oklch(0.72 0.12 45)', 'oklch(0.72 0.3 45)',
        'color(display-p3 1 0.55 0.1)', 'oklch(0.85 0.25 145)'];
      t.expect(JSON.stringify(result.colors) === JSON.stringify(expected),
        `oklch/display-p3: exakta oklch/P3-färger vinner utan fallback (${result.colors.join(' | ')})`);
      t.expect(result.rects.every(([w, h]) => w > 0 && h > 0),
        `oklch/display-p3: alla ytor har mått större än noll (${JSON.stringify(result.rects)})`);
      t.expect(await t.rootStyle('display') === 'grid' && (await t.rootStyle('grid-template-columns')).split(' ').length === 4,
        'oklch/display-p3: sidan använder ett fyrkolumnsrutnät');
    },
    isolated: async (t) => {
      const result = await t.page.evaluate(() => ({
        colors: [...document.querySelectorAll('.swatch-yta')].map((e) => getComputedStyle(e).backgroundColor),
        rects: [...document.querySelectorAll('.swatch-yta')].map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; }),
        oklch: CSS.supports('color', 'oklch(72% .30 45)'),
        p3: CSS.supports('color', 'color(display-p3 1 .55 .1)'),
      }));
      const expected = ['oklch(0.72 0.12 45)', 'oklch(0.72 0.3 45)',
        'color(display-p3 1 0.55 0.1)', 'oklch(0.85 0.25 145)'];
      t.expect(result.oklch && result.p3 && JSON.stringify(result.colors) === JSON.stringify(expected),
        `oklch/display-p3: fristående: Grundpaketet + kodvalvet ger exakta oklch/P3-färger (${result.colors.join(' | ')})`);
      t.expect(await t.count('.swatch') === 4 && result.rects.every(([w, h]) => w > 0 && h > 0),
        `oklch/display-p3: fristående: fyra svatchar med icke-noll mått (${JSON.stringify(result.rects)})`);
      t.expect(await t.rootStyle('display') === 'grid' && (await t.rootStyle('grid-template-columns')).split(' ').length === 4,
        'oklch/display-p3: fristående: layouten fungerar i fyra kolumner');
      t.expect(await t.rootStyle('--lv') === '', 'oklch/display-p3: fristående: ingen laboratorievariabel krävs');
      t.expect((await unresolvedVars(t.page)).length === 0,
        `oklch/display-p3: fristående: alla CSS-variabler löses upp (${(await unresolvedVars(t.page)).join(', ') || 'inga olösta'})`);
      const selectors = (await snippetSelectors(t.page)).join(' ');
      t.expect(!/\.labbar|\.rel-|\.cm-row|\.grad-|\.filter-row|\.f-(blur|contrast|saturate|hue|sepia|gray|invert|drop)|\.swatch-solo/.test(selectors),
        'oklch/display-p3: fristående: inga scenografi-, relativa, blandnings-, solo-, gradient- eller filterregler följer med');
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

// Each gradient has a distinct expected standalone declaration. The tests use
// the actual generated textarea (main()), never the canonical source file.
const GRADIENTS = [
  ['radial-gradient', 2, 'radial-gradient(circle at 30% 30%, var(--acc), var(--bg2) 75%)'],
  ['conic-gradient', 3, 'conic-gradient(from 90deg, var(--acc), var(--bg2), var(--acc))'],
  ['repeating-linear-gradient', 4, 'repeating-linear-gradient(45deg, var(--acc) 0 6px, transparent 6px 14px)'],
  ['repeating-radial-gradient', 5, 'repeating-radial-gradient(circle at 50% 50%, var(--acc) 0 3px, transparent 3px 9px)'],
];
for (const [id, n, declaration] of GRADIENTS) {
  CHECKS[id] = {
    page: async t => {
      t.expect(await t.count('.swatch') === 1, `${id}: one live swatch`);
      t.expect(await t.style('.swatch-yta', 'height') === '96px', `${id}: shared live geometry`);
      const values = [];
      for (const lv of [0, 8]) {
        await t.page.locator(t.cardSel(`.labb-steg input[data-v="${lv}"]`)).check();
        await settle(t);
        t.expect(await t.rootStyle('--lv') === String(lv), `${id}: control sets --lv=${lv}`);
        values.push(await t.style('.swatch-yta', 'background-image'));
      }
      t.expect(values.every(v => v.startsWith(id + '(')) && values[0] !== values[1], `${id}: laboratory changes the rendered gradient declaration`);
    },
    isolated: async t => {
      const result = await t.page.evaluate(([prefix, expected]) => {
        const root = document.querySelector(prefix);
        const surface = root.querySelector('.swatch-yta');
        const probe = document.createElement('span');
        probe.style.backgroundImage = expected;
        root.append(probe);
        const reference = getComputedStyle(probe).backgroundImage;
        probe.remove();
        const r = surface.getBoundingClientRect();
        return { actual: getComputedStyle(surface).backgroundImage, reference, width: r.width, height: r.height };
      }, [t.prefix, declaration]);
      t.expect(result.actual.startsWith(id + '(') && result.actual === result.reference,
        `${id}: standalone rendered gradient has expected type, colors, position/angle and stops (${result.actual})`);
      // Inspect the actual painted interior, not just CSS syntax/computed text.
      const png = await t.page.locator(`${t.prefix} .swatch-yta`).screenshot();
      const paintedColors = await t.page.evaluate(async data => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + data;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(10, 10, image.width - 20, image.height - 20).data;
        const colors = new Set();
        for (let i = 0; i < pixels.length; i += 4) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
        return colors.size;
      }, png.toString('base64'));
      t.expect(paintedColors > 1, `${id}: standalone gradient actually paints a nonuniform interior (${paintedColors} colors)`);
      t.expect(result.width > 0 && result.height === 96, `${id}: standalone swatch has nonzero width and 6rem height`);
      t.expect(await t.rootStyle('max-width') === '352px' && await t.style('.swatch', 'border-top-width') === '1px', `${id}: both shared fragments apply`);
      t.expect(await t.rootStyle('--lv') === '', `${id}: no --lv dependency`);
      t.expect((await unresolvedVars(t.page)).length === 0, `${id}: every custom property resolves`);
      const selectors = await snippetSelectors(t.page);
      t.expect(selectors.includes(`.grad-${n} .swatch-yta`), `${id}: own selector present`);
      t.expect(!/\.(labbar|cm-row|rel-|gamut-|filter-row|f-)/.test(selectors.join(' '))
        && selectors.filter(s => /\.grad-/.test(s)).length === 1, `${id}: no unrelated chapter or filter rules`);
    },
  };
}

/* ---- batch 5 (Grupp B — filterfamiljen) -------------------------------- */

/**
 * Det delade fyrskiktade motivet, i den ordning lagren målas (överst först).
 * Ägs av demos/_delat/filter-motiv.css — den enda plats där det står.
 */
export const MOTIF_LAYERS = [
  'radial-gradient(circle at 22% 28%, #fff 0 7%, transparent 8%)',
  'radial-gradient(circle at 74% 68%, rgb(255 255 255 / .55) 0 5%, transparent 6%)',
  'repeating-linear-gradient(90deg, rgb(0 0 0 / .22) 0 6px, transparent 6px 18px)',
  'linear-gradient(120deg, var(--acc), #6ea8ff 60%, #ff6ab0)',
];

/**
 * Beräknad referens för en deklaration: samma dokument, samma variabler, så
 * att jämförelsen aldrig hänger på hur webbläsaren råkar serialisera värdet.
 */
const referenceFor = (t, prop, declaration) => t.page.evaluate(([prefix, prop, decl]) => {
  const probe = document.createElement('span');
  document.querySelector(prefix).append(probe);
  probe.style.setProperty(prop, decl);
  const value = getComputedStyle(probe).getPropertyValue(prop);
  probe.remove();
  return value;
}, [t.prefix, prop, declaration]);

/**
 * Målat bevis för ett filter. Två kloner av demots yta renderas i samma
 * dokument på hela pixelpositioner: den ena med demots filterklass, den andra
 * utan. Båda bär det delade motivet — .f-motiv sitter på svatchen och tas
 * inte bort — så den enda skillnaden är filtret. Pixlarna läses ur riktiga
 * elementskärmbilder; inget påstående bygger på deklarationstext.
 */
async function paintPair(t, cls, { clip = true } = {}) {
  await t.page.evaluate(([prefix, cls, clip]) => {
    const root = document.querySelector(prefix);
    for (const [key, keep] of [['a', true], ['b', false]]) {
      const host = document.createElement('div');
      host.id = `motiv-prov-${key}`;
      // Hela pixelpositioner: annars hamnar de två klonerna på olika
      // delpixelrader och per-pixeljämförelsen mäter lägesbrus, inte färg.
      host.style.cssText = `position:fixed;left:0;top:${key === 'a' ? 0 : 150}px;`
        + 'background:#000;padding:12px;width:30rem;box-sizing:content-box';
      const clone = root.cloneNode(true);
      if (!keep) clone.querySelector('.swatch').classList.remove(cls);
      if (!clip) clone.querySelectorAll('.swatch').forEach((s) => { s.style.overflow = 'visible'; });
      host.append(clone);
      document.body.append(host);
    }
  }, [t.prefix, cls, clip]);

  const shots = {};
  for (const key of ['a', 'b']) {
    shots[key] = (await t.page.locator(`#motiv-prov-${key} .swatch-yta`).screenshot()).toString('base64');
    shots[`host-${key}`] = (await t.page.locator(`#motiv-prov-${key}`).screenshot()).toString('base64');
  }

  const out = await t.page.evaluate(async (shots) => {
    const load = async (data) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + data;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      return { w: image.width, h: image.height, data: ctx.getImageData(0, 0, image.width, image.height).data };
    };
    const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const satOf = (d, i) => Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
    const hueOf = (d, i) => {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min;
      if (c === 0) return null;
      const h = max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
      return ((h * 60) + 360) % 360;
    };
    const round = (n, p = 2) => Number(n.toFixed(p));
    /** Insätt 3 px: kanterna påverkas av rundning i skärmbilden. */
    const stats = (img) => {
      const d = img.data;
      const INSET = 3;
      let meanLuma = 0, meanSat = 0, maxSat = 0, sharp = 0, rb = 0, n = 0, hx = 0, hy = 0, hn = 0;
      const lumor = [];
      for (let y = INSET; y < img.h - INSET; y++) {
        for (let x = INSET; x < img.w - INSET; x++) {
          const i = (y * img.w + x) * 4;
          const l = luma(d, i);
          lumor.push(l);
          meanLuma += l; meanSat += satOf(d, i); maxSat = Math.max(maxSat, satOf(d, i));
          rb += d[i] - d[i + 2]; n++;
          const hue = hueOf(d, i);
          if (hue !== null) { const a = hue * Math.PI / 180; hx += Math.cos(a); hy += Math.sin(a); hn++; }
        }
      }
      for (let y = INSET; y < img.h - INSET; y++) {
        for (let x = INSET; x < img.w - INSET - 1; x++) {
          const i = (y * img.w + x) * 4, j = i + 4;
          sharp += Math.abs(luma(d, i) - luma(d, j)) + Math.abs(d[i + 1] - d[j + 1]);
        }
      }
      const mean = meanLuma / n;
      let variance = 0;
      for (const l of lumor) variance += (l - mean) ** 2;
      return {
        w: img.w, h: img.h,
        meanLuma: round(meanLuma / n),
        stdLuma: round(Math.sqrt(variance / n)),
        meanSat: round(meanSat / n),
        maxSat,
        sharpness: round(sharp / n, 3),
        meanRminusB: round(rb / n),
        meanHue: round((Math.atan2(hy / hn, hx / hn) * 180 / Math.PI + 360) % 360, 1),
      };
    };
    /** Ljus och värme i randen ovanför ytan (innanför provrutans utfyllnad). */
    const ring = (img) => {
      const d = img.data;
      let sum = 0, warm = 0, n = 0;
      for (let y = 3; y < 12; y++) {
        for (let x = 12; x < img.w - 12; x++) {
          const i = (y * img.w + x) * 4;
          sum += luma(d, i); warm += d[i] - d[i + 2]; n++;
        }
      }
      return { luma: round(sum / n), warm: round(warm / n) };
    };
    const A = await load(shots.a);
    const B = await load(shots.b);
    let invDiff = 0, absDiff = 0, px = 0;
    const INSET = 3;
    for (let y = INSET; y < A.h - INSET; y++) {
      for (let x = INSET; x < A.w - INSET; x++) {
        const i = (y * A.w + x) * 4;
        invDiff += Math.abs(A.data[i] - (255 - B.data[i]));
        absDiff += Math.abs(A.data[i] - B.data[i]);
        px++;
      }
    }
    return {
      filtered: stats(A),
      reference: stats(B),
      inverted: round(invDiff / px),
      changed: round(absDiff / px),
      ringFiltered: ring(await load(shots['host-a'])),
      ringReference: ring(await load(shots['host-b'])),
    };
  }, shots);

  await t.page.evaluate(() => {
    document.getElementById('motiv-prov-a').remove();
    document.getElementById('motiv-prov-b').remove();
  });
  return out;
}

/**
 * Ett filter per demo. `lab(lv)` är sidans laboratorieregel (live-only),
 * `own` är deklarationen som faktiskt kopieras, och `paint` är påståendet om
 * de målade pixlarna — inte bara om den beräknade deklarationen.
 */
const FILTERS = [
  {
    id: 'filter-blur', cls: 'f-blur', own: 'blur(3px)', dflt: 3,
    lab: (lv) => `blur(${lv}px)`,
    paint: (m) => [m.filtered.sharpness < m.reference.sharpness * 0.75,
      `suddet jämnar ut motivet (skärpa ${m.filtered.sharpness} mot ${m.reference.sharpness} ofiltrerat)`],
  },
  {
    id: 'filter-contrast', cls: 'f-contrast', own: 'contrast(2.1)', dflt: 4,
    lab: (lv) => `contrast(${lv * 50}%)`,
    paint: (m) => [m.filtered.stdLuma > m.reference.stdLuma * 1.3,
      `mellantonerna sprids (standardavvikelse ${m.filtered.stdLuma} mot ${m.reference.stdLuma})`],
  },
  {
    id: 'filter-saturate', cls: 'f-saturate', own: 'saturate(2.6)', dflt: 5,
    lab: (lv) => `saturate(${lv * 50}%)`,
    paint: (m) => [m.filtered.meanSat > m.reference.meanSat * 1.6,
      `mättnaden växer (${m.filtered.meanSat} mot ${m.reference.meanSat})`],
  },
  {
    id: 'filter-hue-rotate', cls: 'f-hue', own: 'hue-rotate(120deg)', dflt: 3,
    lab: (lv) => `hue-rotate(${lv * 45}deg)`,
    paint: (m) => {
      const shift = ((m.filtered.meanHue - m.reference.meanHue) % 360 + 360) % 360;
      return [shift > 90 && shift < 150,
        `nyansen flyttas runt hjulet (${shift.toFixed(1)}° · ${m.reference.meanHue}° → ${m.filtered.meanHue}°)`];
    },
  },
  {
    id: 'filter-sepia', cls: 'f-sepia', own: 'sepia(.85)', dflt: 7,
    lab: (lv) => `sepia(${lv * 12.5}%)`,
    paint: (m) => [m.filtered.meanRminusB > m.reference.meanRminusB + 40 && m.filtered.meanSat < m.reference.meanSat,
      `paletten dras mot brunt (r−b ${m.filtered.meanRminusB} mot ${m.reference.meanRminusB}, mättnad ${m.filtered.meanSat} mot ${m.reference.meanSat})`],
  },
  {
    id: 'filter-grayscale', cls: 'f-gray', own: 'grayscale(1)', dflt: 8,
    lab: (lv) => `grayscale(${lv * 12.5}%)`,
    paint: (m) => [m.filtered.maxSat <= 8 && m.filtered.meanSat <= 1 && m.reference.meanSat > 40
      && Math.abs(m.filtered.meanLuma - m.reference.meanLuma) < 2,
      `färgen försvinner, ljusheten står kvar (mättnad ${m.filtered.meanSat}, max ${m.filtered.maxSat}, ljus ${m.filtered.meanLuma} mot ${m.reference.meanLuma})`],
  },
  {
    id: 'filter-invert', cls: 'f-invert', own: 'invert(1)', dflt: 8,
    lab: (lv) => `invert(${lv * 12.5}%)`,
    paint: (m) => [m.inverted <= 2 && m.changed > 60,
      `varje pixel blir sin motsats (medelavvikelse från 255−original ${m.inverted}, ändring ${m.changed})`],
  },
  {
    id: 'filter-drop-shadow', cls: 'f-drop', own: 'drop-shadow(0 0 8px var(--acc)) brightness(.9)', dflt: 4,
    lab: (lv) => `drop-shadow(0 0 ${lv * 2}px var(--acc)) brightness(.9)`,
    paint: (m) => [(m.filtered.meanLuma / m.reference.meanLuma > 0.85) && (m.filtered.meanLuma / m.reference.meanLuma < 0.95),
      `brightness(.9) dämpar ytan (ljus ${m.filtered.meanLuma} mot ${m.reference.meanLuma})`],
  },
];

for (const f of FILTERS) {
  CHECKS[f.id] = {
    page: async (t) => {
      t.expect(await t.count('.swatch') === 1, `${f.id}: sidan: en enda svatch`);
      t.expect(await t.style('.swatch-yta', 'height') === '96px', `${f.id}: sidan: delad .swatch-solo-geometri`);
      t.expect(await t.rootStyle('max-width') === '352px', `${f.id}: sidan: delad .swatch-solo-bredd`);
      // Det delade motivet: alla fyra lager, i rätt ordning.
      const bg = await t.style('.swatch-yta', 'background-image');
      t.expect(bg === await referenceFor(t, 'background-image', MOTIF_LAYERS.join(', ')),
        `${f.id}: sidan: det fyrskiktade motivet i rätt ordning`);
      // Standardläget är laboratoriets värde (live-only-regeln vinner).
      t.expect(await t.style('.swatch-yta', 'filter') === await referenceFor(t, 'filter', f.lab(f.dflt)),
        `${f.id}: sidan: laboratoriets standardvärde ger ${f.lab(f.dflt)}`);
      const seen = [];
      for (const lv of [0, 8]) {
        await t.page.locator(t.cardSel(`.labb-steg input[data-v="${lv}"]`)).check();
        await settle(t);
        t.expect(await t.rootStyle('--lv') === String(lv), `${f.id}: sidan: reglaget sätter --lv=${lv}`);
        const value = await t.style('.swatch-yta', 'filter');
        seen.push(value);
        t.expect(value === await referenceFor(t, 'filter', f.lab(lv)),
          `${f.id}: sidan: --lv: ${lv} ger ${f.lab(lv)} (live-only-regeln)`);
      }
      t.expect(seen[0] !== seen[1], `${f.id}: sidan: laboratoriet ändrar filtret (${seen.join(' → ')})`);
    },
    isolated: async (t, v) => {
      const surface = await t.page.evaluate((prefix) => {
        const el = document.querySelector(`${prefix} .swatch-yta`);
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height, filter: getComputedStyle(el).filter, bg: getComputedStyle(el).backgroundImage };
      }, t.prefix);
      t.expect(surface.w > 0 && surface.h === 96,
        `${f.id}: fristående kodvalv: ytan har mått (${surface.w}×${surface.h} px)`);
      t.expect(surface.bg === await referenceFor(t, 'background-image', MOTIF_LAYERS.join(', ')),
        `${f.id}: fristående kodvalv: det kompletta fyrskiktade motivet ur fragmentet`);
      t.expect(surface.filter === await referenceFor(t, 'filter', f.own),
        `${f.id}: fristående kodvalv: endast det egna filtret (${surface.filter})`);
      t.expect(await t.rootStyle('--lv') === '', `${f.id}: fristående kodvalv: ingen --lv-scenografi krävs`);
      t.expect((await unresolvedVars(t.page)).length === 0,
        `${f.id}: fristående kodvalv: alla var() löses upp (${(await unresolvedVars(t.page)).join(', ') || 'inga olösta'})`);
      const selectors = await snippetSelectors(t.page);
      t.expect(selectors.includes(`.${f.cls} .swatch-yta`) && selectors.includes('.f-motiv .swatch-yta'),
        `${f.id}: fristående kodvalv: egen filterregel och delat motiv`);
      const filterSelectors = selectors.filter((s) => /\.f-/.test(s)).sort();
      const expectedFilterSelectors = [
        '.f-motiv .swatch-yta',
        `.${f.cls} .swatch-yta`,
        ...(f.id === 'filter-drop-shadow' ? ['.f-drop'] : []),
      ].sort();
      t.expect(JSON.stringify(filterSelectors) === JSON.stringify(expectedFilterSelectors),
        `${f.id}: fristående kodvalv: enbart delat motiv, eget filter${f.id === 'filter-drop-shadow' ? ' och egen overflow-korrigering' : ''} (${filterSelectors.join(', ')})`);
      t.expect(!/\.(labbar|cm-row|rel-|gamut-|grad-|filter-row)/.test(selectors.join(' ')),
        `${f.id}: fristående kodvalv: ingen laboratorie-, blandnings-, relativ-, gamut- eller gradient-CSS`);
      // Det målade beviset: filtret måste synas i pixlarna på motivet.
      const m = await paintPair(t, f.cls);
      t.expect(m.filtered.w === m.reference.w && m.filtered.h === m.reference.h,
        `${f.id}: fristående kodvalv: filtrerat och ofiltrerat prov har samma mått`);
      t.expect(m.changed > 1,
        `${f.id}: fristående kodvalv: filtret ändrar de målade pixlarna (${m.changed})`);
      const [ok, message] = f.paint(m);
      t.expect(ok, `${f.id}: fristående kodvalv: ${message}`);
      t.expect(v.acc.startsWith('#'), `${f.id}: Grundpaketets accent används av motivet`);
      if (f.id === 'filter-drop-shadow') {
        // Regression: .swatch { overflow: hidden } used to erase the entire
        // outer shadow. The assertion samples the host screenshot outside the
        // swatch-yta bounds, so a brighter interior alone cannot satisfy it.
        t.expect(await t.style('.swatch', 'overflow') === 'visible',
          'drop-shadow: fristående kodvalv: endast drop-shadow-swatchen öppnar overflow');
        t.expect(m.ringFiltered.luma > 1 && m.ringFiltered.warm > 1 && m.ringReference.luma < 1,
          `drop-shadow: fristående kodvalv: skuggan målar utanför formen (ljus ${m.ringFiltered.luma}, värme ${m.ringFiltered.warm} mot ${m.ringReference.luma} ofiltrerat)`);
      }
    },
  };
}

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

  /* Det delade motivet: en publicerad regel, exakt åtta konsumenter. */
  const motif = await page.evaluate(() => {
    const rules = [...document.styleSheets].flatMap((s) => [...s.cssRules])
      .filter((r) => (r.selectorText ?? '').includes('.f-motiv'));
    return {
      rules: rules.map((r) => r.selectorText),
      cards: [...document.querySelectorAll('article.demo')].filter((a) => a.querySelector('.f-motiv')).map((a) => a.id),
      surfaces: [...document.querySelectorAll('.f-motiv .swatch-yta')].map((e) => {
        const s = getComputedStyle(e);
        return { layers: (s.backgroundImage.match(/-gradient\(/g) ?? []).length, filter: s.filter };
      }),
    };
  });
  assert(motif.rules.length === 1 && motif.rules[0] === '.f-motiv .swatch-yta',
    `sidan: motivet publiceras av exakt en regel (${motif.rules.join(' | ')})`);
  assert(motif.cards.length === 8 && motif.surfaces.length === 8,
    `sidan: exakt åtta filterkort bär motivklassen (${motif.cards.join(', ')})`);
  assert(motif.surfaces.every((s) => s.layers === 4 && s.filter !== 'none'),
    `sidan: varje filteryta har fyra lager och ett aktivt filter (${JSON.stringify(motif.surfaces)})`);

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
