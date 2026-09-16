"use client";

/**
 * Foutafhandeling binnen de ingelogde omgeving.
 *
 * Wat de gebruiker ziet is bewust karig. Een foutmelding die vertelt welke
 * tabel, welk id of welk recht ontbrak, is voor een aanvaller een kaart van het
 * systeem. Het volledige verhaal staat in de serverlog en, waar het om
 * autorisatie gaat, in de beveiligingsgebeurtenissen.
 *
 * De `digest` is de enige verwijzing die de gebruiker meekrijgt: daarmee kan
 * beheer de bijbehorende serverregel opzoeken zonder dat de melding zelf iets
 * prijsgeeft.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg py-10">
      <div className="rounded border border-state-error/30 bg-state-error-soft p-5">
        <h1 className="text-sm font-semibold text-state-error">Er is iets misgegaan</h1>
        <p className="mt-2 text-xs text-ink">
          De handeling kon niet worden uitgevoerd. Probeer het opnieuw. Blijft het misgaan, geef
          dan onderstaande code door aan beheer.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-[11px] text-ink-muted">code: {error.digest}</p>
        )}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded bg-ns-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-ns-blue-dark"
          >
            Opnieuw proberen
          </button>
          {/*
            Bewust een gewone link en geen <Link>: na een fout kan de
            routerstatus zelf beschadigd zijn, en dan is een volledige herlaadslag
            betrouwbaarder dan een navigatie binnen dezelfde applicatie-instantie.
          */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            className="rounded border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold hover:bg-canvas"
          >
            Naar het begin
          </a>
        </div>
      </div>
    </div>
  );
}
