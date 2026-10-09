import { useMemo, useState } from 'react'
import { useTranslation } from '../../../i18n'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataText,
  SelectField,
  Table,
} from '../../../components/ui'
import { dimensionLabel } from '../dimensionLabel'
import { getSurveyAnalytics, type SurveyAnalyticsResponse } from '../api/surveyResults'
import { crossFieldsOf, labelFor, selectorsOf, type CrossField } from './crossOptions'

/**
 * "Cruces entre variables demográficas" — pick a department and a demographic value and
 * read that cohort's score per category.
 *
 * ## It asks the server, it does not slice what is on screen
 *
 * Every number here comes from `GET /surveys/{id}/analytics?segment=…`, which recomputes the
 * aggregation over the narrowed cohort and applies the same floors to it. Slicing the
 * breakdown already on the page would be faster and wrong: a breakdown's segments are
 * one-dimensional, so intersecting two of them client-side would produce a cohort the server
 * never measured and never agreed to disclose.
 *
 * ## A refusal is an answer, and it is reported as one
 *
 * The server returns `isSuppressed` with no questions, no categories and the SURVEY's own
 * participation counters rather than the cohort's — for a cross the count is itself the
 * disclosure. So this panel never prints a cohort size for a refused cross, and never shows a
 * zero: it says the cross is too small to show. "Los gerentes de finanzas" is one person at
 * most organisations, so that is the answer that cross usually gives.
 *
 * ## Why the category scores and not the whole page
 *
 * `dimensions` is the server's own rollup — the number a climate conversation is actually
 * had in ("la categoría Comunicación: 4,8"). The rest of the results page is built from a
 * climate map across groups, which has no meaning once the reader has narrowed to one group.
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
  const [result, setResult] = useState<SurveyAnalyticsResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const selectors = useMemo(() => selectorsOf(fields, chosen), [fields, chosen])

  if (fields.length === 0) return null

  async function run() {
    setBusy(true)
    setFailure(null)
    try {
      setResult(await getSurveyAnalytics(baseUrl, surveyId, locale, selectors))
    } catch (error) {
      setResult(null)
      setFailure(error instanceof Error ? error.message : t('surveyResults.cross.failed'))
    } finally {
      setBusy(false)
    }
  }

  function clear() {
    setChosen({})
    setResult(null)
    setFailure(null)
  }

  // The label of the field itself: a demographic key is a slug the company chose, so there is
  // no copy for it. `department` is ours and does have copy.
  const fieldLabel = (field: string) =>
    field === 'department' ? t('surveyResults.cross.department') : field

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>{t('surveyResults.cross.title')}</CardTitle>
        <CardDescription>{t('surveyResults.cross.description', { floor: payload?.minimumGroupSize ?? 5 })}</CardDescription>
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
          <Button type="button" onClick={() => void run()} disabled={selectors.length === 0 || busy}>
            {busy ? t('surveyResults.cross.running') : t('surveyResults.cross.run')}
          </Button>
          <Button type="button" variant="ghost" onClick={clear} disabled={busy}>
            {t('surveyResults.cross.clear')}
          </Button>
        </div>

        {failure ? (
          <p role="alert" className="mt-4 text-sm text-fg-secondary">
            {failure}
          </p>
        ) : null}

        {result ? (
          <div className="mt-6 border-t border-line-default pt-4">
            <p className="text-sm text-fg-secondary">
              {/* `?? []` is not defensive noise: the web auto-deploys on merge while the API
                  needs a manual dispatch, so this page runs against an API that predates the
                  echo for a window. No echo reads as "the whole survey", which is what an API
                  that ignored the selectors actually returned. */}
              {(result.filter ?? []).length === 0
                ? t('surveyResults.cross.wholeSurvey')
                : (result.filter ?? []).map((selector) => labelFor(fields, selector)).join(' + ')}
            </p>

            {result.isSuppressed ? (
              // No count, deliberately. See the class note: for a cross the size is the leak.
              <p className="mt-2 text-sm">{t('surveyResults.cross.tooSmall', { floor: result.minimumGroupSize })}</p>
            ) : (
              <>
                <p className="mt-1 text-sm text-fg-secondary">
                  {t('surveyResults.cross.cohort', { count: result.summary.completedCount })}
                </p>
                {(result.dimensions ?? []).length === 0 ? (
                  <p className="mt-2 text-sm">{t('surveyResults.cross.noCategories')}</p>
                ) : (
                  <Table className="mt-3 text-sm">
                    <thead>
                      <tr className="text-left text-fg-secondary">
                        <th scope="col" className="py-1 pr-4 font-medium">
                          {t('surveyResults.cross.categoryHeader')}
                        </th>
                        <th scope="col" className="py-1 pr-4 font-medium">
                          {t('surveyResults.cross.scoreHeader')}
                        </th>
                        <th scope="col" className="py-1 font-medium">
                          {t('surveyResults.cross.answeredHeader')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(result.dimensions ?? []).map((dimension) => (
                        <tr key={dimension.dimension} className="border-t border-line-default">
                          <th scope="row" className="py-1.5 pr-4 text-left font-normal">
                            {/* The same resolver the question list above uses: a catalogued
                                slug gets its Spanish heading, an authored category prints as
                                authored. Printing `psychological_safety` here while the rows
                                above say "Seguridad psicológica" is one screen disagreeing
                                with itself. */}
                            {dimensionLabel(dimension.dimension, t)}
                          </th>
                          <td className="py-1.5 pr-4">
                            {dimension.averageScore === null ? (
                              // Null is "not measured". A zero here would read as the worst
                              // possible score for a category nobody was asked about.
                              <span className="text-fg-secondary">{t('surveyResults.cross.noScore')}</span>
                            ) : (
                              <DataText>
                                {/* `toFixed` always writes a dot, and the rest of this page
                                    prints 3,6 on a Spanish screen. One number per screen. */}
                                {dimension.averageScore.toLocaleString(locale, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </DataText>
                            )}
                          </td>
                          <td className="py-1.5">
                            <DataText>{dimension.answeredCount.toLocaleString(locale)}</DataText>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
