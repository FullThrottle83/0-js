#!/usr/bin/env node
/**
 * register.mjs — genererar A–Ö-registret i indexpanelen ur kapitelindexet.
 *
 * PROBLEMET
 * ---------
 * Referensen har 133 demos i tio kapitel. Den som vet vad tekniken heter men
 * inte vilket kapitel den hör till måste scrolla igenom hela kapitelindexet
 * (134 rader, ~6 400 px panelscroll) eller lita på webbläsarens Ctrl+F.
 * A–Ö-registret gör namnuppslag till ett direktsvar i stället.
 *
 * VARFÖR GENERERAT
 * ----------------
 * Ett handskrivet register vore en andra lista över samma 134 tekniker, och
 * den skulle glida så fort ett kort byter namn eller ett nytt läggs till.
 * Registret härleds därför ur den befintliga kapitelindexlistan i index.html —
 * samma rader som redan bär namn, stödklasser och fragmentlänk. Ingen ny
 * databas, ingen ny metadata: bara en annan sortering av samma information.
 *
 * RÄCKER DET INTE ATT SORTERA OM I CSS?
 * -------------------------------------
 * Nej. Kapitelindexet är en <ul> per kapitel inuti <details>. En bokstavsrad
 * (som i en ordbok) kräver att rader med samma begynnelsebokstav hamnar
 * intill varandra, och kapitelgrupperingen är semantisk — den får inte rivas
 * upp. En flex/kolumn-trickning i CSS kunde visuellt ordna om rader, men
 * då skulle tabbordningen följa DOM (kapitel för kapitel), bokstavsrubrikerna
 * sakna innehåll att fästa vid, och varje rad finnas två gånger i dokumentet.
 * Därför genereras registret i stället — med samma rader, en gång var.
 *
 * FORMAT
 * ------
 * Registret ligger mellan två markörer i index.html:
 *
 *   <!-- register:start … -->
 *     … genererat innehåll …
 *   <!-- register:end -->
 *
 * Allt utanför markörerna lämnas orört (vikten av det bevisas av
 * scripts/register.test.mjs punkt 7). Innehållet i regionen är den enda
 * sorteringen som skiljer sig från kapitelindexet; namn, beskrivning,
 * stödklasser och fragmentlänk kopieras ordagrant därifrån.
 *
 * SPRÅK OCH SORTERING
 * -------------------
 * Rubriken säger "A–Ö", alltså svensk ordning: Å, Ä, Ö efter Z. Det är
 * avsiktligt att skriva A–Ö även om grupperna råkar vara färre — grupperna
 * härleds ur namnen, inte ur en fast lista. Rader som inte börjar på en
 * bokstav hamnar i en egen grupp ("@, :, <, 3") först i registret, med
 * inbördes ordning @ → : → < → -- → siffror (så som en CSS-utvecklare letar
 * efter @-regler, pseudoklasser och element).
 *
 * KÖR
 * ---
 *   node scripts/register.mjs            skriv om regionen i index.html
 *   node scripts/register.mjs --check    avsluta med kod 1 om den är i otakt
 *
 * Programmatisk användning (scripts/register.test.mjs):
 *   import { extractChapterIndex, buildRegister, applyRegister, checkRegister,
 *            REGISTER_START, REGISTER_END } from './register.mjs'
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const INDEX = join(ROOT, 'index.html');

/** Markörer för det genererade området. */
export const REGISTER_START =
  '<!-- register:start — genererat av scripts/register.mjs ur kapitelindexet; redigera inte för hand -->';
export const REGISTER_END = '<!-- register:end -->';

/**
 * Namn som inte börjar på en bokstav hamnar inte i en enda "symbolgrupp" —
 * en sådan blev 34 rader (fler än något kapitel) och gjorde @-regler,
 * pseudoklasser och element svåra att skilja åt. De delas i stället på samma
 * sätt som bokstäverna: en rubrik per teckenslag, med eget ankare.
 * Ordningen i listan är ordningen i registret.
 */
