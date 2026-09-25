# CSS·REF — en levande referens för CSS utan JavaScript

**133 körbara demos · 10 kapitel · 1 HTML-fil · 0 rader JavaScript.**

Det här projektet visar **när en modern webbläsarprimitiv faktiskt kan ersätta
JavaScript**, vilka begränsningar som finns och hur tekniken används säkert i
produktion. Varje kort är körbar kod — inte en illustration av den — och varje
kort visar exakt vilka webbläsare som stöder tekniken.

Öppna [`index.html`](index.html) direkt i en webbläsare, eller servea katalogen:

```sh
python3 -m http.server 8080   # eller valfri statisk server
```

> Dokumentet är helt fristående: typsnitten (Space Grotesk, IBM Plex Mono) är
> inbäddade som WOFF2 och inga externa resurser laddas. Det fungerar offline.

---

## Vad betyder ”Zero-JS”?

`0-js` betyder att den **publicerade webbplatsens funktionalitet** bygger på
HTML, CSS och webbläsarens inbyggda funktioner — utan applikations-JavaScript i
besökarens runtime.

Det betyder **inte** att:

- JavaScript är förbjudet i utvecklingsverktyg eller byggsteg.
- CSS kan ersätta serverlogik eller tillståndshantering i alla situationer.
- En visuellt fungerande komponent automatiskt uppfyller tillgänglighetskrav.

Referensen är ärlig med gränsen mellan dessa. Demos som *liknar* en kontroll
men inte *är* en fullständig kontroll sägs uttryckligen — till exempel är den
scroll-länkade färgblandningen en visualisering, inte en ARIA-slider, och en
`popover` är icke-modal (ingen fokusfälla; den ger `<dialog>` med `showModal`).

---

## Innehåll

| Kapitel | Ämne |
| ------ | ---- |
| 01 | Färg — `color-mix()`, `oklch()`, `light-dark()`, relativa färger, blend |
| 02 | Layout & rutnät — subgrid, containers, `shape-outside`, masonry |
| 03 | Kaskad & räckvidd — `@layer`, `@scope`, `:where()`, `@property`, `@function` |
| 04 | Rörelse & tid — scroll-drivna animationer, `view-timeline`, trigonometri |
| 05 | Interaktion utan skript — `popover`, `:has()`, `:target`, `details` |
| 06 | Komponenter — `<dialog>`, tabbar, carouseller, formulärkontroller |
| 07 | Typografi — `text-box-trim`, variabla typsnitt, avstavning |
| 08 | Data & visualisering — staplar, donut, heatmap, tidslinjer i ren CSS |
| 09 | Responsiv & adaptiv — `@media` för hover/pointer/scripting/gamut, `clamp()` |
| 10 | Logik & tillstånd — `:user-valid`, räknare, binäradderare |
| + | Fullständig ordlista över alla begrepp |

Varje demo har:

- **stödrad** per webbläsare (Chrome / Edge / Safari / Firefox) med version,
- **`@supports`-fallback** där tekniken inte är allestädes närvarande,
- ett **kopierbart kodvalv** (klicka i rutan → ⌘C / Ctrl+C).

---

## Webbläsarstöd

Stöddata är en **statisk ögonblicksbild**, hämtad från caniuse/MDN
**2026-08-30** — inte en livekontroll. Se datumet i sidhuvudet. Tre dimensioner
hålls isär:

1. **Browser-support** — finns tekniken i respektive webbläsare/version?
2. **Verifierad funktion** — fungerar just detta demo?
3. **Produktionsstatus** — körbart rakt av, med fallback, eller experiment?

Filtreringen i indexet bygger på förifyllda support-klasser, inte på runtime-
detektering av besökarens installerade version.

---

## Att kopiera kod

Kodexemplen använder sidans designvariabler (`--acc`, `--bg2`, `--line` …).
Kopiera **Grundpaketet** först (demo i kapitel 03) så fungerar alla andra
snippets direkt. Ett automatiserat test verifierar att varje publicerat exempel
är självförsörjande med sina deklarerade beroenden:

```sh
node scripts/check-snippets.mjs
```

---

## Testning & CI

CI kör statiska kontroller vid varje push och pull request
([`scripts/check.mjs`](scripts/check.mjs),
[`scripts/check-snippets.mjs`](scripts/check-snippets.mjs)):

- **Nivå 1 — statisk kontroll:** inga `<script>`, inga inline event handlers,
  inga `javascript:`-URL:er, unika id:n, interna länkar som pekar någonstans,
  antal demos kontra utlovat antal, tagg-balans och ARIA-hygien.
- **Nivå 4 — kodexempel:** varje kopierbart exempel byggs upp isolerat och
  kontrolleras mot sina deklarerade beroenden.

Kontrollerna är rena Node-skript **utan npm-beroenden**, i projektets anda.

### Vägkarta

- **Nivå 2 — funktionella tester:** Playwright mot renderad HTML (meny, filter,
  dialog, popover, tangentbordsnavigering).
- **Nivå 3 — webbläsarmatris:** verifiera utvalda demos i Chromium, Firefox och
  WebKit, med dokumenterad fallback per experimentell funktion.
- **Prestanda:** mät överförd storlek, DOM-storlek, LCP och scroll-respons på
  mobil innan en eventuell uppdelning i flera sidor övervägs.

---

## Tillgänglighet

Tillgänglighet är ett publiceringskrav. Demos med interaktion ska gå att förstå
med skärmläsare, manövrera med tangentbord, följa synliga fokustillstånd och
använda utan den senaste experimentella browser-funktionen. Konkret:

- Mobilmenyn styrs av en riktig, fokuserbar checkbox (Tab + Space).
- Stöd-ikonernas versionsetiketter når man även utan hover (fokus).
- Teman har explicita tillgängliga namn, inte bara färg och `title`.
- `prefers-reduced-motion` respekteras genom hela dokumentet.

Detta ersätter inte manuell verifiering med riktig skärmläsare.

---

## Kända begränsningar

- En enda stor HTML-fil (~1 MB okomprimerat, väsentligt mindre med
  HTTP-komprimering). Uppdelning övervägs först när verklig prestanda mätts.
- Stöddata är en daterad ögonblicksbild, inte live.
- CSS-genererade värden (räknare, diagram) behöver granskas med riktig
  skärmläsare för annonsering.

---

## Struktur

```
0-js/
├── index.html              # hela referensen — produkt och källa i ett
├── scripts/
│   ├── check.mjs           # nivå 1: struktur, zero-JS, ARIA
│   └── check-snippets.mjs  # nivå 4: kopierbara exempel
├── .github/workflows/
│   └── ci.yml              # kör kontrollerna vid push/PR
├── LICENSE                 # MIT
└── README.md
```

---

## Bidra

1. En demo = ett kort med stödrad, fallback och kopierbart kodvalv.
2. Beskriv vad demot **faktiskt gör**, inte vad komponenten liknar.
3. Kör `node scripts/check.mjs && node scripts/check-snippets.mjs` innan push.
4. Lägg till stöddata med datum och källa.

## Licens

[MIT](LICENSE) — exemplen är avsedda att återanvändas fritt, även kommersiellt.
Typsnitten (Space Grotesk, IBM Plex Mono) distribueras under SIL Open Font
License 1.1 via Fontsource och är inbäddade i dokumentet.
