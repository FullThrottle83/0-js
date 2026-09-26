#!/usr/bin/env node
/**
 * demo-spec.mjs — manifest över de demos som är migrerade till
 * en-källa-arbetsflödet (`demos/<id>.html`).
 *
 * Filen är den enda platsen där listan över migrerade demos underhålls.
 * Den läses av:
 *   - scripts/build.test.mjs   (statiska påståenden om varje migrerad demo)
 *   - tests/demo-source.mjs    (webbläsarscenarier, på sidan + fristående)
 *   - tests/demo-parity.mjs    (mätt ekvivalens mot baslinjen i tests/baseline/)
 *
 * Nya migreringar registreras här med sina fakta. Testsviterna kräver att
 * manifestet och `demos/*.html` är exakt samma mängd — att glömma ena sidan
 * är ett testfel, inte en tyst lucka.
 *
 * Fält:
 *   id       demots id i index.html (och filnamnet i demos/)
 *   type     'pilot' (första tre), 'batch-1' (Grupp A), 'batch-2' (Grupp B-pilot)
 *            eller 'batch-3'/'batch-4' (fortsättning av Grupp B)
 *   anchors  id:n i demots markup som interna länkar pekar på (dokumenteras
 *            för läsbarhet; byggtestet härleder dem ur källfilen)
 *   liveCss  true om källfilen har <style data-live> (sidans scenografi som
 *            medvetet INTE följer med i det kopierbara kodvalvet)
 *   shared   namn på de delade fragmenten i demos/_delat/ som källan begär
 *            med <style data-include="…">. Tom lista för demos som inte delar
 *            CSS med något annat kort. Byggtestet verifierar att listan är
 *            exakt det källfilen faktiskt efterfrågar.
 *   note     kort motivering till varför demot kunde migreras mekaniskt
 */

