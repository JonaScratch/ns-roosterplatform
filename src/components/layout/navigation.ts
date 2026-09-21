import { PERMISSIONS } from "@/server/security/permissions";
import type { NavSection } from "./app-shell";
import {
  ActivityIcon,
  BarChartIcon,
  BellIcon,
  BookIcon,
  BuildingIcon,
  CalendarCheckIcon,
  CalendarIcon,
  ChatIcon,
  ClipboardListIcon,
  CompareIcon,
  DownloadIcon,
  FileTextIcon,
  FolderIcon,
  GridIcon,
  HistoryIcon,
  HomeIcon,
  ListIcon,
  MailIcon,
  MegaphoneIcon,
  PieChartIcon,
  PlugIcon,
  SettingsIcon,
  SparkIcon,
  StarIcon,
  SwapIcon,
  UserSquareIcon,
  UsersIcon,
} from "@/components/ui/icons";

/**
 * De navigatie van de vier omgevingen.
 *
 * Elk item noemt het recht dat de bijbehorende pagina nodig heeft, zodat een
 * gebruiker met meerdere rollen precies de items ziet waar hij ook echt bij
 * kan. De filtering gebeurt in `visibleSections`; de beveiliging zit in de
 * services.
 *
 * De groepskoppen komen uit de ontwerpen en zijn niet vrijblijvend: zij maken
 * het verschil zichtbaar tussen "dit gaat over de jaarroosters" en "dit gaat
 * over vandaag". Dat onderscheid is precies wat Rooster Commissie en
 * Dienstindeling uit elkaar houdt.
 */

/** Aantallen die als pil achter een menu-item verschijnen. */
export interface NavCounts {
  readonly availableDuties?: number;
  readonly openDuties?: number;
  readonly swapRequests?: number;
  readonly messages?: number;
  /**
   * Staat deze medewerker op een reserverooster?
   *
   * Bepaalt of "Reservevoorkeur" in de navigatie verschijnt. Wie op een vaste
   * roosterregel staat, rijdt de diensten van die regel; een dagdeelvoorkeur
   * verandert daar niets aan. Het menu-item tonen belooft invloed die er niet is.
   */
  readonly inReserveRoster?: boolean;
  /** Openstaande CAO-dagaanvragen die nog in het verlofboek moeten. */
  readonly caoDayRequests?: number;
}

// ── Medewerker ───────────────────────────────────────────────────────────────

export function employeeNavigation(counts: NavCounts = {}): readonly NavSection[] {
  return [
    {
      items: [
        { href: "/medewerker", label: "Dashboard", icon: HomeIcon, permission: PERMISSIONS.SCHEDULE_READ_OWN },
      ],
    },
    {
      label: "Mijn rooster",
      items: [
        {
          href: "/medewerker/rooster",
          label: "Mijn rooster",
          icon: CalendarIcon,
          permission: PERMISSIONS.SCHEDULE_READ_OWN,
        },
        {
          href: "/medewerker/diensten",
          label: "Beschikbare diensten",
          icon: CalendarCheckIcon,
          permission: PERMISSIONS.AVAILABLE_DUTY_READ,
          badge: counts.availableDuties,
        },
        {
          href: "/medewerker/meldingen",
          label: "Meldingen",
          icon: BellIcon,
          badge: counts.messages,
          permission: PERMISSIONS.SCHEDULE_READ_OWN,
        },
        {
          href: "/medewerker/ruilen",
          label: "Ruilen",
          icon: SwapIcon,
          permission: PERMISSIONS.SWAP_PROPOSE,
          badge: counts.swapRequests,
        },
        {
          href: "/medewerker/wachtlijsten",
          label: "Wachtlijsten",
          icon: ListIcon,
          permission: PERMISSIONS.WAITLIST_MANAGE_OWN,
        },
      ],
    },
    {
      label: "Mijn gegevens",
      items: [
        {
          href: "/medewerker/cao-dagen",
          label: "CAO-dagen",
          icon: CalendarCheckIcon,
          permission: PERMISSIONS.SCHEDULE_READ_OWN,
        },
        // Alleen voor wie werkelijk in een reserverooster zit. Zie NavCounts.
        ...(counts.inReserveRoster
          ? [
              {
                href: "/medewerker/reservevoorkeur",
                label: "Reservevoorkeur",
                icon: StarIcon,
                permission: PERMISSIONS.PREFERENCES_MANAGE_OWN,
              },
            ]
          : []),
        {
          href: "/medewerker/feedback",
          label: "Kwartaalfeedback",
          icon: MailIcon,
          permission: PERMISSIONS.FEEDBACK_SUBMIT_OWN,
        },
      ],
    },
    {
      label: "Algemeen",
      items: [
        { href: "/regels", label: "Roosterregels", icon: BookIcon, permission: PERMISSIONS.RULES_READ },
        { href: "/medewerker/documenten", label: "Documenten", icon: FolderIcon },
      ],
    },
  ];
}

