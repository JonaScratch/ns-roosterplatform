// Wat een lange run nu doet, in woorden (incident DR-UI-202609301449): een
// kaartje "6 uur" mag niet suggereren dat er zes uur ontwikkeld wordt als de
// run stil staat. Eén bron voor Dashboard, Development Runs en het paneel
// "Lange runs"; de waarden komen uit het canonieke checkpoint (factory/longRun.ts).

export const FASE_LABEL = {
  ONDERZOEKT: ["Actief onderzoeken", "good"],
  NIEUWE_HYPOTHESE: ["Nieuwe hypothese", "good"],
  MEER_BEWIJS: ["Zelfde hypothese, meer bewijs", "good"],
  STRATEGIE_GEWISSELD: ["Strategie gewisseld", "good"],
  FAMILIE_GEWISSELD: ["Kandidaatfamilie gewisseld", "good"],
  ZWAKTE_GEWISSELD: ["Zwakte gewisseld", "good"],
  LOKAAL_UITGEPUT: ["Zwakte lokaal uitgeput — gaat door", "warn"],
  ZOEKRUIMTE_VERBREED: ["Zoekruimte verbreed — nieuwe golf", "good"],
  AANPAK_GEWISSELD: ["Aanpak gewisseld — nieuwe golf", "good"],
  GEPAUZEERD: ["Gepauzeerd", "warn"],
  GLOBAAL_UITGEPUT: ["Oud: globaal uitgeput (vóór de regisseur)", ""],
  BUDGET_BEREIKT: ["Tijd/budget bereikt", ""],
  MAX_CYCLI: ["Maximum aantal cycli bereikt", ""],
  HANDMATIG_GESTOPT: ["Handmatig gestopt", ""],
  FOUT_BLOKKADE: ["Echte fout/blocker", "bad"],
  CAPACITEIT_BLOKKADE: ["Capaciteitsgrens — escalatie nodig", "bad"],
};

export const LONGRUN_STOP_LABEL = {
  BUDGET_OP: "Tijd/budget bereikt",
  ALLES_GEPROBEERD: "Oud: vaste ruimte op (vóór de regisseur) — geen voltooiing",
  CAPACITEIT_BLOKKADE: "Blocker: regisseur kan niets nieuws meer — escalatie",
  HANDMATIG_GESTOPT: "Handmatig gestopt",
  MAX_CYCLI: "Maximum aantal cycli",
  GEEN_DIAGNOSE: "Blocker: geen diagnose (model/database)",
  HERHAALDE_FOUT: "Blocker: herhaalde fout",
  GEEN_VOORTGANG: "Oud: geen voortgang (vóór verkenningsbudget)",
};

// Alleen BUDGET_OP is voltooiing van een tijdprofiel; al het andere is een
// eerlijke runstatus (scripts/lyra-master/verify-long-run.ts, "actief budget benut").
export function voltooiingTekst(stopReden, actieveMinuten, budgetMinuten) {
  if (!stopReden) return "";
  if (stopReden === "BUDGET_OP") return "voltooid: budget benut";
  if (budgetMinuten) return `niet voltooid: ${actieveMinuten ?? "?"} van ${budgetMinuten} actieve min`;
  return "niet voltooid";
}

export function faseTag(fase, esc) {
  const [label, soort] = FASE_LABEL[fase] ?? [fase ?? "—", ""];
  return `<span class="tag ${soort}">${esc(label)}</span>`;
}
