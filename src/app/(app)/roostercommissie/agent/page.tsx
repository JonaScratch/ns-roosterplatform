import { RosterCommitteeShell } from "@/components/layout/area-shell";
import { LocationSelector } from "@/components/layout/location-selector";
import { Alert, Badge, EmptyState, WidgetCard } from "@/components/ui/primitives";
import { modelForRequest } from "@/server/agent/agent";
import { AGENT_CAPABILITIES, AGENT_LEVEL_LABELS, currentGrant, levelOf } from "@/server/agent/capabilities";
import { ownSessionMessages, ownSessions } from "@/server/agent/sessions";
import { toolCatalogue } from "@/server/agent/tools";
import { currentActor } from "@/server/auth/session";
import { prisma } from "@/server/data/prisma";
import { actorHasPermission } from "@/server/security/authorize";
import { locationScopeFor } from "@/server/security/location-scope";
import type { Permission } from "@/server/security/permissions";
import { listBaseRosters } from "@/server/services/roster-service";
import { ActiviteitenPaneel } from "./activiteitenpaneel";
import { Gesprek } from "./gesprek";
import type { GesprekBericht } from "./types";

export const dynamic = "force-dynamic";

/**
 * De roosteragent.
 *
 * ## Wat dit scherm is, en wat het nog niet is
 *
 * Dit is niveau A: vragen stellen over de roosters die er zijn. De agent leest
 * de gegevens echt — regels, diensten, uren, nachtstructuur, regelteksten — en
 * zegt bij elk antwoord waar het op steunt. Hij wijzigt niets, hij start niets,
 * en hij kan zijn eigen bevoegdheden niet verruimen.
 *
 * Achter de antwoorden zit nog geen taalmodel maar een vaste redeneerlaag. Dat
 * staat in het scherm zelf, en niet alleen in de documentatie: wie dit gebruikt
 * moet weten dat een net antwoord hier nog geen taalbegrip bewijst.
 */

const CAPABILITY_TEKST: Readonly<Record<string, string>> = {
  [AGENT_CAPABILITIES.CHAT]: "Vragen beantwoorden over roosters, regels en verdeling",
  [AGENT_CAPABILITIES.JOB_CREATE]: "Zelf een berekening starten binnen vastgestelde grenzen",
  [AGENT_CAPABILITIES.MEMORY_WRITE]: "Leren onthouden wat de commissie belangrijk vindt",
  [AGENT_CAPABILITIES.AUTONOMOUS]: "Meerdere rondes achter elkaar zoeken",
  [AGENT_CAPABILITIES.PREFERENCE_PROPOSE]: "Een voorkeur voorstellen (een mens beslist)",
  [AGENT_CAPABILITIES.PREFERENCE_APPROVE]: "Een voorgestelde voorkeur vaststellen",
  [AGENT_CAPABILITIES.CROSSLOCATION_READ]: "Van andere standplaatsen leren",
  [AGENT_CAPABILITIES.EXPERIMENT_PROPOSE]: "Een technisch experiment voorstellen",
  [AGENT_CAPABILITIES.EXPERIMENT_RUN]: "Een experiment draaien in een afgeschermde omgeving",
};

/**
 * Hoe een kandidaat in de keuzelijst heet.
 *
 * "Technisch gevalideerd" is geen synoniem voor "goedgekeurd": de validator
 * heeft geen bewezen overtreding gevonden, meer niet. Die woorden staan er
 * daarom precies zo.
 */
const TOESTAND_TEKST: Readonly<Record<string, string>> = {
  NOT_VALIDATED: "nog niet gevalideerd",
  TECHNICALLY_VALIDATED: "technisch gevalideerd",
  TECHNICALLY_VALID_UNVERIFIED_RULES: "technisch geldig, regels onbevestigd",
  TECHNICALLY_VALID_INCOMPLETE_CONTEXT: "technisch geldig, context onvolledig",
  CONFIRMED_HARD_VIOLATION: "bewezen overtreding",
};

