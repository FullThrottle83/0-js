# Grupp B-pilot — skärmbildsbevis

Filer här är **efter**-bilder (alltså efter migreringen). De ligger i repot
enbart som bevis; `scripts/pilot-shots.mjs` genererar om hela serien.

```
node scripts/pilot-shots.mjs <utkatalog> efter
```

Serien är 36 elementskärmbilder av `.demo-yta` för de två pilotdemona
(`color-mix`, `linear-gradient`) — 3 bredder (375/768/1280 px) × 2 teman
(guld = standard, syra) × 3 tillstånd (standard, labbets `--lv: 0`, `--lv: 8`).

## Resultatet av jämförelsen

Före-körningen sparades innan någon källfil skapades, efter-körningen efter
att `index.html` genererats om från `demos/`. Jämförelsen är byte för byte:

```
$ for f in pilot-fore/*.png; do cmp -s "pilot-fore/$(basename $f)" "pilot-efter/$(basename $f)" || echo "SKILL"; done
$ # → ingen utskrift: 36 av 36 är byte-identiska
```

`color-mix.standard.guld.1280.png` och `linear-gradient.standard.guld.1280.png`
finns med här som representanter; resten av serien verifierades på samma sätt
men laddas inte upp i repot.

## De två fristående bilderna

`fristaende-*.png` är **inte** sidan. De är det *faktiska kodvalvet* —
den text som användaren kopierar — utdraget ur `index.html`, kombinerad med
Grundpaketet precis som sidan föreskriver, och renderad i ett eget minimalt
HTML-dokument i samma webbläsare (Chromium 153.0.8010.0). Det är beviset för
att kopian fungerar på egen hand, inte bara i sidans sammanhang.
