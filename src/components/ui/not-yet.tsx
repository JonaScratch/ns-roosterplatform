import type { ReactNode } from "react";
import { Alert, WidgetCard } from "./primitives";

/**
 * Een onderdeel dat in het ontwerp staat maar in deze fase niet gebouwd is.
 *
 * Bewust een eigen component en niet een lege pagina met "coming soon". Wat een
 * beheerder of planner hier moet kunnen lezen is drie dingen: wat het onderdeel
 * gaat doen, waarom het er nog niet is, en waar het wél al werkt. Een scherm
 * dat alleen "binnenkort" zegt, kost iemand een supportvraag.
 *
 * Zulke schermen staan in het menu omdat de navigatiestructuur uit de ontwerpen
 * behouden blijft; ze doen alsof ze niets kunnen, precies omdat ze niets kunnen.
 */
export function NotYetBuilt({
  title,
  purpose,
  reason,
  alternatives,
}: {
  title: string;
  /** Wat dit onderdeel straks doet. */
  purpose: string;
  /** Waarom het er nu nog niet is. */
  reason: string;
  /** Waar het werk nu wél gedaan kan worden. */
  alternatives?: ReactNode;
}) {
  return (
    <div className="max-w-3xl">
      <WidgetCard title={title} subtitle="Nog niet gebouwd in deze ontwikkelfase">
        <div className="space-y-3 py-3">
          <p className="text-[13px] text-ink">{purpose}</p>
          <Alert tone="neutral" title="Waarom het er nog niet is">
            {reason}
          </Alert>
          {alternatives && (
            <Alert tone="info" title="Wat nu al kan">
              {alternatives}
            </Alert>
          )}
        </div>
      </WidgetCard>
    </div>
  );
}
