import Link from "next/link";
import type { ReactNode } from "react";
import type { Actor } from "@/server/auth/session";
import { actorHasPermission } from "@/server/security/authorize";
import { ROLE_LABELS, type Permission } from "@/server/security/permissions";
import {
  BellIcon,
  ExternalLinkIcon,
  HelpCircleIcon,
  LockIcon,
  LogOutIcon,
  SettingsIcon,
  ShieldIcon,
} from "@/components/ui/icons";
import { NsLogo } from "@/components/ui/ns-logo";
import { ownIdentity } from "@/server/data/repositories/identity-repository";
import { logoutAction } from "@/app/(auth)/acties";

/**
 * Het raamwerk om elke ingelogde pagina: zijbalk, kop, inhoud, voettekst.
 *
 * Eén raamwerk voor alle vier de omgevingen. Wat verschilt is de navigatie en
 * de titel, niet de opbouw — een medewerker die er een plannerrol bij krijgt,
 * hoort geen tweede applicatie te leren kennen.
 *
 * ## De navigatie is presentatie, geen poortwachter
 *
 * Items worden gefilterd op recht zodat niemand een link ziet die op een
 * foutmelding uitloopt. De beveiliging zit in de service achter de pagina, die
 * onafhankelijk opnieuw controleert. Wie hier een item toevoegt zonder recht in
 * de service, heeft een link gemaakt en geen toegang.
 */

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: (props: { size?: number }) => ReactNode;
  /** Het recht dat de bijbehorende pagina nodig heeft. */
  readonly permission?: Permission;
  /** Aantal in een pil achter het label, bijvoorbeeld openstaande verzoeken. */
  readonly badge?: number;
  /** Toont het icoon voor "opent een andere omgeving". */
  readonly external?: boolean;
  /** Gezet door de layout via markActive: dit is de huidige pagina. */
  readonly active?: boolean;
}

export interface NavSection {
  /** Kopje boven de groep. Weglaten voor de eerste, naamloze groep. */
  readonly label?: string;
  readonly items: readonly NavItem[];
}

/** De secties die deze gebruiker mag zien, zonder lege groepen. */
export function visibleSections(
  actor: Actor,
  sections: readonly NavSection[],
): readonly NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !item.permission || actorHasPermission(actor, item.permission),
      ),
    }))
    .filter((section) => section.items.length > 0);
}

export interface HeaderProps {
  readonly title: string;
  readonly subtitle?: string;
  /** Bijvoorbeeld een periodekiezer. Staat links van de meldingen. */
  readonly context?: ReactNode;
  readonly notificationCount?: number;
}

export function AppShell({
  actor,
  sections,
  header,
  footerNote,
  statusBadge,
  children,
}: {
  actor: Actor;
  sections: readonly NavSection[];
  header: HeaderProps;
  /** Rechts in de voettekst, bijvoorbeeld een versienummer. */
  footerNote?: string;
  /** Subtiele statusaanduiding in de voettekst, bijvoorbeeld "Demonstratieomgeving". */
  statusBadge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-canvas">
      <Sidebar sections={sections} />

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <Header actor={actor} {...header} />
        <main className="min-w-0 flex-1 px-6 py-5">{children}</main>
        <Footer note={footerNote} statusBadge={statusBadge} />
      </div>
    </div>
  );
}

// ── Zijbalk ──────────────────────────────────────────────────────────────────

