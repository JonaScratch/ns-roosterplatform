import Link from "next/link";
import { formatCalendarDate } from "@/domain/time";
import { preferenceLabel, type SwapListingPreference } from "@/domain/ruilmarkt";
import { ownSwappableDuties } from "@/server/services/employee-dashboard-service";
import { swapCandidates } from "@/server/services/swap-service";
import {
  SWAP_STATUS_LABELS,
  findColleague,
  myProposals,
} from "@/server/services/swap-workspace-service";
import {
  listingMatches,
  marketplaceListings,
  myListings,
  ownOfferableDuties,
} from "@/server/services/ruilmarkt-service";
import { EmployeeShell } from "@/components/layout/area-shell";
import { ActionForm } from "@/components/ui/action-form";
import { Alert, Badge, EmptyState, WidgetCard, inputClass } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { DateLabel, DutyKinds, DutyTimes } from "@/components/schedule/duty-label";
import {
  beantwoordRuilAction,
  claimRuilmarktplaatsingAction,
  plaatsInRuilmarktAction,
  stelRuilVoorAction,
  trekRuilmarktplaatsingInAction,
} from "../acties";

export const dynamic = "force-dynamic";

const PREFERENCE_OPTIONS: readonly SwapListingPreference[] = ["NONE", "EARLIER", "LATER"];

const LISTING_STATUS_TONE: Record<string, "ok" | "info" | "neutral"> = {
  OPEN: "info",
  MATCHED: "ok",
  WITHDRAWN: "neutral",
  EXPIRED: "neutral",
};

/**
 * Dienstenruil.
 *
 * ## Waarom er twee tabbladen zijn
 *
 * De ruilmarkt en het rechtstreekse zoeken op personeelsnummer lossen dezelfde
 * vraag anders op: wel of niet al weten wie de tegenpartij is. Beide eindigen
 * in exact hetzelfde `SwapProposal`, met dezelfde toetsing en dezelfde
 * acceptatiestroom — dit scherm kiest alleen hoe die tegenpartij gevonden
 * wordt, niet wat er daarna gebeurt.
 */
