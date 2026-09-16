import Link from "next/link";
import { profileQuality, publicationStatus } from "@/server/services/roster-service";
import { feedbackReport } from "@/server/services/feedback-service";
import { RosterCommitteeShell } from "@/components/layout/area-shell";
import {
  Alert,
  Badge,
  EmptyState,
  LinkButton,
  Meter,
  StatCard,
  StatusDot,
  WidgetCard,
  WidgetRow,
} from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import {
  BarChartIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClipboardListIcon,
  CompareIcon,
  FileTextIcon,
  GridIcon,
  MegaphoneIcon,
  PieChartIcon,
  ShieldIcon,
  SparkIcon,
} from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Het dashboard van de Rooster Commissie.
 *
 * ## Waar dit onderdeel over gaat, en waar niet
 *
 * Uitsluitend over het samenstellen en publiceren van **basisroosters** voor
 * een nieuwe dienstregeling. Er staat hier niets over de dienst van morgen, over
 * wie er ziek is of over een dienst die nog ingevuld moet worden. Dat is
 * dagelijkse operatie, dat hoort bij Dienstindeling, en het staat daar.
 *
 * Die scheiding is niet alleen een indeling van schermen: de Rooster Commissie
 * heeft geen enkel recht dat een dienst toewijst, en Dienstindeling heeft geen
 * enkel recht dat een basisrooster wijzigt. Zie de rechtentabel.
 */
