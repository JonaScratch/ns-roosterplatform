import { describe, expect, it } from "vitest";
import { RosterProfile } from "@/lib/generated/prisma/enums";
import { categoryOf, type QualityDuty } from "@/domain/roster-quality";
import { DAY_DUTY_WEIGHTS } from "@/domain/profile-affinity";
import { rosterProfileLabel } from "@/domain/roster-profiles";

/**
 * Regressie-PINNING voor de gaten die de LYRA MASTER PROGRAM fase-0/2-
 * inventaris vaststelde (`docs/lyra-knowledge/conflict-report.md`,
 * `docs/lyra-knowledge/knowledge-gap-report.md`). §33/§34 van de opdracht
 * verbood elke inhoudelijke gedragswijziging vóór de bevroren BEFORE-meting
 * bestond — die freeze is nu bevestigd (run `20260927-205217`, zie
 * `docs/lyra-knowledge/progress.md`), dus wat hieronder nog PIN is, blijft
 * dat om een andere, met naam genoemde reden.
 *
 * Twee van de oorspronkelijk vijf gaten zijn intussen met een echte
 * regressietoets gedicht en BUITEN deze pin-suite gelaten:
 *   - `jsonUit()` — `tests/agent/json-uit-lokaal-model.test.ts` (commit `588c1e5`).
 *   - `memoryProposal` op de lokale-modelroute — `tests/agent/memory-proposal-lokaal-model.test.ts`
 *     (na de BEFORE-freeze: dit is Lyra-agent-plumbing, geen scheduling-
 *     domeinregel, en dus zonder verder risico voor het platform zelf te
 *     repareren).
 */

describe("PIN — MIX='Vroeg-Laat-Nacht'-alias: weergavelabel blijft een menselijke productbeslissing", () => {
  it("de interne bronvermelding van het MIX-dagdienstgewicht markeert de alias nu als onbevestigd (gerepareerd)", () => {
    // De helft van dit gat is gedicht: DAY_DUTY_WEIGHTS.MIX.source is een
    // interne toeschrijvingsstring (nooit aan een gebruiker getoond), dus
    // veilig om — net als VROEG's AANNAME-markering — expliciet als
    // onbevestigd te labelen zonder dat dit voor iemand zichtbaar gedrag
    // verandert. Zie profile-affinity.ts voor de exacte tekst.
    expect(DAY_DUTY_WEIGHTS.MIX.source).toMatch(/onbevestigd/i);
  });

  it("het weergavelabel 'Mix (Vroeg-Laat-Nacht)' blijft ongewijzigd — GEEN codegat, een productbeslissing", () => {
    // Dit deel van het gat is NIET gerepareerd, met opzet: rosterProfileLabel()
    // is echte, klantgerichte UI-tekst op 16+ plekken in het live platform
    // (roostercommissie, medewerker-dashboard, exports) — machinisten zien dit
    // label dagelijks in hun eigen rooster. Of de historische naam "Vroeg-
    // Laat-Nacht" moet blijven staan zonder brondekking is een productkeuze
    // voor NS, niet iets wat deze sessie zelf mag beslissen op basis van één
    // brondocument dat de alias "niet kan bevestigen" (wat iets anders is dan
    // "weerlegt"). SOURCE_INPUT_REQUIRED — zie knowledge-gap-report.md.
    expect(rosterProfileLabel(RosterProfile.MIX)).toBe("Mix (Vroeg-Laat-Nacht)");
  });
});

describe("PIN — de 60-minuten klok-vs-label-drempel ontbreekt in categoryOf() (v3-voorkeurslaag)", () => {
  const dienst = (kind: string, startMinute: number, endMinute: number): QualityDuty => ({ code: "T", weekday: 1, startMinute, endMinute, kinds: [kind] });

  it("twee diensten die qua klok bijna identiek zijn (19 min verschil, de echte 50+Mix-casus) krijgen tóch verschillende categorieën", () => {
    // Exact de historische 50+Mix-casus uit human-roster-design-principles.md
    // §3: een "laat" en een "vroeg" die 19 minuten verschillen qua begintijd.
    // De v1/v2-flow-laag (rhythm-metrics.ts/quality-model.ts) behandelt dit
    // terecht als "geen echte wissel" (drempel 60 min); categoryOf() — de
    // v3-voorkeurslaag — kijkt uitsluitend naar het label en ziet hier dus
    // een volwaardige NIGHT/LATE/EARLY-wissel, ook al verschuift de klok
    // nauwelijks.
    const laat = dienst("LAAT", 9 * 60 + 54, 18 * 60); // begint 09:54
    const vroeg = dienst("VROEG", 9 * 60 + 54 - 19, 17 * 60); // begint 19 min eerder: 09:35

    expect(categoryOf(laat)).toBe("LATE");
    expect(categoryOf(vroeg)).toBe("EARLY");
    // Het gat: categoryOf() heeft geen manier om te zien dat dit qua klok
    // bijna dezelfde dienst is — er bestaat geen derde uitkomst als "geen
    // echte wissel". Zodra dit gerepareerd wordt (§ conflict-report.md #3),
    // moet deze test bewust worden aangepast, niet stilzwijgend blijven
    // slagen op de oude aanname.
    expect(categoryOf(laat)).not.toBe(categoryOf(vroeg));
  });
});
