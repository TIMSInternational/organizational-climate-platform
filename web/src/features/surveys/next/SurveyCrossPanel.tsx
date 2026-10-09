import { useMemo, useState } from 'react'
import { useTranslation } from '../../../i18n'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Chip,
  DataText,
  SelectField,
  Table,
  TextField,
} from '../../../components/ui'
import { createActionPlan } from '../../action-plans/api/actionPlans'
import { dimensionLabel } from '../dimensionLabel'
import { getSurvey } from '../api/surveys'
import { getSurveyAnalytics, type SurveyAnalyticsResponse } from '../api/surveyResults'
import {
  BASELINE_KEY,
  categoriesOf,
  cohortLabel,
  crossFieldsOf,
  crossKeyOf,
  selectorsOf,
  weakestCategory,
  withCohort,
  type Cohort,
  type CrossField,
} from './crossOptions'

/** Four cohorts beside the baseline is five columns, which still reads on a laptop. */
const MAX_COHORTS = 4

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
}: {
  surveyId: string
  payload: SurveyAnalyticsResponse | null
  baseUrl: string
}) {
  const { t, locale } = useTranslation()
  const fields = useMemo(() => crossFieldsOf(payload), [payload])
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

  const pending = useMemo(() => selectorsOf(fields, chosen), [fields, chosen])
  // The builder's current selection counts as a cohort, so one group takes one click.
  const effective = useMemo(() => withCohort(cohorts, pending, MAX_COHORTS), [cohorts, pending])

  if (fields.length === 0) return null

  const name = (cohort: Cohort) => cohortLabel(fields, cohort, t('surveyResults.cross.wholeSurvey'))
  const fieldLabel = (field: string) =>
    field === 'department' ? t('surveyResults.cross.department') : field
  const score = (value: number) =>
    value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

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

  const baseline = results?.[BASELINE_KEY] ?? null
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
            <Table className="text-sm">
              <thead>
                <tr className="text-left text-fg-secondary">
                  <th scope="col" className="py-1 pr-4 font-medium">
                    {t('surveyResults.cross.categoryHeader')}
                  </th>
                  <th scope="col" className="py-1 pr-4 font-medium">
                    {t('surveyResults.cross.wholeSurvey')}
                  </th>
                  {columns.map((cohort) => (
                    <th key={crossKeyOf(cohort)} scope="col" className="py-1 pr-4 font-medium">
                      {name(cohort)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => {
                  const base = cellFor(null, category)
                  const baseScore = base !== null && base !== 'protected' ? base.averageScore : null
                  return (
                    <tr key={category} className="border-t border-line-default">
                      <th scope="row" className="py-1.5 pr-4 text-left font-normal">
                        {dimensionLabel(category, t)}
                      </th>
                      <td className="py-1.5 pr-4">
                        {baseScore === null ? (
                          <span className="text-fg-secondary">{t('surveyResults.cross.noScore')}</span>
                        ) : (
                          <DataText>{score(baseScore)}</DataText>
                        )}
                      </td>
                      {columns.map((cohort) => {
                        const cell = cellFor(cohort, category)
                        if (cell === 'protected') {
                          return (
                            <td key={crossKeyOf(cohort)} className="py-1.5 pr-4 text-fg-secondary">
                              {t('surveyResults.cross.protectedCell')}
                            </td>
                          )
                        }
                        const value = cell?.averageScore ?? null
                        if (value === null) {
                          return (
                            <td key={crossKeyOf(cohort)} className="py-1.5 pr-4 text-fg-secondary">
                              {t('surveyResults.cross.noScore')}
                            </td>
                          )
                        }
                        // The contrast, signed. A null baseline means there is nothing to
                        // contrast against, so the score stands alone rather than beside a
                        // difference computed from a number that does not exist.
                        const delta = baseScore === null ? null : value - baseScore
                        return (
                          <td key={crossKeyOf(cohort)} className="py-1.5 pr-4">
                            <DataText>{score(value)}</DataText>
                            {delta === null ? null : (
                              <span className="ml-2 text-xs text-fg-secondary">
                                {delta > 0 ? '+' : ''}
                                {score(delta)}
                              </span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </Table>

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
