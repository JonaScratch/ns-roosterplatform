import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { authProvider } from "@/server/auth";
import { currentActor } from "@/server/auth/session";
import { config } from "@/server/config/env";
import { homePathForRoles } from "@/server/security/permissions";
import { LoginForm } from "./login-form";
import { NsLogo } from "@/components/ui/ns-logo";

export const metadata: Metadata = { title: "Aanmelden — Roosterplatform" };

/** Sessies worden per verzoek gelezen; deze pagina mag nooit gecachet worden. */
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const actor = await currentActor();
  if (actor) {
    redirect(homePathForRoles(actor.roles));
  }

  const provider = authProvider();
  const settings = config();

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <NsLogo height={22} />
          <h1 className="text-base font-semibold text-ink">Roosterplatform</h1>
        </div>

        <div className="rounded border border-line bg-surface p-5">
          <p className="mb-4 text-xs text-ink-muted">
            Interne toepassing voor roosterbeheer. Meld u aan met uw eigen account.
          </p>
          <LoginForm passwordLoginEnabled={provider.supportsPasswordLogin} />
        </div>

        <p className="mt-4 text-[11px] text-ink-muted">
          Authenticatiebron: {provider.name}
          {settings.AUTH_PROVIDER === "local" && (
            <>
              {" "}
              — uitsluitend bedoeld voor ontwikkeling en test.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
