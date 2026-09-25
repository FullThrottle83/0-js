#!/usr/bin/env node
/**
 * register.test.mjs — beständiga regressionstester för A–Ö-registret
 * (scripts/register.mjs).
 *
 * Samma princip som scripts/check.test.mjs: varje testfall injicerar en
 * specifik defekt i det committade index.html och kräver att kontrollen
 * rapporterar den. Ett tyst förbi-släpp är själva felet.
 *
 * Det som mäts är egenskaper som måste hålla även när demos läggs till,
 * byter namn eller flyttas mellan kapitel:
 *
 *   1. Registret och kapitelindexet är exakt samma mängd (134 rader), och
 *      varje teknik finns exakt en gång i registret.
 *   2. Varje registerlänk har exakt ett mål i dokumentet (inga döda ankare,
 *      inga dubblerade id:n).
 *   3. Bokstavsraden: ett ankare per grupp, i gruppordning, med mål.
 *   4. Radiogrupps-väljaren (kapitel ⇄ register) finns och är den enda vägen
 *      att byta vy — ingen skriptad mekanism.
 *   5. Vägvisaren i varje kort pekar på kortets eget kapitel och egen grupp.
 *   6. Sorteringen är svensk: Å, Ä, Ö efter Z, och @/: /</siffror i en egen
 *      grupp först.
 *   7. En föråldrad artefakt upptäcks: ändras kapitelindexet måste registret
 *      byggas om (`npm run build`).
 *   8. Ändringar UTANFÖR de genererade regionerna bevaras byte för byte.
 *   9. Felhantering: saknade markörer och okända id:n ger tydliga fel.
 *
 * Kör: node scripts/register.test.mjs
 */

import { readFileSync } from 'node:fs';
import {
  applyCtx, applyRegister, buildRegister, checkRegister, ctxEnd, ctxStart, demoCardIds,
  extractChapterIndex, extractCtx, extractRegisterRows, groupAnchor, groupKey, groupRows,
  groupTitle, isLetter, renderCtx, splitName, sortKey, SYMBOL_SECTIONS,
  isSymbolKey, currentRegion, INDEX, RegisterError,
} from './register.mjs';

let failures = 0;
const ok = (m) => console.log(`✓ ${m}`);
const fail = (m) => { console.error(`✗ ${m}`); failures++; };
const assert = (c, m) => (c ? ok(m) : fail(m));
const throwsRegisterError = (fn, m) => {
  try { fn(); fail(`${m} (inget fel kastades)`); } catch (e) { assert(e instanceof RegisterError, `${m}: ${e.message}`); }
};

const html = readFileSync(INDEX, 'utf8');
const cards = demoCardIds(html);
const { chapters, rows } = extractChapterIndex(html);
const EXPECTED_DEMOS = 133;

/* 0. Positivt kontrollfall -------------------------------------------- */
{
  const { errors, stats } = checkRegister(html);
  assert(errors.length === 0, `odokumentet passerar registerkontrollen${errors.length ? `: ${errors[0]}` : ''}`);
  assert(stats.rows === rows.length, `registret har samma antal rader som kapitelindexet (${stats.rows})`);
  assert(stats.ctx === cards.length, `varje demo-kort har en vägvisare (${stats.ctx}/${cards.length})`);
  assert(cards.length === EXPECTED_DEMOS, `${EXPECTED_DEMOS} demo-kort i dokumentet`);
}

