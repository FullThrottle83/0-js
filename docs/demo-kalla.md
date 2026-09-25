# En källa per demo — beslut, arbetsflöde och migreringsplan

*Status: pilot + batch 1 (14 av 133 demos migrerade). Datum: 2026-09-25.*

## 1. Problemet, mätt i det faktiska dokumentet

Varje demo-kort i `index.html` bär sin implementation på **tre ställen**:

1. live-markupen i `<article class="demo">`,
2. CSS-reglerna i det globala `<style>`-blocket (rad 39–2909),
3. kodvalvet: en `<textarea class="kod">` med escapad kopia av 1 + 2.

Före piloten analyserades alla 133 kort maskinellt (snippet-HTML jämförd
med live-markupen, snippet-CSS jämförd regel för regel med stilbladet):

| Mönster | Antal | Exempel |
| ------- | ----: | ------- |
| Snippet-HTML = live-markup ordagrant, all snippet-CSS finns i stilbladet | 84 | `light-dark`, `radioflikar`, `background-blend-mode` |
| …dito, men snippet-CSS innehåller regler som *inte längre* finns i stilbladet (drift) | 41 | `color-mix` (16 labb-demos delar ett helt kapitelblock), `property-border-angle`, `ken-burns` |
| Snippet-HTML skiljer sig från live-markupen (handskriven variant) | 7 | `media-color-gamut` (`.nd-gamut` vs live `.prov-gamut`), `round-mod`, `textspoiler`, `media-*` |
| Ingen HTML-del (bara CSS) | 1 | `grundpaketet` |

Konkreta skador som duplikationen redan orsakat:

- `property-border-angle`: kodvalvet hade `@keyframes rotera-kant {--border-angle: 1turn;}`
  — utan `to { }`. Inklistrat fungerar det inte (verifierat i Chromium 153:
  vinkeln står på `0deg`). Live-versionen var korrekt.
- `color-mix` m.fl.: kodvalvet innehåller `.swatch-yta {height: 3.2rem;}` medan
  stilbladet fick `display: block` i buggfixen 2026-08-30. Fixen nådde aldrig
  de 16 kopiorna.
- Kodvalvens HTML-del bär med sig kortets indrag (8 mellanslag) från när
  den kopierades ur `index.html`.

Utöver de tre representationerna finns **metadata** som också dupliceras
(stödklasser `sup-*` på kortet ↔ stödraden ↔ indexraden i sidomenyn ↔
`stod-summa`), men det är ett annat, mindre problem: det är data, inte
implementation, och det ändras sällan. Piloten rör det inte.

## 2. Beslut (ADR)

**Vald lösning:** en *källfil per demo* (`demos/<id>.html`) och ett
beroendefritt Node-skript (`scripts/build.mjs`) som skriver in källan på
tre markerade platser i `index.html`. `index.html` förblir den publicerade,
committade enfilsartefakten — komplett med inbäddade typsnitt — och är
samtidigt mallen: bara innehållet **mellan markörerna** genereras.

Varför minsta möjliga lösning räcker:

- 84 + 41 = **125 av 133** kort följer redan formeln
  *snippet = `<!-- HTML -->` + live-markup + `/* CSS */` + basregel + regler*.
  Formeln är alltså känd; den behöver bara köras av en maskin i stället för
  av en människa.
- Ingen HTML-parser behövs: markörerna är entydiga strängar och källformatet
  är vårt eget (markup följt av `<style>`). Fel ger ett undantag, aldrig tyst
  felaktig utdata.
- Inga npm-beroenden i bygget. Playwright används bara i webbläsartesterna,
  som förut.

Alternativ som förkastades:

| Alternativ | Varför inte |
| ---------- | ----------- |
| Mall-motor / Astro / generator som bygger hela `index.html` ur fragment | Kräver att hela dokumentet (hero, meny, index, 130 omigrerade kort, typsnitt) flyttas till mallar på en gång. Stor, riskabel flytt för ett problem som är lokalt per kort. |
| Live-markupen i `index.html` som källa, bara kodvalvet genereras | Löser HTML-duplikationen men inte CSS:en (regeln skulle fortfarande behöva letas upp i stilbladet), och gör det oklart vad som är källa. |
| `<template>`/`<iframe srcdoc>` i runtime | Antingen kräver det JavaScript (bryter Zero-JS) eller dubblerar markupen i dokumentet. |
| Ett schema (JSON/YAML) med titel, stöd, beskrivning, markup, CSS | Överflödigt för piloten: titel/stöd/beskrivning lever bra kvar i `index.html`. Kan läggas till senare utan att ändra byggmekaniken. |

