import { CircleCheck, OctagonAlert, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card, CardContent } from '../../../components/ui'
import { useTranslation } from '../../../i18n'
import type { SemaforoCounts } from '../api/trackingApi'
import { SEMAFORO_ORDER, semaforoPresentation, type SemaforoEstado } from '../semaforo'

/**
 * How many plans sit in each semáforo state, worst first.
 *
 * The KPI row of the page-header rule (`components/layout/PageTopBar.tsx`), in
 * the one vocabulary this module has: three states, each with its own shape, its
 * own Spanish word and a count.
 *
 * Worst-first (`SEMAFORO_ORDER`) rather than alphabetical or good-first, because
 * the whole point of the semáforo for a node leader is "what do I have to deal
 * with today" — the number that should catch the eye is the red one.
 *
 * ## Counting is not aggregation of answers
 *
 * These are counts of ACTION PLANS, which are named operational records with a
 * responsable and a compromiso date. They are not survey responses and there is no
 * anonymity floor to apply to them: a node with one plan is a node with one plan,
 * and saying so reveals nothing about who answered what. The ≥5 floor governs the
 * survey aggregates a plan may have been created FROM, which live behind
 * `hallazgoExternalId` on the other service and are not drawn here.
 */
export interface SemaforoSummaryProps {
  counts: SemaforoCounts
  className?: string
}

const ICONS: Record<SemaforoEstado, ReactNode> = {
  Rojo: <OctagonAlert className="size-5" />,
  Amarillo: <TriangleAlert className="size-5" />,
  Verde: <CircleCheck className="size-5" />,
}

const TONE_TEXT: Record<SemaforoEstado, string> = {
  Rojo: 'text-chip-critical-ink',
  Amarillo: 'text-chip-warning-ink',
  Verde: 'text-chip-good-ink',
}

function countFor(counts: SemaforoCounts, estado: SemaforoEstado): number {
  if (estado === 'Rojo') return counts.rojo
  if (estado === 'Amarillo') return counts.amarillo
  return counts.verde
}

export default function SemaforoSummary({ counts, className }: SemaforoSummaryProps) {
  const { t } = useTranslation()

  return (
    <div className={className}>
      {/* Named, because "Atrasado" appears in three places on this page — this
          summary, the estado filter and every red row's chip — and a reader landing
          on a bare list of three numbers has nothing to tell them which is which. */}
      <ul
        aria-label={t('tracking.semaforo.summaryLabel')}
        className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-3"
      >
        {SEMAFORO_ORDER.map((estado) => {
          const presentation = semaforoPresentation(estado)
          return (
            <li key={estado}>
              <Card>
                <CardContent className="flex items-center gap-3">
                  <span aria-hidden="true" className={TONE_TEXT[estado]}>
                    {ICONS[estado]}
                  </span>
                  <span className="flex flex-col">
                    <span className="font-mono text-2xl font-semibold text-fg-primary tabular-nums">
                      {countFor(counts, estado)}
                    </span>
                    <span className="text-xs text-fg-tertiary">{t(presentation.labelKey)}</span>
                  </span>
                </CardContent>
              </Card>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
