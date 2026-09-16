import "dotenv/config";
import {
  assessStructuralChange,
  isStructuralAnchor,
} from "@/domain/roster-structure";
import { prisma } from "@/server/data/prisma";
import {
  baselineOf,
  baselineSlotFor,
  createPeriodCore,
  sealBaselineCore,
} from "@/server/services/roster-period-service";
import { proposeStructure } from "@/server/services/roster-structure-service";

/**
 * Het wijzigingsblad, van begin tot eind uitgevoerd.
 *
 * ## Waarom dit script bestaat
 *
 * De ankervergrendeling was tot nu toe alleen in eenheidstests bewezen. Die
 * werken met verzonnen baselines; ze zeggen niets over de vraag of de keten in
 * de database ook echt sluit. `verify:wijzigingsblad` meldde daarom "er is nog
 * geen wijzigingsblad aangemaakt; niets te vergelijken" — een groene uitkomst
 * over een controle die niet is uitgevoerd.
 *
 * Dit script máákt er een. Het legt de structuur van de huidige ronde vast,
 * opent een wijzigingsblad daarop, en probeert vervolgens werkelijk een
 * rustdag te verplaatsen. Dat hoort op elke laag te worden geweigerd.
 *
 * ## Wat het achterlaat
 *
 * Niets. Aan het eind worden het wijzigingsblad en de vastgelegde baseline
 * verwijderd en gaat de ronde terug naar STRUCTURE_EDITABLE. Een meting die
 * gegevens achterlaat, verandert wat de volgende meting meet.
 *
 * Draaien met: npm run verify:wijzigingsblad
 */

let geslaagd = 0;
let mislukt = 0;

function toets(naam: string, goed: boolean, toelichting = ""): void {
  if (goed) {
    geslaagd += 1;
    console.log(`  ✓ ${naam}`);
  } else {
    mislukt += 1;
    console.log(`  ✗ ${naam}${toelichting ? ` — ${toelichting}` : ""}`);
  }
}

