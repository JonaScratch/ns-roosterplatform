import "server-only";
import { currentActor } from "@/server/auth/session";
import { locationScopeFor } from "@/server/security/location-scope";

/**
 * De standplaatskeuze.
 *
 * ## Wat dit is en vooral wat het niet is
 *
 * Een keuzelijst die de pagina opnieuw opvraagt met een andere standplaats in
 * de zoekparameters. Meer niet. De keuze wordt op de server opnieuw getoetst —
 * zie `locationScopeFor` — dus dit onderdeel bepaalt niets, het toont alleen
 * wat er te kiezen valt. Verdwijnt deze lijst, dan verandert er niets aan wat
 * iemand mag zien.
 *
 * Voor wie niet mag wisselen staat er geen keuzelijst maar zijn standplaats.
 * Dat is eerlijker dan een lijst met één optie: die suggereert dat er meer te
 * kiezen viel.
 */
export async function LocationSelector({ requested }: { requested?: string | null }) {
  const actor = await currentActor();
  if (!actor) {
    return null;
  }
  const scope = await locationScopeFor(actor, requested);

  if (!scope.canSwitch) {
    return (
      <p className="text-[11px] text-ink-muted">
        Standplaats <span className="font-mono">{scope.code}</span>
      </p>
    );
  }

  return (
    <form method="get" className="flex items-center gap-2">
      <label className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
        Standplaats
        <select
          name="standplaats"
          defaultValue={scope.code}
          className="rounded border border-line bg-surface px-1.5 py-0.5 text-[11px]"
        >
          {scope.available.map((location) => (
            <option key={location.code} value={location.code}>
              {location.code} — {location.name}
              {location.enabled ? "" : " (niet ingericht)"}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="rounded border border-line px-2 py-0.5 text-[11px] font-semibold text-ink hover:bg-surface-2"
      >
        Tonen
      </button>
      {scope.denied && (
        <span className="text-[11px] text-amber-700">
          Die standplaats is niet beschikbaar; {scope.code} wordt getoond.
        </span>
      )}
    </form>
  );
}
