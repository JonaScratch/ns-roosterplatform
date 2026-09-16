"use client";

import type { ReactNode } from "react";
import { useActionState } from "react";
import type { ActionState } from "@/lib/action-state";
import { Alert, Button } from "./primitives";

/**
 * Een formulier rond een server action, met terugkoppeling.
 *
 * ## Waarom terugkoppeling hier hoort en niet in de knop
 *
 * De uitkomst van een handeling is bijna nooit alleen "gelukt" of "mislukt".
 * Een geweigerde ruil komt met de regels die haar tegenhielden, en juist die
 * lijst is wat een medewerker verder helpt. Door hem hier te tonen, verschijnt
 * hij overal op dezelfde plek en in dezelfde vorm — en kan geen scherm hem
 * vergeten weer te geven.
 */
export function ActionForm({
  action,
  submitLabel,
  pendingLabel = "Bezig…",
  variant = "primary",
  compact = false,
  children,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "outline-rc" | "outline-did" | "danger";
  /** Zonder marges, voor gebruik in een tabelcel. */
  compact?: boolean;
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});

  return (
    <form action={formAction} className={compact ? "" : "space-y-3"}>
      {children}

      {/* Een geslaagde handeling kan kanttekeningen hebben: een scenario dat is
          doorgerekend maar nog niet formeel vastgelegd, bijvoorbeeld. Die horen
          bij de melding te staan en niet te verdwijnen omdat de uitkomst
          "geslaagd" heet. */}
      {state.notice && !compact && (
        <Alert tone="ok" title={state.reasons && state.reasons.length > 0 ? state.notice : undefined}>
          {state.reasons && state.reasons.length > 0 ? (
            <ul className="list-disc space-y-0.5 pl-4">
              {state.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : (
            state.notice
          )}
        </Alert>
      )}
      {state.error && !compact && (
        <Alert tone="error" title={state.error}>
          {state.reasons && state.reasons.length > 0 ? (
            <ul className="list-disc space-y-0.5 pl-4">
              {state.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      )}

      <Button variant={variant} disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </Button>

      {compact && (state.notice || state.error) && (
        <p
          className={`mt-1 text-[11px] ${
            state.error ? "text-state-error" : "text-state-ok"
          }`}
        >
          {state.error ?? state.notice}
          {state.reasons && state.reasons.length > 0 && (
            <span className="block">{state.reasons.join(" ")}</span>
          )}
        </p>
      )}
    </form>
  );
}
