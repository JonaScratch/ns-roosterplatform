import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MACHINIST_METRICS } from "./metrics";

/**
 * De machineleesbare uitkomsten van de machinistenronde, uit de gemeten fasen
 * (phases/official.json, phases/brain-after.json, phases/<after>.json):
 *
 * - attractive-duty-distribution.json: per rooster en bron de populaire en
 *   minder populaire diensten, dagdiensten tegen hun doel, rangeer en de
 *   blootstellingsproxy; per klasse de eerlijkheid en het grootste aandeel;
 * - preference-before-after.json: alle maten van de ronde, baseline tegen AFTER,
 *   en de voorkeur per profiel.
 *
 *   npx tsx scripts/machinist/outputs-after.ts --after mp-after
 */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const argument = (naam: string): string | null => {
  const index = process.argv.indexOf(`--${naam}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
};
const MAP = path.resolve(__dirname, "..", "..", "docs", "v1.0.4-final-brain", "machinist-preferences");
const lees = (naam: string): Json => JSON.parse(readFileSync(path.join(MAP, "phases", `${naam}.json`), "utf8")) as Json;
const r3 = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 1000);

const VELDEN = [
  "affinity",
  "lessShare",
  "dutyDays",
  "extremeEarly",
  "moderateEarly",
  "daylikeEarly",
  "earlyLate",
  "premiumLate",
  "night",
  "rangeer",
  "dayDuties",
  "dayDutyTarget",
  "nightWindowMinutesPerWeek",
  "weekendMinutesPerWeek",
  "weekendStart",
  "extremeEarlySteps",
];

function kandidaten(f: Json): Json[] {
  return f.official ? [f.official] : (f.candidates as Json[]);
}

function perRooster(f: Json): Record<string, Record<string, number | null>> {
  const lijst = kandidaten(f);
  const codes = Object.keys(lijst[0].profiles);
  return Object.fromEntries(
    codes.map((c) => [
      c,
      {
        profile: lijst[0].profiles[c].profile,
        lines: lijst[0].profiles[c].lines,
        ...Object.fromEntries(
          VELDEN.map((v) => {
            const w = lijst.map((k) => k.profiles[c][v]).filter((x): x is number => typeof x === "number");
            return [v, w.length ? r3(w.reduce((a, b) => a + b, 0) / w.length) : null];
          }),
        ),
      },
    ]),
  );
}

function populair(f: Json) {
  const lijst = kandidaten(f);
  const klassen = Object.keys(lijst[0].popular ?? {});
  return Object.fromEntries(
    klassen.map((k) => {
      const s = lijst.map((x) => x.popular[k].score).filter((x): x is number => typeof x === "number");
      const m = lijst.map((x) => x.popular[k].maxShare).filter((x): x is number => typeof x === "number");
      return [k, { fairness: s.length ? r3(s.reduce((a, b) => a + b, 0) / s.length) : null, maxShare: m.length ? r3(m.reduce((a, b) => a + b, 0) / m.length) : null }];
    }),
  );
}

function main() {
  const naFase = argument("after") ?? "mp-after";
  const bronnen = { official: lees("official"), baseline: lees("brain-after"), after: lees(naFase) };
  writeFileSync(
    path.join(MAP, "attractive-duty-distribution.json"),
    `${JSON.stringify(
      {
        schema: "ns-machinist-attractive-duties/1",
        sources: { official: "zeven menselijke roosters", baseline: "brain-after (60 kandidaten)", after: `${naFase} (${bronnen.after.candidates.length} kandidaten)` },
        exposureNote: "nightWindowMinutesPerWeek en weekendMinutesPerWeek zijn TIME_BAND_EXPOSURE: een proxy, geen toeslag of bedrag.",
        perRoster: Object.fromEntries(Object.entries(bronnen).map(([k, f]) => [k, perRooster(f)])),
        popular: Object.fromEntries(Object.entries(bronnen).map(([k, f]) => [k, populair(f)])),
        rangeer: Object.fromEntries(Object.entries(bronnen).map(([k, f]) => [k, { cvPerLine: f.means.rangeerCv, maxShare: f.means.rangeerMaxShare }])),
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(MAP, "preference-before-after.json"),
    `${JSON.stringify(
      {
        schema: "ns-machinist-preference-before-after/1",
        before: "brain-after",
        after: naFase,
        qualityModelV3Hash: { before: bronnen.baseline.qualityModelV3Hash, after: bronnen.after.qualityModelV3Hash },
        metrics: MACHINIST_METRICS.map((m) => ({
          key: m.key,
          label: m.label,
          higherIsBetter: m.higherIsBetter,
          official: bronnen.official.means[m.key],
          before: bronnen.baseline.means[m.key],
          after: bronnen.after.means[m.key],
          delta: bronnen.baseline.means[m.key] === null || bronnen.after.means[m.key] === null ? null : r3(bronnen.after.means[m.key] - bronnen.baseline.means[m.key]),
        })),
        profileAffinity: Object.fromEntries(
          Object.entries(perRooster(bronnen.after)).map(([c, a]) => [
            c,
            { official: perRooster(bronnen.official)[c]?.affinity ?? null, before: perRooster(bronnen.baseline)[c]?.affinity ?? null, after: a.affinity, lessShareBefore: perRooster(bronnen.baseline)[c]?.lessShare ?? null, lessShareAfter: a.lessShare },
          ]),
        ),
        gates: "gates.json",
      },
      null,
      2,
    )}\n`,
  );
  console.log("attractive-duty-distribution.json en preference-before-after.json geschreven");
}

main();
