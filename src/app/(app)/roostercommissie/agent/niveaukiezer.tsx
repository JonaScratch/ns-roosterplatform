"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button } from "@/components/ui/primitives";
import { zetNiveauAction } from "./acties";

/**
 * Het niveau van de agent kiezen.
 *
 * ## Waarom dit een knop van de commissie is
 *
 * Niveau B en C laten de agent rekentijd gebruiken. Dat kost geld en tijd en
 * het raakt het rooster van collega's, dus het is een besluit van de
 * Roostercommissie — niet iets wat de agent voor zichzelf regelt en ook geen
 * instelling die ergens in een configuratiebestand wegzakt.
 *
 * ## Wat de niveaus betekenen
 *
 * A  De agent leest en legt uit. Hij start niets.
 * B  De agent mag een berekening voorstellen; een mens drukt op start.
 * C  De agent mag binnen een budget meerdere rondes achter elkaar doen.
 *
 * Publiceren zit in geen enkel niveau. Dat blijft een menselijke handeling.
 */

const UITLEG: Readonly<Record<"A" | "B" | "C", string>> = {
  A: "Analyseren en uitleggen. De agent start niets.",
  B: "De agent stelt een berekening voor; jij bevestigt.",
  C: "De agent mag binnen het budget meerdere rondes doen.",
};

export function Niveaukiezer({ huidig, locationCode }: { huidig: "A" | "B" | "C"; locationCode: string }) {
  const router = useRouter();
  const [melding, setMelding] = useState<string | null>(null);
  const [bezig, startOvergang] = useTransition();

  const kies = (level: "A" | "B" | "C") => {
    if (level === huidig || bezig) return;
    startOvergang(async () => {
      const uitkomst = await zetNiveauAction({ level, locationCode, maxSolverSeconds: level === "A" ? 0 : 300 });
      setMelding(uitkomst.message);
      router.refresh();
    });
  };

  return (
    <div className="space-y-2 py-2">
      <div className="flex gap-1.5">
        {(["A", "B", "C"] as const).map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => kies(level)}
            disabled={bezig}
            aria-pressed={level === huidig}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-[12.5px] font-semibold transition-colors disabled:opacity-50 ${
              level === huidig
                ? "border-accent-rc bg-accent-rc text-white"
                : "border-line-strong bg-surface text-ink hover:border-accent-rc hover:text-accent-rc"
            }`}
          >
            Niveau {level}
          </button>
        ))}
      </div>
      <p className="text-[11.5px] leading-snug text-ink-muted">{UITLEG[huidig]}</p>
      {melding && <Alert tone="neutral">{melding}</Alert>}
      {huidig !== "A" && (
        <p className="text-[11px] text-ink-faint">
          Rekenbudget: 300 seconden per opdracht. Publiceren blijft buiten elk niveau.
        </p>
      )}
      <div className="pt-1">
        <Button variant="secondary" size="small" type="button" disabled={bezig} onClick={() => router.refresh()}>
          Ververs
        </Button>
      </div>
    </div>
  );
}
