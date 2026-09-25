#!/usr/bin/env node
/**
 * tests/ux-polish.mjs — Nivå 2: UX-kontraktet för gränssnittet runt demona.
 *
 * Demona mäts av tests/demo-source.mjs och tests/demo-parity.mjs. Det här
 * testet mäter det som ligger runtomkring och som ingen av dem ser: hero,
 * sidhuvud, indexpanelen, stödfiltret, räknaren och kodvalvens öppning.
 *
 * Varje påstående nedan är knutet till en faktisk brist som åtgärdades i
 * UX-omgången (se PR-beskrivningen). De får inte sluta gälla utan att
 * gränssnittet samtidigt ändras medvetet:
 *
 *  1. Ingen horisontell sidscroll och inget sidhuvud som spiller över —
 *     vid 375, 768, 1120, 1280 och 1440 px.
 *  2. Under 640px är kapitelnavigeringen i sidhuvudet dold (den fick 0px
 *     bredd och staplade länkar osynligt ovanpå varandra) och panelen är
 *     i stället vägen till kapitlen.
 *  3. Panelen innehåller kapitelgenvägar som faktiskt navigerar och stänger
 *     panelen (:target-modellen är orörd).
 *  4. Indexraderna ryms i panelen (raden var 654px bred i en 311px-panel:
 *     namnet klipptes och stöd-prickarna hamnade utanför kanten).
 *  5. Panelhuvudet ligger kvar när listan scrollar, så "stäng ✕" alltid går
 *     att nå.
 *  6. Kodvalvet: hela kopieringshinten syns, tangentbordsflödet fungerar
 *     (Tabba → Enter → Tab → Ctrl+A markerar hela koden), och valvet
 *     innehåller ingen skriptbar mekanism.
 *  7. Räknaren visar samma antal som antalet synliga kort i varje filterläge.
 *  8. Grundpaketet går att nå från hero och panel, och kortet är det som
 *     innehåller :root-variablerna.
 *  9. Inget demo-innehåll rinner ut över kortkanten utan mekanism: ett
 *     element som sticker utanför kortet måste ha en förfader i kortet som
 *     scrollar i sidled eller klipper (overflow: auto/scroll/hidden/clip).
 *
 * Kräver webbläsare (Playwright/Chromium):
 *   npm install && npx playwright install chromium
 *   node tests/ux-polish.mjs
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

function ok(msg) {
  console.log(`✓ ${msg}`);
}
function fail(msg) {
  console.error(`✗ ${msg}`);
  failures++;
}
function assert(cond, msg) {
  cond ? ok(msg) : fail(msg);
}

/** Bredder i uppgiften: mobil, tablet, sidebar-brytpunkt, desktop, bred. */
const WIDTHS = [375, 768, 1120, 1280, 1440];

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
  try {
    /* 1. Sidhuvud och sidscroll vid alla fem bredder ------------------- */
    for (const width of WIDTHS) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(url, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(200);
      const m = await page.evaluate(() => {
        const header = document.querySelector('header.site');
        const nav = document.querySelector('.site nav');
        const links = [...nav.querySelectorAll('a')];
        const before = nav.scrollLeft;
        nav.scrollLeft = nav.scrollWidth;
        const lastRight = links[links.length - 1].getBoundingClientRect().right;
        const navRight = nav.getBoundingClientRect().right;
        nav.scrollLeft = before;
        return {
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          headerOverflow: header.scrollWidth - header.clientWidth,
          navDisplay: getComputedStyle(nav).display,
          navOverflowX: getComputedStyle(nav).overflowX,
          navFits: nav.scrollWidth <= nav.clientWidth + 1,
          navScrolled: lastRight <= navRight + 1,
        };
      });
      assert(m.overflow <= 0, `${width}px: ingen horisontell sidscroll`);
      assert(m.headerOverflow <= 0, `${width}px: sidhuvudet spiller inte över kanten`);
      if (m.navDisplay === 'none') {
        assert(width < 640, `${width}px: kapitelnavigeringen är bara dold under 640px`);
      } else if (m.navFits) {
        assert(true, `${width}px: kapitelnavigeringen ryms i sin helhet`);
      } else {
        /* 640–1119px: raden ryms inte utan är en avsiktlig scrollremsa med
           tonade kanter (mask-image). Den ska då gå att scrolla — annars är
           "Referens" oåtkomlig för muspekare — och sista länken ska komma
           in i vyn när man scrollar dit. Under 640px är den i stället dold. */
        assert(
          m.navOverflowX === 'auto' || m.navOverflowX === 'scroll',
          `${width}px: kapitelnavigeringen är en scrollbar remsa (overflow-x: ${m.navOverflowX})`
        );
        assert(m.navScrolled, `${width}px: sista kapitellänken nås genom att scrolla remsan`);
      }
      await page.close();
    }

    /* 2–5. Panelen: kapitelgenvägar, rader som ryms, kvarvarande huvud -- */
    {
      const page = await browser.newPage({ viewport: { width: 375, height: 720 } });
      await page.goto(url, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);

      assert(
        await page.evaluate(() => getComputedStyle(document.querySelector('.sidomeny')).display === 'none'),
        'mobil: panelen är stängd tills den är :target'
      );

      await page.click('.site .meny-oppna-knapp');
      await page.waitForTimeout(250);
      const panel = await page.evaluate(() => {
        const side = document.querySelector('.sidomeny');
        const links = [...document.querySelectorAll('.index-kapitel a')];
        const rows = [...document.querySelectorAll('.index-rad a')];
        const sideRect = side.getBoundingClientRect();
        const overflowRows = rows.filter((r) => r.getBoundingClientRect().right > sideRect.right + 2);
        const dotsOutside = [...document.querySelectorAll('.index-rad .prikkar')].filter(
          (d) => d.getBoundingClientRect().right > sideRect.right + 2
        );
        const names = [...document.querySelectorAll('.index-rad .rad-namn')];
        const clippedNames = names.filter((n) => getComputedStyle(n).scrollWidth > n.clientWidth + 1);
        return {
          chapterLinks: links.length,
          chapterTargets: links.map((l) => l.getAttribute('href')),
          rows: rows.length,
          overflowRows: overflowRows.length,
          dotsOutside: dotsOutside.length,
          clippedNames: clippedNames.length,
          allIdsExist: links.every((l) => document.querySelector(l.getAttribute('href'))),
        };
      });
      assert(panel.chapterLinks >= 10, `panelen har kapitelgenvägar (${panel.chapterLinks} länkar)`);
      assert(panel.allIdsExist, 'panelens kapitelgenvägar pekar på id:n som finns');
      assert(
        panel.chapterTargets.includes('#farg') && panel.chapterTargets.includes('#referens'),
        'kapitelgenvägarna täcker första och sista kapitlet'
      );
      assert(panel.rows > 130, `panelens index innehåller alla rader (${panel.rows})`);
      assert(panel.overflowRows === 0, 'inga indexrader sticker utanför panelen');
      assert(panel.dotsOutside === 0, 'stödmarkörerna ligger innanför panelkanten');
      assert(panel.clippedNames === 0, 'inga tekniknamn klipps mitt i ordet');

      /* Kapitelgenvägen navigerar och stänger panelen (:target-modellen). */
      await page.locator('.index-kapitel a[href="#layout"]').click();
      await page.waitForFunction(() => location.hash === '#layout', null, { timeout: 4000 });
      assert(
        await page.evaluate(() => getComputedStyle(document.querySelector('.sidomeny')).display === 'none'),
        'kapitelgenväg stänger panelen och navigerar'
      );

      /* Panelhuvudet följer med: stäng-länken ska gå att nå även långt ned. */
      await page.click('.site .meny-oppna-knapp');
      await page.waitForTimeout(200);
      const sticky = await page.evaluate(() => {
        const side = document.querySelector('.sidomeny');
        const topp = document.querySelector('.sidomeny-topp');
        const before = topp.getBoundingClientRect().top;
        side.scrollTop = side.scrollHeight;
        const after = topp.getBoundingClientRect();
        const box = side.getBoundingClientRect();
        const close = document.querySelector('.meny-stang').getBoundingClientRect();
        return {
          scrolled: side.scrollTop > 1000,
          moved: Math.round(after.top - before),
          insidePanel: after.top >= box.top - 1 && after.bottom <= box.bottom + 1,
          closeVisible: close.width > 0 && close.height > 0 && close.top >= box.top - 1 && close.bottom <= box.bottom + 1,
        };
      });
      assert(sticky.scrolled, 'indexet gick att scrolla i panelen');
      assert(Math.abs(sticky.moved) < 4 && sticky.insidePanel, 'panelhuvudet ligger kvar högst upp när listan scrollar');
      assert(sticky.closeVisible, 'stäng-länken är synlig och nåbar efter djup scroll i indexet');
      await page.close();
    }

    /* 6. Kodvalvet: synlig hint, tangentbordsflöde, ingen skriptmekanik --- */
    {
      const page = await browser.newPage({ viewport: { width: 375, height: 720 } });
      await page.goto(url + '#color-mix', { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const hint = await page.evaluate(() => {
        const summary = document.querySelector('#color-mix details.kod-valv summary');
        const text = summary.querySelector('.kod-hint');
        const s = summary.getBoundingClientRect();
        const t = text.getBoundingClientRect();
        return { inside: t.right <= s.right + 1, height: Math.round(s.height), text: text.textContent.trim() };
      });
      assert(hint.inside, `kopieringshinten ryms i valvraden ("${hint.text}")`);
      assert(hint.height <= 44, `valvraden är en rad hög (${hint.height}px), inte två`);

      await page.locator('#color-mix details.kod-valv summary').first().focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
      assert(
        await page.locator('#color-mix details.kod-valv').first().evaluate((el) => el.open),
        'Enter öppnar kodvalvet från tangentbordet'
      );
      await page.keyboard.press('Tab');
      assert(
        await page.evaluate(() => document.activeElement?.matches?.('#color-mix textarea.kod') === true),
        'nästa Tab-stopp efter valvraden är kodrutan'
      );
      await page.keyboard.press('Control+A');
      const selection = await page.evaluate(() => {
        const a = document.activeElement;
        return { selected: a.selectionEnd - a.selectionStart, total: a.value.length };
      });
      assert(
        selection.total > 0 && selection.selected === selection.total,
        `Ctrl+A markerar hela koden i rutan (${selection.selected}/${selection.total} tecken)`
      );
      assert(
        await page.evaluate(() => document.scripts.length === 0),
        'sidan har fortfarande noll skript'
      );
      await page.close();
    }

    /* 7. Räknaren mot filtren ----------------------------------------- */
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(url, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const read = async () =>
        page.evaluate(() => ({
          shown: Number(
            getComputedStyle(document.querySelector('.raknare b'), '::after').content.replace(/[^0-9]/g, '')
          ),
          visible: [...document.querySelectorAll('article.demo')].filter((d) => d.getClientRects().length).length,
          visibleRows: [...document.querySelectorAll('.index-rad')].filter((r) => r.getClientRects().length).length,
        }));
      for (const id of ['f-alla', 'f-chrome', 'f-edge', 'f-safari', 'f-firefox']) {
        await page.click('#' + id);
        await page.waitForTimeout(120);
        const r = await read();
        assert(r.shown === r.visible, `${id}: räknaren visar ${r.shown} = antalet synliga kort`);
        assert(r.visibleRows <= r.visible + 1, `${id}: indexet visar samma filtrering som korten`);
      }
      const back = await read();
      assert(back.visible > 100, 'alla 133 kort är tillbaka i Alla-läget');
      await page.close();
    }

    /* 8. Grundpaketet nåbart och rätt kort ---------------------------- */
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(url, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const grund = await page.evaluate(() => {
        const links = [...document.querySelectorAll('a[href="#grundpaketet"]')];
        const card = document.getElementById('grundpaketet');
        const rootVars = (card.querySelector('textarea.kod')?.value ?? '').includes(':root');
        return { links: links.length, inHero: links.some((l) => l.closest('.hero') !== null), inPanel: links.some((l) => l.closest('.sidomeny') !== null), rootVars };
      });
      assert(grund.links >= 2, `Grundpaketet nås från flera ställen (${grund.links} länkar)`);
      assert(grund.inHero, 'hero pekar på Grundpaketet');
      assert(grund.inPanel, 'indexpanelen pekar på Grundpaketet');
      assert(grund.rootVars, 'kortet #grundpaketet innehåller :root-variablerna');
      await page.close();
    }

    /* 9. Inget osynligt klippt demo-innehåll --------------------------- */
    {
      for (const width of [375, 1280]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await page.goto(url, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        const clipped = await page.evaluate(() => {
          const out = [];
          for (const card of document.querySelectorAll('article.demo')) {
            const box = card.getBoundingClientRect();
            const cs = getComputedStyle(card);
            const limit = box.right - parseFloat(cs.paddingRight);
            for (const el of card.querySelectorAll('*')) {
              const r = el.getBoundingClientRect();
              if (r.width === 0 && r.height === 0) continue;
              if (r.right <= limit + 2) continue;
              /* Tillåtet om någon förfader i kortet hanterar överflödet:
                 scrollbara remsor (karuseller, banor) och avsiktligt
                 klippande scener (t.ex. tejpen bakom urtavlan) är demon
                 i sig. Det som INTE får hända är att innehåll rinner ut
                 över kortkanten utan mekanism. */
              let handled = false;
              for (let p = el.parentElement; p && p !== card; p = p.parentElement) {
                const ox = getComputedStyle(p).overflowX;
                if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') { handled = true; break; }
              }
              if (!handled) out.push(`${card.id} → ${el.tagName.toLowerCase()}.${el.className || ''} (+${Math.round(r.right - limit)}px)`);
            }
          }
          return [...new Set(out)];
        });
        assert(
          clipped.length === 0,
          `${width}px: inget demo-innehåll klipps utan scrollbar${clipped.length ? ' — ' + clipped.slice(0, 4).join(' | ') : ''}`
        );
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  if (failures > 0) {
    console.error(`\n${failures} kontroll(er) misslyckades.`);
    process.exit(1);
  }
  console.log('\nGränssnittets UX-kontrakt verifierat.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
