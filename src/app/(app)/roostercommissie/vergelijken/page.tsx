import { compareVersions, listBaseRosters, listVersions } from "@/server/services/roster-service";
import { RosterCommitteeShell } from "@/components/layout/area-shell";
import { Alert, EmptyState, WidgetCard, StatCard } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";

export const dynamic = "force-dynamic";

/**
 * Bestaand en nieuw rooster naast elkaar.
 *
 * De vergelijking gaat per cel (lijn, week, dag) en niet per rij, zodat een
 * versie met meer of minder lijnen geen verschoven overzicht oplevert maar een
 * eerlijke telling van wat er alleen links of alleen rechts staat.
 */
export default async function Vergelijken({ searchParams }: PageProps<"/roostercommissie/vergelijken">) {
  const params = await searchParams;
  const left = typeof params.links === "string" ? params.links : null;
  const right = typeof params.rechts === "string" ? params.rechts : null;

  const rosters = await listBaseRosters();
  const allVersions = (
    await Promise.all(
      rosters.map(async (roster) =>
        (await listVersions(roster.id)).map((version) => ({
          ...version,
          rosterCode: roster.code,
        })),
      ),
    )
  ).flat();

  const diff = left && right && left !== right ? await compareVersions(left, right) : null;

  return (
    <RosterCommitteeShell
      activeHref="/roostercommissie/vergelijken"
      header={{ title: "Roosters vergelijken", subtitle: "Bestaand naast nieuw, per lijn, week en dag" }}
    >

      <WidgetCard title="Versies kiezen">
        {allVersions.length < 2 ? (
          <EmptyState>
            Er zijn minder dan twee roosterversies om te vergelijken. Versies ontstaan zodra de
            rooster-engine een voorstel oplevert of een variant handmatig wordt vastgelegd.
          </EmptyState>
        ) : (
          <form className="flex flex-wrap items-end gap-3 text-xs">
            <label className="flex flex-col gap-0.5">
              <span className="text-[11px] text-ink-muted">Bestaand (links)</span>
              <select
                name="links"
                defaultValue={left ?? ""}
                className="rounded border border-line-strong px-2 py-1"
              >
                <option value="">Kies…</option>
                {allVersions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.rosterCode} — {version.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[11px] text-ink-muted">Nieuw (rechts)</span>
              <select
                name="rechts"
                defaultValue={right ?? ""}
                className="rounded border border-line-strong px-2 py-1"
              >
                <option value="">Kies…</option>
                {allVersions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.rosterCode} — {version.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded bg-ns-blue px-3 py-1.5 font-semibold text-white hover:bg-ns-blue-dark"
            >
              Vergelijken
            </button>
          </form>
        )}
      </WidgetCard>

      {left && right && left === right && (
        <div className="mt-4">
          <Alert tone="warn">Kies twee verschillende versies.</Alert>
        </div>
      )}

      {diff && (
        <>
          <div className="my-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label="Gewijzigde dagen"
              value={diff.changed.length}
              tone={diff.changed.length > 0 ? "warn" : "neutral"}
            />
            <StatCard label="Ongewijzigd" value={diff.unchangedCount} />
            <StatCard label="Alleen links" value={diff.onlyInLeft} />
            <StatCard label="Alleen rechts" value={diff.onlyInRight} />
          </div>

          <WidgetCard
            title="Verschillen"
            subtitle={`${diff.leftLabel} tegenover ${diff.rightLabel}`}
          >
            {diff.changed.length === 0 ? (
              <EmptyState>Deze twee versies zijn op elke dag gelijk.</EmptyState>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH numeric>Lijn</TH>
                    <TH numeric>Week</TH>
                    <TH>Dag</TH>
                    <TH>{diff.leftLabel}</TH>
                    <TH>{diff.rightLabel}</TH>
                  </TR>
                </THead>
                <tbody>
                  {diff.changed.map((cell) => (
                    <TR key={`${cell.lineNumber}-${cell.weekIndex}-${cell.weekday}`}>
                      <TD numeric>{cell.lineNumber}</TD>
                      <TD numeric>{cell.weekIndex}</TD>
                      <TD>{cell.weekdayLabel}</TD>
                      <TD mono>
                        <span className="rounded bg-state-error-soft px-1 text-state-error">
                          {cell.before}
                        </span>
                      </TD>
                      <TD mono>
                        <span className="rounded bg-state-ok-soft px-1 text-state-ok">
                          {cell.after}
                        </span>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            )}
          </WidgetCard>
        </>
      )}
    </RosterCommitteeShell>
  );
}
