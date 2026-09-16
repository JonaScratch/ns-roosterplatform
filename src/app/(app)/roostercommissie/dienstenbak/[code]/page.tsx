import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDuration, formatMinuteOfDay, weekdayLabel } from "@/domain/time";
import { PLACEMENT_LABELS, type PlacementCategory } from "@/domain/duty-placement";
import { dutyDetail } from "@/server/services/duty-pool-service";
import { RosterCommitteeShell } from "@/components/layout/area-shell";
import { Alert, Badge, EmptyState, WidgetCard } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { DutyKinds } from "@/components/schedule/duty-label";

export const dynamic = "force-dynamic";

/**
 * Eén dienst, van bron tot plek in het rooster.
 *
 * ## De vraag die dit scherm beantwoordt
 *
 * "Waar komt dienst 101 vandaan en waar is hij gebleven." Beide helften staan
 * erop: het bestand, de regel en de letterlijke celwaarden aan de ene kant, de
 * roosterlijnen waarin hij staat aan de andere. Daartussen staat waaróm hij in
 * het ene profiel wel past en in het andere niet.
 *
 * ## Waarom er een weekdag bij hoort
 *
 * Dienst 101 bestaat zes keer, op zes weekdagen, met zes verschillende
 * begintijden. "Dienst 101" alleen wijst dus niets aan. De weekdag staat in de
 * URL en boven aan de pagina, en de andere dagen staan ernaast — zodat wie hier
 * komt kijken ziet dát er meer zijn en niet per ongeluk de tijden van maandag
 * voor die van donderdag aanziet.
 *
 * Waar het systeem iets niet weet — de bevoegdhedenmatrix, de bijzondere regels
 * voor Mix — staat dat er met zoveel woorden. Een leeg vakje zou als "niets aan
 * de hand" worden gelezen.
 */
