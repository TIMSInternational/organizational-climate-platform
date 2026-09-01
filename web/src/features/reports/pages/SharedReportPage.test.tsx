import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import SharedReportPage from './SharedReportPage'
import { TranslationProvider, useTranslation } from '../../../i18n'
import { setToken } from '../../../auth/token'
import { buildNavSections, leafNavItems } from '../../../navigation/navSections'
import type { Locale } from '../../../i18n'

/**
 * A report document as `ReportGeneration` produces one: two surveys, one of them below
 * the disclosure floor, and one withheld department inside the other.
 *
 * Built the way production builds it — a JSON **string** in `reportOutput`, because that
 * is what `reports.report_output` is and what `ReportDetail` hands back. A fixture that
 * nested the object would exercise a wire shape this API does not have.
 */
function reportBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Informe de clima Q3',
    description: 'Cómo respondió la organización entre julio y agosto.',
    type: 'summary',
    // 02:00Z on the first of August. Deliberately in the small hours: the same instant
    // is 20:00 on the *thirty-first of July* in America/Costa_Rica, so the UTC rule this
    // page follows and a bare `toLocaleDateString` disagree about which day it is.
    generatedAt: '2026-08-01T02:00:00Z',
    reportOutput: JSON.stringify({
      generationNote: '',
      surveys: [
        {
          surveyId: 's1',
          title: 'Encuesta de clima Q3',
          status: 'closed',
          resolvedLocale: 'es',
          questions: [
            {
              questionId: 'q1',
              order: 0,
              type: 'open_ended',
              text: '¿Algo más que quieras contarnos?',
              category: 'open',
              answeredCount: 9,
              distribution: [],
              average: null,
              median: null,
              scaleMin: null,
              scaleMax: null,
              scaleLabelMin: null,
              scaleLabelMax: null,
              // A frequency map, floored server-side. This is the whole of the open-text
              // surface that reaches an unauthenticated reader.
              words: [{ language: 'es', word: 'carga', count: 9, responseCount: 6 }],
              suppressedWordCount: 4,
            },
          ],
          demographics: [
            {
              dimension: 'antigüedad',
              segments: [
                {
                  key: '2-5',
                  label: '2-5 años',
                  respondentCount: 9,
                  isSuppressed: false,
                  dimensions: [{ dimension: 'recognition', averageScore: 4.2 }],
                },
                {
                  key: '0-1',
                  label: 'Menos de un año',
                  respondentCount: 0,
                  isSuppressed: true,
                  dimensions: [],
                },
              ],
              suppressedSegmentCount: 1,
              suppressedRespondentCount: 3,
              unsegmentedRespondentCount: 0,
            },
          ],
          participation: {
            invitedCount: 248,
            responseCount: 187,
            completedCount: 175,
            partialCount: 12,
            participationRate: 70.6,
            completionRate: 93.58,
            averageCompletionSeconds: 486,
            firstResponseAt: '2026-07-06T08:12:00Z',
            lastResponseAt: '2026-07-24T18:40:00Z',
            byLanguage: [{ language: 'es', count: 118 }],
          },
          dimensions: [
            {
              dimension: 'psychological_safety',
              questionCount: 4,
              answeredCount: 170,
              averageScore: 3.9,
            },
          ],
          departments: [
            {
              departmentId: 'd1',
              name: 'Operaciones',
              respondentCount: 42,
              participationRate: 84,
              isSuppressed: false,
            },
            {
              departmentId: 'd2',
              name: 'Dirección',
              respondentCount: 0,
              participationRate: null,
              isSuppressed: true,
            },
          ],
          suppressedDepartmentCount: 1,
          suppressedRespondentCount: 3,
          unsegmentedRespondentCount: 2,
          isSuppressed: false,
          suppressionReason: null,
          minimumGroupSize: 5,
        },
        {
          surveyId: 's2',
          title: 'Microclima de Dirección',
          status: 'closed',
          resolvedLocale: 'es',
          questions: [],
          demographics: [],
          participation: {
            invitedCount: 6,
            responseCount: 4,
            completedCount: 4,
            partialCount: 0,
            participationRate: 66.7,
            completionRate: 100,
            averageCompletionSeconds: null,
            firstResponseAt: null,
            lastResponseAt: null,
            byLanguage: [],
          },
          dimensions: [],
          departments: [],
          suppressedDepartmentCount: 0,
          suppressedRespondentCount: 4,
          unsegmentedRespondentCount: 0,
          isSuppressed: true,
          suppressionReason: 'below_minimum_respondents',
          minimumGroupSize: 5,
        },
      ],
      benchmarks: [
        {
          benchmarkId: 'b1',
          name: 'Compromiso 2026',
          category: 'engagement',
          type: 'industry',
          companyId: 'c1',
          priorPeriodStatus: 'linked',
          metrics: [
            { id: 'm1', metricName: 'engagement', value: 74, unit: 'percent', percentile: null, sampleSize: null },
          ],
          priorPeriod: {
            id: 'b0',
            name: 'Compromiso 2025',
            metrics: [
              {
                metricName: 'engagement',
                value: 74,
                unit: 'percent',
                priorValue: 70,
                priorUnit: 'percent',
                delta: 4,
                changeRatio: 4 / 70,
              },
            ],
          },
        },
      ],
      aiInsights: [
        {
          id: 'i1',
          type: 'risk',
          category: 'workload',
          title: 'La carga percibida subió en Operaciones',
          description: 'Dos puntos por encima del trimestre anterior.',
          confidenceScore: 87,
          priority: 'high',
          affectedSegments: ['Dirección'],
          recommendedActions: ['Revisar la distribución de turnos'],
          isAcknowledged: false,
        },
      ],
    }),
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

