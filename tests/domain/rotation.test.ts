import { describe, expect, it } from "vitest";
import {
  type RotationParticipant,
  buildSnapshot,
  placementsForOffset,
  positionOf,
  selectWinner,
} from "@/domain/rotation";

const deelnemers: readonly RotationParticipant[] = [
  { employeeId: "a", employeeNumber: "100001", baseIndex: 0 },
  { employeeId: "b", employeeNumber: "100002", baseIndex: 1 },
  { employeeId: "c", employeeNumber: "100003", baseIndex: 2 },
  { employeeId: "d", employeeNumber: "100004", baseIndex: 3 },
];

describe("roulatielijst", () => {
  it("geeft bij offset 0 de basisvolgorde", () => {
    expect(placementsForOffset(deelnemers, 0).map((p) => p.employeeNumber)).toEqual([
      "100001",
      "100002",
      "100003",
      "100004",
    ]);
  });

  it("schuift iedereen één plaats op per week", () => {
    // Wie bovenaan stond, komt onderaan; de rest schuift op. Dat is precies
    // wat "niet steeds dezelfde medewerkers bovenaan" betekent.
    expect(placementsForOffset(deelnemers, 1).map((p) => p.employeeNumber)).toEqual([
      "100004",
      "100001",
      "100002",
      "100003",
    ]);
    expect(placementsForOffset(deelnemers, 2).map((p) => p.employeeNumber)).toEqual([
      "100003",
      "100004",
      "100001",
      "100002",
    ]);
  });

  it("is na een volledige ronde weer bij het begin", () => {
    expect(placementsForOffset(deelnemers, 4).map((p) => p.employeeNumber)).toEqual(
      placementsForOffset(deelnemers, 0).map((p) => p.employeeNumber),
    );
  });

  it("geeft ook bij een negatieve offset geldige posities", () => {
    // Een teruggedraaide rotatie mag geen positie 0 of negatief opleveren.
    for (const placement of placementsForOffset(deelnemers, -3)) {
      expect(placement.position).toBeGreaterThanOrEqual(1);
      expect(placement.position).toBeLessThanOrEqual(4);
    }
    expect(positionOf(0, -1, 4)).toBe(4);
  });

  it("kiest de hoogst geplaatste geldige belangstellende", () => {
    const placements = placementsForOffset(deelnemers, 1);
    // Volgorde is d, a, b, c. Alleen b en c zijn geldig, dus b wint.
    const winner = selectWinner(placements, new Set(["b", "c"]));
    expect(winner?.employeeNumber).toBe("100002");
  });

  it("kiest niemand wanneer geen enkele belangstellende geldig is", () => {
    expect(selectWinner(placementsForOffset(deelnemers, 0), new Set())).toBeNull();
  });

  it("legt de volledige volgorde vast, inclusief wie niet meedeed", () => {
    // Zonder deze momentopname is achteraf niet na te gaan waarom iemand de
    // dienst niet kreeg; de lijst schuift immers door.
    const snapshot = buildSnapshot(
      3,
      1,
      placementsForOffset(deelnemers, 1),
      new Set(["b", "c"]),
      new Set(["c"]),
    );
    expect(snapshot.weekday).toBe(3);
    expect(snapshot.offset).toBe(1);
    expect(snapshot.ranking).toHaveLength(4);
    expect(snapshot.ranking[0]).toMatchObject({
      position: 1,
      employeeNumber: "100004",
      interested: false,
      eligible: false,
    });
    expect(snapshot.ranking.find((row) => row.employeeNumber === "100002")).toMatchObject({
      interested: true,
      eligible: false,
    });
  });

  it("kan overweg met een lege lijst", () => {
    expect(placementsForOffset([], 5)).toEqual([]);
    expect(() => positionOf(0, 0, 0)).toThrow();
  });
});
