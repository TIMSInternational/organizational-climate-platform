import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { TranslationProvider } from '../../../../i18n'
import { setToken, clearToken } from '../../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../../company-context'
import { tokenFor } from '../../../../test/jwtFixture'
import { getClimateTrends, type ClimateTrendsResponse } from '../../api/climateTrends'
import { listSurveys, type SurveyListItem } from '../../api/surveys'
import ClimateTrendsNextPage from './ClimateTrendsNextPage'
import { downloadTextFile } from '../../../../lib/downloadTextFile'
import en from '../../../../i18n/en.json'

const copy = en.surveys.next.trends

vi.mock('../../api/climateTrends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/climateTrends')>()),
  getClimateTrends: vi.fn(),
}))
vi.mock('../../api/surveys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveys')>()),
  listSurveys: vi.fn(),
}))
vi.mock('../../../../lib/downloadTextFile', () => ({ downloadTextFile: vi.fn() }))

const JAN = '2026-02-12T00:00:00+00:00'
const MAY = '2026-05-13T00:00:00+00:00'
const AUG = '2026-08-06T00:00:00+00:00'
const OCT = '2026-10-10T00:00:00+00:00'

function whole(): ClimateTrendsResponse {
  return {
    companyId: 'c1',
    groupBy: null,
    surveys: [
      { surveyId: 's1', title: 'Q1', status: 'closed', endDate: JAN, completedCount: 24, isSuppressed: false },
      { surveyId: 's2', title: 'Q2', status: 'closed', endDate: MAY, completedCount: 24, isSuppressed: false },
      { surveyId: 's3', title: 'Q3', status: 'closed', endDate: AUG, completedCount: 24, isSuppressed: false },
    ],
    dimensions: [
      { key: 'belonging', surveyCount: 3 },
      { key: 'workload', surveyCount: 3 },
    ],
    groups: [
      {
        key: '__company__',
        label: null,
        points: [
          { surveyId: 's1', respondentCount: 24, isSuppressed: false, scores: [3.3, 2.8] },
          { surveyId: 's2', respondentCount: 24, isSuppressed: false, scores: [3.7, 3.0] },
          { surveyId: 's3', respondentCount: 24, isSuppressed: false, scores: [4.0, 3.3] },
        ],
      },
    ],
    suppressedGroupCount: 0,
    minimumGroupSize: 5,
    generatedAt: AUG,
  }
}

function byDepartment(): ClimateTrendsResponse {
  return {
    ...whole(),
    groupBy: 'department',
    groups: [
      {
        key: 'd-fin',
        label: 'Finanzas',
        points: [
          { surveyId: 's1', respondentCount: 6, isSuppressed: false, scores: [3.1, 2.9] },
          { surveyId: 's2', respondentCount: 0, isSuppressed: true, scores: [null, null] },
          { surveyId: 's3', respondentCount: 7, isSuppressed: false, scores: [3.9, 3.9] },
        ],
      },
    ],
    suppressedGroupCount: 0,
  }
}

/** The same window with an archived rehearsal copy as its newest wave, as the real API sends it. */
function withArchivedCopy(payload: ClimateTrendsResponse): ClimateTrendsResponse {
  return {
    ...payload,
    surveys: [
      ...payload.surveys,
      { surveyId: 'copy', title: 'Q4 (Copy)', status: 'archived', endDate: OCT, completedCount: 1, isSuppressed: true },
    ],
    groups: payload.groups.map((group) => ({
      ...group,
      points: [...group.points, { surveyId: 'copy', respondentCount: 0, isSuppressed: true, scores: [null, null] }],
    })),
  }
}

const OPEN: SurveyListItem = {
  id: 's4',
  title: 'Q4',
  companyId: 'c1',
  type: 'periodic',
  status: 'active',
  language: 'es',
  startDate: '2026-09-03T00:00:00Z',
  endDate: OCT,
  responseCount: 3,
  targetAudienceCount: 24,
  questionCount: 6,
  createdAt: '2026-09-03T00:00:00Z',
}

