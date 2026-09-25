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
 *   type     'pilot' (första tre, PR #4) eller 'batch-1' (denna migration)
 *   anchors  id:n i demots markup som interna länkar pekar på (dokumenteras
 *            för läsbarhet; byggtestet härleder dem ur källfilen)
 *   liveCss  true om källfilen har <style data-live> (sidans scenografi som
 *            medvetet INTE följer med i det kopierbara kodvalvet)
 *   note     kort motivering till varför demot kunde migreras mekaniskt
 */

export const DEMO_SPEC = [
  {
    id: 'shape-outside',
    type: 'pilot',
    anchors: [],
    liveCss: true,
    note: 'jämförarens av-läge är live-only (jmfbar) och ligger i <style data-live>',
  },
  {
    id: 'target',
    type: 'pilot',
    anchors: ['tp-1', 'tp-2', 'tp-3'],
    liveCss: false,
    note: 'ankarlänkar och panel-id:n är en del av demot, inte av sidan',
  },
  {
    id: 'property-border-angle',
    type: 'pilot',
    anchors: [],
    liveCss: false,
    note: '@property-registreringen följer med i källan och därmed i kodvalvet',
  },
  {
    id: 'accent-color',
    type: 'batch-1',
    anchors: [],
    liveCss: false,
    note: 'tre regler, ingen delad CSS, inga sidreferenser till .nd-accent',
  },
  {
    id: 'caret-shape-caret-color',
    type: 'batch-1',
    anchors: [],
    liveCss: false,
    note: 'en enda regel (.nd-caret input) utan kopplingar till andra kort',
  },
  {
    id: 'open',
    type: 'batch-1',
    anchors: [],
    liveCss: false,
    note: 'fyra :open/:summary-regler, interaktivt via details utan skript',
  },
  {
    id: 'appearance-base-select',
    type: 'batch-1',
    anchors: [],
    liveCss: false,
    note: '@supports-blocken hör till demot och kodvalvet blir komplett först nu',
  },
  {
    id: 'losenordsmatare',
    type: 'batch-1',
    anchors: [],
    liveCss: false,
    note: 'fem regler kring .pwd-field/.pwd-meter, interaktivt via :valid',
  },
  {
    id: 'dubbeltumme-slider',
    type: 'batch-1',
    anchors: [],
    liveCss: false,
    note: 'fem regler inkl. leverantörs-pseudoelementen ::-webkit/::-moz-slider-thumb',
  },
  {
    id: 'calc-size',
    type: 'batch-1',
    anchors: [],
    liveCss: false,
    note: 'sju regler med :has() och calc-size(auto, size), interaktivt via kryssruta',
  },
  {
    id: 'attr',
    type: 'batch-1',
    anchors: [],
    liveCss: false,
    note: 'fyra regler; ::after-content med attr(data-url) verifieras i webbläsare',
  },
  {
    id: 'if',
    type: 'batch-1',
    anchors: [],
    liveCss: false,
    note: 'fyra regler; --varning och id:t #nd-varna hör till demot',
  },
  {
    id: 'light-dark',
    type: 'batch-1',
    anchors: [],
    liveCss: true,
    note: 'jämförarens av-läge (.ld-box) är live-only och ligger i <style data-live>',
  },
  {
    id: 'donutdiagram',
    type: 'batch-1',
    anchors: [],
    liveCss: true,
    note: 'jämförarens av-läge (.donut) är live-only och ligger i <style data-live>',
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
