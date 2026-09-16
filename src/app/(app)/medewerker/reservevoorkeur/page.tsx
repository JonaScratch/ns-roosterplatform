import { RESERVE_PREFERENCE_CHOICES } from "@/server/validation/preferences";
import { ownPreferences } from "@/server/services/preferences-service";
import { EmployeeShell } from "@/components/layout/area-shell";
import { ActionForm } from "@/components/ui/action-form";
import { Alert, EmptyState, WidgetCard } from "@/components/ui/primitives";
import { StarIcon } from "@/components/ui/icons";
import { voorkeurenAction } from "../acties";

export const dynamic = "force-dynamic";

/**
 * Reservevoorkeur.
 *
 * ## Waarom deze pagina alleen voor reserve is
 *
 * Wie op een vaste roosterregel staat, rijdt de diensten van die regel. Welke
 * dagdelen dat zijn, ligt vast in het rooster en verandert niet door een
 * voorkeur. Deze pagina aan zo iemand tonen belooft invloed die er niet is — en
 * dat is erger dan hem niet tonen: het kost vertrouwen op het moment dat
 * duidelijk wordt dat er niets mee gebeurt.
 *
 * ## Wat hier weg is
 *
 * Er stond een verzamelpagina "Voorkeuren & feedback" met vinkjes over vrije
 * dagen, aaneengesloten blokken en hele weekenden. Die zijn verdwenen om
 * dezelfde reden: in een vast rooster bepaalt de roosterregel dat, niet de
 * medewerker.
 *
 * ## Direct opgeslagen
 *
 * De keuze wordt weggeschreven zodra zij bevestigd is, en de bevestiging
 * verschijnt pas nadat de database het heeft vastgelegd. Er blijft dus geen
 * gekozen-maar-niet-opgeslagen toestand achter die bij een onverwachte
 * afsluiting verdwijnt.
 */
export default async function Reservevoorkeur() {
  const huidig = await ownPreferences();

  return (
    <EmployeeShell
      activeHref="/medewerker/reservevoorkeur"
      header={{
        title: "Reservevoorkeur",
        subtitle: "Welke dagdelen uw voorkeur hebben wanneer u reservedienst heeft",
      }}
    >
      {!huidig.inReserveRoster ? (
        <EmptyState>
          U staat op een vast basisrooster. De diensten die u rijdt, volgen uit uw roosterregel;
          een dagdeelvoorkeur verandert daar niets aan. Deze pagina is er voor medewerkers in het
          reserverooster.
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <WidgetCard
              icon={<StarIcon size={18} />}
              tone="info"
              title="Uw voorkeur"
              subtitle="Wordt meegewogen bij het invullen van uw reservedagen"
              bodyClassName="border-t border-line p-4"
            >
              <ActionForm action={voorkeurenAction} submitLabel="Voorkeur opslaan">
                <fieldset className="space-y-2">
                  <legend className="text-xs font-semibold text-ink">
                    Welke dagdelen rijdt u het liefst?
                  </legend>
                  {RESERVE_PREFERENCE_CHOICES.map((keuze) => (
                    <label
                      key={keuze.value}
                      className="flex items-center gap-2 text-[12.5px] text-ink"
                    >
                      <input
                        type="radio"
                        name="reservevoorkeur"
                        value={keuze.value}
                        defaultChecked={huidig.reservePreference === keuze.value}
                      />
                      <span>{keuze.label}</span>
                    </label>
                  ))}
                </fieldset>

                <label className="flex items-start gap-2 border-t border-line pt-3 text-[12.5px] text-ink">
                  <input
                    type="checkbox"
                    name="openVoorExtraDiensten"
                    defaultChecked={huidig.preferences.openVoorExtraDiensten}
                    className="mt-0.5"
                  />
                  <span>
                    Ik wil openstaande diensten aangeboden krijgen buiten mijn eigen rooster.
                  </span>
                </label>
              </ActionForm>
            </WidgetCard>
          </div>

          <Alert tone="info">
            Dit is een voorkeur en geen recht. De dienstindeling weegt haar mee bij het invullen
            van uw reservedagen, maar de roosterregels en uw beschikbaarheid gaan voor. Uw keuze is
            niet zichtbaar voor collega&apos;s.
          </Alert>
        </div>
      )}
    </EmployeeShell>
  );
}
