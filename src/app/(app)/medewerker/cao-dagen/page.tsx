import Link from "next/link";
import { caoDaySummary, formatDutchDate } from "@/domain/cao-days";
import { caoDayOverview } from "@/server/services/cao-day-service";
import { EmployeeShell } from "@/components/layout/area-shell";
import { ActionForm } from "@/components/ui/action-form";
import { Alert, Badge, EmptyState, WidgetCard } from "@/components/ui/primitives";
import { TD, TH, THead, Table } from "@/components/ui/table";
import { CalendarCheckIcon, CalendarIcon } from "@/components/ui/icons";
import { caoDagAanvragenAction, caoDagIntrekkenAction } from "../acties";

export const dynamic = "force-dynamic";

const WEEKDAGEN = ["ma", "di", "wo", "do", "vr", "za", "zo"];

/** De korte aanduiding in een kalendervakje. */
const POSITIE_KORT: Record<string, string> = {
  RUST: "R",
  WTV: "WTV",
  RES: "RES",
  WR: "WR",
  CO: "CO",
};

/**
 * CAO-dagen aanvragen.
 *
 * ## Waarom de kalender op de eerste geldige dag opent
 *
 * Een CAO-dag kan niet eerder dan zes weken vooruit. Een kalender die op
 * vandaag begint, laat iemand eerst zes weken doorbladeren langs dagen die
 * allemaal grijs zijn. Deze begint bij de maand waarin de eerste keuze valt.
 *
 * ## Waarom het eigen rooster in de kalender staat
 *
 * "Een dag vrij vragen" is een keuze over een concrete dienst. Zonder die
 * dienst in beeld vraagt iemand vrij van iets waarvan hij niet weet wat het
 * was — en ontdekt hij pas achteraf dat hij zijn tegoed heeft besteed aan een
 * dag waarop hij toch al vrij was. Dagen zonder dienst zijn daarom niet alleen
 * uitgeschakeld; er staat bij waarom.
 *
 * ## Waarom bevestigen een aparte stap is
 *
 * Eén klik in een kalender is te makkelijk voor iets waarvan er twee per jaar
 * zijn. De gekozen dag komt eerst terug met de dienst die eronder ligt; pas de
 * knop daarna vraagt hem echt aan, en de bevestiging verschijnt pas als de
 * database het heeft vastgelegd.
 */
