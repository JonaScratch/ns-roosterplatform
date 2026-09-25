import type { PromotionProposal } from "../types";

/**
 * Promotion proposals (§29 van de opdracht en §9 van het format).
 *
 * Deze module doet één ding: van meetresultaten een voorstel-tekst maken.
 * Er is hier geen functie die iets promoveert — dat blijft, net als bij de
 * bestaande `promotieStappen()` in de hoofdapp, een menselijke handeling.
 */

function regressieVrij(pre: Record<string, number>, post: Record<string, number>, marge = 0): readonly string[] {
  return Object.keys(pre)
    .filter((k) => post[k] !== undefined && post[k] < pre[k] - marge)
    .map((k) => `${k}: ${pre[k].toFixed(2)} → ${post[k].toFixed(2)}`);
}

export function beoordeelPromotie(input: {
  readonly change: string;
  readonly reason: string;
  readonly pre: Record<string, number>;
  readonly post: Record<string, number>;
  readonly holdout: Record<string, number> | null;
  readonly marge?: number;
}): PromotionProposal {
  const regressions = regressieVrij(input.pre, input.post, input.marge ?? 0);
  const holdoutRegressions = input.holdout ? regressieVrij(input.pre, input.holdout, input.marge ?? 0) : [];
  const alleRegressies = [...new Set([...regressions, ...holdoutRegressions])];

  const winst = Object.keys(input.pre).some((k) => input.post[k] !== undefined && input.post[k] > input.pre[k]);

  const recommendation: PromotionProposal["recommendation"] =
    alleRegressies.length > 0
      ? "DO_NOT_PROMOTE"
      : !winst
        ? "DO_NOT_PROMOTE"
        : input.holdout === null
          ? "MORE_TESTING_REQUIRED"
          : "PROMOTE";

  return {
    id: `DR-P${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
    change: input.change,
    reason: input.reason,
    pre: input.pre,
    post: input.post,
    holdout: input.holdout,
    regressions: alleRegressies,
    recommendation,
  };
}

export function renderPromotionProposal(p: PromotionProposal): string {
  const regels = (o: Record<string, number>) =>
    Object.entries(o)
      .map(([k, v]) => `${k}: ${v.toFixed(1)}%`)
      .join(", ");
  return [
    `Proposal ${p.id}`,
    "",
    `Change:`,
    p.change,
    "",
    `Reason:`,
    p.reason,
    "",
    `PRE:`,
    regels(p.pre) || "(geen)",
    "",
    `POST:`,
    regels(p.post) || "(geen)",
    "",
    `Holdout:`,
    p.holdout ? regels(p.holdout) : "(nog niet gemeten)",
    "",
    `Regressions:`,
    p.regressions.length > 0 ? p.regressions.join("; ") : "0",
    "",
    `Recommendation:`,
    p.recommendation,
  ].join("\n");
}
