import { redirect } from "next/navigation";
import { currentActor } from "@/server/auth/session";
import { homePathForRoles } from "@/server/security/permissions";

export const dynamic = "force-dynamic";

/** De voordeur. Stuurt door naar de plek die bij de rol hoort. */
export default async function RootPage() {
  const actor = await currentActor();
  redirect(actor ? homePathForRoles(actor.roles) : "/aanmelden");
}
