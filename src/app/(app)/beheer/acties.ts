"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AccountStatus, Role } from "@/lib/generated/prisma/enums";
import type { ActionState } from "@/lib/action-state";
import { LastAdminError, setAccountStatus, setRoles } from "@/server/services/role-service";

/**
 * Beheeracties.
 *
 * Het formulier stuurt een voorstel; `role-service.ts` beslist, logt en
 * beschermt de laatste beheerder. Deze laag valideert alleen de vorm van de
 * invoer — nooit de bevoegdheid, want dan zou het uitschakelen van deze laag
 * genoeg zijn om eromheen te komen.
 */

const rolesSchema = z.object({
  userId: z.uuid("Ongeldige verwijzing."),
  roles: z.array(z.enum(Object.values(Role) as [string, ...string[]])),
});

export async function rollenAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = rolesSchema.safeParse({
    userId: formData.get("userId"),
    roles: formData.getAll("roles").map(String),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ongeldige invoer." };
  }

  try {
    const result = await setRoles({
      userId: parsed.data.userId,
      roles: parsed.data.roles as Role[],
    });
    revalidatePath("/beheer/gebruikers");
    revalidatePath("/beheer");
    return result.ok
      ? { notice: "De rollen zijn bijgewerkt en vastgelegd in het auditlog." }
      : { error: result.reason };
  } catch (error) {
    // De bescherming van de laatste beheerder is geen technische storing maar
    // een uitkomst die de gebruiker hoort te lezen.
    if (error instanceof LastAdminError) {
      return { error: error.message };
    }
    throw error;
  }
}

const statusSchema = z.object({
  userId: z.uuid("Ongeldige verwijzing."),
  status: z.enum(Object.values(AccountStatus) as [string, ...string[]]),
});

export async function accountStatusAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = statusSchema.safeParse({
    userId: formData.get("userId"),
    status: formData.get("status"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ongeldige invoer." };
  }

  try {
    const result = await setAccountStatus({
      userId: parsed.data.userId,
      status: parsed.data.status as AccountStatus,
    });
    revalidatePath("/beheer/gebruikers");
    return result.ok ? { notice: "De accountstatus is bijgewerkt." } : { error: result.reason };
  } catch (error) {
    if (error instanceof LastAdminError) {
      return { error: error.message };
    }
    throw error;
  }
}
