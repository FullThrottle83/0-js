# Föreslagen ändring av .github/workflows/ci.yml

Den här grenen kunde inte uppdatera workflowfilen: GitHub-appen som driver
grenen saknar `workflows`-behörighet, och GitHub avvisar både push och
API-anrop som rör `.github/workflows/`. Ändringen ligger därför här som en
exakt diff i stället — en behörig GitHub-anslutning kan applicera den direkt
(eller lägga in raden i CI-jobbets webbläsarsteg).

Så här appliceras den:

```sh
git apply doc/ux-polish/ci-foreslagen-andring.diff
```

Diffen lägger till UX-kontraktet som ett obligatoriskt steg i webbläsarjobbet,
före demo-source-steget:

diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index d9318e5..0071f75 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -66,6 +66,11 @@ jobs:
       - name: Nivå 2 — mobilmenyns tangentbordsinteraktion
         run: node tests/menu-keyboard.mjs
 
+      # Obligatoriskt: gränssnittet runt demona (hero, sidhuvud, indexpanel,
+      # stödfilter, räknare, kodvalv) verifieras vid 375–1440 px.
+      - name: Nivå 2 — gränssnittets UX-kontrakt
+        run: node tests/ux-polish.mjs
+
       # Obligatoriskt: de källgenererade demona verifieras på sidan och
       # fristående (Grundpaketet + kodvalv) i en riktig Chromium.
       - name: Nivå 2/4b — källgenererade demos på sidan och fristående
