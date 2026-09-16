import { coverageHeatmap } from "@/server/services/coverage-heatmap-service";
import { LocationSelector } from "@/components/layout/location-selector";
import { RosterCommitteeShell } from "@/components/layout/area-shell";
import { Alert, EmptyState, StatCard, WidgetCard } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { BarChartIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Waar zit de druk in de week?
 *
 * ## Wat hier bewust niet staat
 *
 * Geen streefwaarde en geen stoplicht. De verleiding is om alles onder tachtig
 * procent rood te maken, maar dat getal zou ik zelf verzinnen — en zodra het op
 * een scherm staat, gaat iemand erop sturen. Wat er wél staat, is hoeveel
 * diensten er op een dag te rijden zijn en hoeveel roosterregels daarvoor
 * klaarstaan. Dat is een feit; of het krap is, mag de lezer vinden.
 *
 * ## De kleur
 *
 * De verzadiging volgt het aantal diensten ten opzichte van de drukste cel van
 * deze standplaats. Het is dus een relatieve schaal binnen dit rooster en geen
 * norm. Dat staat er ook bij, want een gekleurde tabel zonder uitleg wordt
 * vanzelf als beoordeling gelezen.
 */
export default async function Bezetting({
  searchParams,
}: {
  searchParams: Promise<{ standplaats?: string }>;
}) {
  const { standplaats } = await searchParams;
  const kaart = await coverageHeatmap(standplaats ?? null);

  return (
    <RosterCommitteeShell
      activeHref="/roostercommissie/bezetting"
      header={{
        title: "Bezetting per weekdag",
        subtitle: "Waar in de week de diensten zitten en welke roosterregels ze dragen",
      }}
    >
      <div className="mb-3">
        <LocationSelector requested={standplaats ?? null} />
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Diensten in het pakket" value={String(kaart.totalDuties)} />
        <StatCard
          label="Niet in een vaste roosterlijn"
          value={String(kaart.totalUnplaced)}
          tone={kaart.totalUnplaced > 0 ? "warn" : "ok"}
        />
        <StatCard label="Drukste dagdeel" value={String(kaart.maxDuties)} />
      </div>

      {kaart.totalDuties === 0 ? (
        <EmptyState>
          Er is geen actief dienstenpakket voor {kaart.locationCode}. Zonder diensten valt er
          niets over de bezetting te zeggen.
        </EmptyState>
      ) : (
        <WidgetCard
          icon={<BarChartIcon size={18} />}
          tone="rc"
          title="Diensten per weekdag en dagdeel"
          subtitle={`Uit ${kaart.packageLabel ?? "het actieve pakket"}`}
          bodyClassName="border-t border-line"
        >
          <Table>
            <THead>
              <TR>
                <TH>Weekdag</TH>
                {kaart.periods.map((periode) => (
                  <TH key={periode} numeric>
                    {PERIODE_LABELS[periode]}
                  </TH>
                ))}
                <TH numeric>Totaal</TH>
                <TH numeric>Reservedagen</TH>
                <TH numeric>Vrije regels</TH>
              </TR>
            </THead>
            <tbody>
              {kaart.rows.map((rij) => (
                <TR key={rij.weekday}>
                  <TD>
                    <span className={rij.weekday >= 6 ? "font-semibold" : ""}>
                      {rij.weekdayLabel}
                    </span>
                  </TD>
                  {rij.cells.map((cel) => {
                    // Relatieve verzadiging binnen deze standplaats. Nooit een
                    // absolute norm: die is niet aangeleverd.
                    const deel = kaart.maxDuties === 0 ? 0 : cel.duties / kaart.maxDuties;
                    return (
                      <TD key={cel.period} numeric>
                        <span
                          className="inline-block min-w-8 rounded px-1.5 py-0.5 text-[11px] tabular-nums"
                          style={{
                            backgroundColor:
                              cel.duties === 0
                                ? "transparent"
                                : `rgba(0, 61, 165, ${(0.08 + deel * 0.42).toFixed(3)})`,
                            color: deel > 0.6 ? "#fff" : undefined,
                          }}
                          title={
                            `${cel.duties} dienst(en), ${cel.rosteredLines} roosterregel(s)` +
                            (cel.unplaced > 0
                              ? `, ${cel.unplaced} niet in een vaste lijn`
                              : "")
                          }
                        >
                          {cel.duties === 0 ? "—" : cel.duties}
                        </span>
                        {cel.unplaced > 0 && (
                          <span className="ml-1 text-[10px] font-semibold text-amber-700">
                            {cel.unplaced}↑
                          </span>
                        )}
                      </TD>
                    );
                  })}
                  <TD numeric>
                    <span className="font-semibold tabular-nums">{rij.totalDuties}</span>
                  </TD>
                  <TD numeric>
                    <span className="tabular-nums text-ink-muted">{rij.reserveDays}</span>
                  </TD>
                  <TD numeric>
                    <span className="tabular-nums text-ink-muted">{rij.freeLines}</span>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </WidgetCard>
      )}

      <div className="mt-4">
        <Alert tone="info">
        De kleur is een verhouding binnen deze standplaats en geen norm: de donkerste cel is de
        drukste cel van dit rooster. Welke bezetting gewenst is, volgt uit afspraken die niet
        zijn aangeleverd, en die worden hier niet verzonnen. Een getal met een pijl erachter
        telt de diensten van dat dagdeel die op geen enkele vaste roosterlijn staan; die moeten
          operationeel worden ingevuld.
        </Alert>
      </div>
    </RosterCommitteeShell>
  );
}

const PERIODE_LABELS: Readonly<Record<string, string>> = {
  VROEG: "Vroeg",
  LAAT: "Laat",
  NACHT: "Nacht",
  GEEN: "Geen dagdeel",
};
