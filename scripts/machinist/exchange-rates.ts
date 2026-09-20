import "dotenv/config";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { dutyClass } from "@/domain/duty-class";
import { freeWeekends } from "@/domain/operational-requirements";
import { dutyAffinity } from "@/domain/profile-affinity";
import { QUALITY_MODEL_V2, QUALITY_MODEL_V3 } from "@/domain/quality-model";
import { type QualityRosterInput, dutyKey } from "@/domain/roster-quality";
import { prisma } from "@/server/data/prisma";
import { STRATEGY_WEIGHTS } from "@/server/optimizer/objective-weights";
import { evaluateOfficialCore, loadEvaluationContextCore } from "@/server/services/quality-evaluation-service";
import { evaluateQuality } from "@/domain/quality-evaluator";

/**
 * Wisselkoersen van de voorkeurslaag (model v3), in dezelfde munt als de
 * Final-Brain-koersen: minuten per week afwijking van 40:00 in één basisrooster.
 *
 * ## Waarom eerst meten
 *
 * De werkopdracht: niet alles in CP-SAT, eerst meten wat het model feitelijk
 * ruilt. Het model is niet lineair; hier staan de marginale effecten op de
 * grootte van het Dordrechtse pakket, met de formule, en één empirische
 * controle: een echte ruil in het officiële rooster, door de evaluator.
 *
 * Een CP-SAT-gewicht "op pariteit" betaalt in de oplosser hetzelfde aantal
 * urenminuten als het model: `minuten/week × hoursBalance × 60`.
 *
 *   npx tsx --conditions=react-server scripts/machinist/exchange-rates.ts
 */

const WORTEL = path.resolve(__dirname, "..", "..");
const MAP = path.join(WORTEL, "docs", "v1.0.4-final-brain", "machinist-preferences");

