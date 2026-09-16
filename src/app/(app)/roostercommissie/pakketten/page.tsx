import { toCalendarDate } from "@/domain/time";
import {
  PERIOD_LABELS,
  WORK_TYPE_LABELS,
  dutyExceptionTable,
  dutyRangeTable,
} from "@/domain/duty-classification";
import { listDutyPackages } from "@/server/services/duty-package-service";
import { listLocations } from "@/server/services/location-service";
import { DUTY_PACKAGE_EXAMPLE } from "@/server/validation/duty-package";
import { ALLOWED_EXTENSIONS, MAX_IMPORT_BYTES } from "@/server/import/file-safety";
import { RosterCommitteeShell } from "@/components/layout/area-shell";
import { LocationSelector } from "@/components/layout/location-selector";
import { ActionForm } from "@/components/ui/action-form";
import { Alert, Badge, EmptyState, WidgetCard, inputClass } from "@/components/ui/primitives";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import {
  activeerPakketAction,
  bevestigPakketAction,
  importeerBestandAction,
  importeerPakketAction,
} from "../acties";

export const dynamic = "force-dynamic";

/**
 * De importcontrole.
 *
 * Het formulier controleert standaard alleen. Pas wanneer de planner het
 * vinkje zet, wordt er iets vastgelegd — en zelfs dan is het pakket nog niet in
 * gebruik. Dat is drie handelingen voor één levering, en dat is met opzet: wie
 * 218 diensten in het rooster laat landen, hoort daar drie keer bewust ja op te
 * hebben gezegd.
 */

const STATUS_LABELS: Record<string, string> = {
  UPLOADED: "Ontvangen",
  PARSED: "Gelezen",
  NORMALIZED: "Genormaliseerd",
  VALIDATED: "Gecontroleerd",
  REVIEW_REQUIRED: "Beoordeling nodig",
  CONFIRMED: "Bevestigd",
  ACTIVE: "Actieve dienstvoorraad",
  SUPERSEDED: "Vervangen",
  ARCHIVED: "Gearchiveerd",
  REJECTED: "Afgewezen",
  DRAFT: "Concept",
};

const STATUS_TONE: Record<string, "ok" | "warn" | "neutral"> = {
  ACTIVE: "ok",
  CONFIRMED: "ok",
  REVIEW_REQUIRED: "warn",
  REJECTED: "warn",
};

