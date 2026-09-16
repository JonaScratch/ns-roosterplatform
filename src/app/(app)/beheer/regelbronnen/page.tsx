import Link from "next/link";
import { EFFECT_LABELS, ruleEffect } from "@/domain/rule-presentation";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { activeRuleset, isReleasedForProduction, rulesEngine } from "@/server/rules-engine";
import { BLOCKING_STATUSES, type RuleStatus } from "@/server/rules-engine/ruleset/types";
import { AdminShell } from "@/components/layout/area-shell";
import { Alert, Badge, type Tone, WidgetCard } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";

export const dynamic = "force-dynamic";

/**
 * De technische bronstatus van elke regel — voor Beheer.
 *
 * ## Waarom dit een eigen scherm is
 *
 * De Rooster Commissie kijkt naar regels om te begrijpen waarom iets mag of
 * niet mag. Beheer kijkt naar dezelfde regels om te zien of het regelbestand
 * klopt: welke laag, welke status, welk artikel, wie het heeft bevestigd. Dat
 * zijn twee vragen, en één tabel die beide probeert te beantwoorden, doet het
 * voor allebei half. Dit scherm is uitsluitend voor Beheer; de vereenvoudigde
 * zakelijke weergave voor de Rooster Commissie staat op `/regels` en verandert
 * hier niet mee.
 *
 * Er wordt hier niets weggelaten. Wat op het RC-scherm achter "Technische
 * gegevens" staat, staat hier volledig en naast elkaar, zodat een afwijking in
 * één oogopslag te zien is in plaats van eenenzeventig keer openklappen.
 *
 * ## Waarom de zakelijke titel als eerste kolom staat
 *
 * Wie dit scherm opent om uit te zoeken waarom een rooster iets weigert, zoekt
 * op wat de regel dóét — niet op de code waarmee de regelmotor hem intern
 * aanroept. De regelcode staat er nog steeds, alleen niet meer eerst.
 */

const STATUS_LABELS: Record<RuleStatus, string> = {
  VALIDATED: "Bevestigd door NS",
  SOURCE_TRANSCRIBED: "Overgenomen uit bron",
  UNVALIDATED_LOCAL_PARAMETER: "Lokale waarde ontbreekt",
  NEEDS_POLICY_VALIDATION: "Beleidsbesluit nodig",
  POLICY_PENDING: "Nog niet uitgewerkt",
  // Was "Bron laat meerdere lezingen toe": correct, maar leest als een
  // vaststelling over de bron en niet als wat een lezer ermee moet doen. De
  // ruwe status staat nog steeds letterlijk onder het label.
  UNRESOLVED: "Interpretatie vereist",
  NOT_SUPPLIED: "Niet aangeleverd",
};

const STATUS_TONE: Record<RuleStatus, Tone> = {
  VALIDATED: "ok",
  SOURCE_TRANSCRIBED: "neutral",
  UNVALIDATED_LOCAL_PARAMETER: "error",
  NEEDS_POLICY_VALIDATION: "error",
  POLICY_PENDING: "error",
  UNRESOLVED: "error",
  NOT_SUPPLIED: "error",
};

/**
 * Regels die wel in het regelbestand staan maar nergens in de toepassende
 * code worden nagerekend — gemeten met `npm run verify:rule-coverage` op
 * 2026-09-06 (fase-P-rapport, sectie F). Dit scherm laat deze momentopname
 * zien voor overzicht; het regelbestand zelf kan intussen zijn gewijzigd, en
 * bij twijfel is dat script de bron van waarheid, niet deze lijst.
 */
const IMPLEMENTATION_GAP_RULE_IDS: ReadonlySet<string> = new Set([
  "RT_PREFERRED_WINDOW_WEEKS",
  "HOLIDAY_ATTACHED_MIN",
  "HOLIDAY_DETACHED_MIN",
  "RO_DVP_DETACHED_MIN",
  "RO_DVP_COMBINED_MIN",
  "PARTTIME_DASH_DAY_MIN",
  "WTV_DAY_LATEST_START",
  "WTV_DAYS_PER_YEAR_36H",
  "WITHDRAWN_WTV_GRANT_WITHIN_DAYS",
  "REGIO_WEST_WEEKEND_TARGET",
  "DORDRECHT_ROSTER_LINE_DIVISOR",
  "REGIO_WEST_WTV_INTERVAL_WEEKS",
  "NEW_DRIVER_PROTECTION_YEARS",
  "PLAN_ROSTER_OVERFLOW_LIMIT",
]);

