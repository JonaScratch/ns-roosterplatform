import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { NotFoundError } from "@/server/security/authorize";
import {
  type ViewerCell,
  type ViewerLine,
  WEEKDAY_SHORT,
  candidateRosterView,
} from "@/server/services/candidate-results-service";
import { RosterCommitteeShell } from "@/components/layout/area-shell";
import { Badge, WidgetCard } from "@/components/ui/primitives";
import { DownloadIcon, FileTextIcon } from "@/components/ui/icons";
import { Nachtreeksen, StatusBadge, UrenStip, afwijkingTekst, naamVan } from "../../onderdelen";

export const dynamic = "force-dynamic";

/**
 * Eén basisrooster uit een kandidaat, zoals een medewerker het rijdt.
 *
 * ## Waarom de agenda en niet de roostertabel
 *
 * Een regel is een week. Wie wil zien of een regel goed te rijden is, kijkt naar
 * zeven dagen achter elkaar: welke dienst, van hoe laat tot hoe laat, welk
 * dagdeel, en hoe de ene dag op de andere volgt. Dat is de vorm van de agenda
 * bij de dienstindeling, en die vorm staat hier ook: dagkaarten, dienstnummer,
 * begin- en eindtijd, (+1) bij een dienst over middernacht, R/WTV/CO/RES als
 * vrije of reservedag.
 *
 * ## Waarom de cellen van het roosterblad komen
 *
 * Wat in een dagkaart staat — code, tijdvak, duur — komt uit precies dezelfde
 * bladregels als de PDF. Wat hier staat en wat er straks op papier staat, kan
 * dus niet uit elkaar lopen. Dagdeel, nachtreeks en overgang komen erbij uit de
 * kwaliteitsmeting.
 */