async function main() {
  const context = await loadEvaluationContextCore("DDR");
  const officieel = context.quality.official;
  const duties = context.quality.duties;
  const rapport = evaluateOfficialCore(context, QUALITY_MODEL_V3);

  // Pakketgrootte.
  const dienstDagen = officieel.flatMap((r) => r.days.filter((d) => d.positionType === "DUTY" && d.dutyCode));
  const N = dienstDagen.length;
  const D = rapport.preference.dayDuties.total;
  const W = officieel.flatMap((r) => freeWeekends(r, duties)).length;
  const R = officieel.length;
  const nachten = rapport.metrics.nights.total;

  const m3 = QUALITY_MODEL_V3;
  const som = Object.values(m3.components).reduce((s, c) => s + c.weight, 0);
  const k = m3.robust.overallWeight;
  const wv = m3.components.preference.weight / som;
  const p = m3.components.preference.parts;
  const blok = m3.components.nights.parts.blocks.valueByLength as Record<number, number>;
  const wn = (m3.components.nights.weight / som) * m3.components.nights.parts.blocks.weight;

  const urenV3 = (k * (m3.components.hours.weight / som) * m3.components.hours.parts.contract.weight * (100 / m3.components.hours.parts.contract.zeroAtMinutes)) / R;
  const urenV2 = (QUALITY_MODEL_V2.robust.overallWeight * QUALITY_MODEL_V2.components.hours.weight * QUALITY_MODEL_V2.components.hours.parts.contract.weight * (100 / 60)) / R;

  const gebeurtenissen = {
    affinityStep: {
      label: "één plaatsing een niveau beter passend (neutraal → voorkeur, 0,4)",
      robust: (k * wv * p.affinity.weight * 100 * 0.4) / N,
      formula: "0,85 × (0,15/Σw) × 0,3 × 100 × 0,4 / dienstdagen",
    },
    affinityTwoSteps: {
      label: "één plaatsing van minder passend naar voorkeur (0,8), bv. een vroege late uit Laat, een afloper erin",
      robust: (k * wv * p.affinity.weight * 100 * 0.8) / N,
      formula: "idem × 0,8",
    },
    dayDutyMove: {
      label: "één dagachtige dienst van een rooster boven zijn doel naar een rooster eronder",
      robust: (k * wv * p.dayDuties.weight * 100) / D,
      formula: "0,85 × (0,15/Σw) × 0,2 × 100 × (1 / dagachtige diensten)",
    },
    weekendStart17vs23: {
      label: "één vrijdag vóór een vrij weekend om 17:00 in plaats van 23:00",
      robust: (k * wv * p.weekendStart.weight * 100 * 0.3) / W,
      formula: "0,85 × (0,15/Σw) × 0,15 × 100 × 0,3 / vrije weekenden",
    },
    restDutyInWorstRoster: {
      label: "één 'minder passende' dienst minder in het rooster dat de restbak is",
      robust: (k * wv * p.restDuties.weight * 100) / (rapport.preference.perRoster[rapport.preference.worstRestRoster ?? ""]?.classes ? Object.values(rapport.preference.perRoster[rapport.preference.worstRestRoster ?? ""].classes).reduce((a, b) => a + b, 0) : N),
      formula: "0,85 × (0,15/Σw) × 0,15 × 100 / dienstdagen van dat rooster",
    },
    singletonV3: {
      label: "losse nacht (4 → 3 + 1), model v3",
      robust: (k * wn * 100 * (blok[3] * 3 + blok[1] - blok[4] * 4)) / nachten,
      formula: "0,85 × (0,2/Σw) × 0,7 × 100 × (w3·3 + w1 − w4·4) / nachten",
    },
    tripleV3: {
      label: "reeks van zes gesplitst in twee reeksen van drie, model v3",
      robust: (k * wn * 100 * (blok[3] * 6 - blok[6] * 6)) / nachten,
      formula: "0,85 × (0,2/Σw) × 0,7 × 100 × (w3·6 − w6·6) / nachten",
    },
  };

  const uurBalans = STRATEGY_WEIGHTS.BALANCED.hoursBalance * 60;
  const koersen = Object.fromEntries(
    Object.entries(gebeurtenissen).map(([key, g]) => {
      const minuten = Math.abs(g.robust) / urenV3;
      return [key, { ...g, robust: Number(g.robust.toFixed(5)), minutesPerWeek: Number(minuten.toFixed(3)), cpsatParity: Math.round(minuten * uurBalans) }];
    }),
  );

  // Empirische controle: een echte ruil in het officiële rooster. Zoek op één
  // weekdag een afloper in een rooster waar hij neutraal is en een gewone late
  // in Laat; ruil ze. Alleen affiniteit verandert (zelfde dagdeel); andere
  // onderdelen verschuiven een beetje door andere tijden, dat staat erbij.
  const zoek = (profiel: string, klasse: string) =>
    officieel
      .filter((r) => r.profile === profiel)
      .flatMap((r) => r.days.filter((d) => d.dutyCode && dutyClass(duties.get(dutyKey(d.dutyCode, d.weekday))!) === klasse).map((d) => ({ r, d })));
  let controle: Record<string, unknown> | null = null;
  for (const a of zoek("VROEG_LAAT", "PREMIUM_LATE")) {
    const b = zoek("LAAT", "LATE").find((x) => x.d.weekday === a.d.weekday);
    if (!b) continue;
    const gewisseld: QualityRosterInput[] = officieel.map((r) => ({
      ...r,
      days: r.days.map((d) =>
        r.code === a.r.code && d === a.d ? { ...d, dutyCode: b.d.dutyCode } : r.code === b.r.code && d === b.d ? { ...d, dutyCode: a.d.dutyCode } : d,
      ),
    }));
    const na = evaluateQuality({
      model: QUALITY_MODEL_V3,
      rosters: gewisseld,
      reference: officieel,
      duties,
      requiredDutyKeys: context.requiredDutyKeys,
      nightRosterCodes: context.quality.nightRosterCodes,
      rules: context.rules,
    });
    const dienstA = duties.get(dutyKey(a.d.dutyCode!, a.d.weekday))!;
    const dienstB = duties.get(dutyKey(b.d.dutyCode!, b.d.weekday))!;
    controle = {
      swap: `${a.r.code} ${a.d.dutyCode} (${dutyAffinity(a.r.profile, dienstA).level}) ↔ ${b.r.code} ${b.d.dutyCode} (${dutyAffinity(b.r.profile, dienstB).level})`,
      affinityBefore: rapport.preference.parts.affinity,
      affinityAfter: na.preference.parts.affinity,
      preferenceBefore: rapport.components.preference.score,
      preferenceAfter: na.components.preference.score,
      robustBefore: rapport.robust,
      robustAfter: na.robust,
      otherComponentsChanged: Object.fromEntries(
        (["hours", "flow", "rest", "nights", "fairness"] as const).map((c) => [c, Number(((na.components[c].score ?? 0) - (rapport.components[c].score ?? 0)).toFixed(2))]),
      ),
      note: "Een afloper uit Vroeg/Laat (neutraal) naar Laat (voorkeur) en een gewone late terug (beide neutraal voor Vroeg/Laat): +0,4 affiniteit. De robuuste score is op één decimaal afgerond; de voorkeursscore laat het effect zien.",
    };
    break;
  }

  const uit = {
    schema: "ns-machinist-exchange-rates/1",
    computedAt: new Date().toISOString(),
    qualityModel: m3.version,
    currency: "minuten per week afwijking van 40:00 in één basisrooster (zoals objective-exchange-rates.md)",
    package: { dutyDays: N, dayDuties: D, freeWeekends: W, rosters: R, nights: nachten },
    hoursRobustPerMinutePerWeek: { v2: Number(urenV2.toFixed(5)), v3: Number(urenV3.toFixed(5)), note: "v3 normaliseert over Σw = 1,15: elk v2-onderdeel weegt 1/1,15 zo zwaar" },
    cpsatHoursUnitPerMinutePerWeek: uurBalans,
    events: koersen,
    empiricalCheck: controle,
  };
  writeFileSync(path.join(MAP, "exchange-rates.json"), `${JSON.stringify(uit, null, 2)}\n`);
  console.log(JSON.stringify(uit, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
