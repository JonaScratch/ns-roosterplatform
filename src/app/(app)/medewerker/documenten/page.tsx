import Link from "next/link";
import { EmployeeShell } from "@/components/layout/area-shell";
import { EmptyState, WidgetCard } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

/**
 * Documenten voor de medewerker.
 *
 * ## Waarom dit een lege status is en geen "nog niet gebouwd"
 *
 * Er bestaat in dit platform geen apart documentbegrip naast het rooster
 * zelf — geen `Document`-model, geen publicatiestroom die iets anders dan een
 * roosterversie oplevert. Een medewerker die hier komt, moet dus een eerlijke
 * lege status zien en geen uitleg over een ontwikkelfase: er zijn nu eenmaal
 * geen documenten, niet omdat er iets ontbreekt aan de bouw van dit scherm.
 */
export default function Documenten() {
  return (
    <EmployeeShell
      activeHref="/medewerker/documenten"
      header={{ title: "Documenten", subtitle: "Uw roosterdocumenten en publicaties" }}
    >
      <WidgetCard title="Mijn documenten">
        <EmptyState>Er zijn momenteel geen documenten voor u gepubliceerd.</EmptyState>
        <p className="mt-3 text-center text-[12px] text-ink-muted">
          Uw actuele rooster staat onder{" "}
          <Link href="/medewerker/rooster" className="font-semibold underline">
            Mijn rooster
          </Link>
          .
        </p>
      </WidgetCard>
    </EmployeeShell>
  );
}
