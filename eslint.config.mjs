import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Standaard genegeerd door eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Gegenereerde Prisma-client: geen bron om te beoordelen.
    "src/lib/generated/**",
    // De draagbare bundel: een kopie van de productiebuild met een complete
    // node_modules erin. Die beoordelen levert duizenden bevindingen op over
    // code die niet van dit project is — en verbergt daarmee de bevindingen
    // die er wél toe doen.
    "dist/**",
  ]),
  {
    rules: {
      /**
       * Een parameter met een liggend streepje ervoor is een bewuste
       * niet-gebruikte parameter, en die komen in dit project structureel voor:
       * de placeholders voor NS SSO en de centrale Rules Engine implementeren
       * een contract dat zij nog niet kunnen uitvoeren. Ze weglaten zou het
       * contract breken, ze gebruiken kan niet.
       */
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