async function main(): Promise<void> {
  console.log("WIJZIGINGSBLAD — DE ANKERS LIGGEN VAST");
  console.log("═".repeat(72));

  const basis = await prisma.rosterPeriod.findFirst({
    where: { location: { code: "DDR" }, changeType: "NEW_TIMETABLE" },
    orderBy: [{ year: "desc" }, { version: "desc" }],
  });
  if (!basis) {
    console.log("\nEr is geen dienstregelingronde voor DDR. Draai eerst npm run db:seed.");
    process.exitCode = 1;
    return;
  }

  const oorspronkelijkeStaat = basis.structureState;
  const oorspronkelijkeSeal = basis.baselineSealedAt;
  let wijzigingsbladId: string | null = null;

  try {
    // ── 1. De structuur vastleggen ─────────────────────────────────────────
    console.log("\n1. De structuur van de dienstregelingronde vastleggen");
    const seal = await sealBaselineCore(prisma, basis.id, null);
    const baseline = await baselineOf(basis.id);
    console.log(`  ${basis.label}: ${baseline.length} dagen vastgelegd (${seal.slots ?? "?"}).`);
    toets(
      "de baseline bevat elke dagcel van elk basisrooster",
      baseline.length === 448,
      `${baseline.length} in plaats van 448`,
    );

    const ankers = baseline.filter((slot) => slot.structuralAnchor);
    toets(
      "de ankers zijn als anker gemarkeerd",
      ankers.length === 225,
      `${ankers.length} ankers; verwacht 225 (128 rust + 56 reserve + 32 WTV + 9 compensatie)`,
    );

    // ── 2. Het wijzigingsblad openen ───────────────────────────────────────
    console.log("\n2. Een wijzigingsblad openen");
    const wijzigingsblad = await createPeriodCore(
      prisma,
      {
        locationCode: "DDR",
        timetableId: basis.timetableId,
        year: basis.year,
        changeType: "AMENDMENT",
        baseVersionId: basis.id,
        validFrom: basis.validFrom,
        validUntil: basis.validUntil ?? undefined,
      },
      null,
    );
    wijzigingsbladId = wijzigingsblad.id;
    console.log(`  ${wijzigingsblad.label} aangemaakt op basis van ${basis.label}.`);
    toets(
      "het wijzigingsblad verwijst naar de vastgelegde ronde",
      wijzigingsblad.baseVersionId === basis.id,
    );

    // ── 3. Een anker proberen te verplaatsen ───────────────────────────────
    console.log("\n3. Een rustdag proberen te verplaatsen");
    const rustdag = baseline.find(
      (slot) => slot.slotType === "RUST" && slot.baseRosterCode === "DDR-V",
    );
    if (!rustdag) {
      toets("er is een rustdag om mee te proberen", false, "geen rustdag in de baseline");
      return;
    }
    console.log(
      `  ${rustdag.baseRosterCode} regel ${rustdag.lineNumber}, week ${rustdag.weekIndex}, ` +
        `weekdag ${rustdag.weekday}: nu ${rustdag.slotType}.`,
    );

    // Laag 1: de domeinbeoordeling, per losse dag.
    const uitkomst = assessStructuralChange({
      changeType: "AMENDMENT",
      baseline: rustdag,
      proposed: { kind: "DUTY", dutyCode: "101" },
    });
    toets(
      "laag 1 — de domeinbeoordeling weigert er een dienst van te maken",
      uitkomst.verdict === "ANCHOR_LOCKED",
      `uitkomst: ${uitkomst.verdict}`,
    );

    // Laag 2: de baseline in de database, opnieuw opgezocht via dezelfde weg
    // die de applicatie gebruikt.
    const opnieuw = await baselineSlotFor(basis.id, {
      baseRosterCode: rustdag.baseRosterCode,
      lineNumber: rustdag.lineNumber,
      weekIndex: rustdag.weekIndex,
      weekday: rustdag.weekday,
    });
    toets(
      "laag 2 — de bevroren baseline levert dezelfde ankerdag op",
      opnieuw !== null &&
        opnieuw.slotType === rustdag.slotType &&
        opnieuw.structuralAnchor === true,
      "de opgeslagen baseline wijkt af van wat er is vastgelegd",
    );

    // Laag 3: de structuurgenerator weigert een AMENDMENT-ronde helemaal.
    // Die weigering hangt aan de ronde en niet aan de losse dag.
    console.log(
      "  laag 3 — de structuurgenerator: getoetst in verify:structuurgeneratie en in de\n" +
        "            code van proposeStructure (AMENDMENT_ANCHORS_LOCKED).",
    );

    // ── 4. Wat wél mag ─────────────────────────────────────────────────────
    console.log("\n4. Wat een wijzigingsblad wél mag");
    const dienstdag = baseline.find(
      (slot) => !slot.structuralAnchor && slot.baseRosterCode === "DDR-V",
    );
    if (dienstdag) {
      const anderDienstnummer = assessStructuralChange({
        changeType: "AMENDMENT",
        baseline: dienstdag,
        proposed: { kind: "DUTY", dutyCode: "999" },
      });
      toets(
        "een dienstdag mag een ander dienstnummer krijgen",
        anderDienstnummer.verdict === "NO_STRUCTURAL_OBJECTION",
        `uitkomst: ${anderDienstnummer.verdict}`,
      );

      const naarRust = assessStructuralChange({
        changeType: "AMENDMENT",
        baseline: dienstdag,
        proposed: { kind: "POSITION", slotType: "RUST" },
      });
      // Een dienstdag naar rust is geen ankerverplaatsing: er verdwijnt geen
      // vrije dag, er komt er een bij. Of dat mag, is een capaciteitsvraag voor
      // de overige regels en niet voor de ankervergrendeling.
      toets(
        "een dienstdag naar rust is geen ankerverplaatsing",
        naarRust.verdict === "NO_STRUCTURAL_OBJECTION",
        `uitkomst: ${naarRust.verdict}`,
      );
    }

    // ── 5. Elk ankertype ───────────────────────────────────────────────────
    console.log("\n5. Elk ankertype ligt vast, niet alleen de rustdag");
    const perType = new Map<string, (typeof baseline)[number]>();
    for (const slot of baseline) {
      if (slot.structuralAnchor && !perType.has(slot.slotType)) {
        perType.set(slot.slotType, slot);
      }
    }
    for (const [type, slot] of perType) {
      const naarDienst = assessStructuralChange({
        changeType: "AMENDMENT",
        baseline: slot,
        proposed: { kind: "DUTY", dutyCode: "101" },
      });
      toets(
        `${type} kan niet in een dienstdag worden veranderd`,
        naarDienst.verdict === "ANCHOR_LOCKED" && isStructuralAnchor(slot.slotType),
        `uitkomst: ${naarDienst.verdict}`,
      );
    }
    toets(
      "alle vier de ankertypen komen in de baseline voor",
      perType.size === 4,
      `aangetroffen: ${[...perType.keys()].join(", ")}`,
    );

    // ── 6. De structuurgenerator op een wijzigingsblad ─────────────────────
    console.log("\n6. De structuurgenerator op een wijzigingsblad");
    // Zonder ingelogde gebruiker geeft dit een rechtenfout, en dat is óók een
    // weigering — maar niet de weigering die we willen aantonen. Daarom wordt
    // hier alleen de uitkomst gemeld en niet als bewijs geteld.
    try {
      const voorstel = await proposeStructure("DDR");
      console.log(
        `  uitkomst: ${voorstel.ok ? "GEGENEREERD" : voorstel.code}` +
          (voorstel.ok ? "" : ` — ${voorstel.reason.slice(0, 90)}`),
      );
    } catch (error) {
      console.log(
        `  niet aanroepbaar zonder sessie (${
          error instanceof Error ? error.name : "onbekend"
        }); de weigering op AMENDMENT is getoetst in de code en in verify:structuurgeneratie.`,
      );
    }
  } finally {
    // ── Opruimen ───────────────────────────────────────────────────────────
    if (wijzigingsbladId) {
      await prisma.rosterStructureBaselineSlot.deleteMany({
        where: { periodId: wijzigingsbladId },
      });
      await prisma.rosterPeriod.delete({ where: { id: wijzigingsbladId } });
    }
    await prisma.rosterStructureBaselineSlot.deleteMany({ where: { periodId: basis.id } });
    await prisma.rosterPeriod.update({
      where: { id: basis.id },
      data: { structureState: oorspronkelijkeStaat, baselineSealedAt: oorspronkelijkeSeal },
    });
    console.log("\n(het wijzigingsblad en de baseline van deze meting zijn opgeruimd)");
  }

  console.log(`\n${"═".repeat(72)}`);
  console.log(`${geslaagd} controles geslaagd, ${mislukt} mislukt.`);
  if (mislukt > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
