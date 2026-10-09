import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SurveyCrossPanel from './SurveyCrossPanel'
import {
  categoriesOf,
  cohortLabel,
  crossFieldsOf,
  crossKeyOf,
  labelFor,
  selectorsOf,
  weakestCategory,
  withCohort,
} from './crossOptions'
import { TranslationProvider } from '../../../i18n'
import * as resultsApi from '../api/surveyResults'
import * as surveysApi from '../api/surveys'
import * as plansApi from '../../action-plans/api/actionPlans'
import * as demographicsApi from '../../org-structure/api/demographicFields'
import type { SurveyAnalyticsResponse, SurveyBreakdown, SurveySegmentResult } from '../api/surveyResults'
import en from '../../../i18n/en.json'

vi.mock('../api/surveyResults', async (importOriginal) => ({
  ...(await importOriginal<typeof resultsApi>()),
  getSurveyAnalytics: vi.fn(),
}))
vi.mock('../api/surveys', async (importOriginal) => ({
  ...(await importOriginal<typeof surveysApi>()),
  getSurvey: vi.fn(),
}))
vi.mock('../../action-plans/api/actionPlans', async (importOriginal) => ({
  ...(await importOriginal<typeof plansApi>()),
  createActionPlan: vi.fn(),
}))
vi.mock('../../org-structure/api/demographicFields', async (importOriginal) => ({
  ...(await importOriginal<typeof demographicsApi>()),
  listDemographicFields: vi.fn(),
}))

const copy = en.surveyResults.cross
/** The product's own defaults: opportunity from 3,00, strength from 4,00. */
const BANDS = { opportunityMin: 3, strengthMin: 4, names: { critical: null, opportunity: null, strength: null } }
const FINANCE = 'd1'

function segment(key: string, label: string | null, count: number, suppressed = false): SurveySegmentResult {
  return {
    dimension: 'x',
    key,
    label,
    respondentCount: suppressed ? 0 : count,
    participationRate: null,
    headcount: null,
    isSuppressed: suppressed,
    questions: [],
  }
}

function breakdown(dimension: string, segments: SurveySegmentResult[]): SurveyBreakdown {
  return { dimension, segments, suppressedSegmentCount: 0, suppressedRespondentCount: 0, unsegmentedRespondentCount: 0 }
}

const dim = (dimension: string, averageScore: number | null) => ({
  dimension,
  questionCount: 2,
  answeredCount: 10,
  averageScore,
})

function payload(overrides: Partial<SurveyAnalyticsResponse> = {}): SurveyAnalyticsResponse {
  return {
    surveyId: 's1',
    title: 'Clima 2026',
    status: 'closed',
    language: 'es',
    resolvedLocale: 'es',
    fallbackFields: [],
    summary: {
      invitedCount: 40, responseCount: 30, completedCount: 30, partialCount: 0,
      participationRate: 75, completionRate: 100, averageCompletionSeconds: 300,
      firstResponseAt: null, lastResponseAt: null, byLanguage: [],
    },
    questions: [],
    dimensions: [],
    breakdowns: [
      breakdown('department', [segment(FINANCE, 'Finanzas', 9), segment('d2', 'Ventas', 8)]),
      breakdown('puesto', [segment('gerencia', null, 0, true), segment('operativo', 'Operativo', 17)]),
    ],
    isSuppressed: false,
    suppressionReason: null,
    minimumGroupSize: 5,
    filter: [],
    generatedAt: '2026-10-08T00:00:00Z',
    ...overrides,
  }
}

function renderPanel(given: SurveyAnalyticsResponse | null = payload()) {
  return render(
    <TranslationProvider initialLocale="en">
      <SurveyCrossPanel surveyId="s1" payload={given} baseUrl="http://api.test" bands={BANDS} />
    </TranslationProvider>,
  )
}

/** Choose a value in one of the panel's selects. */
async function choose(fieldLabel: string, optionLabel: string) {
  await userEvent.click(screen.getByRole('combobox', { name: fieldLabel }))
  await userEvent.click(await screen.findByRole('option', { name: optionLabel }))
}

beforeEach(() => {
  vi.mocked(resultsApi.getSurveyAnalytics).mockReset()
  vi.mocked(surveysApi.getSurvey).mockReset()
  vi.mocked(plansApi.createActionPlan).mockReset()
  // Default: the company defines no demographic field, so every picker falls back to its key.
  // A test that cares about labels overrides this.
  vi.mocked(demographicsApi.listDemographicFields).mockReset()
  vi.mocked(demographicsApi.listDemographicFields).mockResolvedValue([])
})
afterEach(cleanup)

