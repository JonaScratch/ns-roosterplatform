import Link from "next/link";
import { toCalendarDate } from "@/domain/time";
import { DutyAssignmentShell } from "@/components/layout/area-shell";
import { Alert, WidgetCard, inputClass } from "@/components/ui/primitives";
import { DownloadIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Export van de dagplanning.
 *
 * De export bevat personeelsnummers en geen namen. Een export verlaat het
 * systeem en is daarmee de plek waar privacy het snelst weglekt; de beperking
 * zit daarom in de export zelf en niet in een instelling die iemand kan
 * omzetten.
 */
export default async function Exporteren({
  searchParams,
}: PageProps<"/dienstindeling/exporteren">) {
  const params = await searchParams;
  const date = typeof params.datum === "string" ? params.datum : toCalendarDate(new Date());

  return (
    <DutyAssignmentShell
      activeHref="/dienstindeling/exporteren"
      header={{
        title: "Exporteren",
        subtitle: "Dagplanning als Excel, met personeelsnummers en zonder namen",
      }}
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <WidgetCard
          icon={<DownloadIcon size={18} />}
          tone="did"
          title="Dagplanning exporteren"
          subtitle="Eén dag per bestand"
          bodyClassName="border-t border-line p-4"
        >
          <form action="/dienstindeling/export/xlsx" className="flex items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-ink">Datum</span>
              <input type="date" name="datum" defaultValue={date} className={`${inputClass} w-44`} />
            </label>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent-did px-3.5 py-2 text-[12.5px] font-semibold text-white hover:opacity-90"
            >
              <DownloadIcon size={15} />
              Excel downloaden
            </button>
          </form>

          <p className="mt-3 text-[12px] text-ink-muted">
            Een leesbaar werkblad: samenvatting bovenaan, herkenbare statussen in plaats van
            technische codes, bevroren kopregel en filters. Elke export wordt vastgelegd in het
            auditlog.
          </p>

          <p className="mt-3 text-[11px] text-ink-muted">
            Liever de technische versie voor een ander programma?{" "}
            <a
              href={`/dienstindeling/export?datum=${date}`}
              className="font-semibold underline"
            >
              CSV downloaden
            </a>
            .
          </p>
        </WidgetCard>

        <div className="space-y-4">
          <Alert tone="neutral" title="Wat er niet in staat">
            Namen en e-mailadressen. Wie een lijst met namen nodig heeft voor de operatie, haalt
            die apart op; die inzage wordt gelogd en is niet als bestand te downloaden.
          </Alert>

          <Alert tone="info" title="Roosterexport">
            Het exporteren van een volledige roosterversie hoort bij de Rooster Commissie.{" "}
            <Link href="/roostercommissie/roosters" className="font-semibold underline">
              Naar basisroosters
            </Link>
          </Alert>
        </div>
      </div>
    </DutyAssignmentShell>
  );
}
