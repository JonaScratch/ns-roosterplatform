import "server-only";
import { didContactForActor } from "@/server/services/location-contact-service";
import { WidgetCard } from "@/components/ui/primitives";
import { MailIcon } from "@/components/ui/icons";

/**
 * Contact met de dienstindeling.
 *
 * ## Waarom hier twee knoppen staan
 *
 * De eerste opent Outlook op het web, de tweede de standaardmailclient. Welke
 * van de twee werkt, hangt af van de werkplek: op een NS-laptop is dat Outlook,
 * op een telefoon meestal de mailapp. Eén knop die het bij de helft van de
 * mensen niet doet, is erger dan twee knoppen.
 *
 * ## Wat er niet gebeurt
 *
 * De applicatie verstuurt niets. Er opent een concept met een leeg sjabloon; de
 * medewerker schrijft, leest en verzendt zelf. Er wordt ook niets ingevuld wat
 * hij niet zelf zou opschrijven — geen roosterhistorie, geen reden van
 * afwezigheid.
 */
export async function DidContactCard() {
  const contact = await didContactForActor();
  if (!contact) {
    return null;
  }

  return (
    <WidgetCard
      icon={<MailIcon size={18} />}
      tone="info"
      title="Contact Dienstindeling"
      subtitle={`${contact.locationCode} — ${contact.locationName}`}
    >
      {!contact.configured ? (
        <p className="py-2 text-[12px] text-ink-muted">{contact.notice}</p>
      ) : (
        <>
          <p className="text-[12px] text-ink">
            Heeft u een vraag over uw dienst of operationele indeling? Stel hem rechtstreeks aan
            de dienstindeling van uw standplaats.
          </p>
          <p className="mt-2 font-mono text-[12px]">{contact.email}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={contact.outlookUrl ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-md border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-2"
            >
              Open in Outlook
            </a>
            <a
              href={contact.mailtoUrl ?? "#"}
              className="inline-flex items-center rounded-md border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-2"
            >
              Open in mailprogramma
            </a>
          </div>
          <p className="mt-2 text-[11px] text-ink-muted">
            Er wordt niets verzonden zonder dat u het zelf doet. Het bericht opent als concept
            met onderwerp “{contact.subject}”.
          </p>
        </>
      )}
    </WidgetCard>
  );
}
