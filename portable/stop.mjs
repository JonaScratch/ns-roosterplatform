import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Het draagbare platform afsluiten.
 *
 * ## Waarom hier niet "alle node-processen" worden gestopt
 *
 * De verleiding is groot: één regel taskkill en klaar. Maar dit draait op de
 * computer van iemand anders, en die heeft misschien ander werk openstaan dat
 * toevallig ook op Node draait. Een stopknop die dat meeneemt, is geen
 * stopknop maar een ongeluk.
 *
 * Daarom wordt uitsluitend het procesnummer uit de eigen grendel gestopt, en
 * de database uit de eigen map. Wat hier niet bij hoort, blijft draaien.
 */

const HIER = path.dirname(fileURLToPath(import.meta.url));
// Dit bestand staat in de wortel van de bundel, naast de .bat-bestanden.
// Eerder stond hier `path.resolve(HIER, "..")`, en dan wees alles één map te
// hoog: het startscript zocht de applicatie naast de bundel in plaats van erin.
const WORTEL = HIER;
const GRENDEL = path.join(WORTEL, "logs", "draait.lock");
/** Dezelfde plek als het startscript gebruikt; zie DATA_DIR daar. */
function leesDataDir() {
  const bestand = path.join(WORTEL, "config", "instellingen.env");
  if (existsSync(bestand)) {
    for (const regel of readFileSync(bestand, "utf8").split(/\r?\n/)) {
      const treffer = /^\s*DATA_DIR\s*=\s*(.+?)\s*$/.exec(regel);
      if (treffer) {
        return path.resolve(WORTEL, treffer[1].replace(/^"(.*)"$/, "$1"));
      }
    }
  }
  return path.join(WORTEL, "database", "pgdata");
}

const DATA_DIR = leesDataDir();
const PG_CTL = path.join(WORTEL, "runtime", "postgres", "bin", "pg_ctl.exe");

function meld(regel) {
  console.log(regel);
}

function main() {
  meld("NS Roosterplatform — afsluiten");

  let gestopt = false;

  if (existsSync(GRENDEL)) {
    const pid = Number(readFileSync(GRENDEL, "utf8").trim());
    if (Number.isInteger(pid)) {
      try {
        process.kill(pid, 0);
        // /T neemt de kindprocessen mee: de webserver hangt onder de starter.
        // Alleen deze boom, aangewezen met een procesnummer dat wij zelf hebben
        // opgeschreven.
        spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8" });
        meld(`De applicatie (proces ${pid}) is gestopt.`);
        gestopt = true;
      } catch {
        meld(`Proces ${pid} draaide al niet meer.`);
      }
    }
    try {
      unlinkSync(GRENDEL);
    } catch {
      /* niets */
    }
  } else {
    meld("Er stond geen grendel; de applicatie draaide waarschijnlijk niet.");
  }

  if (existsSync(path.join(DATA_DIR, "postmaster.pid")) && existsSync(PG_CTL)) {
    const uitkomst = spawnSync(PG_CTL, ["-D", DATA_DIR, "-m", "fast", "-w", "-t", "30", "stop"], {
      encoding: "utf8",
    });
    if (uitkomst.status === 0) {
      meld("De database is netjes afgesloten; alle bevestigde wijzigingen staan vast.");
      gestopt = true;
    } else {
      meld("De database reageerde niet op het stopverzoek.");
      meld(`${uitkomst.stdout ?? ""}${uitkomst.stderr ?? ""}`.trim().slice(0, 300));
      meld("Bij de volgende start herstelt de database zichzelf uit het transactielogboek.");
    }
  } else {
    meld("De database draaide niet.");
  }

  meld(gestopt ? "Klaar. De stick kan er veilig uit." : "Er was niets om af te sluiten.");
}

main();