/* 1. Registret = kapitelindexet, exakt en gång per teknik -------------- */
{
  const reg = extractRegisterRows(html);
  const chapterIds = rows.map((r) => r.id);
  const regIds = reg.map((r) => r.id);
  assert(new Set(regIds).size === regIds.length, 'varje teknik förekommer exakt en gång i registret');
  assert(regIds.length === chapterIds.length && [...regIds].sort().join(',') === [...chapterIds].sort().join(','),
    'registret och kapitelindexet är samma mängd id:n');
  const byId = new Map(rows.map((r) => [r.id, r]));
  const nameMismatch = reg.filter((r) => byId.get(r.id) && byId.get(r.id).name !== r.name);
  assert(nameMismatch.length === 0, 'namnen i registret är ordagrant kapitelindexets namn');
  const supMismatch = reg.filter((r) => byId.get(r.id) && byId.get(r.id).sup !== r.sup);
  assert(supMismatch.length === 0, 'stödklasserna följer med varje registerrad (filtret gäller båda vyerna)');
  const kapMismatch = reg.filter((r) => byId.get(r.id) && byId.get(r.id).chapterNr !== r.chapterNr);
  assert(kapMismatch.length === 0, 'kapiteltaggen per rad stämmer med kapitelindexet');
  assert(chapters.length === 11 && chapters[chapters.length - 1].rows[0].id === 'referens',
    'ordlistan (kapitel +) ingår i registret som en rad');
}