## 3. Vad är källa och vad är genererat?

| Fil | Roll |
| --- | ---- |
| `demos/<id>.html` | **Källa.** Markup + `<style>` (+ valfri `<style data-live>`). Redigera här. |
| `index.html` — allt *utanför* markörerna | **Källa.** Hero, meny, index, kortets titel/stödrad/beskrivning/figur/jämförare, de 130 omigrerade korten, typsnitt. Redigera här. |
| `index.html` — *mellan* markörerna | **Genererat.** Skrivs om av `npm run build`. Redigera aldrig här; `npm run build:check` fångar det och nästa bygge ersätter det med källan. |
| `scripts/build.mjs` | Generatorn (ren funktion `build(html, källor) → html`). |

Markörerna för ett kort (tre per demo):

```html
<!-- demo:shape-outside:markup -->          i <article>, där live-markupen står
<!-- /demo:shape-outside:markup -->

/* demo:shape-outside:css */                 i det globala <style>-blocket
/* /demo:shape-outside:css */

<textarea class="kod" …>…</textarea>         kortets kodvalv, hittas via kortets id
```

## 4. Källformat

```html
<!--
  demo: shape-outside            ← fri dokumentationskommentar (tas bort)
-->
<div class="demo-yta shape-demo">   ← live-markup = kodvalvets HTML-del
  …
</div>
<style>                             ← stilbladet OCH kodvalvets CSS-del
.shape-float { … }
</style>
<style data-live>                   ← BARA stilbladet: sidans scenografi
.jmfbar:has(.jmf-knapp input:checked) .shape-float { shape-outside: none; }
</style>
```

Regler:

- Markup skrivs **utan** kortets indrag; bygget drar in live-versionen till
  markörens nivå och lämnar kodvalvet oindraget.
- Exakt ett `<style>`; högst ett `<style data-live>`; ingen `<script>`.
- Allt som är kortets presentation men inte demot — jämförarens `.jmf`,
  labbets `.labb`, figuren `.fig` — stannar i `index.html` utanför markörerna.
  CSS som *bara* behövs för den presentationen (t.ex. jämförarens av-läge,
  labbens `--lv`-överstyrningar) läggs i `<style data-live>`.
- Kodvalvet inleds alltid med den delade basregeln
  `.demo-yta {position: relative; border-radius: 4px;}` (samma som i alla
  andra 130 kort) — bygget lägger till den.
- `rows` på textarean sätts till radantalet, max 26 (dokumentets konvention).

## 5. Arbetsflöde

```sh
# redigera demos/<id>.html
npm run build          # skriver om de markerade områdena i index.html
npm run check          # stale-kontroll + struktur + snippets + regressionstest + byggtest
npm run test:browser   # kräver Chromium: menyn + de källgenererade demona, på sidan och fristående
```

`npm run build` är deterministiskt (samma källor ⇒ byte-identisk utdata,
oberoende av filordning) och idempotent. Det skriver bara om de markerade
områdena; ändringar var som helst annars i `index.html` bevaras byte för
byte. CI kör `node scripts/build.mjs --check` som första steg och faller om
`index.html` inte motsvarar källorna.

### Migrera ett befintligt kort

0. **Fånga baslinjen först.** `npm run baseline:capture` mäter demot i en riktig
   webbläsare och skriver `tests/baseline/demos.json` (DOM, text, attribut,
   geometri, beräknade stilar, pseudoelement) i standardtillståndet och i varje
   interaktivt tillstånd. Filen committas tillsammans med migreringen; den
   innehåller sha256 för dokumentet den fångades ur, så ursprunget kan
   granskas mot git-historiken.
1. Skapa `demos/<id>.html` med live-markupen (indraget borttaget) och de CSS-
   regler som hör till demot, klippta ur stilbladet. Kontrollera mot kodvalvet
   om det finns regler som driftat — live-versionen är facit.
2. Ersätt live-markupen i kortet med markörparet `<!-- demo:<id>:markup -->`.
3. Ersätt reglerna i stilbladet med markörparet `/* demo:<id>:css */`.
   Regler som bara sidan behöver (jmfbar/labbar-överstyrningar) → `<style data-live>`.
4. `npm run build` → granska `git diff index.html`: live-markupen ska vara
   **byte-identisk** utanför markörerna; bara kodvalvet får ändras (och då till
   det bättre).
