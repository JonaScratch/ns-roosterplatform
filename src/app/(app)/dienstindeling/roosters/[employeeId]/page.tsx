import Link from "next/link";
import { notFound } from "next/navigation";
import { isoWeekOfDate } from "@/domain/roster-rotation";
import { formatCalendarDate, formatMinuteOfDay, toCalendarDate } from "@/domain/time";
import { monthGrid } from "@/domain/cao-days";
import { PERIOD_LABELS, tryClassifyDuty } from "@/domain/duty-classification";
import { prisma } from "@/server/data/prisma";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { locationScopeFor } from "@/server/security/location-scope";
import { membershipHistory } from "@/server/services/roster-membership-service";
import { currentAndNextRule, analyseTransfer } from "@/server/services/roster-transfer-service";
import { projectPersonalRoster, type ProjectedDay } from "@/server/services/personal-roster-projection-service";
import { DutyAssignmentShell } from "@/components/layout/area-shell";
import { ActionForm } from "@/components/ui/action-form";
import { Alert, Badge, EmptyState, WidgetCard, inputClass } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { tijdelijkePlaatsingAction, beeindigPlaatsingAction } from "../../acties";

const MAANDNAMEN = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
] as const;

const WEEKDAGEN = ["ma", "di", "wo", "do", "vr", "za", "zo"];

/** "2026-09" → "2026-09-01". Valt terug op de huidige maand bij een ongeldige waarde. */
function normaliseerMaand(ruw: string | undefined, vandaag: string): string {
  if (ruw && /^\d{4}-\d{2}$/.test(ruw)) {
    return ruw;
  }
  return vandaag.slice(0, 7);
}

function volgendeMaand(maand: string, delta: number): string {
  const [jaar, maandNummer] = maand.split("-").map(Number);
  const totaal = jaar * 12 + (maandNummer - 1) + delta;
  const nieuwJaar = Math.floor(totaal / 12);
  const nieuweMaand = (totaal % 12) + 1;
  return `${nieuwJaar}-${String(nieuweMaand).padStart(2, "0")}`;
}

function maandLabel(maand: string): string {
  const [jaar, maandNummer] = maand.split("-").map(Number);
  return `${MAANDNAMEN[maandNummer - 1]} ${jaar}`;
}

const STRUCTURELE_LABEL: Record<string, string> = {
  RUST: "R",
  WR: "WTV",
  CO: "CO",
  RES: "RES",
  VERLOF: "Verlof",
  OPLEIDING: "Opleiding",
};

/** Achtergrond van een dagvakje: wit voor een concrete dienst, een kleur voor de rest. */
function dagKleur(dag: ProjectedDay | undefined): string {
  if (!dag || !dag.determinate) {
    // Rood accent: een bevinding, geen aanname. Zie PersonalRosterProjectionService.
    return "border-state-error/40 bg-state-error-soft";
  }
  if (dag.sourceType === "OPERATIONELE_INVULLING" || dag.sourceType === "RUILING") {
    return "border-state-warn/40 bg-state-warn-soft";
  }
  if (dag.sourceType === "TIJDELIJKE_PLAATSING") {
    return "border-state-warn/40 bg-state-warn-soft";
  }
  if (dag.effectiveSlot === "DUTY") {
    return "border-line-strong bg-surface";
  }
  if (dag.effectiveSlot === "RES") {
    return "border-state-info/40 bg-state-info-soft";
  }
  // R, WR, CO en andere vrije structurele dagen.
  return "border-state-ok/40 bg-state-ok-soft";
}

export const dynamic = "force-dynamic";

/**
 * Eén medewerker: waar hij staat, waar hij heen kan, en wat dat betekent.
 *
 * ## Waarom de startregels hier worden voorgerekend
 *
 * Een keuzelijst van "regel 1 tot en met 12" laat de vraag of het kán aan de
 * planner. Die weet niet uit zijn hoofd welke dienst regel 7 op maandag
 * oplevert en hoeveel rust daarvoor overblijft. Het systeem weet dat wel, dus
 * rekent het per regel voor: mag het, en sluit het aan.
 *
 * ## Waarom de permanente plaatsing niet wordt aangeraakt
 *
 * Een tijdelijke plaatsing legt zich eroverheen. De permanente rotatie loopt
 * eronder door, zodat na afloop vaststaat op welke regel iemand terugkomt —
 * niet de regel waar hij vertrok, maar de regel waar de tijd hem gebracht
 * heeft.
 */