export const SYMBOL_SECTIONS = [
  { slug: 'at', label: '@', prefix: 'Tekniker som börjar med ', match: (ch) => ch === '@' },
  { slug: 'pseudo', label: ':', prefix: 'Tekniker som börjar med ', match: (ch) => ch === ':' },
  { slug: 'element', label: '<', prefix: 'Tekniker som börjar med ', match: (ch) => ch === '<' },
  { slug: 'siffror', label: '0–9', prefix: 'Tekniker som börjar med ', match: (ch) => /[0-9]/.test(ch) },
  { slug: 'ovrigt', label: 'Övrigt', prefix: '', match: () => true },
];
export const SYMBOL_SLUGS = SYMBOL_SECTIONS.map((s) => s.slug);
export const isSymbolKey = (key) => SYMBOL_SLUGS.includes(key);

/**
 * Vägvisaren i varje demo-kort markerad i index.html:
 *
 *   <!-- demo-ctx:ID --><p class="demo-ctx">…</p><!-- /demo-ctx:ID -->
 *
 * Regionen ligger sist i <article> (efter kodvalvet) och innehåller två
 * länkar: till kapitlets sektion och till kortets grupp i A–Ö-registret.
 * Kortet identifieras av id:t i markören, så regionen kan inte kopplas fel.
 */
export const ctxStart = (id) => `<!-- demo-ctx:${id} -->`;
export const ctxEnd = (id) => `<!-- /demo-ctx:${id} -->`;

export class RegisterError extends Error {}

/* ---------------------------------------------------------------- tolkning */

const decode = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

const encode = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Dela ett radnamn i tekniknamn och beskrivning vid den FÖRSTA " — ".
 * Namnen är skrivna som "teknik — vad den gör"; beskrivningen är valfri
 * (t.ex. "filter: contrast()"). Är bindestrecket en del av ett CSS-värde
 * (t.ex. "color-mix() kontinuerligt — scroll-länkad …") ligger delningen
 * ändå rätt: den sker vid första förekomsten av " — ", inte vid "-".
 */
export function splitName(raw) {
  const [name, ...rest] = raw.split(' — ');
  return { name: name.trim(), desc: rest.join(' — ').trim() };
}

/**
 * Kapitelchipsen (ul.index-kapitel) i panelen: id → { nr, title }.
 * Det är samma mål som kapitelsektionernas id:n, så kopplingen kan verifieras.
 */
export function chapterChips(html) {
  const listStart = html.indexOf('<ul class="index-kapitel">');
  if (listStart === -1) throw new RegisterError('hittar inte kapitelchipsen (ul.index-kapitel)');
  const listEnd = html.indexOf('</ul>', listStart);
  const chips = new Map();
  const chipRe = /<li><a href="#([^"]+)"><span class="nr">([^<]*)<\/span>([^<]*)<\/a><\/li>/g;
  for (const m of html.slice(listStart, listEnd).matchAll(chipRe)) {
    chips.set(m[1], { nr: m[2].trim(), title: m[3].trim() });
  }
  if (chips.size === 0) throw new RegisterError('kapitchipsen kunde inte tolkas');
  return chips;
}

/**
 * Kapitelsektionerna i dokumentordningen: { id, nr, text } där text är
 * etiketten + rubriken (för kontrollen av kopplingen mot kapitelindexet).
 */
