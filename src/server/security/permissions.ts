import { Role } from "@/lib/generated/prisma/enums";

/**
 * Rollen en rechten.
 *
 * ## De vier rollen
 *
 * | Rol                 | Waarvoor |
 * | ------------------- | -------- |
 * | `EMPLOYEE`          | de standaardrol; iedere nieuwe gebruiker krijgt alleen deze |
 * | `ROSTER_COMMITTEE`  | het samenstellen en publiceren van basisroosters |
 * | `DUTY_ASSIGNMENT`   | de dagelijkse operationele invulling |
 * | `ADMIN`             | masterrol: alles, plus gebruikers- en rollenbeheer |
 *
 * Een account kan meerdere rollen hebben. De rechten zijn de vereniging
 * daarvan.
 *
 * ## Rechten, niet rollen, in de code
 *
 * Nergens in de applicatie staat `if (role === "ADMIN")`. Er staat welk recht
 * nodig is. De koppeling van rechten aan rollen gebeurt uitsluitend in de tabel
 * hieronder. Dat scheelt niet alleen herschrijfwerk als er een rol bijkomt: het
 * maakt ook in één oogopslag zichtbaar wie wat mag, wat bij een audit de vraag
 * is die gesteld wordt.
 *
 * ## Rechten zeggen ook op wélke gegevens ze slaan
 *
 * `schedule:read:own` en `schedule:read:any` zijn twee verschillende rechten,
 * geen twee toepassingen van één recht. Een medewerker die `schedule:read:own`
 * heeft, kan met geen enkele parameter het rooster van een ander opvragen,
 * omdat de laag die dat zou moeten toestaan het recht niet heeft dat daarvoor
 * nodig is. Zo is URL-manipulatie geen aanval maar een verzoek dat botst met
 * een ontbrekend recht.
 */

