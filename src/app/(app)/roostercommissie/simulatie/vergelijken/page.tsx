import Link from "next/link";
import { z } from "zod";
import { NotFoundError } from "@/server/security/authorize";
import {
  MAX_COMPARED,
  WEEKDAY_SHORT,
  candidateIdsForRun,
  compareCandidates,
} from "@/server/services/candidate-results-service";
import { RosterCommitteeShell } from "@/components/layout/area-shell";
import { Alert, EmptyState, WidgetCard } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { CompareIcon } from "@/components/ui/icons";
import {
  Nachtreeksen,
  PERCENTAGE_SCORES,
  StatusBadge,
  UrenStip,
  VoorkeurBadge,
  afwijkingTekst,
  naamVan,
  scoreTekst,
} from "../onderdelen";

export const dynamic = "force-dynamic";

/**
 * Twee of drie kandidaten naast elkaar.
 *
 * ## Waarom er geen winnaar staat
 *
 * Elke kandidaat hier heeft alle diensten geplaatst en nul bevestigde harde
 * overtredingen; anders stond hij er niet. Wat overblijft zijn afwegingen: meer
 * rust in het ene rooster, eerlijker nachten in het andere. Het scherm zegt per
 * maat welke kandidaat het hoogst scoort, en laat de keuze aan de commissie.
 */
