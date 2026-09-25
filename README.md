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

## En källa per demo (14 av 133 migrerade)

Ett demo-kort bär sin implementation tre gånger: live-markup, CSS i
stilbladet och det escapade kodvalvet. Det har redan gett drift (kodvalv med
föråldrad eller trasig CSS). Därför genereras nu **14 av de 133** demona ur
**en** källfil var i [`demos/`](demos/) — först pilotens tre
(`shape-outside`, `target`, `property-border-angle`), därefter elva ur
Grupp A i migreringsplanen (`accent-color`, `caret-shape-caret-color`, `open`,
`appearance-base-select`, `losenordsmatare`, `dubbeltumme-slider`, `calc-size`,
`attr`, `if`, `light-dark`, `donutdiagram`):

```sh
# redigera demos/<id>.html (markup + <style>, valfri <style data-live>)
npm run build               # skriver om de markerade områdena i index.html
npm run build:check         # avslutar med 1 om index.html är föråldrad (körs först i CI)
npm run baseline:capture    # fångar mätbaslinjen FÖRE en migrering (tests/baseline/)
npm run test:parity         # mäter aktuell rendering mot baslinjen
```

`index.html` är fortfarande den publicerade enfilsartefakten och källa för
allt utanför markörerna; bygget rör bara innehållet mellan
`<!-- demo:<id>:markup -->`, `/* demo:<id>:css */` och kortets kodvalv.
Bygget är deterministiskt, idempotent och beroendefritt. Vilka demos som är
migrerade står på **en** plats: [`scripts/demo-spec.mjs`](scripts/demo-spec.mjs).
Byggtestet, webbläsartesterna och paritetstestet läser manifestet och ställer
sina frågor per demo — glömmer du registrera en källa faller testerna.
Beslut, källformat, mätmetod och migreringsplan för de återstående 119 korten:
[`docs/demo-kalla.md`](docs/demo-kalla.md).

### Vad som bevisas var — statiskt kontra mätt

| Nivå | Verktyg | Bevisar | Kräver webbläsare |
| ---- | ------- | ------- | ----------------- |
| 0 | `npm run build:check` | `index.html` är i fas med `demos/*.html` | nej |
| 1 | `scripts/check.mjs` | struktur, zero-JS, unika id:n, ARIA | nej |
| 4 | `scripts/check-snippets.mjs` | kodexemplen är balanserade och täcker sina variabler | nej |
| 0 | `scripts/build.test.mjs` | determinism, härledning, stale, inventarium, inga delade regler | nej |
| 2/4b | `tests/demo-source.mjs` | demot **beter sig** rätt på sidan och fristående (inkl. interaktiva tillstånd) | ja |
| 4c | `tests/demo-parity.mjs` | det som **renderas** är oförändrat mot pre-migrerings-baslinjen i `tests/baseline/` | ja |
| 4c | `tests/demo-scenarios.mjs` | de interaktiva tillstånd (klick, tangentbord, hover) som nivå 4b/4c mäter | ja |

Ett statiskt test kan inte se att en regel hamnat i fel kaskadordning; en
mätning kan inte se att källan slutat vara källan. Gränsen är avsiktlig och
dokumenterad i [`docs/demo-kalla.md` §6b](docs/demo-kalla.md).

---

## Testning

Alla kontroller är rena Node-skript **utan npm-beroenden**, i projektets anda:

```sh
node scripts/build.mjs --check    # nivå 0: genererade demos i fas med demos/
node scripts/check.mjs            # nivå 1: struktur, zero-JS, ARIA-hygien
node scripts/check-snippets.mjs   # nivå 4: kopierbara exempel (statiskt)
node scripts/check.test.mjs       # regressionstest för kontrollerna själva
node scripts/build.test.mjs       # byggtest: determinism, härledning, stale, inventarium
# eller: npm run check
```

Webbläsartesterna kräver Playwright + Chromium (endast devDependency):

```sh
npm run test:browser                          # menyn + demo-source + paritet mot baslinjen
node tests/demo-parity.mjs --strict           # 0 px slack: exakt geometribevis i samma webbläsarinstans
node tests/demo-parity.mjs --require-same-browser   # fäll även på versionsglapp
npm run baseline:capture                      # fånga om baslinjen ur ett PRE-migreringsdokument
```

`tests/baseline/demos.json` är den committade mätbaslinjen för de migrerade
demona: DOM-ordning, text, attribut, geometri, beräknade stilar och
pseudoelement i standardtillståndet och i varje interaktivt tillstånd, fångad
ur dokumentet **före** migreringen (sha256 för dokumentet sparas i filen, så
att ursprunget kan granskas mot git-historiken).

