"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { SecurityEventKind } from "@/lib/generated/prisma/enums";
import { authProvider } from "@/server/auth";
import { createSession } from "@/server/auth/session";
import { currentActor, destroySession } from "@/server/auth/session";
import { recordAudit, recordSecurityEvent } from "@/server/audit/log";
import { clientFingerprint, requestIp } from "@/server/security/fingerprint";
import { rateLimit } from "@/server/security/rate-limit";
import { homePathForRoles } from "@/server/security/permissions";

/**
 * Aanmelden en afmelden.
 *
 * ## Wat de gebruiker te zien krijgt bij een mislukking
 *
 * Altijd dezelfde zin. Onderscheid tussen "onbekend personeelsnummer",
 * "verkeerd wachtwoord" en "account geblokkeerd" vertelt een aanvaller welke
 * nummers bestaan en welke de moeite waard zijn. Het echte onderscheid staat in
 * `SecurityEvent`, waar het toezicht het kan zien.
 *
 * ## Snelheidsbegrenzing en accountblokkade
 *
 * Twee lagen die verschillende dingen doen. De begrenzing per herkomst remt het
 * uitproberen van veel nummers vanaf één plek; de accountblokkade beschermt één
 * account tegen pogingen vanaf veel plekken. Geen van beide vervangt de ander.
 */

const loginSchema = z.object({
  employeeNumber: z
    .string()
    .trim()
    .min(3, "Vul uw personeelsnummer in.")
    .max(32)
    // Alleen wat een personeelsnummer kan zijn. Scheelt het doorgeven van
    // willekeurige invoer aan de databaselaag.
    .regex(/^[A-Za-z0-9-]+$/, "Een personeelsnummer bevat alleen letters, cijfers en streepjes."),
  password: z.string().min(1, "Vul uw wachtwoord in.").max(200),
});

export interface LoginState {
  readonly error?: string;
}

const GENERIC_FAILURE = "Aanmelden is niet gelukt. Controleer uw gegevens en probeer het opnieuw.";

export async function loginAction(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const requestHeaders = await headers();
  const fingerprint = clientFingerprint(
    requestIp(requestHeaders),
    requestHeaders.get("user-agent"),
  );

  const limit = rateLimit(`login:${fingerprint}`, { limit: 10, windowSeconds: 300 });
  if (!limit.allowed) {
    await recordSecurityEvent({
      kind: SecurityEventKind.RATE_LIMITED,
      subject: "login",
      clientFingerprint: fingerprint,
      detail: { retryAfterSeconds: limit.retryAfterSeconds },
    });
    return {
      error: `Te veel pogingen. Probeer het over ${Math.ceil(limit.retryAfterSeconds / 60)} minuten opnieuw.`,
    };
  }

  const parsed = loginSchema.safeParse({
    employeeNumber: formData.get("employeeNumber"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? GENERIC_FAILURE };
  }

  const provider = authProvider();
  if (!provider.supportsPasswordLogin || !provider.authenticateWithPassword) {
    return {
      error:
        "Aanmelden met wachtwoord is uitgeschakeld. Meld u aan via NS SSO.",
    };
  }

  const result = await provider.authenticateWithPassword({
    employeeNumber: parsed.data.employeeNumber,
    password: parsed.data.password,
  });

  if (result.outcome !== "AUTHENTICATED" || !result.userId || !result.authLevel) {
    await recordSecurityEvent({
      kind:
        result.outcome === "ACCOUNT_LOCKED" || result.outcome === "ACCOUNT_DISABLED"
          ? SecurityEventKind.LOGIN_BLOCKED
          : SecurityEventKind.LOGIN_FAILED,
      subject: parsed.data.employeeNumber,
      clientFingerprint: fingerprint,
      detail: { uitkomst: result.outcome, toelichting: result.auditReason },
    });
    return { error: GENERIC_FAILURE };
  }

  await createSession({
    userId: result.userId,
    authLevel: result.authLevel,
    clientFingerprint: fingerprint,
  });

  await recordSecurityEvent({
    kind: SecurityEventKind.LOGIN_SUCCESS,
    userId: result.userId,
    subject: parsed.data.employeeNumber,
    clientFingerprint: fingerprint,
    detail: { niveau: result.authLevel, provider: provider.kind },
  });

  const actor = await currentActor();
  // De bestemming volgt uit de rol en niet uit een parameter in het verzoek:
  // een open doorverwijzing na inloggen is een klassieke phishinghefboom.
  redirect(actor ? homePathForRoles(actor.roles) : "/");
}

export async function logoutAction(): Promise<void> {
  const actor = await currentActor();
  if (actor) {
    await recordAudit({ actor, action: "sessie.afgemeld", objectType: "Session", objectId: actor.sessionId });
    await recordSecurityEvent({
      kind: SecurityEventKind.LOGOUT,
      userId: actor.userId,
      subject: actor.employeeNumber,
    });
  }
  await destroySession();
  redirect("/aanmelden");
}
