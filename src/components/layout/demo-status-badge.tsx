import { activeRuleset, environmentStatus } from "@/server/rules-engine";

/**
 * Rustige statusaanduiding voor gewone operationele schermen.
 *
 * ## Waarom dit geen waarschuwing meer is
 *
 * De vroegere banner herhaalde op elk scherm waarom een rooster niet mag
 * worden vastgesteld — nuttig voor wie dat moet beoordelen, maar afleidend
 * voor wie gewoon zijn dienst wil zien. Die volledige toelichting staat nog
 * steeds, ongewijzigd, op Admin > Regelbronnen en Admin > Systeemstatus. Hier
 * blijft alleen de constatering over dat dit een demonstratieomgeving is —
 * geen cijfers, geen regelpakketten, geen productieclaim.
 */
export function DemoStatusBadge() {
  const status = environmentStatus(activeRuleset());

  if (status === "PRODUCTION") {
    return null;
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas px-2.5 py-1 text-[11px] font-medium text-ink-muted">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
      Demonstratieomgeving
    </span>
  );
}