Vilka lager som är grind beror på om webbläsarbygget är baslinjens:

- **samma bygge** — struktur, text, attribut, fältvärden och
  icke-geometriska stilar jämförs exakt; `--strict` gör även geometrin exakt.
- **annat bygge** (t.ex. CI:s Chromium) — strukturen jämförs exakt och fäller;
  stilar och geometri rapporteras, eftersom ett nyare bygge kan stödja fler
  funktioner och rendera annat. `--require-same-browser` gör glappet till fel.

Geometrin mäts dessutom med slack `max(2 px, 2 %)`: textmetrik skiljer mellan
Linux-byggen av samma Chromium. Gränsen och mätmetoden är dokumenterade i
[`docs/demo-kalla.md` §6b](docs/demo-kalla.md).

`check.test.mjs` injicerar 15 representativa defekter (script-taggar, inline-
handlers, trasiga ankarlänkar, dubblerade id:n, felaktiga demo-antal, saknade
CSS-variabler, obalanserade klammerblock, felaktig HTML-nästning, vilseledande
ARIA) och kräver att kontrollerna fångar varje defekt. Regressionstesterna kör
helt i minnet — ingen webbläsare, inga temporärfiler. `build.test.mjs` gör
detsamma för källgenereringen, inventariestyrt: manifestet och `demos/*.html`
måste vara exakt samma mängd, varje migrerad källa prövas för sig (id:n och
ankare unika och pekade på, kodvalvet = `renderSnippet(källa)`, `rows`,
`data-live` utanför valvet, `var()` täckta), inga CSS-regler får delas mellan
källor, två byggen är byte-identiska, ändringar i källa *eller* i ett genererat
område upptäcks som stale, ändringar utanför markörerna bevaras, de 119
omigrerade korten förblir omarkerade och dokumentet är fritt från
runtime-JavaScript.

### CI

Workflowen [`.github/workflows/ci.yml`](.github/workflows/ci.yml) kör de
statiska kontrollerna som ett obligatoriskt jobb utan npm-installation eller
webbläsare. Därefter kör ett obligatoriskt Playwright-jobb mobilmenyns
tangentbordstest och de källgenererade demonas beteendetest
(`tests/demo-source.mjs`: på sidan och fristående som Grundpaketet + kodvalv,
inklusive interaktiva tillstånd). Både byggtestet och beteendetestet är
inventariestyrda ur `scripts/demo-spec.mjs`, så de nya demona omfattas utan
att workflowen ändras. Endast skärmbildsgenerering och artefaktuppladdning är
icke-blockerande. **Status: workflow installerad; kontrollera den första
GitHub Actions-körningen innan ändringarna merge:as.**

Paritetssteget (`node tests/demo-parity.mjs`) ingår i `npm run test:browser`
och är förberett som tredje steg i webbläsarjobbet; den exakta raden ligger i
PR-beskrivningen. Filen `.github/workflows/ci.yml` kan inte uppdateras från
den här grenen — den automatiska GitHub-appen saknar `workflows`-behörighet,
och GitHub avvisar både push och API-anrop som rör workflowfiler. Ändringen
är därför en ettstegsändring för en människa (eller en app med rätt
behörighet).

### Vägkarta

- **Nivå 2 — funktionella tester:** `tests/menu-keyboard.mjs` verifierar
  mobilmenyns tangentbordsflöde i en riktig webbläsare och körs i CI:s
  obligatoriska webbläsarjobb. Kräver Chromium (`npx playwright install chromium`)
  och startar efter de snabba statiska kontrollerna.
- **Nivå 3 — webbläsarmatris:** verifiera utvalda demos i Chromium, Firefox och
  WebKit, med dokumenterad fallback per experimentell funktion.
- **Nivå 4b — isolerad snippet-rendering:** bygg en testsida av varje exempel
  och verifiera den i en riktig webbläsare. Gjort för de 14 källgenererade
  demona i `tests/demo-source.mjs`; återstår för övriga 119.
- **Nivå 4c — mätt ekvivalens mot baslinje:** `tests/demo-parity.mjs` jämför
  renderingen med `tests/baseline/demos.json` (fångad före migreringen).
  Gjort för de 14 migrerade demona; växer automatiskt med manifestet.
- **Prestanda:** mät överförd storlek, DOM-storlek, LCP och scroll-respons på
  mobil innan en eventuell uppdelning i flera sidor övervägs.

---

## Tillgänglighet

Tillgänglighet är ett publiceringskrav. Demos med interaktion ska gå att förstå
med skärmläsare, manövrera med tangentbord, följa synliga fokustillstånd och
använda utan den senaste experimentella browser-funktionen. Så här är det
löst idag:

