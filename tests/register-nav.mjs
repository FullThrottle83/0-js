#!/usr/bin/env node
/**
 * tests/register-nav.mjs — Nivå 2: A–Ö-registret och kortens vägvisare i en
 * riktig webbläsare (Playwright + Chromium).
 *
 * UX-kontraktet (tests/ux-polish.mjs) mäter gränssnittet runt demona.
 * Det här testet mäter den nya navigeringen och dess påståenden är knutna till
 * de uppmätta brister som låg bakom ändringen (se PR-beskrivningen):
 *
 *  1. En teknik ska gå att hitta på NAMN utan att veta kapitel: registret
 *     täcker alla 134 indexrader exakt en gång, och varje rad ligger i den
 *     grupp dess namn börjar på.
 *  2. Uppmätt skillnad mot kapitelindexet: antalet rader ovanför målet och
 *     avståndet till målraden i panelen (före: "subgrid" låg 32 rader och
 *     ~1 670 px ned i en 844 px hög panel).
 *  3. Bokstavsankarna fungerar: mål, träffyta ≥ 24 px, rubriken hamnar fritt
 *     under panelhuvudet efter klick.
 *  4. Tangentbord: växlaren nås och aktiveras med Tab/Space, ankare och
 *     registerlänkar får synlig fokusring, och den VY SOM INTE VISAS är inte
 *     tabbbar (display:none ger inga dolda tab-stopp).
 *  5. Kortens vägvisare: "I registret: X" öppnar panelen med rätt grupp, och
 *     "Kapitel NN · …" scrollar till kapitlets sektion utan att hamna under
 *     den sticky headern.
 *  6. Djuplänkar och webbläsarens bakåtknapp: fragment-URL:er fungerar och
 *     bakåt från ett demo återställer föregående fragment.
 *  7. Mobil: panelen öppnas, navigerar och stängs i registervyn (den
 *     befintliga :target-modellen är orörd).
 *  8. Ingen horisontell sidscroll och noll skript vid 320–1440 px.
 *  9. Filtret gäller även registret: samma antal synliga registerrader som
 *     synliga kort.
 *
 * Kräver webbläsare:
 *   npm install && npx playwright install chromium
 *   node tests/register-nav.mjs
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

const ok = (m) => console.log(`✓ ${m}`);
const fail = (m) => { console.error(`✗ ${m}`); failures++; };
const assert = (c, m) => (c ? ok(m) : fail(m));

/** Representativa tekniker: kapitel I, II, III och V — spridda i listan. */
const TARGETS = [
  { id: 'grid-template-rows-subgrid', group: 'reg-g', label: 'G', view: 'chapter', name: 'subgrid' },
  { id: 'property', group: 'reg-at', label: '@', view: 'register', name: '@property' },
  { id: 'has-som-temavaxlare', group: 'reg-pseudo', label: ':', view: 'register', name: ':has()' },
  { id: 'popover-attributet', group: 'reg-p', label: 'P', view: 'chapter', name: 'popover' },
];

