#!/usr/bin/env node
/**
 * demo-scenarios.mjs — interaktiva tillstånd för de migrerade demona.
 *
 * Ett scenario är en namngiven sekvens av verkliga användarhandlingar
 * (klick, tangentbord, fokus, hover) som körs i en riktig webbläsare.
 * Scenarierna används av:
 *   - tests/demo-source.mjs  (uttryckliga påståenden om beteendet)
 *   - tests/demo-parity.mjs  (mätning före/efter migreringen)
 *
 * `apply({ page, root, card })` får:
 *   root  Locator för demots yta (`.demo-yta`) — samma nod i både
 *         kortet på sidan och den fristående testsidan.
 *   card  Locator för hela kortet (`#<id>`) på sidan; i den fristående
 *         testsidan samma som body. Används för sidans scenografi (t.ex.
 *         jämförarens `.jmf`-reglage som medvetet ligger utanför källan).
 *
 * Zero-JS-löftet gäller dokumentet, inte testet: här får vi trycka på
 * knappar, fylla i fält och flytta fokus precis som en besökare gör.
 */

/** @typedef {{ name: string, apply: (ctx: { page: import('playwright').Page, root: import('playwright').Locator, card: import('playwright').Locator }) => Promise<void> }} Scenario */

/** @type {Record<string, Scenario[]>} */
export const SCENARIOS = {
  'shape-outside': [
    { name: 'jmf-av', apply: async ({ card }) => { await card.locator('.jmf-knapp').click(); } },
  ],
  target: [
    { name: 'panel-tva', apply: async ({ root }) => { await root.locator('a[href="#tp-2"]').click(); } },
  ],
  'property-border-angle': [],
  'accent-color': [
    {
      name: 'omarkerad',
      apply: async ({ root }) => {
        await root.locator('label:nth-child(1) input').uncheck();
        await root.locator('label:nth-child(2) input').check();
      },
    },
  ],
  'caret-shape-caret-color': [
    {
      name: 'text-inmatad',
      apply: async ({ page, root }) => {
        await root.locator('input').click();
        await page.keyboard.type('Hej');
      },
    },
  ],
  open: [
    { name: 'oppnad', apply: async ({ root }) => { await root.locator('summary').click(); } },
  ],
  'appearance-base-select': [
    { name: 'fokus', apply: async ({ root }) => { await root.locator('select').focus(); } },
  ],
  losenordsmatare: [
    { name: 'for-kort', apply: async ({ root }) => { await root.locator('input').fill('abc'); } },
    { name: 'godkand', apply: async ({ root }) => { await root.locator('input').fill('Abcdefg1'); } },
  ],
  'dubbeltumme-slider': [
    {
      name: 'fokus-lagsta',
      apply: async ({ page, root }) => {
        await root.locator('input[type="range"]').first().focus();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
      },
    },
  ],
  'calc-size': [
    { name: 'utfalld', apply: async ({ root }) => { await root.locator('.calc-size-trigger').click(); } },
  ],
  attr: [
    { name: 'hover', apply: async ({ root }) => { await root.locator('a').first().hover(); } },
  ],
  if: [
    { name: 'varning-ja', apply: async ({ root }) => { await root.locator('#nd-varna').check(); } },
  ],
  'light-dark': [
    { name: 'jmf-av', apply: async ({ card }) => { await card.locator('.jmf-knapp').click(); } },
  ],
  donutdiagram: [
    { name: 'jmf-av', apply: async ({ card }) => { await card.locator('.jmf-knapp').click(); } },
  ],
  /* Grupp B — labbdemos. Reglaget (.labb) är sidans scenografi och ligger
     utanför källan, men det är ändå den interaktion som påverkar demot:
     :has() sätter --lv och de live-only-reglerna läser den. */
  'color-mix': [
    { name: 'lv-0', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="0"]').check(); } },
    { name: 'lv-8', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="8"]').check(); } },
  ],
  'linear-gradient': [
    { name: 'lv-0', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="0"]').check(); } },
    { name: 'lv-8', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="8"]').check(); } },
  ],
  'rgb-from': [
    { name: 'lv-0', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="0"]').check(); } },
    { name: 'lv-8', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="8"]').check(); } },
    { name: 'theme-syra', apply: async ({ page }) => { await page.locator('#tema-syra').check(); } },
  ],
  'oklch-display-p3': [
    { name: 'theme-syra', apply: async ({ page }) => { await page.locator('#tema-syra').check(); } },
  ],
  'radial-gradient': [
    { name: 'lv-0', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="0"]').check(); } },
    { name: 'lv-8', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="8"]').check(); } },
    { name: 'theme-syra', apply: async ({ page }) => { await page.locator('#tema-syra').check(); } },
  ],
  'conic-gradient': [
    { name: 'lv-0', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="0"]').check(); } },
    { name: 'lv-8', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="8"]').check(); } },
    { name: 'theme-syra', apply: async ({ page }) => { await page.locator('#tema-syra').check(); } },
  ],
  'repeating-linear-gradient': [
    { name: 'lv-0', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="0"]').check(); } },
    { name: 'lv-8', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="8"]').check(); } },
    { name: 'theme-syra', apply: async ({ page }) => { await page.locator('#tema-syra').check(); } },
  ],
  'repeating-radial-gradient': [
    { name: 'lv-0', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="0"]').check(); } },
    { name: 'lv-8', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="8"]').check(); } },
    { name: 'theme-syra', apply: async ({ page }) => { await page.locator('#tema-syra').check(); } },
  ],
  /* Grupp B — filterfamiljen. Samma reglage som gradienterna, men varje demo
     räknar om --lv till sin egen enhet (px, procent, grader). */
  'filter-blur': [
    { name: 'lv-0', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="0"]').check(); } },
    { name: 'lv-8', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="8"]').check(); } },
    { name: 'theme-syra', apply: async ({ page }) => { await page.locator('#tema-syra').check(); } },
  ],
  'filter-contrast': [
    { name: 'lv-0', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="0"]').check(); } },
    { name: 'lv-8', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="8"]').check(); } },
    { name: 'theme-syra', apply: async ({ page }) => { await page.locator('#tema-syra').check(); } },
  ],
  'filter-saturate': [
    { name: 'lv-0', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="0"]').check(); } },
    { name: 'lv-8', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="8"]').check(); } },
    { name: 'theme-syra', apply: async ({ page }) => { await page.locator('#tema-syra').check(); } },
  ],
  'filter-hue-rotate': [
    { name: 'lv-0', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="0"]').check(); } },
    { name: 'lv-8', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="8"]').check(); } },
    { name: 'theme-syra', apply: async ({ page }) => { await page.locator('#tema-syra').check(); } },
  ],
  'filter-sepia': [
    { name: 'lv-0', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="0"]').check(); } },
    { name: 'lv-8', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="8"]').check(); } },
    { name: 'theme-syra', apply: async ({ page }) => { await page.locator('#tema-syra').check(); } },
  ],
  'filter-grayscale': [
    { name: 'lv-0', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="0"]').check(); } },
    { name: 'lv-8', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="8"]').check(); } },
    { name: 'theme-syra', apply: async ({ page }) => { await page.locator('#tema-syra').check(); } },
  ],
  'filter-invert': [
    { name: 'lv-0', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="0"]').check(); } },
    { name: 'lv-8', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="8"]').check(); } },
    { name: 'theme-syra', apply: async ({ page }) => { await page.locator('#tema-syra').check(); } },
  ],
  'filter-drop-shadow': [
    { name: 'lv-0', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="0"]').check(); } },
    { name: 'lv-8', apply: async ({ card }) => { await card.locator('.labb-steg input[data-v="8"]').check(); } },
    { name: 'theme-syra', apply: async ({ page }) => { await page.locator('#tema-syra').check(); } },
  ],
};

/** Scenarier för ett id (tom lista om demot inte är interaktivt). */
export function scenariosFor(id) {
  return SCENARIOS[id] ?? [];
}