- **Mobilmenyn** är en ren `:target`-disclosure: öppna-knappen är en länk
  till `#sidomeny`, och panelen visas bara medan den är dokumentets `:target`.
  Det gör att panelen stängs automatiskt så fort en kapitel-/indexlänk
  aktiveras — något en checkbox inte kan utan skript, eftersom dess
  tillstånd inte påverkas av fragmentnavigering. Öppna- och stäng-länkarna är
  riktiga, fokuserbara element och får sidans globala `:focus-visible`-outline
  utan proxy-regler. Tangentbordsflödet specificeras och testas av
  `tests/menu-keyboard.mjs` (nivå 2), som körs som obligatoriskt steg i CI:s
  webbläsarjobb. På breda skärmar är panelen en
  permanent sidebar och växeln är gömd. `<details>` och deklarativ popover
  valdes bort: panelen måste vara permanent öppen på breda skärmar och ingen
  av dem kan tvingas dit utan att förlita sig på UA-regler.
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
- Mobilmenyn är en `:target`-disclosure. Att stänga utan att navigera går via
  `#topp`, vilket scrollar sidan till toppen — en känd kostnad för att stänga
  helt deklarativt. Back/Forward följer hash-historiken: bakåt från en sektion
  återöppnar panelen (`#sidomeny`-läget).
- Vissa demos har plattformsbegränsningar som är dokumenterade på kortet
  (t.ex. tic-tac-toes turordning bygger på heder — CSS kan inte jämföra
  antal drag).

---

## Struktur

```
0-js/
├── index.html              # hela referensen — publicerad artefakt; källa utom mellan demo-markörerna
├── demos/                  # KÄLLA: en fil per källgenererad demo (14 av 133)
│   ├── shape-outside.html
│   ├── target.html
│   ├── property-border-angle.html
│   └── … (elva ur batch 1)
├── docs/
│   └── demo-kalla.md       # beslut, källformat, verifiering, migreringsplan
├── scripts/
│   ├── build.mjs           # npm run build / build:check — genererar ur demos/
│   ├── demo-spec.mjs       # manifest: vilka demos som är migrerade (enda listan)
│   ├── build.test.mjs      # byggtest: determinism, härledning, stale, inventarium
│   ├── check.mjs           # nivå 1: struktur, zero-JS, ARIA
│   ├── check-snippets.mjs  # nivå 4: kopierbara exempel (statiskt)
│   ├── check.test.mjs      # regressionstest för kontrollerna
│   └── screenshot.mjs      # valfria skärmbilder (kräver playwright)
├── tests/
│   ├── menu-keyboard.mjs   # nivå 2: mobilmenyns tangentbord (kräver webbläsare)
│   ├── demo-scenarios.mjs  # interaktiva tillstånd per demo (klick, fokus, hover)
│   ├── demo-source.mjs     # nivå 2/4b: källgenererade demos på sidan + fristående (kräver webbläsare)
│   ├── demo-parity.mjs     # nivå 4c: mätt ekvivalens mot baslinjen (kräver webbläsare)
│   └── baseline/demos.json # mätbaslinje fångad FÖRE migreringen (committad)
├── .github/workflows/
│   └── ci.yml              # statiska kontroller + obligatoriskt browser-test
├── THIRD-PARTY.md          # licenser för inbäddade typsnitt
├── LICENSE                 # MIT (kod) — OFL 1.1 (typsnitt) gäller separat
└── README.md
```

---

## Bidra

1. En demo = ett kort med stödrad, fallback och kopierbart kodvalv.
2. Beskriv vad demot **faktiskt gör**, inte vad komponenten liknar.
3. Rör du en källgenererad demo (`demos/<id>.html`): kör `npm run build` och
   committa `index.html` tillsammans med källan. Redigera aldrig mellan
   `demo:`-markörerna i `index.html`. Migrerar du ett nytt kort: registrera det
   i `scripts/demo-spec.mjs`, fånga baslinjen (`npm run baseline:capture`)
   *innan* du redigerar, lägg till dess interaktiva tillstånd i
   `tests/demo-scenarios.mjs` och dess påståenden i `tests/demo-source.mjs`.
4. Kör `npm run check` innan push (stale-kontroll + struktur + snippets +
   regressionstest + byggtest).
5. Lägg till stöddata med datum och källa, och skilj på browser-support och
   verifierat demo.

## Licens

[MIT](LICENSE) — koden och exemplen är avsedda att återanvändas fritt, även
kommersiellt. De inbäddade typsnitten distribueras under SIL Open Font License
1.1; se [THIRD-PARTY.md](THIRD-PARTY.md).