export default async function Ruilen({ searchParams }: PageProps<"/medewerker/ruilen">) {
  const params = await searchParams;
  const tab = params.tab === "direct" ? "direct" : "markt";

  const proposals = await myProposals();

  return (
    <EmployeeShell
      activeHref="/medewerker/ruilen"
      header={{
        title: "Diensten ruilen",
        subtitle: "Bied een dienst aan de ruilmarkt aan, of ruil rechtstreeks met een collega",
      }}
    >
      {proposals.incoming.length > 0 && (
        <div className="mb-4">
          <WidgetCard
            title="Voorstellen aan u"
            subtitle="Bij accepteren wordt de ruil opnieuw doorgerekend voordat hij doorgaat."
          >
            <ul className="space-y-3">
              {proposals.incoming.map((proposal) => (
                <li key={proposal.id} className="rounded border border-line px-3 py-2.5">
                  <p className="text-xs">
                    <span className="tabular font-semibold">{proposal.otherEmployeeNumber}</span>{" "}
                    biedt <span className="font-mono">{proposal.theirDutyCode}</span> op{" "}
                    {formatCalendarDate(proposal.theirDate)} aan, in ruil voor uw{" "}
                    <span className="font-mono">{proposal.ownDutyCode}</span> op{" "}
                    {formatCalendarDate(proposal.ownDate)}.
                  </p>
                  {proposal.message && (
                    <p className="mt-1 border-l-2 border-line pl-2 text-[11px] text-ink-muted">
                      {proposal.message}
                    </p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <ActionForm action={beantwoordRuilAction} submitLabel="Accepteren" compact>
                      <input type="hidden" name="proposalId" value={proposal.id} />
                      <input type="hidden" name="antwoord" value="accepteren" />
                    </ActionForm>
                    <ActionForm
                      action={beantwoordRuilAction}
                      submitLabel="Afwijzen"
                      variant="secondary"
                      compact
                    >
                      <input type="hidden" name="proposalId" value={proposal.id} />
                      <input type="hidden" name="antwoord" value="afwijzen" />
                    </ActionForm>
                  </div>
                </li>
              ))}
            </ul>
          </WidgetCard>
        </div>
      )}

      <div className="mb-4 flex gap-1 border-b border-line">
        <TabLink href="/medewerker/ruilen?tab=markt" active={tab === "markt"}>
          Ruilmarkt
        </TabLink>
        <TabLink href="/medewerker/ruilen?tab=direct" active={tab === "direct"}>
          Direct met collega
        </TabLink>
      </div>

      {tab === "markt" ? (
        <Ruilmarkt listingId={typeof params.listing === "string" ? params.listing : null} eigenDienstId={typeof params.eigenDienst === "string" ? params.eigenDienst : null} />
      ) : (
        <DirectMetCollega
          ownDutyId={typeof params.dienst === "string" ? params.dienst : null}
          colleagueNumber={typeof params.collega === "string" ? params.collega.trim() : ""}
        />
      )}

      <div className="mt-4">
        <WidgetCard title="Mijn ruilvoorstellen" subtitle="Rechtstreeks en via de ruilmarkt samen">
          {proposals.outgoing.length === 0 ? (
            <EmptyState>U heeft nog geen voorstellen verstuurd.</EmptyState>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Collega</TH>
                  <TH>U geeft</TH>
                  <TH>U krijgt</TH>
                  <TH>Status</TH>
                  <TH>Vervalt</TH>
                </TR>
              </THead>
              <tbody>
                {proposals.outgoing.map((proposal) => (
                  <TR key={proposal.id}>
                    <TD>
                      <span className="tabular">{proposal.otherEmployeeNumber}</span>
                    </TD>
                    <TD mono>
                      {proposal.ownDutyCode} · {proposal.ownDate}
                    </TD>
                    <TD mono>
                      {proposal.theirDutyCode} · {proposal.theirDate}
                    </TD>
                    <TD>
                      <Badge
                        tone={
                          proposal.status === "ACCEPTED"
                            ? "ok"
                            : proposal.status === "PENDING"
                              ? "info"
                              : "neutral"
                        }
                      >
                        {SWAP_STATUS_LABELS[proposal.status]}
                      </Badge>
                    </TD>
                    <TD>
                      <span className="tabular text-[11px] text-ink-muted">
                        {proposal.expiresAt.toLocaleDateString("nl-NL")}
                      </span>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </WidgetCard>
      </div>
    </EmployeeShell>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: string;
}) {
  return (
    <Link
      href={href}
      className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold ${
        active
          ? "border-ns-blue text-ns-blue"
          : "border-transparent text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

// ── Ruilmarkt ────────────────────────────────────────────────────────────────

async function Ruilmarkt({
  listingId,
  eigenDienstId,
}: {
  listingId: string | null;
  eigenDienstId: string | null;
}) {
  const [aanbod, eigenAanbiedingen, eigenDiensten] = await Promise.all([
    marketplaceListings(),
    myListings(),
    ownOfferableDuties(),
  ]);

  const detail = listingId ? await listingMatches(listingId) : null;
  const gekozenMatch = detail?.matches.find((match) => match.scheduledDutyId === eigenDienstId) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <WidgetCard
          title="Ruilmarkt"
          subtitle="Diensten die collega's van uw standplaats hebben aangeboden"
        >
          {aanbod.length === 0 ? (
            <EmptyState>Er staat op dit moment niets in de ruilmarkt.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {aanbod.map((plaatsing) => (
                <li
                  key={plaatsing.id}
                  className={`flex flex-wrap items-center justify-between gap-2 px-1 py-2.5 ${
                    plaatsing.id === listingId ? "bg-ns-blue-soft/40" : ""
                  }`}
                >
                  <div>
                    <p className="text-xs font-semibold">
                      <span className="font-mono">{plaatsing.duty.dutyCode}</span>{" "}
                      <DateLabel date={plaatsing.duty.date} />
                    </p>
                    <p className="text-[11px] text-ink-muted">
                      <DutyTimes start={plaatsing.duty.startMinute} end={plaatsing.duty.endMinute} />
                      {plaatsing.preference !== "NONE" && (
                        <span className="ml-2">{preferenceLabel(plaatsing.preference)}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <DutyKinds kinds={plaatsing.duty.kinds} />
                    <Link
                      href={`/medewerker/ruilen?tab=markt&listing=${plaatsing.id}`}
                      className="whitespace-nowrap rounded border border-line px-2 py-1 text-[11px] font-semibold hover:bg-canvas"
                    >
                      Bekijk ruilmogelijkheden
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </WidgetCard>

        {listingId && detail && (
          <WidgetCard
            title="Ruilmogelijkheden"
            subtitle={
              detail.listing
                ? `Tegenover ${detail.listing.duty.dutyCode} op ${formatCalendarDate(detail.listing.duty.date)}`
                : undefined
            }
          >
            {!detail.ok || !detail.listing ? (
              <Alert tone="warn">{detail.reason}</Alert>
            ) : detail.matches.length === 0 ? (
              <EmptyState>
                Er is op dit moment geen geldige ruilmogelijkheid met deze dienst.
              </EmptyState>
            ) : (
              <ul className="space-y-2">
                {detail.matches.map((match) => (
                  <li key={match.scheduledDutyId} className="rounded border border-line px-2 py-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div>
                        <p className="font-semibold">
                          <span className="font-mono">{match.dutyCode}</span>{" "}
                          <DateLabel date={match.date} />
                        </p>
                        <p className="text-[11px] text-ink-muted">
                          <DutyTimes start={match.startMinute} end={match.endMinute} />
                        </p>
                      </div>
                      <DutyKinds kinds={match.kinds} />
                    </div>
                    {match.warnings.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-[11px] text-state-warn">
                        {match.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    )}
                    <Link
                      href={`/medewerker/ruilen?tab=markt&listing=${listingId}&eigenDienst=${match.scheduledDutyId}`}
                      className="mt-2 inline-block rounded bg-ns-blue px-2 py-1 text-[11px] font-semibold text-white hover:bg-ns-blue-dark"
                    >
                      Kies deze dienst
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </WidgetCard>
        )}

        {listingId && detail?.ok && detail.listing && gekozenMatch && (
          <WidgetCard title="Ruilvoorstel bevestigen">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
              <dt className="text-ink-muted">U geeft</dt>
              <dd className="font-semibold text-ink">
                {gekozenMatch.dutyCode} · {formatCalendarDate(gekozenMatch.date)}
              </dd>
              <dt className="text-ink-muted">U ontvangt</dt>
              <dd className="font-semibold text-ink">
                {detail.listing.duty.dutyCode} · {formatCalendarDate(detail.listing.duty.date)}
              </dd>
            </dl>
            <div className="mt-3">
              <ActionForm action={claimRuilmarktplaatsingAction} submitLabel="Ruilvoorstel versturen">
                <input type="hidden" name="listingId" value={listingId} />
                <input type="hidden" name="ownScheduledDutyId" value={gekozenMatch.scheduledDutyId} />
              </ActionForm>
            </div>
          </WidgetCard>
        )}
      </div>

      <div className="space-y-4">
        <WidgetCard title="Eigen dienst aanbieden" subtitle="Zichtbaar voor collega's van uw standplaats">
          {eigenDiensten.length === 0 ? (
            <EmptyState>U heeft geen toekomstige diensten om aan te bieden.</EmptyState>
          ) : (
            <ActionForm action={plaatsInRuilmarktAction} submitLabel="Beschikbaar stellen">
              <label className="block text-[11px] font-semibold text-ink-muted">
                Eigen dienst
                <select name="scheduledDutyId" className={inputClass} required defaultValue="">
                  <option value="" disabled>
                    Kies een dienst
                  </option>
                  {eigenDiensten.map((duty) => (
                    <option key={duty.id} value={duty.id}>
                      {formatCalendarDate(duty.date)} — {duty.dutyCode}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-2 block text-[11px] font-semibold text-ink-muted">
                Voorkeur
                <select name="preference" className={inputClass} defaultValue="NONE">
                  {PREFERENCE_OPTIONS.map((optie) => (
                    <option key={optie} value={optie}>
                      {preferenceLabel(optie)}
                    </option>
                  ))}
                </select>
              </label>
            </ActionForm>
          )}
        </WidgetCard>

        <WidgetCard title="Mijn aangeboden diensten">
          {eigenAanbiedingen.length === 0 ? (
            <EmptyState>U heeft nog geen dienst aangeboden.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {eigenAanbiedingen.map((plaatsing) => (
                <li key={plaatsing.id} className="rounded border border-line px-2 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      <span className="font-mono">{plaatsing.duty.dutyCode}</span>{" "}
                      <DateLabel date={plaatsing.duty.date} />
                    </span>
                    <Badge tone={LISTING_STATUS_TONE[plaatsing.status] ?? "neutral"}>
                      {plaatsing.statusLabel}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[11px] text-ink-muted">
                    {preferenceLabel(plaatsing.preference)}
                    {plaatsing.pendingProposals > 0 &&
                      ` · ${plaatsing.pendingProposals} voorstel${plaatsing.pendingProposals === 1 ? "" : "len"}`}
                  </p>
                  {plaatsing.status === "OPEN" && (
                    <div className="mt-1.5">
                      <ActionForm
                        action={trekRuilmarktplaatsingInAction}
                        submitLabel="Niet meer aanbieden"
                        variant="secondary"
                        compact
                      >
                        <input type="hidden" name="listingId" value={plaatsing.id} />
                      </ActionForm>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </WidgetCard>
      </div>
    </div>
  );
}

// ── Direct met collega ───────────────────────────────────────────────────────

async function DirectMetCollega({
  ownDutyId,
  colleagueNumber,
}: {
  ownDutyId: string | null;
  colleagueNumber: string;
}) {
  const ownDuties = await ownSwappableDuties();
  const colleague = colleagueNumber ? await findColleague(colleagueNumber) : null;
  const candidates =
    ownDutyId && colleague
      ? await swapCandidates({
          ownScheduledDutyId: ownDutyId,
          counterpartyEmployeeId: colleague.employeeId,
        })
      : [];

  const selectedOwnDuty = ownDuties.find((duty) => duty.id === ownDutyId) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <WidgetCard title="1. Uw dienst" subtitle="Welke dienst wilt u weggeven?">
        {ownDuties.length === 0 ? (
          <EmptyState>U heeft geen toekomstige diensten om aan te bieden.</EmptyState>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {ownDuties.map((duty) => (
              <li key={duty.id}>
                <a
                  href={`/medewerker/ruilen?tab=direct&dienst=${duty.id}${
                    colleagueNumber ? `&collega=${encodeURIComponent(colleagueNumber)}` : ""
                  }`}
                  className={`flex items-center justify-between rounded border px-2 py-1.5 text-xs ${
                    duty.id === ownDutyId
                      ? "border-ns-blue bg-ns-blue-soft font-semibold"
                      : "border-line hover:bg-canvas"
                  }`}
                >
                  <span>{formatCalendarDate(duty.date)}</span>
                  <span className="font-mono">{duty.dutyCode}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </WidgetCard>

      <WidgetCard title="2. Uw collega" subtitle="Zoek op volledig personeelsnummer.">
        <form className="space-y-3">
          <input type="hidden" name="tab" value="direct" />
          {ownDutyId && <input type="hidden" name="dienst" value={ownDutyId} />}
          <input
            name="collega"
            defaultValue={colleagueNumber}
            placeholder="bijv. 100234"
            className={inputClass}
          />
          <button
            type="submit"
            className="rounded bg-ns-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-ns-blue-dark"
          >
            Zoeken
          </button>
        </form>

        {colleagueNumber && !colleague && (
          <Alert tone="warn">
            Geen actieve collega met dit personeelsnummer op uw standplaats.
          </Alert>
        )}
        {colleague && (
          <div className="mt-3 rounded border border-line bg-canvas px-3 py-2 text-xs">
            <p className="tabular font-semibold">{colleague.employeeNumber}</p>
            <p className="text-ink-muted">{colleague.displayName}</p>
          </div>
        )}

        <p className="mt-3 text-[11px] text-ink-muted">
          Zoeken kan alleen op volledig nummer en binnen uw eigen standplaats. Elke opzoeking
          wordt vastgelegd.
        </p>
      </WidgetCard>

      <WidgetCard
        title="3. Geldige ruilmogelijkheden"
        subtitle={
          selectedOwnDuty && colleague
            ? `Uw ${selectedOwnDuty.dutyCode} van ${formatCalendarDate(selectedOwnDuty.date)} tegen:`
            : "Kies eerst een eigen dienst en een collega."
        }
      >
        {!selectedOwnDuty || !colleague ? (
          <EmptyState>Nog niets te tonen.</EmptyState>
        ) : candidates.length === 0 ? (
          <EmptyState>
            Er is geen dienst van deze collega die voor u beiden een geldige ruil oplevert.
          </EmptyState>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {candidates.map((candidate) => (
              <li key={candidate.scheduledDutyId} className="rounded border border-line px-2 py-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div>
                    <p className="font-semibold">
                      <span className="font-mono">{candidate.dutyCode}</span>{" "}
                      <DateLabel date={candidate.date} />
                    </p>
                    <p className="text-[11px] text-ink-muted">
                      <DutyTimes start={candidate.startMinute} end={candidate.endMinute} />
                    </p>
                  </div>
                  <DutyKinds kinds={candidate.kinds} />
                </div>

                {candidate.warnings.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[11px] text-state-warn">
                    {candidate.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}

                <div className="mt-2">
                  <ActionForm action={stelRuilVoorAction} submitLabel="Voorstel versturen" compact>
                    <input type="hidden" name="ownScheduledDutyId" value={selectedOwnDuty.id} />
                    <input
                      type="hidden"
                      name="counterpartyScheduledDutyId"
                      value={candidate.scheduledDutyId}
                    />
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        )}
      </WidgetCard>
    </div>
  );
}
