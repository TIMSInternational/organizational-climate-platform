import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../../i18n'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Chip,
  SelectField,
  Table,
  TextField,
} from '../../../components/ui'
import {
  BAND_PAINT,
  BandGlyph,
  BandLegend,
  bandCellStyle,
  bandName,
  bandOf,
  formatMetric,
  type ResultBands,
} from '../../../components/charts'
import { PROTECTED_HATCH } from '../../../components/charts/suppression'
import { cn } from '../../../lib/cn'
import { createActionPlan } from '../../action-plans/api/actionPlans'
import { listDemographicFields } from '../../org-structure/api/demographicFields'
import { dimensionLabel } from '../dimensionLabel'
import { getSurvey } from '../api/surveys'
import { getSurveyAnalytics, type SurveyAnalyticsResponse } from '../api/surveyResults'
import {
  BASELINE_KEY,
  categoriesOf,
  cohortLabel,
  crossFieldsOf,
  crossKeyOf,
  labelFor,
  selectorsOf,
  weakestCategory,
  withCohort,
  type AuthoredField,
  type Cohort,
  type CrossField,
} from './crossOptions'

/** Four cohorts beside the baseline is five columns, which still reads on a laptop. */
const MAX_COHORTS = 4

/**
 * The grid's own cell geometry, borrowed rather than re-invented.
 *
 * This table sits directly under `ResultsClimateGrid` on the same page and answers the same
 * shape of question -- group x dimension -- so it is read in the same glance. Two tables of
 * the same numbers in two visual languages is a harder page to read than either alone.
 */
/**
 * How far from the whole survey a bar's full half-width means: ±0,50 on the 1-5 scale.
 *
 * Stated rather than auto-scaled to the data. A bar normalised to whatever the biggest
 * difference happens to be would draw a 0,2 gap at full width on a quiet survey and at a
 * sliver on a noisy one, so the same picture would mean two different things, and the
 * reader would have no way to tell which.
 *
 * 1,00 because of what the data does, measured rather than guessed. Across the seeded
 * tenant's cohorts the difference from the company runs 0,0 to 0,8: Servicios Corporativos
 * sits within 0,2, Ventanilla Única is 0,5 to 0,8 below. A scale of 0,50 was tried first and
 * was worse than useless — every one of that second cohort's bars clipped to exactly 50%, so
 * the bar discriminated nothing, which is the identical failure to the band tint it was added
 * to fix. The scale has to cover the widest real difference or it encodes nothing at the top
 * of its range.
 *
 * A bar is read against its neighbours, so it is also drawn tall enough that the small end of
 * the range survives: at 1,00 a 0,1 difference is a tenth of the half-width, which reads only
 * because the bar has height and a track behind it.
 */
const DELTA_SCALE = 1

/**
 * One cell: the score over the band's tint, the signed difference, and a bar for its size.
 *
 * ## Why the difference is not encoded by colour alone
 *
 * Measured on the seeded tenant: every cell of a real cohort row paints
 * `rgb(253, 249, 240)` — identical — because every climate score lands in 3,00-3,99 and so
 * in one band. The tint is worth keeping for the case that crosses a boundary, but on
 * ordinary data it discriminates nothing, and the first build of this panel left the one
 * number that DOES vary as the smallest grey text in the cell.
 *
 * So direction is carried by an arrow and by which side of centre the bar grows on, and
 * size by the bar's length. That survives a colour-blind reader, a greyscale print, and the
 * amber fill underneath — none of which a red/green digit would.
 */
