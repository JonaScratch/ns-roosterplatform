import { RosterCommitteeShell } from "@/components/layout/area-shell";
import { LocationSelector } from "@/components/layout/location-selector";
import { Alert, EmptyState, StatCard, WidgetCard } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { currentActor } from "@/server/auth/session";
import { prisma } from "@/server/data/prisma";
import { locationScopeFor } from "@/server/security/location-scope";
import { compareRosterSelections, listBaseRosters, type RosterSelection } from "@/server/services/roster-service";

export const dynamic = "force-dynamic";

/**
 * Bestaand rooster, kandidaat, of allebei — naast elkaar.
 *
 * ## Waarom dit scherm herbouwd is
 *
 * De vorige versie vergeleek uitsluitend opgeslagen `RosterVersion`-rijen, en
 * die ontstaan pas bij publicatie. Zolang er niets gepubliceerd is, toonde
 * het scherm daarom altijd "minder dan twee roosterversies om te vergelijken"
 * — niet omdat er niets te vergelijken viel, maar omdat het naar de verkeerde
 * plek keek. §19/§20 van de v1.0.6-opdracht vragen precies wat er wél
 * beschikbaar is: het officiële rooster naast een gegenereerde kandidaat, en
 * kandidaat naast kandidaat. `compareRosterSelections` (roster-service.ts)
 * leest daarvoor rechtstreeks uit dezelfde gegevens als de roosteragent.
 */

interface Kant {
  readonly bron: "official" | "candidate";
  readonly rooster: string | null;
  readonly kandidaat: string | null;
}

function leesKant(params: URLSearchParams, prefix: "links" | "rechts"): Kant {
  const bron = params.get(`${prefix}Bron`) === "candidate" ? "candidate" : "official";
  return {
    bron,
    rooster: params.get(`${prefix}Rooster`),
    kandidaat: params.get(`${prefix}Kandidaat`),
  };
}