export default async function Roosteragent({
  searchParams,
}: {
  searchParams: Promise<{ standplaats?: string; gesprek?: string }>;
}) {
  const { standplaats, gesprek } = await searchParams;
  const actor = await currentActor();
  if (!actor) {
    // De shell stuurt door naar het aanmeldscherm; dit is alleen de typegrens.
    return null;
  }

  // De standplaats komt uit de sessie, niet uit de adresbalk.
  const scope = await locationScopeFor(actor, standplaats ?? null);
  const locationCode = scope.code;

  const [roosters, kandidaatRijen, grant, sessies] = await Promise.all([
    listBaseRosters(standplaats ?? null),
    prisma.candidateRoster.findMany({
      where: { locationCode },
      orderBy: { generatedAt: "desc" },
      take: 8,
      select: { id: true, scenarioLabel: true, validationState: true, generatedAt: true },
    }),
    currentGrant(locationCode),
    ownSessions(actor, locationCode),
  ]);

  const niveau = levelOf(grant);
  const model = modelForRequest();
  const tools = toolCatalogue(actor);

  const gekozenGesprek = gesprek ?? null;
  const eerdere = gekozenGesprek ? await ownSessionMessages(actor, gekozenGesprek) : [];
  const beginBerichten: readonly GesprekBericht[] = eerdere
    .filter((m) => m.role !== "SYSTEM")
    .map((m) => ({
      id: m.id,
      rol: m.role === "USER" ? ("USER" as const) : ("AGENT" as const),
      tekst: m.text,
      status: m.role === "AGENT" ? "BEANTWOORD" : undefined,
      sources: m.sources,
      tools: m.tools,
    }));

  const eersteRooster = roosters[0]?.code ?? null;
  const voorbeelden = eersteRooster
    ? [
        "Welke diensten staan er in regel 4?",
        "Op welke regels van dit rooster staan nachtdiensten?",
        "Wat is het roostergemiddelde van dit rooster?",
        "Hoeveel rust moet er minimaal tussen twee diensten zitten?",
      ]
    : ["Hoeveel rust moet er minimaal tussen twee diensten zitten?"];

  return (
    <RosterCommitteeShell
      activeHref="/roostercommissie/agent"
      header={{
        title: "Roosteragent",
        subtitle: `Niveau ${niveau} — ${AGENT_LEVEL_LABELS[niveau]}`,
        context: <LocationSelector requested={standplaats ?? null} />,
      }}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Gesprek
          locationCode={locationCode}
          roosters={roosters.map((r) => ({ code: r.code, label: r.profileLabel, lines: r.lines }))}
          kandidaten={kandidaatRijen.map((k) => ({
            id: k.id,
            label: `${k.scenarioLabel} — ${TOESTAND_TEKST[k.validationState] ?? k.validationState.toLowerCase()}`,
          }))}
          beginBerichten={beginBerichten}
          beginSessionId={gekozenGesprek}
          voorbeelden={voorbeelden}
          niveau={niveau}
          modelNaam={model.name}
          isTaalmodel={model.isLanguageModel}
        />

        <div className="space-y-4">
          <ActiviteitenPaneel locationCode={locationCode} />

          <WidgetCard title="Wat de agent mag" subtitle="Twee sloten: jouw recht én de toekenning">
            <ul className="divide-y divide-line py-1">
              {Object.values(AGENT_CAPABILITIES).map((cap) => {
                const toegekend = grant.capabilities.includes(cap);
                const recht = actorHasPermission(actor, cap as Permission);
                return (
                  <li key={cap} className="flex items-start justify-between gap-3 py-2">
                    <span className="min-w-0 text-[12.5px] text-ink">{CAPABILITY_TEKST[cap] ?? cap}</span>
                    <span className="shrink-0">
                      {toegekend && recht ? (
                        <Badge tone="ok">aan</Badge>
                      ) : !recht ? (
                        <Badge tone="neutral">geen recht</Badge>
                      ) : (
                        <Badge tone="neutral">uit</Badge>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="pb-3 text-[11px] text-ink-faint">
              De agent kan deze schakelaars niet zelf omzetten. Publiceren staat er niet bij: dat
              blijft een handeling van een mens.
            </p>
          </WidgetCard>

          <WidgetCard title="Waar de antwoorden vandaan komen" subtitle={`${tools.length} bronnen die de agent mag lezen`}>
            <ul className="space-y-1.5 py-2">
              {tools.map((t) => (
                <li key={t.name} className="text-[12px] leading-snug">
                  <span className="font-mono text-[11.5px] text-accent-rc">{t.name}</span>
                  <span className="text-ink-muted"> — {t.description}</span>
                  {!t.allowed && <span className="text-state-warn"> (jij hebt hier geen recht op)</span>}
                </li>
              ))}
            </ul>
          </WidgetCard>

          <WidgetCard title="Eerdere gesprekken" subtitle="Alleen je eigen gesprekken">
            {sessies.length === 0 ? (
              <EmptyState>Nog geen gesprekken op deze standplaats.</EmptyState>
            ) : (
              <ul className="divide-y divide-line py-1">
                {sessies.map((s) => (
                  <li key={s.id} className="py-2">
                    <a
                      href={`/roostercommissie/agent?gesprek=${s.id}${standplaats ? `&standplaats=${standplaats}` : ""}`}
                      className="block text-[12.5px] text-ink hover:text-accent-rc"
                    >
                      <span className="line-clamp-2">{s.title}</span>
                      <span className="text-[11px] text-ink-faint">
                        {s.messageCount} beurten
                        {s.lastMessageAt
                          ? ` · ${s.lastMessageAt.toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}`
                          : ""}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </WidgetCard>

          <Alert tone="neutral" title="Wat hier nog niet zit">
            Het permanente activiteitenpaneel, het leergeheugen en het laten rekenen van kandidaten
            komen in de volgende fasen. Wat op dit scherm staat, werkt; wat er niet staat, bestaat
            nog niet.
          </Alert>
        </div>
      </div>
    </RosterCommitteeShell>
  );
}