// ── Rooster Commissie ────────────────────────────────────────────────────────

export function rosterCommitteeNavigation(): readonly NavSection[] {
  return [
    {
      label: "Overzicht",
      items: [
        { href: "/roostercommissie", label: "Dashboard", icon: HomeIcon, permission: PERMISSIONS.ROSTER_READ },
      ],
    },
    {
      label: "Roosters",
      items: [
        {
          href: "/roostercommissie/roosters",
          label: "Roosters beheren",
          icon: CalendarIcon,
          permission: PERMISSIONS.ROSTER_READ,
        },
        {
          href: "/roostercommissie/profielen",
          label: "Roosterprofielen",
          icon: GridIcon,
          permission: PERMISSIONS.ROSTER_READ,
        },
        {
          href: "/roostercommissie/pakketten",
          label: "Dienstenpakketten",
          icon: FileTextIcon,
          permission: PERMISSIONS.DUTY_PACKAGE_READ,
        },
        {
          href: "/roostercommissie/dienstenbak",
          label: "Dienstenbak",
          icon: ListIcon,
          permission: PERMISSIONS.DUTY_PACKAGE_READ,
        },
        {
          href: "/roostercommissie/genereren",
          label: "Genereren & simulatie",
          icon: SparkIcon,
          permission: PERMISSIONS.ROSTER_GENERATE,
        },
        {
          href: "/roostercommissie/simulatie",
          label: "Scenario's vergelijken",
          icon: SparkIcon,
          permission: PERMISSIONS.ROSTER_GENERATE,
        },
      ],
    },
    {
      label: "Roosteragent",
      items: [
        {
          href: "/roostercommissie/agent",
          label: "Vragen aan de agent",
          icon: ChatIcon,
          permission: PERMISSIONS.AGENT_CHAT,
        },
      ],
    },
    {
      label: "Analyse",
      items: [
        {
          href: "/roostercommissie/analyse",
          label: "Roosteranalyse",
          icon: BarChartIcon,
          permission: PERMISSIONS.ROSTER_READ,
        },
        {
          href: "/roostercommissie/bezetting",
          label: "Bezetting per weekdag",
          icon: BarChartIcon,
          permission: PERMISSIONS.ROSTER_READ,
        },
        {
          href: "/roostercommissie/feedback",
          label: "Feedback overzicht",
          icon: PieChartIcon,
          permission: PERMISSIONS.FEEDBACK_READ_AGGREGATE,
        },
        {
          href: "/roostercommissie/vergelijken",
          label: "Vergelijken",
          icon: CompareIcon,
          permission: PERMISSIONS.ROSTER_COMPARE,
        },
      ],
    },
    {
      label: "Publicatie",
      items: [
        {
          href: "/roostercommissie/publiceren",
          label: "Publiceren",
          icon: MegaphoneIcon,
          permission: PERMISSIONS.ROSTER_PUBLISH,
        },
      ],
    },
    {
      label: "Beheer",
      items: [
        { href: "/regels", label: "Regels & kaders", icon: BookIcon, permission: PERMISSIONS.RULES_READ },
      ],
    },
  ];
}

// ── Dienstindeling ───────────────────────────────────────────────────────────

