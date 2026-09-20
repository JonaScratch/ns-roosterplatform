import { describe, expect, it } from "vitest";
import { type QualityDuty, type QualityRosterInput, dutyKey } from "@/domain/roster-quality";
import { polishBySwaps } from "@/domain/roster-polish";

/**
 * Bijschaven met ruildiensten: wat het mag verbeteren en wat het nooit mag doen.
 *
 * De zoektocht optimaliseert een scorefunctie die de aanroeper meegeeft. Die
 * vrijheid maakt de grenzen belangrijker dan de winst: deze tests belonen
 * expres precies datgene wat verboden is, en eisen dat het dan nog steeds niet
 * gebeurt. Een zoektocht die zich door een hoge score laat verleiden tot een
 * dienst buiten het profiel of te weinig rust, maakt roosters die de
 * eindvalidatie terecht afkeurt.
 */

interface Soort {
  readonly start: number;
  readonly eind: number;
  readonly kinds: readonly string[];
}

const SOORTEN: Record<string, Soort> = {
  V: { start: 6 * 60, eind: 14 * 60, kinds: ["VROEG"] },
  L: { start: 14 * 60, eind: 22 * 60, kinds: ["LAAT"] },
  N: { start: 22 * 60, eind: 30 * 60, kinds: ["NACHT"] },
  // Een vroege dienst die pas om 10:00 begint: precies twaalf uur na een late.
  M: { start: 10 * 60, eind: 18 * 60, kinds: ["VROEG"] },
};

function diensten(): Map<string, QualityDuty> {
  const kaart = new Map<string, QualityDuty>();
  for (const [letter, soort] of Object.entries(SOORTEN)) {
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      const code = `${letter}${weekday}`;
      kaart.set(dutyKey(code, weekday), { code, weekday, startMinute: soort.start, endMinute: soort.eind, kinds: soort.kinds });
    }
  }
  return kaart;
}

/** Eén rooster uit tekstregels: letters zijn diensten, R rust, S reserve. */
function rooster(code: string, profile: string, regels: readonly string[]): QualityRosterInput {
  return {
    code,
    name: code,
    profile,
    weeksPerLine: 1,
    days: regels.flatMap((regel, index) =>
      [...regel].map((teken, dag) => {
        const isDienst = teken in SOORTEN;
        return {
          lineNumber: index + 1,
          weekIndex: 1,
          weekday: dag + 1,
          positionType: isDienst ? "DUTY" : teken === "S" ? "RES" : "RUST",
          dutyCode: isDienst ? `${teken}${dag + 1}` : null,
        };
      }),
    ),
  };
}

const alleDiensten = (rosters: readonly QualityRosterInput[]) =>
  rosters
    .flatMap((r) => r.days.map((d) => (d.dutyCode ? `${d.dutyCode}@${d.weekday}` : null)))
    .filter((x): x is string => x !== null)
    .sort();

/** Waar ligt een dienstnummer, als `rooster/regel`? */
function plaats(rosters: readonly QualityRosterInput[], code: string): string | null {
  for (const r of rosters) {
    for (const d of r.days) if (d.dutyCode === code) return `${r.code}/${d.lineNumber}`;
  }
  return null;
}

const basis = { minRestMinutes: 720, deadline: () => Date.now() + 3000 };