export const PERMISSIONS = {
  // ── Eigen gegevens (Medewerker) ────────────────────────────────────────────
  SCHEDULE_READ_OWN: "schedule:read:own",
  PREFERENCES_MANAGE_OWN: "preferences:manage:own",
  FEEDBACK_SUBMIT_OWN: "feedback:submit:own",
  WAITLIST_MANAGE_OWN: "waitlist:manage:own",
  AVAILABLE_DUTY_READ: "available-duty:read",
  AVAILABLE_DUTY_CLAIM: "available-duty:claim",
  SWAP_PROPOSE: "swap:propose",
  SWAP_RESPOND: "swap:respond",

  /**
   * Een collega opzoeken om een ruil aan te bieden. Uitsluitend binnen de eigen
   * standplaats en beperkt tot personeelsnummer en weergavenaam. Geen lijst van
   * het hele bedrijf, geen e-mailadressen.
   */
  COLLEAGUE_LOOKUP: "colleague:lookup",

  // ── Rooster Commissie ──────────────────────────────────────────────────────
  /** Basisroosters, roosterprofielen en versies inzien. */
  ROSTER_READ: "roster:read",
  /** Basisroosters en roosterstructuur beheren. */
  ROSTER_MANAGE: "roster:manage",
  ROSTER_GENERATE: "roster:generate",
  ROSTER_COMPARE: "roster:compare",
  ROSTER_EXPORT: "roster:export",
  ROSTER_PUBLISH: "roster:publish",
  DUTY_PACKAGE_READ: "duty-package:read",
  DUTY_PACKAGE_IMPORT: "duty-package:import",
  /** Geaggregeerde feedback. Nooit herleidbaar naar een persoon. */
  FEEDBACK_READ_AGGREGATE: "feedback:read:aggregate",

  // ── Dienstindeling ─────────────────────────────────────────────────────────
  /** De dagelijkse bezetting en het rooster van willekeurige medewerkers inzien. */
  SCHEDULE_READ_ANY: "schedule:read:any",
  /** De dagplanning inzien. */
  ASSIGNMENT_READ: "assignment:read",
  /** Diensten toewijzen, reserve inzetten, open diensten publiceren. */
  ASSIGNMENT_MANAGE: "assignment:manage",
  /** Ruilverzoeken van medewerkers bekijken en administratief afhandelen. */
  SWAP_OVERSEE: "swap:oversee",
  /** Dagplanning en bezettingsoverzichten exporteren. */
  ASSIGNMENT_EXPORT: "assignment:export",

  // ── Persoonsgegevens ───────────────────────────────────────────────────────
  /** Persoonsgegevens van willekeurige medewerkers inzien. */
  IDENTITY_READ_ANY: "identity:read:any",

  // ── Beheer en toezicht (Admin) ─────────────────────────────────────────────
  AUDIT_READ: "audit:read",
  SECURITY_EVENT_READ: "security-event:read",
  /** Accounts inzien en blokkeren. */
  ACCOUNT_MANAGE: "account:manage",
  /** Rollen toekennen en intrekken. */
  ROLE_MANAGE: "role:manage",
  /** Systeemstatus en integraties inzien. */
  SYSTEM_READ: "system:read",
  /** Standplaatsen in- en uitschakelen. Uitsluitend na een readiness check. */
  LOCATION_MANAGE: "location:manage",

  /** De regelcatalogus inzien. Mag iedereen: transparantie is het doel. */
  RULES_READ: "rules:read",

  // ── De roosteragent (v1.0.5) ──────────────────────────────────────────────
  //
  // Een recht hier betekent "mag dit krijgen". Of het voor een concreet
  // roosterproject ook áán staat, bepaalt de commissie met een toekenning
  // (AgentCapabilityGrant). Beide moeten waar zijn; de agent kan zichzelf geen
  // van beide geven. Publiceren staat er bewust niet tussen: dat blijft een
  // menselijke handeling met ROSTER_PUBLISH.
  /** Vragen stellen en uitleg krijgen. Wat de agent mag ópzoeken, bepaalt het recht van de vrager. */
  AGENT_CHAT: "agent:chat",
  /** De agent mag een generatie- of herbouwopdracht laten uitvoeren (niveau B). */
  AGENT_JOB_CREATE: "agent:job:create",
  /** De agent mag binnen een budget meerdere verbeteringsrondes doen (niveau C). */
  AGENT_AUTONOMOUS: "agent:autonomous",
  /** Feedback en ervaringen vastleggen in het projectgeheugen. */
  AGENT_MEMORY_WRITE: "agent:memory:write",
  /** Een nieuwe voorkeur ter goedkeuring voorstellen. */
  AGENT_PREFERENCE_PROPOSE: "agent:preference:propose",
  /** Een voorgestelde voorkeur goedkeuren en activeren. */
  AGENT_PREFERENCE_APPROVE: "agent:preference:approve",
  /** Kennis van andere standplaatsen raadplegen. */
  AGENT_CROSSLOCATION_READ: "agent:crosslocation:read",
  /** Een technische hypothese voorstellen. */
  AGENT_EXPERIMENT_PROPOSE: "agent:experiment:propose",
  /** Een afgeschermd technisch experiment draaien. */
  AGENT_EXPERIMENT_RUN: "agent:experiment:run",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** De standaardrol. Iedere nieuwe gebruiker krijgt precies deze. */
export const DEFAULT_ROLES: readonly Role[] = [Role.EMPLOYEE];

const EMPLOYEE_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.SCHEDULE_READ_OWN,
  PERMISSIONS.PREFERENCES_MANAGE_OWN,
  PERMISSIONS.FEEDBACK_SUBMIT_OWN,
  PERMISSIONS.WAITLIST_MANAGE_OWN,
  PERMISSIONS.AVAILABLE_DUTY_READ,
  PERMISSIONS.AVAILABLE_DUTY_CLAIM,
  PERMISSIONS.SWAP_PROPOSE,
  PERMISSIONS.SWAP_RESPOND,
  PERMISSIONS.COLLEAGUE_LOOKUP,
  PERMISSIONS.RULES_READ,
  // Een machinist mag de agent vragen stellen over zijn eigen rooster en over de
  // regels. Wat hij te zien krijgt, hangt af van zijn eigen rechten: de agent
  // gebruikt per vraag dezelfde rechtencontrole als de schermen.
  PERMISSIONS.AGENT_CHAT,
];

/**
 * De Rooster Commissie.
 *
 * Stelt basisroosters samen voor een hele dienstregeling. Wat hier
 * uitdrukkelijk ontbreekt: elk recht om diensten toe te wijzen of reserve in te
 * zetten. Dat is dagelijkse operatie en hoort bij Dienstindeling. De scheiding
 * staat in deze tabel en niet in de schermen, zodat zij niet per ongeluk
 * verwatert.
 */
const ROSTER_COMMITTEE_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.ROSTER_READ,
  PERMISSIONS.ROSTER_MANAGE,
  PERMISSIONS.ROSTER_GENERATE,
  PERMISSIONS.ROSTER_COMPARE,
  PERMISSIONS.ROSTER_EXPORT,
  PERMISSIONS.ROSTER_PUBLISH,
  PERMISSIONS.DUTY_PACKAGE_READ,
  PERMISSIONS.DUTY_PACKAGE_IMPORT,
  PERMISSIONS.FEEDBACK_READ_AGGREGATE,
  PERMISSIONS.RULES_READ,
  PERMISSIONS.AGENT_CHAT,
  PERMISSIONS.AGENT_JOB_CREATE,
  PERMISSIONS.AGENT_AUTONOMOUS,
  PERMISSIONS.AGENT_MEMORY_WRITE,
  PERMISSIONS.AGENT_PREFERENCE_PROPOSE,
  PERMISSIONS.AGENT_PREFERENCE_APPROVE,
  PERMISSIONS.AGENT_CROSSLOCATION_READ,
  PERMISSIONS.AGENT_EXPERIMENT_PROPOSE,
];