export default async function KandidaatRooster({
  params,
  searchParams,
}: {
  params: Promise<{ candidateId: string; rosterCode: string }>;
  searchParams: Promise<{ regel?: string }>;
}) {
  const [{ candidateId, rosterCode }, query] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(candidateId).success || !/^[A-Za-z0-9-]{2,32}$/.test(rosterCode)) {
    notFound();
  }
  const view = await candidateRosterView(candidateId, rosterCode).catch((error: unknown) => {
    if (error instanceof NotFoundError) {
      return null;
    }
    throw error;
  });
  if (!view) {
    notFound();
  }

  const { candidate, roster, lines } = view;
  const alle = query.regel === "alle";
  const gekozenNummer = alle ? null : Number(query.regel ?? lines[0]?.lineNumber ?? 1);
  const gekozen = lines.find((line) => line.lineNumber === gekozenNummer) ?? (alle ? null : lines[0]);
  const positie = gekozen ? lines.indexOf(gekozen) : -1;
  const vorige = positie >= 0 ? lines[(positie - 1 + lines.length) % lines.length] : null;
  const volgende = positie >= 0 ? lines[(positie + 1) % lines.length] : null;
  const basis = `/roostercommissie/simulatie/${candidate.id}/${roster.code}`;
  const bruikbaar = candidate.status === "GEREED" || candidate.status === "VEROUDERD";

  return (
    <RosterCommitteeShell
      activeHref="/roostercommissie/simulatie"
      header={{
        title: `${roster.code} — ${roster.name}`,
        subtitle: `${naamVan(candidate)} · ${candidate.strategyLabel}${candidate.rosterYear ? ` · roosterjaar ${candidate.rosterYear}` : ""}`,
      }}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px]">
          <Link href={`/roostercommissie/simulatie/${candidate.id}`} className="text-ink-muted underline">
            ← {naamVan(candidate)}: alle basisroosters
          </Link>
        </p>
        <nav aria-label="Ander basisrooster" className="flex flex-wrap gap-1">
          {view.otherRosters.map((ander) => (
            <Link
              key={ander.code}
              href={`/roostercommissie/simulatie/${candidate.id}/${ander.code}${alle ? "?regel=alle" : ""}`}
              aria-current={ander.code === roster.code ? "page" : undefined}
              className={`rounded-md border px-2 py-0.5 font-mono text-[11px] ${
                ander.code === roster.code
                  ? "border-accent-rc bg-accent-rc-soft font-semibold text-accent-rc"
                  : "border-line text-ink-muted hover:border-line-strong hover:text-ink"
              }`}
            >
              {ander.code}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mb-4 grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-3 lg:grid-cols-6">
        <Kengetal label="Status">
          <StatusBadge kaart={candidate} />
        </Kengetal>
        <Kengetal label="Gemiddeld per week">
          <span className="inline-flex items-center gap-1.5">
            <UrenStip afwijking={roster.deviationMinutes} />
            <span className="tabular font-semibold">{roster.averageWeek}</span>
            <span className="tabular text-[11px] text-ink-muted">({afwijkingTekst(roster.deviationMinutes)})</span>
          </span>
        </Kengetal>
        <Kengetal label="Vroeg · Laat · Nacht · Rangeer">
          <span className="tabular font-semibold">
            {roster.early} · {roster.late} · {roster.night} · {roster.shunting}
          </span>
        </Kengetal>
        <Kengetal label="Nachtreeksen">
          <Nachtreeksen tegel={roster} />
        </Kengetal>
        <Kengetal label="Zware overgangen">
          <span className={`tabular font-semibold ${roster.heavyTransitions > 0 ? "text-state-warn" : ""}`}>
            {roster.heavyTransitions}
          </span>
        </Kengetal>
        <Kengetal label="Kortste rust tussen diensten">
          <span className="tabular font-semibold">
            {roster.shortestRestMinutes === null ? "—" : afwijkingTekst(roster.shortestRestMinutes).slice(1)}
          </span>
        </Kengetal>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Regel kiezen" className="flex flex-wrap gap-1">
          {lines.map((line) => (
            <Link
              key={line.lineNumber}
              href={`${basis}?regel=${line.lineNumber}`}
              aria-current={gekozen?.lineNumber === line.lineNumber ? "page" : undefined}
              className={`tabular rounded-md border px-2.5 py-1 text-[12px] font-semibold ${
                gekozen?.lineNumber === line.lineNumber
                  ? "border-accent-rc bg-accent-rc text-white"
                  : "border-line bg-surface text-ink hover:border-line-strong"
              }`}
            >
              Regel {line.lineNumber}
            </Link>
          ))}
          <Link
            href={`${basis}?regel=alle`}
            aria-current={alle ? "page" : undefined}
            className={`rounded-md border px-2.5 py-1 text-[12px] font-semibold ${
              alle ? "border-accent-rc bg-accent-rc text-white" : "border-line bg-surface text-ink hover:border-line-strong"
            }`}
          >
            Alle regels
          </Link>
        </nav>
        {bruikbaar ? (
          <div className="flex flex-wrap gap-1.5">
            <a
              href={`/roostercommissie/roosterblad/${roster.code}?kandidaat=${candidate.id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-canvas"
            >
              <FileTextIcon size={14} aria-hidden />
              Blad bekijken
            </a>
            <a
              href={`/roostercommissie/roosterblad/${roster.code}?kandidaat=${candidate.id}&formaat=pdf`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent-rc px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-ns-blue"
            >
              <DownloadIcon size={14} aria-hidden />
              Exporteren naar PDF
            </a>
          </div>
        ) : null}
      </div>

      {gekozen ? (
        <WidgetCard
          tone="rc"
          title={`Regel ${gekozen.lineNumber}`}
          subtitle={`${gekozen.hours} uur deze week · V${gekozen.early} L${gekozen.late} N${gekozen.night} · rangeer ${gekozen.shunting} · weekenddiensten ${gekozen.weekendDuties}`}
          actions={
            vorige && volgende && lines.length > 1 ? (
              <div className="flex gap-1">
                <Link href={`${basis}?regel=${vorige.lineNumber}`} className="rounded border border-line px-2 py-1 text-[12px] font-semibold hover:bg-canvas">
                  ← Regel {vorige.lineNumber}
                </Link>
                <Link href={`${basis}?regel=${volgende.lineNumber}`} className="rounded border border-line px-2 py-1 text-[12px] font-semibold hover:bg-canvas">
                  Regel {volgende.lineNumber} →
                </Link>
              </div>
            ) : null
          }
          bodyClassName="border-t border-line p-4"
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {gekozen.cells.map((cel) => (
              <Dagkaart key={cel.weekday} cel={cel} />
            ))}
          </div>
          <p className="mt-3 text-[11.5px] text-ink-muted">
            Na zondag gaat wie deze regel rijdt door naar regel {volgende?.lineNumber ?? gekozen.lineNumber}. Een
            nachtreeks of overgang over de zondag heen loopt dus door in die regel.
          </p>
        </WidgetCard>
      ) : (
        <WidgetCard
          tone="rc"
          title="Alle regels"
          subtitle="Elke rij is een week; de rotatie loopt van boven naar beneden en daarna weer naar regel 1"
          bodyClassName="border-t border-line p-3"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] border-separate border-spacing-1 text-left">
              <thead>
                <tr>
                  <th className="w-16 px-1 text-[11px] font-semibold uppercase text-ink-muted">Regel</th>
                  {WEEKDAY_SHORT.map((dag) => (
                    <th key={dag} className="px-1 text-[11px] font-semibold uppercase text-ink-muted">
                      {dag}
                    </th>
                  ))}
                  <th className="w-20 px-1 text-right text-[11px] font-semibold uppercase text-ink-muted">Uren</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <MatrixRegel key={line.lineNumber} line={line} href={`${basis}?regel=${line.lineNumber}`} />
                ))}
              </tbody>
            </table>
          </div>
        </WidgetCard>
      )}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-ink-muted">
        <Legenda kleur="bg-surface border-line-strong" label="Dienst" />
        <Legenda kleur="bg-state-ok-soft border-state-ok/40" label="R / WTV / CO" />
        <Legenda kleur="bg-state-info-soft border-state-info/40" label="RES (reservedag)" />
        <span className="inline-flex items-center gap-1">
          <DagdeelChip categorie="EARLY" /> <DagdeelChip categorie="LATE" /> <DagdeelChip categorie="NIGHT" /> dagdeel
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="rounded border border-state-warn bg-state-warn-soft px-1 text-state-warn">!</span> zware overgang
        </span>
        <span>(+1) eindigt de volgende dag</span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <WidgetCard tone="neutral" title="Nachtreeksen" subtitle="In de volgorde waarin het rooster wordt gereden" bodyClassName="border-t border-line px-4 py-2">
          {view.nightBlocks.length === 0 ? (
            <p className="py-2 text-[12px] text-ink-muted">Geen nachtdiensten in dit rooster.</p>
          ) : (
            <ul className="divide-y divide-line/70 text-[12px]">
              {view.nightBlocks.map((blok) => (
                <li key={`${blok.startLine}-${blok.startWeekday}`} className="flex items-center justify-between gap-2 py-1.5">
                  <Link href={`${basis}?regel=${blok.startLine}`} className="underline">
                    Regel {blok.startLine}, vanaf {WEEKDAY_SHORT[blok.startWeekday - 1]}
                  </Link>
                  <Badge tone={blok.length >= 3 ? "ok" : blok.length === 2 ? "warn" : "error"}>
                    {blok.length} {blok.length === 1 ? "nacht (los)" : "nachten"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </WidgetCard>
        <WidgetCard tone="neutral" title="Zware overgangen" subtitle="Terug tegen de klok in, zoals nacht → vroeg" bodyClassName="border-t border-line px-4 py-2">
          {view.heavyTransitions.length === 0 ? (
            <p className="py-2 text-[12px] text-ink-muted">Geen zware overgangen in dit rooster.</p>
          ) : (
            <ul className="divide-y divide-line/70 text-[12px]">
              {view.heavyTransitions.map((overgang) => (
                <li key={`${overgang.lineNumber}-${overgang.weekday}`} className="flex items-center justify-between gap-2 py-1.5">
                  <Link href={`${basis}?regel=${overgang.lineNumber}`} className="underline">
                    Regel {overgang.lineNumber}, {WEEKDAY_SHORT[overgang.weekday - 1]}: {overgang.fromCode} → {overgang.toCode}
                  </Link>
                  <span className="text-ink-muted">{overgang.label}</span>
                </li>
              ))}
            </ul>
          )}
        </WidgetCard>
      </div>
    </RosterCommitteeShell>
  );
}

const DAGNAMEN = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag", "Zondag"];

const STRUCTUREEL: Record<string, string> = {
  RUST: "Rustdag",
  WR: "WTV-dag",
  CO: "Compensatiedag",
  RES: "Reservedag",
  VERLOF: "Verlof",
  OPLEIDING: "Opleiding",
};

function achtergrond(cel: ViewerCell): string {
  if (cel.positionType === "DUTY") {
    return "border-line-strong bg-surface";
  }
  if (cel.positionType === "RES") {
    return "border-state-info/40 bg-state-info-soft";
  }
  return "border-state-ok/40 bg-state-ok-soft";
}

function eindtijd(cel: ViewerCell): { begin: string; einde: string } | null {
  if (!cel.timeRange) {
    return null;
  }
  const [begin, einde] = cel.timeRange.split(" - ");
  return { begin, einde };
}

function Dagkaart({ cel }: { cel: ViewerCell }) {
  const tijd = eindtijd(cel);
  const zwaar = cel.heavyTransition !== null;
  return (
    <div
      className={`flex min-h-[7.5rem] flex-col gap-1 rounded-lg border p-2.5 ${achtergrond(cel)} ${
        zwaar || cel.heavyTransitionTarget ? "outline outline-2 -outline-offset-1 outline-state-warn" : ""
      }`}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{DAGNAMEN[cel.weekday - 1]}</span>
      {cel.positionType === "DUTY" ? (
        <>
          <span className="flex items-center justify-between gap-1">
            <span className="font-mono text-[17px] font-bold text-ink-strong">{cel.code}</span>
            {cel.category ? <DagdeelChip categorie={cel.category} /> : null}
          </span>
          {tijd ? (
            <span className="tabular text-[12.5px] text-ink">
              {tijd.begin} – {tijd.einde}
              {cel.overnight ? <span className="ml-0.5 text-[11px] font-semibold text-ink-muted">(+1)</span> : null}
            </span>
          ) : (
            <span className="text-[11.5px] text-state-error">tijden onbekend</span>
          )}
          {cel.duration ? <span className="tabular text-[11px] text-ink-muted">{cel.duration} uur</span> : null}
          <span className="mt-auto flex flex-wrap gap-1">
            {cel.shunting ? <Badge tone="neutral">Rangeer</Badge> : null}
            {cel.reserveDuty ? <Badge tone="neutral">Reserve</Badge> : null}
            {cel.nightBlockLength !== null ? (
              <Badge tone={cel.nightBlockLength >= 3 ? "ok" : cel.nightBlockLength === 2 ? "warn" : "error"}>
                reeks van {cel.nightBlockLength}
              </Badge>
            ) : null}
          </span>
          {cel.heavyTransition ? (
            <span className="text-[11px] font-semibold text-state-warn">
              ! {cel.heavyTransition.label} naar {cel.heavyTransition.toCode}
            </span>
          ) : null}
        </>
      ) : (
        <>
          <span className="font-mono text-[17px] font-bold text-ink-strong">{cel.code || "—"}</span>
          <span className="text-[12px] text-ink-muted">{STRUCTUREEL[cel.positionType] ?? cel.positionType}</span>
          {cel.duration ? <span className="tabular text-[11px] text-ink-muted">telt als {cel.duration} uur</span> : null}
        </>
      )}
    </div>
  );
}

function MatrixRegel({ line, href }: { line: ViewerLine; href: string }) {
  return (
    <tr>
      <th scope="row" className="px-1 align-top">
        <Link href={href} className="tabular text-[12px] font-semibold text-accent-rc hover:underline">
          Regel {line.lineNumber}
        </Link>
      </th>
      {line.cells.map((cel) => {
        const tijd = eindtijd(cel);
        return (
          <td
            key={cel.weekday}
            className={`rounded-md border px-1.5 py-1 align-top ${achtergrond(cel)} ${
              cel.heavyTransition || cel.heavyTransitionTarget ? "outline outline-2 -outline-offset-1 outline-state-warn" : ""
            }`}
            title={
              cel.heavyTransition ? `Zware overgang: ${cel.heavyTransition.label} naar ${cel.heavyTransition.toCode}` : undefined
            }
          >
            <span className="flex items-center justify-between gap-1">
              <span className="font-mono text-[12.5px] font-semibold text-ink-strong">{cel.code || "—"}</span>
              {cel.category ? <DagdeelChip categorie={cel.category} klein /> : null}
            </span>
            {tijd ? (
              <span className="tabular block text-[10.5px] text-ink-muted">
                {tijd.begin}–{tijd.einde}
                {cel.overnight ? " (+1)" : ""}
              </span>
            ) : null}
          </td>
        );
      })}
      <td className="tabular px-1 text-right align-top text-[12px] font-semibold text-ink">{line.hours}</td>
    </tr>
  );
}

const DAGDEEL = {
  EARLY: { letter: "V", label: "Vroeg", kleur: "border-state-ok/30 bg-state-ok-soft text-state-ok" },
  LATE: { letter: "L", label: "Laat", kleur: "border-state-info/30 bg-state-info-soft text-state-info" },
  NIGHT: { letter: "N", label: "Nacht", kleur: "border-state-warn/30 bg-state-warn-soft text-state-warn" },
} as const;

function DagdeelChip({ categorie, klein = false }: { categorie: "EARLY" | "LATE" | "NIGHT"; klein?: boolean }) {
  const dagdeel = DAGDEEL[categorie];
  return (
    <span
      title={dagdeel.label}
      className={`inline-flex items-center rounded border font-semibold ${dagdeel.kleur} ${
        klein ? "px-1 text-[9.5px]" : "px-1.5 py-0.5 text-[10.5px]"
      }`}
    >
      {klein ? dagdeel.letter : dagdeel.label}
    </span>
  );
}

function Kengetal({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-ink-muted">{label}</p>
      <div className="mt-0.5 text-[13px] text-ink">{children}</div>
    </div>
  );
}

function Legenda({ kleur, label }: { kleur: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full border ${kleur}`} aria-hidden="true" />
      {label}
    </span>
  );
}
