import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRightIcon } from "./icons";

/**
 * De bouwstenen van de interface.
 *
 * Bewust weinig en bewust saai. Een intern platform wint niets bij een brede
 * componentbibliotheek; wat het nodig heeft is dat een kaart er overal
 * hetzelfde uitziet, dat een waarschuwing overal dezelfde kleur heeft en dat
 * getallen overal op cijferbreedte uitlijnen.
 *
 * De vier dashboards zijn opgebouwd uit precies drie vormen: een `StatCard`
 * voor de kerncijfers bovenaan, een `WidgetCard` met `WidgetRow`s voor de grote
 * blokken, en een tabel. Dat is geen beperking maar de reden dat de vier
 * omgevingen als één applicatie lezen.
 */

export type Tone = "neutral" | "info" | "ok" | "warn" | "error" | "rc" | "did";

const BADGE_TONES: Record<Tone, string> = {
  neutral: "border-line bg-canvas text-ink-muted",
  info: "border-state-info/25 bg-state-info-soft text-state-info",
  ok: "border-state-ok/25 bg-state-ok-soft text-state-ok",
  warn: "border-state-warn/25 bg-state-warn-soft text-state-warn",
  error: "border-state-error/25 bg-state-error-soft text-state-error",
  rc: "border-accent-rc/25 bg-accent-rc-soft text-accent-rc",
  did: "border-accent-did/25 bg-accent-did-soft text-accent-did",
};

const ICON_TONES: Record<Tone, string> = {
  neutral: "bg-canvas text-ink-muted",
  info: "bg-state-info-soft text-state-info",
  ok: "bg-state-ok-soft text-state-ok",
  warn: "bg-state-warn-soft text-state-warn",
  error: "bg-state-error-soft text-state-error",
  rc: "bg-accent-rc-soft text-accent-rc",
  did: "bg-accent-did-soft text-accent-did",
};

const SOLID_TONES: Record<Tone, string> = {
  neutral: "bg-ink-muted text-white",
  info: "bg-state-info text-white",
  ok: "bg-state-ok text-white",
  warn: "bg-state-warn text-white",
  error: "bg-state-error text-white",
  rc: "bg-accent-rc text-white",
  did: "bg-accent-did text-white",
};

const VALUE_TONES: Record<Tone, string> = {
  neutral: "text-ink-strong",
  info: "text-state-info",
  ok: "text-state-ok",
  warn: "text-state-warn",
  error: "text-state-error",
  rc: "text-accent-rc",
  did: "text-accent-did",
};

// ── Kerncijfer bovenaan een dashboard ────────────────────────────────────────

/**
 * Eén kerncijfer, met icoon, waarde en een verwijzing naar het onderliggende
 * scherm.
 *
 * De verwijzing staat onderaan en niet als knop: dit is een overzicht, en een
 * rij knoppen bovenaan een dashboard nodigt uit tot klikken zonder gelezen te
 * hebben.
 */
export function StatCard({
  icon,
  tone = "info",
  label,
  value,
  hint,
  hintTone = "neutral",
  href,
  linkLabel,
}: {
  icon?: ReactNode;
  tone?: Tone;
  label: string;
  value: string | number;
  hint?: string;
  hintTone?: Tone;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <section className="flex flex-col rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        {icon && (
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${ICON_TONES[tone]}`}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-ink-muted">{label}</p>
          <p className={`tabular mt-0.5 text-[26px] font-bold leading-tight ${VALUE_TONES[tone]}`}>
            {value}
          </p>
          {hint && (
            <p
              className={`mt-0.5 text-[12px] ${
                hintTone === "neutral" ? "text-ink-muted" : VALUE_TONES[hintTone]
              }`}
            >
              {hint}
            </p>
          )}
        </div>
      </div>

      {href && (
        <Link
          href={href}
          className="mt-3 inline-flex items-center gap-1.5 border-t border-line pt-3 text-[12.5px] font-semibold text-accent-rc hover:underline"
        >
          {linkLabel ?? "Openen"}
          <ArrowRightIcon size={14} />
        </Link>
      )}
    </section>
  );
}

// ── Grote widgetkaart ────────────────────────────────────────────────────────

/**
 * Een blok met een gekleurd rond icoon, een titel, een lijst en onderaan één
 * actie.
 *
 * De vorm komt uit de ontwerpen en heeft een reden die verder gaat dan
 * uiterlijk: een dashboardblok dat één duidelijke vervolgactie heeft, laat de
 * lezer niet raden waar hij verder moet.
 */
export function WidgetCard({
  id,
  icon,
  tone = "rc",
  title,
  subtitle,
  actions,
  footer,
  children,
  bodyClassName,
}: {
  /** Ankerpunt, zodat een knop elders op de pagina hierheen kan verwijzen. */
  id?: string;
  icon?: ReactNode;
  tone?: Tone;
  title: string;
  subtitle?: string;
  /** Rechts in de kop, bijvoorbeeld een "Bekijk alle"-link. */
  actions?: ReactNode;
  /** Onderaan, meestal één knop over de volle breedte. */
  footer?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section id={id} className="flex flex-col rounded-xl border border-line bg-surface">
      <header className="flex items-start justify-between gap-3 px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          {icon && (
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${SOLID_TONES[tone]}`}
            >
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold text-ink-strong">{title}</h2>
            {subtitle && <p className="truncate text-[12px] text-ink-muted">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>

      <div className={bodyClassName ?? "flex-1 border-t border-line px-4 py-1"}>{children}</div>

      {footer && <div className="border-t border-line p-3">{footer}</div>}
    </section>
  );
}

