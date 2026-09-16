import {
  allFeedbackCategories,
  feedbackCategoryLabel,
  feedbackEligibility,
} from "@/server/services/feedback-service";
import { EmployeeShell } from "@/components/layout/area-shell";
import { ActionForm } from "@/components/ui/action-form";
import { Alert, WidgetCard } from "@/components/ui/primitives";
import { feedbackAction } from "../acties";

export const dynamic = "force-dynamic";

/**
 * Kwartaalfeedback over het eigen rooster.
 *
 * Eén keer per kwartaal. Wie al heeft geantwoord, krijgt geen formulier — en de
 * database zou een tweede antwoord ook weigeren.
 */
export default async function Feedback() {
  const eligibility = await feedbackEligibility();

  return (
    <EmployeeShell
      activeHref="/medewerker/feedback"
      header={{
        title: `Feedback ${eligibility.quarterKey}`,
        subtitle: "Uw oordeel over uw eigen basisrooster. Eén keer per kwartaal.",
      }}
    >

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <WidgetCard title="Uw rooster dit kwartaal">
            {eligibility.alreadySubmitted ? (
              <Alert tone="ok" title="U heeft dit kwartaal al feedback gegeven">
                Uw antwoorden zijn verwerkt in de geaggregeerde cijfers. Het volgende moment om
                feedback te geven is het eerstvolgende kwartaal.
              </Alert>
            ) : (
              <ActionForm action={feedbackAction} submitLabel="Feedback versturen">
                <fieldset className="space-y-2">
                  <legend className="text-xs font-semibold text-ink">
                    Wat is van toepassing op uw eigen rooster?
                  </legend>
                  <div className="space-y-1">
                    {allFeedbackCategories().map((category) => (
                      <label key={category} className="flex items-start gap-2 text-xs">
                        <input
                          type="checkbox"
                          name="categories"
                          value={category}
                          className="mt-0.5"
                        />
                        <span>{feedbackCategoryLabel(category)}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="space-y-2 border-t border-line pt-3">
                  <legend className="text-xs font-semibold text-ink">
                    Hoe tevreden bent u met uw huidige rooster?
                  </legend>
                  <div className="flex items-center gap-4">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <label key={value} className="flex flex-col items-center gap-1 text-[11px]">
                        <input type="radio" name="satisfaction" value={value} defaultChecked={value === 3} />
                        {value}
                      </label>
                    ))}
                  </div>
                  <p className="text-[11px] text-ink-muted">
                    1 = zeer ontevreden, 5 = zeer tevreden.
                  </p>
                </fieldset>
              </ActionForm>
            )}
          </WidgetCard>
        </div>

        <div className="space-y-4">
          <Alert tone="info" title="Wat de roostermaker ziet">
            Uitsluitend samengevatte cijfers per roosterprofiel, bijvoorbeeld
            <span className="mt-1 block rounded bg-surface px-2 py-1 font-mono text-[11px]">
              Vroeg/Laat: 63% wil minder extreem vroege diensten
            </span>
            <span className="mt-1 block">
              Nooit wie wat heeft geantwoord. Er bestaat in dit platform geen recht dat
              individuele antwoorden zichtbaar maakt — voor niemand.
            </span>
          </Alert>

          <Alert tone="neutral" title="Kleine groepen worden niet getoond">
            Is een roosterprofiel te klein, dan wordt er helemaal niets getoond. Een percentage
            over een handvol mensen is in de praktijk hetzelfde als namen noemen.
          </Alert>
        </div>
      </div>
    </EmployeeShell>
  );
}