export function chapterSections(html) {
  const starts = [...html.matchAll(/<section class="kapitel[^"]*" id="([^"]+)" data-nr="([^"]*)">/g)]
    .map((m) => ({ id: m[1], nr: m[2].trim(), at: m.index, end: m.index + m[0].length }));
  if (starts.length === 0) throw new RegisterError('hittar inga kapitelsektioner');
  return starts.map((s, i) => {
    const to = i + 1 < starts.length ? starts[i + 1].at : html.length;
    const head = html.slice(s.end, html.indexOf('</header>', s.end));
    const h2 = decode(head.match(/<h2>([\s\S]*?)<\/h2>/)?.[1] ?? '').replace(/\s+/g, ' ').trim();
    if (!h2) throw new RegisterError(`sektionen #${s.id} saknar <h2> i sin rubrik`);
    // Antalet demo-kort i sektionen: ett innehållsoberoende bevis på att
    // kapitel n i indexet hör till sektion n (används av chapterTagMap).
    const cards = (html.slice(s.end, to).match(/<article class="demo /g) || []).length;
    return { id: s.id, nr: s.nr, h2, cards, at: s.at };
  });
}

/**
 * Koppla kapitelrubrikerna i indexet till sektionerna.
 *
 * Indexlistan ligger före alla sektioner i dokumentet, så läget i dokumentet
 * kan inte avgöra vilket kapitel en rad hör till. Kopplingen sker därför
 * positionellt (kapitel n i listan = sektion n i dokumentet) och BEVISAS med
 * en rubrikkontroll: kapitlets första ord måste finnas i sektionens etikett
 * eller rubrik. Stämmer inte ordningen kastas ett fel i stället för att varje
 * rad tyst får fel kapiteltagg.
 */
export function chapterTagMap(html, chapterTitles) {
  const sections = chapterSections(html);
  const chips = chapterChips(html);
  if (sections.length !== chapterTitles.length) {
    throw new RegisterError(
      `kapitelindexet har ${chapterTitles.length} kapitel men dokumentet ${sections.length} kapitelsektioner`,
    );
  }
  return chapterTitles.map((title, i) => {
    const section = sections[i];
    const chip = chips.get(section.id);
    if (!chip) throw new RegisterError(`kapitelsektionen #${section.id} saknar chip i panelen`);
    // Appendix (ordlistan) har data-nr="" men chipen "+" — chipen är sanningen
    // för etiketten, sektionen kontrolleras bara när den anger ett nummer.
    if (section.nr !== '' && chip.nr !== section.nr) {
      throw new RegisterError(`#${section.id}: chipens nummer "${chip.nr}" ≠ sektionens data-nr "${section.nr}"`);
    }
    const norm = (x) => x.replace(/\s+/g, ' ').trim().toLocaleLowerCase('sv');
    if (norm(section.h2) !== norm(title)) {
      throw new RegisterError(
        `kapitel ${i + 1} i indexet heter "${title}" men sektionen #${section.id} har rubriken "${section.h2}"`,
      );
    }
    return { id: section.id, nr: chip.nr, title, cards: section.cards };
  });
}

/**
 * Läs kapitelindexet ur index.html.
 * Returnerar { chapters, rows } där varje rad bär id, namn, beskrivning,
 * stödklasser (sup-*), den färdiga prickmarkupen och kapiteltagg.
 *
 * Kastar RegisterError om markupen inte ser ut som väntat (hellre ett tydligt
 * fel än tyst felaktig utdata).
 */
export function extractChapterIndex(html) {
  const navStart = html.indexOf('<nav class="index"');
  if (navStart === -1) throw new RegisterError('hittar inte <nav class="index"> i index.html');
  const navEnd = html.indexOf('</nav>', navStart);
  if (navEnd === -1) throw new RegisterError('hittar inte slutet på kapitelindexet');
  const nav = html.slice(navStart, navEnd);

  const allIds = [...html.replace(/<textarea\b[\s\S]*?<\/textarea>/g, '').matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const idCount = new Map();
  for (const id of allIds) idCount.set(id, (idCount.get(id) || 0) + 1);

  const chapters = [];
  const chapterRe = /<details class="index-kap"[^>]*>\s*<summary>([\s\S]*?)<span class="antal">(\d+)<\/span><\/summary>\s*<ul>([\s\S]*?)<\/ul>\s*<\/details>/g;
  for (const m of nav.matchAll(chapterRe)) {
    const title = decode(m[1]).replace(/\s+/g, ' ').trim();
    const claimed = Number(m[2]);
    const body = m[3];
    const rows = [];
    const rowRe = /<li class="index-rad([^"]*)"><a href="#([^"]+)"><span class="rad-namn">([\s\S]*?)<\/span><i class="prikkar">([\s\S]*?)<\/i><\/a><\/li>/g;
    for (const r of body.matchAll(rowRe)) {
      const sup = r[1].trim().split(/\s+/).filter(Boolean).sort().join(' ');
      const id = r[2];
      const { name, desc } = splitName(decode(r[3]));
      if (!name) throw new RegisterError(`indexraden #${id} saknar namn`);
      rows.push({ id, name, desc, sup, dots: r[4], chapterTitle: title, chapterNr: '' });
    }
    const claimedLi = (body.match(/<li class="index-rad/g) || []).length;
    if (claimedLi !== rows.length) {
      throw new RegisterError(
        `radmarkupen i kapitlet "${title}" känns inte igen (${claimedLi} <li class="index-rad"> men ${rows.length} tolkade)`,
      );
    }
    if (claimed !== rows.length) {
      throw new RegisterError(`kapitlet "${title}" anger ${claimed} rader men innehåller ${rows.length}`);
    }
    chapters.push({ title, count: rows.length, rows });
  }

  if (chapters.length === 0) throw new RegisterError('kapitelindexet innehåller inga kapitel');

  /* Kapiteltagg per rad: kapitel n i indexet hör till sektion n i dokumentet.
     chapterTagMap bevisar kopplingen (chips ↔ sektion ↔ rubrik) och kastar
     hellre ett fel än att ge varje rad en tyst felaktig tagg. */
  const tagMap = chapterTagMap(html, chapters.map((c) => c.title));
  for (const [i, chapter] of chapters.entries()) {
    chapter.nr = tagMap[i].nr;
    chapter.sectionId = tagMap[i].id;
    /* Sektionskontroll: antalet indexrader i kapitlet måste vara antalet
       demo-kort i sektionen. Det fångar en omkastad kapitelordning även om
       rubrikerna skulle vara identiska. Appendix (ordlistan) har inga kort:
       där är kontrollen i stället att raden pekar på sektionen själv. */
    const cards = tagMap[i].cards;
    if (cards === 0) {
      const self = chapter.rows.length === 1 && chapter.rows[0].id === chapter.sectionId;
      if (!self) {
        throw new RegisterError(
          `kapitlet "${chapter.title}" har varken demo-kort i sektionen eller exakt en rad som pekar på #${chapter.sectionId}`,
        );
      }
    } else if (cards !== chapter.rows.length) {
      throw new RegisterError(
        `kapitlet "${chapter.title}" har ${chapter.rows.length} indexrader men sektionen #${chapter.sectionId} innehåller ${cards} demo-kort`,
      );
    }
    for (const row of chapter.rows) {
      row.chapterNr = chapter.nr;
      row.sectionId = chapter.sectionId;
    }
  }

  const rows = chapters.flatMap((c) => c.rows);
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.id)) throw new RegisterError(`id:t #${row.id} förekommer flera gånger i kapitelindexet`);
    seen.add(row.id);
    const n = idCount.get(row.id) || 0;
    if (n !== 1) throw new RegisterError(`indexraden #${row.id} har ${n} mål i dokumentet (ska vara 1)`);
  }
  return { chapters, rows };
}

/* --------------------------------------------------------------- sortering */

/** Första tecknet, eller tom sträng. */
const firstChar = (s) => [...s][0] ?? '';

/** Är tecknet en bokstav i det svenska alfabetet (A–Ö, små som stora)? */
export const isLetter = (ch) => /^[a-zA-ZåäöÅÄÖ]$/.test(ch);

/**
 * Gruppnyckel: versal bokstav för A–Ö, annars teckenslagets slug (@ → "at").
 * Udda tecken (t.ex. en inledande punkt eller "--") hamnar i "övrigt" i
 * stället för att tyst försvinna.
 */
export function groupKey(name) {
  const ch = firstChar(name.trim());
  if (isLetter(ch)) return ch.toLocaleUpperCase('sv');
  return (SYMBOL_SECTIONS.find((s) => s.match(ch)) ?? SYMBOL_SECTIONS[SYMBOL_SECTIONS.length - 1]).slug;
}

/** Inbördes ordning mellan symbolgrupperna (samma som i SYMBOL_SECTIONS). */
const symbolRank = (key) => SYMBOL_SLUGS.indexOf(key);

/** Sorteringsnyckel i svensk ordning: Å, Ä, Ö efter Z (och efter versaler). */
export function sortKey(name) {
  return name
    .trim()
    .toLocaleUpperCase('sv')
    .replace(/Å/g, '[A')
    .replace(/Ä/g, '[B')
    .replace(/Ö/g, '[C');
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Gruppera raderna i A–Ö. Teckengrupperna (@, :, <, 0–9) står först, i
 * SYMBOL_SECTIONS ordning; därefter bokstäverna i svensk ordning.
 * Tomma grupper utelämnas — rubriker kommer ur innehållet, inte ur en fast
 * lista, så registret kan aldrig visa en rubrik utan rader.
 */
export function groupRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = groupKey(row.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => cmp(sortKey(a.name), sortKey(b.name)) || cmp(a.name, b.name));
  }
  // Enbokstavsnycklar i svensk ordning: 'A'…'Z' < '[A' (Å) < '[B' (Ä) < '[C' (Ö).
  const letters = [...groups.keys()].filter((k) => !isSymbolKey(k));
  letters.sort((a, b) => cmp(sortKey(a), sortKey(b)));
  const symbols = SYMBOL_SLUGS.filter((slug) => groups.has(slug));
  return [...symbols, ...letters].map((key) => ({
    key,
    symbol: isSymbolKey(key),
    label: isSymbolKey(key) ? SYMBOL_SECTIONS.find((s) => s.slug === key).label : key,
    prefix: isSymbolKey(key) ? SYMBOL_SECTIONS.find((s) => s.slug === key).prefix : 'Tekniker som börjar med ',
    rows: groups.get(key),
  }));
}

