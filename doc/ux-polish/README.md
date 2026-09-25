# Före/efter — UX-omgången

Skärmbilder tagna i Chromium 153.0.8010.0 (Playwright) vid 375 px och 1280 px,
`deviceScaleFactor: 1`, efter `document.fonts.ready`. Filerna är namngivna
`fore-<vy>-<bredd>.png` och `efter-<vy>-<bredd>.png` för samma vy och bredd.

| Vy | Vad den visar |
| -- | ------------- |
| `01-hero` | Första skärmen: hero med de tre vägarna vidare |
| `02-filter` | Webbläsarstödet: filterknappar + markörnyckel |
| `03-kapitel` | Kapitel 01 och de första korten |
| `04-index` | Indexpanelen (mobil: efter ☰ Index; desktop: sidomenyn) |
| `05-index-scroll` | Panelen djupare ned i listan (sticky huvud, radbrytning) |
| `07-kodvalv-oppet` | Ett kort med kodvalvet öppet |
| `08-subgrid` | Kortet som klippte sitt tredje delkort före åtgärden |
| `09-easing` | Kurvfiguren med etiketter som ritades utanför figurens ruta |

Bilderna är dokumentation, inte en testgrind: `tests/ux-polish.mjs` mäter
samma beteenden som textpåståenden. Kör om dem med
`node scripts/screenshot.mjs` (hero/kort) eller motsvarande skript i
PR-beskrivningen.
