import { Link } from 'react-router'
import { Check, Circle } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import type { SetupStep } from './companySetup'

/** "Primeros pasos": the new client's setup, in the order it has to happen. */
export default function CompanySetupChecklist({ steps }: { steps: readonly SetupStep[] }) {
  const { t } = useTranslation()
  const copy = (key: string) => t(`superadmin.next.companyDetail.setup.${key}`)
  const left = steps.filter((step) => !step.done).length
  return (
    <section
      aria-labelledby="company-setup-title"
      data-testid="company-setup"
      className="rounded-xl border border-line-panel bg-surface-card px-5 py-4.5"
    >
      <h2 id="company-setup-title" className="m-0 font-display text-2xl font-semibold tracking-title text-fg-primary">
        {copy('title')}
      </h2>
      <p className="m-0 mt-1 text-sm text-fg-secondary">{left === 0 ? copy('allDone') : copy('intro')}</p>
      <ol className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
        {steps.map((step) => (
          <li key={step.id} data-step={step.id} data-done={step.done} className="flex items-start gap-2.5 text-sm">
            {step.done ? (
              <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-primary" />
            ) : (
              <Circle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-secondary" />
            )}
            <span className="flex flex-col">
              <span className="font-medium text-fg-primary">
                {step.href && !step.done ? <Link to={step.href}>{copy(`${step.id}.title`)}</Link> : copy(`${step.id}.title`)}
                <span className="sr-only">{step.done ? ` — ${copy('done')}` : ` — ${copy('pending')}`}</span>
              </span>
              <span className="text-fg-secondary">{copy(`${step.id}.body`)}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