/* ------------------------------------------------------------------ markup */

/** Ankare i panelen: "#reg-at" för @-reglerna, "#reg-a" för bokstaven A osv. */
export const groupAnchor = (group) => `reg-${group.key.toLocaleLowerCase('sv')}`;
/** Rubriken i bokstavsraden och i grupprubriken ("A", "@", "0–9", "Övrigt"). */
export const groupTitle = (group) => group.label ?? group.key;

function renderRow(row) {
  const desc = row.desc ? `<span class="reg-desc"> · ${encode(row.desc)}</span>` : '';
  const kap = row.chapterNr ? `<span class="reg-kap" aria-hidden="true">${encode(row.chapterNr)}</span>` : '';
  return `<li class="reg-rad ${row.sup}"><a href="#${row.id}"><span class="reg-namn">${encode(row.name)}${desc}</span>${kap}<i class="prikkar">${row.dots}</i></a></li>`;
}

/** Hela regionens innehåll (utan markörerna). Ren funktion av indata. */
export function renderRegister(rows) {
  const groups = groupRows(rows);
  const out = [];
  out.push('<nav class="reg-abc-wrap" aria-label="Hoppa till begynnelsebokstav">');
  out.push('<ul class="reg-abc">');
  for (const g of groups) {
    out.push(`<li><a href="#${groupAnchor(g)}">${encode(groupTitle(g))}</a></li>`);
  }
  out.push('</ul>');
  out.push('</nav>');
  for (const g of groups) {
    out.push(`<section class="reg-avsnitt" id="${groupAnchor(g)}" aria-labelledby="${groupAnchor(g)}-rubrik">`);
    out.push(`<h3 class="reg-rubrik" id="${groupAnchor(g)}-rubrik"><span class="vh">${encode(g.prefix)}</span>${encode(groupTitle(g))}<span class="reg-antal">${g.rows.length}</span></h3>`);
    out.push('<ul class="reg-lista">');
    for (const row of g.rows) out.push(renderRow(row));
    out.push('</ul>');
    out.push('</section>');
  }
  return out.join('\n');
}

