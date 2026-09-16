import { RosterProfile } from "@/lib/generated/prisma/enums";
import {
  allowedKindsForProfile,
  forbiddenKindsForProfile,
  rosterProfileLabel,
} from "@/domain/roster-profiles";
import { dutyKindLabel } from "@/domain/duty-classification";
import { listBaseRosters } from "@/server/services/roster-service";
import { allRosterHours } from "@/server/services/roster-hours-service";
import { formatHoursMinutes } from "@/domain/roster-hours";
import { RosterCommitteeShell } from "@/components/layout/area-shell";
import { Alert, Badge, EmptyState, WidgetCard } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { GridIcon, ShieldIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

const PROFILE_ORDER: readonly RosterProfile[] = [
  RosterProfile.VROEG,
  RosterProfile.VROEG_LAAT,
  RosterProfile.LAAT,
  RosterProfile.LAAT_NACHT,
  RosterProfile.MIX,
];

/**
 * De roosterprofielen en hun harde grenzen.
 *
 * Deze pagina leest de grenzen uit de domeinlaag, niet uit een tekst. Wat hier
 * staat is dus wat de rules engine daadwerkelijk afdwingt — er kan geen verschil
 * ontstaan tussen de uitleg en het gedrag.
 */
export default async function Roosterprofielen() {
  const [rosters, uren] = await Promise.all([listBaseRosters(), allRosterHours()]);
  const perRooster = new Map(uren.map((rij) => [rij.rosterCode, rij]));

  return (
    <RosterCommitteeShell
      activeHref="/roostercommissie/profielen"
      header={{
        title: "Roosterprofielen",
        subtitle: "Harde categoriegrenzen per profiel, rechtstreeks uit de regels gelezen",
      }}
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <WidgetCard
          icon={<ShieldIcon size={18} />}
          tone="rc"
          title="Grenzen per profiel"
          subtitle="Een harde grens, geen voorkeur"
        >
          <Table>
            <THead>
              <TR>
                <TH>Profiel</TH>
                <TH>Toegestaan</TH>
                <TH>Uitgesloten</TH>
              </TR>
            </THead>
            <tbody>
              {PROFILE_ORDER.map((profile) => (
                <TR key={profile}>
                  <TD>
                    <span className="font-semibold text-ink-strong">
                      {rosterProfileLabel(profile)}
                    </span>
                  </TD>
                  <TD>
                    <span className="flex flex-wrap gap-1">
                      {allowedKindsForProfile(profile).map((kind) => (
                        <Badge key={kind} tone="ok">
                          {dutyKindLabel(kind)}
                        </Badge>
                      ))}
                    </span>
                  </TD>
                  <TD>
                    {forbiddenKindsForProfile(profile).length === 0 ? (
                      <span className="text-[11.5px] text-ink-muted">niets</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {forbiddenKindsForProfile(profile).map((kind) => (
                          <Badge key={kind} tone="error">
                            {dutyKindLabel(kind)}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </WidgetCard>

        <div className="space-y-4">
          <Alert tone="neutral" title="Nog aan te leveren">
            De bijzondere regels voor Mix, BLM en 50+ Mix zijn nog niet bekend. Zij worden
            toegevoegd in de regelconfiguratie en niet verspreid over componenten, zodat de
            uitbreiding op één plek gebeurt.
          </Alert>
        </div>
      </div>

      <div className="mt-4">
        <WidgetCard
          icon={<GridIcon size={18} />}
          tone="info"
          title="Basisroosters per profiel"
          subtitle="Alle roosters van deze standplaats, met hun gemiddelde weeklengte"
        >
          {rosters.length === 0 ? (
            <div className="py-3">
              <EmptyState>Er zijn nog geen basisroosters ingericht.</EmptyState>
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Code</TH>
                  <TH>Naam</TH>
                  <TH>Profiel</TH>
                  <TH>Standplaats</TH>
                  <TH numeric>Cyclus</TH>
                  <TH numeric>Lijnen</TH>
                  <TH numeric>Bezet</TH>
                  <TH numeric>Wachtlijst</TH>
                  <TH numeric>Roosteruren</TH>
                  <TH numeric>Gem. per week</TH>
                </TR>
              </THead>
              <tbody>
                {rosters.map((roster) => {
                  const uur = perRooster.get(roster.code);
                  return (
                    <TR key={roster.id}>
                      <TD>
                        <span className="font-semibold text-ink-strong">{roster.code}</span>
                      </TD>
                      <TD>{roster.name}</TD>
                      <TD>
                        <Badge tone="rc">{roster.profileLabel}</Badge>
                      </TD>
                      <TD>{roster.depot}</TD>
                      <TD numeric>{roster.cycleWeeks} wk</TD>
                      <TD numeric>{roster.lines}</TD>
                      <TD numeric>{roster.occupiedLines}</TD>
                      <TD numeric>{roster.waiting}</TD>
                      <TD numeric>
                        {uur ? formatHoursMinutes(uur.hours.totalCreditMinutes) : "—"}
                      </TD>
                      <TD numeric>
                        {uur ? (
                          // Het gemiddelde per week over de hele cyclus van dít
                          // rooster. Niet het gemiddelde van alle roosters bij
                          // elkaar: dat zou een te korte cyclus laten wegvallen
                          // tegen een te lange.
                          <span
                            className={
                              uur.verdict === "OP_DOEL"
                                ? "font-semibold text-state-ok"
                                : uur.verdict === "AFWIJKING"
                                  ? "font-semibold text-state-warn"
                                  : "text-ink-muted"
                            }
                            title={uur.notice ?? undefined}
                          >
                            {formatHoursMinutes(uur.hours.averageWeeklyCreditMinutes)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          )}
        </WidgetCard>
      </div>
    </RosterCommitteeShell>
  );
}
