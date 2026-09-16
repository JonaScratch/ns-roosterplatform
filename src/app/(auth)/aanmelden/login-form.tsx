"use client";

import { useActionState } from "react";
import { type LoginState, loginAction } from "../acties";
import { Alert, Button, Field, inputClass } from "@/components/ui/primitives";

/**
 * Het aanmeldformulier.
 *
 * De enige client-component in de aanmeldstroom. Alles wat met de uitkomst van
 * de poging te maken heeft, gebeurt in de server action: dit formulier weet
 * niet of een personeelsnummer bestaat en kan dat dus ook niet verklappen.
 */
export function LoginForm({ passwordLoginEnabled }: { passwordLoginEnabled: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});

  if (!passwordLoginEnabled) {
    return (
      <Alert tone="info" title="Aanmelden via NS SSO">
        Deze omgeving is ingesteld op enkelvoudige aanmelding. De koppeling met de
        identiteitsprovider is nog niet geconfigureerd; neem contact op met beheer.
      </Alert>
    );
  }

  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert tone="error">{state.error}</Alert>}

      <Field label="Personeelsnummer" htmlFor="employeeNumber">
        <input
          id="employeeNumber"
          name="employeeNumber"
          autoComplete="username"
          required
          autoFocus
          className={inputClass}
        />
      </Field>

      <Field label="Wachtwoord" htmlFor="password">
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </Field>

      <Button disabled={pending}>{pending ? "Bezig…" : "Aanmelden"}</Button>
    </form>
  );
}
