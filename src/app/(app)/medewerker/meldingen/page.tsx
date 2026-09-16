import Link from "next/link";
import type { NotificationCategory } from "@/lib/generated/prisma/enums";
import { listNotifications, unreadCount } from "@/server/services/notification-service";
import { EmployeeShell } from "@/components/layout/area-shell";
import { ActionForm } from "@/components/ui/action-form";
import { Badge, EmptyState, WidgetCard } from "@/components/ui/primitives";
import { BellIcon } from "@/components/ui/icons";
import { alleMeldingenGelezenAction, meldingGelezenAction } from "../acties";

export const dynamic = "force-dynamic";

/**
 * Het meldingenoverzicht.
 *
 * ## Waarom een melding altijd ergens heen wijst
 *
 * Een melding die alleen zegt dát er iets is gebeurd, verplaatst het werk naar
 * de lezer: die moet zelf gaan zoeken. Elke melding hier draagt daarom het pad
 * naar het onderwerp — een ruilverzoek gaat naar dát verzoek, niet naar een
 * algemeen ruiloverzicht.
 *
 * ## Waarom er geen verwijderknop is
 *
 * Meldingen zijn het spoor van wat er met iemands rooster is gebeurd. Ze
 * verdwijnen na hun bewaartermijn, niet omdat iemand ze wegklikt. Gelezen
 * markeren kan wel: dat is wat de teller in de kop bijhoudt.
 */

const FILTERS: readonly { readonly key: string; readonly label: string; readonly category?: NotificationCategory }[] = [
  { key: "alles", label: "Alles" },
  { key: "ongelezen", label: "Ongelezen" },
  { key: "ruilingen", label: "Ruilingen", category: "RUILING" },
  { key: "diensten", label: "Beschikbare diensten", category: "BESCHIKBARE_DIENST" },
  { key: "rooster", label: "Rooster", category: "ROOSTER" },
  { key: "dienstindeling", label: "Dienstindeling", category: "DIENSTINDELING" },
  { key: "systeem", label: "Systeem", category: "SYSTEEM" },
];

export default async function Meldingen({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;
  const actief = FILTERS.find((entry) => entry.key === filter) ?? FILTERS[0];

  const [{ items, total }, ongelezen] = await Promise.all([
    listNotifications({
      onlyUnread: actief.key === "ongelezen",
      category: actief.category,
      limit: 50,
    }),
    unreadCount(),
  ]);

  return (
    <EmployeeShell
      activeHref="/medewerker/meldingen"
      header={{
        title: "Meldingen",
        subtitle:
          ongelezen === 0
            ? "Alles gelezen"
            : `${ongelezen} ongelezen ${ongelezen === 1 ? "melding" : "meldingen"}`,
        notificationCount: ongelezen,
      }}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {FILTERS.map((entry) => (
          <Link
            key={entry.key}
            href={`/medewerker/meldingen${entry.key === "alles" ? "" : `?filter=${entry.key}`}`}
            aria-current={entry.key === actief.key ? "page" : undefined}
            className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
              entry.key === actief.key
                ? "border-ink bg-surface-2 text-ink-strong"
                : "border-line text-ink-muted"
            }`}
          >
            {entry.label}
          </Link>
        ))}
        {ongelezen > 0 && (
          <span className="ml-auto">
            <ActionForm
              action={alleMeldingenGelezenAction}
              submitLabel="Alles gelezen"
              variant="secondary"
              compact
            >
              <span />
            </ActionForm>
          </span>
        )}
      </div>

      <WidgetCard
        icon={<BellIcon size={18} />}
        title={`${actief.label} (${total})`}
        subtitle="Nieuwste eerst."
      >
        {items.length === 0 ? (
          <EmptyState>Geen meldingen in deze categorie.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((melding) => (
              <li key={melding.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[13px] font-semibold text-ink-strong">
                      {melding.readAt === null && (
                        // Niet alleen een kleur: ook een woord, voor wie kleur
                        // niet ziet of een schermlezer gebruikt.
                        <Badge tone="info">nieuw</Badge>
                      )}
                      {melding.title}
                    </p>
                    <p className="mt-0.5 text-[12px] text-ink">{melding.message}</p>
                    <p className="mt-1 text-[11px] text-ink-muted">
                      {melding.createdAt.toLocaleString("nl-NL")}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {melding.actionPath && (
                      <Link
                        href={melding.actionPath}
                        className="inline-flex items-center rounded-md border border-line px-2.5 py-1 text-xs font-semibold"
                      >
                        Bekijken
                      </Link>
                    )}
                    {melding.readAt === null && (
                      <ActionForm
                        action={meldingGelezenAction}
                        submitLabel="Gelezen"
                        variant="secondary"
                        compact
                      >
                        <input type="hidden" name="notificationId" value={melding.id} />
                      </ActionForm>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </WidgetCard>
    </EmployeeShell>
  );
}