export default async function MedewerkerRooster({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<{ doelrooster?: string; vanaf?: string; maand?: string }>;
}) {
  const actor = await requirePermission(PERMISSIONS.ASSIGNMENT_READ);
  const [{ employeeId }, query] = await Promise.all([params, searchParams]);
  const scope = await locationScopeFor(actor, null);

  const employee = await prisma.employee.findFirst({
    // De standplaats zit in de zoekvoorwaarde: een medewerker van een andere
    // standplaats wordt niet gevonden in plaats van gevonden-en-geweigerd.
    where: { id: employeeId, depot: scope.code },
    select: { id: true, employeeNumber: true, rosterProfile: true, depot: true },
  });
  if (!employee) {
    notFound();
  }

  const vandaag = toCalendarDate(new Date());
  const maand = normaliseerMaand(query.maand, vandaag);
  const dagcellen = monthGrid(`${maand}-01`);
  const dagenVanMaand = dagcellen.filter((dag): dag is string => dag !== null);

  const [historie, huidigeRegel, roosters, projectie] = await Promise.all([
    membershipHistory(employee.id),
    currentAndNextRule(employee.id),
    prisma.baseRoster.findMany({
      where: { depot: scope.code, status: { not: "ARCHIVED" } },
      select: { code: true, name: true, _count: { select: { lines: true } } },
      orderBy: { code: "asc" },
    }),
    dagenVanMaand.length > 0
      ? projectPersonalRoster({
          employeeId: employee.id,
          from: dagenVanMaand[0],
          to: dagenVanMaand[dagenVanMaand.length - 1],
        })
      : null,
  ]);
  const projectiePerDag = new Map((projectie?.days ?? []).map((dag) => [dag.date, dag]));

  const actief = historie.filter((plaatsing) => plaatsing.status === "ACTIVE");
  const tijdelijk = actief.find((plaatsing) => plaatsing.placementType === "TEMPORARY");
  const startWeek = query.vanaf ?? isoWeekOfDate(vandaag);

  const analyse = query.doelrooster
    ? await analyseTransfer({
        employeeId: employee.id,
        targetRosterCode: query.doelrooster,
        fromWeek: startWeek,
      })
    : null;

  return (
    <DutyAssignmentShell
      activeHref="/dienstindeling/roosters"
      header={{
        title: `Medewerker ${employee.employeeNumber}`,
        subtitle: `${employee.depot} · profiel ${employee.rosterProfile}`,
      }}
    >
      <p className="mb-3 text-[11px]">
        <Link href="/dienstindeling/roosters" className="text-ink-muted underline">
          ← Medewerkerroosters
        </Link>
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface p-3 text-[12px] sm:grid-cols-4 lg:grid-cols-8">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-ink-muted">Personeelsnr.</p>
          <p className="font-mono font-semibold">{employee.employeeNumber}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-ink-muted">Standplaats</p>
          <p className="font-semibold">{employee.depot}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-ink-muted">Profiel</p>
          <p className="font-semibold">{employee.rosterProfile}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-ink-muted">Basisrooster</p>
          <p className="font-mono font-semibold">{huidigeRegel?.rosterCode ?? "—"}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-ink-muted">Huidige regel</p>
          <p className="font-semibold">{huidigeRegel ? `regel ${huidigeRegel.currentRule}` : "—"}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-ink-muted">Volgende regel</p>
          <p className="font-semibold">{huidigeRegel ? `regel ${huidigeRegel.nextRule}` : "—"}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-ink-muted">Plaatsingssoort</p>
          <p className="font-semibold">
            {huidigeRegel
              ? huidigeRegel.placementType === "TEMPORARY"
                ? "Tijdelijk"
                : "Permanent"
              : "—"}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-ink-muted">Tijdelijke plaatsing</p>
          <p className="font-semibold">
            {tijdelijk
              ? `t/m ${tijdelijk.validUntil ? formatCalendarDate(tijdelijk.validUntil) : "onbepaald"}`
              : "geen"}
          </p>
        </div>
      </div>

      {tijdelijk && (
        <div className="mb-4">
          <Alert tone="warn" title="Tijdelijk rooster actief">
            {tijdelijk.baseRosterCode} ({tijdelijk.baseRosterName}) van{" "}
            {formatCalendarDate(tijdelijk.validFrom)} tot en met{" "}
            {tijdelijk.validUntil ? formatCalendarDate(tijdelijk.validUntil) : "onbepaald"}. Het
            basisrooster loopt eronder door.
            <span className="ml-2 inline-block">
              <ActionForm
                action={beeindigPlaatsingAction}
                submitLabel="Nu beëindigen"
                variant="secondary"
                compact
              >
                <input type="hidden" name="membershipId" value={tijdelijk.id} />
                <input
                  name="reden"
                  placeholder="Reden"
                  required
                  className={`${inputClass} w-40`}
                />
              </ActionForm>
            </span>
          </Alert>
        </div>
      )}

      <div className="mb-4">
        <WidgetCard
          title="Agenda"
          subtitle="De echte roosterprojectie: basisrooster, rotatie, tijdelijke plaatsing, operationele invulling en ruilingen bij elkaar."
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Link
                href={`?maand=${volgendeMaand(maand, -1)}`}
                className="rounded border border-line px-2 py-1 text-[12px] font-semibold hover:bg-canvas"
              >
                ← Vorige
              </Link>
              <Link
                href="."
                className="rounded border border-line px-2 py-1 text-[12px] font-semibold hover:bg-canvas"
              >
                Vandaag
              </Link>
              <Link
                href={`?maand=${volgendeMaand(maand, 1)}`}
                className="rounded border border-line px-2 py-1 text-[12px] font-semibold hover:bg-canvas"
              >
                Volgende →
              </Link>
            </div>
            <p className="text-[13px] font-semibold capitalize text-ink-strong">
              {maandLabel(maand)}
            </p>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {WEEKDAGEN.map((dagnaam) => (
              <div
                key={dagnaam}
                className="pb-1 text-center text-[10.5px] font-semibold uppercase text-ink-muted"
              >
                {dagnaam}
              </div>
            ))}
            {dagcellen.map((datum, index) => {
              if (datum === null) {
                return <div key={`leeg-${index}`} />;
              }
              const dag = projectiePerDag.get(datum);
              const nummer = Number(datum.slice(8, 10));
              const dagdeelRuw = dag?.effectiveDutyCode
                ? tryClassifyDuty(dag.effectiveDutyCode)?.period
                : null;
              // "GEEN" is een geldige classificatie (een zuivere rangeerdienst
              // heeft geen dagdeel) maar geen label dat op elke rangeerdienst
              // hoeft te staan — het voegt niets toe waar VROEG/LAAT/NACHT dat
              // wel doen.
              const dagdeel = dagdeelRuw && dagdeelRuw !== "GEEN" ? PERIOD_LABELS[dagdeelRuw] : null;

              return (
                <div
                  key={datum}
                  className={`flex min-h-[4.5rem] flex-col gap-0.5 rounded-lg border px-1.5 py-1 text-left ${dagKleur(dag)} ${
                    datum === vandaag ? "ring-2 ring-accent-did" : ""
                  }`}
                >
                  <span className="text-[11px] font-semibold text-ink-strong">{nummer}</span>
                  {dag?.effectiveSlot === "DUTY" ? (
                    <>
                      <span className="font-mono text-[11px] font-semibold text-ink-strong">
                        {dag.effectiveDutyCode}
                      </span>
                      {dag.startMinute !== null && dag.endMinute !== null && (
                        <span className="tabular text-[10px] text-ink-muted">
                          {formatMinuteOfDay(dag.startMinute)} – {formatMinuteOfDay(dag.endMinute)}
                        </span>
                      )}
                      {dagdeel && (
                        <span className="text-[9.5px] uppercase text-ink-muted">{dagdeel}</span>
                      )}
                    </>
                  ) : dag && dag.determinate ? (
                    <span className="text-[11px] font-semibold text-ink-strong">
                      {(dag.effectiveSlot && STRUCTURELE_LABEL[dag.effectiveSlot]) ?? dag.effectiveSlot ?? "—"}
                    </span>
                  ) : (
                    <span className="text-[10px] text-state-error">niet te bepalen</span>
                  )}
                  {(dag?.sourceType === "OPERATIONELE_INVULLING" ||
                    dag?.sourceType === "RUILING" ||
                    dag?.sourceType === "TIJDELIJKE_PLAATSING") && (
                    <span className="text-[9px] uppercase text-state-warn">
                      {dag.sourceType === "RUILING"
                        ? "ruiling"
                        : dag.sourceType === "TIJDELIJKE_PLAATSING"
                          ? "tijdelijk"
                          : "operationeel"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap gap-3 text-[10.5px] text-ink-muted">
            <Legenda kleur="bg-surface border-line-strong" label="Concrete dienst" />
            <Legenda kleur="bg-state-ok-soft border-state-ok/40" label="R / WTV / CO" />
            <Legenda kleur="bg-state-info-soft border-state-info/40" label="Reserve" />
            <Legenda kleur="bg-state-warn-soft border-state-warn/40" label="Tijdelijk / operationeel / ruiling" />
            <Legenda kleur="bg-state-error-soft border-state-error/40" label="Niet te bepalen" />
          </div>
        </WidgetCard>
      </div>

      <div className="mb-4">
        <WidgetCard title="Plaatsingen" subtitle="Historie inbegrepen; er wordt niets overschreven.">
          {historie.length === 0 ? (
            <EmptyState>Nog geen plaatsing vastgelegd.</EmptyState>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Rooster</TH>
                  <TH>Soort</TH>
                  <TH numeric>Ankerregel</TH>
                  <TH>Ankerweek</TH>
                  <TH>Geldig</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <tbody>
                {historie.map((plaatsing) => (
                  <TR key={plaatsing.id}>
                    <TD mono>{plaatsing.baseRosterCode}</TD>
                    <TD>
                      {plaatsing.placementType === "TEMPORARY" ? "tijdelijk" : "permanent"}
                    </TD>
                    <TD numeric>{plaatsing.anchorRuleIndex}</TD>
                    <TD mono>{plaatsing.anchorWeek}</TD>
                    <TD>
                      <span className="text-[11px]">
                        {plaatsing.validFrom} — {plaatsing.validUntil ?? "doorlopend"}
                      </span>
                    </TD>
                    <TD>
                      <Badge tone={plaatsing.status === "ACTIVE" ? "ok" : "neutral"}>
                        {plaatsing.status}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </WidgetCard>
      </div>

      <div className="mt-4">
        <WidgetCard
          title="Tijdelijk in een ander rooster plaatsen"
          subtitle="Kies eerst het doelrooster; het systeem rekent daarna de mogelijke startregels voor."
        >
          <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-ink">
              Doelrooster
              <select name="doelrooster" defaultValue={query.doelrooster ?? ""} className={inputClass}>
                <option value="">— kies —</option>
                {roosters.map((roster) => (
                  <option key={roster.code} value={roster.code}>
                    {roster.code} — {roster.name} ({roster._count.lines} regels)
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-ink">
              Startweek
              <input name="vanaf" defaultValue={startWeek} className={inputClass} />
            </label>
            <button
              type="submit"
              className="rounded border border-line px-2 py-1 text-[11px] font-semibold text-ink hover:bg-surface-2"
            >
              Startregels bekijken
            </button>
          </form>

          {analyse && (
            <>
              <p className="mb-2 text-[11px] text-ink-muted">
                Laatste dienst vóór de overgang:{" "}
                {analyse.lastDutyBefore
                  ? `${analyse.lastDutyBefore.code} op ${analyse.lastDutyBefore.date}`
                  : "geen dienst in de dagen ervoor"}
                .
              </p>
              <Table>
                <THead>
                  <TR>
                    <TH numeric>Regel</TH>
                    <TH>Eerste dienst</TH>
                    <TH>Beoordeling</TH>
                    <TH>Toelichting</TH>
                    <TH>Actie</TH>
                  </TR>
                </THead>
                <tbody>
                  {analyse.options.map((optie) => (
                    <TR key={optie.ruleIndex}>
                      <TD numeric>{optie.ruleIndex}</TD>
                      <TD>
                        {optie.firstDutyCode ? (
                          <span className="font-mono text-[11px]">
                            {optie.firstDutyCode} · {optie.firstDutyDate}
                          </span>
                        ) : (
                          <span className="text-[11px] text-ink-muted">geen</span>
                        )}
                      </TD>
                      <TD>
                        <Badge
                          tone={
                            !optie.eligible
                              ? "warn"
                              : optie.suitability?.selfServiceSuitable
                                ? "ok"
                                : "neutral"
                          }
                        >
                          {!optie.eligible
                            ? "niet mogelijk"
                            : optie.suitability?.selfServiceSuitable
                              ? "geschikt"
                              : "aandacht"}
                        </Badge>
                      </TD>
                      <TD>
                        <span className="text-[11px]">
                          {optie.blockingReasons[0] ?? optie.summary}
                        </span>
                      </TD>
                      <TD>
                        {optie.eligible ? (
                          <ActionForm
                            action={tijdelijkePlaatsingAction}
                            submitLabel="Plaatsen"
                            variant="secondary"
                            compact
                          >
                            <input type="hidden" name="employeeId" value={employee.id} />
                            <input
                              type="hidden"
                              name="doelrooster"
                              value={analyse.targetRosterCode}
                            />
                            <input type="hidden" name="startregel" value={optie.ruleIndex} />
                            <input type="hidden" name="vanaf" value={analyse.fromWeek} />
                            <input
                              name="totWeek"
                              placeholder="t/m week"
                              required
                              className={`${inputClass} w-28`}
                            />
                            <input
                              name="reden"
                              placeholder="Reden"
                              required
                              className={`${inputClass} w-36`}
                            />
                          </ActionForm>
                        ) : (
                          <span className="text-[11px] text-ink-muted">—</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </>
          )}
        </WidgetCard>
      </div>
    </DutyAssignmentShell>
  );
}

function Legenda({ kleur, label }: { kleur: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full border ${kleur}`} aria-hidden="true" />
      {label}
    </span>
  );
}
