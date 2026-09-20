import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Schrijft de ablatieplanning en het PowerShell-script dat de ablaties na
 * elkaar draait (werkopdracht §24, fase H).
 *
 * Elke ablatie is één benchmarkfase met drie Evenwichtig-runs en precies één
 * onderdeel anders, via NS_ENGINE_PROFILE / NS_ENGINE_VARIANT. De runs draaien
 * los van deze sessie (Start-Process), omdat een onderbroken sessie
 * kindprocessen meeneemt; de runner slaat bestaande runbestanden over, dus een
 * herstart gaat verder waar hij stopte.
 *
 *   npm run final-brain:queue-ablations -- --scale 5
 */

const argument = (naam: string): string | null => {
  const index = process.argv.indexOf(`--${naam}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
};

const k = Number(argument("scale") ?? 1);
const runs = Number(argument("runs") ?? 3);
const WORTEL = path.resolve(__dirname, "..", "..");
const MAP = path.join(WORTEL, "docs", "v1.0.4-final-brain");

interface Stap {
  readonly phase: string;
  readonly label: string;
  readonly change: string;
  readonly profile?: string;
  readonly variant?: Record<string, unknown>;
}

const zonder = { worstCase: false, nightExitRepair: false, nightFirst: false };
const stappen: Stap[] = [
  { phase: "ab-frozen", label: "Bevroren v1.0.4 (reproductie)", change: "profiel frozen-1.0.4", profile: "frozen-1.0.4" },
  ...(k !== 1 ? [{ phase: `ab-k${k}`, label: `Nachtrij × ${k}`, change: `alleen de nachtrij in CP-SAT × ${k}`, variant: { nightExitScale: k, ...zonder } }] : []),
  { phase: `ab-k${k}-wc`, label: `+ slechtste geval`, change: "plus het slechtste geval in de rangschikking", variant: { nightExitScale: k, nightExitRepair: false, nightFirst: false } },
  { phase: `ab-k${k}-full`, label: `+ nachtuitgangreparatie, nachten eerst`, change: "plus gerichte reparatie van nachtuitgangen, nachtdoelen eerst", variant: { nightExitScale: k } },
  { phase: `ab-k${k}-nofirst`, label: `volledig, maar niet nachten eerst`, change: "zonder de volgorde nachten-eerst (alles tegelijk op ernst)", variant: { nightExitScale: k, nightFirst: false } },
  { phase: `ab-k${k}-f025`, label: `volledig, eerlijkheidsmarge 0,25`, change: "bewaking eerlijkheid 0,25 in plaats van 0,5", variant: { nightExitScale: k, guards: { fairness: 0.25, hours: 1, rest: 1 } } },
  { phase: `ab-k${k}-f100`, label: `volledig, eerlijkheidsmarge 1,0`, change: "bewaking eerlijkheid 1,0 in plaats van 0,5", variant: { nightExitScale: k, guards: { fairness: 1, hours: 1, rest: 1 } } },
];

const plan = [
  { phase: "human", label: "Ontwikkeling 2 (H09, referentie)", change: "menselijke tabel ×1, geen slechtste geval, geen nachtuitgangreparatie", strategies: ["BALANCED"] },
  ...stappen.map((s) => ({ phase: s.phase, label: s.label, change: s.change, strategies: ["BALANCED"], profile: s.profile ?? "rhythm", variant: s.variant ?? null })),
];
writeFileSync(path.join(MAP, "ablation-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);

const log = path.join(MAP, "ablations.log");
const regels = [
  `Set-Location "${WORTEL}"`,
  `"START $(Get-Date -Format o)" | Out-File -FilePath "${log}" -Encoding utf8`,
  ...stappen.flatMap((s) => [
    `"== ${s.phase} $(Get-Date -Format o)" | Out-File -FilePath "${log}" -Encoding utf8 -Append`,
    s.profile ? `$env:NS_ENGINE_PROFILE = '${s.profile}'` : `Remove-Item Env:NS_ENGINE_PROFILE -ErrorAction SilentlyContinue`,
    s.variant ? `$env:NS_ENGINE_VARIANT = '${JSON.stringify(s.variant)}'` : `Remove-Item Env:NS_ENGINE_VARIANT -ErrorAction SilentlyContinue`,
    `npm run verify:optimizer-benchmark -- run --phase ${s.phase} --engine adaptive --mode NORMAL --strategy BALANCED --runs ${runs} --first 1 *>&1 | Out-File -FilePath "${log}" -Encoding utf8 -Append`,
  ]),
  `Remove-Item Env:NS_ENGINE_PROFILE -ErrorAction SilentlyContinue`,
  `Remove-Item Env:NS_ENGINE_VARIANT -ErrorAction SilentlyContinue`,
  `"KLAAR $(Get-Date -Format o)" | Out-File -FilePath "${log}" -Encoding utf8 -Append`,
];
const script = path.join(os.tmpdir(), "final-brain-ablations.ps1");
writeFileSync(script, `﻿${regels.join("\r\n")}\r\n`);
console.log(`Plan: ${plan.length - 1} ablaties × ${runs} runs → ${path.join(MAP, "ablation-plan.json")}`);
console.log(`Script: ${script}`);
