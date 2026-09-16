import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Testconfiguratie.
 *
 * De tests raken bewust geen database. Wat hier getoetst wordt is de
 * domeinlaag, de rules engine en de rechtentabel: de plekken waar een fout
 * stil blijft en pas in productie zichtbaar wordt. Dat maakt de suite snel
 * genoeg om bij elke wijziging te draaien.
 *
 * Voor de vraag of de gevulde ontwikkeldatabase zelf aan de regels voldoet,
 * bestaat een apart script (`npm run verify:rooster`). Dat is een controle op
 * gegevens en geen unittest, en hoort niet in dezelfde run thuis.
 */

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      // Zie tests/stubs/server-only.ts: de grens die dat pakket bewaakt bestaat
      // niet in een Node-testomgeving.
      "server-only": path.resolve(root, "tests/stubs/server-only.ts"),
    },
  },
});
