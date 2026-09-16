import Link from "next/link";
import { notFound } from "next/navigation";
import { NOT_CONFIGURED_MESSAGE } from "@/domain/locations";
import { locationByCode, readinessOf } from "@/server/services/location-service";
import { listDutyPackages } from "@/server/services/duty-package-service";
import { AdminShell } from "@/components/layout/area-shell";
import { Alert, Badge, EmptyState, WidgetCard } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";

export const dynamic = "force-dynamic";

/**
 * Eén standplaats.
 *
 * ## Wat hier bewust niet staat
 *
 * Voor een standplaats die nog niet is ingericht, staat hier geen voorbeeld,
 * geen voorbeeldrooster en geen overgenomen Dordrechtregel. Zo'n invulling
 * oogt behulpzaam en is het tegendeel: ze suggereert dat er iets bekend is over
 * hoe er in Rotterdam of Amsterdam wordt gepland, en dat is niet zo. Er staat
 * wat er is, en verder staat er wat er ontbreekt.
 */

export default async function Standplaats({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const location = await locationByCode(code.toUpperCase());
  if (!location) {
    notFound();
  }

  const [readiness, packages] = await Promise.all([
    readinessOf(location.code),
    listDutyPackages(location.code),
  ]);

  const checks: { label: string; ok: boolean }[] = [
    { label: "Dienstenpakket geïmporteerd", ok: readiness.dutiesImported },
    { label: "Roosterprofielen ingericht", ok: readiness.rosterProfilesConfigured },
    { label: "Lokale regels ingericht", ok: readiness.localRulesConfigured },
    { label: "Bevoegdheden vastgelegd", ok: readiness.qualificationsConfigured },
    { label: "Exportsjabloon ingericht", ok: readiness.exportTemplateConfigured },
    { label: "Juridische regelverzameling gevalideerd", ok: readiness.legalRulesetValid },
  ];

  return (
    <AdminShell
      activeHref="/beheer/organisatie"
      header={{
        title: `${location.code} — ${location.name}`,
        subtitle: `${location.regionName}${location.units.length > 0 ? ` · ${location.units.length} planeenheden` : ""}`,
      }}
    >
      <p className="mb-3 text-[11px]">
        <Link href="/beheer/organisatie" className="underline text-ink-muted">
          ← Alle standplaatsen
        </Link>
      </p>

      {!location.planningEnabled && (
        <Alert tone="warn" title="Nog niet ingericht">
          {NOT_CONFIGURED_MESSAGE} Er worden voor deze standplaats geen diensten, roosters of
          regels getoond, en er wordt niets overgenomen van een andere standplaats.
        </Alert>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <WidgetCard
          title="Wat er nodig is om te kunnen plannen"
          subtitle={
            readiness.ready
              ? "Alles aanwezig."
              : `${readiness.missing.length} van de ${checks.length} punten ontbreken nog.`
          }
        >
          <Table>
            <THead>
              <TR>
                <TH>Onderdeel</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <tbody>
              {checks.map((check) => (
                <TR key={check.label}>
                  <TD>{check.label}</TD>
                  <TD>
                    <Badge tone={check.ok ? "ok" : "neutral"}>
                      {check.ok ? "Aanwezig" : "Ontbreekt"}
                    </Badge>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
          <p className="mt-2 text-[11px] text-ink-muted">
            Plannen gaat pas aan wanneer al deze punten kloppen. Er is geen knop om dat te
            overrulen: een standplaats die er werkend uitziet en het niet is, levert een rooster
            op dat nergens op stoelt.
          </p>
        </WidgetCard>

        <WidgetCard title="Planeenheden">
          {location.units.length === 0 ? (
            <EmptyState>Deze standplaats is niet onderverdeeld.</EmptyState>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Code</TH>
                  <TH>Naam</TH>
                </TR>
              </THead>
              <tbody>
                {location.units.map((unit) => (
                  <TR key={unit.code}>
                    <TD mono>{unit.code}</TD>
                    <TD>{unit.name}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </WidgetCard>
      </div>

      <div className="mt-4">
        <WidgetCard title="Dienstenpakketten van deze standplaats">
          {packages.length === 0 ? (
            <EmptyState>
              Voor {location.code} is nog geen dienstenpakket geïmporteerd.
            </EmptyState>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Label</TH>
                  <TH>Dienstregeling</TH>
                  <TH numeric>Diensten</TH>
                  <TH>Status</TH>
                  <TH>Geïmporteerd</TH>
                </TR>
              </THead>
              <tbody>
                {packages.map((pkg) => (
                  <TR key={pkg.id}>
                    <TD mono>{pkg.label}</TD>
                    <TD mono>{pkg.timetableId}</TD>
                    <TD numeric>{pkg.dutyCount}</TD>
                    <TD>
                      <Badge tone={pkg.status === "ACTIVE" ? "ok" : "neutral"}>{pkg.status}</Badge>
                    </TD>
                    <TD>
                      <span className="tabular text-[11px]">
                        {pkg.importedAt.toLocaleDateString("nl-NL")}
                      </span>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </WidgetCard>
      </div>
    </AdminShell>
  );
}
