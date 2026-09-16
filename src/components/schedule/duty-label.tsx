import { formatCalendarDate, formatMinuteOfDay } from "@/domain/time";
import { Badge } from "@/components/ui/primitives";

/**
 * Weergave van diensten en roosterposities.
 *
 * Kleur draagt hier betekenis: een dienstsoort is overal in de applicatie
 * dezelfde tint. Daarom staat de vertaling van soort naar kleur op één plek en
 * niet in elke tabel opnieuw.
 */

const KIND_TONE: Record<string, "info" | "neutral" | "warn" | "ok"> = {
  VROEG: "ok",
  LAAT: "info",
  NACHT: "warn",
  RESERVE: "neutral",
  RANGEER: "neutral",
};

const KIND_LABEL: Record<string, string> = {
  VROEG: "Vroeg",
  LAAT: "Laat",
  NACHT: "Nacht",
  RESERVE: "Reserve",
  RANGEER: "Rangeer",
};

export function DutyKinds({ kinds }: { kinds: readonly string[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {kinds.map((kind) => (
        <Badge key={kind} tone={KIND_TONE[kind] ?? "neutral"}>
          {KIND_LABEL[kind] ?? kind}
        </Badge>
      ))}
    </span>
  );
}

const POSITION_LABEL: Record<string, string> = {
  DUTY: "Dienst",
  // Uitgeschreven, omdat "RES" en "reservedienst uit de 600-serie" twee
  // verschillende dingen zijn en de interface dat verschil moet dragen.
  RES: "RES-positie",
  RUST: "Rustdag",
  VERLOF: "Verlof",
  OPLEIDING: "Opleiding",
};

/**
 * De positie van een roosterdag.
 *
 * Ook een gewone dienstdag krijgt een label. Dat oogt overbodig naast de
 * dienstcode ernaast, maar een kolom die bij de helft van de rijen leeg blijft
 * leest in een dichte tabel als ontbrekende gegevens in plaats van als "geen
 * bijzonderheden".
 */
export function PositionLabel({ positionType }: { positionType: string }) {
  if (positionType === "DUTY") {
    return <span className="text-ink-muted">Dienst</span>;
  }
  return (
    <Badge tone={positionType === "RES" ? "info" : "neutral"}>
      {POSITION_LABEL[positionType] ?? positionType}
    </Badge>
  );
}

export function DutyTimes({ start, end }: { start: number; end: number }) {
  return (
    <span className="tabular whitespace-nowrap">
      {formatMinuteOfDay(start)} – {formatMinuteOfDay(end)}
    </span>
  );
}

export function DateLabel({ date }: { date: string }) {
  return <span className="whitespace-nowrap">{formatCalendarDate(date)}</span>;
}