async function main() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('Kunde inte läsa in playwright. Kör först: npm install && npx playwright install chromium');
    process.exit(1);
  }

  const browser = await chromium.launch();
  const url = 'file://' + join(root, 'index.html');
  const open = async (width, height = 900, hash = '') => {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(url + hash, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    return page;
  };

  try {
    /* 1. Registret täcker indexet exakt en gång ---------------------- */
    {
      const page = await open(1440);
      const data = await page.evaluate(() => {
        const chapterRows = [...document.querySelectorAll('nav.index .index-rad a')].map((a) => a.getAttribute('href'));
        const regRows = [...document.querySelectorAll('.register .reg-rad a')].map((a) => a.getAttribute('href'));
        const groups = [...document.querySelectorAll('.reg-avsnitt')].map((s) => ({
          id: s.id,
          anchor: document.querySelector(`.reg-abc a[href="#${s.id}"]`) !== null,
          rows: [...s.querySelectorAll('.reg-rad a')].map((a) => ({
            href: a.getAttribute('href'),
            name: a.querySelector('.reg-namn')?.textContent.trim() ?? '',
            dots: a.querySelectorAll('.prikkar b').length,
          })),
        }));
        return { chapterRows, regRows, groups };
      });
      assert(data.chapterRows.length === 134, `kapitelindexet har ${data.chapterRows.length} rader (133 demos + ordlistan)`);
      assert(data.regRows.length === data.chapterRows.length, `registret har lika många rader (${data.regRows.length})`);
      assert(new Set(data.regRows).size === data.regRows.length, 'varje teknik finns exakt en gång i registret');
      assert(
        [...data.regRows].sort().join(',') === [...data.chapterRows].sort().join(','),
        'registret och kapitelindexet pekar på exakt samma id:n'
      );
      assert(
        data.groups.every((g) => g.anchor),
        `varje grupp (${data.groups.length}) har ett bokstavsankare`
      );
      const SYMBOL_GROUPS = { at: '@', pseudo: ':', element: '<', siffror: '0-9', ovrigt: 'övrigt' };
      const wrongGroup = [];
      for (const g of data.groups) {
        const key = g.id.replace('reg-', '');
        for (const row of g.rows) {
          const first = [...row.name.trim()][0] ?? '';
          const symbol = key in SYMBOL_GROUPS;
          let expect;
          if (symbol) {
            const ch = SYMBOL_GROUPS[key];
            expect = ch === '0-9' ? /[0-9]/.test(first) : ch === 'övrigt' ? !/[a-zA-ZåäöÅÄÖ@:<0-9]/.test(first) : first === ch;
          } else {
            expect = first.toLocaleUpperCase('sv') === key.toLocaleUpperCase('sv');
          }
          if (!expect) wrongGroup.push(`${row.href} (${first}) i ${g.id}`);
          if (row.dots !== 4) wrongGroup.push(`${row.href} har ${row.dots} stödmarkörer`);
        }
      }
      assert(wrongGroup.length === 0, `varje rad ligger i sin egen grupp (@, :, <, siffror och A–Ö)${wrongGroup.length ? ` — ${wrongGroup.slice(0, 3).join(' | ')}` : ''}`);
      const labels = data.groups.map((g) => g.id.replace('reg-', ''));
      assert(
        labels[0] === 'at' && labels[1] === 'pseudo' && labels[2] === 'element' && labels[3] === 'siffror',
        `teckengrupperna står först och är var för sig små (${data.groups.slice(0, 4).map((g) => `${g.id.replace('reg-', '')}:${g.rows.length}`).join(' ')})`
      );
      const biggest = Math.max(...data.groups.map((g) => g.rows.length));
      assert(biggest <= 17, `ingen grupp är större än ett litet kapitel (största: ${biggest} rader)`);
      assert(labels.includes('pseudo') && labels.includes('at'), 'både @-regler och pseudoklasser har egen ingång');
      const sv = data.groups.map((g) => g.id);
      assert(sv.includes('reg-s') && sv.includes('reg-v'), `svenska tecken hanteras (grupper: ${labels.join(' ')})`);

      /* Dold vy = inga synliga länkar (och därmed inga dolda tab-stopp). */
      const hidden = await page.evaluate(() => ({
        registerVisible: [...document.querySelectorAll('.register a')].filter((a) => a.checkVisibility()).length,
        chapterVisible: [...document.querySelectorAll('nav.index a')].filter((a) => a.checkVisibility()).length,
      }));
      assert(hidden.registerVisible === 0, 'kapitelvyn (standard): registrets länkar är inte renderade');
      assert(hidden.chapterVisible === 134, `kapitelvyn visar alla sina ${hidden.chapterVisible} rader`);
      await page.close();
    }

    /* 2. Uppmätt skillnad: kapitelindexet mot registret ---------------- */
    {
      const page = await open(1440);
      const measure = async (container) =>
        page.evaluate(
          ([ids, scope]) => {
            const panel = document.querySelector('.sidomeny');
            const panelBox = panel.getBoundingClientRect();
            const set = new Set(ids);
            const links = [...panel.querySelectorAll(`${scope} a[href^="#"]`)].filter((a) => set.has(a.getAttribute('href').slice(1)));
            const out = {};
            for (const a of links) {
              const box = a.getBoundingClientRect();
              out[a.getAttribute('href').slice(1)] = {
                offsetInPanel: Math.round(box.top - panelBox.top + panel.scrollTop),
                height: Math.round(box.height),
              };
            }
            return { rows: out, panelHeight: Math.round(panel.clientHeight) };
          },
          [TARGETS.map((x) => x.id), container]
        );

      const chapter = await measure('nav.index');
      const before = chapter.rows;
      assert(TARGETS.every((t) => before[t.id]), 'kapitelindexet innehåller alla fyra teknikerna');

      /* Resan i registret: känn igen tecknet/bokstaven, följ ankaret, läs raden.
         Ingen letning i en 6 400 px lång lista. */
      await page.locator('#vy-register').check({ force: true });
      await page.waitForTimeout(250);
      const journeys = {};
      for (const t of TARGETS) {
        await page.locator(`.reg-abc a[href="#${t.group}"]`).click();
        await page.waitForTimeout(300);
        journeys[t.id] = await page.evaluate((id) => {
          const panel = document.querySelector('.sidomeny');
          const panelBox = panel.getBoundingClientRect();
          const link = document.querySelector(`.register a[href="#${id}"]`);
          const box = link.getBoundingClientRect();
          return {
            offset: Math.round(box.top - panelBox.top),
            panelHeight: Math.round(panel.clientHeight),
            visibleInFirstView: box.top >= panelBox.top - 1 && box.bottom <= panelBox.bottom + 1,
          };
        }, t.id);
      }
      for (const t of TARGETS) {
        const j = journeys[t.id];
        const b = before[t.id];
        assert(
          j.visibleInFirstView,
          `${t.name}: efter ett klick på "${t.label}" syns raden i panelens första vy — i kapitelindexet låg den ${Math.round(b.offsetInPanel / b.height)} rader ned (${b.offsetInPanel} px i en ${chapter.panelHeight} px hög panel)`
        );
        assert(
          b.offsetInPanel > 800,
          `${t.name}: kapitelindexet krävde mer än en panelhöjd scroll (${b.offsetInPanel} px av ${chapter.panelHeight} px)`
        );
      }
      const avgBefore = Math.round(TARGETS.reduce((s, t) => s + before[t.id].offsetInPanel, 0) / TARGETS.length);
      ok(`snittvägen i kapitelindexet: ${avgBefore} px panelscroll; i registret: ${TARGETS.filter((t) => journeys[t.id].visibleInFirstView).length}/${TARGETS.length} rader synliga utan scroll`);
      await page.close();
    }

    /* 3. Bokstavsankare: mål, träffyta, rubrik fritt under panelhuvudet - */
    {
      const page = await open(375, 720, '#sidomeny');
      await page.locator('#vy-register').check({ force: true });
      await page.waitForTimeout(250);
      const boxes = await page.evaluate(() =>
        [...document.querySelectorAll('.reg-abc a')].map((a) => {
          const r = a.getBoundingClientRect();
          return { href: a.getAttribute('href'), w: Math.round(r.width), h: Math.round(r.height), target: Boolean(document.querySelector(a.getAttribute('href'))) };
        })
      );
      assert(boxes.every((b) => b.target), 'varje bokstavsankare har ett mål i dokumentet');
      assert(
        boxes.every((b) => b.w >= 24 && b.h >= 24),
        `alla ${boxes.length} ankare är minst 24×24 px (min: ${Math.min(...boxes.map((b) => Math.min(b.w, b.h)))} px)`
      );
      await page.locator('.reg-abc a[href="#reg-t"]').click();
      await page.waitForTimeout(400);
      const target = await page.evaluate(() => {
        const panel = document.querySelector('.sidomeny');
        const section = document.getElementById('reg-t');
        const head = document.querySelector('.sidomeny-topp').getBoundingClientRect();
        const paneBox = panel.getBoundingClientRect();
        const first = section.querySelector('.reg-rad .reg-namn')?.textContent.trim() ?? '';
        return { top: Math.round(section.getBoundingClientRect().top), headBottom: Math.round(head.bottom), first, visible: section.checkVisibility() };
      });
      assert(target.visible, 'bokstavsankaret scrollar fram rätt grupp i panelen');
      assert(target.top >= target.headBottom - 1, `grupprubriken hamnar fritt under panelhuvudet (${target.top} ≥ ${target.headBottom})`);
      assert(/^[Tt]/.test(target.first), `gruppen T börjar på T (första raden: "${target.first}")`);
      await page.close();
    }

    /* 4. Tangentbord -------------------------------------------------- */
    {
      const page = await open(375, 720);
      /* Öppna panelen med tangentbordet (befintligt flöde). */
      await page.locator('.site .meny-oppna-knapp').focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => location.hash === '#sidomeny', null, { timeout: 4000 });
      /* Tabba till vy-växlaren och aktivera registret med Space. */
      let reached = false;
      for (let i = 0; i < 30 && !reached; i++) {
        await page.keyboard.press('Tab');
        reached = await page.evaluate(() => document.activeElement?.id === 'vy-kapitel' || document.activeElement?.id === 'vy-register');
      }
      assert(reached, 'Tab når vy-växlaren');
      await page.keyboard.press('ArrowRight'); // radiogrupp: pil byter val
      await page.waitForTimeout(250);
      assert(
        await page.evaluate(() => document.getElementById('vy-register').checked),
        'piltangenten väljer Register A–Ö (radiogruppens eget beteende)'
      );
      const focusRing = await page.evaluate(() => {
        const el = document.querySelector('.vyvaxlare label:has(input:focus-visible) span');
        return el ? getComputedStyle(el).outlineStyle : 'none';
      });
      assert(focusRing !== 'none', 'det valda läget har synlig fokusmarkering');

      /* Tab vidare till ett bokstavsankare och aktivera det. */
      let anchorFocused = null;
      for (let i = 0; i < 40 && !anchorFocused; i++) {
        await page.keyboard.press('Tab');
        anchorFocused = await page.evaluate(() => document.activeElement?.closest?.('.reg-abc') ? document.activeElement.getAttribute('href') : null);
      }
      assert(Boolean(anchorFocused), `Tab når bokstavsraden (${anchorFocused})`);
      const anchorOutline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
      assert(anchorOutline !== 'none', 'bokstavsankaret får sidans fokusring');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(350);
      assert(
        await page.evaluate((h) => location.hash === h && document.querySelector(h).checkVisibility(), anchorFocused),
        `Enter följer ankaret (${anchorFocused}) och gruppen visas`
      );

      /* Registervyn är framtvingad av ett ankare (#reg-… som :target). Den
         ska gå att lämna utan skript: "Visa kapitelindexet" pekar på
         #sidomeny, vilket behåller panelen öppen på telefon. */
      const escape = await page.evaluate(() => {
        const p = document.querySelector('.register-fran');
        const link = p?.querySelector('a');
        return { shown: p ? p.checkVisibility() : false, href: link?.getAttribute('href') };
      });
      assert(escape.shown && escape.href === '#sidomeny', 'den ankartvingade registervyn har en synlig väg tillbaka ("Visa kapitelindexet" → #sidomeny)');
      await page.locator('.register-fran a').click();
      await page.waitForFunction(() => location.hash === '#sidomeny', null, { timeout: 4000 });
      await page.waitForTimeout(300);
      assert(
        await page.evaluate(() =>
          getComputedStyle(document.querySelector('.register-fran')).display === 'none' &&
          getComputedStyle(document.querySelector('.sidomeny')).display !== 'none'
        ),
        'väg-tillbaka-raden försvinner när ankarläget är lämnat och panelen är kvar'
      );

      /* Kapitelvyn vald i växlaren: registrets länkar får inte vara tabbbara. */
      await page.evaluate(() => { document.getElementById('vy-kapitel').checked = true; });
      await page.waitForTimeout(300);
      assert(
        await page.evaluate(() =>
          getComputedStyle(document.querySelector('.register')).display === 'none' &&
          getComputedStyle(document.querySelector('nav.index')).display !== 'none'
        ),
        'växlaren visar kapitelvyn igen (registret är display:none)'
      );
      let hiddenHit = null;
      await page.evaluate(() => document.querySelector('.meny-stang').focus());
      for (let i = 0; i < 90 && !hiddenHit; i++) {
        await page.keyboard.press('Tab');
        hiddenHit = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          return el.closest('.register') ? `register: ${el.textContent.trim().slice(0, 30)}` : null;
        });
      }
      assert(hiddenHit === null, 'kapitelvyn har inga tab-stopp i det dolda registret');

      /* Registervyn vald: kapitelindexets 134 rader får inte vara tabbbara. */
      await page.evaluate(() => { document.getElementById('vy-register').checked = true; });
      await page.waitForTimeout(300);
      let chapterHit = null;
      let sawRegRow = false;
      await page.evaluate(() => document.querySelector('.meny-stang').focus());
      for (let i = 0; i < 90 && !chapterHit; i++) {
        await page.keyboard.press('Tab');
        const hit = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          return el.closest('nav.index') ? `index: ${el.getAttribute('href')}` : el.closest('.reg-lista') ? 'reg-rad' : null;
        });
        if (hit === 'reg-rad') sawRegRow = true;
        else if (hit) chapterHit = hit;
      }
      assert(chapterHit === null, 'registervyn har inga tab-stopp i det dolda kapitelindexet');
      assert(sawRegRow, 'registervy: Tab når registerraderna');
      await page.close();
    }

    /* 5. Kortens vägvisare ------------------------------------------- */
    {
      for (const width of [1440, 375]) {
        // Öppna via kortets eget fragment så att historiken innehåller både
        // demot och registergruppen — det är så en besökare kommer in.
        const page = await open(width, 720, '#grid-template-rows-subgrid');
        await page.waitForTimeout(1400);
        await page.locator('#grid-template-rows-subgrid .ctx-reg').scrollIntoViewIfNeeded();
        const label = await page.locator('#grid-template-rows-subgrid .ctx-reg').textContent();
        assert(label.trim() === 'I registret: G', `${width}px: registerlänken säger vad den gör ("${label.trim()}")`);
        await page.locator('#grid-template-rows-subgrid .ctx-reg').click();
        await page.waitForTimeout(450);
        const state = await page.evaluate(() => {
          const panel = document.querySelector('.sidomeny');
          const section = document.getElementById('reg-g');
          return {
            hash: location.hash,
            registerShown: getComputedStyle(document.querySelector('.register')).display !== 'none',
            chapterHidden: getComputedStyle(document.querySelector('nav.index')).display === 'none',
            panelVisible: getComputedStyle(panel).display !== 'none',
            sawGroup: section.checkVisibility(),
            groupTop: Math.round(section.getBoundingClientRect().top),
            headBottom: Math.round(document.querySelector('.sidomeny-topp').getBoundingClientRect().bottom),
            overflow: document.documentElement.scrollWidth - window.innerWidth,
          };
        });
        assert(state.hash === '#reg-g', `${width}px: vägvisaren sätter hashen till gruppen (#reg-g)`);
        assert(state.registerShown && state.chapterHidden, `${width}px: registervyn visas (kapitelvyn är dold)`);
        assert(state.panelVisible, `${width}px: panelen är synlig efter navigeringen`);
        assert(state.sawGroup && state.groupTop >= state.headBottom - 1, `${width}px: gruppen G syns fritt under panelhuvudet (${state.groupTop} ≥ ${state.headBottom})`);
        assert(state.overflow <= 0, `${width}px: ingen horisontell sidscroll efter navigeringen`);

        /* Bakåt: webbläsarens historik ska återställa föregående fragment. */
        await page.goBack();
        await page.waitForTimeout(700);
        assert(
          await page.evaluate(() => location.hash === '#grid-template-rows-subgrid' && document.getElementById('grid-template-rows-subgrid') !== null),
          `${width}px: Bakåt återställer föregående fragment`
        );

        /* Kapitalänken: sektionen ska hamna fritt under sticky header. */
        await page.locator('#grid-template-rows-subgrid .ctx-kap').scrollIntoViewIfNeeded();
        await page.locator('#grid-template-rows-subgrid .ctx-kap').click();
        await page.waitForTimeout(1600);
        const section = await page.evaluate(() => {
          const el = document.getElementById('layout');
          const header = document.querySelector('header.site').getBoundingClientRect();
          return { hash: location.hash, top: Math.round(el.getBoundingClientRect().top), headerBottom: Math.round(header.bottom), title: document.querySelector('#layout h2').textContent };
        });
        assert(section.hash === '#layout', `${width}px: kapitalänken navigerar till kapitlets sektion`);
        assert(
          section.top >= section.headerBottom - 1 && section.top < section.headerBottom + 240,
          `${width}px: kapitlets rubrik hamnar under (inte bakom) den sticky headern (${section.top} ≥ ${section.headerBottom})`
        );
        await page.close();
      }
    }

    /* 6. Mobilen: öppna, navigera, stäng i registervyn ----------------- */
    {
      const page = await open(375, 720);
      await page.locator('.site .meny-oppna-knapp').click();
      await page.waitForTimeout(250);
      await page.locator('#vy-register').check({ force: true });
      await page.waitForTimeout(250);
      assert(await page.evaluate(() => getComputedStyle(document.querySelector('.sidomeny')).display !== 'none'), 'mobil: panelen är öppen i registervyn');
      await page.locator('.register .reg-rad a[href="#popover-attributet"]').click();
      await page.waitForFunction(() => location.hash === '#popover-attributet', null, { timeout: 5000 });
      await page.waitForTimeout(1600);
      assert(
        await page.evaluate(() => getComputedStyle(document.querySelector('.sidomeny')).display === 'none'),
        'en registerlänk stänger panelen och navigerar (befintlig :target-modell)'
      );
      assert(
        await page.evaluate(() => {
          const el = document.getElementById('popover-attributet');
          const header = document.querySelector('header.site').getBoundingClientRect();
          const top = el.getBoundingClientRect().top;
          return top >= header.bottom - 1 && top < header.bottom + 200;
        }),
        'målet hamnar fritt under den sticky headern (scroll-margin-top räcker)'
      );
      /* Stäng utan att navigera. */
      await page.locator('.site .meny-oppna-knapp').click();
      await page.waitForTimeout(250);
      await page.locator('.meny-stang').click();
      await page.waitForFunction(() => location.hash === '#topp', null, { timeout: 4000 });
      assert(
        await page.evaluate(() => getComputedStyle(document.querySelector('.sidomeny')).display === 'none'),
        'stäng-länken stänger panelen även i registervyn'
      );
      await page.close();
    }

    /* 7. Bredder, overflow och noll skript ---------------------------- */
    {
      for (const width of [320, 375, 768, 1120, 1280, 1440]) {
        const page = await open(width, 800);
        let overflowRegister = 0;
        let overflowChapter = 0;
        await page.evaluate(() => { document.getElementById('vy-register').checked = true; });
        await page.waitForTimeout(200);
        overflowRegister = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (width < 1120) await page.evaluate(() => { location.hash = '#sidomeny'; });
        await page.waitForTimeout(200);
        const m = await page.evaluate(() => {
          const panel = document.querySelector('.sidomeny');
          const box = panel.getBoundingClientRect();
          const outside = [...panel.querySelectorAll('.reg-abc a, .reg-rad a, .vyvaxlare span')].filter(
            (a) => isVisible(a) && a.getBoundingClientRect().right > box.right + 2
          );
          function isVisible(el) {
            return el.getClientRects().length > 0;
          }
          return {
            overflow: document.documentElement.scrollWidth - window.innerWidth,
            outside: outside.length,
            scripts: document.scripts.length,
            rows: [...panel.querySelectorAll('.reg-rad')].filter(isVisible).length,
            abc: [...panel.querySelectorAll('.reg-abc a')].filter(isVisible).length,
            abcOverflowX: document.querySelector('.reg-abc').scrollWidth - document.querySelector('.reg-abc').clientWidth,
            rowsWide: [...panel.querySelectorAll('.reg-rad a')].filter(isVisible).some((a) => a.scrollWidth > a.clientWidth + 1),
          };
        });
        await page.evaluate(() => { document.getElementById('vy-kapitel').checked = true; });
        await page.waitForTimeout(200);
        overflowChapter = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert(m.overflow <= 0 && overflowRegister <= 0 && overflowChapter <= 0, `${width}px: ingen horisontell sidscroll i någon vy`);
        assert(m.outside === 0, `${width}px: inga registerrader sticker utanför panelen`);
        assert(m.abcOverflowX <= 0, `${width}px: bokstavsraden ryms i panelen`);
        assert(!m.rowsWide, `${width}px: inget radnamn klipps (raden radbryter)`);
        assert(m.rows === 134 && m.abc >= 20, `${width}px: hela registret är renderat (${m.rows} rader, ${m.abc} bokstäver)`);
        assert(m.scripts === 0, `${width}px: noll skript`);
        await page.close();
      }
    }

    /* 8. Stödfiltret gäller även registret ---------------------------- */
    {
      const page = await open(1280);
      await page.locator('#vy-register').check({ force: true });
      await page.waitForTimeout(200);
      const read = async () =>
        page.evaluate(() => ({
          cards: [...document.querySelectorAll('article.demo')].filter((d) => d.getClientRects().length).length,
          regRows: [...document.querySelectorAll('.register .reg-rad')].filter((r) => r.getClientRects().length).length,
          chapterRows: [...document.querySelectorAll('nav.index .index-rad')].filter((r) => r.getClientRects().length).length,
        }));
      const all = await read();
      assert(all.regRows === all.cards + 1, `registret visar korten plus ordlistan (${all.regRows} = ${all.cards} + 1)`);
      for (const id of ['f-chrome', 'f-safari', 'f-firefox']) {
        await page.locator('#' + id).check({ force: true });
        await page.waitForTimeout(150);
        const r = await read();
        assert(r.regRows === r.cards + 1, `${id}: registret filtreras som korten (${r.regRows} = ${r.cards} + ordlistan)`);
      }
      await page.close();
    }

    /* 9. Djuplänk till en registergrupp som första anrop -------------- */
    {
      const page = await open(1440, 900, '#reg-s');
      const state = await page.evaluate(() => {
        const section = document.getElementById('reg-s');
        const box = section.getBoundingClientRect();
        const head = document.querySelector('.sidomeny-topp').getBoundingClientRect();
        return {
          shown: getComputedStyle(document.querySelector('.register')).display !== 'none',
          indexHidden: getComputedStyle(document.querySelector('nav.index')).display === 'none',
          top: Math.round(box.top),
          headBottom: Math.round(head.bottom),
          first: section.querySelector('.reg-namn')?.textContent.trim() ?? '',
        };
      });
      assert(state.shown && state.indexHidden, 'djuplänk #reg-s öppnar registervyn direkt');
      assert(state.top >= state.headBottom - 1, `gruppen hamnar fritt i panelen (${state.top} ≥ ${state.headBottom})`);
      assert(/^[Ss]/.test(state.first), `rätt grupp (första raden: "${state.first}")`);
      await page.close();
    }
  } finally {
    await browser.close();
  }

  if (failures > 0) {
    console.error(`\n${failures} kontroll(er) misslyckades.`);
    process.exit(1);
  }
  console.log('\nA–Ö-registret och kortens vägvisare verifierade.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
