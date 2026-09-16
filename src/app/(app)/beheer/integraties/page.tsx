import { AdminShell } from "@/components/layout/area-shell";
import { NotYetBuilt } from "@/components/ui/not-yet";

export const dynamic = "force-dynamic";

export default function Integraties() {
  return (
    <AdminShell
      activeHref="/beheer/integraties"
      header={{ title: "Integraties", subtitle: "Koppelingen met omliggende systemen" }}
    >
      <NotYetBuilt
        title="Integratiebeheer"
        purpose="Instellen en bewaken van de koppelingen met NS SSO/MFA, de centrale Rules Engine en de personeelsadministratie."
        reason="Geen van die drie diensten is aangesloten. De aansluitpunten bestaan al in de code — de authenticatieprovider en de rules engine worden gekozen via configuratie — maar er valt nog niets te beheren."
        alternatives="De huidige stand van beide koppelingen staat op de systeemstatuspagina."
      />
    </AdminShell>
  );
}
