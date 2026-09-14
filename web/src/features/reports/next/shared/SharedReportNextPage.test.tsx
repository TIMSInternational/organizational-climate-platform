import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import SharedReportNextPage from './SharedReportNextPage'
import { TranslationProvider, useTranslation, type Locale } from '../../../../i18n'
import { setToken } from '../../../../auth/token'

/**
 * `/shared/reports/:token`, tested the way the page is actually reached: a `fetch`
 * answered with the wire shape `GET /shared/reports/{token}` returns, through
 * `getSharedReport` and `parseReportDocument` and into the rendered DOM.
 *
 * ## Why every fixture here is hostile
 *
 * This route has leaked before — a shared report link put a suppressed team's open text on
 * an anonymous page, and only an integration run caught it; unit tests did not. So the
 * document below carries, deliberately, every figure the floor exists to hide and every
 * field the public projection withholds: a suppressed department with its real headcount
 * and rate, a suppressed demographic group with its real scores, an insight naming a group
 * that is nowhere else on the page, a question carrying verbatim answers, a "word" that is
 * a phrase, a benchmark carrying the tenant GUID and the prior period's row id.
 *
 * None of that reaches a browser from this server. `SurveyAggregation.cs:604`/`:677` zero
 * and empty a sub-floor group before anything is stored; `PublicReportProjection` drops
 * `SuppressedRespondentCount`, `AffectedSegments`, `CompanyId` and the prior period's `Id`
 * from the payload. Feeding the client only what the server sends would therefore test
 * the server. These tests exist to prove the client refuses it **anyway** — which is the
 * property that survives a generator regression, a hand-edited `report_output`, or a
 * document from a version of this product that had not made those decisions yet.
 */

/** The wire shape: `reportOutput` is a JSON **string**, because the column is TEXT. */
function reportBody(document: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    title: 'Informe ejecutivo de clima — Q3 2026',
    description: 'Resultados consolidados de las encuestas cerradas entre julio y agosto.',
    type: 'executive',
    generatedAt: '2026-08-01T02:00:00Z',
    reportOutput: JSON.stringify(document),
    ...overrides,
  }
}

const PARTICIPATION = {
  invitedCount: 248,
  responseCount: 187,
  completedCount: 175,
  partialCount: 12,
  participationRate: 70.6,
  completionRate: 93.58,
  averageCompletionSeconds: 486,
  firstResponseAt: null,
  lastResponseAt: null,
  byLanguage: [],
}

/** A survey section that is well-formed unless a test bends it. */
function survey(overrides: Record<string, unknown> = {}) {
  return {
    surveyId: 's1',
    title: 'Encuesta de clima organizacional Q3',
    status: 'closed',
    resolvedLocale: 'es',
    participation: PARTICIPATION,
    dimensions: [
      { dimension: 'psychological_safety', questionCount: 4, answeredCount: 170, averageScore: 3.9 },
      { dimension: 'workload', questionCount: 3, answeredCount: 168, averageScore: 3.1 },
    ],
    departments: [],
    suppressedDepartmentCount: 0,
    unsegmentedRespondentCount: 0,
    demographics: [],
    questions: [],
    isSuppressed: false,
    suppressionReason: null,
    minimumGroupSize: 5,
    ...overrides,
  }
}

function documentOf(surveys: unknown[], extra: Record<string, unknown> = {}) {
  return { generationNote: '', surveys, aiInsights: [], benchmarks: [], ...extra }
}

/**
 * The document that is trying to leak.
 *
 * Each planted value is picked so it can be searched for without colliding with anything
 * the page legitimately prints: `2,1` and `1,4` are scores no disclosed row carries,
 * `Equipo Legal` is a group named nowhere else, and the two sentences are English strings
 * this product would never render.
 */
