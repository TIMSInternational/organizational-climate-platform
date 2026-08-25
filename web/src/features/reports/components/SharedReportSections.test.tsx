import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TranslationProvider } from '../../../i18n'
import SharedReportSections from './SharedReportSections'
import { parseReportDocument, type ReportDocument } from '../reportDocument'

/**
 * Every branch and every printed figure on the public report body.
 *
 * ## Why this file exists separately from `SharedReportPage.test.tsx`
 *
 * The page's tests reach this component through a fetch and read six strings off it.
 * That left the file where all the arithmetic and all the suppression branches live
 * effectively unasserted, and an adversarial pass proved it: five separate mutations
 * survived the full suite, including two that are the exact inferences
 * `reportDocument.ts` states in capitals that a renderer must not make.
 *
 * ## The fixture is built to make the branches DIVERGE
 *
 * That is the whole design of it, and the reason the earlier fixture could not catch
 * any of this. In a document where `isSuppressed`, `participationRate === null` and
 * `dimensions.length === 0` all coincide, a renderer may branch on whichever it likes
 * and every assertion still passes. So:
 *
 * - **Ventas** is a real department with a *missing rate* and nothing withheld. It
 *   separates `isSuppressed` from `participationRate === null`.
 * - **The open-comments survey** has no scale questions and is *not* suppressed. It
 *   separates `isSuppressed` from `dimensions.length === 0`.
 * - **`minimumGroupSize` is 8, not 5.** The floor is a per-company setting; a fixture
 *   that used the same number the product's default happens to be cannot tell "printed
 *   the company's minimum" apart from "printed a constant".
 * - **`affectedSegments` names segments that appear NOWHERE else** on the page, so the
 *   omission is provable rather than masked by a name the table prints anyway.
 *
 * ## And it is built the way production builds it
 *
 * Through `parseReportDocument` over a JSON **string**, because `reports.report_output`
 * is a TEXT column and `ReportDetail` hands it back as text. A hand-constructed
 * `ReportDocument` object would skip the parser that zeroes a suppressed department and
 * empties a suppressed section — i.e. it would test a shape this product never produces.
 */

/** Deliberately not 5. See the fixture note above. */
const MINIMUM_GROUP_SIZE = 8

/**
 * Segment names written by the insight generator. They pass through none of the
 * aggregation that applies the anonymity floor, and neither appears anywhere else in
 * this document — so if either reaches the screen, it got there from `affectedSegments`.
 */
const UNAGGREGATED_SEGMENTS = ['Contraloría', 'Auditoría Interna']

function reportDocument(): ReportDocument {
  const raw = JSON.stringify({
    generationNote: '',
    surveys: [
      {
        surveyId: 's1',
        title: 'Encuesta de clima Q3',
        status: 'closed',
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
          // Catalogued, so it resolves to the product's own words.
          { dimension: 'psychological_safety', questionCount: 4, answeredCount: 170, averageScore: 3.9 },
          // Catalogued, and nobody answered it — the `averageScore: null` branch.
          { dimension: 'workload', questionCount: 3, answeredCount: 0, averageScore: null },
          // Uncatalogued: a category this survey's author typed, hyphen and all.
          { dimension: 'comunicación jefe-equipo', questionCount: 3, answeredCount: 165, averageScore: 4.21 },
        ],
        departments: [
          { departmentId: 'd1', name: 'Operaciones', respondentCount: 42, participationRate: 84, isSuppressed: false },
          // Nothing withheld here: a real department whose invited headcount is unknown,
          // so there is no rate to compute. The row that separates the flag from the rate.
          { departmentId: 'd2', name: 'Ventas', respondentCount: 7, participationRate: null, isSuppressed: false },
          // Withheld. The server has already zeroed the count; the parser zeroes it again.
          { departmentId: 'd3', name: 'Dirección', respondentCount: 0, participationRate: null, isSuppressed: true },
        ],
        suppressedDepartmentCount: 1,
        suppressedRespondentCount: 3,
        unsegmentedRespondentCount: 2,
        isSuppressed: false,
        suppressionReason: null,
        minimumGroupSize: MINIMUM_GROUP_SIZE,
      },
      {
        surveyId: 's2',
        title: 'Microclima de Dirección',
        status: 'closed',
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
        minimumGroupSize: MINIMUM_GROUP_SIZE,
      },
      {
        // Not suppressed, and no dimensions — a survey of open-text questions only.
        // `ReportSurveySection` says this in as many words: "a survey with no scale
        // questions has no dimensions and is not suppressed at all".
        surveyId: 's3',
        title: 'Buzón de comentarios abiertos',
        status: 'closed',
        participation: {
          invitedCount: 248,
          responseCount: 96,
          completedCount: 91,
          partialCount: 5,
          participationRate: 38.7,
          completionRate: 94.79,
          averageCompletionSeconds: 210,
          firstResponseAt: '2026-07-06T09:00:00Z',
          lastResponseAt: '2026-07-20T11:00:00Z',
          byLanguage: [{ language: 'es', count: 91 }],
        },
        dimensions: [],
        departments: [],
        suppressedDepartmentCount: 0,
        suppressedRespondentCount: 0,
        unsegmentedRespondentCount: 0,
        isSuppressed: false,
        suppressionReason: null,
        minimumGroupSize: MINIMUM_GROUP_SIZE,
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
        affectedSegments: UNAGGREGATED_SEGMENTS,
        recommendedActions: ['Revisar la distribución de turnos'],
        isAcknowledged: false,
      },
    ],
  })

  const parsed = parseReportDocument(raw)
  if (parsed === null) throw new Error('fixture is not a report document')
  return parsed
}

