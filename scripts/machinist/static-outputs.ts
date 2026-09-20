import { writeFileSync } from "node:fs";
import path from "node:path";
import { DUTY_CLASS_BOUNDS, DUTY_CLASS_LABELS, type DutyClass } from "@/domain/duty-class";
import { PREFERENCE_CALIBRATION } from "@/domain/machinist-preference";
import { NIGHT_LOAD, NIGHT_RHYTHM, nightBlockWorth } from "@/domain/night-rhythm";
import { OPERATIONAL_REQUIREMENTS_V1 } from "@/domain/operational-requirements";
import { AFFINITY_VALUE, DAY_DUTY_WEIGHTS, PROFILE_AFFINITY } from "@/domain/profile-affinity";
import { QUALITY_MODEL_V2, QUALITY_MODEL_V3 } from "@/domain/quality-model";
import { allowedKindsForProfile } from "@/domain/roster-profiles";
import type { RosterProfile } from "@/lib/generated/prisma/enums";

/**
 * De vaste, machineleesbare beschrijvingen van de voorkeurslaag: de
 * affiniteitstabel met de bron van elke cel, en de nachtcurve. Geen meting:
 * dit is wat het model gelóóft, zodat iemand het kan controleren.
 *
 *   npx tsx scripts/machinist/static-outputs.ts
 */

const MAP = path.resolve(__dirname, "..", "..", "docs", "v1.0.4-final-brain", "machinist-preferences");
const KLASSEN: readonly DutyClass[] = ["EXTREME_EARLY", "EARLY", "DAYLIKE_EARLY", "EARLY_LATE", "LATE", "PREMIUM_LATE", "NIGHT"];
const SOORT: Record<DutyClass, string> = { EXTREME_EARLY: "VROEG", EARLY: "VROEG", DAYLIKE_EARLY: "VROEG", EARLY_LATE: "LAAT", LATE: "LAAT", PREMIUM_LATE: "LAAT", NIGHT: "NACHT", OTHER: "" };

const profielen = Object.keys(PROFILE_AFFINITY);
writeFileSync(
  path.join(MAP, "profile-affinity.json"),
  `${JSON.stringify(
    {
      schema: "ns-machinist-profile-affinity/1",
      layers: {
        eligibility: "roster-profiles.ts — hard; mag deze dienst in dit profiel?",
        affinity: "profile-affinity.ts — zacht; hoe goed past een toegestane dienst? (deze tabel)",
        fairness: "machinist-preference.ts — pakketeerlijkheid van populaire diensten",
      },
      sourceStatus: "MACHINIST_PREFERENCE / HUMAN_DOMAIN_INPUT — geen CAO, ATW, ATB of wet",
      levels: AFFINITY_VALUE,
      levelNote: "Alleen de volgorde heeft een bron; de afstand tussen de niveaus is een aanname. Hoe zwaar het weegt, bepalen de wisselkoersen en de A/B.",
      classes: Object.fromEntries(KLASSEN.map((k) => [k, DUTY_CLASS_LABELS[k]])),
      classBoundsMinutes: DUTY_CLASS_BOUNDS,
      classBoundsNote: "Op de klok van de concrete dienst per weekdag, nooit op het dienstnummer.",
      dayDutyWeights: DAY_DUTY_WEIGHTS,
      dayDutyNormalisation: "per concrete dienst over de profielen die hem mogen rijden (per profiel, niet per regel; zie design.md en assumption-sensitivity.json)",
      table: Object.fromEntries(
        profielen.map((p) => [
          p,
          Object.fromEntries(
            KLASSEN.map((k) => {
              const mag = allowedKindsForProfile(p as RosterProfile).includes(SOORT[k] as never);
              const cel = PROFILE_AFFINITY[p][k];
              return [k, mag ? { level: cel?.level ?? "NEUTRAL", value: AFFINITY_VALUE[cel?.level ?? "NEUTRAL"], source: cel?.source ?? "geen specifieke voorkeur" } : { eligible: false }];
            }),
          ),
        ]),
      ),
      popularFairness: {
        classes: PREFERENCE_CALIBRATION.popularClasses,
        floorShare: PREFERENCE_CALIBRATION.popularFloorShare,
        suitable: "profiel mag de dienst rijden én de affiniteit is niet LESS",
      },
      weekendStart: PREFERENCE_CALIBRATION.weekendStart,
      operationalRequirements: OPERATIONAL_REQUIREMENTS_V1,
    },
    null,
    2,
  )}\n`,
);

const lengtes = [1, 2, 3, 4, 5, 6, 7];
const v2 = QUALITY_MODEL_V2.components.nights.parts.blocks.valueByLength as Record<number, number>;
writeFileSync(
  path.join(MAP, "night-preference-curve.json"),
  `${JSON.stringify(
    {
      schema: "ns-machinist-night-curve/1",
      sourceStatus: "MACHINIST_PREFERENCE — praktijk van machinisten, geen medische of fysiologische claim",
      userInput: {
        1: "zeer onprettig",
        2: "als het moet",
        3: "vaak nét niet lekker: je komt in het ritme en moet er alweer uit",
        4: "prima",
        5: "goed / decent",
        6: "qua ritme zeer prettig, maar meer totale nachtbelasting",
        7: "qua ritme zeer sterk, maar als structureel patroon niet wenselijk",
      },
      curve: lengtes.map((l) => ({
        length: l,
        rhythm: NIGHT_RHYTHM[l],
        load: NIGHT_LOAD[l],
        worthV3: nightBlockWorth(l),
        valueV2: l >= 5 ? v2[5] : (v2[l] ?? 0),
      })),
      notes: [
        "Model v3 rekent met worthV3 = ritme − belasting; model v2 (Final Brain) met valueV2.",
        "Zes nachten scoort op ritme hoger dan drie, maar krijgt geen voorkeur boven vijf (worth 0,95 = 0,95); zeven zakt naar 0,70.",
        "Zeven is ook het maximum aantal diensten in een reeks; langer bestaat in dit pakket niet.",
        `Model v3 hash-bron: ${QUALITY_MODEL_V3.version}.`,
      ],
    },
    null,
    2,
  )}\n`,
);
console.log("profile-affinity.json en night-preference-curve.json geschreven");
