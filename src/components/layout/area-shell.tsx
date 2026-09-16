import "server-only";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { currentActor } from "@/server/auth/session";
import { actorHasPermission } from "@/server/security/authorize";
import { type Permission, PERMISSIONS, homePathForRoles } from "@/server/security/permissions";
import { AppShell, type HeaderProps, markActive, visibleSections } from "./app-shell";
import {
  adminNavigation,
  dutyAssignmentNavigation,
  employeeNavigation,
  navigationForArea,
  rosterCommitteeNavigation,
} from "./navigation";
import { assignmentNavCounts, employeeNavCounts } from "@/server/services/nav-counts";
import { RulesetBanner } from "./ruleset-banner";
import { DemoStatusBadge } from "./demo-status-badge";

/**
 * Het raamwerk per werkgebied.
 *
 * ## Waarom de shell in de pagina zit en niet in de layout
 *
 * De kop bevat de paginatitel, en die verschilt per scherm. Een layout in de
 * App Router kent het huidige pad niet, dus een kop die daar wordt opgebouwd
 * kan alleen een vaste titel dragen. Door de shell in de pagina te zetten,
 * bepaalt elk scherm zijn eigen kop en zijn eigen actieve menu-item — precies
 * zoals in de ontwerpen.
 *
 * Dat kost geen extra sessielezing: `currentActor` is gecachet per verzoek.
 *
 * ## De toegangscontrole hier is een omleiding, geen slot
 *
 * Wie het recht niet heeft, wordt naar zijn eigen omgeving gestuurd in plaats
 * van op een foutmelding te stuiten. Het slot zit in de services die de
 * gegevens ophalen; die weigeren onafhankelijk van dit bestand.
 */

interface AreaShellProps {
  readonly header: HeaderProps;
  /** Het menu-item dat als huidige pagina wordt gemarkeerd. */
  readonly activeHref: string;
  readonly children: ReactNode;
}

async function requireArea(permission: Permission) {
  const actor = await currentActor();
  if (!actor) {
    redirect("/aanmelden");
  }
  if (!actorHasPermission(actor, permission)) {
    redirect(homePathForRoles(actor.roles));
  }
  return actor;
}

export async function EmployeeShell({ header, activeHref, children }: AreaShellProps) {
  const actor = await requireArea(PERMISSIONS.SCHEDULE_READ_OWN);
  const counts = await employeeNavCounts();
  return (
    <AppShell
      actor={actor}
      sections={markActive(visibleSections(actor, employeeNavigation(counts)), activeHref)}
      header={{ ...header, notificationCount: counts.messages }}
      footerNote="Versie 1.0.0"
      statusBadge={<DemoStatusBadge />}
    >
      {children}
    </AppShell>
  );
}

export async function RosterCommitteeShell({ header, activeHref, children }: AreaShellProps) {
  const actor = await requireArea(PERMISSIONS.ROSTER_READ);
  return (
    <AppShell
      actor={actor}
      sections={markActive(visibleSections(actor, rosterCommitteeNavigation()), activeHref)}
      header={header}
      footerNote="Rooster Commissie"
      statusBadge={<DemoStatusBadge />}
    >
      {children}
    </AppShell>
  );
}

export async function DutyAssignmentShell({ header, activeHref, children }: AreaShellProps) {
  const actor = await requireArea(PERMISSIONS.ASSIGNMENT_READ);
  const counts = await assignmentNavCounts();
  return (
    <AppShell
      actor={actor}
      sections={markActive(visibleSections(actor, dutyAssignmentNavigation(counts)), activeHref)}
      header={{ ...header, notificationCount: counts.openDuties }}
      footerNote="Dienstindeling"
      statusBadge={<DemoStatusBadge />}
    >
      {children}
    </AppShell>
  );
}

/**
 * Beheer behoudt de volledige, ongecomprimeerde melding.
 *
 * Dit is precies de doelgroep die de status moet kunnen beoordelen — de
 * banner blijft hier daarom staan zoals hij was, boven elk Beheer-scherm, niet
 * alleen op Regelbronnen en Systeemstatus.
 */
export async function AdminShell({ header, activeHref, children }: AreaShellProps) {
  const actor = await requireArea(PERMISSIONS.SYSTEM_READ);
  return (
    <AppShell
      actor={actor}
      sections={markActive(visibleSections(actor, adminNavigation()), activeHref)}
      header={header}
      footerNote="NS Roosterplatform v1.0.0"
    >
      <RulesetBanner />
      {children}
    </AppShell>
  );
}

/**
 * De regelcatalogus is voor iedereen en hoort dus in het menu van de omgeving
 * waar de bezoeker vandaan komt.
 */
export async function SharedShell({
  header,
  activeHref,
  children,
}: AreaShellProps) {
  const actor = await currentActor();
  if (!actor) {
    redirect("/aanmelden");
  }

  const area = actorHasPermission(actor, PERMISSIONS.SYSTEM_READ)
    ? "beheer"
    : actorHasPermission(actor, PERMISSIONS.ROSTER_READ)
      ? "roostercommissie"
      : actorHasPermission(actor, PERMISSIONS.ASSIGNMENT_READ)
        ? "dienstindeling"
        : "medewerker";

  const counts =
    area === "medewerker"
      ? await employeeNavCounts()
      : area === "dienstindeling"
        ? await assignmentNavCounts()
        : {};

  return (
    <AppShell
      actor={actor}
      sections={markActive(visibleSections(actor, navigationForArea(area, counts)), activeHref)}
      header={header}
      statusBadge={area === "beheer" ? undefined : <DemoStatusBadge />}
    >
      {area === "beheer" && <RulesetBanner />}
      {children}
    </AppShell>
  );
}