export default async function RoosterCommissieDashboard() {
  const [status, profiles, feedback] = await Promise.all([
    publicationStatus(),
    profileQuality(),
    feedbackReport(),
  ]);

  const topSignals = feedback.aggregates
    .flatMap((aggregate) =>
      aggregate.categories.map((category) => ({
        profileLabel: aggregate.profileLabel,
        label: category.label,
        share: category.share,
        respondents: aggregate.respondents,
      })),
    )
    .sort((a, b) => b.share - a.share)
    .slice(0, 5);

  return (
    <RosterCommitteeShell
      activeHref="/roostercommissie"
      header={{
        title: "Rooster Commissie",
        subtitle: "Basisroosters samenstellen, analyseren en publiceren",
        context: (
          <span className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink">
            <CalendarIcon size={15} />
            {status.activePackage
              ? `${status.activePackage.name} v${status.activePackage.version}`
              : "Geen actief dienstenpakket"}
          </span>
        ),
        notificationCount: status.hardViolations,
      }}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatCard
          icon={<GridIcon size={20} />}
          tone="rc"
          label="Basisroosters"
          value={`${status.activeBaseRosters}/${status.baseRosters}`}
          hint="actief van totaal"
          href="/roostercommissie/roosters"
          linkLabel="Naar roosters"
        />
        <StatCard
          icon={<ClipboardListIcon size={20} />}
          tone="info"
          label="Roosterlijnen"
          value={status.rosterLines}
          hint="regels in alle roosters"
          href="/roostercommissie/profielen"
          linkLabel="Naar profielen"
        />
        <StatCard
          icon={<FileTextIcon size={20} />}
          tone="neutral"
          label="Concepten"
          value={status.draftVersions}
          hint="nog niet gepubliceerd"
          href="/roostercommissie/genereren"
          linkLabel="Naar genereren"
        />
        <StatCard
          icon={<ShieldIcon size={20} />}
          tone={status.hardViolations > 0 ? "error" : "ok"}
          label="Harde overtredingen"
          value={status.hardViolations}
          hint={`${status.warnings} waarschuwingen`}
          href="/roostercommissie/analyse"
          linkLabel="Naar analyse"
        />
        <StatCard
          icon={<PieChartIcon size={20} />}
          tone="info"
          label="Feedback"
          value={`${feedback.aggregates.reduce((sum, item) => sum + (item.respondents ?? 0), 0)}`}
          hint={`reacties in ${feedback.quarterKey}`}
          href="/roostercommissie/feedback"
          linkLabel="Naar feedback"
        />
        <StatCard
          icon={<MegaphoneIcon size={20} />}
          tone={status.lastPublishedAt ? "ok" : "warn"}
          label="Laatst gepubliceerd"
          value={
            status.lastPublishedAt
              ? status.lastPublishedAt.toLocaleDateString("nl-NL")
              : "nog niet"
          }
          hint={`${status.publishedVersions} gepubliceerde versies`}
          href="/roostercommissie/publiceren"
          linkLabel="Naar publiceren"
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <WidgetCard
            icon={<BarChartIcon size={18} />}
            tone="rc"
            title="Samenstelling per roosterprofiel"
            subtitle="Feitelijke verdeling over de komende vier weken"
            actions={
              <Link
                href="/roostercommissie/analyse"
                className="text-[12px] font-semibold text-accent-rc hover:underline"
              >
                Naar volledige analyse
              </Link>
            }
          >
            {profiles.length === 0 ? (
              <div className="py-3">
                <EmptyState>Er zijn nog geen basisroosters ingericht.</EmptyState>
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Profiel</TH>
                    <TH numeric>Lijnen</TH>
                    <TH numeric>Bezet</TH>
                    <TH numeric>Vroeg</TH>
                    <TH numeric>Laat</TH>
                    <TH numeric>Nacht</TH>
                    <TH numeric>Rangeer</TH>
                    <TH>Weekendbelasting</TH>
                  </TR>
                </THead>
                <tbody>
                  {profiles.map((profile) => (
                    <TR key={profile.profile}>
                      <TD>
                        <span className="font-semibold text-ink-strong">
                          {profile.profileLabel}
                        </span>
                      </TD>
                      <TD numeric>{profile.lines}</TD>
                      <TD numeric>{profile.occupiedLines}</TD>
                      <TD numeric>{share(profile.shareEarly)}</TD>
                      <TD numeric>{share(profile.shareLate)}</TD>
                      <TD numeric>{share(profile.shareNight)}</TD>
                      <TD numeric>{share(profile.shareShunting)}</TD>
                      <TD>
                        <span className="flex items-center gap-2">
                          <Meter value={profile.weekendLoad} tone="rc" />
                          <span className="tabular w-9 text-right text-[11.5px] text-ink-muted">
                            {share(profile.weekendLoad)}
                          </span>
                        </span>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            )}
          </WidgetCard>
        </div>

        <WidgetCard
          icon={<PieChartIcon size={18} />}
          tone="info"
          title="Feedback, geaggregeerd"
          subtitle={`${feedback.quarterKey} — nooit herleidbaar naar een persoon`}
          footer={
            <LinkButton href="/roostercommissie/feedback" variant="secondary" block>
              Volledig feedbackoverzicht
            </LinkButton>
          }
        >
          {topSignals.length === 0 ? (
            <div className="py-3">
              <EmptyState>
                Nog geen resultaten die aan de privacydrempel voldoen.
              </EmptyState>
            </div>
          ) : (
            topSignals.map((signal) => (
              <div
                key={`${signal.profileLabel}-${signal.label}`}
                className="border-b border-line/70 py-2.5 last:border-0"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12.5px] text-ink">
                    <span className="font-semibold">{signal.profileLabel}</span> — {signal.label}
                  </span>
                  <span className="tabular shrink-0 text-[13px] font-semibold text-ink-strong">
                    {Math.round(signal.share * 100)}%
                  </span>
                </div>
                <div className="mt-1.5">
                  <Meter value={signal.share} tone="info" />
                </div>
              </div>
            ))
          )}
        </WidgetCard>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <WidgetCard
          icon={<SparkIcon size={18} />}
          tone="rc"
          title="Genereren & simulatie"
          subtitle="Alle basisroosters tegelijk optimaliseren"
          footer={
            <LinkButton href="/roostercommissie/genereren" block>
              Naar genereren
            </LinkButton>
          }
        >
          <p className="py-2.5 text-[12.5px] text-ink-muted">
            De opdracht bevat álle geselecteerde basisroosters in één keer, plus de medewerkers,
            de diensten, de doelstellingen en de geaggregeerde feedback. Eén rooster eerst vullen
            en de rest de restdiensten geven, is met dit contract niet mogelijk.
          </p>
          <WidgetRow
            icon={<CheckCircleIcon size={15} />}
            label="Optimizer"
            value="CP-SAT, actief"
            valueTone="ok"
          />
        </WidgetCard>

        <WidgetCard
          icon={<CompareIcon size={18} />}
          tone="neutral"
          title="Vergelijken & publiceren"
          subtitle="Bestaand naast nieuw, daarna vaststellen"
          footer={
            <LinkButton href="/roostercommissie/vergelijken" variant="secondary" block>
              Versies vergelijken
            </LinkButton>
          }
        >
          <WidgetRow
            icon={<FileTextIcon size={15} />}
            label="Concepten"
            value={status.draftVersions}
          />
          <WidgetRow
            icon={<MegaphoneIcon size={15} />}
            label="Gepubliceerde versies"
            value={status.publishedVersions}
          />
          <WidgetRow
            icon={<ClipboardListIcon size={15} />}
            label="Wachtlijstinschrijvingen"
            value={status.waitlistEntries}
          />
        </WidgetCard>

        <WidgetCard
          icon={<ShieldIcon size={18} />}
          tone={status.hardViolations > 0 ? "error" : "ok"}
          title="Controles"
          subtitle="Uit de rules engine, niet uit losse code"
          footer={
            <LinkButton href="/regels" variant="secondary" block>
              Bekijk de regelcatalogus
            </LinkButton>
          }
        >
          <WidgetRow
            icon={<ShieldIcon size={15} />}
            label="Harde overtredingen"
            value={status.hardViolations}
            valueTone={status.hardViolations > 0 ? "error" : "ok"}
          />
          <WidgetRow
            icon={<CheckCircleIcon size={15} />}
            label="Waarschuwingen"
            value={status.warnings}
            valueTone={status.warnings > 0 ? "warn" : "ok"}
          />
          <div className="py-2.5">
            <StatusDot tone="neutral">
              <span className="text-[12px] text-ink-muted">
                Grenswaarden zijn voorlopig en nog niet tegen cao en ATW getoetst.
              </span>
            </StatusDot>
          </div>
        </WidgetCard>
      </div>

      <div className="mt-4">
        <Alert tone="neutral" title="Wat hier bewust niet staat">
          Geen openstaande diensten, geen zieke medewerkers, geen individuele treintaken. De
          Rooster Commissie stelt roosterstructuren samen; het invullen van de dag hoort bij
          Dienstindeling. <Badge tone="did">Dienstindeling</Badge> is een aparte omgeving met
          eigen rechten.
        </Alert>
      </div>
    </RosterCommitteeShell>
  );
}

function share(value: number): string {
  return `${Math.round(value * 100)}%`;
}
