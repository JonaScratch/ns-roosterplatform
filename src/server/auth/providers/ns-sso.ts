import "server-only";
import { AuthProviderKind } from "@/lib/generated/prisma/enums";
import type { AuthenticationProvider } from "../provider";

/**
 * NS SSO met MFA — de plek waar de enterprise-identiteitsbron wordt aangesloten.
 *
 * De klasse bestaat en implementeert het contract, zodat de omschakeling een
 * configuratiewijziging is (`AUTH_PROVIDER=oidc`) en geen verbouwing. Wat
 * ontbreekt is het OIDC-gesprek zelf.
 *
 * ## Wat er moet gebeuren bij het aansluiten
 *
 *  1. Discovery van de NS-identiteitsprovider (`.well-known/openid-configuration`)
 *     en het ophalen van de JWKS voor handtekeningcontrole.
 *  2. Authorization Code Flow met PKCE. De `state` gaat mee als korte,
 *     ondertekende waarde en wordt bij terugkeer geverifieerd (CSRF op de
 *     inlogstroom).
 *  3. Koppeling van de `sub`-claim aan `UserAccount.externalSubject`. Bewust
 *     niet aan het e-mailadres: een e-mailadres verandert, `sub` niet. Accounts
 *     worden niet automatisch aangemaakt — een onbekende `sub` is een fout,
 *     geen uitnodiging.
 *  4. `amr`/`acr`-claims bepalen `AuthLevel`. Alleen wanneer daaruit blijkt dat
 *     een tweede factor is gebruikt, wordt de sessie MFA. Planner-acties kunnen
 *     dan op dat niveau worden afgedwongen.
 *  5. Single logout: bij intrekken aan de kant van de IdP horen de sessies hier
 *     ook ingetrokken te worden (`session.revoke`).
 *
 * ## Waarom er geen wachtwoordformulier bij zit
 *
 * `supportsPasswordLogin` is onwaar. Het inlogscherm ziet dat en toont dan geen
 * velden voor personeelsnummer en wachtwoord, maar een knop naar de
 * identiteitsprovider. Zo kan een verkeerd geconfigureerde omgeving niet
 * stilletjes terugvallen op wachtwoorden.
 */
export class NsSsoProvider implements AuthenticationProvider {
  readonly kind = AuthProviderKind.OIDC;
  readonly name = "NS SSO";
  readonly supportsPasswordLogin = false;

  authorizationUrl(_state: string): string | null {
    // Zodra de discovery-URL bekend is, wordt hier de authorization endpoint
    // opgebouwd. Null betekent voor het inlogscherm: nog niet beschikbaar.
    return null;
  }
}
