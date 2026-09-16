import type { ReactNode } from "react";

/**
 * Tabellen.
 *
 * Roosterwerk is tabelwerk. Deze componenten bestaan zodat elke tabel dezelfde
 * regelhoogte, dezelfde koptekst en dezelfde uitlijning van getallen heeft —
 * wat bij het vergelijken van twee roosters het verschil is tussen zien en
 * zoeken.
 *
 * Brede tabellen schuiven binnen hun eigen kader. De pagina zelf schuift nooit
 * horizontaal, ook niet op een smal scherm.
 */

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="scroll-slim -mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-full border-collapse text-[12.5px]">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-line text-left text-[11.5px] uppercase tracking-[0.02em] text-ink-faint">
      {children}
    </thead>
  );
}

export function TR({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <tr className={`border-b border-line/60 last:border-0 ${muted ? "bg-canvas" : ""}`}>
      {children}
    </tr>
  );
}

export function TH({ children, numeric }: { children: ReactNode; numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={`px-2 py-2 font-semibold ${numeric ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}

export function TD({
  children,
  numeric,
  mono,
}: {
  children: ReactNode;
  numeric?: boolean;
  mono?: boolean;
}) {
  return (
    <td
      className={`px-2 py-2 align-middle ${numeric ? "tabular text-right" : ""} ${
        mono ? "font-mono" : ""
      }`}
    >
      {children}
    </td>
  );
}