/** Eén regel in een widgetkaart: icoon, omschrijving, waarde. */
export function WidgetRow({
  icon,
  label,
  value,
  valueTone = "neutral",
}: {
  icon?: ReactNode;
  label: ReactNode;
  value: ReactNode;
  valueTone?: Tone;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/70 py-2.5 last:border-0">
      <span className="flex min-w-0 items-center gap-2.5 text-[13px] text-ink">
        {icon && <span className="shrink-0 text-ink-faint">{icon}</span>}
        <span className="truncate">{label}</span>
      </span>
      <span className={`tabular shrink-0 text-[13px] font-semibold ${VALUE_TONES[valueTone]}`}>
        {value}
      </span>
    </div>
  );
}

// ── Kleine elementen ─────────────────────────────────────────────────────────

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Een gekleurde stip met tekst, voor status in een lijst. */
export function StatusDot({ tone = "ok", children }: { tone?: Tone; children: ReactNode }) {
  const dot = {
    neutral: "bg-ink-faint",
    info: "bg-state-info",
    ok: "bg-state-ok",
    warn: "bg-state-warn",
    error: "bg-state-error",
    rc: "bg-accent-rc",
    did: "bg-accent-did",
  }[tone];
  return (
    <span className="flex items-center gap-2 text-[13px]">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
      {children}
    </span>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 text-[12.5px] ${BADGE_TONES[tone]}`} role="status">
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? "mt-1" : undefined}>{children}</div>}
    </div>
  );
}

export function Button({
  variant = "primary",
  type = "submit",
  size = "normal",
  block = false,
  disabled,
  name,
  value,
  onClick,
  children,
}: {
  variant?: "primary" | "secondary" | "outline-rc" | "outline-did" | "danger";
  type?: "submit" | "button";
  size?: "normal" | "small";
  block?: boolean;
  disabled?: boolean;
  name?: string;
  value?: string;
  /** Alleen vanuit een clientcomponent; een servercomponent kan geen functie doorgeven. */
  onClick?: () => void;
  children: ReactNode;
}) {
  const styles = {
    primary: "bg-accent-rc text-white hover:bg-ns-blue",
    secondary: "border border-line-strong bg-surface text-ink hover:bg-canvas",
    "outline-rc": "border border-accent-rc/40 bg-surface text-accent-rc hover:bg-accent-rc-soft",
    "outline-did": "border border-accent-did/40 bg-surface text-accent-did hover:bg-accent-did-soft",
    danger: "border border-state-error/30 bg-state-error-soft text-state-error hover:bg-state-error/10",
  }[variant];

  return (
    <button
      type={type}
      name={name}
      value={value}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        size === "small" ? "px-2.5 py-1 text-[11.5px]" : "px-3.5 py-2 text-[12.5px]"
      } ${block ? "w-full" : ""} ${styles}`}
    >
      {children}
    </button>
  );
}

/** Een link die eruitziet als een knop over de volle breedte van een widget. */
export function LinkButton({
  href,
  variant = "primary",
  block = false,
  children,
}: {
  href: string;
  variant?: "primary" | "secondary" | "outline-rc" | "outline-did";
  block?: boolean;
  children: ReactNode;
}) {
  const styles = {
    primary: "bg-accent-rc text-white hover:bg-ns-blue",
    secondary: "border border-line-strong bg-surface text-ink hover:bg-canvas",
    "outline-rc": "border border-accent-rc/40 bg-surface text-accent-rc hover:bg-accent-rc-soft",
    "outline-did": "border border-accent-did/40 bg-surface text-accent-did hover:bg-accent-did-soft",
  }[variant];

  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-[12.5px] font-semibold transition-colors ${
        block ? "w-full" : ""
      } ${styles}`}
    >
      {children}
      <ArrowRightIcon size={14} />
    </Link>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-[12px] font-semibold text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11.5px] text-ink-muted">{hint}</p>}
    </div>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] text-ink " +
  "placeholder:text-ink-faint focus:border-accent-rc";

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-line px-3 py-8 text-center text-[12.5px] text-ink-muted">
      {children}
    </p>
  );
}

/** Een horizontale voortgangsbalk, voor scores en aandelen. */
export function Meter({
  value,
  tone = "rc",
  label,
}: {
  /** Van 0 tot 1. */
  value: number;
  tone?: Tone;
  label?: string;
}) {
  const percentage = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const fill = {
    neutral: "bg-ink-faint",
    info: "bg-state-info",
    ok: "bg-state-ok",
    warn: "bg-state-warn",
    error: "bg-state-error",
    rc: "bg-accent-rc",
    did: "bg-accent-did",
  }[tone];

  return (
    <span className="flex items-center gap-2">
      <span
        className="h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-canvas"
        role="img"
        aria-label={label ?? `${percentage} procent`}
      >
        <span className={`block h-full rounded-full ${fill}`} style={{ width: `${percentage}%` }} />
      </span>
    </span>
  );
}
