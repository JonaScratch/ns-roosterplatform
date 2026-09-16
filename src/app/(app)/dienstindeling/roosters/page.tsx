import Link from "next/link";
import { isoWeekOfDate } from "@/domain/roster-rotation";
import { toCalendarDate } from "@/domain/time";
import { prisma } from "@/server/data/prisma";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { locationScopeFor } from "@/server/security/location-scope";
import { currentAndNextRule } from "@/server/services/roster-transfer-service";
import { DutyAssignmentShell } from "@/components/layout/area-shell";
import { Alert, Badge, EmptyState, WidgetCard } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";

export const dynamic = "force-dynamic";

/**
 * Medewerkerroosters.
 *
 * ## Waarom hier twee verschillende acties naast elkaar staan
 *
 * "Een dienst op een reservedag invullen" en "iemand tijdelijk in een ander
 * rooster zetten" lijken op elkaar en zijn het niet. De eerste gaat over één
 * dag en verandert niets aan iemands rooster; de tweede verplaatst hem weken
 * lang naar een andere structuur. Eén knop "wijzigen" die allebei doet, levert
 * vroeg of laat een weekverplaatsing op waar iemand een dagdienst bedoelde.
 *
 * Daarom staan ze op verschillende plekken, met verschillende woorden, en met
 * een uitleg erbij welke wanneer hoort.
 */
export default async function Medewerkerroosters({
  searchParams,
}: {
  searchParams: Promise<{ standplaats?: string; zoek?: string }>;
}) {
  const actor = await requirePermission(PERMISSIONS.ASSIGNMENT_READ);
  const params = await searchParams;
  const scope = await locationScopeFor(actor, params.standplaats ?? null);

  const zoekterm = params.zoek?.trim() ?? "";
  const medewerkers = await prisma.employee.findMany({
    where: {
      depot: scope.code,
      status: "ACTIVE",
      ...(zoekterm ? { employeeNumber: { contains: zoekterm } } : {}),
    },
    select: { id: true, employeeNumber: true, rosterProfile: true },
    orderBy: { employeeNumber: "asc" },
    take: 60,
  });

  const rijen = await Promise.all(
    medewerkers.map(async (medewerker) => ({
      medewerker,
      positie: await currentAndNextRule(medewerker.id),
    })),
  );

  const vandaag = toCalendarDate(new Date());
  const week = isoWeekOfDate(vandaag);

  return (
    <DutyAssignmentShell
      activeHref="/dienstindeling/roosters"
      header={{
        title: "Medewerkerroosters",
        subtitle: `${scope.code} · week ${week} · ${rijen.length} medewerkers`,
      }}
    >
      <div className="mb-4">
        <Alert tone="info" title="Twee verschillende handelingen">
          Eén dienst op een reservedag invullen doet u bij{" "}
          <Link href="/dienstindeling/openstaand" className="underline">
            openstaande diensten
          </Link>
          . Iemand voor meerdere weken in een ánder rooster plaatsen doet u hier: dat is een
          structurele verplaatsing en geen dagindeling. De permanente plaatsing blijft eronder
          doorlopen, zodat na afloop vaststaat op welke regel iemand terugkomt.
        </Alert>
      </div>

      <form method="get" className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
          Personeelsnummer
          <input
            name="zoek"
            defaultValue={zoekterm}
            placeholder="1000…"
            className="rounded border border-line bg-surface px-1.5 py-0.5 text-[11px]"
          />
        </label>
        {params.standplaats && (
          <input type="hidden" name="standplaats" value={params.standplaats} />
        )}
        <button
          type="submit"
          className="rounded border border-line px-2 py-0.5 text-[11px] font-semibold text-ink hover:bg-surface-2"
        >
          Zoeken
        </button>
      </form>

      <WidgetCard
        title="Roosterbezetting per medewerker"
        subtitle="De regel volgt uit de plaatsing en de week; er wordt niets wekelijks bijgewerkt."
      >
        {rijen.length === 0 ? (
          <EmptyState>Geen medewerkers gevonden.</EmptyState>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Personeelsnr.</TH>
                <TH>Profiel</TH>
                <TH>Rooster</TH>
                <TH numeric>Deze week</TH>
                <TH numeric>Volgende week</TH>
                <TH>Soort plaatsing</TH>
                <TH>Actie</TH>
              </TR>
            </THead>
            <tbody>
              {rijen.map(({ medewerker, positie }) => (
                <TR key={medewerker.id}>
                  <TD mono>{medewerker.employeeNumber}</TD>
                  <TD>
                    <span className="text-[11px] text-ink-muted">{medewerker.rosterProfile}</span>
                  </TD>
                  <TD>
                    {positie ? (
                      <span className="font-mono text-[12px]">{positie.rosterCode}</span>
                    ) : (
                      <span className="text-[11px] text-amber-700">geen plaatsing</span>
                    )}
                  </TD>
                  <TD numeric>{positie ? `regel ${positie.currentRule}` : "—"}</TD>
                  <TD numeric>{positie ? `regel ${positie.nextRule}` : "—"}</TD>
                  <TD>
                    {positie ? (
                      <Badge tone={positie.placementType === "TEMPORARY" ? "warn" : "neutral"}>
                        {positie.placementType === "TEMPORARY" ? "tijdelijk" : "permanent"}
                      </Badge>
                    ) : (
                      "—"
                    )}
                    {positie?.validUntil && (
                      <span className="ml-1 text-[11px] text-ink-muted">
                        t/m {positie.validUntil}
                      </span>
                    )}
                  </TD>
                  <TD>
                    <Link
                      href={`/dienstindeling/roosters/${medewerker.id}`}
                      className="text-[11px] underline"
                    >
                      Bekijken
                    </Link>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </WidgetCard>
    </DutyAssignmentShell>
  );
}