function hostileDocument() {
  return documentOf(
    [
      survey({
        departments: [
          { departmentId: 'd1', name: 'Operaciones', respondentCount: 62, participationRate: 84.9, isSuppressed: false },
          {
            departmentId: 'd2',
            name: 'Dirección General',
            // The withheld headcount, and the rate one division recovers it from.
            respondentCount: 3,
            participationRate: 60,
            isSuppressed: true,
          },
        ],
        suppressedDepartmentCount: 1,
        suppressedRespondentCount: 3,
        demographics: [
          {
            dimension: 'antigüedad',
            segments: [
              {
                key: '2-5',
                label: 'Entre uno y cinco años',
                respondentCount: 88,
                isSuppressed: false,
                dimensions: [
                  { dimension: 'psychological_safety', averageScore: 4.0 },
                  { dimension: 'workload', averageScore: 3.3 },
                ],
              },
              {
                key: '10+',
                label: 'Más de diez años',
                respondentCount: 4,
                isSuppressed: true,
                // The withheld group's readings, carried in defiance of its own flag.
                dimensions: [
                  { dimension: 'psychological_safety', averageScore: 2.1 },
                  { dimension: 'workload', averageScore: 1.4 },
                ],
              },
            ],
            suppressedSegmentCount: 1,
            suppressedRespondentCount: 4,
            unsegmentedRespondentCount: 20,
          },
        ],
        questions: [
          {
            questionId: 'q1',
            order: 0,
            type: 'open_ended',
            text: '¿Qué cambiarías de tu experiencia de trabajo?',
            category: 'open',
            answeredCount: 96,
            distribution: [],
            average: null,
            median: null,
            scaleMin: null,
            scaleMax: null,
            scaleLabelMin: null,
            scaleLabelMax: null,
            // A verbatim-answers field this product has never had on the wire. The
            // parser copies four fields per word and nothing else, so it cannot arrive.
            responses: ['Mi jefe me gritó el martes delante del equipo'],
            words: [
              { language: 'es', word: 'turnos', count: 41, responseCount: 29 },
              // Not a word: a phrase. `reportDocument.ts` drops it and counts it as
              // withheld rather than splitting it back into tokens it never floored.
              { language: 'es', word: 'mi jefe grita', count: 9, responseCount: 7 },
            ],
            suppressedWordCount: 118,
          },
        ],
      }),
    ],
    {
      aiInsights: [
        {
          id: 'i1',
          type: 'risk',
          category: 'workload',
          title: 'La carga percibida subió',
          description: 'Dos puntos por encima del trimestre anterior.',
          confidenceScore: 87,
          priority: 'high',
          // A free list the insight generator wrote: it passes through none of the
          // aggregation that applies the floor, so it can name a group too small to keep
          // its own row. The projection withholds it; the parser does not copy it.
          affectedSegments: ['Equipo Legal'],
          recommendedActions: ['Revisar la distribución de turnos'],
          isAcknowledged: false,
        },
      ],
      benchmarks: [
        {
          benchmarkId: 'b1',
          name: 'Compromiso organizacional 2026',
          category: 'engagement',
          type: 'industry',
          // The tenant GUID. This is the field that made the withholding list exist.
          companyId: 'c0ffee00-tenant-guid',
          isGlobal: false,
          priorPeriodStatus: 'linked',
          metrics: [
            { id: 'm1', metricName: 'compromiso', value: 74.2, unit: 'percent', percentile: 68, sampleSize: 175 },
          ],
          priorPeriod: {
            // The linked benchmark's own row id, withheld from an authenticated caller
            // who may not read the row and further still from an anonymous one.
            id: 'b0-prior-row-id',
            name: 'Compromiso organizacional 2025',
            metrics: [
              {
                metricName: 'compromiso',
                value: 74.2,
                unit: 'percent',
                priorValue: 70.1,
                priorUnit: 'percent',
                delta: 4.1,
                changeRatio: 4.1 / 70.1,
              },
            ],
          },
        },
      ],
    },
  )
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
          <Route path="/shared/reports/:token" element={<SharedReportNextPage />} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

describe('SharedReportNextPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    for (const tag of window.document.querySelectorAll('meta[name="robots"]')) tag.remove()
    vi.unstubAllGlobals()
  })

  it('draws the report with no session at all', async () => {
    expect(window.localStorage.getItem('climate_platform_token')).toBeNull()
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(reportBody(hostileDocument())))

    renderPage()

    expect(
      await screen.findByRole('heading', { name: 'Informe ejecutivo de clima — Q3 2026' }),
    ).toBeTruthy()
    // The header's three chips: when it was generated, the floor that was applied, and
    // whether any open text is in the document at all.
    expect(screen.getByText(/^Generado el 1 ago/)).toBeTruthy()
    expect(screen.getByText('Umbral de 5 aplicado')).toBeTruthy()
    expect(screen.getByText('Texto libre: solo frecuencias')).toBeTruthy()
    // The three readings.
    expect(screen.getByText('187')).toBeTruthy()
    expect(screen.getByText('70,6 %')).toBeTruthy()
    expect(screen.getByText('de 4 legibles')).toBeTruthy()
    // The climate table, the map and the three standing promises.
    expect(screen.getByRole('heading', { name: 'Clima por dimensión' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Clima por grupo y dimensión' })).toBeTruthy()
    expect(screen.getByText('Qué no está aquí')).toBeTruthy()
    expect(
      screen.getByText(/Ninguna respuesta individual, ningún nombre, ningún identificador/),
    ).toBeTruthy()
  })

  /**
   * The refutation this page exists to survive.
   *
   * Every planted value is searched for in the rendered DOM as the reader's browser would
   * hold it. A failure here is the leak, not a styling nit.
   */
  it('publishes nothing the floor and the projection withhold, from a document that carries it all', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(reportBody(hostileDocument())))

    const view = renderPage()
    await screen.findByRole('heading', { name: 'Informe ejecutivo de clima — Q3 2026' })
    const text = view.container.textContent ?? ''
    const html = view.container.innerHTML

    // The withheld group's own readings.
    expect(text).not.toContain('2,1')
    expect(text).not.toContain('1,4')
    // A group the insight generator named, which passed through no floor at all.
    expect(html).not.toContain('Equipo Legal')
    // A verbatim answer, and a "word" that is really a phrase out of one.
    expect(html).not.toContain('Mi jefe me gritó')
    expect(html).not.toContain('mi jefe grita')
    // The tenant GUID and the prior period's row id.
    expect(html).not.toContain('c0ffee00-tenant-guid')
    expect(html).not.toContain('b0-prior-row-id')

    // The withheld department keeps its row and its name, and prints no figure in it —
    // neither the headcount nor the rate that recovers it.
    const row = screen.getByText('Dirección General').closest('tr')
    expect(row).toBeTruthy()
    expect(row?.textContent).toContain('Protegido')
    expect(row?.textContent).not.toContain('3')
    expect(row?.textContent).not.toContain('60')

    // The withheld demographic group keeps its row too, hatched in every cell.
    const mapRow = view.container.querySelector('[data-testid="map-row-10+"]')
    expect(mapRow?.textContent).toContain('Más de diez años')
    expect(mapRow?.querySelectorAll('[role="img"]').length).toBe(2)

    // And the counts of withheld groups ARE reported: "withheld" and "none" are
    // different statements, and a list quietly shortened reads as the whole of it.
    expect(screen.getByText(/Se reservan 1 departamento/)).toBeTruthy()
    expect(screen.getByText(/119 palabras/)).toBeTruthy()
  })

  /**
   * The suppressed-survey case, end to end.
   *
   * The section below the floor still carries its dimensions, its groups and its word
   * cloud in the payload. None of it may be drawn; the participation counters may.
   */
  it('renders a survey below the floor as a notice, not as scores', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        reportBody(
          documentOf([
            survey({
              surveyId: 's2',
              title: 'Microclima de Dirección General',
              isSuppressed: true,
              suppressionReason: 'below_minimum_respondents',
              participation: { ...PARTICIPATION, invitedCount: 6, responseCount: 4, completedCount: 4, participationRate: 66.7, completionRate: 100 },
              dimensions: [
                { dimension: 'psychological_safety', questionCount: 4, answeredCount: 4, averageScore: 2.2 },
              ],
              questions: [
                {
                  questionId: 'q9',
                  order: 0,
                  type: 'open_ended',
                  text: '¿Algo más?',
                  category: 'open',
                  answeredCount: 4,
                  distribution: [],
                  average: null,
                  median: null,
                  scaleMin: null,
                  scaleMax: null,
                  scaleLabelMin: null,
                  scaleLabelMax: null,
                  words: [{ language: 'es', word: 'renuncia', count: 3, responseCount: 3 }],
                  suppressedWordCount: 0,
                },
              ],
            }),
          ]),
        ),
      ),
    )

    const view = renderPage()
    await screen.findByText('Los resultados por pregunta están reservados')

    const text = view.container.textContent ?? ''
    // Neither the withheld dimension average nor the withheld word.
    expect(text).not.toContain('2,2')
    expect(text).not.toContain('renuncia')
    expect(view.container.querySelector('[data-testid^="map-row-"]')).toBeNull()
    // The counters stay: a count of responses identifies nobody, and it is what tells a
    // reader this is a real survey being withheld rather than a broken section.
    expect(screen.getByText('4')).toBeTruthy()
    // And the chip says the report has no open text to show — not that it has none.
    expect(screen.getByText('Sin texto libre')).toBeTruthy()
    // The groups reading names the floor rather than claiming the survey has no groups:
    // "esta encuesta no reporta grupos" would be a statement about the survey where the
    // true statement is about what is hiding it.
    expect(
      screen.getByText('toda la encuesta está bajo el umbral de 5: no se publica ningún grupo'),
    ).toBeTruthy()
  })

  /**
   * The classic leak, in its own test: an absent count rendered as a zero.
   *
   * A survey run without an invitation list has no denominator, so it has no
   * participation rate. "0 %" would tell a board member nobody answered.
   */
  it('says the participation rate is not calculated rather than printing a zero', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        reportBody(
          documentOf([
            survey({
              participation: { ...PARTICIPATION, invitedCount: null, participationRate: null },
            }),
          ]),
        ),
      ),
    )

    const view = renderPage()
    await screen.findByRole('heading', { name: 'Informe ejecutivo de clima — Q3 2026' })

    expect(screen.getByText('No se calcula')).toBeTruthy()
    expect(
      screen.getByText('La encuesta no tenía lista de invitados, así que no hay con qué dividir.'),
    ).toBeTruthy()
    expect(view.container.textContent).not.toContain('0 %')
  })

  /**
   * The acceptance criterion, asserted on the rendered page rather than on the client.
   *
   * Four causes a real deployment produces, compared as rendered HTML. Any branch that
   * reached for a status, a `reason` or the server's message would separate them.
   */
  it('renders expired, revoked, invalid and refused identically', async () => {
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
    expect(outcomes[0]).toContain('Por seguridad, esta página no distingue entre esos casos')

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
   * The unavailable card offers nowhere to go, and that is the design.
   *
   * A reader who followed a dead share link has no account to return to; a link into the
   * app would be the one thing this page is built not to have.
   */
  it('offers no way into the application from a dead link', async () => {
    setToken('admin-session-token')
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: 'nope' }, 404))

    const view = renderPage()
    await screen.findByRole('alert')

    const hrefs = [...view.container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '')
    expect(hrefs.filter((href) => !href.startsWith('#'))).toEqual([])
    expect(view.container.querySelector('nav')).toBeNull()
  })

  /**
   * "No authenticated navigation exposed", asserted **with a session in storage** —
   * because that is the case that would fail. An administrator opening a share link in
   * the browser they administer in must get the same page a board member gets.
   */
  it('exposes no route into the application, even to a signed-in reader', async () => {
    setToken('admin-session-token')
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(reportBody(hostileDocument())))

    const view = renderPage()
    await screen.findByRole('heading', { name: 'Informe ejecutivo de clima — Q3 2026' })

    const hrefs = [...view.container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '')
    expect(hrefs.filter((href) => !href.startsWith('#'))).toEqual([])
    expect(view.container.querySelector('nav')).toBeNull()
    expect(view.container.querySelector('[data-slot="sidebar-user-menu"]')).toBeNull()
  })

  it('asks crawlers not to index the page, and cleans up after itself', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(reportBody(hostileDocument())))

    const view = renderPage()
    await screen.findByRole('heading', { name: 'Informe ejecutivo de clima — Q3 2026' })

    expect(
      window.document
        .querySelector<HTMLMetaElement>('meta[name="robots"]')
        ?.getAttribute('content'),
    ).toContain('noindex')

    view.unmount()
    expect(window.document.querySelector('meta[name="robots"]')).toBeNull()
  })

  /**
   * One visit is one access-log entry (#143). A page that re-resolved on a language
   * switch would file one reader as several.
   */
  it('resolves the token once per visit, including across a language switch', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(reportBody(hostileDocument())))

    renderPage()
    await screen.findByRole('heading', { name: 'Informe ejecutivo de clima — Q3 2026' })
    expect(fetch).toHaveBeenCalledTimes(1)

    await act(async () => {
      switchLocale('en')
    })

    await waitFor(() => expect(screen.getByText('Shared report · read only')).toBeTruthy())
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  /**
   * An eNPS average is recorded 0 to 10 and the climate target is 3,7 of 5. Judging one
   * against the other prints a confident "sobre la meta" beside a figure that was never
   * on that scale — and paints its map cell the darkest blue on the ramp.
   */
  it('prints an off-scale reading without judging it against the target', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        reportBody(
          documentOf([
            survey({
              dimensions: [
                { dimension: 'enps', questionCount: 1, answeredCount: 172, averageScore: 7.8 },
              ],
            }),
          ]),
        ),
      ),
    )

    const view = renderPage()
    await screen.findByRole('heading', { name: 'Informe ejecutivo de clima — Q3 2026' })

    const row = screen.getByText('7,8').closest('tr')
    expect(row?.textContent).toContain('fuera de la escala de 1 a 5')
    expect(row?.textContent).not.toContain('sobre la meta')
    // No strip either: a dot on a 1-to-5 axis is the same claim drawn instead of written.
    expect(row?.querySelector('svg')).toBeNull()
    expect(view.container.textContent).toContain('7,8')
  })

  it('says so plainly when the report carries no document yet', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(reportBody(documentOf([]), { reportOutput: null })),
    )

    renderPage()

    expect(await screen.findByText('Este informe todavía no tiene contenido.')).toBeTruthy()
  })

  it('reports an incomplete document without printing the English note', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        reportBody(
          documentOf([], {
            generationNote: 'Aggregation, comparisons and export are not implemented yet.',
          }),
        ),
      ),
    )

    renderPage()

    expect(await screen.findByText('Este informe no está completo')).toBeTruthy()
    expect(screen.queryByText(/not implemented yet/)).toBeNull()
  })
})