export const DEMO_SPEC = [
  {
    id: 'shape-outside',
    type: 'pilot',
    anchors: [],
    liveCss: true,
    shared: [],
    note: 'jämförarens av-läge är live-only (jmfbar) och ligger i <style data-live>',
  },
  {
    id: 'target',
    type: 'pilot',
    anchors: ['tp-1', 'tp-2', 'tp-3'],
    liveCss: false,
    shared: [],
    note: 'ankarlänkar och panel-id:n är en del av demot, inte av sidan',
  },
  {
    id: 'property-border-angle',
    type: 'pilot',
    anchors: [],
    liveCss: false,
    shared: [],
    note: '@property-registreringen följer med i källan och därmed i kodvalvet',
  },
  {
    id: 'accent-color',
    type: 'batch-1',
    anchors: [],
    liveCss: false,
    shared: [],
    note: 'tre regler, ingen delad CSS, inga sidreferenser till .nd-accent',
  },
  {
    id: 'caret-shape-caret-color',
    type: 'batch-1',
    anchors: [],
    liveCss: false,
    shared: [],
    note: 'en enda regel (.nd-caret input) utan kopplingar till andra kort',
  },
  {
    id: 'open',
    type: 'batch-1',
    anchors: [],
    liveCss: false,
    shared: [],
    note: 'fyra :open/:summary-regler, interaktivt via details utan skript',
  },
  {
    id: 'appearance-base-select',
    type: 'batch-1',
    anchors: [],
    liveCss: false,
    shared: [],
    note: '@supports-blocken hör till demot och kodvalvet blir komplett först nu',
  },
  {
    id: 'losenordsmatare',
    type: 'batch-1',
    anchors: [],
    liveCss: false,
    shared: [],
    note: 'fem regler kring .pwd-field/.pwd-meter, interaktivt via :valid',
  },
  {
    id: 'dubbeltumme-slider',
    type: 'batch-1',
    anchors: [],
    liveCss: false,
    shared: [],
    note: 'fem regler inkl. leverantörs-pseudoelementen ::-webkit/::-moz-slider-thumb',
  },
  {
    id: 'calc-size',
    type: 'batch-1',
    anchors: [],
    liveCss: false,
    shared: [],
    note: 'sju regler med :has() och calc-size(auto, size), interaktivt via kryssruta',
  },
  {
    id: 'attr',
    type: 'batch-1',
    anchors: [],
    liveCss: false,
    shared: [],
    note: 'fyra regler; ::after-content med attr(data-url) verifieras i webbläsare',
  },
  {
    id: 'if',
    type: 'batch-1',
    anchors: [],
    liveCss: false,
    shared: [],
    note: 'fyra regler; --varning och id:t #nd-varna hör till demot',
  },
  {
    id: 'light-dark',
    type: 'batch-1',
    anchors: [],
    liveCss: true,
    shared: [],
    note: 'jämförarens av-läge (.ld-box) är live-only och ligger i <style data-live>',
  },
  {
    id: 'donutdiagram',
    type: 'batch-1',
    anchors: [],
    liveCss: true,
    shared: [],
    note: 'jämförarens av-läge (.donut) är live-only och ligger i <style data-live>',
  },
  {
    id: 'color-mix',
    type: 'batch-2',
    anchors: [],
    liveCss: true,
    shared: ['swatch'],
    note: 'Grupp B: delar swatch-familjen med 15 andra labbkort; .cm-row och de fem stegen är demots egna, .labbar-överstyrningen är live-only',
  },
  {
    id: 'linear-gradient',
    type: 'batch-2',
    anchors: [],
    liveCss: true,
    shared: ['swatch', 'swatch-solo'],
    note: 'Grupp B: samma swatch-familie plus .swatch-solo (delat med tolv gradient-/filterkort); .grad-1 är demots egen regel, .labbar.grad-1 är live-only',
  },
  {
    id: 'rgb-from',
    type: 'batch-3',
    anchors: [],
    liveCss: true,
    shared: ['swatch'],
    note: 'Grupp B: relativa RGB/HSL-färger ägs av demot; labbets --lv-överstyrningar är live-only',
  },
  {
    id: 'oklch-display-p3',
    type: 'batch-3',
    anchors: [],
    liveCss: false,
    shared: ['swatch'],
    note: 'Grupp B: oklch/display-p3-fyllningar och fyrkolumnslayout ägs av demot; swatch-reglerna delas',
  },
  {
    id: 'radial-gradient', type: 'batch-4', anchors: [], liveCss: true,
    shared: ['swatch', 'swatch-solo'],
    note: 'Grupp B: egen gradientregel; --lv är endast laboratoriets scenografi',
  },
  {
    id: 'conic-gradient', type: 'batch-4', anchors: [], liveCss: true,
    shared: ['swatch', 'swatch-solo'],
    note: 'Grupp B: egen gradientregel; --lv är endast laboratoriets scenografi',
  },
  {
    id: 'repeating-linear-gradient', type: 'batch-4', anchors: [], liveCss: true,
    shared: ['swatch', 'swatch-solo'],
    note: 'Grupp B: egen gradientregel; --lv är endast laboratoriets scenografi',
  },
  {
    id: 'repeating-radial-gradient', type: 'batch-4', anchors: [], liveCss: true,
    shared: ['swatch', 'swatch-solo'],
    note: 'Grupp B: egen gradientregel; --lv är endast laboratoriets scenografi',
  },
  {
    id: 'filter-blur', type: 'batch-5', anchors: [], liveCss: true,
    shared: ['swatch', 'swatch-solo', 'filter-motiv'],
    note: 'Grupp B: det fyrskiktade motivet ägs av det delade filter-motiv-fragmentet; .f-blur är bara sin egen filter-deklaration, labbets --lv-skala är live-only',
  },
  {
    id: 'filter-contrast', type: 'batch-5', anchors: [], liveCss: true,
    shared: ['swatch', 'swatch-solo', 'filter-motiv'],
    note: 'Grupp B: motivet delas; .f-contrast är bara sin egen filter-deklaration, labbets --lv-skala är live-only',
  },
  {
    id: 'filter-saturate', type: 'batch-5', anchors: [], liveCss: true,
    shared: ['swatch', 'swatch-solo', 'filter-motiv'],
    note: 'Grupp B: motivet delas; .f-saturate är bara sin egen filter-deklaration, labbets --lv-skala är live-only',
  },
  {
    id: 'filter-hue-rotate', type: 'batch-5', anchors: [], liveCss: true,
    shared: ['swatch', 'swatch-solo', 'filter-motiv'],
    note: 'Grupp B: motivet delas; .f-hue är bara sin egen filter-deklaration, labbets --lv-skala är live-only',
  },
  {
    id: 'filter-sepia', type: 'batch-5', anchors: [], liveCss: true,
    shared: ['swatch', 'swatch-solo', 'filter-motiv'],
    note: 'Grupp B: motivet delas; .f-sepia är bara sin egen filter-deklaration, labbets --lv-skala är live-only',
  },
  {
    id: 'filter-grayscale', type: 'batch-5', anchors: [], liveCss: true,
    shared: ['swatch', 'swatch-solo', 'filter-motiv'],
    note: 'Grupp B: motivet delas; .f-gray är bara sin egen filter-deklaration, labbets --lv-skala är live-only',
  },
  {
    id: 'filter-invert', type: 'batch-5', anchors: [], liveCss: true,
    shared: ['swatch', 'swatch-solo', 'filter-motiv'],
    note: 'Grupp B: motivet delas; .f-invert är bara sin egen filter-deklaration, labbets --lv-skala är live-only',
  },
  {
    id: 'filter-drop-shadow', type: 'batch-5', anchors: [], liveCss: true,
    shared: ['swatch', 'swatch-solo', 'filter-motiv'],
    note: 'Grupp B: motivet delas; .f-drop är bara sin egen filter-deklaration (drop-shadow + brightness), labbets --lv-skala är live-only',
  },
];

/** Alla migrerade id:n, i manifestets ordning. */
export const MIGRATED_IDS = DEMO_SPEC.map((d) => d.id);

/** Slå upp en post; kastar om id:t inte är registrerat. */
export function specFor(id) {
  const found = DEMO_SPEC.find((d) => d.id === id);
  if (!found) throw new Error(`demo ${id} saknas i scripts/demo-spec.mjs`);
  return found;
}