5. Registrera demot i `scripts/demo-spec.mjs` (id, typ, ankare, liveCss). Det är
   manifestet som gör att byggtestet, `tests/demo-source.mjs` och
   `tests/demo-parity.mjs` ställer sina frågor om demot — glömmer du posten
   faller testerna, den finns inte som tyst lucka. Interaktiva demos får sina
   tillstånd i `tests/demo-scenarios.mjs` och sina påståenden i `CHECKS` i
   `tests/demo-source.mjs`.
6. `npm run check` (stale + struktur + snippets + regression + byggtest) och
   `node tests/demo-source.mjs && node tests/demo-parity.mjs --strict`. I samma
   webbläsarinstans ska pariteten vara 0 px; i CI körs standardläget, där
   struktur och stilar är exakta och geometrin rapporteras.

`demos/_delat/` (delade fragment för labb-demos, Grupp B) är **inte** byggt —
det läggs till när första labb-demot migreras, se §7.

## 6. Piloten — tre demos och vad de bevisar

| Demo | Typ | Vad piloten bevisar |
| ---- | --- | ------------------- |
| `shape-outside` | Enkel visuell + jämförare (`jmfbar`) | Presentationsmarkup (`.jmf`, `.fig`) hålls utanför källan; jämförarens av-regel flyttades från det delade jmfbar-blocket till `<style data-live>` och kopieras inte. Pixel-identisk före/efter i Chromium, både på- och av-läge. |
| `target` | Interaktiv (`:target`, ankarlänkar, id:n `tp-1..3`) | Id:n och ankare överlever; `check.mjs`:s länk-/id-kontroll är grön; panelbyten och bakåtknapp fungerar på sidan och i fristående kodvalv. |
| `property-border-angle` | Beroenden: `@property` (låg tidigare i ett globalt block på rad 51), `@keyframes`, delade variabler | `@property` följer nu med i källan och därmed i kodvalvet; kodvalvets trasiga `@keyframes` försvann automatiskt eftersom det inte längre finns någon andra kopia. Fristående kodvalv roterar (gjorde det inte förut). |

Verifiering (2026-09-25, Chromium 153.0.8010 headless via Playwright 1.55):

- Elementskärmbilder av de tre korten före och efter migreringen är
  **byte-identiska** (`cmp`) för: shape-outside på/av, :target standard/panel två,
  border-angle.
- Beteenderapport (computed styles, `display` per panel, `location.hash`,
  bakåtknapp, `::after`-innehåll) är identisk före/efter.
- `tests/demo-source.mjs` kört mot **pre-migrerings**-`index.html` faller på
  exakt ett påstående: det fristående border-angle-kodvalvet roterar inte
  (`0deg → 0deg`). Mot det genererade dokumentet är alla 18 påståenden gröna.

Statiska kontroller är statiska: `build.test.mjs` bevisar härledning,
determinism och stale-detektering, inte utseende. Utseende och beteende är
bevisade enbart genom webbläsarkörningen ovan.

## 6b. Batch 1 — elva demos ur Grupp A

Migrerade i denna PR (utöver pilotens tre): elva kort som klarade alla fyra
urvalskraven — snippet-HTML = live-markup, alla CSS-regler ordagrant i
stilbladet, inga regler delade med andra kort, och ett sammanhängande CSS-block
utan främmande regler emellan. Urvalet gjordes maskinellt över alla 133 kort;
kandidaterna granskades sedan ett och ett innan de flyttades.

| Demo | Regler | Varför just den | Vad den prövar i sviten |
| ---- | -----: | --------------- | ----------------------- |
| `accent-color` | 3 | rena regler, inga sidreferenser | native kryssrutor, `accent-color` ur Grundpaketet |
| `caret-shape-caret-color` | 1 | minsta möjliga källa | formulärfält, `caret-shape: bar` |
| `open` | 4 | interaktivt utan skript | `<details>`/`:open`, kant- och textfärg |
| `appearance-base-select` | 11 (2 `@supports`-block) | kodvalvets regelordning hade driftat | `@supports`-grenar, `::picker-icon` |
| `losenordsmatare` | 5 | interaktivt via `:valid` | `pattern`, `:invalid`/`:valid`, mätarens färg |
| `dubbeltumme-slider` | 5 | leverantörs-pseudoelement | två `range`-reglage, `pointer-events` |
| `calc-size` | 7 | pågående övergång + `:has()` | utfällning till `calc-size(auto, size)` |
| `attr` | 4 | `attr()` i `::after` | `content: " → " attr(data-url)`, hover |
| `if` | 4 | ny funktion med fallback | `if(style(…))`, `--varning`, id:t `#nd-varna` |
| `light-dark` | 4 + live-only | `jmfbar`-regel → `<style data-live>` | `light-dark()`, `color-scheme` per kort |
| `donutdiagram` | 4 + live-only | `jmfbar`-regel → `<style data-live>` | `conic-gradient` + `mask`, roll/aria-label |