function CrossCell({
  value,
  delta,
  bands,
  painted,
  decimals,
  locale,
  bandLabel,
  widest = false,
  directionLabel,
}: {
  value: number | null
  delta: number | null
  bands: ResultBands
  painted: boolean
  decimals: 1 | 2
  locale: string
  bandLabel: (band: ReturnType<typeof bandOf>) => string
  /** The row's largest shortfall, marked so "where is this group worst" needs no arithmetic. */
  widest?: boolean
  directionLabel: (delta: number) => string
}) {
  if (value === null) {
    return <span className="font-mono text-sm text-fg-label">—</span>
  }
  const band = bandOf(value, bands)
  const text = formatMetric(value, { kind: 'number', decimals }, locale)
  // Rounded to what is printed, so the arrow, the bar and the figure cannot disagree.
  const shown = delta === null ? null : Math.round(delta * 10) / 10 || 0
  const reach = shown === null ? 0 : Math.min(Math.abs(shown) / DELTA_SCALE, 1) * 50
  return (
    <span
      className={cn('flex flex-col items-center gap-px rounded px-1 py-1.5', painted && 'border')}
      style={painted ? bandCellStyle(band) : undefined}
    >
      <span className="inline-flex items-center gap-1 font-mono text-sm tabular-nums">
        {!painted && (
          <span style={{ color: BAND_PAINT[band].ink }} className="inline-flex">
            <BandGlyph band={band} />
          </span>
        )}
        {text}
        <span className="sr-only">{` — ${bandLabel(band)}`}</span>
      </span>
      {shown !== null && (
        <>
          <span className={cn('font-mono text-2xs tabular-nums', widest && 'font-bold')}>
            <span aria-hidden="true">{shown < 0 ? '▼' : shown > 0 ? '▲' : '–'} </span>
            {`${shown > 0 ? '+' : ''}${formatMetric(shown, { kind: 'number', decimals: 1 }, locale)}`}
            <span className="sr-only">{` ${directionLabel(shown)}`}</span>
          </span>
          {/* Decorative: every value it encodes is already in the text above it. */}
          <span aria-hidden="true" className="relative mt-0.5 block h-1.5 w-full rounded-sm bg-surface-icon-box">
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line-default" />
            {reach > 0 && (
              <span
                className={cn('absolute inset-y-0 rounded-sm', shown < 0 ? 'bg-accent-red-ink' : 'bg-accent-green-ink')}
                style={shown < 0 ? { right: '50%', width: `${reach}%` } : { left: '50%', width: `${reach}%` }}
              />
            )}
          </span>
        </>
      )}
    </span>
  )
}

const CROSS_CELL = 'border-0 p-0'
const CROSS_HEAD = cn(
  CROSS_CELL,
  'text-center align-bottom text-2xs font-bold uppercase leading-tight tracking-label text-fg-label [overflow-wrap:normal]',
)
/** The cohort names are long, so their column stays put while the scores scroll under it. */
const CROSS_STICKY = 'sticky left-0 z-10 bg-surface-card'
/** `index.css` tints every body row on hover; a row of painted cells must not flash. */
const CROSS_ROW = 'hover:bg-transparent'

const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const

/**
 * Compare and contrast any combination of demographics, and act on one.
 *
 * ## Every column is the server's own answer
 *
 * Each cohort is a separate `GET /surveys/{id}/analytics?segment=...`, recomputed over the
 * narrowed cohort with the same floors applied to it. Nothing here intersects or subtracts
 * what is already on screen: a breakdown's segments are one-dimensional, so crossing two of
 * them in the browser would produce a cohort the server never measured and never agreed to
 * disclose. The baseline column is the same call with no selectors, so a contrast always has
 * a reference that came out of the same computation.
 *
 * ## A refused cohort shows nothing, its size included
 *
 * The server answers a cohort under the floor with `isSuppressed`, no categories, and the
 * SURVEY's participation counters rather than the cohort's -- for a cross the count is itself
 * the disclosure. So a protected column prints "Protegido" in every cell and no number
 * anywhere. The follow-up button stays: a group you may not read is still a group you may act
 * on, and refusing that would make the floor a reason not to help people.
 *
 * ## The follow-up
 *
 * A cohort becomes an action plan: its department goes to `departmentId`, every selector goes
 * to `tags` as `field:value`, and the description names the cohort and its weakest category.
 * Tags rather than a new column because a plan's scope is already a department plus free tags,
 * and a demographic cohort is exactly "a department plus some other attributes".
 */
