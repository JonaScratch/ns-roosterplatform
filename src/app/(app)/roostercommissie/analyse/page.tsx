import { profileQuality, publicationStatus } from "@/server/services/roster-service";
import { dutyCoverage } from "@/server/services/duty-coverage-service";
import { PLACEMENT_LABELS, type PlacementCategory } from "@/domain/duty-placement";
import { LocationSelector } from "@/components/layout/location-selector";
import { RosterCommitteeShell } from "@/components/layout/area-shell";
import {
  Alert,
  EmptyState,
  Meter,
  StatCard,
  WidgetCard,
} from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { BarChartIcon, ShieldIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Roosteranalyse.
 *
 * Beschrijvend, niet oordelend. Er staan geen streefwaarden bij de aandelen:
 * welke verdeling gewenst is, hangt af van cao- en ATW-afspraken die nog niet
 * zijn aangeleverd. Wat de commissie hier krijgt is wat er feitelijk staat —
 * en een verzonnen norm zou erger zijn dan geen norm.
 */
export default async function Roosteranalyse({
  searchParams,
}: {
  searchParams: Promise<{ standplaats?: string }>;
}) {
  const { standplaats } = await searchParams;
  const [profiles, status, dekking] = await Promise.all([
    profileQuality(standplaats ?? null),
    publicationStatus(),
    dutyCoverage(standplaats ?? null),
  ]);

  const totalLines = profiles.reduce((sum, profile) => sum + profile.lines, 0);
  const occupied = profiles.reduce((sum, profile) => sum + profile.occupiedLines, 0);

  return (
    <RosterCommitteeShell
      activeHref="/roostercommissie/analyse"
      header={{
        title: "Roosteranalyse",
        subtitle: "Verdeling van dagdelen, rangeerwerk en weekenden per roosterprofiel",
      }}
    >
      <div className="mb-3">
        <LocationSelector requested={standplaats ?? null} />
      </div>

      <div className="mb-4">
        <WidgetCard
          title="Waar de diensten terechtkomen"
          subtitle={
            dekking.packageLabel
              ? `${dekking.dutiesInPackage} diensten uit ${dekking.packageLabel}, ` +
                `${dekking.reserveSlotsPerWeek} reservedagen per week`
              : "Er is voor deze standplaats geen actief dienstenpakket."
          }
        >
          {dekking.dutiesInPackage === 0 ? (
            <EmptyState>
              Zonder actief dienstenpakket valt er niets te verdelen. Importeer en activeer eerst
              een levering.
            </EmptyState>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-4">
                {(
                  [
                    "IN_FIXED_ROSTER",
                    "IN_RESERVE_STOCK",
                    "NOT_PLACEABLE",
                    "EXCLUDED",
                  ] as PlacementCategory[]
                ).map((categorie) => (
                  <div key={categorie} className="rounded border border-line p-2">
                    <div className="text-lg font-semibold tabular">
                      {dekking.counts[categorie]}
                    </div>
                    <div className="text-[11px] text-ink-muted">
                      {PLACEMENT_LABELS[categorie]}
                    </div>
                  </div>
                ))}
              </div>

              {dekking.notPlaceable.length > 0 && (
                <div className="mt-3">
                  <Table>
                    <THead>
                      <TR>
                        <TH>Dienst</TH>
                        <TH>Waarom niet te plaatsen</TH>
                      </TR>
                    </THead>
                    <tbody>
                      {dekking.notPlaceable.map((plaatsing) => (
                        <TR key={plaatsing.code}>
                          <TD mono>{plaatsing.code}</TD>
                          <TD>
                            <span className="text-[11px]">
                              {plaatsing.explanation.join(" ")}
                            </span>
                          </TD>
                        </TR>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </>
          )}
        </WidgetCard>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<BarChartIcon size={20} />}
          tone="rc"
          label="Roosterlijnen"
          value={totalLines}
          hint={`${occupied} bezet`}
        />
        <StatCard
          icon={<BarChartIcon size={20} />}
          tone="info"
          label="Roosterprofielen"
          value={profiles.length}
          hint="met een basisrooster"
        />
        <StatCard
          icon={<ShieldIcon size={20} />}
          tone={status.hardViolations > 0 ? "error" : "ok"}
          label="Harde overtredingen"
          value={status.hardViolations}
          hint="op roosterversies"
        />
        <StatCard
          icon={<ShieldIcon size={20} />}
          tone={status.warnings > 0 ? "warn" : "ok"}
          label="Waarschuwingen"
          value={status.warnings}
          hint="zachte regels"
        />
      </div>

      <div className="mt-4">
        <WidgetCard
          icon={<BarChartIcon size={18} />}
          tone="rc"
          title="Verdeling per roosterprofiel"
          subtitle="Feitelijke aandelen over de komende vier weken"
        >
          {profiles.length === 0 ? (
            <div className="py-3">
              <EmptyState>Er zijn nog geen basisroosters ingericht.</EmptyState>
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Profiel</TH>
                  <TH numeric>Basisroosters</TH>
                  <TH numeric>Lijnen</TH>
                  <TH>Vroeg</TH>
                  <TH>Laat</TH>
                  <TH>Nacht</TH>
                  <TH>Rangeer</TH>
                  <TH>Weekend</TH>
                </TR>
              </THead>
              <tbody>
                {profiles.map((profile) => (
                  <TR key={profile.profile}>
                    <TD>
                      <span className="font-semibold text-ink-strong">{profile.profileLabel}</span>
                      <span className="block text-[11px] text-ink-muted">
                        {profile.occupiedLines} van {profile.lines} lijnen bezet
                      </span>
                    </TD>
                    <TD numeric>{profile.baseRosters}</TD>
                    <TD numeric>{profile.lines}</TD>
                    <ShareCell value={profile.shareEarly} tone="ok" />
                    <ShareCell value={profile.shareLate} tone="rc" />
                    <ShareCell value={profile.shareNight} tone="warn" />
                    <ShareCell value={profile.shareShunting} tone="did" />
                    <ShareCell value={profile.weekendLoad} tone="neutral" />
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </WidgetCard>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Alert tone="neutral" title="Waarom hier geen streefwaarden staan">
          Welke verdeling gewenst is, volgt uit cao- en ATW-afspraken die nog niet zijn
          aangeleverd. Een streefwaarde die wij zelf verzinnen, wordt binnen een maand als norm
          gelezen. Wat hier staat is wat er feitelijk is.
        </Alert>
        <Alert tone="info" title="Wat de regels wél toetsen">
          De harde regels — rust, roosterprofiel, bevoegdheden, reeksen — worden bij elke
          toewijzing en elke ruil doorgerekend. Overtredingen op roosterversies staan hierboven en
          zijn per regel-id terug te vinden in de regelcatalogus.
        </Alert>
      </div>
    </RosterCommitteeShell>
  );
}

function ShareCell({
  value,
  tone,
}: {
  value: number;
  tone: "ok" | "rc" | "warn" | "did" | "neutral";
}) {
  return (
    <TD>
      <span className="flex items-center gap-2">
        <Meter value={value} tone={tone} />
        <span className="tabular w-9 shrink-0 text-right text-[11.5px] text-ink-muted">
          {Math.round(value * 100)}%
        </span>
      </span>
    </TD>
  );
}
