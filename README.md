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

Dokumentet är fristående: typsnitten (Space Grotesk, IBM Plex Mono) är
inbäddade som WOFF2 och inga externa resurser hämtas. Det fungerar offline.

---

## Vad betyder ”Zero-JS”?

`0-js` betyder att den **publicerade webbplatsens funktionalitet** bygger på
HTML, CSS och webbläsarens inbyggda funktioner — utan applikations-JavaScript i
besökarens runtime.

Det betyder **inte** att:

- JavaScript är förbjudet i utvecklingsverktyg, tester eller byggsteg.
- CSS kan ersätta serverlogik eller tillståndshantering i alla situationer.
- En visuellt fungerande komponent automatiskt uppfyller tillgänglighetskrav.

Referensen är ärlig med gränsen mellan dessa. Demos som *liknar* en kontroll
men inte *är* en fullständig kontroll sägs uttryckligen: den scroll-länkade
färgblandningen är en visualisering och inte en ARIA-slider, en `popover` är
icke-modal (ingen fokusfälla — den ger `<dialog>` med `showModal`), och
lösenordsmätaren är binär eftersom CSS bara kan läsa `:valid`.

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
**2026-08-30** — inte en livekontroll och inte en detektering av besökarens
installerade version. Tre dimensioner hålls isär:

1. **Browser-support** — finns tekniken i respektive webbläsare/version?
2. **Verifierad funktion** — fungerar just detta demo?
3. **Produktionsstatus** — körbart rakt av, med fallback, eller experiment?

Att en webbläsare stöder en CSS-syntax garanterar inte att en viss interaktion
fungerar felfritt; kända webbläsarbeteenden och fallbacks dokumenteras på
kortet (t.ex. `corner-shape`-problemet i commit-historiken). Filtreringen i
indexet bygger på förifyllda support-klasser och förklaras på sidan när den är
aktiv.

---

## Att kopiera kod

Kodexemplen använder sidans designvariabler (`--acc`, `--bg2`, `--line` …).
Kopiera **Grundpaketet** först (kapitel 03) så fungerar alla andra snippets
direkt. `scripts/check-snippets.mjs` verifierar **statiskt** att varje exempel
håller måttet: balanserade taggar och klammerblock, samt att varje `var(--x)`
är deklarerad i exemplet själv eller i Grundpaketet.

Kontrollen är medvetet begränsad och ersätter inte ögonen:

- den renderar inte exemplen i en webbläsare,
- den analyserar inte CSS-kaskadens omfattning (scope/specificitet),
- en `var()` med fallback godkänns utan deklaration.

---

## Testning

Alla kontroller är rena Node-skript **utan npm-beroenden**, i projektets anda:

```sh
node scripts/check.mjs            # nivå 1: struktur, zero-JS, ARIA-hygien
node scripts/check-snippets.mjs   # nivå 4: kopierbara exempel (statiskt)
node scripts/check.test.mjs       # regressionstest för kontrollerna själva
# eller: npm run check
```

`check.test.mjs` injicerar 15 representativa defekter (script-taggar, inline-
handlers, trasiga ankarlänkar, dubblerade id:n, felaktiga demo-antal, saknade
CSS-variabler, obalanserade klammerblock, felaktig HTML-nästning, vilseledande
ARIA) och kräver att kontrollerna fångar varje defekt. Regressionstesterna kör
helt i minnet — ingen webbläsare, inga temporärfiler.

### CI

En komplett workflow (`ci.yml`, färdig att läggas i `.github/workflows/`)
finns i projektet men har i skrivande stund inte kunnat committas, eftersom
token som används saknar `workflows`-behörighet. Innehållet: kontrollerna ovan
som obligatoriskt jobb utan npm-installation eller webbläsare, plus ett
valfritt, icke-blockerande Playwright-jobb som tar skärmbilder. **Status just
nu: ej installerad — CI påstås inte vara aktivt förrän filen är committad och
en körning verifierats.** Installationsinstruktioner finns i PR-tråden.

### Vägkarta

- **Nivå 2 — funktionella tester:** `tests/menu-keyboard.mjs` verifierar
  mobilmenyns tangentbordsflöde i en riktig webbläsare och körs i CI:s valfria
  webbläsarjobb. Kräver Chromium (`npx playwright install chromium`) och
  blockerar aldrig de snabba statiska kontrollerna.
- **Nivå 3 — webbläsarmatris:** verifiera utvalda demos i Chromium, Firefox och
  WebKit, med dokumenterad fallback per experimentell funktion.
- **Nivå 4b — isolerad snippet-rendering:** bygg en testsida av varje exempel
  och verifiera den i en riktig webbläsare.
- **Prestanda:** mät överförd storlek, DOM-storlek, LCP och scroll-respons på
  mobil innan en eventuell uppdelning i flera sidor övervägs.