describe("bijschaven met ruildiensten", () => {
  it("houdt zich aan de profielgrens, ook als de score het tegendeel beloont", () => {
    // MIX-rooster met een nacht, VROEG-rooster met vroege diensten. De score
    // betaalt vorstelijk voor een nacht in het vroege rooster: dat mag niet.
    //
    // De dag na de nacht is bewust een rustdag in beide roosters. Anders zou de
    // rusttoets de ruil al tegenhouden en zou deze test groen blijven ook als de
    // profielgrens verdwijnt — precies wat een mutatietest hier aan het licht bracht.
    const rosters = [
      rooster("MIXR", "MIX", ["NRVVRRR"]),
      rooster("VR", "VROEG", ["VRVVRRR"]),
    ];
    const uit = polishBySwaps({
      rosters,
      duties: diensten(),
      minRestMinutes: basis.minRestMinutes,
      deadline: basis.deadline(),
      score: (rs) => {
        const vroegRooster = rs.find((r) => r.code === "VR")!;
        return vroegRooster.days.filter((d) => d.dutyCode?.startsWith("N")).length * 1000;
      },
    });
    expect(uit.score).toBe(0);
    expect(uit.moves).toHaveLength(0);
    for (const r of uit.rosters) {
      if (r.code === "VR") expect(r.days.every((d) => !d.dutyCode?.startsWith("N"))).toBe(true);
    }
  });

  it("ruilt niet als er dan te weinig rust overblijft", () => {
    // Regel 1 werkt maandag laat en dinsdag de late dienst; regel 2 rijdt op
    // dinsdag M (10:00). L1 gevolgd door M2 geeft 12 uur rust, precies genoeg;
    // L1 gevolgd door V2 (06:00) geeft er tien, en dat mag niet.
    const rosters = [rooster("A", "MIX", ["LMRRRRR", "LVRRRRR"])];
    const uit = polishBySwaps({
      rosters,
      duties: diensten(),
      minRestMinutes: basis.minRestMinutes,
      deadline: basis.deadline(),
      // Beloon precies de verboden stand: V2 op regel 1.
      score: (rs) => (rs[0].days.some((d) => d.lineNumber === 1 && d.dutyCode === "V2") ? 1000 : 0),
    });
    expect(uit.score).toBe(0);
    expect(plaats(uit.rosters, "V2")).toBe("A/2");
  });

  it("verplaatst een dienst nooit naar een andere weekdag", () => {
    const rosters = [rooster("A", "MIX", ["VLNRRRR", "LNVRRRR"])];
    const uit = polishBySwaps({
      rosters,
      duties: diensten(),
      minRestMinutes: 0,
      deadline: basis.deadline(),
      // Willekeurig ogende maar vaste score: dwingt de zoektocht te bewegen.
      score: (rs) => rs[0].days.filter((d) => d.lineNumber === 1 && d.dutyCode?.startsWith("N")).length,
    });
    for (const r of uit.rosters) {
      for (const dag of r.days) {
        if (dag.dutyCode) expect(dag.dutyCode.slice(1)).toBe(String(dag.weekday));
      }
    }
  });

  it("laat dekking en dienstgebruik ongemoeid", () => {
    const rosters = [rooster("A", "MIX", ["VLNRRRR", "LNVRRRR", "NVLRRRR"])];
    const voor = alleDiensten(rosters);
    const uit = polishBySwaps({
      rosters,
      duties: diensten(),
      minRestMinutes: 0,
      deadline: basis.deadline(),
      score: (rs) => rs[0].days.filter((d) => d.lineNumber === 1 && d.dutyCode?.startsWith("N")).length * 10,
    });
    expect(alleDiensten(uit.rosters)).toEqual(voor);
    // Geen dienstdag raakt leeg en geen rustdag wordt een dienstdag.
    expect(uit.rosters[0].days.filter((d) => d.positionType === "DUTY").length).toBe(
      rosters[0].days.filter((d) => d.positionType === "DUTY").length,
    );
    expect(uit.rosters[0].days.every((d) => (d.positionType === "DUTY") === (d.dutyCode !== null))).toBe(true);
  });

  it("vindt de verbetering die er is", () => {
    // De nachten staan verspreid over drie regels; de score beloont ze samen op
    // regel 1. Dat kan met ruilen binnen dezelfde weekdag.
    const rosters = [rooster("A", "MIX", ["VLNRRRR", "LNVRRRR", "NVLRRRR"])];
    const score = (rs: readonly QualityRosterInput[]) =>
      rs[0].days.filter((d) => d.lineNumber === 1 && d.dutyCode?.startsWith("N")).length;
    const uit = polishBySwaps({
      rosters,
      duties: diensten(),
      minRestMinutes: 0,
      deadline: basis.deadline(),
      score,
    });
    expect(uit.startScore).toBe(1);
    expect(uit.score).toBe(3);
    expect(uit.evaluated).toBeGreaterThan(10);
    // Het teruggegeven rooster hoort ook echt die score te halen.
    expect(score(uit.rosters)).toBe(uit.score);
  });

  it("geeft bij dezelfde zaadwaarde dezelfde uitkomst", () => {
    const maak = (seed: number) =>
      polishBySwaps({
        rosters: [rooster("A", "MIX", ["VLNRRRR", "LNVRRRR", "NVLRRRR"])],
        duties: diensten(),
        minRestMinutes: 0,
        deadline: Date.now() + 1500,
        seed,
        score: (rs) => rs[0].days.filter((d) => d.lineNumber === 1 && d.dutyCode?.startsWith("N")).length,
      });
    expect(alleDiensten(maak(5).rosters)).toEqual(alleDiensten(maak(5).rosters));
  });

  it("houdt de beste stand vast, ook als een schop in een slechtere top belandt", () => {
    // Een landschap met een val: beide nachten op regel 1 is de top (5), beide
    // op regel 2 is een lagere top (3), en alles ertussenin is waardeloos (0).
    // Eén ruil komt dus nooit van de lagere top af; wie de beste stand niet
    // bewaart, levert aan het eind 3 in plaats van 5.
    const rosters = [rooster("A", "MIX", ["NNRRRRR", "LLRRRRR"])];
    const opRegel = (rs: readonly QualityRosterInput[], regel: number, code: string) =>
      rs[0].days.some((d) => d.lineNumber === regel && d.dutyCode === code);
    const score = (rs: readonly QualityRosterInput[]) => {
      const a = opRegel(rs, 1, "N1");
      const b = opRegel(rs, 1, "N2");
      if (a && b) return 5;
      if (!a && !b) return 3;
      return 0;
    };
    // Een vast aantal schoppen in plaats van een tijdslimiet: anders hangt het
    // van de drukte op de machine af hoe vaak de val wordt bezocht, en dan
    // slaagt deze test soms toevallig.
    const gezien: number[] = [];
    const uit = polishBySwaps({
      rosters,
      duties: diensten(),
      minRestMinutes: 0,
      deadline: Date.now() + 30_000,
      seed: 3,
      kickSize: 2,
      maxKicks: 4,
      score: (rs) => {
        const waarde = score(rs);
        gezien.push(waarde);
        return waarde;
      },
    });
    expect(uit.kicks).toBe(4);
    expect(uit.startScore).toBe(5);
    // De val is onderweg werkelijk bezocht, anders bewijst deze test niets.
    expect(gezien).toContain(3);
    expect(uit.score).toBe(Math.max(...gezien));
    expect(uit.score).toBe(5);
    // Wat eruit komt, moet die score ook werkelijk halen.
    expect(score(uit.rosters)).toBe(5);
  });
});