### Vad migreringen ändrade — och vad den bevisligen inte ändrade

Live-markupen är **byte-identisk** för alla elva kort (jämförd mot `44185f0`
tecken för tecken utanför markörerna, inte med ögonmått). Stilbladet har
**samma 1183 toppnivåblock efter migreringen, utan att en enda regel lagts
till, tagits bort eller ändrats** — jämfört som multimängd mot `44185f0`.
Två regler har flyttat, och bara två:

| Regel | Före | Efter |
| ----- | ---: | ----: |
| `.jmfbar:has(.jmf-knapp input:checked) .ld-box` | 191 | 348 |
| `.jmfbar:has(.jmf-knapp input:checked) .donut` | 186 | 907 |

Båda är `jmfbar`-överstyrningar som flyttat från det delade jmf-blocket in i
respektive källas `<style data-live>`, intill demots egna regler. Allt annat
behåller sin inbördes ordning (positionerna förskjuts bara av att två block
bytt plats). Sidans scenografi är fortfarande sidans — och att flytten inte
ändrade kaskaden är mätt, inte antaget: paritetstestet kör varje demos
`jmf-av`-tillstånd och får 0 avvikelser.

Kodvalven ändras däremot — avsiktligt:

| Ändring | Exempel | Varför |
| ------- | ------- | ------ |
| kortets indrag bort | `        <select …>` → `  <select …>` | kodvalvet ska vara kopierbart, inte ett utdrag ur `index.html` |
| CSS i stilbladets formatering | `.nd-accent {display:grid; …}` → `.nd-accent { display:grid; … }` | live-versionen är facit; en enda kopia kan inte drifta |
| regelordning som stilbladet | `appearance-base-select`: `.select-fallback-note` låg före `@supports` i valvet | valvet var en handskriven kopia; nu gäller dokumentets ordning |
| `rows` räknas om | `donutdiagram` 17 → 19 rader | bygget sätter radantalet ur källan |

### Bevis: statiskt kontra mätt

De statiska testerna bevisar **härledning**: `scripts/build.test.mjs` (282
påståenden, inventariestyrda ur `scripts/demo-spec.mjs`) visar att live-markup,
stilregler och kodvalv kommer ur källfilen, att bygget är deterministiskt och
idempotent, att stale upptäcks, att inga regler delas mellan migrerade källor
och att de 119 omigrerade korten ligger kvar orörda. De säger **ingenting** om
hur något ser ut.

Utseende och beteende är mätta i Chromium 153.0.8010.0:

- `tests/demo-parity.mjs --strict` mot baslinjen i
  `tests/baseline/demos.json` (fångad ur `44185f0`, sha256 `6be18e6c…`):
  **13 200 värden, 0 avvikelser** — inklusive geometri, pseudoelement och de
  interaktiva tillstånden.
- 28 elementskärmbilder (`.demo-yta`, ett per tillstånd) före och efter:
  **byte-identiska**. Beviskörningen ligger utanför repot (skärmbilder hör
  inte till källkoden); den reproduceras med
  `node tests/demo-parity.mjs --shots <katalog>` och `cmp` mellan katalogerna.
- Helsidesbilder av hela dokumentet vid 1280 px och 480 px: **byte-identiska**.
- `tests/demo-source.mjs`: 136 påståenden om de 14 migrerade demona, på sidan
  och fristående (Grundpaketet + kodvalv), inklusive interaktiva tillstånd.
  Kört mot pre-migrerings-dokumentet faller det på markörinventariet — de elva
  valvens *beteende* var alltså redan korrekt; det som driftade var formen
  (indrag, formatering, ordning), inte tekniken.

**Miljöreservation.** Ett paritetsbevis är bara så starkt som sin miljö, och
verktyget säger vilket läge det kör i:

| Läge | Vad som jämförs | När |
| ---- | --------------- | --- |
| **samma webbläsarbygge** som baslinjen | struktur, text, attribut, fältvärden och icke-geometriska stilar **exakt** (fäller); geometri med slack max(2 px, 2 %) som varning | beviset ovan: `--strict` ger 0 px |
| **annat bygge** | struktur, text, attribut och fältvärden exakt (fäller); stilar och geometri rapporteras | CI, där Playwright kan installera ett annat Chromium än baslinjens 153.0.8010.0 |

Skälet till uppdelningen är att ett nyare bygge kan stödja fler funktioner
(`if()`, `calc-size()`, `appearance: base-select`) och därmed rendera annat —
det är skillnad i webbläsare, inte i migrering. `--require-same-browser` gör
versionsglappet till ett fel och är flaggan för den fullständiga grinden.
Geometrin mäts i px och textmetrik skiljer sig dessutom mellan Linux-byggen av
samma Chromium: samma baslinje mätt med `--font-render-hinting=full
--disable-font-subpixel-positioning` gav **0 strukturella avvikelser**, 78
geometrivärden inom toleransen och 12 utanför (störst 24 px, alla
textbreddsberoende).

### Kandidater som medvetet INTE migrerades i denna batch

| Fall | Varför inte | Vad som krävs |
| ---- | ----------- | ------------- |
| `dvh-svh-lvh` | CSS-blocket inleds av kapitelbanderollen `/* KAPITEL 09 · RESPONSIV & ADAPTIV */`. Flyttas den in i källan försvinner banderollen ur stilbladet; lämnas den kvar tappar kodvalvet sin inledning. | Beslut om kapitelbanderoller (stanna i `index.html` utanför markörerna + acceptera att valvet inte bär dem). `dvh-svh-lvh` är första kandidaten när beslutet är taget. |
| `radioflikar` | Tre live-only-regler (`.prov-rad.pa`, `::before`, `b`) kommer från ett delat labb-block, inte från demot. | Migreras när labb-blocket har en ägare (Grupp B). |
| `prefers-color-scheme`, `prefers-reduced-motion`, `hover-hover`, `min-width-640px` | Deras valv delar tre identiska regler med varandra; att migrera en skulle duplicera regler i stilbladet. | Migreras som grupp om fyra (samma fyra regler i en källa eller fyra källor med varsin regel). |
| `media-print`, `clamp` | 11 regler var, delade med fem–sex andra kort. | Grupp, efter samma beslut som ovan. |
| `facetterat-filter` | Delar åtta regler med `flerstegs-formular-wizard`. | Migreras tillsammans med wizarden (Grupp D). |
| `container-type-size-behallarenheter-cqi` | Ren kandidat (12 regler, inga beroenden) men större än batchens smala urval. | Nästa batch: enkel att lägga till, men förtjänar egen granskning. |
| `css-kalkylator` | En live-only-regel (`.index-kap summary .antal`) pekar in i sidomenyns/`<figure>`-scenografi. | Kräver samma klassavgränsning som Grupp E-beslutet nedan. |
| `3d-card-tilt`, `fore-efter-jamforare`, `4-bitars-binaradderare` | Rena kandidater men sammansatta (16–28 regler, flera tillstånd). | Grupp D: en i taget med webbläsarjämförelse. |
| `grundpaketet` | Valvet *är* källan för `:root`-variablerna som `check-snippets.mjs` läser; kräver tom markup-del. | Egen liten utbyggnad av källformatet. |
| Grupp B (16 labb-demos), Grupp C (7 avvikande valv) | Delad kapitel-CSS respektive valv som skiljer sig från live-markupen. | Enligt planen i §7 — beslut först, migrering sedan. |

## 7. Migreringsplan för återstående 119 demos

Grupperat efter vad analysen faktiskt visade, inte efter kapitel.
Läget efter batch 1: **14 av 133** kort är källgenererade (3 pilot + 11 i §6b),
**119** återstår. Nästa batch kan börja med `container-type-size-behallarenheter-cqi`
och de övriga rena kandidaterna i Grupp A; besluten i §6b avgör när
`dvh-svh-lvh` och de fyra media-demon kan följa.

### Grupp A — mekanisk (≈84 demos, t.ex. `light-dark`, `radioflikar`, `details`, `dialog`, `popover-*`, `donutdiagram`)

Snippet-HTML = live-markup, all CSS finns ordagrant i stilbladet. Migrering
är ren klipp-och-klistra enligt §5, med ett engångsskript som föreslår
källfilen ur befintligt kort. Risk: låg. Varje kort granskas via
`git diff index.html` — live-markupen ska vara oförändrad.

