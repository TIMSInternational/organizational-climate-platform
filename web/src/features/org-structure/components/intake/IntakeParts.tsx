import type { ReactNode } from 'react'
import { useTranslation } from '../../../../i18n'
import type { ChipTone } from '../../../../components/ui'
import { CanvasChip } from '../../next/super/parts'
import type { IntakeConfidence } from '../../api/intake'

/**
 * Small pieces the intake steps share. Components only — `react(only-export-components)` fails a
 * module that exports a component beside a plain value, and the lint budget has no room.
 */

/**
 * High is good, medium is amber, low is red: the admin's eye should land on what the model was
 * least sure of. An item the admin has changed wears "Ajustado" instead — its confidence was the
 * model's, and it is no longer the model's decision.
 */
export function ConfidenceChip({ confidence, edited }: { confidence: IntakeConfidence; edited: boolean }) {
  const { t } = useTranslation()
  if (edited) {
    return <CanvasChip tone="accent" label={t('users.intake.mapping.edited')} />
  }
  const tone: ChipTone = confidence === 'high' ? 'good' : confidence === 'medium' ? 'warning' : 'critical'
  return <CanvasChip tone={tone} label={t(`users.intake.mapping.confidenceLevel.${confidence}`)} />
}

/**
 * A section of the mapping editor: a small heading with a quiet note, and a table under it.
 * `id` names the heading so the table can be labelled by it.
 */
export function MappingSection({
  id,
  heading,
  note,
  children,
}: {
  id: string
  heading: string
  note?: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h4 id={id} className="m-0 text-lg font-semibold text-fg-primary">
          {heading}
        </h4>
        {note !== undefined && <span className="text-xs text-fg-tertiary">{note}</span>}
      </div>
      {children}
    </section>
  )
}

/** The reason the model gave for a decision, or nothing: an empty cell rather than a dash. */
export function ReasonText({ reason }: { reason: string | null }) {
  if (!reason) return null
  return <span className="text-sm leading-snug text-fg-secondary">{reason}</span>
}