describe('crossOptions', () => {
  it('offers every value a breakdown already lists, suppressed ones included', () => {
    const fields = crossFieldsOf(payload())
    expect(fields.map((f) => f.field)).toEqual(['department', 'puesto'])
    expect(fields[1]!.values.map((v) => v.label)).toEqual(['gerencia', 'Operativo'])
  })

  it('leaves out a field that offers no choice', () => {
    expect(crossFieldsOf(payload({ breakdowns: [breakdown('pais', [segment('cr', 'Costa Rica', 30)])] }))).toEqual([])
    expect(crossFieldsOf(null)).toEqual([])
  })

  it('turns the chosen values into selectors in the order the fields were offered', () => {
    const fields = crossFieldsOf(payload())
    const selectors = selectorsOf(fields, { puesto: 'operativo', department: FINANCE })
    expect(selectors).toEqual([
      { field: 'department', value: FINANCE },
      { field: 'puesto', value: 'operativo' },
    ])
    expect(crossKeyOf(selectors)).toBe('department:d1|puesto:operativo')
    expect(selectorsOf(fields, { department: '' })).toEqual([])
    expect(labelFor(fields, { field: 'department', value: FINANCE })).toBe('Finanzas')
    expect(labelFor(fields, { field: 'department', value: 'gone' })).toBe('gone')
  })

  it('names a cohort by the labels it was offered under, and the baseline by its own word', () => {
    const fields = crossFieldsOf(payload())
    expect(cohortLabel(fields, [], 'Whole survey')).toBe('Whole survey')
    expect(
      cohortLabel(fields, [{ field: 'department', value: FINANCE }, { field: 'puesto', value: 'operativo' }], 'x'),
    ).toBe('Finanzas + Operativo')
  })

  it('refuses a duplicate cohort, an empty one, and one past the cap', () => {
    const a = [{ field: 'department', value: FINANCE }]
    const b = [{ field: 'department', value: 'd2' }]
    expect(withCohort([], a, 4)).toEqual([a])
    // The same cohort twice is one column: two identical columns invite the reader to look
    // for a difference between them.
    expect(withCohort([a], [{ field: 'department', value: FINANCE }], 4)).toEqual([a])
    expect(withCohort([a], [], 4)).toEqual([a])
    expect(withCohort([a, b], b, 2)).toEqual([a, b])
    expect(withCohort([a], b, 2)).toEqual([a, b])
  })

  it('orders the rows by the baseline and appends anything only a cohort has', () => {
    const base = payload({ dimensions: [dim('Confianza', 4), dim('Carga', 3)] })
    const other = payload({ dimensions: [dim('Carga', 2), dim('Solo del grupo', 5)] })
    expect(categoriesOf([base, other])).toEqual(['Confianza', 'Carga', 'Solo del grupo'])
    expect(categoriesOf([null, null])).toEqual([])
  })

  it('finds the weakest scored category and ignores the unscored ones', () => {
    expect(weakestCategory(payload({ dimensions: [dim('A', 4), dim('B', 2.5), dim('C', null)] }))).toEqual(
      dim('B', 2.5),
    )
    expect(weakestCategory(payload({ dimensions: [dim('C', null)] }))).toBeNull()
    expect(weakestCategory(null)).toBeNull()
  })
})

