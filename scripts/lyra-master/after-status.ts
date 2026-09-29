/**
 * De PASS/FAIL-beslissing van een AFTER-run — puur, zodat hij te toetsen is,
 * en altijd met redenen.
 *
 * ## Waarom dit een eigen bestand is (run 20260929-193436)
 *
 * Die run haalde 43/43 op de kernsuite in alle drie replicaten en kreeg toch
 * `status: "FAIL"`. Oorzaak: de telling `ruweBestanden.length === REPLICATES * 2`
 * (golden + grade per replicaat). In commit 8c19d91 werden ook de
 * extensiebestanden aan diezelfde lijst toegevoegd om ze te hashen — sindsdien
 * telde een volledige run 12 bestanden in plaats van 6 en was elke run FAIL.
 * Bovendien schreef het script bij FAIL "zie AFTER-VERIFICATION.json" terwijl
 * er geen enkele reden in dat bestand stond. Nu: elke bestandsgroep apart
 * geteld, en de redenen staan in de uitkomst.
 */

export interface AfterStatusInvoer {
  readonly replicaten: number;
  readonly modelBereikbaar: boolean;
  readonly stubUit: boolean;
  readonly alleReplicatenOk: boolean;
  readonly aggregatieOk: boolean;
  /** Bestandsnamen (basename) van de gehashte ruwe artefacten, per replicaat samengevoegd. */
  readonly ruweBestandsnamen: readonly string[];
  /** Draaide de extensie? Dan moeten haar bestanden er ook compleet zijn. */
  readonly extensieGedraaid: boolean;
}

export interface AfterStatus {
  readonly status: "PASS" | "FAIL";
  readonly redenen: readonly string[];
}

export function afterStatus(i: AfterStatusInvoer): AfterStatus {
  const redenen: string[] = [];
  if (!i.modelBereikbaar) redenen.push("het lokale model was niet bereikbaar");
  if (!i.stubUit) redenen.push("de stub was niet expliciet uitgeschakeld");
  if (!i.alleReplicatenOk) redenen.push("niet alle replicaten zijn voltooid");
  if (!i.aggregatieOk) redenen.push("de replicaat-aggregatie is mislukt");
  const tel = (naam: string) => i.ruweBestandsnamen.filter((b) => b === naam).length;
  for (const naam of ["golden.json", "golden-grade.json"]) {
    if (tel(naam) !== i.replicaten) redenen.push(`${naam}: ${tel(naam)} van ${i.replicaten} replicaten aanwezig`);
  }
  if (i.extensieGedraaid) {
    for (const naam of ["golden-extension.json", "golden-grade-extension.json"]) {
      if (tel(naam) !== i.replicaten) redenen.push(`${naam}: ${tel(naam)} van ${i.replicaten} replicaten aanwezig`);
    }
  }
  return { status: redenen.length === 0 ? "PASS" : "FAIL", redenen };
}
