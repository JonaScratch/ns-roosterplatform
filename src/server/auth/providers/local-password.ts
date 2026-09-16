import "server-only";
import { compare } from "bcryptjs";
import { AccountStatus, AuthLevel, AuthProviderKind } from "@/lib/generated/prisma/enums";
import { prisma } from "@/server/data/prisma";
import type {
  AuthenticationProvider,
  AuthenticationResult,
  PasswordCredentials,
} from "../provider";

/**
 * Lokale authenticatie met personeelsnummer en wachtwoord.
 *
 * Uitsluitend voor ontwikkeling en test. `src/server/config/env.ts` weigert
 * deze provider in productie; die weigering staat daar en niet hier, zodat een
 * verkeerde configuratie faalt bij het opstarten en niet pas bij de eerste
 * inlogpoging.
 *
 * ## Waarom alle mislukkingen hetzelfde teruggeven aan de gebruiker
 *
 * Onderscheid maken tussen "onbekend personeelsnummer" en "verkeerd wachtwoord"
 * verandert een inlogformulier in een lijst van geldige personeelsnummers. Het
 * verschil staat wél in het auditspoor, waar het thuishoort.
 *
 * ## Waarom er ook bij een onbekend account een hash wordt vergeleken
 *
 * Zonder die stap is een onbekend account meetbaar sneller afgehandeld dan een
 * bestaand account met verkeerd wachtwoord. Dat verschil is genoeg om
 * personeelsnummers te inventariseren.
 */

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;

/**
 * Een geldige bcrypt-hash van een willekeurige waarde, om het tijdsverschil bij
 * onbekende accounts weg te nemen. Komt overeen met geen enkel wachtwoord.
 */
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.k7Xw0e0PBGCPS0j4Q4Y2Kk5fQb5Zq3O";

export class LocalPasswordProvider implements AuthenticationProvider {
  readonly kind = AuthProviderKind.LOCAL;
  readonly name = "Lokale testauthenticatie";
  readonly supportsPasswordLogin = true;

  async authenticateWithPassword(
    credentials: PasswordCredentials,
  ): Promise<AuthenticationResult> {
    const account = await prisma.userAccount.findFirst({
      where: { employee: { employeeNumber: credentials.employeeNumber } },
      select: {
        id: true,
        status: true,
        provider: true,
        passwordHash: true,
        failedLoginCount: true,
        lockedUntil: true,
      },
    });

    if (!account) {
      await compare(credentials.password, DUMMY_HASH);
      return { outcome: "INVALID_CREDENTIALS", auditReason: "onbekend personeelsnummer" };
    }

    if (account.provider !== AuthProviderKind.LOCAL) {
      return {
        outcome: "PROVIDER_MISMATCH",
        auditReason: `account hoort bij provider ${account.provider}`,
      };
    }

    if (account.status === AccountStatus.DISABLED || account.status === AccountStatus.SUSPENDED) {
      return { outcome: "ACCOUNT_DISABLED", auditReason: `status ${account.status}` };
    }

    if (account.lockedUntil && account.lockedUntil > new Date()) {
      return {
        outcome: "ACCOUNT_LOCKED",
        auditReason: `geblokkeerd tot ${account.lockedUntil.toISOString()}`,
      };
    }

    // Status LOCKED zonder vervaltijd is een blokkade die een beheerder heeft
    // gezet. Die loopt niet vanzelf af; zonder deze regel zou een handmatige
    // blokkade zonder tijdstempel geen enkel effect hebben.
    if (account.status === AccountStatus.LOCKED && !account.lockedUntil) {
      return { outcome: "ACCOUNT_LOCKED", auditReason: "blokkade zonder vervaltijd" };
    }

    const valid =
      account.passwordHash !== null && (await compare(credentials.password, account.passwordHash));

    if (!valid) {
      await this.registerFailure(account.id, account.failedLoginCount);
      return { outcome: "INVALID_CREDENTIALS", auditReason: "wachtwoord onjuist" };
    }

    await prisma.userAccount.update({
      where: { id: account.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        // Een verlopen tijdelijke blokkade wordt hier opgeheven. Zonder dit
        // blijft de status LOCKED staan terwijl de blokkade voorbij is, en
        // leest elk beheerscherm een blokkade die er niet meer is.
        status: account.status === AccountStatus.LOCKED ? AccountStatus.ACTIVE : undefined,
      },
    });

    // Lokaal is er geen tweede factor. Het niveau is daarmee PASSWORD, en
    // schermen die MFA eisen weten dat dus — in plaats van dat de testopstelling
    // stilzwijgend als volwaardig geldt.
    return { outcome: "AUTHENTICATED", userId: account.id, authLevel: AuthLevel.PASSWORD };
  }

  /** Telt de mislukte poging en blokkeert het account bij te veel pogingen. */
  private async registerFailure(userId: string, currentCount: number): Promise<void> {
    const next = currentCount + 1;
    const locked = next >= MAX_FAILED_ATTEMPTS;
    await prisma.userAccount.update({
      where: { id: userId },
      data: {
        failedLoginCount: locked ? 0 : next,
        status: locked ? AccountStatus.LOCKED : undefined,
        lockedUntil: locked
          ? new Date(Date.now() + LOCK_DURATION_MINUTES * 60_000)
          : undefined,
      },
    });
  }
}

export const LOCAL_LOCK_POLICY = {
  maxFailedAttempts: MAX_FAILED_ATTEMPTS,
  lockDurationMinutes: LOCK_DURATION_MINUTES,
};