Batch 1 visade att urvalet bör snävas in ytterligare: en kandidat är bara
mekanisk om reglerna dessutom ligger i ett **sammanhängande block utan delade
regler** och om inga andra kort refererar till dess klasser. Två av villkoren
prövas nu av maskinen: markörformatet tillåter bara **ett** CSS-block per demo
(två block ger `markören förekommer flera gånger`), och `scripts/build.test.mjs`
faller om samma regeltext förekommer i två migrerade källor. Det tredje —
klassreferenser från andra kort — är fortfarande en granskningsfråga, och
`analyze`-skriptet i analysfasen hittade dem maskinellt
(`grep '\.klass'` i resten av stilbladet).

### Grupp B — labb-demos med delade kapitelregler (16 demos: `color-mix`, `rgb-from`, `oklch-display-p3`, 5 gradienter, 8 filter)

Kodvalven innehåller i dag hela kapitel 01-blocket (`.swatch*`, alla `.rel-*`,
`.grad-*`, `.f-*`) och är delvis föråldrade. Två beslut krävs innan
migrering:

1. **Delade fragment.** `.swatch`, `.swatch-yta`, `.swatch-lbl` används av alla
   16. Förslag: `demos/_delat/swatch.css` som källfilen refererar med
   `<style data-include="swatch">` (bygget infogar fragmentet i kodvalvet,
   och skriver det *en* gång i stilbladet). Det är den enda utbyggnaden av
   byggskriptet som planen kräver — ~20 rader — och den bör göras när första
   labb-demot migreras, inte i förväg.
2. **Labb-överstyrningarna** (`.labbar .cm-row … calc(var(--lv) …)`,
   `.enh-*`) är sidans scenografi → `<style data-live>`. Kodvalvet visar den
   statiska tekniken, precis som i dag.

Kodvalven blir kortare och korrekta (t.ex. `display: block` på `.swatch-yta`).
Det är en avsiktlig textändring och ska nämnas i respektive PR.

### Grupp C — snippet som avviker från live-markupen (7 demos: `media-color-gamut`, `round-mod`, `textspoiler`, `prefers-reduced-motion`, `hover-hover`, `media-scripting`, `media-hover-pointer`)

Här är kodvalvet en *förenklad* variant (t.ex. `.nd-gamut` medan sidan visar
`.prov-gamut` med "ditt läge"-rader). Två rimliga utfall per demo, att avgöra
kort för kort:

- Live-markupen är bättre → migrera som grupp A; kodvalvet byts till
  live-versionen.
- Den förenklade varianten är pedagogiskt bättre → **migrera inte** ännu.
  Att tvinga in två olika markup-varianter i en källa gör dessa svårare, inte
  lättare, att underhålla. Alternativ: låt live-versionen bli den förenklade
  (det är oftast `media-*`-proven som har extra scenografi).

### Grupp D — stora, sammansatta demos (≈20: `property-sin-cos` (49 regler), `view-timeline` (39), `tre-i-rad-tic-tac-toe`, `css-arkad`, `4-bitars-binaradderare`, `flerstegs-formular-wizard`, `fore-efter-jamforare`, `dialog-commandfor`, `3d-card-tilt` …)

Formeln gäller, men källfilerna blir 100–400 rader och CSS:en ligger ofta i
flera separata block i stilbladet (baseregler + "BUGGFIX"-tillägg + jmfbar-
av-läge). Migrera en i taget med webbläsarjämförelse (spel och wizard har
tillstånd som måste testas, inte bara fotograferas). Håll dem sist; de
tjänar mest på en enda källa men kostar mest att verifiera.

### Grupp E — särfall

- `grundpaketet`: kodvalvet *är* källan för `:root`-variablerna som
  `check-snippets.mjs` läser. Kan bli `demos/grundpaketet.html` med tom
  markup-del om byggskriptet tillåter det; låg prioritet.
- Kort där id:n i markupen refereras av CSS på andra ställen i stilbladet
  (`#rtl-toggle`, `#tab-a`, temaväxlarens radioknappar): migrerbara, men
  live-only-reglerna måste hittas med `grep '#id'` innan klippningen.

### Vad som inte ingår i planen

- Stöddata (`sup-*`, stodrad, indexrad) → kvar i `index.html`. Kan bli ett
  eget litet metadatasteg senare, oberoende av det här bygget.
- Att bygga hela `index.html` ur mallar. Behövs inte för att nå målet.
