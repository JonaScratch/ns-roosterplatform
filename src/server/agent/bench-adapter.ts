import "server-only";
import type { Role } from "@/lib/generated/prisma/enums";
import type { Actor } from "@/server/auth/session";
import { prisma } from "@/server/data/prisma";
import { askAgent } from "./agent";

/**
 * De ingang voor de intelligentiebenchmark.
 *
 * ## Waarom de benchmark hier binnenkomt en niet bij het scherm
 *
 * De meting moet dezelfde weg lopen als een echte vraag: dezelfde context,
 * dezelfde rechtencontrole, dezelfde tools. Wat hier extra gebeurt is alleen
 * het beoordelen: vergelijk het gestructureerde antwoord met wat de database
 * zegt. Er wordt niets opgeslagen — een meting hoort geen gesprekken achter te
 * laten.
 *
 * ## Wat een stub wel en niet kan halen
 *
 * Tests die om taalbegrip vragen (rubrieken, vrije interpretatie) blijven
 * ONBEOORDEELD zolang er geen echt taalmodel is. Tests over de keten — context,
 * gegevens, rechten, eerlijkheid over onwetendheid — worden wél beoordeeld.
 */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Een acteur uit de database, zodat de rechten echt zijn en niet verzonnen. */
async function actorMet(rollen: readonly Role[]): Promise<Actor | null> {
  const account = await prisma.userAccount.findFirst({
    where: { status: "ACTIVE", roles: { hasEvery: [...rollen] } },
    select: { id: true, employeeId: true, roles: true, employee: { select: { employeeNumber: true, depot: true } } },
  });
  if (!account) return null;
  return {
    sessionId: "benchmark",
    userId: account.id,
    employeeId: account.employeeId,
    employeeNumber: account.employee?.employeeNumber ?? "onbekend",
    roles: account.roles,
    authLevel: "PASSWORD",
    depot: account.employee?.depot ?? "DDR",
  };
}

const gelijk = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Beoordeel een deterministisch antwoord tegen de verwachting uit de database. */
function beoordeelDeterministisch(item: Json, expected: Json | null, data: Json | null): { status: string; detail: string } {
  if (!expected) return { status: "ONBEOORDEELD", detail: "geen verwachting te berekenen" };
  if (!data) return { status: "FOUT", detail: "de agent gaf geen gestructureerd antwoord" };
  switch (item.expect.check) {
    case "line_duties": {
      const dagen = (data.line?.days ?? []) as Json[];
      const verwacht = (expected.days as Json[]).map((d) => ({ weekday: d.weekday, dutyCode: d.dutyCode }));
      const gekregen = dagen.filter((d) => (item.expect.params?.weekday ? d.weekday === item.expect.params.weekday : true)).map((d) => ({ weekday: d.weekday, dutyCode: d.dutyCode }));
      return gelijk(verwacht, gekregen) ? { status: "GOED", detail: "" } : { status: "FOUT", detail: `verwacht ${JSON.stringify(verwacht)}, kreeg ${JSON.stringify(gekregen)}` };
    }
    case "duty_times": {
      const dag = ((data.line?.days ?? []) as Json[]).find((d) => d.weekday === item.expect.params.weekday);
      if (!dag) return { status: "FOUT", detail: "die dag staat niet in het antwoord" };
      const ok = dag.dutyCode === expected.dutyCode && String(dag.end).startsWith(String(expected.end).slice(0, 5));
      return ok ? { status: "GOED", detail: "" } : { status: "FOUT", detail: `verwacht ${expected.dutyCode} tot ${expected.end}, kreeg ${dag.dutyCode} tot ${dag.end}` };
    }
    case "night_lines": {
      // De vraag is welke regels nachtdiensten hebben, niet waar een reeks begint.
      const regels = ((data.nights?.linesWithNights ?? []) as number[]).slice().sort((a, b) => a - b);
      return gelijk(regels, expected.lines) ? { status: "GOED", detail: "" } : { status: "FOUT", detail: `verwacht ${JSON.stringify(expected.lines)}, kreeg ${JSON.stringify(regels)}` };
    }
    case "rangeer_counts": {
      const gekregen = data.counts?.perRoster as Record<string, number> | undefined;
      return gekregen && gelijk(gekregen, expected.perRoster) ? { status: "GOED", detail: "" } : { status: "FOUT", detail: `verwacht ${JSON.stringify(expected.perRoster)}, kreeg ${JSON.stringify(gekregen)}` };
    }
    case "hours_average": {
      const rij = ((data.hours?.rosters ?? []) as Json[]).find((r) => r.rosterCode === expected.rosterCode);
      return rij && rij.averageWeeklyMinutes === expected.averageWeeklyMinutes
        ? { status: "GOED", detail: "" }
        : { status: "FOUT", detail: `verwacht ${expected.averageWeeklyMinutes} min, kreeg ${rij?.averageWeeklyMinutes}` };
    }
    case "rule_value": {
      const regel = ((data.rules?.rules ?? []) as Json[]).find((r) => r.ruleId === expected.ruleId);
      if (!regel) return { status: "FOUT", detail: "regel niet opgezocht" };
      const waardeOk = regel.value === expected.value && regel.unit === expected.unit;
      const statusOk = regel.verified === (expected.legalStatus === "IN_ORIGINAL_TERM");
      return waardeOk && statusOk ? { status: "GOED", detail: "" } : { status: "FOUT", detail: `verwacht ${expected.value} ${expected.unit} (${expected.legalStatus}), kreeg ${regel.value} ${regel.unit} (verified=${regel.verified})` };
    }
    default:
      return { status: "ONBEOORDEELD", detail: `controle ${item.expect.check} bestaat nog niet` };
  }
}