function renderSections() {
  return render(
    <TranslationProvider initialLocale="es">
      <SharedReportSections document={reportDocument()} />
    </TranslationProvider>,
  )
}

/**
 * The cells of the row a given label sits in, left to right, as text.
 *
 * ` ` is folded to a space because `Intl` puts a non-breaking one before `%` in
 * Spanish. Nothing else is normalised: the point of reading whole cells positionally is
 * that a figure printed in the wrong column is a different array, and no amount of
 * whitespace folding hides that.
 */
function rowCells(label: string): string[] {
  const row = screen.getByText(label).closest('tr')
  expect(row).toBeTruthy()
  return [...(row?.querySelectorAll('td') ?? [])].map((cell) =>
    (cell.textContent ?? '').replace(/ /g, ' '),
  )
}

/**
 * The value on the KPI tile carrying `label`.
 *
 * `data-slot="kpi-tile"` is the handle `KpiTile` documents for exactly this: the labels
 * on this strip — "Respuestas" — also appear as a table column heading on the same
 * screen, so matching on text alone reaches the wrong node.
 */
function tileValue(label: string): string {
  const tile = [...screen.getAllByText(label)]
    .map((node) => node.closest('[data-slot="kpi-tile"]'))
    .find((node): node is HTMLElement => node !== null)
  expect(tile).toBeTruthy()
  const value = tile?.children[1]?.textContent ?? ''
  return value.replace(/\u00a0/g, ' ')
}

afterEach(cleanup)