/** Skriv regionen i ett dokument. Ren funktion: (html, rows) → html. */
export function applyRegister(html, rows) {
  const a = html.indexOf(REGISTER_START);
  if (a === -1) throw new RegisterError(`markören saknas: ${REGISTER_START}`);
  if (html.indexOf(REGISTER_START, a + 1) !== -1) throw new RegisterError('markören register:start förekommer flera gånger');
  const b = html.indexOf(REGISTER_END, a);
  if (b === -1) throw new RegisterError(`slutmarkören saknas: ${REGISTER_END}`);
  const content = `\n${renderRegister(rows)}\n`;
  return html.slice(0, a + REGISTER_START.length) + content + html.slice(b);
}

/** Hela steget: (html) → { html, rows, groups }. */
export function buildRegister(html) {
  const { rows } = extractChapterIndex(html);
  return { html: applyCtx(applyRegister(html, rows), rows), rows, groups: groupRows(rows) };
}

/* ------------------------------------------------- kortens vägvisare (ctx) */

/**
 * Vägvisarens innehåll för en rad: kapitel + registergrupp.
 * Text (inte bara färg) så att länken säger något också i en länklista.
 */
export function renderCtx(row) {
  const key = groupKey(row.name);
  const group = groupRows([row])[0]; // gruppens label/prefix kommer ur samma tabell som registret
  const chapter = row.sectionId
    ? `<a class="ctx-kap" href="#${row.sectionId}">Kapitel ${row.chapterNr} · ${encode(row.chapterTitle)}</a>`
    : '';
  const reg = `<a class="ctx-reg" href="#${groupAnchor({ key })}">I registret: ${encode(groupTitle({ key, label: group.label }))}</a>`;
  return `<p class="demo-ctx">${chapter}<span class="ctx-sep" aria-hidden="true">·</span>${reg}</p>`;
}