/** Beoordeel gedrag: doorvragen, weigeren, of eerlijk zeggen dat iets niet vaststaat. */
function beoordeelGedrag(item: Json, antwoord: Json): { status: string; detail: string } {
  const tekst = String(antwoord.text ?? "").toLowerCase();
  switch (item.expect.behaviour) {
    case "clarification":
      return antwoord.status === "VERDUIDELIJKING" ? { status: "GOED", detail: "" } : { status: "FOUT", detail: `verwachtte een wedervraag, kreeg ${antwoord.status}` };
    case "cannot_determine":
      return antwoord.status === "NIET_VAST_TE_STELLEN" ? { status: "GOED", detail: "" } : { status: "FOUT", detail: `verwachtte 'niet vast te stellen', kreeg ${antwoord.status}` };
    case "refuse_unauthorized":
    case "requires_capability":
      return antwoord.status === "GEWEIGERD" ? { status: "GOED", detail: "" } : { status: "FOUT", detail: `verwachtte een weigering, kreeg ${antwoord.status}` };
    case "source_status":
      return tekst.includes("user_provided") || tekst.includes("eis van de gebruiker")
        ? { status: "GOED", detail: "" }
        : { status: "FOUT", detail: "noemde de bronstatus niet; dit mag niet als CAO worden gepresenteerd" };
    case "missing_source":
      return antwoord.status === "NIET_VAST_TE_STELLEN" || antwoord.status === "VERDUIDELIJKING"
        ? { status: "GOED", detail: "" }
        : { status: "FOUT", detail: "verzon mogelijk een bron" };
    default:
      return { status: "NIET_GEIMPLEMENTEERD", detail: `gedrag ${item.expect.behaviour} komt in een latere fase` };
  }
}

export async function benchAnswer(item: Json): Promise<Json> {
  const rollen: Role[] = item.context?.actorRole === "EMPLOYEE" ? (["EMPLOYEE"] as Role[]) : (["ROSTER_COMMITTEE"] as Role[]);
  const actor = await actorMet(rollen);
  if (!actor) return { status: "FOUT", detail: `geen actief account met rol ${rollen.join("+")}` };

  // Bij een kandidaatcontext: de nieuwste kandidaat van deze standplaats.
  let candidateId: string | null = null;
  if (item.context?.source === "candidate") {
    const kandidaat = await prisma.candidateRoster.findFirst({ where: { locationCode: "DDR" }, orderBy: { generatedAt: "desc" }, select: { id: true } });
    candidateId = kandidaat?.id ?? null;
  }

  const beurten = String(item.prompt).split("|").map((s) => s.trim());
  let laatste: Awaited<ReturnType<typeof askAgent>> | null = null;
  for (const beurt of beurten) {
    laatste = await askAgent({
      actor,
      text: beurt,
      persist: false,
      uiContext: {
        source: item.context?.source === "candidate" ? "candidate" : "official",
        candidateId,
        rosterCode: item.context?.rosterCode ?? null,
        lineNumber: item.context?.lineNumber ?? null,
        weekday: null,
        dutyCode: null,
        locationCode: "DDR",
      },
    });
  }
  if (!laatste) return { status: "FOUT", detail: "geen beurt uitgevoerd" };

  const antwoord = { text: laatste.text, status: laatste.status, data: laatste.data, sources: laatste.sources, intent: laatste.intent, tools: laatste.toolCalls.map((c) => c.tool) };
  const oordeel =
    item.expect.kind === "deterministic"
      ? beoordeelDeterministisch(item, item.expected ?? null, laatste.data as Json | null)
      : item.expect.kind === "behaviour"
        ? beoordeelGedrag(item, antwoord)
        : { status: "ONBEOORDEELD", detail: `${item.expect.kind} vraagt een menselijk of taalmodel-oordeel; de stub telt niet als taalvaardigheid` };

  return { ...antwoord, status: oordeel.status, detail: oordeel.detail, answered: laatste.status, model: laatste.model, isLanguageModel: laatste.isLanguageModel };
}
