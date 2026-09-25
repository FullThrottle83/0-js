# Före/efter — discoverability-omgången

Skärmbilder tagna i Chromium 153.0.8010.0 (Playwright) vid 375 px och 1440 px,
`deviceScaleFactor: 1`, efter `document.fonts.ready`. Filerna är namngivna
`fore-<vy>-<bredd>.png` och `efter-<vy>-<bredd>.png` för samma vy och bredd.
`fore`-bilderna är tagna ur `index.html` som den såg ut **före** PR:en
(merge-basen), inte ur ett handredigerat dokument.

| Vy | Vad den visar |
| -- | ------------- |
| `01-index` | Indexpanelen i toppen. Före: bara kapitel. Efter: vy-växlaren + bokstavsraden |
| `02-filter` | Stöd­filtret aktivt i panelen (före: 132 av 133 kort; efter: samma filter i registret) |
| `03-register-filter` | Registret med filtret aktivt (finns bara efter) |
| `04-panel-ned` | Panelen 900 px ned — före: kapitelrubriker och långa listor; efter: små bokstavgrupper med egna rubriker |
| `05-bokstavsval` | Efter ett klick på bokstaven **S** i bokstavsraden, 375 px: gruppen ligger i panelens första vy (finns bara efter) |
| `06-demo-mal` | Målet `#grid-template-rows-subgrid` efter navigering. Rubriken ligger nu fritt under den sticky headern (tidigare 50 px mot headerns 56 px) |
| `07-kortets-vagvisare` | Kortets två vägvisare i kortets nederkant: kapitel och registergrupp (finns bara efter) |

Bilderna är dokumentation, inte en testgrind: `tests/register-nav.mjs` mäter
samma beteenden som textpåståenden. Kör om dem med
`node node_modules/.sandbox/journey-shots.mjs <fil-url> <utkatalog>`
(utvecklingsskript utanför repot, kräver `playwright`).
