import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * De draagbare bundel draait op een computer zonder npm en zonder
   * node_modules. `standalone` laat Next zelf uitzoeken welke bestanden de
   * applicatie werkelijk nodig heeft en kopieert die naar .next/standalone —
   * dat scheelt niet alleen ruimte, het maakt de bundel ook reproduceerbaar:
   * wat er niet in zit, kan ook niet stiekem worden gebruikt.
   */
  output: "standalone",

  /**
   * Wat er níét in de bundel hoort.
   *
   * Het traceren loopt de projectmap af, en nam daarbij de vórige bundel mee de
   * volgende bundel in. De bundel groeide daardoor bij elke bouw met honderden
   * megabytes — 739, 1315, 1892 — zonder dat er iets aan de applicatie
   * veranderde. Dat is hier afgesloten.
   *
   * De andere mappen staan er om dezelfde reden: tests, documentatie en
   * bouwscripts draaien nooit in de draagbare versie, en wat niet meegaat, kan
   * daar ook niet per ongeluk worden aangeroepen.
   */
  outputFileTracingExcludes: {
    "*": [
      "./dist/**",
      "./tests/**",
      "./docs/**",
      "./scripts/**",
      "./portable/**",
      "./storage/**",
      "./.next/cache/**",
      "./node_modules/@embedded-postgres/**",
      "./node_modules/typescript/**",
      "./node_modules/esbuild/**",
      "./node_modules/@esbuild/**",
      "./node_modules/vitest/**",
      "./node_modules/@vitest/**",
      "./node_modules/eslint/**",
      "./node_modules/prettier/**",
    ],
  },
};

export default nextConfig;