function Sidebar({ sections }: { sections: readonly NavSection[] }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col bg-rail text-rail-text lg:flex">
      <div className="flex items-center gap-3 border-b border-rail-line px-5 py-4">
        {/* Het aangeleverde beeldmerk is donkerblauw. Op de donkere zijbalk
            zou het wegvallen; een wit vlak eronder houdt het leesbaar zonder
            het te hertekenen of om te kleuren. Zodra NS een witte variant
            aanlevert (public/brand/ns-logo-wit.svg), gebruikt NsLogo die
            vanzelf en kan dit vlak weg. */}
        <span className="inline-flex items-center rounded bg-white px-1.5 py-1">
          <NsLogo on="dark" height={18} />
        </span>
        <span className="text-[14px] font-semibold tracking-tight text-white">
          NS Roosterplatform
        </span>
      </div>

      <nav aria-label="Hoofdnavigatie" className="scroll-slim flex-1 overflow-y-auto px-3 py-4">
        {sections.map((section, index) => (
          <div key={section.label ?? `sectie-${index}`} className={index > 0 ? "mt-5" : undefined}>
            {section.label && (
              <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-rail-muted">
                {section.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-rail-line px-3 py-3">
        <NavLink
          item={{ href: "/instellingen", label: "Instellingen", icon: SettingsIcon }}
        />
        <form action={logoutAction}>
          <button
            type="submit"
            className="mt-0.5 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-rail-text transition-colors hover:bg-white/10 hover:text-white"
          >
            <LogOutIcon size={17} />
            Uitloggen
          </button>
        </form>
      </div>

      <p className="border-t border-rail-line px-5 py-3 text-[11px] text-rail-muted">
        NS Roosterplatform v1.0.0
      </p>
    </aside>
  );
}

/**
 * Eén item in de zijbalk.
 *
 * De actieve staat wordt niet hier bepaald maar door de pagina die het item
 * markeert; een client-component met `usePathname` zou de hele zijbalk naar de
 * browser sturen voor een streepje.
 */
function NavLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={item.active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
        item.active
          ? "bg-rail-active text-white"
          : "text-rail-text hover:bg-white/10 hover:text-white"
      }`}
    >
      <Icon size={17} />
      <span className="flex-1 truncate">{item.label}</span>
      {typeof item.badge === "number" && item.badge > 0 && (
        <span className="tabular rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          {item.badge}
        </span>
      )}
      {item.external && <ExternalLinkIcon size={13} className="text-rail-muted" />}
    </Link>
  );
}

/**
 * Markeert het item dat bij de huidige pagina hoort.
 *
 * Gebeurt op de server, met een pad dat de layout meegeeft. Het alternatief —
 * een client-component met `usePathname` — zou de hele zijbalk naar de browser
 * sturen omwille van één gemarkeerd item.
 */
export function markActive(
  sections: readonly NavSection[],
  activeHref: string,
): readonly NavSection[] {
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) =>
      item.href === activeHref ? { ...item, active: true } : item,
    ),
  }));
}

// ── Kop ──────────────────────────────────────────────────────────────────────

async function Header({
  actor,
  title,
  subtitle,
  context,
  notificationCount = 0,
}: HeaderProps & { actor: Actor }) {
  // De eigen naam van de ingelogde gebruiker. Zijn eigen gegevens, dus geen
  // recht en geen auditregel; wie geen identiteitsrecord heeft, ziet zijn
  // personeelsnummer.
  const identity = await ownIdentity();

  return (
    <header className="sticky top-0 z-10 border-b border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
        <div className="min-w-0">
          <h1 className="truncate text-[26px] font-bold leading-tight tracking-tight text-ink-strong">
            {title}
          </h1>
          {subtitle && <p className="mt-0.5 truncate text-[13px] text-ink-muted">{subtitle}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {context}

          <button
            type="button"
            className="relative rounded-lg p-2 text-ink-muted transition-colors hover:bg-canvas hover:text-ink"
            aria-label={
              notificationCount > 0
                ? `Meldingen, ${notificationCount} ongelezen`
                : "Meldingen"
            }
          >
            <BellIcon size={19} />
            {notificationCount > 0 && (
              <span className="tabular absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-state-error px-1 text-[10px] font-semibold text-white">
                {notificationCount}
              </span>
            )}
          </button>

          <Link
            href="/regels"
            className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-canvas hover:text-ink"
            aria-label="Hulp en regelcatalogus"
          >
            <HelpCircleIcon size={19} />
          </Link>

          <span className="h-8 w-px bg-line" aria-hidden />

          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ns-blue text-[12px] font-semibold text-white">
              {initialsOf(actor, identity?.displayName)}
            </span>
            <span className="hidden sm:block">
              <span className="block text-[13px] font-semibold leading-tight text-ink-strong">
                {identity?.displayName ?? actor.employeeNumber}
              </span>
              <span className="block text-[12px] leading-tight text-ink-muted">
                {primaryRoleLabel(actor)}
              </span>
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

/**
 * De initialen in de avatar.
 *
 * Uit de eigen naam wanneer die er is, anders uit het personeelsnummer. Het
 * gaat altijd om de ingelogde gebruiker zelf; namen van anderen komen hier
 * nooit langs.
 */
function initialsOf(actor: Actor, displayName?: string): string {
  if (!displayName) {
    return actor.employeeNumber.slice(-2);
  }
  const parts = displayName.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase() || actor.employeeNumber.slice(-2);
}

function primaryRoleLabel(actor: Actor): string {
  const order: (keyof typeof ROLE_LABELS)[] = [
    "ADMIN",
    "ROSTER_COMMITTEE",
    "DUTY_ASSIGNMENT",
    "EMPLOYEE",
  ];
  const primary = order.find((role) => actor.roles.includes(role));
  return primary ? ROLE_LABELS[primary] : "Gebruiker";
}

// ── Voettekst ────────────────────────────────────────────────────────────────

function Footer({ note, statusBadge }: { note?: string; statusBadge?: ReactNode }) {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-3 text-[12px] text-ink-muted">
        <span>© NS Roosterplatform {new Date().getUTCFullYear()}</span>

        <div className="flex flex-wrap items-center gap-6">
          <span className="flex items-center gap-1.5">
            <LockIcon size={14} />
            Privacy &amp; AVG
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldIcon size={14} />
            Beveiliging
          </span>
          <Link href="/regels" className="flex items-center gap-1.5 hover:text-ink">
            <HelpCircleIcon size={14} />
            Hulp &amp; ondersteuning
          </Link>
        </div>

        <div className="flex items-center gap-4">
          {statusBadge}
          {note && <span className="text-ink-faint">{note}</span>}
          <span className="text-ns-blue">
            <NsLogo height={16} />
          </span>
        </div>
      </div>
    </footer>
  );
}

// ── Titelblok binnen de inhoud ───────────────────────────────────────────────

/** Een kop boven een deel van de pagina, onder de hoofdkop. */
export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-[15px] font-semibold text-ink-strong">{title}</h2>
        {description && <p className="mt-0.5 text-[12px] text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}
