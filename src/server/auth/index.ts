import "server-only";
import { config } from "@/server/config/env";
import type { AuthenticationProvider } from "./provider";
import { LocalPasswordProvider } from "./providers/local-password";
import { NsSsoProvider } from "./providers/ns-sso";

/**
 * De actieve authenticatieprovider.
 *
 * De rest van de applicatie vraagt hier om een provider en kent de
 * implementaties niet. De omschakeling naar NS SSO is daarmee een wijziging van
 * `AUTH_PROVIDER` in de omgeving, niet van code in schermen of services.
 */

let instance: AuthenticationProvider | null = null;

export function authProvider(): AuthenticationProvider {
  if (instance) {
    return instance;
  }
  instance = config().AUTH_PROVIDER === "oidc" ? new NsSsoProvider() : new LocalPasswordProvider();
  return instance;
}

/** Alleen voor tests. */
export function __setAuthProviderForTests(provider: AuthenticationProvider | null): void {
  instance = provider;
}

export type { AuthenticationProvider, AuthenticationResult } from "./provider";
export { SESSION_POLICY, currentActor, destroySession, revokeAllSessions } from "./session";
export type { Actor } from "./session";