export default async function Vergelijken({ searchParams }: PageProps<"/roostercommissie/vergelijken">) {
  const params = await searchParams;
  const asString = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);
  const standplaats = asString(params.standplaats);

  const actor = await currentActor();
  if (!actor) return null;
  const scope = await locationScopeFor(actor, standplaats);
  const locationCode = scope.code;

  const [roosters, kandidaten] = await Promise.all([
    listBaseRosters(standplaats),
    prisma.candidateRoster.findMany({
      where: { locationCode },
      orderBy: { generatedAt: "desc" },
      take: 12,
      select: { id: true, scenarioLabel: true, validationState: true, generatedAt: true },
    }),
  ]);

  // Query-string opnieuw opbouwen als URLSearchParams, want searchParams komt
  // als Record<string, string | string[]> binnen en dat leest lastiger.
  const flatParams = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const s = asString(v);
    if (s) flatParams.set(k, s);
  }
  const links = leesKant(flatParams, "links");
  const rechts = leesKant(flatParams, "rechts");
  const klaar = Boolean(links.rooster && rechts.rooster && (links.bron === "official" || links.kandidaat) && (rechts.bron === "official" || rechts.kandidaat));
  const zelfdeKant = klaar && links.bron === rechts.bron && links.rooster === rechts.rooster && links.kandidaat === rechts.kandidaat;

  let diff: Awaited<ReturnType<typeof compareRosterSelections>> | null = null;
  let fout: string | null = null;
  if (klaar && !zelfdeKant) {
    try {
      const naarSelectie = (k: Kant): RosterSelection => ({ source: k.bron, rosterCode: k.rooster!, candidateId: k.bron === "candidate" ? k.kandidaat : null });
      diff = await compareRosterSelections(locationCode, naarSelectie(links), naarSelectie(rechts));
    } catch (e) {
      fout = e instanceof Error ? e.message : "De vergelijking is mislukt.";
    }
  }

  return (
    <RosterCommitteeShell
      activeHref="/roostercommissie/vergelijken"
      header={{
        title: "Roosters vergelijken",
        subtitle: "Officieel, kandidaat of allebei — per lijn, week en dag",
        context: <LocationSelector requested={standplaats} />,
      }}
    >
      <WidgetCard title="Twee roosters kiezen">
        {roosters.length === 0 ? (
          <EmptyState>Nog geen basisroosters op deze standplaats.</EmptyState>
        ) : (
          <form className="grid gap-4 text-xs sm:grid-cols-2">
            {standplaats && <input type="hidden" name="standplaats" value={standplaats} />}
            <Kantkiezer prefix="links" titel="Links" roosters={roosters} kandidaten={kandidaten} huidig={links} />
            <Kantkiezer prefix="rechts" titel="Rechts" roosters={roosters} kandidaten={kandidaten} huidig={rechts} />
            <div className="sm:col-span-2">
              <button type="submit" className="rounded bg-ns-blue px-3 py-1.5 font-semibold text-white hover:bg-ns-blue-dark">
                Vergelijken
              </button>
            </div>
          </form>
        )}
      </WidgetCard>

      {zelfdeKant && (
        <div className="mt-4">
          <Alert tone="warn">Links en rechts wijzen naar hetzelfde rooster. Kies twee verschillende.</Alert>
        </div>
      )}

      {fout && (
        <div className="mt-4">
          <Alert tone="error">{fout}</Alert>
        </div>
      )}

      {diff && (
        <>
          <div className="my-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Gewijzigde dagen" value={diff.changed.length} tone={diff.changed.length > 0 ? "warn" : "neutral"} />
            <StatCard label="Ongewijzigd" value={diff.unchangedCount} />
            <StatCard label="Alleen links" value={diff.onlyInLeft} />
            <StatCard label="Alleen rechts" value={diff.onlyInRight} />
          </div>

          {diff.leftLines !== diff.rightLines && (
            <div className="mb-4">
              <Alert tone="neutral">
                {diff.leftLabel} heeft {diff.leftLines} {diff.leftLines === 1 ? "lijn" : "lijnen"}, {diff.rightLabel} heeft {diff.rightLines}.
                Een andere rotatielengte is geen fout; de vergelijking gaat per cel en telt gewoon wat aan één kant
                extra staat.
              </Alert>
            </div>
          )}

          <WidgetCard title="Verschillen" subtitle={`${diff.leftLabel} tegenover ${diff.rightLabel}`}>
            {diff.changed.length === 0 ? (
              <EmptyState>Deze twee roosters zijn op elke gedeelde cel gelijk.</EmptyState>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH numeric>Lijn</TH>
                    <TH numeric>Week</TH>
                    <TH>Dag</TH>
                    <TH>{diff.leftLabel}</TH>
                    <TH>{diff.rightLabel}</TH>
                  </TR>
                </THead>
                <tbody>
                  {diff.changed.map((cell) => (
                    <TR key={`${cell.lineNumber}-${cell.weekIndex}-${cell.weekday}`}>
                      <TD numeric>{cell.lineNumber}</TD>
                      <TD numeric>{cell.weekIndex}</TD>
                      <TD>{cell.weekdayLabel}</TD>
                      <TD mono>
                        <span className="rounded bg-state-error-soft px-1 text-state-error">{cell.before}</span>
                      </TD>
                      <TD mono>
                        <span className="rounded bg-state-ok-soft px-1 text-state-ok">{cell.after}</span>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            )}
          </WidgetCard>
        </>
      )}
    </RosterCommitteeShell>
  );
}

function Kantkiezer({
  prefix,
  titel,
  roosters,
  kandidaten,
  huidig,
}: {
  readonly prefix: "links" | "rechts";
  readonly titel: string;
  readonly roosters: readonly { readonly code: string; readonly profileLabel: string }[];
  readonly kandidaten: readonly { readonly id: string; readonly scenarioLabel: string; readonly validationState: string }[];
  readonly huidig: Kant;
}) {
  return (
    <fieldset className="space-y-2 rounded border border-line-strong p-3">
      <legend className="px-1 text-[11px] font-semibold text-ink-muted">{titel}</legend>
      <label className="flex flex-col gap-0.5">
        <span className="text-[11px] text-ink-muted">Bron</span>
        <select name={`${prefix}Bron`} defaultValue={huidig.bron} className="rounded border border-line-strong px-2 py-1">
          <option value="official">Officieel rooster</option>
          <option value="candidate">Kandidaat</option>
        </select>
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-[11px] text-ink-muted">Basisrooster</span>
        <select name={`${prefix}Rooster`} defaultValue={huidig.rooster ?? ""} className="rounded border border-line-strong px-2 py-1">
          <option value="">Kies…</option>
          {roosters.map((r) => (
            <option key={r.code} value={r.code}>
              {r.code} — {r.profileLabel}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-[11px] text-ink-muted">Kandidaat (alleen bij bron "Kandidaat")</span>
        <select name={`${prefix}Kandidaat`} defaultValue={huidig.kandidaat ?? ""} className="rounded border border-line-strong px-2 py-1">
          <option value="">Kies…</option>
          {kandidaten.map((k) => (
            <option key={k.id} value={k.id}>
              {k.scenarioLabel}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}
