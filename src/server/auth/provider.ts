import type { AuthLevel, AuthProviderKind } from "@/lib/generated/prisma/enums";

/**
 * Het contract van een authenticatiebron.
 *
 * De applicatie kent maar één manier om te weten wie er inlogt: deze interface.
 * De lokale wachtwoordprovider is de implementatie voor ontwikkeling en test;
 * NS SSO met MFA wordt straks een tweede implementatie. Sessies, rechten,
 * auditlog en alle schermen weten van dat verschil niets.
 *
 * ## Wat dit contract bewust niet doet
 *
 * Het maakt geen sessie aan. Authenticatie en sessiebeheer zijn twee dingen:
 * de eerste stelt vast wie iemand is, de tweede houdt dat vol over verzoeken
 * heen. Ze scheiden betekent dat een nieuwe identiteitsbron niets aan
 * sessiebeheer verandert, en dat sessiebeleid (levensduur, intrekken, absolute
 * vervaltijd) op één plek staat.
 */

export type AuthenticationOutcome =
  | "AUTHENTICATED"
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_LOCKED"
  | "ACCOUNT_DISABLED"
  | "MFA_REQUIRED"
  | "PROVIDER_MISMATCH";

export interface AuthenticationResult {
  readonly outcome: AuthenticationOutcome;
  /** Gevuld bij AUTHENTICATED. */
  readonly userId?: string;
  readonly authLevel?: AuthLevel;
  /**
   * Toelichting voor het auditspoor. Nooit voor de gebruiker: die krijgt een
   * bewust vage melding, zodat het formulier niet vertelt of een account
   * bestaat.
   */
  readonly auditReason?: string;
}

/** Wat een gebruiker aanlevert. Vorm hangt af van de provider. */
export interface PasswordCredentials {
  readonly employeeNumber: string;
  readonly password: string;
}

export interface AuthenticationProvider {
  readonly kind: AuthProviderKind;
  readonly name: string;

  /**
   * Ondersteunt deze provider het inlogformulier met personeelsnummer en
   * wachtwoord? Bij SSO is dit onwaar en verloopt inloggen via een omleiding.
   */
  readonly supportsPasswordLogin: boolean;

  /** Alleen zinvol wanneer `supportsPasswordLogin` waar is. */
  authenticateWithPassword?(credentials: PasswordCredentials): Promise<AuthenticationResult>;

  /**
   * De plek waar de gebruiker naartoe moet voor SSO. Null bij een provider die
   * met een formulier werkt.
   */
  authorizationUrl?(state: string): string | null;
}