---

## Tillgänglighet

Tillgänglighet är ett publiceringskrav. Demos med interaktion ska gå att förstå
med skärmläsare, manövrera med tangentbord, följa synliga fokustillstånd och
använda utan den senaste experimentella browser-funktionen. Så här är det
löst idag:

- **Mobilmenyn** styrs av en riktig, fokuserbar checkbox (Tab + Space). Den är
  visuellt dold men aldrig `hidden`, fokusindikatorn projiceras på den synliga
  öppna/stäng-knappen via `:has()`, och panelens länkar är nästa Tab-stopp.
  Mönstret är valt framför `<details>` (kan inte tvingas permanent öppen på
  breda skärmar) och deklarativ popover (panelen är en statisk sidebar på
  desktop).
- **Webbläsarstödet** är information, inte kontroller: ikonerna är inga
  tab-stopp. Texten *webbläsare · version · status* ligger alltid i
  tillgänglighetsträdet (skärmläsare når den utan hover) och visas som etikett
  vid hover på pekenheter. Status syns dessutom alltid via ikonbehandling,
  markör och summan ”x/4”.
- **Teman, filter och laboratorier** har explicita tillgängliga namn, inte bara
  färg och `title`.
- **`prefers-reduced-motion`** respekteras genom hela dokumentet.

Detta ersätter inte manuell verifiering med riktig skärmläsare; CSS-genererade
siffror (räknare, diagram) behöver granskas i riktig AT.

---

## Typsnitt och payload — ett dokumenterat val

Typsnitten är inbäddade som base64-WOFF2 (latin + latin-ext,
`unicode-range`-subsettade). Mätt 2026-09-25:

| Variant | Rått | Gzip | Brotli | Externa anrop |
| ------- | ---- | ---- | ------ | ------------- |
| Extern font-CDN (tidigare) | 858 kB | 131 kB | 85 kB | 3 CSS + upp till 6 fontfiler |
| Inbäddade typsnitt (nu) | 997 kB | 233 kB | 185 kB | 0 |

Inbäddningen kostar alltså ≈101 kB överföring (brotli) mot att vara helt
fristående och offline-kapabel — ett medvetet val för en artefakt vars hela
idé är *en fil, noll beroenden*. En hostad produktionsversion skulle kunna
vinna på separata, cachebara font-assetfiler; det spåret byggs inte förrän ett
konkret behov finns. Licenser och upphov: [THIRD-PARTY.md](THIRD-PARTY.md).

---

## Kända begränsningar

- En enda stor HTML-fil (≈1 MB rått, ≈185 kB brotli). Uppdelning övervägs först
  när verklig prestanda mätts.
- Stöddata är en daterad ögonblicksbild, inte live eller runtime-detektering.
- Kodexempel-kontrollen är statisk: ingen browser-rendering, ingen scope-
  analys. Att den är grön är ett nödvändigt, inte tillräckligt, villkor.
- CSS-genererade värden (räknare, diagram) behöver granskas med riktig
  skärmläsare för annonsering.
- Mobilmenyns tillstånd ligger inte i URL:en; Back/Forward påverkar panelen
  som för alla checkbox-baserade mönster.
- Vissa demos har plattformsbegränsningar som är dokumenterade på kortet
  (t.ex. tic-tac-toes turordning bygger på heder — CSS kan inte jämföra
  antal drag).

---

## Struktur

```
0-js/
├── index.html              # hela referensen — produkt och källa i ett
├── scripts/
│   ├── check.mjs           # nivå 1: struktur, zero-JS, ARIA
│   ├── check-snippets.mjs  # nivå 4: kopierbara exempel (statiskt)
│   ├── check.test.mjs      # regressionstest för kontrollerna
│   └── screenshot.mjs      # valfria skärmbilder (kräver playwright)
├── tests/
│   └── menu-keyboard.mjs   # nivå 2: mobilmenyns tangentbord (kräver webbläsare)
├── THIRD-PARTY.md          # licenser för inbäddade typsnitt
├── LICENSE                 # MIT (kod) — OFL 1.1 (typsnitt) gäller separat
└── README.md
```

---

## Bidra

1. En demo = ett kort med stödrad, fallback och kopierbart kodvalv.
2. Beskriv vad demot **faktiskt gör**, inte vad komponenten liknar.
3. Kör `npm run check` innan push (struktur + snippets + regressionstest).
4. Lägg till stöddata med datum och källa, och skilj på browser-support och
   verifierat demo.

## Licens

[MIT](LICENSE) — koden och exemplen är avsedda att återanvändas fritt, även
kommersiellt. De inbäddade typsnitten distribueras under SIL Open Font License
1.1; se [THIRD-PARTY.md](THIRD-PARTY.md).