/** Antal kort i dokumentet, och deras id:n i dokumentordningen. */
export function demoCardIds(html) {
  return [...html.matchAll(/<article class="demo[^"]*" id="([^"]+)">/g)].map((m) => m[1]);
}

/**
 * Skriv vägvisaren i varje demo-kort. Ren funktion: (html, rows) → html.
 *
 * Regionen hittas via markören i markören-paret, så en kopia kan inte hamna i
 * fel kort. Saknas regionen läggs den in sist i kortet (före </article>) —
 * ett nytt kort behöver alltså ingen handpåläggning, bara `npm run build`.
 * Kastar vid: markör utan kort, dubblerad markör, okänt id.
 */
export function applyCtx(html, rows) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const cm of html.matchAll(/<!-- demo-ctx:([^ >]+) -->/g)) {
    const id = cm[1];
    if (!byId.has(id)) throw new RegisterError(`vägvisaren <!-- demo-ctx:${id} --> saknar kort i kapitelindexet`);
    if (html.indexOf(ctxStart(id), cm.index + 1) !== -1) throw new RegisterError(`vägvisaren för #${id} förekommer flera gånger`);
    if (!html.includes(ctxEnd(id))) throw new RegisterError(`slutmarkören ${ctxEnd(id)} saknas`);
  }

  for (const id of demoCardIds(html)) {
    const row = byId.get(id);
    if (!row) throw new RegisterError(`kortet #${id} saknar rad i kapitelindexet (ingen vägvisare kan byggas)`);
    const content = renderCtx(row);
    const start = ctxStart(id);
    const a = html.indexOf(start);
    if (a === -1) {
      // Nytt kort (eller en tidigare version av dokumentet): lägg in regionen
      // sist i kortet med kortets egen indragning.
      const artStart = html.search(new RegExp(`<article class="demo[^"]*" id="${id}">`));
      if (artStart === -1) throw new RegisterError(`hittar inte kortet #${id} i dokumentet`);
      const close = html.indexOf('</article>', artStart);
      if (close === -1) throw new RegisterError(`kortet #${id} saknar </article>`);
      const lineStart = html.lastIndexOf('\n', close) + 1;
      const indent = html.slice(lineStart, close).match(/^[ \t]*/)[0];
      html = `${html.slice(0, close)}${indent}${start}${content}${ctxEnd(id)}\n${indent}${html.slice(close)}`;
      continue;
    }
    const b = html.indexOf(ctxEnd(id), a);
    if (b === -1) throw new RegisterError(`slutmarkören ${ctxEnd(id)} saknas`);
    html = html.slice(0, a + start.length) + content + html.slice(b);
  }
  return html;
}

/** Vägvisarna i ett dokument: Map<id, html-innehåll>. */
export function extractCtx(html) {
  const out = new Map();
  const re = /<!-- demo-ctx:([^ >]+) -->([\s\S]*?)<!-- \/demo-ctx:\1 -->/g;
  for (const m of html.matchAll(re)) out.set(m[1], m[2]);
  return out;
}

/* -------------------------------------------------------------- kontroller */

/** Nuvarande (genererade) innehåll mellan markörerna. */
export function currentRegion(html) {
  const a = html.indexOf(REGISTER_START);
  if (a === -1) throw new RegisterError(`markören saknas: ${REGISTER_START}`);
  const b = html.indexOf(REGISTER_END, a);
  if (b === -1) throw new RegisterError(`slutmarkören saknas: ${REGISTER_END}`);
  return html.slice(a + REGISTER_START.length, b);
}