/* 2. Varje registerlänk har exakt ett mål ----------------------------- */
{
  const domIds = [...html.replace(/<textarea\b[\s\S]*?<\/textarea>/g, '').matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const count = domIds.reduce((m, id) => m.set(id, (m.get(id) || 0) + 1), new Map());
  const missing = extractRegisterRows(html).filter((r) => (count.get(r.id) || 0) !== 1);
  assert(missing.length === 0, `alla ${rows.length} registerlänkar har exakt ett mål i dokumentet`);
  const anchors = [...currentRegion(html).matchAll(/<a href="#(reg-[^"]+)"/g)].map((m) => m[1]);
  assert(anchors.every((a) => (count.get(a) || 0) === 1), 'varje bokstavsankare har exakt ett mål');
}

/* 3. Bokstavsraden ---------------------------------------------------- */
{
  const groups = groupRows(rows);
  const anchors = [...currentRegion(html).matchAll(/<li><a href="#(reg-[^"]+)">([^<]*)<\/a><\/li>/g)]
    .map((m) => ({ href: m[1], label: m[2] }));
  assert(anchors.length === groups.length, `ett ankare per grupp (${anchors.length} grupper)`);
  assert(anchors.every((a, i) => a.href === groupAnchor(groups[i])), 'ankarna står i gruppordning');
  const sections = [...currentRegion(html).matchAll(/<section class="reg-avsnitt" id="(reg-[^"]+)"/g)].map((m) => m[1]);
  assert(sections.join(',') === anchors.map((a) => a.href).join(','), 'varje ankare har en egen sektion, i samma ordning');
  const heads = [...currentRegion(html).matchAll(/aria-labelledby="(reg-[^"]+)-rubrik"/g)].map((m) => m[1]);
  assert(heads.join(',') === sections.join(','), 'varje grupp är namngiven av sin egen rubrik');
}

/* 4. Vy-väljaren (kapitel ⇄ register) --------------------------------- */
{
  const switcher = /<div class="vyvaxlare" role="radiogroup" aria-label="Sortering av indexet">([\s\S]*?)<\/div>/;
  const m = html.match(switcher);
  assert(Boolean(m), 'vy-väljaren är en namngiven radiogrupp');
  if (m) {
    const radios = [...m[1].matchAll(/<input type="radio" name="indexvy" id="(vy-[a-z]+)"(\s+checked)?>/g)]
      .map((r) => ({ id: r[1], checked: Boolean(r[2]) }));
    assert(radios.length === 2, `två val i växlaren (${radios.map((r) => r.id).join(', ')})`);
    assert(radios.filter((r) => r.checked).length === 1 && radios.find((r) => r.checked).id === 'vy-kapitel',
      'kapitelvyn är förvald (oförändrat standardbeteende)');
    assert(/<label><input[^>]*><span>[^<]+<\/span><\/label>/.test(m[1]), 'varje val är en riktig etikett med synlig text');
  }
  assert(/body:has\(#vy-register:checked\) nav\.index \{ display:none; \}/.test(html)
    || /body:has\(#vy-register:checked\) nav\.index,\n[^{]*\{ display:none; \}/.test(html),
    'den vy som inte är vald är display:none (inga dolda tab-stopp)');
  assert(!/<script[\s>]/i.test(html), 'ingen skriptmekanism har tillkommit');
}

/* 5. Kortens vägvisare ------------------------------------------------- */
{
  const ctx = extractCtx(html);
  assert(ctx.size === cards.length, `en vägvisare per kort (${ctx.size})`);
  const byId = new Map(rows.map((r) => [r.id, r]));
  let wrongChapter = 0;
  let wrongGroup = 0;
  let badName = 0;
  for (const [id, block] of ctx) {
    const row = byId.get(id);
    if (!row) continue;
    const kap = block.match(/href="#([^"]+)">Kapitel ([^<]+)</);
    const reg = block.match(/href="#(reg-[^"]+)">I registret: ([^<]+)</);
    if (!kap || kap[1] !== row.sectionId) wrongChapter++;
    if (!reg || reg[1] !== groupAnchor({ key: groupKey(row.name) })) wrongGroup++;
    if (!block.includes(`Kapitel ${row.chapterNr} · `)) badName++;
  }
  assert(wrongChapter === 0, 'varje vägvisare länkar till kortets eget kapitel');
  assert(wrongGroup === 0, 'varje vägvisare länkar till kortets egen registergrupp');
  assert(badName === 0, 'vägvisarens kapiteltext är innehållsrik ("Kapitel 02 · Layout & rutnät")');
  const unnamed = [...ctx.values()].filter((b) => /href="#reg-/.test(b) && !/I registret: /.test(b));
  assert(unnamed.length === 0, 'registerlänken säger vad den gör utan sin omgivning ("I registret: G")');
}

/* 6. Svensk sortering och teckengrupperna ------------------------------ */
{
  assert(isLetter('å') && isLetter('Ö') && !isLetter('@') && !isLetter('3'), 'bokstavsklassen omfattar Å/Ä/Ö men inte @ eller siffror');
  assert(sortKey('Å') < sortKey('Ö') && sortKey('Z') < sortKey('Å'),
    'sorteringsnyckeln lägger Å och Ö efter Z (svensk ordning)');
  assert(['Ö', 'Z', 'Å', 'A'].map(sortKey).sort().join(',') === ['A', 'Z', 'Å', 'Ö'].map(sortKey).join(','),
    'A < Z < Å < Ö med sorteringsnyckeln');
  const decode = (x) => x.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const generated = [...currentRegion(html).matchAll(/<li><a href="#reg-[^"]+">([^<]*)<\/a><\/li>/g)].map((m) => decode(m[1]));
  const groups = groupRows(rows);
  assert(generated.join(',') === groups.map((g) => g.label).join(','),
    'bokstavsraden visar exakt gruppernas rubriker, i gruppordning');
  assert(groups[0].label === '@' && groups[1].label === ':' && groups[2].label === '<' && groups[3].label === '0–9',
    `teckengrupperna står först i avsiktlig ordning (@, :, <, 0–9 — ${groups.slice(0, 4).map((g) => `${g.label}(${g.rows.length})`).join(' ')})`);
  const letters = groups.filter((g) => !g.symbol).map((g) => g.key);
  const sorted = [...letters].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
  assert(letters.join(',') === sorted.join(','), `bokstäverna står i svensk ordning (${letters.join(' ')})`);
  const symbolRows = groups.filter((g) => g.symbol).flatMap((g) => g.rows);
  assert(symbolRows.every((r) => !isLetter([...r.name][0])), 'teckengrupperna innehåller bara namn som inte börjar på en bokstav');
  const byGroups = [
    ['@', rows.filter((r) => r.name.startsWith('@'))],
    [':', rows.filter((r) => r.name.startsWith(':'))],
    ['<', rows.filter((r) => r.name.startsWith('<'))],
    ['0–9', rows.filter((r) => /^\d/.test(r.name))],
  ];
  for (const [label, list] of byGroups) {
    const group = groups.find((g) => g.label === label);
    assert(list.length > 0 && group && list.every((r) => group.rows.includes(r)),
      `${label}-namnen (${list.length} st) ligger i sin egen grupp och är inte utspridda`);
  }
  const sizes = groups.map((g) => g.rows.length);
  assert(Math.max(...sizes) <= 17, `ingen grupp är oöverskådligt stor (största: ${Math.max(...sizes)} rader, var: ${groups[sizes.indexOf(Math.max(...sizes))].label})`);
  assert(sizes.reduce((a, b) => a + b, 0) === rows.length, 'gruppernas storlekar summerar till antalet rader');
  assert(!html.includes('--&shy;'), 'inget mjukt radbrytningstecken har smugit in i namnen');
  const em = [...currentRegion(html).matchAll(/<h3 class="reg-rubrik"[^>]*><span class="vh">([^<]*)<\/span>([^<]*)</g)]
    .map((m) => ({ prefix: decode(m[1]), label: decode(m[2]) }));
  assert(em.length === groups.length && em.every((e, i) => e.prefix === groups[i].prefix),
    'varje grupprubrik har en skärmläsartext ("Tekniker som börjar med …")');
  assert(isSymbolKey('at') && isSymbolKey('ovrigt') && !isSymbolKey('A'), 'symbolnycklarna skiljs från bokstäverna');
  assert(SYMBOL_SECTIONS.length === 5 && SYMBOL_SECTIONS[4].slug === 'ovrigt',
    'udda tecken (t.ex. --egna-egenskaper) har en egen grupp i stället för att tappas bort');
}

/* 7. Stale-detektering ------------------------------------------------- */
{
  // a) Ett kort byter namn i kapitelindexet utan att registret byggs om.
  const renamed = html.replace(
    '<span class="rad-namn">clamp() — flytande skala</span>',
    '<span class="rad-namn">clamp() — flytande skala (omdöpt)</span>',
  );
  assert(renamed !== html, 'testet kan ändra ett radnamn i kapitelindexet');
  const stale = checkRegister(renamed);
  assert(stale.errors.length > 0 && stale.errors.some((e) => /inte i fas/.test(e)),
    'ett ändrat radnamn gör registret stale (kontrollen fäller)');

  // b) En rad tas bort ur kapitelindexet.
  const removed = html.replace(/\s*<li class="index-rad[^"]*"><a href="#clamp"><span class="rad-namn">[^<]*<\/span><i class="prikkar">[\s\S]*?<\/i><\/a><\/li>/, '');
  assert(removed !== html, 'testet kan ta bort en rad ur kapitelindexet');
  const removedCheck = checkRegister(removed);
  assert(removedCheck.errors.length > 0, 'en borttagen rad ur kapitelindexet upptäcks (registret är inte längre i fas)');

  // c) En registerrad byter länk.
  const retargeted = html.replace('class="reg-rad sup-chrome sup-edge sup-firefox sup-safari"><a href="#clamp">',
    'class="reg-rad sup-chrome sup-edge sup-firefox sup-safari"><a href="#css-arkad">');
  assert(retargeted !== html, 'testet kan peka om en registerlänk');
  assert(checkRegister(retargeted).errors.some((e) => /inte i fas|förekommer flera gånger/.test(e)),
    'en ompekad registerlänk upptäcks');
}

/* 8. Manuella ändringar utanför regionerna bevaras ---------------------- */
{
  const outside = html
    .replace('<title>', '<title>TEST ')
    .replace('<p class="index-grund">', '<p class="index-grund" data-test="1">');
  const built = buildRegister(outside).html;
  assert(built.includes('<title>TEST ') && built.includes('data-test="1"'),
    'ändringar utanför de genererade regionerna lämnas orörda av bygget');
  assert(built.includes('<!-- register:start') && built.includes('<!-- register:end -->'), 'markörerna finns kvar efter bygget');
  const twice = buildRegister(built).html;
  assert(twice === built, 'två byggen i rad ger samma dokument (idempotent)');
  const reversed = (() => {
    const { rows: r } = extractChapterIndex(outside);
    return applyRegister(outside, r);
  })();
  assert(reversed === applyRegister(outside, rows), 'registret beror inte på radernas inbördes ordning');
}

/* 9. Felhantering: inget tyst ----------------------------------------- */
{
  throwsRegisterError(() => applyRegister(html.replace('<!-- register:start', '<!-- register-start'), rows),
    'saknad startmarkör ger fel');
  throwsRegisterError(() => applyRegister(html.replace('<!-- register:end -->', '<!-- register-end -->'), rows),
    'saknad slutmarkör ger fel');
  throwsRegisterError(() => applyCtx(html, rows.filter((r) => r.id !== 'clamp')),
    'vägvisare för ett kort utan rad i kapitelindexet ger fel');
  throwsRegisterError(() => buildRegister(html.replace('<ul class="index-kapitel">', '<ul class="index-kapitel-x">')),
    'saknade kapitchips ger fel');
  throwsRegisterError(() => buildRegister(html.replace('<span class="antal">31</span>', '<span class="antal">32</span>')),
    'kapitelräknaren måste stämma med antalet rader');
  throwsRegisterError(() => buildRegister(html.replace('data-nr="01"', 'data-nr="99"')),
    'chipens nummer och sektionens data-nr måste stämma');
  throwsRegisterError(() => buildRegister(html.replace('<section class="kapitel" id="layout" data-nr="02">', '<section class="kapitel" id="layout-x" data-nr="02">')),
    'en kapitelsektion som inte kan kopplas till indexet ger fel');
  throwsRegisterError(() => buildRegister(html.replace('<h2>Färg</h2>', '<h2>Fel kapitel</h2>')),
    'en kapitelrubrik som inte stämmer med indexet ger fel (ingen tyst feldaterad kapiteltagg)');
  throwsRegisterError(() => buildRegister(html.replace('<h2>Layout &amp; rutnät</h2>', '<h2>Färg</h2>')),
    'en omkastad kapitelrubrik ger fel i stället för fel kapiteltagg per rad');

  const split = splitName('color-mix() — blanda i valfri färgrymd');
  assert(split.name === 'color-mix()' && split.desc === 'blanda i valfri färgrymd', 'radnamnet delas vid den första " — "');
  const noDesc = splitName('prefers-color-scheme');
  assert(noDesc.name === 'prefers-color-scheme' && noDesc.desc === '', 'ett namn utan beskrivning hanteras');
  const dashValue = splitName('color-mix() kontinuerligt — scroll-länkad färgblandning, animation-timeline: scroll()');
  assert(dashValue.name === 'color-mix() kontinuerligt', 'ett bindestreck i CSS-värdet bryter inte namnet');
  const ctx = renderCtx(rows.find((r) => r.id === 'grid-template-rows-subgrid'));
  assert(ctx.includes('Kapitel 02 · Layout &amp; rutnät') && ctx.includes('I registret: G'),
    'renderCtx ger kapiteltext och registergrupp för subgrid');
  const atCtx = renderCtx(rows.find((r) => r.id === 'property'));
  assert(atCtx.includes('I registret: @') && atCtx.includes('href="#reg-at"'),
    'en @-regel pekar på teckengruppen @, inte på en godtycklig bokstav');
  assert(applyCtx(html, rows) === html, 'vägvisarna i det committade dokumentet är i fas');
  assert(html.includes(ctxStart('clamp')) && html.includes(ctxEnd('clamp')), 'vägvisaren har tydliga markörer i markupen');
}

console.log('');
if (failures) {
  console.error(`${failures} test misslyckades.`);
  process.exit(1);
}
console.log(`Alla registertester gröna (${rows.length} rader, ${groupRows(rows).length} grupper, ${cards.length} kort).`);
