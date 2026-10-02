import { useId } from 'react'
import { CircleAlert, CircleCheck, Lock } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import {
  BAND_PAINT,
  BandGlyph,
  BandScaleBar,
  RESULT_BAND_ORDER,
  SCALE_MAX,
  SCALE_MIN,
  boundaryText,
  type BandScaleSegment,
  type ResultBandKey,
  type ResultBands,
} from '../../../../components/charts'
import { Button, Input } from '../../../../components/ui'
import { cn } from '../../../../lib/cn'
import { Panel } from '../super/parts'
import { gapExample, judgeBands, type BandsDraft, type BandsProblem } from './bandsDraft'

type Edge = keyof Omit<BandsDraft, 'names'>

/** Each band's two edges in the draft; `null` is the fixed end of the scale. */
const EDGES: Record<ResultBandKey, { from: Edge | null; to: Edge | null }> = {
  strength: { from: 'strengthMin', to: null },
  opportunity: { from: 'opportunityMin', to: 'opportunityMax' },
  critical: { from: null, to: 'criticalMax' },
}

const COLS = 'grid grid-cols-[7rem_minmax(0,1fr)_6rem_6rem] items-center gap-3'

/**
 * "Escala de resultados" on Configuración de empresa: the company's three result bands,
 * each a name and a range, over a fixed swatch.
 *
 * - **The colours are not editable**, and the swatch says so ("fijo" with a lock): green,
 *   amber and red are the product's, so a colour means the same thing to every tenant.
 * - **1,00 and 5,00 are not editable**: the scale always starts and ends there, so the two
 *   outer boxes are disabled and print the fixed value.
 * - **The four inner edges are**, as text, and the card judges them as typed
 *   (`judgeBands`): a gap or an overlap is named in words with the values on either side,
 *   the boxes that make it are marked invalid and point at the message, the bar draws the
 *   gap, and the page's Save is held until the scale is whole again.
 */