export default async function KandidatenVergelijken({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const gevraagd = (Array.isArray(params.k) ? params.k : params.k ? [params.k] : []).filter(
    (id) => z.uuid().safeParse(id).success,
  );
  const runId = typeof params.run === "string" && z.uuid().safeParse(params.run).success ? params.run : null;

  let ids = gevraagd;
  let melding: string | null = null;
  if (runId) {
    ids = [...(await candidateIdsForRun(runId).catch(() => []))];
  }
  if (ids.length > MAX_COMPARED) {
    melding = `Er waren ${ids.length} kandidaten gekozen; de eerste ${MAX_COMPARED} staan hieronder.`;
    ids = ids.slice(0, MAX_COMPARED);
  }

  const vergelijking =
    ids.length >= 2
      ? await compareCandidates(ids).catch((error: unknown) => {
          if (error instanceof NotFoundError) {
            return null;
          }
          throw error;
        })
      : null;

  return (
    <RosterCommitteeShell
      activeHref="/roostercommissie/simulatie"
      header={{ title: "Kandidaten vergelijken", subtitle: "Dezelfde diensten, dezelfde harde regels — andere keuzes" }}
    >
      <p className="mb-3 text-[12px]">
        <Link href="/roostercommissie/simulatie" className="text-ink-muted underline">
          ← Scenario&apos;s vergelijken
        </Link>
      </p>

      {!vergelijking || vergelijking.candidates.length < 2 ? (
        <WidgetCard icon={<CompareIcon size={18} />} tone="rc" title="Kies twee of drie kandidaten">
          <div className="py-3">
            <EmptyState>
              Vink onder Scenario&apos;s vergelijken bij twee of drie kandidaten &quot;Vergelijken&quot; aan.
            </EmptyState>
          </div>
        </WidgetCard>
      ) : (
        <div className="space-y-4">
          {melding ? <Alert tone="info">{melding}</Alert> : null}

          <div className={`grid gap-3 ${vergelijking.candidates.length === 3 ? "lg:grid-cols-3" : "md:grid-cols-2"}`}>
            {vergelijking.candidates.map((kaart) => (
              <div key={kaart.id} className="rounded-xl border border-line bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-ink-strong">{naamVan(kaart)}</p>
                    <p className="truncate text-[11.5px] text-ink-muted">
                      {kaart.strategyLabel}
                      {kaart.rosterYear ? ` · roosterjaar ${kaart.rosterYear}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusBadge kaart={kaart} />
                    {kaart.preferred ? <VoorkeurBadge /> : null}
                  </div>
                </div>
                <p className="mt-2 text-[12px] text-ink">
                  {kaart.coverage.placed}/{kaart.coverage.required} diensten ·{" "}
                  {kaart.confirmedHardViolations ?? "?"} bevestigde overtredingen
                </p>
                <Link
                  href={`/roostercommissie/simulatie/${kaart.id}`}
                  className="mt-2 inline-flex items-center rounded-md bg-accent-rc px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-ns-blue"
                >
                  Openen
                </Link>
              </div>
            ))}
          </div>

          <Alert tone="neutral" title="Waar ze in verschillen">
            {vergelijking.hints.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-4">
                {vergelijking.hints.map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ul>
            ) : (
              <p>Op geen enkele maat scoort één kandidaat duidelijk het hoogst.</p>
            )}
            <p className="mt-1.5 text-[11.5px]">
              Er wordt geen winnaar aangewezen. Welke verdeling het best past, beslist de Roostercommissie.
            </p>
          </Alert>

          <WidgetCard
            tone="neutral"
            title="Roosterkwaliteit"
            subtitle="Comfort en regelmaat, met het huidige rooster als ijkpunt — geen juridisch oordeel"
            bodyClassName="border-t border-line p-4"
          >
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Maat</TH>
                    <TH numeric>Huidig rooster</TH>
                    {vergelijking.candidates.map((kaart) => (
                      <TH key={kaart.id} numeric>
                        {naamVan(kaart)}
                      </TH>
                    ))}
                  </TR>
                </THead>
                <tbody>
                  {vergelijking.subscores.map((rij) => {
                    const eenheid = PERCENTAGE_SCORES.has(rij.key) ? "%" : "";
                    return (
                      <TR key={rij.key}>
                        <TD>
                          <span className="font-medium" title={rij.explanation}>
                            {rij.label}
                          </span>
                        </TD>
                        <TD numeric>
                          <span className="text-ink-muted">{scoreTekst(rij.official, eenheid)}</span>
                        </TD>
                        {rij.values.map((waarde, index) => (
                          <TD key={vergelijking.candidates[index].id} numeric>
                            <span className={rij.highestIndex === index ? "font-bold text-accent-rc" : "font-semibold"}>
                              {scoreTekst(waarde, eenheid)}
                            </span>
                            {rij.highestIndex === index ? <span className="sr-only"> (hoogste)</span> : null}
                          </TD>
                        ))}
                      </TR>
                    );
                  })}
                  <TR>
                    <TD>
                      <span className="font-medium">Nachten: reeksen van 3+ / 2 / los</span>
                    </TD>
                    <TD numeric>
                      <span className="text-ink-muted">—</span>
                    </TD>
                    {vergelijking.candidates.map((kaart) => (
                      <TD key={kaart.id} numeric>
                        <span className="tabular">
                          {kaart.nights.threeOrMore} / {kaart.nights.pairs} / {kaart.nights.singletons}
                        </span>
                      </TD>
                    ))}
                  </TR>
                  <TR>
                    <TD>
                      <span className="font-medium">Uren t.o.v. 40:00 (gem. / grootste)</span>
                    </TD>
                    <TD numeric>
                      <span className="text-ink-muted">—</span>
                    </TD>
                    {vergelijking.candidates.map((kaart) => (
                      <TD key={kaart.id} numeric>
                        <span className="tabular">
                          {kaart.averageHoursDeviationMinutes} / {kaart.maxHoursDeviationMinutes} min
                        </span>
                      </TD>
                    ))}
                  </TR>
                </tbody>
              </Table>
            </div>
            <p className="mt-2 text-[11px] text-ink-muted">
              Vetgedrukt blauw: de hoogste score op die maat, alleen wanneer één kandidaat daar alleen staat.
              Beweeg over een maat voor de uitleg.
            </p>
          </WidgetCard>

          <WidgetCard
            tone="neutral"
            title="Per basisrooster"
            subtitle="Weekomvang, dagdelen, nachtreeksen en zware overgangen"
            bodyClassName="border-t border-line p-4"
          >
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Rooster</TH>
                    <TH>Huidig rooster</TH>
                    {vergelijking.candidates.map((kaart) => (
                      <TH key={kaart.id}>{naamVan(kaart)}</TH>
                    ))}
                  </TR>
                </THead>
                <tbody>
                  {vergelijking.rosters.map((rooster) => (
                    <TR key={rooster.code}>
                      <TD>
                        <span className="font-mono font-semibold">{rooster.code}</span>
                        <span className="block text-[11px] text-ink-muted">{rooster.name}</span>
                      </TD>
                      <TD>{rooster.official ? <RoosterCel tegel={rooster.official} /> : "—"}</TD>
                      {rooster.perCandidate.map((tegel, index) => (
                        <TD key={vergelijking.candidates[index].id}>
                          {tegel ? (
                            <Link
                              href={`/roostercommissie/simulatie/${vergelijking.candidates[index].id}/${rooster.code}`}
                              className="block rounded hover:bg-canvas"
                            >
                              <RoosterCel tegel={tegel} />
                            </Link>
                          ) : (
                            "—"
                          )}
                        </TD>
                      ))}
                    </TR>
                  ))}
                </tbody>
              </Table>
            </div>
          </WidgetCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <WidgetCard tone="neutral" title="Hoeveel ze van elkaar verschillen" bodyClassName="border-t border-line px-4 py-2">
              <ul className="divide-y divide-line/70 text-[12.5px]">
                {vergelijking.differences.map((verschil) => (
                  <li key={`${verschil.a}-${verschil.b}`} className="flex justify-between gap-2 py-1.5">
                    <span>
                      {naamVan(vergelijking.candidates[verschil.a])} en {naamVan(vergelijking.candidates[verschil.b])}
                    </span>
                    <span className="tabular font-semibold">{verschil.changedDutyDays} dienstdagen anders</span>
                  </li>
                ))}
              </ul>
            </WidgetCard>
            <WidgetCard tone="neutral" title="Zware overgangen" subtitle="Per kandidaat, per rooster, regel en dag" bodyClassName="border-t border-line px-4 py-2">
              <ul className="divide-y divide-line/70 text-[12px]">
                {vergelijking.candidates.map((kaart, index) => (
                  <li key={kaart.id} className="py-1.5">
                    <p className="font-semibold text-ink">{naamVan(kaart)}</p>
                    {vergelijking.heavyTransitions[index].length === 0 ? (
                      <p className="text-ink-muted">Geen.</p>
                    ) : (
                      <ul className="mt-0.5 space-y-0.5">
                        {vergelijking.heavyTransitions[index].map((overgang) => (
                          <li key={`${overgang.rosterCode}-${overgang.lineNumber}-${overgang.weekday}`}>
                            <Link
                              href={`/roostercommissie/simulatie/${kaart.id}/${overgang.rosterCode}?regel=${overgang.lineNumber}`}
                              className="underline"
                            >
                              {overgang.rosterCode} regel {overgang.lineNumber}, {WEEKDAY_SHORT[overgang.weekday - 1]}
                            </Link>{" "}
                            <span className="text-ink-muted">
                              {overgang.fromCode} → {overgang.toCode} ({overgang.label})
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </WidgetCard>
          </div>
        </div>
      )}
    </RosterCommitteeShell>
  );
}

function RoosterCel({ tegel }: { tegel: import("@/server/services/candidate-results-service").RosterTile }) {
  return (
    <span className="block space-y-0.5 text-[11.5px]">
      <span className="flex items-center gap-1.5">
        <UrenStip afwijking={tegel.deviationMinutes} />
        <span className="tabular font-semibold text-ink">{tegel.averageWeek}</span>
        <span className="tabular text-ink-muted">({afwijkingTekst(tegel.deviationMinutes)})</span>
      </span>
      <span className="tabular block text-ink-muted">
        V{tegel.early} L{tegel.late} N{tegel.night} R{tegel.shunting} · weekend {tegel.weekendDuties}
      </span>
      <span className="flex items-center gap-1.5">
        <Nachtreeksen tegel={tegel} />
        {tegel.heavyTransitions > 0 ? (
          <span className="font-semibold text-state-warn">{tegel.heavyTransitions} zwaar</span>
        ) : null}
      </span>
    </span>
  );
}
