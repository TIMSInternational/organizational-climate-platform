import type { ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { Chip, Note } from '../../../components/ui'
import { useTranslation } from '../../../i18n'
import { cn } from '../../../lib/cn'

/**
 * The analytics lane's page grammar on the Apple design (`occ.css` `.ch` + `.h`): a section's
 * serif title, its count in the sans at tabular figures — never a third typeface — and a
 * quiet aside at the trailing edge. The count sits inside the heading so the heading's name
 * carries it ("Hallazgos 4"), as the redesigned pages always have.
 */
export function SectionHeading({
  id,
  title,
  count,
  aside,
  className,
}: {
  id?: string
  title: ReactNode
  count?: number
  aside?: ReactNode
  className?: string
}) {
  return (
    <div data-slot="section-heading" className={cn('mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1', className)}>
      <h2 id={id} className="m-0 flex items-baseline gap-2 text-2xl">
        {title}
        {count !== undefined && (
          <span data-slot="section-count" className="font-sans text-sm font-normal tabular-nums tracking-normal text-fg-tertiary">
            {count}
          </span>
        )}
      </h2>
      {aside && <div className="text-sm text-fg-tertiary">{aside}</div>}
    </div>
  )
}

/** The card every section of these pages sits on: the canvas's bordered `.card`, no shadow. */
export const CARD = 'min-w-0 rounded-xl border border-line-panel bg-surface-card'

/**
 * HIG `generative-ai.md`: say where generated content comes from. Every finding on these pages
 * is machine-authored prose, so the pages carry this label wherever a finding's text is read.
 */
export function GeneratedChip() {
  const { t } = useTranslation()
  return <Chip tone="neutral" icon={<Sparkles />} label={t('insights.next.generatedLabel')} />
}

/** The one-line statement over a list of findings: what they are, and what to check. */
export function GeneratedNote({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <Note tone="info" icon={<Sparkles />} data-slot="generated-note" className={className}>
      {t('insights.next.generatedNote')}
    </Note>
  )
}