export default async function Dienstdetail({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ standplaats?: string; weekdag?: string }>;
}) {
  const [{ code }, query] = await Promise.all([params, searchParams]);
  const gevraagdeWeekdag = /^[1-7]$/.test(query.weekdag ?? "") ? Number(query.weekdag) : null;
  const duty = await dutyDetail(code, gevraagdeWeekdag, query.standplaats ?? null);
  if (!duty) {
    notFound();
  }

  const naarVariant = (weekday: number): string =>
    `/roostercommissie/dienstenbak/${duty.code}?weekdag=${weekday}` +
    (query.standplaats ? `&standplaats=${query.standplaats}` : "");

  const terug = `/roostercommissie/dienstenbak${
    query.standplaats ? `?standplaats=${query.standplaats}` : ""
  }`;

  return (
    <RosterCommitteeShell
      activeHref="/roostercommissie/dienstenbak"
      header={{
        title: `Dienst ${duty.code} — ${duty.weekdayLabel}`,
        subtitle: `${duty.locationCode} · ${duty.kindLabel} · ${formatMinuteOfDay(
          duty.startMinute,
        )}–${formatMinuteOfDay(duty.endMinute)}`,
      }}
    >
      <p className="mb-3 text-[11px]">
        <Link href={terug} className="text-ink-muted underline">
          ← Dienstenbak
        </Link>
      </p>

      {duty.variants.length > 1 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-ink-muted">
            Dit nummer rijdt op {duty.variants.length} weekdagen, elk met eigen tijden:
          </span>
          {duty.variants.map((variant) =>
            variant.weekday === duty.weekday ? (
              <Badge key={variant.weekday} tone="info">
                {variant.weekdayLabel} {formatMinuteOfDay(variant.startMinute)}–
                {formatMinuteOfDay(variant.endMinute)}
              </Badge>
            ) : (
              <Link
                key={variant.weekday}
                href={naarVariant(variant.weekday)}
                className="rounded border border-line px-1.5 py-0.5 text-ink-muted hover:text-ink"
              >
                {variant.weekdayLabel} {formatMinuteOfDay(variant.startMinute)}–
                {formatMinuteOfDay(variant.endMinute)}
              </Link>
            ),
          )}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <WidgetCard title="De dienst">
          <Table>
            <tbody>
              <TR>
                <TD>Begint</TD>
                <TD mono>{formatMinuteOfDay(duty.startMinute)}</TD>
              </TR>
              <TR>
                <TD>Eindigt</TD>
                <TD mono>
                  {formatMinuteOfDay(duty.endMinute)}
                  {duty.endMinute >= 1440 && (
                    <span className="ml-1 text-[11px] text-ink-muted">(volgende dag)</span>
                  )}
                </TD>
              </TR>
              <TR>
                <TD>Dienstlengte</TD>
                <TD mono>{formatDuration(duty.durationMinutes)}</TD>
              </TR>
              <TR>
                <TD>Soort</TD>
                <TD>
                  <DutyKinds kinds={duty.kinds} />
                </TD>
              </TR>
              <TR>
                <TD>Nacht volgens tijd</TD>
                <TD>{duty.nightByTime ? "ja" : "nee"}</TD>
              </TR>
              <TR>
                <TD>Harde nacht</TD>
                <TD>{duty.hardNight ? "ja" : "nee"}</TD>
              </TR>
              <TR>
                <TD>Rangeer</TD>
                <TD>{duty.shunting ? "ja" : "nee"}</TD>
              </TR>
              <TR>
                <TD>Pauze</TD>
                <TD>
                  {duty.breakMinutes === null ? (
                    <span className="text-[11px] text-ink-muted">
                      niet aangeleverd — de engine rekent met een boven- en ondergrens
                    </span>
                  ) : (
                    formatDuration(duty.breakMinutes)
                  )}
                </TD>
              </TR>
              <TR>
                <TD>Weekdag</TD>
                <TD>{duty.weekdayLabel}</TD>
              </TR>
              <TR>
                <TD>Omschrijving</TD>
                <TD>{duty.description ?? "—"}</TD>
              </TR>
            </tbody>
          </Table>
        </WidgetCard>

        <div className="space-y-4">
          <WidgetCard
            title="Waar deze dienst staat"
            subtitle={PLACEMENT_LABELS[duty.placement as PlacementCategory] ?? duty.placement}
          >
            {duty.placedIn.length === 0 ? (
              <>
                <EmptyState>Deze dienst staat in geen enkele vaste roosterlijn.</EmptyState>
                {duty.placementExplanation.length > 0 && (
                  <ul className="mt-2 space-y-1 text-[11px] text-ink-muted">
                    {duty.placementExplanation.map((regel) => (
                      <li key={regel}>{regel}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Rooster</TH>
                    <TH numeric>Regel</TH>
                    <TH numeric>Week</TH>
                    <TH>Dag</TH>
                  </TR>
                </THead>
                <tbody>
                  {duty.placedIn.map((plek) => (
                    <TR
                      key={`${plek.baseRosterCode}-${plek.lineNumber}-${plek.weekIndex}-${plek.weekday}`}
                    >
                      <TD mono>{plek.baseRosterCode}</TD>
                      <TD numeric>{plek.lineNumber}</TD>
                      <TD numeric>{plek.weekIndex}</TD>
                      <TD>{weekdayLabel(plek.weekday)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            )}
          </WidgetCard>

          <WidgetCard
            title="Geschikte roosterprofielen"
            subtitle="Alleen profielen die op deze standplaats zijn ingericht."
          >
            <Table>
              <tbody>
                {duty.profileFits.map((fit) => (
                  <TR key={fit.profile}>
                    <TD>
                      <Badge
                        tone={!fit.fits ? "warn" : fit.assessable ? "ok" : "neutral"}
                      >
                        {!fit.fits ? "nee" : fit.assessable ? "ja" : "onbekend"}
                      </Badge>
                    </TD>
                    <TD>{fit.label}</TD>
                    <TD>
                      <span className="text-[11px] text-ink-muted">{fit.explanation}</span>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </WidgetCard>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <WidgetCard title="Benodigde bevoegdheden">
          {duty.requiredQualifications.length === 0 ? (
            <EmptyState>Het pakket vermeldt geen bevoegdheden voor deze dienst.</EmptyState>
          ) : (
            <ul className="space-y-1 text-[12px]">
              {duty.requiredQualifications.map((code) => (
                <li key={code} className="font-mono">
                  {code}
                </li>
              ))}
            </ul>
          )}
          <Alert tone="neutral" title="Niet geverifieerd">
            De bevoegdhedenmatrix van NS is niet aangeleverd. Wat hier staat komt uit het
            dienstenpakket en is niet tegen een bronsysteem gecontroleerd
            (QUALIFICATION_DATA_INCOMPLETE). Materieelbevoegdheid, baanvakbekendheid en
            geldigheidsdatums ontbreken.
          </Alert>
        </WidgetCard>

        <WidgetCard title="Herkomst" subtitle="Waar deze dienst vandaan komt.">
          <Table>
            <tbody>
              <TR>
                <TD>Pakket</TD>
                <TD mono>{duty.source.packageLabel ?? "onbekend"}</TD>
              </TR>
              <TR>
                <TD>Bestand</TD>
                <TD>{duty.source.filename ?? "onbekend"}</TD>
              </TR>
              <TR>
                <TD>SHA-256</TD>
                <TD mono>
                  <span className="text-[10px]">{duty.source.checksum ?? "—"}</span>
                </TD>
              </TR>
              <TR>
                <TD>Regel in bestand</TD>
                <TD numeric>{duty.source.row ?? "niet vastgelegd"}</TD>
              </TR>
              <TR>
                <TD>Ingelezen op</TD>
                <TD>{duty.source.importedAt?.toLocaleString("nl-NL") ?? "—"}</TD>
              </TR>
            </tbody>
          </Table>

          {duty.source.originalValues ? (
            <>
              <p className="mt-3 text-[11px] font-semibold text-ink">Oorspronkelijke waarden</p>
              <Table>
                <tbody>
                  {Object.entries(duty.source.originalValues).map(([veld, waarde]) => (
                    <TR key={veld}>
                      <TD>{veld}</TD>
                      <TD mono>{waarde || "—"}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </>
          ) : (
            <p className="mt-2 text-[11px] text-ink-muted">
              Deze dienst is ingelezen voordat de oorspronkelijke celwaarden werden bewaard.
              Een nieuwe import legt ze wel vast.
            </p>
          )}
        </WidgetCard>
      </div>
    </RosterCommitteeShell>
  );
}