function renderAt(role: string, companyId: string | undefined = 'c1') {
  setToken(tokenFor(companyId === undefined ? { role } : { role, companyId }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/surveys/climate-trends']}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/surveys/climate-trends" element={<ClimateTrendsNextPage />} />
            <Route path="/dashboard" element={<div data-testid="home" />} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function tile(label: string): HTMLElement {
  const tiles = [...document.querySelectorAll<HTMLElement>('[data-slot="kpi-tile"]')]
  const found = tiles.find((candidate) => candidate.textContent?.startsWith(label))
  if (!found) throw new Error(`no tile labelled ${label}: ${tiles.map((t) => t.textContent).join(' | ')}`)
  return found
}

function cardOrder(): string[] {
  return [...document.querySelectorAll('[data-slot="trend-card"]')].map((card) => card.getAttribute('data-dimension') ?? '')
}

describe('ClimateTrendsNextPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('preferredLocale', 'en')
    vi.mocked(getClimateTrends).mockReset()
    vi.mocked(getClimateTrends).mockImplementation(async (_base, query) =>
      query?.groupBy === 'department' ? byDepartment() : whole(),
    )
    vi.mocked(listSurveys).mockReset()
    vi.mocked(listSurveys).mockResolvedValue([OPEN])
    vi.mocked(downloadTextFile).mockReset()
  })
  afterEach(() => {
    cleanup()
    clearToken()
    window.localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  })

  it('draws one chart per dimension from the real payload, judged against the target, with the table below', async () => {
    renderAt('company_admin')
    await waitFor(() => expect(document.querySelectorAll('[data-slot="trend-card"]')).toHaveLength(2))
    const belonging = document.querySelector('[data-slot="trend-card"][data-dimension="belonging"]')
    const workload = document.querySelector('[data-slot="trend-card"][data-dimension="workload"]')
    expect(belonging?.getAttribute('data-standing')).toBe('above')
    expect(workload?.getAttribute('data-standing')).toBe('below')
    expect(within(belonging as HTMLElement).getByRole('img').getAttribute('aria-label')).toContain('3.3 → 3.7 → 4.0')
    // Both trends requests carried the resolved company, and the department breakdown was asked for.
    expect(vi.mocked(getClimateTrends).mock.calls.map(([, query]) => [query?.companyId, query?.groupBy])).toEqual([
      ['c1', undefined],
      ['c1', 'department'],
    ])
    // The open survey is asked of the tenant, by status.
    expect(vi.mocked(listSurveys).mock.calls.map(([, filters]) => filters)).toEqual([{ companyId: 'c1', status: 'active' }])
    // The accessible table keeps every closed survey as a row.
    const table = screen.getByRole('table')
    expect(screen.getByRole('heading', { name: copy.tableHeading })).toBeTruthy()
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 3 + 1)
    // The target is CLIMATE_TARGET, as on the Panel de Control: no sample chip.
    expect(screen.queryByText(en.dashboard.next.sampleChip)).toBeNull()
    // The artboard's one footnote: the floor's rule, and that the whole company is never under it.
    const footnote = document.querySelector('[data-slot="trends-footnote"]') as HTMLElement
    expect(footnote.textContent).toBe(`${copy.floorNote.replace('{floor}', '5')} ${copy.companyNeverWithheld}`)
  })

  /**
   * The measured defect: the real API answers with the closed AND archived window, and the
   * first cut read an archived rehearsal copy as the latest survey — the CLIMA tile said
   * "Clima · Encuesta de Clima Q4 (abierta) (Copia)" over an em dash, the closed count said
   * 4, and every chart grew a withheld fourth point.
   */
  it('never counts an archived survey: the tiles, the charts and the table read the closed waves only', async () => {
    vi.mocked(getClimateTrends).mockImplementation(async (_base, query) =>
      withArchivedCopy(query?.groupBy === 'department' ? byDepartment() : whole()),
    )
    renderAt('company_admin')
    await waitFor(() => expect(document.querySelectorAll('[data-slot="trend-card"]')).toHaveLength(2))
    const climate = tile(copy.climateLabel.replace('{wave}', 'Q3'))
    // (4.0 + 3.3) / 2 = 3.65, the latest CLOSED wave's mean — never the copy's em dash.
    expect(climate.textContent).toContain('3.65')
    const closed = tile(copy.closedLabel)
    expect(closed.textContent).toContain('Q1 · Q2 · Q3')
    expect(document.body.textContent).not.toContain('Copy')
    expect(document.querySelectorAll('[data-slot="trend-withheld"]')).toHaveLength(0)
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(1 + 3 + 1)
  })

  it('reads the climate average and its moves from the payload, and names the open survey that joins next', async () => {
    renderAt('company_admin')
    await waitFor(() => expect(document.querySelectorAll('[data-slot="trend-card"]')).toHaveLength(2))
    const climate = tile(copy.climateLabel.replace('{wave}', 'Q3'))
    const moves = climate.querySelector('[data-slot="climate-moves"]')?.textContent ?? ''
    // 3.65 − (3.7 + 3.0) / 2 = +0.30 against Q2; 3.65 − (3.3 + 2.8) / 2 = +0.60 against Q1.
    expect(moves).toContain(`+0.30 ${copy.climateVs.replace('{wave}', 'Q2')}`)
    expect(moves).toContain(`+0.60 ${copy.climateVs.replace('{wave}', 'Q1')}`)
    expect(tile(copy.closedLabel).querySelector('[data-slot="open-wave"]')?.textContent).toBe(
      copy.openEnters.replace('{wave}', 'Q4').replace('{date}', 'Oct 10'),
    )
    // The one dimension under the target rose since Q2, and the tile says so.
    expect(tile(copy.belowLabel).textContent).toContain(copy.risingOne)
  })

  it('names only an ACTIVE survey in the open-survey sentence, whatever else the list holds', async () => {
    // A draft closing sooner than the open Q4. The request asks for `status=active`, but
    // the sentence must not depend on the server honouring the filter: a draft is not a
    // wave anyone is answering.
    const draft: SurveyListItem = { ...OPEN, id: 's9', title: 'Q9', status: 'draft', endDate: '2026-09-20T00:00:00Z' }
    vi.mocked(listSurveys).mockResolvedValue([draft, OPEN])
    renderAt('company_admin')
    await waitFor(() => expect(document.querySelector('[data-slot="open-wave"]')).not.toBeNull())
    const sentence = (document.querySelector('[data-slot="open-wave"]') as HTMLElement).textContent ?? ''
    expect(sentence).toContain('Q4')
    expect(sentence).not.toContain('Q9')
  })

  it('loses only the open-survey sentence when the survey list cannot be read', async () => {
    vi.mocked(listSurveys).mockRejectedValue(new Error('Request failed: 500'))
    renderAt('company_admin')
    await waitFor(() => expect(document.querySelectorAll('[data-slot="trend-card"]')).toHaveLength(2))
    expect(document.querySelector('[data-slot="open-wave"]')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('draws every chart on one axis, so two slopes side by side are on the same scale', async () => {
    renderAt('company_admin')
    await waitFor(() => expect(document.querySelectorAll('[data-slot="trend-card"]')).toHaveLength(2))
    const axes = [...document.querySelectorAll('[data-slot="trend-card"]')].map((card) =>
      [...card.querySelectorAll('[data-slot="trend-tick"]')].map((tick) => tick.textContent),
    )
    // Belonging alone would label 3.5–4.5 and workload alone 3.0–4.0. Shared, both label the
    // canvas's 3.0–4.5: the domain reaches down to 2.5 for workload's 2.8, but the floor is
    // room for a point, not a reading, and carries no label.
    expect(axes).toEqual([
      ['3.0', '3.5', '4.0', '4.5'],
      ['3.0', '3.5', '4.0', '4.5'],
    ])
  })

  it("orders the charts by the whole company's latest reading, and keeps that order for a department", async () => {
    const reversed = (payload: ClimateTrendsResponse): ClimateTrendsResponse => ({
      ...payload,
      dimensions: [...payload.dimensions].reverse(),
      groups: payload.groups.map((group) => ({
        ...group,
        points: group.points.map((point) => ({ ...point, scores: [...point.scores].reverse() })),
      })),
    })
    vi.mocked(getClimateTrends).mockImplementation(async (_base, query) =>
      reversed(query?.groupBy === 'department' ? byDepartment() : whole()),
    )
    renderAt('company_admin')
    await waitFor(() => expect(document.querySelectorAll('[data-slot="trend-card"]')).toHaveLength(2))
    // The server sends workload first; the company's belonging (4.0) outranks it (3.3).
    expect(cardOrder()).toEqual(['belonging', 'workload'])
    await userEvent.click(within(screen.getByRole('group', { name: copy.breakDownBy })).getByRole('button', { name: 'Finanzas' }))
    expect(cardOrder()).toEqual(['belonging', 'workload'])
  })

  it('redraws from the department series when a segment is chosen, keeping the withheld wave withheld', async () => {
    renderAt('company_admin')
    await waitFor(() => expect(document.querySelectorAll('[data-slot="trend-card"]')).toHaveLength(2))
    const group = screen.getByRole('group', { name: copy.breakDownBy })
    const finance = within(group).getByRole('button', { name: 'Finanzas' })
    expect(finance.getAttribute('aria-pressed')).toBe('false')
    await userEvent.click(finance)
    expect(finance.getAttribute('aria-pressed')).toBe('true')
    const belonging = document.querySelector('[data-slot="trend-card"][data-dimension="belonging"]') as HTMLElement
    expect(within(belonging).getByRole('img').getAttribute('aria-label')).toContain(`3.1 → ${copy.withheld} → 3.9`)
    expect(belonging.querySelectorAll('[data-slot="trend-withheld"]')).toHaveLength(1)
    // Q2 is withheld for Finanzas: no "since Q2" delta (it would reconstruct Q2), while
    // "since Q1" spans the withheld wave from two disclosed readings and is printed.
    expect(within(belonging).queryByText(copy.sinceWave.replace('{wave}', 'Q2'))).toBeNull()
    expect(within(belonging).getByText(copy.sinceWave.replace('{wave}', 'Q1'))).toBeTruthy()
    expect(within(belonging).getByText('+0.8')).toBeTruthy()
    // The table's counts are the department's own, and the withheld wave prints none.
    const rows = within(screen.getByRole('table')).getAllByRole('row')
    expect(rows[1].textContent).toContain('6 resp.')
    expect(rows[2].textContent).not.toContain('resp.')
    // No second request: the department series was already in hand.
    expect(vi.mocked(getClimateTrends)).toHaveBeenCalledTimes(2)
  })

  /**
   * The guarantees `/surveys/climate-trends` kept when the redesign took the route over
   * from `ClimateTrendsPage` (its test still pins the old grid, rendered directly).
   */
  it('sends the chosen company on every request once a super admin has selected one', async () => {
    window.localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'company-9')
    renderAt('super_admin', undefined)
    await waitFor(() => expect(document.querySelectorAll('[data-slot="trend-card"]')).toHaveLength(2))
    expect(vi.mocked(getClimateTrends).mock.calls.map(([, query]) => query)).toEqual([
      { companyId: 'company-9', lang: 'en' },
      { companyId: 'company-9', lang: 'en', groupBy: 'department' },
    ])
    expect(vi.mocked(listSurveys).mock.calls.map(([, filters]) => filters)).toEqual([
      { companyId: 'company-9', status: 'active' },
    ])
  })

  it('recovers from a failed load without a reload', async () => {
    vi.mocked(getClimateTrends).mockRejectedValueOnce(new Error('Request failed: 500'))
    renderAt('company_admin')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Request failed: 500')
    await userEvent.click(screen.getByRole('button', { name: en.common.retry }))
    await waitFor(() => expect(document.querySelectorAll('[data-slot="trend-card"]')).toHaveLength(2))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('offers an empty state, not a broken grid, when no survey has closed', async () => {
    vi.mocked(getClimateTrends).mockImplementation(async () => ({ ...whole(), surveys: [], dimensions: [], groups: [] }))
    renderAt('company_admin')
    expect(await screen.findByText(en.surveys.climateTrends.noSurveysTitle)).toBeTruthy()
    expect(document.querySelectorAll('[data-slot="trend-card"]')).toHaveLength(0)
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('keeps a wave the floor withheld off the chart and out of the table, whatever the payload carries', async () => {
    // The guard is `isSuppressed`, not an absent score: a payload that carried the
    // figures anyway must still print none of them — not the 3.0, not the 3 respondents.
    const withheld = whole()
    withheld.groups[0].points[0] = { surveyId: 's1', respondentCount: 3, isSuppressed: true, scores: [3.0, 3.0] }
    vi.mocked(getClimateTrends).mockImplementation(async (_base, query) =>
      query?.groupBy === 'department' ? byDepartment() : withheld,
    )
    renderAt('company_admin')
    await waitFor(() => expect(document.querySelectorAll('[data-slot="trend-card"]')).toHaveLength(2))
    const belonging = document.querySelector('[data-slot="trend-card"][data-dimension="belonging"]') as HTMLElement
    expect(within(belonging).getByRole('img').getAttribute('aria-label')).toContain(`${copy.withheld} → 3.7 → 4.0`)
    expect(belonging.querySelectorAll('[data-slot="trend-withheld"]')).toHaveLength(1)
    expect([...belonging.querySelectorAll('[data-slot="trend-value"]')].map((value) => value.textContent)).not.toContain('3.0')
    const table = screen.getByRole('table')
    const row = within(table).getAllByRole('row').find((candidate) => within(candidate).queryByText('Q1'))
    expect(row).toBeTruthy()
    // Both cells protected; the row names the wave and its date, and prints no reading and no count.
    expect(within(row as HTMLElement).getAllByRole('img')).toHaveLength(2)
    expect(row?.textContent).not.toMatch(/\d\.\d/)
    expect(row?.textContent).not.toContain('resp.')
    // And the Q1 → Q3 move is not printed from a withheld end.
    const moves = table.querySelector('[data-slot="trends-move-row"]') as HTMLElement
    expect(moves.textContent).not.toMatch(/[+−-]\d/)
  })

  it('sends a leader to their own dashboard and asks a super admin to choose a company', async () => {
    renderAt('leader')
    expect(await screen.findByTestId('home')).toBeTruthy()
    expect(vi.mocked(getClimateTrends)).not.toHaveBeenCalled()
    expect(vi.mocked(listSurveys)).not.toHaveBeenCalled()
    cleanup()
    renderAt('super_admin', undefined)
    expect(await screen.findByText(en.companyContext.chooseACompany)).toBeTruthy()
    expect(vi.mocked(getClimateTrends)).not.toHaveBeenCalled()
  })

  it('says the whole company is never under the floor only while that is true of every wave shown', async () => {
    vi.mocked(getClimateTrends).mockImplementation(async (_base, query) => {
      if (query?.groupBy === 'department') return byDepartment()
      const payload = whole()
      return {
        ...payload,
        groups: payload.groups.map((group) => ({
          ...group,
          points: group.points.map((point, index) =>
            index === 0 ? { ...point, respondentCount: 0, isSuppressed: true, scores: [null, null] } : point,
          ),
        })),
      }
    })
    renderAt('company_admin')
    await waitFor(() => expect(document.querySelector('[data-slot="trends-footnote"]')).not.toBeNull())
    const footnote = document.querySelector('[data-slot="trends-footnote"]') as HTMLElement
    expect(footnote.textContent).toBe(copy.floorNote.replace('{floor}', '5'))
    // And no "group(s)": the count sentence the artboard does not have is gone from the page.
    expect(document.body.textContent).not.toContain('(s)')
  })

  it('exports the table as shown: the drawn group, readings as printed, and a withheld wave as the word, never a number', async () => {
    renderAt('company_admin')
    await waitFor(() => expect(document.querySelectorAll('[data-slot="trend-card"]')).toHaveLength(2))
    await userEvent.click(screen.getByRole('button', { name: copy.export }))
    expect(vi.mocked(downloadTextFile)).toHaveBeenCalledTimes(1)
    const [fileName, mime, contents] = vi.mocked(downloadTextFile).mock.calls[0]
    expect(fileName).toBe(`${copy.exportFileName}.csv`)
    expect(mime).toContain('text/csv')
    expect(contents.split('\r\n')[1]).toBe(`${copy.wholeCompany},Q1,2026-02-12,24,3.3,2.8`)
    // Finanzas is withheld in Q2: the file says so in every cell of that row, count included.
    await userEvent.click(screen.getByRole('button', { name: 'Finanzas' }))
    await userEvent.click(screen.getByRole('button', { name: copy.export }))
    const finanzas = vi.mocked(downloadTextFile).mock.calls[1][2].split('\r\n')
    expect(finanzas[2]).toBe(`Finanzas,Q2,2026-05-13,${copy.withheld},${copy.withheld},${copy.withheld}`)
  })
})