export default async function Dienstenpakketten({
  searchParams,
}: {
  searchParams: Promise<{ standplaats?: string }>;
}) {
  const { standplaats } = await searchParams;
  const [packages, locations] = await Promise.all([
    listDutyPackages(standplaats ?? null),
    listLocations(),
  ]);
  const today = toCalendarDate(new Date());
  const ingericht = locations.filter((location) => location.planningEnabled);

  return (
    <RosterCommitteeShell
      activeHref="/roostercommissie/pakketten"
      header={{
        title: "Dienstenpakketten",
        subtitle: "Eerst controleren, dan vastleggen, dan pas in gebruik nemen",
      }}
    >
      <div className="mb-3">
        <LocationSelector requested={standplaats ?? null} />
      </div>

      <WidgetCard
        title="Een pakket aanleveren"
        subtitle="Drie manieren, dezelfde controle erna"
        bodyClassName="border-t border-line p-4"
      >
        <ol className="grid gap-3 md:grid-cols-3">
          <li className="rounded-lg border border-line bg-canvas p-3">
            <p className="text-[12px] font-semibold text-ink">1. Sjabloon ophalen</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
              Het Excel-sjabloon komt gevuld met de diensten die er nu zijn. Eén rij per dienst
              per weekdag: dag, dienstnummer en diensttijd elk in hun eigen kolom.
            </p>
            <a
              className="mt-2 inline-block rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-canvas"
              href={`/roostercommissie/pakketten/sjabloon?standplaats=${
                standplaats ?? ingericht[0]?.code ?? "DDR"
              }&dienstregeling=HUIDIG`}
            >
              Sjabloon downloaden
            </a>
          </li>
          <li className="rounded-lg border border-line bg-canvas p-3">
            <p className="text-[12px] font-semibold text-ink">2. Invullen</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
              Dag: maandag tot en met zondag, voluit. Diensttijd in de vorm{" "}
              <span className="font-mono">04:27 / 11:07</span>. Een eindtijd vóór de begintijd
              betekent de volgende dag. Rijdt een dienst die dag niet, laat de rij dan gewoon weg.
            </p>
          </li>
          <li className="rounded-lg border border-line bg-canvas p-3">
            <p className="text-[12px] font-semibold text-ink">3. Terugsturen</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
              Hieronder inlezen. Er wordt eerst alleen gecontroleerd; vastleggen gebeurt pas met
              het vinkje, en in gebruik nemen is daarna nog een aparte handeling.
            </p>
          </li>
        </ol>
      </WidgetCard>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <WidgetCard
          title="Bestand inlezen"
          subtitle="Ingevuld Excel-sjabloon of PDF-document"
          bodyClassName="border-t border-line p-4"
        >
          <ActionForm action={importeerBestandAction} submitLabel="Controleren">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-ink">
                Standplaats
                <select
                  name="locationCode"
                  required
                  className={inputClass}
                  defaultValue={standplaats ?? ingericht[0]?.code ?? ""}
                >
                  {locations.map((location) => (
                    <option key={location.code} value={location.code}>
                      {location.code} — {location.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-ink">
                Dienstregeling
                <input
                  name="timetableId"
                  required
                  defaultValue="HUIDIG"
                  className={inputClass}
                />
              </label>
            </div>
            <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-ink">
              Geldig vanaf
              <input
                type="date"
                name="validFrom"
                required
                defaultValue={today}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-ink">
              Bestand
              <input
                type="file"
                name="bestand"
                required
                accept=".xlsx,.pdf"
                className={`${inputClass} py-1`}
              />
            </label>
            <label className="flex items-start gap-2 text-[11px] text-ink">
              <input type="checkbox" name="bevestigd" value="ja" className="mt-0.5" />
              <span>
                De controle is nagekeken; leg deze levering vast als nieuwe versie. Zonder dit
                vinkje wordt alleen gecontroleerd en verandert er niets.
              </span>
            </label>
            <p className="text-[11px] leading-relaxed text-ink-muted">
              Een PDF levert altijd een voorstel op dat nagelopen moet worden: een document kent
              geen kolommen, dus welke weekdag bij welk tijdvak hoort, is er niet met zekerheid
              uit af te lezen. Werkmappen met macro&apos;s worden niet geopend, formules worden
              niet uitgerekend, en van elk bestand wordt een SHA-256 bewaard.
            </p>
          </ActionForm>
        </WidgetCard>

        <WidgetCard title="Levering inlezen">
          <ActionForm action={importeerPakketAction} submitLabel="Controleren">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-ink">
                Standplaats
                <select name="locationCode" required className={inputClass} defaultValue={ingericht[0]?.code ?? ""}>
                  {locations.map((location) => (
                    <option key={location.code} value={location.code}>
                      {location.code} — {location.name}
                      {location.planningEnabled ? "" : " (nog niet ingericht)"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-ink">
                Dienstregeling
                <input
                  name="timetableId"
                  required
                  placeholder="DR2027"
                  className={inputClass}
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-ink">
                Geldig vanaf
                <input
                  type="date"
                  name="validFrom"
                  required
                  defaultValue={today}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-ink">
                Bestandsnaam (voor het spoor)
                <input name="filename" placeholder="pakket-2027.csv" className={inputClass} />
              </label>
            </div>
            <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-ink">
              Inhoud
              <textarea
                name="content"
                required
                rows={10}
                defaultValue={DUTY_PACKAGE_EXAMPLE}
                className={`${inputClass} font-mono text-[11px]`}
              />
            </label>
            <label className="flex items-start gap-2 text-[11px] text-ink">
              <input type="checkbox" name="bevestigd" value="ja" className="mt-0.5" />
              <span>
                De controle is nagekeken; leg deze levering vast als nieuwe versie. Zonder dit
                vinkje wordt alleen gecontroleerd en verandert er niets.
              </span>
            </label>
            <p className="text-[11px] text-ink-muted">
              Toegestaan: {ALLOWED_EXTENSIONS.join(", ")}, tot{" "}
              {MAX_IMPORT_BYTES / 1024 / 1024} MB. Het bestand wordt als tekst gelezen en nooit
              uitgevoerd. Van de inhoud wordt een SHA-256 bewaard; hetzelfde bestand tweemaal
              aanleveren wordt herkend.
            </p>
          </ActionForm>
        </WidgetCard>

        <div className="space-y-4">
          <WidgetCard title="Dienstclassificatie" subtitle="Zoals het systeem dienstnummers leest.">
            <Table>
              <THead>
                <TR>
                  <TH>Bereik</TH>
                  <TH>Soort</TH>
                </TR>
              </THead>
              <tbody>
                {dutyRangeTable().map((range) => (
                  <TR key={range.label}>
                    <TD mono>
                      {range.from}–{range.to}
                    </TD>
                    <TD>{range.label}</TD>
                  </TR>
                ))}
                {[...dutyExceptionTable().entries()].map(([code, classification]) => (
                  <TR key={code}>
                    <TD mono>{code}</TD>
                    <TD>
                      <span className="flex flex-wrap gap-1">
                        <Badge tone="warn">{PERIOD_LABELS[classification.period]}</Badge>
                        <Badge tone="warn">{WORK_TYPE_LABELS[classification.workType]}</Badge>
                      </span>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <p className="mt-2 text-[11px] text-ink-muted">
              Een dienst kan tegelijk een dagdeel en een werksoort hebben: rangeerwerk dat
              &apos;s nachts rijdt is nachtwerk én rangeerwerk. Beide worden apart bewaard, zodat
              het dagdeel meetelt in de nachtreeksregel en de werksoort in de bevoegdheden.
            </p>
          </WidgetCard>

          <Alert tone="neutral" title="Voorlopige indeling">
            Deze bereiken zijn de indeling uit de functionele uitgangspunten en zijn nog niet
            formeel bevestigd. Ze staan op één plek in de code
            (<span className="font-mono text-[11px]">src/domain/duty-classification.ts</span>) en
            zijn daar in hun geheel aan te passen.
          </Alert>
        </div>
      </div>

      <div className="mt-4">
        <WidgetCard
          title="Geïmporteerde pakketten"
          subtitle="Bevestigen bevestigt de levering; activeren maakt haar leidend."
        >
          {packages.length === 0 ? (
            <EmptyState>Er is nog geen dienstenpakket geïmporteerd.</EmptyState>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Label</TH>
                  <TH>Standplaats</TH>
                  <TH numeric>Diensten</TH>
                  <TH numeric>Bevindingen</TH>
                  <TH>Bestand</TH>
                  <TH>Geïmporteerd</TH>
                  <TH>Checksum</TH>
                  <TH>Status</TH>
                  <TH>Actie</TH>
                </TR>
              </THead>
              <tbody>
                {packages.map((pkg) => (
                  <TR key={pkg.id}>
                    <TD mono>{pkg.label}</TD>
                    <TD>{pkg.depot}</TD>
                    <TD numeric>{pkg.dutyCount}</TD>
                    <TD numeric>{pkg.problemCount}</TD>
                    <TD>
                      <span className="text-[11px] text-ink-muted">{pkg.filename}</span>
                    </TD>
                    <TD>
                      <span className="tabular text-[11px]">
                        {pkg.importedAt.toLocaleDateString("nl-NL")}
                      </span>
                    </TD>
                    <TD mono>
                      <span className="text-[10px] text-ink-muted">
                        {pkg.checksum.slice(0, 12)}…
                      </span>
                    </TD>
                    <TD>
                      <Badge tone={STATUS_TONE[pkg.status] ?? "neutral"}>
                        {STATUS_LABELS[pkg.status] ?? pkg.status}
                      </Badge>
                    </TD>
                    <TD>
                      {pkg.status === "ACTIVE" ? (
                        <span className="text-[11px] text-ink-muted">In gebruik</span>
                      ) : pkg.status === "CONFIRMED" ? (
                        <ActionForm
                          action={activeerPakketAction}
                          submitLabel="In gebruik nemen"
                          variant="secondary"
                          compact
                        >
                          <input type="hidden" name="packageId" value={pkg.id} />
                        </ActionForm>
                      ) : pkg.status === "VALIDATED" || pkg.status === "REVIEW_REQUIRED" ? (
                        <ActionForm
                          action={bevestigPakketAction}
                          submitLabel="Bevestigen"
                          variant="secondary"
                          compact
                        >
                          <input type="hidden" name="packageId" value={pkg.id} />
                        </ActionForm>
                      ) : (
                        <span className="text-[11px] text-ink-muted">—</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </WidgetCard>
      </div>
    </RosterCommitteeShell>
  );
}