export default function SurveyCrossPanel({
  surveyId,
  payload,
  baseUrl,
  bands,
}: {
  surveyId: string
  payload: SurveyAnalyticsResponse | null
  baseUrl: string
  /** The company's result bands. Every score here is painted and named by the one it falls in,
   *  from the same source as the climate grid above — so the two cannot disagree about what
   *  counts as an área crítica. */
  bands: ResultBands
}) {
  const { t, locale } = useTranslation()
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [cohorts, setCohorts] = useState<Cohort[]>([])
  const [results, setResults] = useState<Record<string, SurveyAnalyticsResponse> | null>(null)
  const [shown, setShown] = useState<Cohort[]>([])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [followUpKey, setFollowUpKey] = useState<string | null>(null)
  const [form, setForm] = useState({ title: '', due: '', priority: 'high' })
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<{ id: string; title: string } | null>(null)
  const [authored, setAuthored] = useState<Record<string, AuthoredField>>({})

  const fields = useMemo(() => crossFieldsOf(payload, authored), [payload, authored])
  // Deliberately computed WITHOUT the overlay. If the effect below keyed off `fields`, every
  // fetch would change `fields`, which would re-run the effect, which would fetch again.
  const crossable = useMemo(() => crossFieldsOf(payload).length > 0, [payload])

  /**
   * The authored label for each demographic field, so the picker says "Puesto" rather than
   * `puesto`.
   *
   * `SurveyBreakdown` carries only `Dimension` — the stored field KEY — and no label, so
   * there is nothing on the results payload to print. Until a real tenant had demographic
   * fields this was invisible: `department` has a catalogued label and every other field was
   * a test fixture, so the raw-key fallback below never faced a reader.
   *
   * It cannot come from the i18n catalogue either. A demographic field is authored per
   * company, so its label is content — `GET /admin/demographic-fields` is the only thing that
   * knows it, and it resolves the pair for the reader's locale server-side.
   *
   * Failure is silent on purpose: the key is a usable fallback, and a label is not worth
   * replacing a working table with an error. Reachable for an API that predates the endpoint,
   * and for a super_admin reading a survey whose company they may not administer.
   */
  useEffect(() => {
    // The panel returns null below when nothing is crossable, and that early return is after
    // the hooks — so without this guard every results page with no demographic field (the live
    // TIMS survey among them) would still fire two requests to label a picker it never draws.
    if (!crossable) return
    let cancelled = false
    void (async () => {
      try {
        const survey = await getSurvey(baseUrl, surveyId, locale)
        const defined = await listDemographicFields(baseUrl, survey.companyId, locale)
        if (cancelled) return
        setAuthored(Object.fromEntries(defined.map((f) => [
          f.field,
          {
            label: f.label ?? f.field,
            options: Object.fromEntries((f.options ?? []).map((o) => [o.value, o.label ?? o.value])),
          },
        ])))
      } catch {
        // keep the keys
      }
    })()
    return () => {
      cancelled = true
    }
  }, [baseUrl, surveyId, locale, crossable])

  const pending = useMemo(() => selectorsOf(fields, chosen), [fields, chosen])
  // The builder's current selection counts as a cohort, so one group takes one click.
  const effective = useMemo(() => withCohort(cohorts, pending, MAX_COHORTS), [cohorts, pending])

  if (fields.length === 0) return null

  const name = (cohort: Cohort) => cohortLabel(fields, cohort, t('surveyResults.cross.wholeSurvey'))
  const fieldLabel = (field: string) =>
    field === 'department' ? t('surveyResults.cross.department') : (authored[field]?.label ?? field)
  // `formatMetric`, as the grid uses: one locale-aware formatter for every number on the page.
  const score = (value: number) => formatMetric(value, { kind: 'number', decimals: 2 }, locale)
  const bandLabel = (band: ReturnType<typeof bandOf>) => bandName(band, bands, t)
  const directionLabel = (delta: number) =>
    delta < 0 ? t('surveyResults.cross.deltaBelow') : delta > 0 ? t('surveyResults.cross.deltaAbove') : ''

  async function compare() {
    setBusy(true)
    setFailure(null)
    setFollowUpKey(null)
    setCreated(null)
    try {
      const wanted = effective
      const payloads = await Promise.all([
        getSurveyAnalytics(baseUrl, surveyId, locale),
        ...wanted.map((cohort) => getSurveyAnalytics(baseUrl, surveyId, locale, cohort)),
      ])
      const next: Record<string, SurveyAnalyticsResponse> = { [BASELINE_KEY]: payloads[0]! }
      wanted.forEach((cohort, index) => {
        next[crossKeyOf(cohort)] = payloads[index + 1]!
      })
      setResults(next)
      setShown(wanted)
      setCohorts(wanted)
      setChosen({})
    } catch (error) {
      setResults(null)
      setFailure(error instanceof Error ? error.message : t('surveyResults.cross.failed'))
    } finally {
      setBusy(false)
    }
  }

  function openFollowUp(cohort: Cohort) {
    const due = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)
    setFollowUpKey(crossKeyOf(cohort))
    setCreated(null)
    setForm({ title: t('surveyResults.cross.followUpFor', { name: name(cohort) }), due, priority: 'high' })
  }

  async function createFollowUp(cohort: Cohort) {
    setCreating(true)
    setFailure(null)
    try {
      // The SURVEY carries the tenant. The header's company scope may be another one entirely
      // for a super_admin, and a plan filed against the wrong tenant is invisible to the
      // people who have to do it.
      const survey = await getSurvey(baseUrl, surveyId, locale)
      const weakest = weakestCategory(results?.[crossKeyOf(cohort)] ?? null)
      const surveyTitle = typeof survey.title === 'string' ? survey.title : (payload?.title ?? '')
      const description = weakest
        ? t('surveyResults.cross.followUpDescription', {
            name: name(cohort),
            survey: surveyTitle,
            category: dimensionLabel(weakest.dimension, t),
            score: score(weakest.averageScore),
          })
        : t('surveyResults.cross.followUpDescriptionNoScore', {
            name: name(cohort),
            survey: surveyTitle,
          })
      const department = cohort.find((s) => s.field === 'department')
      const plan = await createActionPlan(baseUrl, {
        title: form.title.trim(),
        description,
        companyId: survey.companyId,
        // The plan's provenance, in the column the schema has for it. The survey id and the
        // company id come from the SAME survey here, which is the condition the endpoint
        // checks before it will accept the pair.
        sourceSurveyId: surveyId,
        ...(department ? { departmentId: department.value } : {}),
        dueDate: new Date(`${form.due}T12:00:00Z`).toISOString(),
        priority: form.priority,
        tags: ['seguimiento', ...cohort.map((s) => `${s.field}:${s.value}`)],
      })
      setCreated({ id: plan.id, title: plan.title })
      setFollowUpKey(null)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : t('surveyResults.cross.followUpFailed'))
    } finally {
      setCreating(false)
    }
  }

  /**
   * The mean of the per-category means — `derive.companyMean`'s definition, so this column and
   * the grid's "media del grupo" above cannot print different numbers for the same cohort.
   *
   * NOT the mean of every answer: a category asked twice would then weigh twice as much as one
   * asked once, and the grid's column does not work that way.
   */
  const meanOf = (result: SurveyAnalyticsResponse | null): number | null => {
    const scored = (result?.dimensions ?? [])
      .map((dimension) => dimension.averageScore)
      .filter((value): value is number => value !== null)
    if (scored.length === 0) return null
    return Math.round((scored.reduce((total, value) => total + value, 0) / scored.length) * 100) / 100
  }

  const baseline = results?.[BASELINE_KEY] ?? null
  const baselineMean = meanOf(baseline)

  /**
   * The category a cohort is furthest BELOW the whole survey on — the one a reader is looking
   * for, and the one the follow-up plan names. Null when nothing is below, because a group
   * that is at or above the company everywhere has no shortfall to mark.
   */
  const widestGapOf = (cohort: Cohort): ReadonlySet<string> => {
    const deltas = new Map<string, number>()
    for (const category of categories) {
      const cell = cellFor(cohort, category)
      const base = cellFor(null, category)
      const value = cell !== null && cell !== 'protected' ? cell.averageScore : null
      const baseScore = base !== null && base !== 'protected' ? base.averageScore : null
      if (value === null || baseScore === null) continue
      // Rounded to what is printed: two cells both showing -0,2 must both be marked, or the
      // mark claims a difference between them that the screen does not show.
      deltas.set(category, Math.round((value - baseScore) * 10) / 10)
    }
    const worst = Math.min(...[...deltas.values()])
    if (!Number.isFinite(worst) || worst >= 0) return new Set()
    return new Set([...deltas].filter(([, delta]) => delta === worst).map(([category]) => category))
  }
  const columns: Cohort[] = results ? shown : []
  const categories = results
    ? categoriesOf([baseline, ...columns.map((c) => results[crossKeyOf(c)] ?? null)])
    : []

  const cellFor = (cohort: Cohort | null, category: string) => {
    const result = cohort === null ? baseline : (results?.[crossKeyOf(cohort)] ?? null)
    if (result === null) return null
    if (result.isSuppressed) return 'protected' as const
    return (result.dimensions ?? []).find((d) => d.dimension === category) ?? null
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>{t('surveyResults.cross.title')}</CardTitle>
        <CardDescription>
          {t('surveyResults.cross.description', { floor: payload?.minimumGroupSize ?? 5 })}{' '}
          {t('surveyResults.cross.addHint', { max: MAX_COHORTS })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((field: CrossField) => (
            <SelectField
              key={field.field}
              label={fieldLabel(field.field)}
              placeholder={t('surveyResults.cross.anyValue')}
              value={chosen[field.field] ?? ''}
              onChange={(value) => setChosen((previous) => ({ ...previous, [field.field]: value }))}
              options={field.values.map((option) => ({ value: option.value, label: option.label }))}
            />
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setCohorts((previous) => withCohort(previous, pending, MAX_COHORTS))
              setChosen({})
            }}
            disabled={pending.length === 0 || cohorts.length >= MAX_COHORTS || busy}
          >
            {t('surveyResults.cross.add')}
          </Button>
          <Button type="button" onClick={() => void compare()} disabled={effective.length === 0 || busy}>
            {busy ? t('surveyResults.cross.comparing') : t('surveyResults.cross.compare')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setChosen({})
              setCohorts([])
              setResults(null)
              setShown([])
              setFailure(null)
              setFollowUpKey(null)
              setCreated(null)
            }}
            disabled={busy}
          >
            {t('surveyResults.cross.clear')}
          </Button>
        </div>

        {cohorts.length > 0 ? (
          <div className="mt-4">
            <p className="text-xs uppercase tracking-wide text-fg-secondary">
              {t('surveyResults.cross.cohorts')}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {cohorts.map((cohort) => (
                <span key={crossKeyOf(cohort)} className="inline-flex items-center gap-1">
                  <Chip label={name(cohort)} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('surveyResults.cross.remove', { name: name(cohort) })}
                    onClick={() =>
                      setCohorts((previous) =>
                        previous.filter((c) => crossKeyOf(c) !== crossKeyOf(cohort)),
                      )
                    }
                  >
                    &times;
                  </Button>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {failure ? (
          <p role="alert" className="mt-4 text-sm text-fg-secondary">
            {failure}
          </p>
        ) : null}

        {created ? (
          <p className="mt-4 text-sm">
            {t('surveyResults.cross.created', { title: created.title })}{' '}
            <a className="underline" href={`/action-plans/${created.id}`}>
              {t('surveyResults.cross.viewPlan')}
            </a>
          </p>
        ) : null}

        {results ? (
          <div className="mt-6 border-t border-line-default pt-4">
            <Table className="min-w-[52rem] table-fixed border-separate border-spacing-1 text-sm">
              <caption className="sr-only">{t('surveyResults.cross.tableCaption')}</caption>
              <thead>
                <tr className={CROSS_ROW}>
                  <th scope="col" className={cn(CROSS_HEAD, CROSS_STICKY, 'w-56 text-left')}>
                    {t('surveyResults.cross.groupHeader')}
                  </th>
                  {categories.map((category) => (
                    <th key={category} scope="col" className={CROSS_HEAD}>
                      {dimensionLabel(category, t)}
                    </th>
                  ))}
                  <th scope="col" className={CROSS_HEAD}>
                    {t('surveyResults.cross.meanHeader')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* The reference row, left unpainted: it is what the others are judged
                    against, not itself a reading to judge. The grid treats its company row
                    the same way. */}
                <tr className={CROSS_ROW}>
                  <th
                    scope="row"
                    className={cn(CROSS_CELL, CROSS_STICKY, 'py-1 text-left text-sm font-semibold text-fg-primary')}
                  >
                    {t('surveyResults.cross.wholeSurvey')}
                  </th>
                  {categories.map((category) => {
                    const cell = cellFor(null, category)
                    return (
                      <td key={category} className={cn(CROSS_CELL, 'text-center')}>
                        <CrossCell
                          value={cell !== null && cell !== 'protected' ? cell.averageScore : null}
                          delta={null}
                          bands={bands}
                          painted={false}
                          decimals={1}
                          locale={locale}
                          bandLabel={bandLabel}
                          directionLabel={directionLabel}
                        />
                      </td>
                    )
                  })}
                  <td className={cn(CROSS_CELL, 'text-center')}>
                    <CrossCell
                      value={baselineMean}
                      delta={null}
                      bands={bands}
                      painted={false}
                      decimals={2}
                      locale={locale}
                      bandLabel={bandLabel}
                      directionLabel={directionLabel}
                    />
                  </td>
                </tr>

                {columns.map((cohort) => {
                  const key = crossKeyOf(cohort)
                  const result = results[key] ?? null
                  const head = (
                    <th
                      scope="row"
                      className={cn(CROSS_CELL, CROSS_STICKY, 'py-1 pr-3 text-left align-middle font-normal')}
                    >
                      {/* Stacked, not joined with " + ": three selectors on one line is the
                          string that made this table unreadable as a column header. */}
                      <span className="flex flex-col leading-tight">
                        {cohort.map((selector, index) => (
                          <span
                            key={`${selector.field}:${selector.value}`}
                            className={index === 0 ? 'text-sm text-fg-primary' : 'text-xs text-fg-secondary'}
                          >
                            {index === 0 ? labelFor(fields, selector) : `+ ${labelFor(fields, selector)}`}
                          </span>
                        ))}
                      </span>
                    </th>
                  )

                  if (result === null || result.isSuppressed) {
                    return (
                      <tr key={key} className={CROSS_ROW}>
                        {head}
                        {/* ONE statement for the whole row. Six cells reading "Protegido"
                            implied six separate decisions; the cohort is withheld as a unit,
                            and saying so once is both clearer and truer. */}
                        <td
                          colSpan={categories.length + 1}
                          className={cn(CROSS_CELL, PROTECTED_HATCH, 'rounded px-3 py-2 text-left')}
                        >
                          <span className="text-sm text-fg-secondary">
                            {t('surveyResults.cross.protectedRow', { floor: payload?.minimumGroupSize ?? 5 })}
                            {cohort.length > 1 ? ` ${t('surveyResults.cross.protectedHint')}` : ''}
                          </span>
                        </td>
                      </tr>
                    )
                  }

                  const cohortMean = meanOf(result)
                  const widest = widestGapOf(cohort)
                  return (
                    <tr key={key} className={CROSS_ROW}>
                      {head}
                      {categories.map((category) => {
                        const cell = cellFor(cohort, category)
                        const value = cell !== null && cell !== 'protected' ? cell.averageScore : null
                        const base = cellFor(null, category)
                        const baseScore = base !== null && base !== 'protected' ? base.averageScore : null
                        return (
                          <td key={category} className={cn(CROSS_CELL, 'text-center')}>
                            <CrossCell
                              value={value}
                              // A null baseline leaves nothing to contrast against, so the
                              // score stands alone rather than beside a difference computed
                              // from a number that does not exist.
                              delta={value === null || baseScore === null ? null : value - baseScore}
                              bands={bands}
                              painted
                              decimals={1}
                              locale={locale}
                              bandLabel={bandLabel}
                              widest={widest.has(category)}
                              directionLabel={directionLabel}
                            />
                          </td>
                        )
                      })}
                      <td className={cn(CROSS_CELL, 'text-center')}>
                        <CrossCell
                          value={cohortMean}
                          delta={cohortMean === null || baselineMean === null ? null : cohortMean - baselineMean}
                          bands={bands}
                          painted
                          decimals={2}
                          locale={locale}
                          bandLabel={bandLabel}
                          directionLabel={directionLabel}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>

            <BandLegend bands={bands} className="mt-3">
              <span className="text-2xs text-fg-label">
                {t('surveyResults.cross.barNote', { scale: formatMetric(DELTA_SCALE, { kind: 'number', decimals: 2 }, locale) })}
              </span>
            </BandLegend>

            <div className="mt-4 flex flex-wrap gap-3">
              {columns.map((cohort) => (
                <Button
                  key={crossKeyOf(cohort)}
                  type="button"
                  variant="outline"
                  onClick={() => openFollowUp(cohort)}
                  disabled={creating}
                >
                  {t('surveyResults.cross.followUpFor', { name: name(cohort) })}
                </Button>
              ))}
            </div>

            {followUpKey !== null
              ? columns
                  .filter((cohort) => crossKeyOf(cohort) === followUpKey)
                  .map((cohort) => (
                    <div
                      key={crossKeyOf(cohort)}
                      className="mt-4 grid gap-4 border-t border-line-default pt-4 sm:grid-cols-3"
                    >
                      <TextField
                        label={t('surveyResults.cross.followUpName')}
                        value={form.title}
                        onChange={(value) => setForm((f) => ({ ...f, title: value }))}
                      />
                      <TextField
                        label={t('surveyResults.cross.followUpDue')}
                        type="date"
                        value={form.due}
                        onChange={(value) => setForm((f) => ({ ...f, due: value }))}
                      />
                      <SelectField
                        label={t('surveyResults.cross.followUpPriority')}
                        value={form.priority}
                        onChange={(value) => setForm((f) => ({ ...f, priority: value }))}
                        options={PRIORITIES.map((p) => ({
                          value: p,
                          label: t(`surveyResults.cross.priority${p[0]!.toUpperCase()}${p.slice(1)}`),
                        }))}
                      />
                      <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
                        <Button
                          type="button"
                          onClick={() => void createFollowUp(cohort)}
                          disabled={creating || form.title.trim() === '' || form.due === ''}
                        >
                          {creating ? t('surveyResults.cross.creating') : t('surveyResults.cross.create')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setFollowUpKey(null)}
                          disabled={creating}
                        >
                          {t('surveyResults.cross.cancel')}
                        </Button>
                      </div>
                    </div>
                  ))
              : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