describe('the shared report body', () => {
  /**
   * Every figure, in the column it belongs to.
   *
   * The component's own docblock claims "not one number on this screen is derived from
   * another… each printed as the aggregation produced it", and until this test the page
   * asserted six strings off a screen rendering roughly forty values. Three cells could
   * be rewired — the average-score column reading `answeredCount`, the two department
   * columns swapped — with the whole suite green.
   */
  it('prints each figure in its own column', () => {
    renderSections()

    expect(rowCells('Seguridad psicológica')).toEqual([
      'Seguridad psicológica',
      '4',
      '170',
      '3,9',
    ])
    // A dimension nobody answered reads as unavailable, not as a zero score.
    expect(rowCells('Carga de trabajo')).toEqual(['Carga de trabajo', '3', '0', 'n/d'])

    expect(rowCells('Operaciones')).toEqual(['Operaciones', '42', '84 %'])
  })

  /**
   * The participation ladder, tile by tile.
   *
   * Four numbers in four boxes, and nothing but the order of the JSX says which is
   * which. `SurveyAggregation` guarantees `responseCount == completedCount +
   * partialCount` by construction, so a tile that computed the completed count from the
   * other two would be right on every document this product can produce — an equivalent
   * mutation no fixture can catch and none should pretend to. What a fixture CAN catch
   * is a tile reading the wrong field, which is the defect that is actually available
   * here, so each tile is read by its own label.
   */
  it('reads each participation tile off its own field', () => {
    renderSections()

    expect(tileValue('Invitados')).toBe('248')
    expect(tileValue('Respuestas')).toBe('187')
    expect(tileValue('Completadas')).toBe('175')
    expect(tileValue('Tasa de participación')).toBe('70,6 %')
  })

  /**
   * A dimension key is not a heading a board member can read.
   *
   * `SurveyResultsPage` does print `psychological_safety` verbatim, and `dimensionLabel`
   * explains that precedent as being for "an analyst reading a key they will filter and
   * export by". The reader of a share link is a board member, an auditor or a ministry
   * contact, so this surface takes the respondent's side of that split. An uncatalogued
   * category is still printed as its author typed it — hyphen intact — rather than as
   * boilerplate, which is the rule `dimensionLabel` exists to keep.
   */
  it('heads each dimension with the product’s own words, or the author’s', () => {
    renderSections()

    expect(screen.getByText('Seguridad psicológica')).toBeTruthy()
    expect(screen.queryByText('psychological_safety')).toBeNull()
    expect(screen.getByText('comunicación jefe-equipo')).toBeTruthy()
  })

  /**
   * `reportDocument.ts`, in capitals: "Renderers must branch on `isSuppressed` rather
   * than on the count, because zero is also a real answer."
   *
   * Ventas is the row that makes that testable. It is a real department with a real
   * headcount and no rate to print, and a renderer that read "no rate" as "withheld"
   * would replace its seven respondents with the withheld word — losing a figure that
   * was never withheld, and, in the same edit, printing a headcount for any suppressed
   * row whose rate happened to survive.
   */
  it('withholds a department by its own flag, not by a missing rate', () => {
    renderSections()

    expect(rowCells('Ventas')).toEqual(['Ventas', '7', 'n/d'])

    // And the withheld row keeps its name, spans both numeric columns so there is no
    // empty box to read as a zero, and carries no figure at all.
    expect(rowCells('Dirección')).toEqual(['Dirección', 'Reservado'])
  })

  /**
   * `ReportSurveySection`, also in as many words: "a survey with no scale questions has
   * no dimensions and is not suppressed at all."
   *
   * Exactly one section in this document is below the floor. A renderer that inferred
   * suppression from an empty dimension list would tell the reader of the open-comments
   * survey that its results were withheld for anonymity, when the survey simply asked no
   * scale questions — an accusation of a privacy event that did not happen.
   */
  it('does not call a survey with no scale questions suppressed', () => {
    renderSections()

    expect(screen.getAllByText('Los resultados por pregunta están reservados')).toHaveLength(1)

    // The one notice belongs to the survey that is actually below the floor.
    const notice = screen.getByText('Los resultados por pregunta están reservados')
    expect(notice.closest('section')?.textContent).toContain('Microclima de Dirección')

    // The open-comments survey still renders — with its participation, and no table.
    expect(screen.getByText('Buzón de comentarios abiertos')).toBeTruthy()
  })

  /**
   * The floor is a per-company setting, so the sentence has to carry the company's
   * number and not the product's default. A fixture whose `minimumGroupSize` was 5 could
   * not tell the two apart, and a hardcoded 5 would tell a tenant configured to 8 that
   * the floor is something it is not.
   */
  it('states the company’s own minimum wherever the floor is explained', () => {
    renderSections()

    expect(screen.getByText(/Menos de 8 personas han completado esta encuesta/)).toBeTruthy()
    expect(
      screen.getByText(/Se reservan 1 departamento\(s\) porque cada uno tiene menos de 8 personas/),
    ).toBeTruthy()
    expect(screen.queryByText(/menos de 5/i)).toBeNull()
  })

  /**
   * #152 was a bug about reading a 0-1 confidence off the wrong `AIInsight` model.
   * `ReportAIInsightItem.ConfidenceScore` is an integer 0-100, so it is already the
   * percentage and dividing it again prints "0,9%" beside a finding the model is 87%
   * sure of. The rendered value was asserted nowhere.
   */
  it('prints an insight’s confidence as the percentage points it already is', () => {
    renderSections()

    expect(screen.getByText('87%')).toBeTruthy()
  })

  /**
   * The anonymity guarantee this component makes that is a judgement rather than a
   * projection: `affectedSegments` is a free list written by the insight generator and
   * it passes through none of the aggregation that applies the floor.
   *
   * Asserted against the whole rendered text, case-folded, because the leak that matters
   * is the NAME reaching a reader — not the particular expression that put it there. A
   * renderer that joined the list, upper-cased it or spelled it into a sentence all fail
   * the same way. Neither name appears anywhere else in this document, so a pass here
   * cannot be a coincidence of the fixture.
   */
  it('names no segment the anonymity floor never saw', () => {
    const { container } = renderSections()

    const page = (container.textContent ?? '').normalize('NFC').toLowerCase()
    // The insight itself is on the page — this is an omission, not a suppression.
    expect(page).toContain('la carga percibida subió en operaciones'.normalize('NFC'))

    for (const segment of UNAGGREGATED_SEGMENTS) {
      expect(page).not.toContain(segment.normalize('NFC').toLowerCase())
    }
  })

  /**
   * A live region announces itself to a screen reader when its content changes, and
   * these cards arrive when the fetch resolves. `Alert` defaults to `role="status"`, so
   * building an insight card out of one turned every paragraph of static report prose
   * into a status update — on the one page in the product whose reader is most likely to
   * be using assistive technology and least likely to be a user of the app.
   *
   * The suppression notice IS a status and keeps the role; it is the shared component
   * the authenticated results page uses, and both surfaces must say that one rule the
   * same way. So the assertion is that there is exactly one live region and it is that
   * one — a count, because "no role on the insight" would pass just as well with a
   * second live region wrapped around the whole section.
   */
  it('does not announce static report prose as a live region', () => {
    const { container } = renderSections()

    const live = [...container.querySelectorAll('[role="status"], [role="alert"], [aria-live]')]
    expect(live).toHaveLength(1)
    expect(live[0].textContent).toContain('Los resultados por pregunta están reservados')

    expect(
      screen.getByText('La carga percibida subió en Operaciones').closest('[role="status"]'),
    ).toBeNull()
  })
})
