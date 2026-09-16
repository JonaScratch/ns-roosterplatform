import { redirect } from "next/navigation";
import { currentActor } from "@/server/auth/session";
import { actorHasPermission } from "@/server/security/authorize";
import { PERMISSIONS, homePathForRoles } from "@/server/security/permissions";

export const dynamic = "force-dynamic";

/**
 * De poort van dit werkgebied.
 *
 * ## Waarom deze controle in een layout staat en niet alleen in de pagina
 *
 * Een pagina haalt haar gegevens op vóórdat de shell eromheen gerenderd is. Wie
 * geen recht heeft, liep daardoor eerst tegen de weigering van de service aan en
 * kreeg een foutpagina te zien in plaats van een omleiding naar zijn eigen
 * omgeving. Functioneel veilig — er werd niets prijsgegeven — maar het oogde als
 * een storing. De layout draait eerder en stuurt netjes door.
 *
 * Dit is nadrukkelijk gemak, geen beveiliging. De services controleren
 * onafhankelijk opnieuw en leggen elke weigering vast; deze omleiding kan geen
 * enkele controle vervangen.
 */
export default async function DienstindelingLayout({ children }: LayoutProps<"/dienstindeling">) {
  const actor = await currentActor();
  if (!actor) {
    redirect("/aanmelden");
  }
  if (!actorHasPermission(actor, PERMISSIONS.ASSIGNMENT_READ)) {
    redirect(homePathForRoles(actor.roles));
  }
  return children;
}
