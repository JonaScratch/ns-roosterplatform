import Link from "next/link";
import { listBaseRosters } from "@/server/services/roster-service";
import { proposeStructure } from "@/server/services/roster-structure-service";
import { RosterCommitteeShell } from "@/components/layout/area-shell";
import { Alert, Badge, WidgetCard, inputClass } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";

export const dynamic = "force-dynamic";

const POSITIE_LABEL: Record<string, string> = {
  DUTY: "Dienst",
  RES: "RES",
  WR: "WTV",
  CO: "CO",
  RUST: "R",
};

/**
 * Regelaantallen per basisrooster voorstellen — alleen voor een nieuwe
 * dienstregelingronde.
 *
 * ## Waarom dit een GET-formulier is en geen server action
 *
 * Er wordt hier niets vastgelegd: elke druk op "Doorrekenen" is een nieuwe,
 * volledig herhaalbare berekening op basis van de opgegeven aantallen, net als
 * de datumkeuze op de CAO-dagenpagina. Dat past bij een link met de gekozen
 * aantallen erin — te delen, te verversen, nooit een verborgen actie.
 *
 * ## Waarom hier geen "toepassen"-knop staat
 *
 * `proposeStructure` schrijft bewust niets weg: het huidige rooster komt uit
 * de aangeleverde bladen van NS, en een structuur die dat overschrijft, zou een
 * aangeleverde bron vervangen door een berekening. Een nieuwe structuur
 * werkelijk invoeren raakt bovendien de medewerkers die nu op een regel staan —
 * welke regel vervalt, welke medewerker dan waarheen gaat, is een
 * roosterbeleidskeuze die hier niet wordt aangenomen. Dit scherm rekent door en
 * toont het resultaat; vaststellen blijft mensenwerk.
 */
export default async function Structuurvoorstel({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rosters = await listBaseRosters();

  const overrides: Record<string, number> = {};
  for (const roster of rosters) {
    const raw = params[roster.code];
    const waarde = typeof raw === "string" ? Number(raw) : roster.lines;
    overrides[roster.code] = Number.isFinite(waarde) && waarde > 0 ? Math.trunc(waarde) : roster.lines;
  }

  const resultaat = await proposeStructure(null, overrides);

  return (
    <RosterCommitteeShell
      activeHref="/roostercommissie/roosters"
      header={{
        title: "Regelaantallen voorstellen",
        subtitle: "Alleen mogelijk in een nieuwe dienstregelingronde — geen wijzigingsblad",
      }}
    >
      <div className="mb-3">
        <Link href="/roostercommissie/roosters" className="text-[12px] font-semibold underline">
          ← Terug naar basisroosters
        </Link>
      </div>

      <Alert tone="info" title="Voorstel, niet toegepast">
        Dit scherm rekent door wat een ander aantal regels zou betekenen — het schrijft niets naar
        de basisroosters. Vaststellen is een aparte, bewuste stap die hier bewust ontbreekt.
      </Alert>

      <div className="mt-4">
        <WidgetCard title="Aantal regels per basisrooster" bodyClassName="border-t border-line p-4">
          <form method="get" className="space-y-3">
            <Table>
              <THead>
                <TR>
                  <TH>Rooster</TH>
                  <TH>Profiel</TH>
                  <TH numeric>Huidige regels</TH>
                  <TH numeric>Nieuwe regels</TH>
                </TR>
              </THead>
              <tbody>
                {rosters.map((roster) => (
                  <TR key={roster.id}>
                    <TD>
                      <span className="font-semibold">{roster.code}</span>
                    </TD>
                    <TD>
                      <Badge tone="info">{roster.profileLabel}</Badge>
                    </TD>
                    <TD numeric>{roster.lines}</TD>
                    <TD numeric>
                      <input
                        type="number"
                        min={1}
                        name={roster.code}
                        defaultValue={overrides[roster.code]}
                        className={`${inputClass} w-24 text-right tabular`}
                      />
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <button
              type="submit"
              className="inline-flex items-center rounded-md bg-accent-rc px-3 py-1.5 text-xs font-semibold text-white"
            >
              Doorrekenen
            </button>
          </form>
        </WidgetCard>
      </div>

      <div className="mt-4">
        {resultaat.ok ? (
          <div className="space-y-4">
            <p className="text-[11px] text-ink-muted">
              Regelwaarden uit het regelbestand:{" "}
              {resultaat.rulesUsed.map((r) => `${r.id} = ${r.value}`).join(" · ")}.
            </p>
            {resultaat.proposals.map((voorstel) => (
              <WidgetCard
                key={voorstel.baseRosterCode}
                title={`${voorstel.baseRosterCode} — ${voorstel.baseRosterName}`}
                subtitle={
                  voorstel.lineCount === voorstel.currentLineCount
                    ? `${voorstel.currentLineCount} regels (ongewijzigd aantal)`
                    : `${voorstel.currentLineCount} → ${voorstel.lineCount} regels`
                }
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                      Capaciteit bij dit voorstel
                    </p>
                    <ul className="mt-1 space-y-0.5 text-[12.5px]">
                      {Object.entries(voorstel.counts).map(([positie, aantal]) => (
                        <li key={positie}>
                          <span className="font-semibold tabular">{aantal}</span>{" "}
                          <span className="text-ink-muted">
                            {POSITIE_LABEL[positie] ?? positie}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                      Verschil met het huidige rooster
                    </p>
                    <p className="mt-1 text-[12.5px]">
                      <span className="font-semibold tabular">{voorstel.changedDays}</span>{" "}
                      <span className="text-ink-muted">dagcellen anders</span>
                    </p>
                    <p className="mt-2 text-[11px] text-ink-muted">
                      Gem. uren na generatie: nog niet bekend. Dit voorstel bepaalt alleen welke
                      dag rust, reserve, WTV of compensatie is — welk dienstnummer op een
                      werkdag komt, en dus de werkelijke uren, is de opdracht van de optimizer
                      die hierna draait.
                    </p>
                  </div>
                </div>
              </WidgetCard>
            ))}
          </div>
        ) : (
          <Alert tone="warn" title={`Kan niet doorrekenen (${resultaat.code})`}>
            {resultaat.reason}
          </Alert>
        )}
      </div>
    </RosterCommitteeShell>
  );
}
