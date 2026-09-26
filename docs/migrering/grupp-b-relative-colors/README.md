# Grupp B — relativa färger och bred gamut

Elementskärmbilder av de två live-ytorna före/efter migreringen.

- **Före:** `index.html` ur commit `e6defed8ae34bcac5dcc1812afe5368e0cb4250a`, SHA-256 `c611b52dcc3e263d743c936b40bc91b5d6ac2c4ea4ec03ded645a00d12cf6393`.
- **Efter:** genererat `index.html` i denna ändring.
- **Miljö:** Playwright 1.63.0 med npm-paketet `@sparticuz/chromium@153.0.0`; verifierad `browser.version()` är exakt `153.0.8010.0`.
- **Matriser:** rgb-from och oklch-display-p3; 375, 768 och 1280 px; guld- och syra-teman. rgb-from har standard, `lv-0` och `lv-8`; gamut har standard.
- **Jämförelse:** 24 före/efter-par, samtliga PNG-byte identiska.

Filerna är elementskärmbilder av `.demo-yta`, inte helsidesbilder. Mätvärden
för standard- och interaktiva tillstånd finns separat i
`tests/baseline/demos.json` och i paritetskörningen.
