import Link from "next/link";
import { listBaseRosters, listVersions } from "@/server/services/roster-service";
import { RosterCommitteeShell } from "@/components/layout/area-shell";
import { LocationSelector } from "@/components/layout/location-selector";
import { Badge, EmptyState, WidgetCard } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";

export const dynamic = "force-dynamic";

/**
 * Basisroosters beheren en een generatieopdracht klaarzetten.
 *
 * De generatieopdracht neemt bewust álle geselecteerde basisroosters in één
 * keer mee. Ze één voor één laten genereren zou het eerste rooster bevoordelen
 * en de rest de restdiensten geven — precies wat het uitgangspunt van
 * gezamenlijke optimalisatie uitsluit. De keuzemogelijkheid om er één te doen,
 * bestaat daarom niet.
 */
export default async function Basisroosters({
  searchParams,
}: {
  searchParams: Promise<{ standplaats?: string }>;
}) {
  const { standplaats } = await searchParams;
  // De gevraagde standplaats is een wens; de service beslist wat hij teruggeeft.
  const rosters = await listBaseRosters(standplaats ?? null);
  const versionsPerRoster = await Promise.all(
    rosters.map(async (roster) => ({
      roster,
      versions: await listVersions(roster.id),
    })),
  );

  return (
    <RosterCommitteeShell
      activeHref="/roostercommissie/roosters"
      header={{ title: "Basisroosters", subtitle: "Roosterprofielen, bezetting en de bijbehorende versies" }}
    >
      <div className="mb-3">
        <LocationSelector requested={standplaats ?? null} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <WidgetCard title="Roosters">
            {rosters.length === 0 ? (
              <EmptyState>Er zijn nog geen basisroosters ingericht.</EmptyState>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Code</TH>
                    <TH>Profiel</TH>
                    <TH>Standplaats</TH>
                    <TH numeric>Cyclus</TH>
                    <TH numeric>Lijnen</TH>
                    <TH numeric>Bezet</TH>
                    <TH numeric>Wachtlijst</TH>
                    <TH>Status</TH>
                    <TH>Blad</TH>
                  </TR>
                </THead>
                <tbody>
                  {rosters.map((roster) => (
                    <TR key={roster.id}>
                      <TD>
                        <Link
                          href={`/roostercommissie/roosters/${roster.code}`}
                          className="font-semibold underline"
                        >
                          {roster.code}
                        </Link>
                        <span className="block text-[11px] text-ink-muted">{roster.name}</span>
                      </TD>
                      <TD>
                        <Badge tone="info">{roster.profileLabel}</Badge>
                      </TD>
                      <TD>{roster.depot}</TD>
                      <TD numeric>{roster.cycleWeeks} wk</TD>
                      <TD numeric>{roster.lines}</TD>
                      <TD numeric>{roster.occupiedLines}</TD>
                      <TD numeric>{roster.waiting}</TD>
                      <TD>
                        <Badge tone={roster.status === "ACTIVE" ? "ok" : "neutral"}>
                          {roster.status === "ACTIVE"
                            ? "Actief"
                            : roster.status === "DRAFT"
                              ? "Concept"
                              : "Gearchiveerd"}
                        </Badge>
                      </TD>
                      <TD>
                        <a
                          href={`/roostercommissie/roosterblad/${roster.code}`}
                          className="text-[11px] underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Roosterblad
                        </a>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            )}
          </WidgetCard>

          <WidgetCard
            title="Roosterversies"
            subtitle="Elke gegenereerde of opgestelde variant, met het aantal controlemeldingen."
          >
            {versionsPerRoster.every((entry) => entry.versions.length === 0) ? (
              <EmptyState>
                Er zijn nog geen roosterversies. Ze ontstaan zodra de rooster-engine een
                voorstel oplevert.
              </EmptyState>
            ) : (
              <div className="space-y-4">
                {versionsPerRoster
                  .filter((entry) => entry.versions.length > 0)
                  .map((entry) => (
                    <div key={entry.roster.id}>
                      <h3 className="mb-1 text-xs font-semibold">{entry.roster.code}</h3>
                      <Table>
                        <THead>
                          <TR>
                            <TH>Versie</TH>
                            <TH>Status</TH>
                            <TH>Engine</TH>
                            <TH numeric>Overtredingen</TH>
                            <TH numeric>Waarschuwingen</TH>
                            <TH>Export</TH>
                          </TR>
                        </THead>
                        <tbody>
                          {entry.versions.map((version) => (
                            <TR key={version.id}>
                              <TD>{version.label}</TD>
                              <TD>{version.status}</TD>
                              <TD>{version.engine ?? "—"}</TD>
                              <TD numeric>
                                {version.warnings.violation > 0 ? (
                                  <span className="font-semibold text-state-error">
                                    {version.warnings.violation}
                                  </span>
                                ) : (
                                  0
                                )}
                              </TD>
                              <TD numeric>{version.warnings.warning}</TD>
                              <TD>
                                <Link
                                  href={`/roostercommissie/export/${version.id}`}
                                  className="font-semibold text-ns-blue underline"
                                  prefetch={false}
                                >
                                  CSV
                                </Link>
                              </TD>
                            </TR>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  ))}
              </div>
            )}
          </WidgetCard>
        </div>

        <div className="space-y-4">
          <WidgetCard
            title="Rooster genereren"
            subtitle="Alle basisroosters van de standplaats worden gezamenlijk geoptimaliseerd."
          >
            <p className="text-[12px] text-ink-muted">
              Een generatieopdracht kiest bewust geen los basisrooster en geen vrije periode: alle
              basisroosters gaan in één keer de optimizer in, en de periode volgt uit het
              roosterjaar. Dat gebeurt op één plek.
            </p>
            <Link
              href="/roostercommissie/genereren"
              className="mt-3 inline-flex items-center rounded-md bg-accent-rc px-3 py-1.5 text-xs font-semibold text-white"
            >
              Naar Genereren &amp; simulatie
            </Link>
          </WidgetCard>

          <WidgetCard
            title="Regelaantallen voorstellen"
            subtitle="Alleen voor een nieuwe dienstregelingronde"
          >
            <p className="text-[12px] text-ink-muted">
              Het aantal regels per basisrooster ligt niet vast: in een nieuwe
              dienstregelingronde kan de roostercommissie een ander aantal doorrekenen — de
              structuur wordt herberekend, niet zomaar geschaald.
            </p>
            <Link
              href="/roostercommissie/roosters/structuur"
              className="mt-3 inline-flex items-center rounded-md border border-accent-rc px-3 py-1.5 text-xs font-semibold text-accent-rc"
            >
              Regelaantallen voorstellen
            </Link>
          </WidgetCard>
        </div>
      </div>
    </RosterCommitteeShell>
  );
}
