import Link from "next/link";
import { listBaseRosters, listVersions, publicationStatus } from "@/server/services/roster-service";
import { RosterCommitteeShell } from "@/components/layout/area-shell";
import { ActionForm } from "@/components/ui/action-form";
import { Alert, Badge, EmptyState, StatCard, WidgetCard } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { MegaphoneIcon, ShieldIcon } from "@/components/ui/icons";
import { publiceerRoosterAction } from "../acties";

export const dynamic = "force-dynamic";

/**
 * Publiceren.
 *
 * Een versie wordt pas gepubliceerd nadat zij is gecontroleerd. De service
 * weigert een versie met harde overtredingen — dat is geen waarschuwing die je
 * kunt wegklikken maar een voorwaarde, want een gepubliceerd rooster is het
 * rooster waarop mensen hun leven inrichten.
 */
export default async function Publiceren() {
  const [status, rosters] = await Promise.all([publicationStatus(), listBaseRosters()]);
  const versionsPerRoster = await Promise.all(
    rosters.map(async (roster) => ({ roster, versions: await listVersions(roster.id) })),
  );
  const publishable = versionsPerRoster.filter((entry) => entry.versions.length > 0);

  return (
    <RosterCommitteeShell
      activeHref="/roostercommissie/publiceren"
      header={{
        title: "Publiceren",
        subtitle: "Gecontroleerde roosterversies vaststellen",
      }}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<MegaphoneIcon size={20} />}
          tone="rc"
          label="Gepubliceerd"
          value={status.publishedVersions}
          hint="versies"
        />
        <StatCard
          icon={<MegaphoneIcon size={20} />}
          tone="neutral"
          label="Concepten"
          value={status.draftVersions}
          hint="wachten op controle"
        />
        <StatCard
          icon={<ShieldIcon size={20} />}
          tone={status.hardViolations > 0 ? "error" : "ok"}
          label="Harde overtredingen"
          value={status.hardViolations}
          hint="blokkeren publicatie"
        />
        <StatCard
          icon={<MegaphoneIcon size={20} />}
          tone={status.lastPublishedAt ? "ok" : "warn"}
          label="Laatst gepubliceerd"
          value={
            status.lastPublishedAt ? status.lastPublishedAt.toLocaleDateString("nl-NL") : "nog niet"
          }
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <WidgetCard
            icon={<MegaphoneIcon size={18} />}
            tone="rc"
            title="Roosterversies"
            subtitle="Publiceren kan alleen zonder harde overtredingen"
          >
            {publishable.length === 0 ? (
              <div className="py-3">
                <EmptyState>
                  Er zijn nog geen roosterversies. Ze ontstaan zodra de rooster-engine een voorstel
                  oplevert.{" "}
                  <Link href="/roostercommissie/genereren" className="font-semibold underline">
                    Naar genereren
                  </Link>
                </EmptyState>
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Rooster</TH>
                    <TH>Versie</TH>
                    <TH>Status</TH>
                    <TH numeric>Overtredingen</TH>
                    <TH numeric>Waarschuwingen</TH>
                    <TH>Actie</TH>
                  </TR>
                </THead>
                <tbody>
                  {publishable.flatMap((entry) =>
                    entry.versions.map((version) => (
                      <TR key={version.id}>
                        <TD>
                          <span className="font-semibold">{entry.roster.code}</span>
                        </TD>
                        <TD>{version.label}</TD>
                        <TD>
                          <Badge tone={version.status === "PUBLISHED" ? "ok" : "neutral"}>
                            {version.status}
                          </Badge>
                        </TD>
                        <TD numeric>
                          {version.warnings.violation > 0 ? (
                            <span className="font-semibold text-state-error">
                              {version.warnings.violation}
                            </span>
                          ) : (
                            0
                          )}
                        </TD>
                        <TD numeric>{version.warnings.warning}</TD>
                        <TD>
                          {version.status === "PUBLISHED" ? (
                            <span className="text-[11.5px] text-ink-muted">Gepubliceerd</span>
                          ) : (
                            <ActionForm
                              action={publiceerRoosterAction}
                              submitLabel="Publiceren"
                              variant="outline-rc"
                              compact
                            >
                              <input type="hidden" name="versionId" value={version.id} />
                            </ActionForm>
                          )}
                        </TD>
                      </TR>
                    )),
                  )}
                </tbody>
              </Table>
            )}
          </WidgetCard>
        </div>

        <div className="space-y-4">
          <Alert tone="warn" title="Publiceren is onomkeerbaar in de praktijk">
            Zodra een rooster gepubliceerd is, richten mensen hun leven erop in. De controle vóór
            publicatie is daarom een voorwaarde en geen advies: een versie met harde overtredingen
            wordt door de server geweigerd.
          </Alert>

          <Alert tone="info" title="Vergelijk eerst">
            Leg de nieuwe versie naast de bestaande voordat u publiceert.{" "}
            <Link href="/roostercommissie/vergelijken" className="font-semibold underline">
              Naar vergelijken
            </Link>
          </Alert>
        </div>
      </div>
    </RosterCommitteeShell>
  );
}