export default async function CaoDagen({ searchParams }: PageProps<"/medewerker/cao-dagen">) {
  const params = await searchParams;
  const gekozen = typeof params.datum === "string" ? params.datum : null;

  const overzicht = await caoDayOverview();
  const alleDagen = overzicht.months.flatMap((maand) =>
    maand.cells.filter((cel) => cel !== null),
  );
  const keuze = gekozen ? (alleDagen.find((dag) => dag.date === gekozen) ?? null) : null;
  // Eén centrale status per datum: bestaat er al een aanvraag, dan geldt die
  // status — nooit tegelijk "kan niet worden aangevraagd" ernaast. De vraag
  // "mag een nieuwe aanvraag hier" wordt pas gesteld als het antwoord op "is
  // er al een aanvraag" nee is.
  const bestaandeAanvraag = keuze?.requested
    ? (overzicht.requests.find((aanvraag) => aanvraag.date === keuze.date) ?? null)
    : null;

  return (
    <EmployeeShell
      activeHref="/medewerker/cao-dagen"
      header={{
        title: "CAO-dagen",
        subtitle: `${overzicht.remaining} van ${overzicht.allowance} nog te kiezen — vanaf ${overzicht.earliestLabel}`,
      }}
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {keuze && (
            <WidgetCard
              icon={<CalendarCheckIcon size={18} />}
              tone="info"
              title="Aanvraag bevestigen"
              subtitle={formatDutchDate(keuze.date)}
              bodyClassName="border-t border-line p-4"
            >
              {bestaandeAanvraag ? (
                <div className="space-y-3">
                  <Alert
                    tone={bestaandeAanvraag.status === "REGISTERED_IN_LEAVE_BOOK" ? "ok" : "info"}
                    title={`CAO-dag aangevraagd — ${bestaandeAanvraag.statusLabel}`}
                  >
                    {bestaandeAanvraag.status === "REGISTERED_IN_LEAVE_BOOK"
                      ? "Verwerkt in verlofboek. De dienstindeling heeft deze aanvraag al vastgelegd; intrekken kan hier niet meer."
                      : "Voor deze dag staat al een aanvraag. Zolang de dienstindeling hem nog niet in het verlofboek heeft gezet, kunt u hem intrekken."}
                  </Alert>

                  {bestaandeAanvraag.status === "REQUESTED" && (
                    <ActionForm
                      action={caoDagIntrekkenAction}
                      submitLabel="Intrekken"
                      variant="secondary"
                    >
                      <input type="hidden" name="id" value={bestaandeAanvraag.id} />
                    </ActionForm>
                  )}
                </div>
              ) : keuze.check.allowed ? (
                <div className="space-y-3">
                  <dl className="grid gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-[9rem_1fr]">
                    {caoDaySummary({
                      date: keuze.date,
                      rosterName: null,
                      lineNumber: null,
                      dutyCode: keuze.dutyCode,
                      timeRange: keuze.timeRange,
                      positionType: keuze.positionType,
                    }).map((regel) => (
                      <div key={regel.label} className="contents">
                        <dt className="text-ink-muted">{regel.label}</dt>
                        <dd className="font-semibold text-ink">{regel.value}</dd>
                      </div>
                    ))}
                  </dl>

                  <p className="text-[12px] text-ink-muted">
                    Na bevestiging gaat uw aanvraag naar de dienstindeling. Die zet hem in het
                    NS-verlofboek; u krijgt daarvan een melding.
                  </p>

                  <ActionForm action={caoDagAanvragenAction} submitLabel="CAO-dag aanvragen">
                    <input type="hidden" name="datum" value={keuze.date} />
                  </ActionForm>
                </div>
              ) : (
                <Alert tone="warn" title="Deze datum kan niet worden aangevraagd">
                  {keuze.check.message}
                </Alert>
              )}
            </WidgetCard>
          )}

          {overzicht.months.map((maand) => (
            <WidgetCard
              key={maand.month}
              icon={<CalendarIcon size={18} />}
              tone="rc"
              title={maand.label}
              subtitle="Kies een dag waarop u volgens uw rooster werkt"
              bodyClassName="border-t border-line p-3"
            >
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAGEN.map((dag) => (
                  <div
                    key={dag}
                    className="pb-1 text-center text-[11px] font-semibold uppercase text-ink-muted"
                  >
                    {dag}
                  </div>
                ))}
                {maand.cells.map((cel, index) =>
                  cel === null ? (
                    // Een lege plek vóór de eerste maandag; heeft geen datum en
                    // dus geen eigen identiteit.
                    <div key={`leeg-${maand.month}-${index}`} />
                  ) : (
                    <Dagvakje key={cel.date} dag={cel} geselecteerd={cel.date === gekozen} />
                  ),
                )}
              </div>
            </WidgetCard>
          ))}
        </div>

        <div className="space-y-4">
          <Alert tone="info" title="Hoe dit werkt">
            <ul className="list-disc space-y-1 pl-4">
              <li>
                U heeft {overzicht.allowance} CAO-dagen. Daarvan {overzicht.used === 1 ? "is er" : "zijn er"}{" "}
                {overzicht.used} aangevraagd.
              </li>
              <li>
                Een CAO-dag kan niet eerder dan {overzicht.noticeDays} dagen vooruit worden
                aangevraagd. De eerste dag die kan, is {overzicht.earliestLabel}.
              </li>
              <li>
                U kunt alleen dagen kiezen waarop u volgens uw rooster werkt of reserve heeft.
              </li>
              <li>
                CAO-dagen mogen niet op twee opeenvolgende dagen worden opgenomen. Heeft u een
                dag gekozen, dan vervallen de dag ervóór en de dag erna.
              </li>
              <li>
                Intrekken kan zolang de dienstindeling de dag nog niet in het verlofboek heeft
                gezet.
              </li>
            </ul>
          </Alert>

          <WidgetCard
            icon={<CalendarCheckIcon size={18} />}
            tone="neutral"
            title="Mijn aanvragen"
            subtitle="Inclusief eerder ingetrokken aanvragen"
            bodyClassName="border-t border-line"
          >
            {overzicht.requests.length === 0 ? (
              <div className="p-4">
                <EmptyState>U heeft nog geen CAO-dag aangevraagd.</EmptyState>
              </div>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Datum</TH>
                    <TH>Status</TH>
                    <TH> </TH>
                  </tr>
                </THead>
                <tbody>
                  {overzicht.requests.map((aanvraag) => (
                    <tr key={aanvraag.id}>
                      <TD>
                        <span className="font-semibold text-ink">{aanvraag.dateLabel}</span>
                        {aanvraag.snapshot.dutyCode && (
                          <span className="block text-[11px] text-ink-muted">
                            dienst {aanvraag.snapshot.dutyCode}
                            {aanvraag.snapshot.timeRange ? ` · ${aanvraag.snapshot.timeRange}` : ""}
                          </span>
                        )}
                      </TD>
                      <TD>
                        <Badge
                          tone={
                            aanvraag.status === "REGISTERED_IN_LEAVE_BOOK"
                              ? "ok"
                              : aanvraag.status === "CANCELLED"
                                ? "neutral"
                                : "info"
                          }
                        >
                          {aanvraag.statusLabel}
                        </Badge>
                      </TD>
                      <TD>
                        {aanvraag.status === "REQUESTED" && (
                          <ActionForm
                            action={caoDagIntrekkenAction}
                            submitLabel="Intrekken"
                            variant="secondary"
                            compact
                          >
                            <input type="hidden" name="id" value={aanvraag.id} />
                          </ActionForm>
                        )}
                      </TD>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </WidgetCard>

          <p className="text-[11px] leading-relaxed text-ink-muted">
            Het aantal van {overzicht.allowance} dagen is een instelling van dit platform en niet
            overgenomen uit een aangeleverd CAO-artikel. Wijkt uw eigen tegoed hiervan af, meld dat
            dan bij de dienstindeling.
          </p>
        </div>
      </div>
    </EmployeeShell>
  );
}

/** Eén dag in de kalender. Klikbaar wanneer hij gekozen mag worden. */
function Dagvakje({
  dag,
  geselecteerd,
}: {
  dag: {
    date: string;
    positionType: string | null;
    dutyCode: string | null;
    requested: boolean;
    check: { allowed: boolean; message: string | null };
  };
  geselecteerd: boolean;
}) {
  const nummer = Number(dag.date.slice(8, 10));
  const onder = dag.requested
    ? "CAO"
    : (dag.dutyCode ?? (dag.positionType ? (POSITIE_KORT[dag.positionType] ?? dag.positionType) : "—"));

  const basis =
    "flex min-h-[3.25rem] flex-col justify-between rounded-lg border px-1.5 py-1 text-left";

  if (dag.requested) {
    return (
      <div
        className={`${basis} border-ns-blue bg-ns-blue-soft text-ink`}
        title="Voor deze dag staat al een CAO-dagaanvraag."
      >
        <span className="text-[12px] font-semibold">{nummer}</span>
        <span className="text-[10px] font-semibold uppercase text-ns-blue">{onder}</span>
      </div>
    );
  }

  if (!dag.check.allowed) {
    return (
      <div
        className={`${basis} border-line bg-canvas text-ink-muted`}
        title={dag.check.message ?? undefined}
      >
        <span className="text-[12px]">{nummer}</span>
        <span className="text-[10px] uppercase">{onder}</span>
      </div>
    );
  }

  return (
    <Link
      href={`/medewerker/cao-dagen?datum=${dag.date}`}
      scroll={false}
      className={`${basis} ${
        geselecteerd
          ? "border-ns-blue bg-ns-blue-soft"
          : "border-line-strong bg-surface hover:bg-canvas"
      } text-ink`}
    >
      <span className="text-[12px] font-semibold">{nummer}</span>
      <span className="text-[10px] font-semibold uppercase text-ink-muted">{onder}</span>
    </Link>
  );
}