export function dutyAssignmentNavigation(counts: NavCounts = {}): readonly NavSection[] {
  return [
    {
      label: "Overzicht",
      items: [
        {
          href: "/dienstindeling",
          label: "Overzicht",
          icon: HomeIcon,
          permission: PERMISSIONS.ASSIGNMENT_READ,
        },
      ],
    },
    {
      label: "Dagelijkse operatie",
      items: [
        {
          href: "/dienstindeling/dagplanning",
          label: "Dagplanning",
          icon: CalendarIcon,
          permission: PERMISSIONS.ASSIGNMENT_READ,
        },
        {
          href: "/dienstindeling/openstaand",
          label: "Openstaande diensten",
          icon: ClipboardListIcon,
          permission: PERMISSIONS.ASSIGNMENT_MANAGE,
          badge: counts.openDuties,
        },
        {
          href: "/dienstindeling/roosters",
          label: "Medewerkerroosters",
          icon: UserSquareIcon,
          permission: PERMISSIONS.ASSIGNMENT_READ,
        },
        {
          href: "/dienstindeling/reserve",
          label: "Reserve overzicht",
          icon: UsersIcon,
          permission: PERMISSIONS.ASSIGNMENT_MANAGE,
        },
        {
          href: "/dienstindeling/beschikbaar",
          label: "Beschikbare diensten",
          icon: CalendarCheckIcon,
          permission: PERMISSIONS.ASSIGNMENT_MANAGE,
        },
      ],
    },
    {
      label: "Inzet & ruilen",
      items: [
        {
          href: "/dienstindeling/ruilverzoeken",
          label: "Ruilverzoeken",
          icon: SwapIcon,
          permission: PERMISSIONS.SWAP_OVERSEE,
          badge: counts.swapRequests,
        },
        {
          href: "/dienstindeling/cao-dagen",
          label: "CAO-dagen",
          icon: CalendarCheckIcon,
          permission: PERMISSIONS.ASSIGNMENT_READ,
          badge: counts.caoDayRequests,
        },
      ],
    },
    {
      label: "Rapportage & export",
      items: [
        {
          href: "/dienstindeling/exporteren",
          label: "Exporteren",
          icon: DownloadIcon,
          permission: PERMISSIONS.ASSIGNMENT_EXPORT,
        },
      ],
    },
    {
      label: "Beheer",
      items: [
        { href: "/regels", label: "Regels & kaders", icon: BookIcon, permission: PERMISSIONS.RULES_READ },
      ],
    },
  ];
}

// ── Admin ────────────────────────────────────────────────────────────────────

export function adminNavigation(): readonly NavSection[] {
  return [
    {
      label: "Hoofdmenu",
      items: [
        { href: "/beheer", label: "Dashboard", icon: HomeIcon, permission: PERMISSIONS.SYSTEM_READ },
        {
          href: "/beheer/gebruikers",
          label: "Gebruikers & rollen",
          icon: UsersIcon,
          permission: PERMISSIONS.ROLE_MANAGE,
        },
        {
          href: "/roostercommissie",
          label: "Roostercommissie",
          icon: CalendarIcon,
          permission: PERMISSIONS.ROSTER_READ,
          external: true,
        },
        {
          href: "/dienstindeling",
          label: "Dienstindeling",
          icon: UserSquareIcon,
          permission: PERMISSIONS.ASSIGNMENT_READ,
          external: true,
        },
        {
          href: "/beheer/auditlog",
          label: "Auditlog",
          icon: HistoryIcon,
          permission: PERMISSIONS.AUDIT_READ,
        },
        {
          href: "/beheer/systeemstatus",
          label: "Systeemstatus",
          icon: ActivityIcon,
          permission: PERMISSIONS.SYSTEM_READ,
        },
      ],
    },
    {
      label: "Beheer",
      items: [
        {
          href: "/beheer/organisatie",
          label: "Organisatie",
          icon: BuildingIcon,
          permission: PERMISSIONS.SYSTEM_READ,
        },
        {
          href: "/beheer/integraties",
          label: "Integraties",
          icon: PlugIcon,
          permission: PERMISSIONS.SYSTEM_READ,
        },
        // De technische bronstatus hoort hier en niet op het RC-scherm: daar
        // gaat het over wat een regel betekent, hier over of het regelbestand
        // klopt.
        {
          href: "/beheer/regelbronnen",
          label: "Regelbronnen",
          icon: FileTextIcon,
          permission: PERMISSIONS.SYSTEM_READ,
        },
        { href: "/regels", label: "Regels & kaders", icon: BookIcon, permission: PERMISSIONS.RULES_READ },
      ],
    },
  ];
}

/** De navigatie die bij het huidige gedeelte hoort. Voor gedeelde pagina's. */
export function navigationForArea(
  area: "medewerker" | "roostercommissie" | "dienstindeling" | "beheer",
  counts: NavCounts = {},
): readonly NavSection[] {
  switch (area) {
    case "roostercommissie":
      return rosterCommitteeNavigation();
    case "dienstindeling":
      return dutyAssignmentNavigation(counts);
    case "beheer":
      return adminNavigation();
    default:
      return employeeNavigation(counts);
  }
}

export { SettingsIcon };