/**
 * Dienstindeling.
 *
 * Vult de dagelijkse operatie in binnen de roosters die er al zijn. Wat hier
 * ontbreekt: elk recht om de structuur van een basisrooster te wijzigen, een
 * rooster te genereren of te publiceren. Dienstindeling kan het jaarrooster
 * niet aanpassen.
 */
const DUTY_ASSIGNMENT_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.ASSIGNMENT_READ,
  PERMISSIONS.ASSIGNMENT_MANAGE,
  PERMISSIONS.ASSIGNMENT_EXPORT,
  PERMISSIONS.SCHEDULE_READ_ANY,
  PERMISSIONS.SWAP_OVERSEE,
  PERMISSIONS.IDENTITY_READ_ANY,
  PERMISSIONS.RULES_READ,
];

/**
 * De masterrol.
 *
 * Krijgt alles: de medewerkerweergave waar nodig, beide plannersomgevingen, en
 * daarnaast gebruikers-, rollen- en toezichtrechten. Dat wordt hier berekend
 * uit de andere rollen plus de beheerrechten, zodat een nieuw recht dat aan een
 * rol wordt toegevoegd niet per ongeluk buiten het bereik van de beheerder
 * valt.
 */
const ADMIN_ONLY_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.AUDIT_READ,
  PERMISSIONS.SECURITY_EVENT_READ,
  PERMISSIONS.ACCOUNT_MANAGE,
  PERMISSIONS.ROLE_MANAGE,
  PERMISSIONS.SYSTEM_READ,
  PERMISSIONS.LOCATION_MANAGE,
  // Alleen een technisch beheerder mag een experiment daadwerkelijk laten draaien.
  PERMISSIONS.AGENT_EXPERIMENT_RUN,
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...new Set<Permission>([
    ...EMPLOYEE_PERMISSIONS,
    ...ROSTER_COMMITTEE_PERMISSIONS,
    ...DUTY_ASSIGNMENT_PERMISSIONS,
    ...ADMIN_ONLY_PERMISSIONS,
  ]),
];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  [Role.EMPLOYEE]: EMPLOYEE_PERMISSIONS,
  [Role.ROSTER_COMMITTEE]: ROSTER_COMMITTEE_PERMISSIONS,
  [Role.DUTY_ASSIGNMENT]: DUTY_ASSIGNMENT_PERMISSIONS,
  [Role.ADMIN]: ADMIN_PERMISSIONS,
};

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

/** De vereniging van de rechten van alle rollen die dit account heeft. */
export function permissionsForRoles(roles: readonly Role[]): ReadonlySet<Permission> {
  const permissions = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) {
      permissions.add(permission);
    }
  }
  return permissions;
}

export function rolesHavePermission(
  roles: readonly Role[],
  permission: Permission,
): boolean {
  return roles.some((role) => ROLE_PERMISSIONS[role]?.includes(permission));
}

export const ROLE_LABELS: Record<Role, string> = {
  [Role.EMPLOYEE]: "Medewerker",
  [Role.ROSTER_COMMITTEE]: "Rooster Commissie Planner",
  [Role.DUTY_ASSIGNMENT]: "Dienstindeling",
  [Role.ADMIN]: "Admin",
};

/** Korte weergave voor de header, waar weinig ruimte is. */
export const ROLE_SHORT_LABELS: Record<Role, string> = {
  [Role.EMPLOYEE]: "Medewerker",
  [Role.ROSTER_COMMITTEE]: "Planner",
  [Role.DUTY_ASSIGNMENT]: "Planner",
  [Role.ADMIN]: "Admin",
};

/** Alle rollen, in de volgorde waarin ze in beheerschermen horen te staan. */
export const ALL_ROLES: readonly Role[] = [
  Role.EMPLOYEE,
  Role.ROSTER_COMMITTEE,
  Role.DUTY_ASSIGNMENT,
  Role.ADMIN,
];

/**
 * De omgeving waar een rol thuishoort, in volgorde van voorrang.
 *
 * Een gebruiker met meerdere rollen komt uit bij de eerste die hij heeft. De
 * beheerder begint dus op zijn eigen dashboard en niet in het medewerkerdeel,
 * ook al heeft hij daar toegang toe.
 */
const ROLE_HOME_ORDER: readonly { role: Role; path: string }[] = [
  { role: Role.ADMIN, path: "/beheer" },
  { role: Role.ROSTER_COMMITTEE, path: "/roostercommissie" },
  { role: Role.DUTY_ASSIGNMENT, path: "/dienstindeling" },
  { role: Role.EMPLOYEE, path: "/medewerker" },
];

export function homePathForRoles(roles: readonly Role[]): string {
  return ROLE_HOME_ORDER.find((entry) => roles.includes(entry.role))?.path ?? "/medewerker";
}
