import Link from "next/link";

/**
 * Onbekende pagina.
 *
 * Ook dit scherm zegt niets over wat er wél bestaat. Een gebruiker die een pad
 * probeert waar hij geen recht op heeft, komt via de rechtencontrole uit op een
 * omleiding of een weigering; die twee mogen niet uit elkaar te houden zijn op
 * grond van de tekst hier.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-16">
      <div className="max-w-md rounded border border-line bg-surface p-6 text-center">
        <h1 className="text-sm font-semibold text-ink">Pagina niet gevonden</h1>
        <p className="mt-2 text-xs text-ink-muted">
          Deze pagina bestaat niet, of u heeft er geen toegang toe.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block rounded bg-ns-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-ns-blue-dark"
        >
          Naar het begin
        </Link>
      </div>
    </div>
  );
}
