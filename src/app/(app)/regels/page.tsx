import {
  ATTENTION_LABEL,
  EFFECT_LABELS,
  RULE_GROUPS,
  attentionNotice,
  groupForRule,
  ruleEffect,
} from "@/domain/rule-presentation";
import { requirePermission } from "@/server/security/authorize";
import { PERMISSIONS } from "@/server/security/permissions";
import { activeRuleset, isReleasedForProduction } from "@/server/rules-engine";
import type { RuleDefinition } from "@/server/rules-engine/ruleset/types";
import { SharedShell } from "@/components/layout/area-shell";
import { Alert, Badge, StatusDot, WidgetCard } from "@/components/ui/primitives";
import { BookIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * De regelcatalogus, zoals de Rooster Commissie hem leest.
 *
 * ## Wat er is veranderd en waarom
 *
 * De vorige versie toonde één tabel van 71 regels met bij elke regel de
 * technische identificatie, de laag, de juridische status en een gekleurde
 * badge. Dat is alles wat je nodig hebt om een beslissing te verantwoorden, en
 * precies niets van wat je nodig hebt om te begrijpen waarom een regel bestaat.
 * Zestig van de eenenzeventig regels droegen dezelfde oranje badge; daarmee
 * waarschuwde die badge nergens meer voor.
 *
 * Nu staat het onderwerp voorop, in zes groepen. De technische gegevens zijn
 * niet weg — ze staan achter "Technische gegevens" per regel, en volledig in
 * Beheer. Er is niets uit het regelbestand verdwenen; alleen de volgorde van
 * tonen is anders.
 *
 * ## Waarom de simulatiestatus nu één regel is
 *
 * Dat het regelbestand nog niet formeel is bevestigd, is één feit over het hele
 * bestand. Het hoorde bovenaan te staan, één keer, en niet bij elke regel
 * opnieuw. De strekking is niet afgezwakt: er staat nog steeds dat geen enkele
 * uitkomst een juridisch oordeel is.
 *
 * ## Waarom de ontbrekende regelpakketten hier niet meer worden opgesomd
 *
 * Dit scherm is bereikbaar vanuit elke gewone werkomgeving (het Help-icoon in
 * de kop en de voettekst). De volledige lijst van ontbrekende regelpakketten,
 * met titel en reden per pakket, staat onveranderd op Admin > Regelbronnen —
 * de plek voor wie de status moet beoordelen, niet voor wie gewoon een dienst
 * wil opzoeken.
 */
export default async function Regelcatalogus() {
  await requirePermission(PERMISSIONS.RULES_READ);

  const ruleset = activeRuleset();
  const released = isReleasedForProduction(ruleset);

  const perGroep = new Map<string, RuleDefinition[]>();
  for (const rule of ruleset.rules) {
    const groep = groupForRule(rule);
    perGroep.set(groep, [...(perGroep.get(groep) ?? []), rule]);
  }

  const blokkerend = perGroep.get("TE_BEVESTIGEN")?.length ?? 0;

  return (
    <SharedShell
      activeHref="/regels"
      header={{
        title: "Regels en kaders",
        subtitle: "Waar de roosterbeslissingen aan worden getoetst",
      }}
    >
      {/* Eén compacte statusregel in plaats van een scherm vol waarschuwingen. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line bg-surface px-3 py-2">
        <StatusDot tone={released ? "ok" : "warn"}>
          {released ? "Vrijgegeven voor productieplanning" : "Simulatie"}
        </StatusDot>
        <span className="text-[12px] text-ink-muted">
          {ruleset.rules.length} regels
          {blokkerend > 0 ? `, waarvan ${blokkerend} nog te bevestigen` : ""}
        </span>
        <span className="text-[12px] text-ink-muted">
          Regelbestand <span className="font-mono text-[11px]">{ruleset.version}</span>
        </span>
      </div>

      {!released && (
        <Alert tone="neutral" title="Geen enkele uitkomst is een juridisch oordeel">
          De regels worden echt toegepast en beslissingen worden echt geblokkeerd — alleen niet als
          wettelijk oordeel, maar als toetsing aan de regels die hier staan.
        </Alert>
      )}

      <div className="mt-4 space-y-4">
        {RULE_GROUPS.map((groep) => {
          const regels = (perGroep.get(groep.id) ?? []).sort((een, ander) =>
            een.title.localeCompare(ander.title, "nl"),
          );
          if (regels.length === 0) {
            return null;
          }
          return (
            <WidgetCard
              key={groep.id}
              icon={<BookIcon size={18} />}
              tone={groep.id === "TE_BEVESTIGEN" ? "warn" : "rc"}
              title={`${groep.title} (${regels.length})`}
              subtitle={groep.intro}
              bodyClassName="border-t border-line"
            >
              <ul className="divide-y divide-line">
                {regels.map((rule) => (
                  <Regel key={`${rule.id}-${rule.source.document}`} rule={rule} />
                ))}
              </ul>
            </WidgetCard>
          );
        })}
      </div>
    </SharedShell>
  );
}

/**
 * Eén regel: eerst wat hij betekent, dan pas waar hij vandaan komt.
 *
 * De technische identificatie staat niet meer als eerste informatie. Wie hem
 * nodig heeft — voor een vraag over een afgekeurde beslissing — klapt het detail
 * open; wie hem niet nodig heeft, wordt er niet mee opgehouden.
 */
function Regel({ rule }: { rule: RuleDefinition }) {
  const melding = attentionNotice(rule.status);
  const effect = ruleEffect(rule);

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-ink">{rule.title}</span>
        <span className="flex items-center gap-2">
          {rule.category === "HARD_CONSTRAINT" ? (
            <Badge tone="neutral">Harde grens</Badge>
          ) : rule.category === "SOFT_CONSTRAINT" ? (
            <Badge tone="neutral">Afweging</Badge>
          ) : (
            <Badge tone="neutral">Doel</Badge>
          )}
          <span className="text-[12px] font-semibold tabular text-ink">{describeValue(rule)}</span>
        </span>
      </div>

      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{rule.rationale}</p>

      {melding && (
        <div className="mt-2 rounded-lg border border-state-warn/40 bg-state-warn-soft px-3 py-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-state-warn">
            {ATTENTION_LABEL}
          </span>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink">{melding}</p>
        </div>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-[11.5px] text-ink-muted hover:text-ink">
          Technische gegevens
        </summary>
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-[11.5px] sm:grid-cols-[10rem_1fr]">
          <dt className="text-ink-muted">Regelcode</dt>
          <dd className="font-mono text-[11px] text-ink">{rule.id}</dd>

          <dt className="text-ink-muted">Bron</dt>
          <dd className="text-ink">
            {rule.source.documentTitle}
            {rule.source.article ? `, art. ${rule.source.article}` : ""}
            {rule.source.paragraph ? ` — ${rule.source.paragraph}` : ""}
          </dd>

          <dt className="text-ink-muted">Laag</dt>
          <dd className="font-mono text-[11px] text-ink">{rule.source.layer}</dd>

          <dt className="text-ink-muted">Bronstatus</dt>
          <dd className="font-mono text-[11px] text-ink">{rule.status}</dd>

          <dt className="text-ink-muted">Werking</dt>
          <dd className="text-ink">{EFFECT_LABELS[effect]}</dd>

          <dt className="text-ink-muted">Reikwijdte</dt>
          <dd className="text-ink">{describeScope(rule)}</dd>

          <dt className="text-ink-muted">Geldig</dt>
          <dd className="text-ink">
            {rule.source.effectiveFrom} t/m {rule.source.contractualEnd ?? "onbepaald"}
            {rule.source.contractualEnd
              ? rule.source.renewalRule.kind === "TACIT_RENEWAL"
                ? " — verlengt stilzwijgend; bepalingen blijven gelden tot een opvolger"
                : " — geen verlenging afgesproken"
              : ""}
          </dd>

          {rule.validatedBy && (
            <>
              <dt className="text-ink-muted">Bevestigd door</dt>
              <dd className="text-ink">
                {rule.validatedBy}, {rule.validatedAt}
              </dd>
            </>
          )}

          {rule.note && (
            <>
              <dt className="text-ink-muted">Aantekening</dt>
              <dd className="text-ink">{rule.note}</dd>
            </>
          )}
        </dl>
      </details>
    </li>
  );
}

/** Voor wie deze regel geldt. "Iedereen" is hier een uitspraak, geen leegte. */
function describeScope(rule: RuleDefinition): string {
  const delen: string[] = [
    rule.scope.employeeGroups === "ALL"
      ? "alle functiegroepen"
      : rule.scope.employeeGroups.join(", "),
  ];
  if (rule.scope.companies !== "ALL") {
    delen.push(rule.scope.companies.join(", "));
  }
  if (rule.scope.locations !== "ALL") {
    delen.push(rule.scope.locations.join(", "));
  }
  return delen.join(" · ");
}

/**
 * De waarde, of de reden dat er geen is.
 *
 * Een leeg vakje zou als "geen beperking" gelezen worden. Dat is precies de
 * verwarring die dit hele regelbestand moet uitsluiten.
 */
function describeValue(rule: RuleDefinition): string {
  if (rule.value === null) {
    return "niet aangeleverd";
  }
  switch (rule.unit) {
    case "HOURS":
      return `${rule.value} uur`;
    case "MINUTES":
      return `${rule.value} min`;
    case "COUNT":
      return String(rule.value);
    case "RATIO":
      return rule.value.toFixed(2);
    case "NONE":
      return "van toepassing";
  }
}
