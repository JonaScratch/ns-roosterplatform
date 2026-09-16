import "server-only";
import { z } from "zod";

/**
 * De configuratie van de applicatie, één keer gevalideerd.
 *
 * Elke instelling die het gedrag van beveiliging of roosterlogica bepaalt komt
 * hier vandaan en nergens anders uit `process.env`. Zo staat op één plek wat
 * de applicatie nodig heeft, en faalt een verkeerd geconfigureerde omgeving bij
 * de eerste aanraking in plaats van halverwege een verzoek.
 *
 * ## Waarom lui geëvalueerd
 *
 * `next build` importeert elke routemodule om routegegevens te verzamelen. Een
 * validatie op moduleniveau laat een build zonder omgeving dus stuklopen op
 * configuratie die pas bij het draaien bestaat. De validatie gebeurt daarom bij
 * het eerste gebruik en wordt daarna gecachet.
 */

const schema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL ontbreekt."),

  /**
   * HMAC-sleutel voor sessietokens en pseudonimisering. Minimaal 32 bytes:
   * korter maakt de afgeleide waarden raadbaar.
   */
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET moet minimaal 32 tekens zijn. Genereer 32 willekeurige bytes."),

  AUTH_PROVIDER: z.enum(["local", "oidc"]).default("local"),

  RULES_ENGINE_MODE: z.enum(["local", "remote"]).default("local"),
  RULES_ENGINE_URL: z.string().default(""),
  RULES_ENGINE_TOKEN: z.string().default(""),

  /**
   * Minimale cohortgrootte voor geaggregeerde feedback. Onder deze grens wordt
   * geen uitkomst getoond, ook niet aan een planner.
   */
  PRIVACY_MIN_COHORT: z.coerce.number().int().min(2).default(5),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | null = null;

export function config(): AppConfig {
  if (cached) {
    return cached;
  }
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`De omgevingsconfiguratie klopt niet:\n${problems}`);
  }

  // Een productieomgeving met de lokale wachtwoordprovider is een fout die je
  // niet pas bij de eerste inlogpoging wilt ontdekken.
  if (parsed.data.APP_ENV === "production" && parsed.data.AUTH_PROVIDER === "local") {
    throw new Error(
      "AUTH_PROVIDER=local is uitsluitend bedoeld voor ontwikkeling en test. " +
        "Configureer in productie de OIDC-provider (NS SSO/MFA).",
    );
  }

  cached = parsed.data;
  return cached;
}

export function isProduction(): boolean {
  return config().APP_ENV === "production";
}