/** Exposes `setLocale` so a test can switch language the way the picker does. */
let switchLocale: (locale: Locale) => void = () => {}

function LocaleHandle() {
  const { setLocale } = useTranslation()
  switchLocale = setLocale
  return null
}

function renderPage(token = 'sh4r3d-t0k3n') {
  return render(
    <TranslationProvider initialLocale="es">
      <LocaleHandle />
      <MemoryRouter initialEntries={[`/shared/reports/${token}`]}>
        <Routes>
          <Route path="/shared/reports/:token" element={<SharedReportPage />} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

describe('SharedReportPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    for (const tag of document.querySelectorAll('meta[name="robots"]')) tag.remove()
    vi.unstubAllGlobals()
  })

  it('renders a shared report with no session at all', async () => {
    expect(window.localStorage.getItem('climate_platform_token')).toBeNull()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(reportBody()))

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Informe de clima Q3' })).toBeTruthy()
    expect(screen.getByText('Cómo respondió la organización entre julio y agosto.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Encuesta de clima Q3' })).toBeTruthy()
    // The participation reading, as rendered — not the number that produced it.
    expect(screen.getByText('175')).toBeTruthy()
    expect(screen.getByText('Seguridad psicológica')).toBeTruthy()
    expect(screen.getByText('Revisar la distribución de turnos')).toBeTruthy()

    // The three sections #88 added, through the fetch and the parser rather than by
    // handing the component an object: a word cloud that is frequencies only and says
    // how many words it withheld, a demographic group withheld in the ProtectedCell
    // grammar, and a benchmark's year-over-year reading.
    expect(screen.getByText('carga')).toBeTruthy()
    expect(screen.getByText(/4 palabras quedan reservadas/)).toBeTruthy()
    expect(screen.getByRole('img', { name: /Menos de un año: protegido/i })).toBeTruthy()
    expect(screen.getByText('Comparado con Compromiso 2025.')).toBeTruthy()
  })

  /**
   * The suppression rules, read off the screen rather than off the payload.
   *
   * Survey `s2` is below the floor, so its scores are replaced by the same notice the
   * authenticated results page shows. Department `d2` inside `s1` is withheld, so its
   * row survives and reads "Reservado" — a row that vanished would let the reader work
   * out which department is missing from a list they can see elsewhere.
   */
  it('renders suppression rather than eliding it', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(reportBody()))

    renderPage()
    await screen.findByRole('heading', { name: 'Informe de clima Q3' })

    // The floor is stated, with the company's own minimum in it.
    expect(screen.getByText('Los resultados por pregunta están reservados')).toBeTruthy()
    expect(
      screen.getByText(/Menos de 5 personas han completado esta encuesta/),
    ).toBeTruthy()

    // The withheld department keeps its name and its row, and shows no figure.
    const row = screen.getByText('Dirección').closest('tr')
    expect(row).toBeTruthy()
    expect(row?.textContent).toContain('Reservado')
    // The one number that must not be anywhere in that row is the headcount behind it.
    expect(row?.textContent).not.toContain('3')

    // And the count of withheld departments is stated, so the totals still reconcile.
    expect(screen.getByText(/Se reservan 1 departamento/)).toBeTruthy()
  })

  /**
   * The acceptance criterion, asserted on the rendered page rather than on the client.
   *
   * Three causes a real deployment produces, compared as **rendered HTML**. Any branch
   * that reached for a status, a `reason` or the server's message would separate them.
   */
  it('renders expired, revoked and invalid identically', async () => {
    const outcomes: string[] = []

    for (const response of [
      jsonResponse({ message: 'Report not found' }, 404),
      jsonResponse({ message: 'This link was revoked', reason: 'revoked' }, 410),
      jsonResponse({ message: 'This link expired', reason: 'expired' }, 410),
      jsonResponse({ message: 'Forbidden' }, 403),
    ]) {
      vi.mocked(fetch).mockResolvedValueOnce(response)
      const view = renderPage()
      await screen.findByRole('alert')
      outcomes.push(view.container.innerHTML)
      cleanup()
    }

    for (const outcome of outcomes) expect(outcome).toBe(outcomes[0])
    expect(outcomes[0]).toContain('Este informe no está disponible')

    // And not one word the server said reaches the page — neither its sentences nor its
    // machine-readable reason codes. (The page's own copy names all three causes at once
    // without claiming any of them, which is the point: it reads the same whichever
    // happened.)
    for (const leak of [
      'This link was revoked',
      'This link expired',
      'Report not found',
      'Forbidden',
      '"revoked"',
      '"expired"',
    ]) {
      expect(outcomes[0]).not.toContain(leak)
    }
  })

  /**
   * `noindex` is the fourth acceptance criterion. It is asserted on the document the
   * page actually produced, and asserted to be gone afterwards: a router transition does
   * not reload the document, so a tag left behind would apply to every later page in the
   * tab and only a crawler would ever see it.
   */
  it('asks crawlers not to index the page, and cleans up after itself', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(reportBody()))

    const view = renderPage()
    await screen.findByRole('heading', { name: 'Informe de clima Q3' })

    const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]')
    expect(robots?.getAttribute('content')).toContain('noindex')

    view.unmount()

    expect(document.querySelector('meta[name="robots"]')).toBeNull()
  })

  it('sets noindex even for a report that failed to load', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: 'nope' }, 404))

    renderPage()
    await screen.findByRole('alert')

    expect(
      document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.getAttribute('content'),
    ).toContain('noindex')
  })

  /**
   * "No authenticated navigation exposed", asserted **with a session in storage** —
   * because that is the case that would fail. An administrator opening a share link in
   * the browser they administer in must get the same page a board member gets.
   */
  it('exposes no route into the application, even to a signed-in reader', async () => {
    setToken('admin-session-token')
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(reportBody()))

    const view = renderPage()
    await screen.findByRole('heading', { name: 'Informe de clima Q3' })

    // No anchors at all: not the sidebar, not a "back to dashboard", not a sign-in
    // prompt. `RespondShell` carries a skip link, which targets an id on this page
    // rather than a route.
    const hrefs = [...view.container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '')
    expect(hrefs.filter((href) => !href.startsWith('#'))).toEqual([])

    // Nor any of the shell's own furniture.
    expect(view.container.querySelector('nav')).toBeNull()
    expect(view.container.querySelector('[data-slot="company-context-switcher"]')).toBeNull()
    expect(view.container.querySelector('[data-slot="sidebar-user-menu"]')).toBeNull()
  })

  /**
   * The other half of the same criterion: the role-aware nav must never offer this
   * route. `navSections.ts` is built from JWT claims, so an entry here would appear in
   * the sidebar of whichever role got it — advertising a public URL from inside the
   * product, which is how a share token ends up in a screenshot.
   */
  it('is offered by no role in the navigation', () => {
    for (const role of ['super_admin', 'company_admin', 'leader', 'supervisor', 'employee']) {
      const items = leafNavItems(buildNavSections(role, 'c1', { trackingEnabled: true }))
      expect(items.filter((item) => item.href.startsWith('/shared'))).toEqual([])
    }
  })

  /**
   * One visit is one access-log entry (#143).
   *
   * A page that re-resolved on a language switch would file one reader as several, and
   * the audit trail for "who read this report" would be counting clicks on a toggle. The
   * UI does change language — the assertion below shows it — while the token is resolved
   * exactly once.
   */
  it('resolves the token once per visit, including across a language switch', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(reportBody()))

    renderPage()
    await screen.findByRole('heading', { name: 'Informe de clima Q3' })
    expect(fetch).toHaveBeenCalledTimes(1)

    await act(async () => {
      switchLocale('en')
    })

    // The chrome followed the reader into English...
    await waitFor(() => expect(screen.getByText('Generated')).toBeTruthy())
    // ...and no second read was filed against the report.
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('sends the reader’s locale so authored content resolves in their language', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(reportBody()))

    renderPage()
    await screen.findByRole('heading', { name: 'Informe de clima Q3' })

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      'undefined/shared/reports/sh4r3d-t0k3n?lang=es',
    )
  })

  it('says so plainly when the report carries no document yet', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(reportBody({ reportOutput: null })))

    renderPage()

    expect(await screen.findByText('Este informe todavía no tiene contenido.')).toBeTruthy()
  })

  /**
   * `generationNote` is server-authored English naming the sections the generator has
   * not built. Printing it verbatim would put a developer sentence in front of a
   * Costa Rican reader; its *presence* is the fact worth passing on, translated.
   */
  /**
   * The generated day, read in UTC.
   *
   * `calendarDay` exists because `Report.GenerationCompletedAt` is rendered as a
   * calendar day and `new Date(iso).toLocaleDateString()` moves it: every zone west of
   * UTC lands on the day before, and every reader this product has is west of UTC. The
   * locale-switch test asserts the *label* `Generated`; nothing asserted the value, so
   * the page could go back to printing `31/7/2026` for a report generated on the first
   * of August with the whole suite green.
   *
   * Both halves are pinned: the day itself, and the short human form the design writes
   * dates in rather than the numeric one every bare `toLocaleDateString` produces.
   */
  it('prints the generated day in UTC, in the form the product writes dates', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(reportBody()))

    renderPage()
    await screen.findByRole('heading', { name: 'Informe de clima Q3' })

    expect(screen.getByText(/^1 ago/)).toBeTruthy()
    // Neither the day before (the zone bug) nor the numeric shape (the format drift).
    expect(screen.queryByText(/31\/7/)).toBeNull()
    expect(screen.queryByText(/1\/8\/2026/)).toBeNull()
  })

  /**
   * One situation, one face.
   *
   * `LinkOutcome` is the product's existing end-of-a-dead-link component, and its own
   * docblock argues that a single situation must not "have two faces depending on which
   * route reached it" — it renders a decorative `Info` glyph in a `warning` alert with
   * `role="alert"`. A visitor who followed a dead share link and one who followed a dead
   * invitation are the same person having the same experience, and this notice was the
   * only one of the two without the glyph. Measured in the PNG, not inferable from any
   * assertion that existed.
   */
  it('gives a dead share link the same face as a dead survey link', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: 'nope' }, 404))

    renderPage()
    const notice = await screen.findByRole('alert')

    const glyph = notice.querySelector('svg')
    expect(glyph).toBeTruthy()
    // Decorative: the sentence beside it already says everything the glyph does, and a
    // second announcement of the same fact is noise on a page read by somebody who
    // arrived here by accident.
    expect(glyph?.getAttribute('aria-hidden')).toBe('true')
  })

  it('reports an incomplete document without printing the English note', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        reportBody({
          reportOutput: JSON.stringify({
            generationNote: 'Aggregation, comparisons and export are not implemented yet.',
            surveys: [],
            aiInsights: [],
          }),
        }),
      ),
    )

    renderPage()

    expect(await screen.findByText('Este informe no está completo')).toBeTruthy()
    expect(screen.queryByText(/not implemented yet/)).toBeNull()
  })
})
