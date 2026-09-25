import { describe, expect, it } from "vitest";
import { DemoRoomSafetyError, NOOIT_TOEGESTAAN, assertNietVerboden } from "../../demo-room/src/safety";

describe("Demo Room — veiligheidsgrens", () => {
  it("laat een gewone leeshandeling ongemoeid", () => {
    expect(() => assertNietVerboden("kandidaat vergelijken")).not.toThrow();
    expect(() => assertNietVerboden("onderzoekslus starten")).not.toThrow();
  });

  it("blokkeert elke handeling op de NOOIT_TOEGESTAAN-lijst", () => {
    for (const verboden of NOOIT_TOEGESTAAN) {
      expect(() => assertNietVerboden(`test: ${verboden}`)).toThrow(DemoRoomSafetyError);
    }
  });

  it("is niet hoofdlettergevoelig", () => {
    expect(() => assertNietVerboden("ROOSTER GOEDKEUREN")).toThrow(DemoRoomSafetyError);
  });

  it("de foutmelding noemt de handeling zelf", () => {
    try {
      assertNietVerboden("rooster publiceren namens de commissie");
      throw new Error("had moeten gooien");
    } catch (fout) {
      expect(fout).toBeInstanceOf(DemoRoomSafetyError);
      expect((fout as DemoRoomSafetyError).message).toContain("publiceren");
    }
  });
});
