import Link from "next/link";
import { NOT_CONFIGURED_MESSAGE, PLANNING_UNIT_NOTE } from "@/domain/locations";
import { listLocations } from "@/server/services/location-service";
import { AdminShell } from "@/components/layout/area-shell";
import { Alert, Badge, WidgetCard } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";

export const dynamic = "force-dynamic";

/**
 * Alle standplaatsen, en wat er per standplaats werkelijk is ingericht.
 *
 * ## Waarom hier geen enkele standplaats "in orde" heet die dat niet is
 *
 * De verleiding bij zo'n overzicht is één kolom met een vinkje. Dan staat er
 * straks 41 keer een vinkje omdat de rij bestaat, en niemand die nog weet wat
 * dat vinkje betekende. Per standplaats staat daarom apart of de diensten er
 * zijn, of er roosters zijn, of de lokale regels zijn ingericht en of er een
 * exportsjabloon is. Alleen wanneer die alle vier kloppen kan er gepland
 * worden, en dat wordt niet met de hand aangezet.
 */

function Vink({ aan }: { aan: boolean }) {
  return (
    <span className={aan ? "text-emerald-600" : "text-ink-muted"} title={aan ? "ingericht" : "niet ingericht"}>
      {aan ? "✓" : "—"}
    </span>
  );
}

export default async function Organisatie() {
  const locations = await listLocations();
  const ingericht = locations.filter((location) => location.planningEnabled);
  const eenheden = locations.flatMap((location) =>
    location.units.map((unit) => ({ ...unit, parent: location.code })),
  );

  return (
    <AdminShell
      activeHref="/beheer/organisatie"
      header={{
        title: "Organisatie",
        subtitle: `${locations.length} standplaatsen geregistreerd, ${ingericht.length} functioneel ingericht`,
      }}
    >
      <Alert tone="neutral" title="Geregistreerd is niet ingericht">
        Alle standplaatsen staan in het systeem zodat ze gekozen kunnen worden en er niets
        buiten beeld valt. Ingericht zijn ze pas wanneer er een dienstenpakket, roosters,
        lokale regels en een exportsjabloon voor bestaan. {NOT_CONFIGURED_MESSAGE}
      </Alert>

      <div className="mt-4">
        <WidgetCard
          title="Standplaatsen"
          subtitle="Klik op een standplaats voor wat er is ingericht en wat er ontbreekt."
        >
          <Table>
            <THead>
              <TR>
                <TH>Code</TH>
                <TH>Standplaats</TH>
                <TH>Regio</TH>
                <TH>Diensten</TH>
                <TH>Roosters</TH>
                <TH>Regels</TH>
                <TH>Export</TH>
                <TH>Optimizer</TH>
                <TH>Planning</TH>
              </TR>
            </THead>
            <tbody>
              {locations.map((location) => (
                <TR key={location.code}>
                  <TD mono>
                    <Link href={`/beheer/organisatie/${location.code}`} className="underline">
                      {location.code}
                    </Link>
                  </TD>
                  <TD>{location.name}</TD>
                  <TD>
                    <span className="text-[11px] text-ink-muted">{location.regionName}</span>
                  </TD>
                  <TD>
                    <Vink aan={location.dutiesConfigured} />
                  </TD>
                  <TD>
                    <Vink aan={location.rostersConfigured} />
                  </TD>
                  <TD>
                    <Vink aan={location.rulesConfigured} />
                  </TD>
                  <TD>
                    <Vink aan={location.exportTemplateConfigured} />
                  </TD>
                  <TD>
                    <span className="text-[11px] text-ink-muted">
                      {location.optimizerMode === "SIMULATION" ? "Simulatie" : "Uit"}
                    </span>
                  </TD>
                  <TD>
                    <Badge tone={location.planningEnabled ? "ok" : "neutral"}>
                      {location.planningEnabled ? "Ingericht" : "Nog niet"}
                    </Badge>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </WidgetCard>
      </div>

      <div className="mt-4">
        <WidgetCard title="Planeenheden binnen een standplaats" subtitle={PLANNING_UNIT_NOTE}>
          <Table>
            <THead>
              <TR>
                <TH>Eenheid</TH>
                <TH>Naam</TH>
                <TH>Hoort bij</TH>
              </TR>
            </THead>
            <tbody>
              {eenheden.map((unit) => (
                <TR key={unit.code}>
                  <TD mono>{unit.code}</TD>
                  <TD>{unit.name}</TD>
                  <TD mono>{unit.parent}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </WidgetCard>
      </div>
    </AdminShell>
  );
}
