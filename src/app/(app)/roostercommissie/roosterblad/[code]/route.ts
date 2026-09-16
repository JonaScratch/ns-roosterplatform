import { NextResponse } from "next/server";
import { z } from "zod";
import {
  exportCandidateSheetPdf,
  exportSheetPdf,
  previewCandidateSheetSvg,
  previewSheetSvg,
} from "@/server/services/roster-sheet-service";
import { toPublicError } from "@/server/security/authorize";
import { metSessieUitVerzoek } from "@/server/auth/session";

/**
 * Nooit vooraf uitrekenen: zie de toelichting in
 * `roostercommissie/pakketten/sjabloon/route.ts`. Een route die zonder verzoek
 * wordt uitgevoerd, heeft geen sessie, en het antwoord dat daaruit komt is de
 * toegangsfout — voor iedereen.
 */
export const dynamic = "force-dynamic";

/**
 * Het roosterblad, als printbaar document.
 *
 * Dezelfde opmaak als de voorvertoning: er is één renderer, en die staat in
 * `src/server/export/roster-document.ts`. Wie dit blad opslaat als PDF, krijgt
 * exact wat hij op het scherm heeft gezien — inclusief de vermelding dat het om
 * een simulatie gaat, wanneer dat zo is.
 *
 * Inline en niet als download: het blad wordt eerst bekeken en dan pas
 * afgedrukt. `no-store` blijft staan; roostergegevens horen niet in een cache
 * onderweg.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/roostercommissie/roosterblad/[code]">,
): Promise<NextResponse> {
  return metSessieUitVerzoek(request, () => roosterblad(request, context));
}

async function roosterblad(
  request: Request,
  context: RouteContext<"/roostercommissie/roosterblad/[code]">,
): Promise<NextResponse> {
  const { code } = await context.params;

  const parsed = z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/, "Een roostercode bestaat uit letters, cijfers en streepjes.")
    .safeParse(code);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ongeldige roostercode." }, { status: 400 });
  }

  // ?formaat=pdf levert het bestand, alles daarbuiten de voorvertoning. Allebei
  // uit dezelfde opmaakprimitieven; er is geen tweede renderer die uit de pas
  // kan lopen.
  const parameters = new URL(request.url).searchParams;
  const formaat = parameters.get("formaat");

  // Met ?kandidaat=… komt het blad uit een scenario in plaats van uit het
  // vastgelegde rooster. Dezelfde route, dezelfde renderer, hetzelfde blad —
  // alleen een andere bron, en die bron zet de simulatiewaarschuwing vast aan.
  const kandidaat = parameters.get("kandidaat");
  const kandidaatId = kandidaat !== null ? z.uuid().safeParse(kandidaat) : null;
  if (kandidaatId !== null && !kandidaatId.success) {
    return NextResponse.json({ error: "Ongeldige scenarioverwijzing." }, { status: 400 });
  }

  try {
    if (formaat === "pdf") {
      const pdf = kandidaatId
        ? await exportCandidateSheetPdf(kandidaatId.data, parsed.data)
        : await exportSheetPdf(parsed.data);
      return new NextResponse(new Uint8Array(pdf.bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${pdf.filename}"`,
          "Cache-Control": "no-store, private",
        },
      });
    }

    // De voorvertoning tekent dezelfde opmaakprimitieven als de PDF. Er is dus
    // geen tweede berekening die uit de pas kan lopen.
    {
      const svg = kandidaatId
        ? await previewCandidateSheetSvg(kandidaatId.data, parsed.data)
        : await previewSheetSvg(parsed.data);
      return new NextResponse(
        voorvertoningPagina(parsed.data, svg, kandidaatId ? kandidaatId.data : null),
        {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store, private",
          },
        },
      );
    }

  } catch (error) {
    const publicError = toPublicError(error);
    if (publicError.status === 500) {
      console.error("[roosterblad] mislukt", error);
    }
    return NextResponse.json({ error: publicError.message }, { status: publicError.status });
  }
}

/**
 * De voorvertoning: het blad zelf, met een knop om het als PDF op te halen.
 *
 * De omhulling is bewust dun. Alles wat het blad toont, komt uit de SVG die
 * dezelfde opmaakprimitieven tekent als de PDF; wat hier omheen staat, mag er
 * niets aan toevoegen en niets van weglaten.
 */
function voorvertoningPagina(
  rosterCode: string,
  svg: string,
  candidateId: string | null,
): string {
  const veilig = rosterCode.replace(/[^A-Za-z0-9-]/g, "");
  const scenarioDeel = candidateId
    ? `&kandidaat=${encodeURIComponent(candidateId.replace(/[^A-Za-z0-9-]/g, ""))}`
    : "";
  return `<!doctype html>
<html lang="nl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Roosterblad ${veilig}</title>
<style>
  body { margin: 0; background: #f4f4f5; font: 13px system-ui, sans-serif; color: #18181b; }
  header { display: flex; align-items: center; justify-content: space-between;
           gap: 12px; padding: 10px 16px; background: #fff; border-bottom: 1px solid #e4e4e7; }
  a.knop { display: inline-block; padding: 6px 12px; border-radius: 4px;
           background: #003da5; color: #fff; text-decoration: none; font-weight: 600; }
  main { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
  .blad { background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
  @media print {
    header { display: none; }
    body { background: #fff; }
    main { padding: 0; gap: 0; }
    .blad { box-shadow: none; page-break-after: always; }
  }
</style></head>
<body>
<header>
  <strong>Roosterblad ${veilig}</strong>
  <a class="knop" href="?formaat=pdf${scenarioDeel}">PDF ophalen</a>
</header>
<main>${svg
    .split("</svg>")
    .filter((deel) => deel.trim() !== "")
    .map((deel) => `<div class="blad">${deel}</svg></div>`)
    .join("")}</main>
</body></html>`;
}