export default function ResultBandsCard({
  draft,
  saved,
  defaults,
  onChange,
}: {
  draft: BandsDraft
  /** The scale the server holds — what the bar draws while the draft is not a scale. */
  saved: ResultBands
  /** The product default as a draft, for "Restablecer". */
  defaults: BandsDraft
  onChange: (draft: BandsDraft) => void
}) {
  const { t, locale } = useTranslation()
  const ids = useId()
  const verdict = judgeBands(draft)
  const problems: readonly BandsProblem[] = verdict.ok ? [] : verdict.problems
  const flagged = new Set<Edge>(
    problems.flatMap((problem) => (problem.kind === 'invalid' ? [problem.field] : 'fields' in problem ? problem.fields : [])),
  )
  const errorId = `${ids}-error`
  const set = (patch: Partial<BandsDraft>) => onChange({ ...draft, ...patch })

  // The bar: the draft's scale when it is one, else the edges that parse, with every gap
  // drawn as one — and the saved scale when not even that much can be drawn.
  const preview: ResultBands = verdict.ok
    ? { ...saved, opportunityMin: verdict.opportunityMin, strengthMin: verdict.strengthMin }
    : saved
  let segments: BandScaleSegment[] | undefined
  let badTicks: number[] = []
  if (!verdict.ok) {
    const { criticalMax, opportunityMin, opportunityMax, strengthMin } = verdict.edges
    if (criticalMax !== undefined && opportunityMin !== undefined && opportunityMax !== undefined && strengthMin !== undefined) {
      segments = [{ key: 'critical', from: SCALE_MIN, to: Math.min(criticalMax, opportunityMin) }]
      if (opportunityMin > criticalMax + 0.011) segments.push({ key: 'gap', from: criticalMax, to: opportunityMin })
      segments.push({ key: 'opportunity', from: opportunityMin, to: Math.max(opportunityMin, Math.min(opportunityMax, strengthMin)) })
      if (strengthMin > opportunityMax + 0.011) segments.push({ key: 'gap', from: opportunityMax, to: strengthMin })
      segments.push({ key: 'strength', from: strengthMin, to: SCALE_MAX })
      badTicks = problems.flatMap((problem) => (problem.kind === 'gap' || problem.kind === 'overlap' ? [problem.from, problem.to] : []))
    }
  }
  const ticks = segments ? [...new Set(segments.flatMap((segment) => [segment.from, segment.to]))] : undefined

  return (
    <Panel
      labelledBy={`${ids}-heading`}
      heading={
        <h2 id={`${ids}-heading`} className="m-0 text-2xl">
          {t('resultBands.settings.heading')}
        </h2>
      }
      meta={t('resultBands.settings.meta')}
      className="gap-3.5 pb-5"
    >
      <p className="m-0 max-w-measure text-base text-fg-secondary">{t('resultBands.settings.description')}</p>
      <BandScaleBar bands={preview} segments={segments} ticks={ticks} badTicks={badTicks} />

      <div role="group" aria-labelledby={`${ids}-heading`} className="flex flex-col gap-2.5">
        <div aria-hidden="true" className={cn(COLS, 'text-2xs font-semibold uppercase tracking-tile text-fg-label')}>
          <span>{t('resultBands.settings.colourCol')}</span>
          <span>{t('resultBands.settings.nameCol')}</span>
          <span className="text-right">{t('resultBands.settings.fromCol')}</span>
          <span className="text-right">{t('resultBands.settings.toCol')}</span>
        </div>
        {RESULT_BAND_ORDER.map((band) => {
          const paint = BAND_PAINT[band]
          const colour = t(`resultBands.settings.colour.${band}`)
          const edge = EDGES[band]
          const box = (field: Edge | null, fixed: number, label: string) =>
            field === null ? (
              <Input
                aria-label={label}
                value={boundaryText(fixed, locale)}
                disabled
                className="text-right font-mono tabular-nums"
              />
            ) : (
              <Input
                aria-label={label}
                inputMode="decimal"
                value={draft[field]}
                aria-invalid={flagged.has(field) || undefined}
                aria-describedby={flagged.has(field) ? errorId : undefined}
                onChange={(event) => set({ [field]: event.target.value })}
                className={cn('text-right font-mono tabular-nums', flagged.has(field) && 'border-accent-red ring-1 ring-accent-red')}
              />
            )
          return (
            <div key={band} data-band={band} className={COLS}>
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm border border-t-3"
                  style={{ backgroundColor: paint.fill, color: paint.ink, borderColor: paint.ring, borderTopColor: paint.line }}
                >
                  <BandGlyph band={band} />
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="text-sm text-fg-primary">{colour}</span>
                  <span className="inline-flex items-center gap-0.75 text-xs text-fg-tertiary">
                    <Lock aria-hidden="true" className="size-3" />
                    {t('resultBands.settings.fixed')}
                  </span>
                </span>
              </span>
              <Input
                aria-label={t('resultBands.settings.nameLabel', { colour: colour.toLocaleLowerCase(locale) })}
                value={draft.names[band]}
                maxLength={80}
                onChange={(event) => set({ names: { ...draft.names, [band]: event.target.value } })}
              />
              {box(edge.from, SCALE_MIN, t('resultBands.settings.fromLabel', { band: draft.names[band] || colour }))}
              {box(edge.to, SCALE_MAX, t('resultBands.settings.toLabel', { band: draft.names[band] || colour }))}
            </div>
          )
        })}
      </div>

      {verdict.ok ? (
        <p role="status" className="m-0 flex items-start gap-2 rounded-xl border border-accent-green-ring bg-chip-good-fill px-3 py-2.5 text-base text-chip-good-ink">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t('resultBands.settings.valid')}
        </p>
      ) : (
        <div
          id={errorId}
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-accent-red-ring bg-chip-critical-fill px-3 py-2.5 text-base text-chip-critical-ink"
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="flex flex-col gap-1">
            {problems.map((problem, index) => (
              <span key={index} className={index === 0 ? 'font-semibold' : undefined}>
                {problemText(problem, draft, t, locale)}
              </span>
            ))}
            <span>{t('resultBands.settings.rule')}</span>
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-fg-tertiary">{t('resultBands.settings.fixedEnds')}</span>
        <Button variant="outline" size="canvas" onClick={() => onChange(defaults)}>
          {t('resultBands.settings.reset')}
        </Button>
      </div>
    </Panel>
  )
}

function problemText(
  problem: BandsProblem,
  draft: BandsDraft,
  t: (key: string, params?: Record<string, string | number>) => string,
  locale: string,
): string {
  const n = (value: number) => boundaryText(value, locale)
  switch (problem.kind) {
    case 'invalid':
      return t('resultBands.settings.errorInvalid', { value: problem.text.trim() || '—' })
    case 'gap':
      return t('resultBands.settings.errorGap', {
        from: n(problem.from),
        to: n(problem.to),
        example: n(gapExample(problem.from, problem.to)),
      })
    case 'overlap':
      return t('resultBands.settings.errorOverlap', { from: n(problem.from), to: n(problem.to) })
    case 'inverted':
      return t('resultBands.settings.errorInverted', { band: draft.names[problem.band], min: n(problem.min), max: n(problem.max) })
    case 'nameTooLong':
      return t('resultBands.settings.errorNameTooLong', { band: draft.names[problem.band].slice(0, 24) })
  }
}