describe('SurveyCrossPanel — comparing', () => {
  it('does not render at all when the survey offers nothing to cross', () => {
    renderPanel(null)
    expect(screen.queryByText(copy.title)).toBeNull()
  })

  it('puts the whole survey beside the cohort and prints the signed difference', async () => {
    vi.mocked(resultsApi.getSurveyAnalytics)
      .mockResolvedValueOnce(payload({ dimensions: [dim('Comunicación', 3.2), dim('Confianza', 4.0)] }))
      .mockResolvedValueOnce(
        payload({
          filter: [{ field: 'department', value: FINANCE }],
          dimensions: [dim('Comunicación', 4.8), dim('Confianza', 3.5)],
        }),
      )

    renderPanel()
    await choose(copy.department, 'Finanzas')
    await userEvent.click(screen.getByRole('button', { name: copy.compare }))

    // One decimal in a category cell and two in the MEAN column -- the grid's own precisions,
    // because this table is read in the same glance as the grid.
    await waitFor(() => expect(screen.getByText('4.8')).toBeTruthy())
    // The baseline row, the cohort row, and the contrast between them.
    expect(screen.getByText('3.2')).toBeTruthy()
    expect(screen.getByText('+1.6')).toBeTruthy()
    expect(screen.getByText('-0.5')).toBeTruthy()
    // The mean of the per-category means, at the two decimals it is printed at.
    expect(screen.getByText('4.15')).toBeTruthy()

    const calls = vi.mocked(resultsApi.getSurveyAnalytics).mock.calls
    expect(calls[0]![3]).toBeUndefined()
    expect(calls[1]![3]).toEqual([{ field: 'department', value: FINANCE }])
  })

  it('contrasts two cohorts against the same baseline in one table', async () => {
    vi.mocked(resultsApi.getSurveyAnalytics)
      .mockResolvedValueOnce(payload({ dimensions: [dim('Confianza', 3.0)] }))
      .mockResolvedValueOnce(payload({ filter: [{ field: 'department', value: FINANCE }], dimensions: [dim('Confianza', 4.0)] }))
      .mockResolvedValueOnce(payload({ filter: [{ field: 'department', value: 'd2' }], dimensions: [dim('Confianza', 2.0)] }))

    renderPanel()
    await choose(copy.department, 'Finanzas')
    await userEvent.click(screen.getByRole('button', { name: copy.add }))
    await choose(copy.department, 'Ventas')
    await userEvent.click(screen.getByRole('button', { name: copy.compare }))

    // Twice each: once in the category cell and once in the MEAN column. With a single
    // dimension the mean IS that dimension, so the two agree by construction -- which is the
    // point of defining the mean the way the grid above defines it.
    await waitFor(() => expect(screen.getAllByText('+1.0')).toHaveLength(2))
    expect(screen.getAllByText('-1.0')).toHaveLength(2)
    expect(vi.mocked(resultsApi.getSurveyAnalytics).mock.calls).toHaveLength(3)
  })

  it('prints no number at all for a cohort the server refused', async () => {
    vi.mocked(resultsApi.getSurveyAnalytics)
      .mockResolvedValueOnce(payload({ dimensions: [dim('Confianza', 3.0)] }))
      .mockResolvedValueOnce(
        payload({
          isSuppressed: true,
          suppressionReason: 'below_minimum_segment_respondents',
          filter: [{ field: 'puesto', value: 'gerencia' }],
          summary: { ...payload().summary, completedCount: 30 },
          dimensions: [],
        }),
      )

    renderPanel()
    await choose('puesto', 'gerencia')
    await userEvent.click(screen.getByRole('button', { name: copy.compare }))

    // ONE row-level statement, not one "Protegido" per category: the cohort is withheld as a
    // unit, and six cells saying so implied six separate decisions.
    const refusal = copy.protectedRow.replace('{floor}', '5')
    await waitFor(() => expect(screen.getByText(refusal, { exact: false })).toBeTruthy())
    expect(screen.getAllByText(refusal, { exact: false })).toHaveLength(1)
    // For a cross the size IS the disclosure, so the cohort's own count never appears.
    expect(screen.queryByText('30')).toBeNull()
  })

  it('cannot compare with nothing chosen', () => {
    renderPanel()
    expect((screen.getByRole('button', { name: copy.compare }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: copy.add }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('SurveyCrossPanel — the follow-up', () => {
  async function compareFinance() {
    vi.mocked(resultsApi.getSurveyAnalytics)
      .mockResolvedValueOnce(payload({ dimensions: [dim('Confianza', 3.0)] }))
      .mockResolvedValueOnce(
        payload({
          filter: [{ field: 'department', value: FINANCE }],
          dimensions: [dim('Confianza', 4.0), dim('Reconocimiento', 2.1)],
        }),
      )
    renderPanel()
    await choose(copy.department, 'Finanzas')
    await userEvent.click(screen.getByRole('button', { name: copy.compare }))
    await waitFor(() => expect(screen.getByText('4.0')).toBeTruthy())
  }

  it('files the plan against the survey tenant, the department, and the cohort as tags', async () => {
    vi.mocked(surveysApi.getSurvey).mockResolvedValue({
      id: 's1', companyId: 'company-7', title: 'Clima 2026',
    } as unknown as Awaited<ReturnType<typeof surveysApi.getSurvey>>)
    vi.mocked(plansApi.createActionPlan).mockResolvedValue({
      id: 'plan-9', title: 'Follow-up for Finanzas',
    } as unknown as Awaited<ReturnType<typeof plansApi.createActionPlan>>)

    await compareFinance()
    await userEvent.click(screen.getByRole('button', { name: copy.followUpFor.replace('{name}', 'Finanzas') }))
    await userEvent.click(await screen.findByRole('button', { name: copy.create }))

    await waitFor(() => expect(vi.mocked(plansApi.createActionPlan)).toHaveBeenCalled())
    const [, input] = vi.mocked(plansApi.createActionPlan).mock.calls[0]!
    // The SURVEY's tenant, not the header's scope: a plan filed against the wrong company is
    // invisible to the people who have to do it.
    expect(input.companyId).toBe('company-7')
    // The schema's own provenance column, not just a tag: `action_plans.source_survey_id`
    // carries an FK, and the endpoint refuses a survey belonging to another company -- so the
    // id and the tenant above have to come from the same survey, and they do.
    expect(input.sourceSurveyId).toBe('s1')
    expect(input.departmentId).toBe(FINANCE)
    expect(input.tags).toEqual(['seguimiento', `department:${FINANCE}`])
    expect(input.priority).toBe('high')
    // The description names the cohort's WEAKEST category, which is the one to act on.
    expect(input.description).toContain('Reconocimiento')
    expect(input.description).toContain('2.10')
    expect(new Date(input.dueDate).getTime()).toBeGreaterThan(Date.now())

    expect(screen.getByText(copy.created.replace('{title}', 'Follow-up for Finanzas'))).toBeTruthy()
    expect(screen.getByRole('link', { name: copy.viewPlan }).getAttribute('href')).toBe('/action-plans/plan-9')
  })

  it('carries a non-department cohort in the tags and leaves the department unset', async () => {
    vi.mocked(resultsApi.getSurveyAnalytics)
      .mockResolvedValueOnce(payload({ dimensions: [dim('Confianza', 3.0)] }))
      .mockResolvedValueOnce(
        payload({ filter: [{ field: 'puesto', value: 'operativo' }], dimensions: [dim('Confianza', 2.0)] }),
      )
    vi.mocked(surveysApi.getSurvey).mockResolvedValue({
      id: 's1', companyId: 'company-7', title: 'Clima 2026',
    } as unknown as Awaited<ReturnType<typeof surveysApi.getSurvey>>)
    vi.mocked(plansApi.createActionPlan).mockResolvedValue({
      id: 'plan-3', title: 'x',
    } as unknown as Awaited<ReturnType<typeof plansApi.createActionPlan>>)

    renderPanel()
    await choose('puesto', 'Operativo')
    await userEvent.click(screen.getByRole('button', { name: copy.compare }))
    await waitFor(() => expect(screen.getByText('2.00')).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: copy.followUpFor.replace('{name}', 'Operativo') }))
    await userEvent.click(await screen.findByRole('button', { name: copy.create }))

    await waitFor(() => expect(vi.mocked(plansApi.createActionPlan)).toHaveBeenCalled())
    const [, input] = vi.mocked(plansApi.createActionPlan).mock.calls[0]!
    expect(input.departmentId).toBeUndefined()
    expect(input.tags).toEqual(['seguimiento', 'puesto:operativo'])
  })

  it('offers the follow-up for a cohort it may not read', async () => {
    vi.mocked(resultsApi.getSurveyAnalytics)
      .mockResolvedValueOnce(payload({ dimensions: [dim('Confianza', 3.0)] }))
      .mockResolvedValueOnce(payload({ isSuppressed: true, filter: [{ field: 'puesto', value: 'gerencia' }], dimensions: [] }))

    renderPanel()
    await choose('puesto', 'gerencia')
    await userEvent.click(screen.getByRole('button', { name: copy.compare }))
    await waitFor(() =>
      expect(screen.getByText(copy.protectedRow.replace('{floor}', '5'), { exact: false })).toBeTruthy(),
    )

    // A group that cannot be read is still a group that can be helped; the floor must not
    // become a reason not to act.
    expect(screen.getByRole('button', { name: copy.followUpFor.replace('{name}', 'gerencia') })).toBeTruthy()
  })

  it('will not create a plan with no title', async () => {
    await compareFinance()
    await userEvent.click(screen.getByRole('button', { name: copy.followUpFor.replace('{name}', 'Finanzas') }))
    const title = await screen.findByLabelText(copy.followUpName)
    await userEvent.clear(title)
    expect((screen.getByRole('button', { name: copy.create }) as HTMLButtonElement).disabled).toBe(true)
  })
})


/**
 * The picker's own labels, which come from the tenant and not from the catalogue.
 *
 * `SurveyBreakdown` carries the stored field KEY and no label, so without this lookup the
 * control over a Spanish survey reads `puesto` — lowercase, unaccented, and in the one place
 * the reader has to understand before anything else works.
 */
describe('SurveyCrossPanel — labelling the fields', () => {
  const withPuesto = payload({
    breakdowns: [
      breakdown('department', [segment(FINANCE, 'Finanzas', 9), segment('d2', 'Operaciones', 7)]),
      // `label: null` is what the server actually sends for a demographic segment.
      breakdown('puesto', [segment('gerencia', null, 8), segment('colaborador', null, 9)]),
    ],
  })

  it("lists an option under the company's own wording, not the stored value", async () => {
    vi.mocked(surveysApi.getSurvey).mockResolvedValue({
      id: 's1', companyId: 'company-7', title: 'Clima 2026',
    } as unknown as Awaited<ReturnType<typeof surveysApi.getSurvey>>)
    vi.mocked(demographicsApi.listDemographicFields).mockResolvedValue([
      {
        field: 'puesto',
        label: 'Puesto',
        options: [
          { value: 'gerencia', label: 'Jefaturas y gerencias' },
          { value: 'colaborador', label: 'Personal colaborador' },
        ],
      },
    ] as unknown as Awaited<ReturnType<typeof demographicsApi.listDemographicFields>>)

    renderPanel(withPuesto)

    // Wait for the overlay to arrive before opening the list, then read what it offers. A
    // demographic segment comes back with `label: null` -- the aggregation never joins the
    // option's label -- so the raw stored value is what reaches the picker without it.
    await userEvent.click(await screen.findByRole('combobox', { name: 'Puesto' }))
    expect(await screen.findByRole('option', { name: 'Jefaturas y gerencias' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'gerencia' })).toBeNull()
  })

  it('names a demographic field as the company authored it', async () => {
    vi.mocked(surveysApi.getSurvey).mockResolvedValue({
      id: 's1', companyId: 'company-7', title: 'Clima 2026',
    } as unknown as Awaited<ReturnType<typeof surveysApi.getSurvey>>)
    vi.mocked(demographicsApi.listDemographicFields).mockResolvedValue([
      { field: 'puesto', label: 'Puesto' },
    ] as unknown as Awaited<ReturnType<typeof demographicsApi.listDemographicFields>>)

    renderPanel(withPuesto)

    expect(await screen.findByLabelText('Puesto')).toBeTruthy()
    // Asked for the SURVEY's company, not the header's scope: a super_admin reading another
    // tenant's survey would otherwise label its fields from their own company's catalogue.
    const [, companyId] = vi.mocked(demographicsApi.listDemographicFields).mock.calls[0]!
    expect(companyId).toBe('company-7')
  })

  it('falls back to the stored key when the lookup fails, rather than breaking the panel', async () => {
    vi.mocked(surveysApi.getSurvey).mockResolvedValue({
      id: 's1', companyId: 'company-7', title: 'Clima 2026',
    } as unknown as Awaited<ReturnType<typeof surveysApi.getSurvey>>)
    vi.mocked(demographicsApi.listDemographicFields).mockResolvedValue(
      undefined as unknown as Awaited<ReturnType<typeof demographicsApi.listDemographicFields>>,
    )

    renderPanel(withPuesto)

    expect(await screen.findByLabelText('puesto')).toBeTruthy()
    expect(screen.getByRole('button', { name: copy.compare })).toBeTruthy()
  })

  it('asks for no labels at all when the survey offers nothing to cross', () => {
    renderPanel(payload({ breakdowns: [] }))
    expect(vi.mocked(demographicsApi.listDemographicFields)).not.toHaveBeenCalled()
    expect(vi.mocked(surveysApi.getSurvey)).not.toHaveBeenCalled()
  })
})