type Filter = "ALLE" | "OPEN" | "CAO" | "REGIO_WEST" | "LOKAAL" | "PRODUCT_POLICY" | "GAPS";

const FILTERS: readonly { key: Filter; label: string }[] = [
  { key: "ALLE", label: "Alle" },
  { key: "OPEN", label: "Openstaande issues" },
  { key: "CAO", label: "CAO" },
  { key: "REGIO_WEST", label: "Regio West" },
  { key: "LOKAAL", label: "Lokale regels" },
  { key: "PRODUCT_POLICY", label: "Product policy" },
  { key: "GAPS", label: "Implementation gaps" },
];

export default async function Regelbronnen({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  await requirePermission(PERMISSIONS.SYSTEM_READ);
  const { filter: filterRuw } = await searchParams;
  const filter: Filter = FILTERS.some((entry) => entry.key === filterRuw)
    ? (filterRuw as Filter)
    : "ALLE";

  const ruleset = activeRuleset();
  const engine = rulesEngine();
  const released = isReleasedForProduction(ruleset);

  const alleRegels = [...ruleset.rules].sort((een, ander) => een.id.localeCompare(ander.id));

  const isGap = (id: string) => IMPLEMENTATION_GAP_RULE_IDS.has(id);
  const isOpen = (status: RuleStatus) => BLOCKING_STATUSES.includes(status);

  const rules = alleRegels.filter((rule) => {
    switch (filter) {
      case "OPEN":
        return isOpen(rule.status);
      case "CAO":
        return rule.source.layer === "CAO" || rule.source.layer === "CAO_COMPANY";
      case "REGIO_WEST":
        return rule.source.layer === "REGIONAL";
      case "LOKAAL":
        return rule.source.layer === "LOCAL";
      case "PRODUCT_POLICY":
        return rule.source.layer === "PRODUCT_POLICY";
      case "GAPS":
        return isGap(rule.id);
      default:
        return true;
    }
  });

  const totaal = alleRegels.length;
  const technischToegepast = alleRegels.filter((rule) => !isGap(rule.id)).length;
  const formeelBevestigd = alleRegels.filter((rule) => rule.status === "VALIDATED").length;
  const interpretatieVereist = alleRegels.filter((rule) => rule.status === "UNRESOLVED").length;
  const lokaleParameterOntbreekt = alleRegels.filter(
    (rule) => rule.status === "UNVALIDATED_LOCAL_PARAMETER",
  ).length;
  const beleidsbesluitNodig = alleRegels.filter(
    (rule) => rule.status === "NEEDS_POLICY_VALIDATION" || rule.status === "POLICY_PENDING",
  ).length;
  const implementationGaps = alleRegels.filter((rule) => isGap(rule.id)).length;

  return (
    <AdminShell
      activeHref="/beheer/regelbronnen"
      header={{
        title: "Regelbronnen",
        subtitle: "De herkomst en validatiestatus van elke regel, ongefilterd",
      }}
    >
      <Alert tone={released ? "ok" : "warn"} title={`Regelbestand ${ruleset.version}`}>
        Modus <span className="font-mono text-[11px]">{ruleset.mode}</span>, juridische status{" "}
        <span className="font-mono text-[11px]">{ruleset.legalStatus}</span>. Engine{" "}
        <span className="font-mono text-[11px]">
          {engine.name} {engine.version}
        </span>
        . Elke beslissing wordt vastgelegd met de versie van dit bestand en een vingerafdruk van
        de invoer, zodat zij ook na een wijziging na te rekenen is.
        <br />
        <span className="mt-1 block font-semibold">
          {released
            ? "Formele NS-validatie voltooid."
            : "Formele NS-validatie niet voltooid — production-safe: NO zolang formele goedkeuring ontbreekt."}
        </span>
      </Alert>

      {ruleset.missingPackages.length > 0 && (
        <div className="mt-4">
          <WidgetCard
            tone="warn"
            title={`${ruleset.missingPackages.length} ontbrekende regelpakketten`}
            subtitle="Geen losse waarde maar een heel onderdeel. Wat deze nodig heeft, wordt geblokkeerd."
            bodyClassName="border-t border-line p-4"
          >
            <ul className="space-y-2 text-[12.5px]">
              {ruleset.missingPackages.map((entry) => (
                <li
                  key={entry.id}
                  className="border-b border-line/60 pb-2 last:border-0 last:pb-0"
                >
                  <span className="font-semibold text-ink">{entry.title}</span>
                  <p className="mt-0.5 text-ink-muted">{entry.reason}</p>
                </li>
              ))}
            </ul>
          </WidgetCard>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface p-3 text-[12px] sm:grid-cols-3 lg:grid-cols-7">
        <Samenvattingscijfer label="Totaal regels" waarde={totaal} />
        <Samenvattingscijfer label="Technisch toegepast" waarde={technischToegepast} />
        <Samenvattingscijfer label="Formeel bevestigd" waarde={formeelBevestigd} />
        <Samenvattingscijfer label="Interpretatie vereist" waarde={interpretatieVereist} />
        <Samenvattingscijfer label="Lokale parameter ontbreekt" waarde={lokaleParameterOntbreekt} />
        <Samenvattingscijfer label="Beleidsbesluit nodig" waarde={beleidsbesluitNodig} />
        <Samenvattingscijfer label="Implementation gaps" waarde={implementationGaps} />
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {FILTERS.map((entry) => (
          <Link
            key={entry.key}
            href={entry.key === "ALLE" ? "/beheer/regelbronnen" : `/beheer/regelbronnen?filter=${entry.key}`}
            className={`rounded-full border px-3 py-1 text-[11.5px] font-semibold ${
              filter === entry.key
                ? "border-accent-rc bg-accent-rc-soft text-accent-rc"
                : "border-line bg-surface text-ink-muted hover:bg-canvas"
            }`}
          >
            {entry.label}
          </Link>
        ))}
      </div>

      <div className="mt-4">
        <WidgetCard
          title={`Regels (${rules.length} van ${totaal})`}
          subtitle="Zakelijke titel eerst; de technische regelcode staat ernaast, nooit ervoor."
          bodyClassName="border-t border-line"
        >
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Titel</TH>
                  <TH>Regelcode</TH>
                  <TH>Laag</TH>
                  <TH>Bron</TH>
                  <TH numeric>Waarde</TH>
                  <TH>Werking</TH>
                  <TH>Bronstatus</TH>
                  <TH>Bevestigd</TH>
                </TR>
              </THead>
              <tbody>
                {rules.map((rule) => (
                  <TR key={`${rule.id}-${rule.source.document}`}>
                    <TD>
                      <span className="text-[12px] font-semibold text-ink">{rule.title}</span>
                      {isGap(rule.id) && (
                        <span className="mt-0.5 block">
                          <Badge tone="warn">Implementation gap</Badge>
                        </span>
                      )}
                    </TD>
                    <TD>
                      <span className="font-mono text-[10.5px] text-ink-muted">{rule.id}</span>
                    </TD>
                    <TD>
                      <span className="font-mono text-[10.5px] text-ink-muted">
                        {rule.source.layer}
                      </span>
                    </TD>
                    <TD>
                      <span className="block text-[11.5px]">{rule.source.documentTitle}</span>
                      {rule.source.article && (
                        <span className="block text-[11px] text-ink-muted">
                          art. {rule.source.article}
                          {rule.source.paragraph ? ` — ${rule.source.paragraph}` : ""}
                        </span>
                      )}
                    </TD>
                    <TD numeric>
                      {rule.value === null ? (
                        <span className="text-state-error">ontbreekt</span>
                      ) : (
                        `${rule.value} ${rule.unit.toLowerCase()}`
                      )}
                    </TD>
                    <TD>{EFFECT_LABELS[ruleEffect(rule)]}</TD>
                    <TD>
                      <Badge tone={STATUS_TONE[rule.status]}>{STATUS_LABELS[rule.status]}</Badge>
                      {/* De ruwe waarde erbij: Beheer legt dit scherm naast het
                          regelbestand, en dan is het etiket niet genoeg. */}
                      <span className="mt-0.5 block font-mono text-[10px] text-ink-muted">
                        {rule.status}
                      </span>
                      {rule.note && (
                        <span className="mt-1 block text-[11px] text-ink-muted">{rule.note}</span>
                      )}
                    </TD>
                    <TD>
                      {rule.validatedBy ? (
                        <span className="text-[11.5px]">
                          {rule.validatedBy}
                          <span className="block text-[11px] text-ink-muted">
                            {rule.validatedAt}
                          </span>
                        </span>
                      ) : (
                        <span className="text-[11px] text-ink-muted">Nog niet formeel bevestigd</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </div>
        </WidgetCard>
      </div>
    </AdminShell>
  );
}

function Samenvattingscijfer({ label, waarde }: { label: string; waarde: number }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="tabular text-[16px] font-semibold text-ink-strong">{waarde}</p>
    </div>
  );
}