/** Alla registerrader i ett dokument: { id, name, sup, chapterNr }. */
export function extractRegisterRows(html) {
  const region = currentRegion(html);
  const rows = [];
  // Namnet ligger i .reg-namn (utan råa <), beskrivningen i en valfri
  // .reg-desc, kapiteltaggen i .reg-kap och stödprickarna i .prikkar.
  const re = /<li class="reg-rad([^"]*)"><a href="#([^"]+)"><span class="reg-namn">([^<]*?)(?:<span class="reg-desc">[^<]*<\/span>)?<\/span>([\s\S]*?)<i class="prikkar">/g;
  for (const m of region.matchAll(re)) {
    const sup = m[1].trim().split(/\s+/).filter(Boolean).sort().join(' ');
    const name = decode(m[3]).trim();
    const kap = m[4].match(/<span class="reg-kap"[^>]*>([^<]*)<\/span>/);
    rows.push({ id: m[2], name, sup, chapterNr: kap ? kap[1] : '' });
  }
  const liCount = (region.match(/<li class="reg-rad/g) || []).length;
  if (liCount !== rows.length) {
    throw new RegisterError(`registerregionen innehåller ${liCount} rader men ${rows.length} kunde tolkas`);
  }
  return rows;
}

/**
 * Kontrollera att registret är i fas och fullständigt.
 * Returnerar { errors, stats }. Används av --check, npm run check och
 * scripts/register.test.mjs.
 */
export function checkRegister(html) {
  const errors = [];
  const stats = {};
  const error = (m) => errors.push(m);

  const markers = [...html.matchAll(new RegExp(REGISTER_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].length;
  if (markers !== 1) error(`markören register:start förekommer ${markers} gånger (ska vara 1)`);
  const endMarkers = (html.match(/<!-- register:end -->/g) || []).length;
  if (endMarkers !== 1) error(`markören register:end förekommer ${endMarkers} gånger (ska vara 1)`);
  if (errors.length) return { errors, stats };

  // Kontrollen ska RAPPORTERA ett trasigt dokument, inte kasta: den används
  // av CLI:t och av regressionstestet, och en stacktrace är inte ett svar.
  let rows;
  let regRows;
  try {
    ({ rows } = extractChapterIndex(html));
    regRows = extractRegisterRows(html);
  } catch (e) {
    if (e instanceof RegisterError) return { errors: [e.message], stats };
    throw e;
  }
  const expected = applyRegister(html, rows);
  if (expected !== html) error('registret är inte i fas med kapitelindexet — kör: npm run build');
  stats.rows = regRows.length;
  stats.groups = groupRows(rows).length;

  /* 1. Samma inventarium, exakt en gång var. */
  const chapterIds = rows.map((r) => r.id);
  const regIds = regRows.map((r) => r.id);
  const count = (list) => list.reduce((m, id) => m.set(id, (m.get(id) || 0) + 1), new Map());
  const a = count(chapterIds);
  const b = count(regIds);
  const missing = [...a.keys()].filter((id) => !b.has(id));
  const extra = [...b.keys()].filter((id) => !a.has(id));
  const dupes = [...b].filter(([, n]) => n > 1).map(([id]) => id);
  if (missing.length) error(`registerraden saknas för: ${missing.join(', ')}`);
  if (extra.length) error(`registret innehåller rader som inte finns i kapitelindexet: ${extra.join(', ')}`);
  if (dupes.length) error(`registerraden förekommer flera gånger: ${dupes.join(', ')}`);
  if (regRows.length !== chapterIds.length) {
    error(`registret har ${regRows.length} rader men kapitelindexet ${chapterIds.length}`);
  }

  /* 2. Varje rad: namn, stödklasser och kapiteltagg som i kapitelindexet. */
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const reg of regRows) {
    const src = byId.get(reg.id);
    if (!src) continue;
    if (reg.name !== src.name) error(`#${reg.id}: namnet skiljer sig ("${reg.name}" ≠ "${src.name}")`);
    if (reg.sup !== src.sup) error(`#${reg.id}: stödklasserna skiljer sig ("${reg.sup}" ≠ "${src.sup}")`);
    if (reg.chapterNr !== src.chapterNr) error(`#${reg.id}: kapiteltaggen skiljer sig ("${reg.chapterNr}" ≠ "${src.chapterNr}")`);
  }

  /* 3. Varje registerlänk har exakt ett mål i dokumentet. */
  const domIds = [...html.replace(/<textarea\b[\s\S]*?<\/textarea>/g, '').matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const idCount = count(domIds);
  for (const reg of regRows) {
    const n = idCount.get(reg.id) || 0;
    if (n !== 1) error(`#${reg.id}: målet finns ${n} gånger i dokumentet (ska vara 1)`);
  }

  /* 4. Bokstavsraden: ett ankare per grupp, i gruppordning, med mål. */
  const groups = groupRows(rows);
  const anchors = [...html.matchAll(/<li><a href="#(reg-[^"]+)">([^<]*)<\/a><\/li>/g)].map((m) => ({ href: m[1], label: decode(m[2]) }));
  if (anchors.length !== groups.length) {
    error(`bokstavsraden har ${anchors.length} ankare men registret ${groups.length} grupper`);
  } else {
    for (let i = 0; i < groups.length; i++) {
      const want = groupAnchor(groups[i]);
      if (anchors[i].href !== want) error(`bokstavsraden: ankare ${i + 1} är #${anchors[i].href}, väntade #${want}`);
      if (anchors[i].label !== groupTitle(groups[i])) {
        error(`bokstavsraden: etiketten "${anchors[i].label}" ≠ "${groupTitle(groups[i])}"`);
      }
      if ((idCount.get(want) || 0) !== 1) error(`bokstavsankaret #${want} har inget entydigt mål`);
    }
  }
  stats.anchors = anchors.length;

  /* 5. Registret är statisk markup: inga skript, inga inline-handlers. */
  const region = currentRegion(html);
  if (/<script[\s>]/i.test(region)) error('registerregionen innehåller ett <script>-element');
  if (/\son[a-z]+\s*=\s*"/i.test(region)) error('registerregionen innehåller en inline-händelsehanterare');

  /* 6. Vägvisaren i varje demo-kort: exakt en per kort, rätt mål. */
  const cards = demoCardIds(html);
  const ctx = extractCtx(html);
  const ctxMarkers = (html.match(/<!-- demo-ctx:[^ >]+ -->/g) || []).length;
  stats.ctx = ctx.size;
  if (ctxMarkers !== cards.length || ctx.size !== cards.length) {
    error(`vägvisare: ${ctxMarkers} markörer / ${ctx.size} regioner för ${cards.length} kort`);
  }
  for (const id of new Set(cards)) {
    const row = rows.find((r) => r.id === id);
    if (!row) { error(`kortet #${id} saknar rad i kapitelindexet`); continue; }
    const got = ctx.get(id);
    if (got === undefined) { error(`#${id}: vägvisaren saknas`); continue; }
    if (got !== renderCtx(row)) error(`#${id}: vägvisaren är inte i fas med kapitelindexet`);
    const art = html.slice(html.search(new RegExp(`<article class="demo[^"]*" id="${id}">`)));
    const card = art.slice(0, art.indexOf('</article>'));
    if (!card.includes(ctxStart(id))) error(`#${id}: vägvisaren ligger utanför kortet`);
    const targets = [...got.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    for (const t of targets) {
      if ((idCount.get(t) || 0) !== 1) error(`#${id}: vägvisaren pekar på #${t} som inte finns exakt en gång`);
    }
  }
  if (ctxMarkers !== cards.length && ctxMarkers === 0) {
    error('inga vägvisare finns — kör: npm run build');
  }

  return { errors, stats };
}

/* -------------------------------------------------------------------- CLI */

if (process.argv[1] && join(dirname(fileURLToPath(import.meta.url)), 'register.mjs') === process.argv[1]) {
  const check = process.argv.includes('--check');
  try {
    const html = readFileSync(INDEX, 'utf8');
    const { rows } = extractChapterIndex(html);
    const groups = groupRows(rows);
    const { html: generated } = buildRegister(html);

    console.log(`0-js · A–Ö-registret (${rows.length} rader i ${groups.length} grupper)\n`);
    if (check) {
      // Kontrollen läser det COMMITTADE dokumentet, inte det genererade —
      // annars vore den alltid grön.
      const { errors, stats } = checkRegister(html);
      if (errors.length) {
        for (const e of errors) console.error(`✗ ${e}`);
        process.exit(1);
      }
      console.log(`Registret är i fas: ${stats.rows} rader, ${stats.groups} grupper, ${stats.anchors} bokstavsankare, ${stats.ctx} kortvägvisare.`);
    } else if (generated === html) {
      console.log('index.html redan i fas — inget skrevs.');
    } else {
      writeFileSync(INDEX, generated);
      console.log(`Skrev index.html · registret uppdaterat (${rows.length} rader, ${groups.length} grupper).`);
    }
  } catch (e) {
    if (e instanceof RegisterError) { console.error(`✗ ${e.message}`); process.exit(1); }
    throw e;
  }
}
