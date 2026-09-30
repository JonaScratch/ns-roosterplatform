import { STATIONS } from "@/domain/locations";
import { vraagtNaarKennis } from "./request-shape";

/**
 * Het bereik van een kennisopzoeking, door het platform zelf in het antwoord.
 *
 * Aanleiding (adversarial M, diagnose-20260930-m en -m2): bij byte-gelijke
 * verzoeken gaf qwen3:8b verschillende antwoorden, afhankelijk van het
 * vóórgaande verzoek aan de server (promptcache): na het planverzoek liet het de
 * bereikgrens uit de toolnotitie weg, na herladen noemde het hem wél. Of een
 * gebruiker hoort dát een voorkeur van een andere standplaats hier niet meetelt,
 * mag niet afhangen van servertoestand. Wat de tool aantoonbaar vaststelt,
 * zet het platform er daarom zelf onder — zoals al gebeurt bij een onbekende
 * keuzewaarde en bij het citaatvoorbehoud.
 *
 * Twee zinnen, elk alleen als de tool het bewijst én de vraag het nodig maakt:
 *  - **Afwezigheid**: de opzoeking vond niets, en de vraag vraagt naar
 *    vastgelegde voorkeuren, afspraken of werkwijzen (`vraagtNaarKennis`). Dan
 *    ís "er staat niets" de kern van het antwoord.
 *  - **Grens**: de vraag noemt een andere bekende standplaats dan die waarvoor
 *    de kennis geldt. `recall` (memory.ts) haalt uitsluitend items van déze
 *    standplaats plus NS-brede op; een voorkeur van een andere standplaats kan
 *    hier dus structureel niet meetellen — ook als er wél items zijn.
 *
 * Geen zin zonder een geslaagde `knowledgeSearch` met `scopeLocationCode`: wat
 * de tool niet heeft vastgesteld, beweert het platform ook niet.
 */

interface ToolUitkomst {
  readonly tool: string;
  readonly ok: boolean;
  readonly data: unknown;
}

export interface KennisBereik {
  readonly code: string;
  readonly naam: string;
  readonly aantalItems: number;
}

/** Het bereik uit de geslaagde kennisopzoekingen van deze beurt (de eerste met een bereik), of `null`. */
export function kennisBereikUit(results: readonly ToolUitkomst[]): KennisBereik | null {
  for (const r of results) {
    if (r.tool !== "knowledgeSearch" || !r.ok || !r.data || typeof r.data !== "object") continue;
    const d = r.data as { scopeLocationCode?: unknown; items?: unknown };
    if (typeof d.scopeLocationCode !== "string" || !Array.isArray(d.items)) continue;
    const code = d.scopeLocationCode;
    return { code, naam: STATIONS.find((s) => s.code === code)?.name ?? code, aantalItems: d.items.length };
  }
  return null;
}

const regexVeilig = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Bekende standplaatsen (op naam, ook als bijvoeglijk naamwoord: "-se"/"-s")
 * die in de tekst genoemd worden, behalve `eigen`. Alleen namen, geen codes:
 * korte codes ("UT", "VS", "ES") zijn gewone woorden. Een naam die deel is van
 * een langere genoemde naam telt niet apart ("Den Haag" in "Den Haag Holland Spoor").
 */
export function andereStandplaatsenIn(tekst: string, eigen: string): { code: string; naam: string }[] {
  const gevonden = STATIONS.filter((s) => s.code !== eigen).filter((s) =>
    new RegExp(`(^|[^\\p{L}])${regexVeilig(s.name)}(se|s)?(?=[^\\p{L}]|$)`, "iu").test(tekst),
  );
  return gevonden
    .filter((s) => !gevonden.some((a) => a !== s && a.name.length > s.name.length && a.name.toLowerCase().includes(s.name.toLowerCase())))
    .map((s) => ({ code: s.code, naam: s.name }));
}

/** De zinnen die het platform onder het antwoord zet; leeg als de tool niets bewijst of de vraag het niet nodig maakt. */
export function kennisBereikZinnen(vraag: string, results: readonly ToolUitkomst[]): string[] {
  const bereik = kennisBereikUit(results);
  if (!bereik) return [];
  const plek = `standplaats ${bereik.naam}${bereik.naam !== bereik.code ? ` (${bereik.code})` : ""}`;
  const zinnen: string[] = [];
  if (bereik.aantalItems === 0 && vraagtNaarKennis(vraag)) {
    zinnen.push(`Opgezocht in het leergeheugen voor ${plek} en NS-breed: daar is hierover niets goedgekeurd vastgelegd.`);
  }
  const andere = andereStandplaatsenIn(vraag, bereik.code);
  if (andere.length > 0) {
    zinnen.push(
      `Een voorkeur of afspraak van ${andere.map((a) => a.naam).join(" of ")} telt hier niet mee: dit leergeheugen geldt voor ${plek} en NS-breed, ` +
        "en een voorkeur van een andere standplaats wordt hier niet toegepast of ernaast gelegd.",
    );
  }
  return zinnen;
}

/** Statussen waaronder niets wordt toegevoegd: daar hoort geen feitelijke aanvulling bij. */
const ZONDER_AANVULLING: ReadonlySet<string> = new Set(["GEWEIGERD", "FOUT", "VOORSTEL"]);

/**
 * Het eindantwoord met het bereik eronder, zoals agent.ts het toepast: na alle
 * poorten, los van wat het model schreef. Geeft ook de toegevoegde zinnen terug
 * (voor logboek en trace).
 */
export function verankerKennisBereik<A extends { text: string; status: string }>(antwoord: A, vraag: string, results: readonly ToolUitkomst[]): { antwoord: A; zinnen: string[] } {
  const zinnen = ZONDER_AANVULLING.has(antwoord.status) ? [] : kennisBereikZinnen(vraag, results);
  return { antwoord: zinnen.length > 0 ? { ...antwoord, text: `${antwoord.text}\n\n${zinnen.join(" ")}` } : antwoord, zinnen };
}
