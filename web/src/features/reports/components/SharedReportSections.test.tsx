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

/**
 * A cloud entry that is not a word.
 *
 * The server's tokeniser splits on whitespace and sentence punctuation, so nothing it
 * produces can look like this — which is the point. It is here to prove that the one
 * thing this platform never returns cannot reach the screen through the one open-text
 * surface it does return: a phrase from a single answer names the person who wrote it
 * to anyone who recognises the phrasing, and "Voices" was closed permanently on exactly
 * that argument.
 *
 * None of its words appears anywhere else in this document, so a pass cannot be a
 * coincidence of the fixture.
 */
const CONFESSION = 'el trámite de la visa es estresante'

/**
 * The withheld headcount behind the two suppressed tenure groups.
 *
 * Deliberately a value that appears nowhere else in this document. It is the number the
 * floor exists to hide, so the assertion is that it is not on the page in any form —
 * not as a figure, not as one half of a pair a reader subtracts.
 */
const WITHHELD_HEADCOUNT = 13

function reportDocument(): ReportDocument {
  const raw = JSON.stringify({
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
            type: 'likert',
            text: '¿Qué tanto apoyo sientes de tu jefatura?',
            category: 'psychological_safety',
            answeredCount: 7,
            distribution: [
              // The survey's own option order, not popularity order: "1" first even
              // though "4" won five votes to two.
              { value: '1', label: 'Nunca', count: 2, percentage: 28.57, averageRank: null },
              { value: '4', label: 'Casi siempre', count: 5, percentage: 71.43, averageRank: null },
            ],
            average: 3.14,
            median: 4,
            scaleMin: 1,
            scaleMax: 5,
            scaleLabelMin: 'Nunca',
            scaleLabelMax: 'Siempre',
            words: [],
            suppressedWordCount: 0,
          },
          {
            questionId: 'q2',
            order: 1,
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
            words: [
              { language: 'es', word: 'carga', count: 9, responseCount: 6 },
              { language: 'en', word: 'workload', count: 4, responseCount: 3 },
              // Not a word, and therefore not something any renderer may print.
              { language: 'es', word: CONFESSION, count: 1, responseCount: 1 },
            ],
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
              // Two withheld groups, so the withheld headcount is a total rather than
              // one group's size — and so the sentence below says "2 groups" rather
              // than naming a number a reader could pair with anything.
              {
                key: '0-1',
                label: 'Menos de un año',
                respondentCount: 0,
                isSuppressed: true,
                dimensions: [],
              },
              {
                key: '10+',
                label: 'Más de diez años',
                respondentCount: 0,
                isSuppressed: true,
                dimensions: [],
              },
            ],
            suppressedSegmentCount: 2,
            suppressedRespondentCount: WITHHELD_HEADCOUNT,
            unsegmentedRespondentCount: 4,
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
        resolvedLocale: 'en',
        // Below the floor, and carrying the three things a suppressed section must not
        // publish anyway: a distribution, a word cloud and a demographic group's score.
        // The server empties all three and the parser empties them again; this fixture
        // is the malformed document that proves the page does not depend on either.
        questions: [
          {
            questionId: 'q9',
            order: 0,
            type: 'open_ended',
            text: 'How safe do you feel raising a concern?',
            category: 'psychological_safety',
            answeredCount: 4,
            distribution: [],
            average: null,
            median: null,
            scaleMin: null,
            scaleMax: null,
            scaleLabelMin: null,
            scaleLabelMax: null,
            words: [{ language: 'en', word: 'retaliation', count: 5, responseCount: 4 }],
            suppressedWordCount: 0,
          },
        ],
        demographics: [
          {
            dimension: 'ubicación',
            segments: [
              {
                key: 'sede',
                label: 'Sede central',
                respondentCount: 4,
                isSuppressed: false,
                dimensions: [{ dimension: 'trust', averageScore: 2.1 }],
              },
            ],
            suppressedSegmentCount: 0,
            suppressedRespondentCount: 0,
            unsegmentedRespondentCount: 0,
          },
        ],
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
        // No `resolvedLocale` at all — a row written by a generator older than the field.
        // The section must render without claiming a language it was not told.
        questions: [],
        demographics: [],
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
    // The four shapes a benchmark row arrives in, because `priorPeriod: null` has three
    // different causes and only `priorPeriodStatus` tells them apart.
    benchmarks: [
      {
        benchmarkId: 'b1',
        name: 'Compromiso 2026',
        category: 'engagement',
        type: 'industry',
        isGlobal: false,
        priorPeriodStatus: 'linked',
        metrics: [
          { id: 'm1', metricName: 'engagement', value: 74, unit: 'percent', percentile: null, sampleSize: null },
        ],
        priorPeriod: {
          // Written into the RAW document and dropped by the parser: the public
          // projection withholds the linked benchmark's own row id.
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
            // The units-differ case: both readings exist, the server refuses to
            // subtract them, and the reader is owed the reason rather than a dash.
            {
              metricName: 'latencia',
              value: 1.2,
              unit: 's',
              priorValue: 1200,
              priorUnit: 'ms',
              delta: null,
              changeRatio: null,
            },
          ],
        },
      },
      {
        benchmarkId: 'b2',
        name: 'Compromiso global',
        category: 'engagement',
        type: 'industry',
        // A global row: every tenant compares against it, and none of them owns it.
        // The server says so with a flag; it used to say so by shipping this report's
        // tenant GUID to an anonymous reader and letting the page check it for null.
        isGlobal: true,
        priorPeriodStatus: 'unlinked',
        metrics: [
          { id: 'm2', metricName: 'referencia_global', value: 65, unit: 'percent', percentile: null, sampleSize: null },
        ],
        priorPeriod: null,
      },
      {
        benchmarkId: 'b3',
        name: 'Rotación 2026',
        category: 'turnover',
        type: 'internal',
        isGlobal: false,
        // An answer, not a silence: an administrator has said there is no prior period.
        priorPeriodStatus: 'none',
        metrics: [
          { id: 'm3', metricName: 'rotacion', value: 11, unit: 'percent', percentile: null, sampleSize: null },
        ],
        priorPeriod: null,
      },
      {
        benchmarkId: 'b4',
        name: 'Ausentismo 2026',
        category: 'absence',
        type: 'internal',
        isGlobal: false,
        // Linked, and the row it points at is outside what this report may carry.
        priorPeriodStatus: 'linked',
        metrics: [
          { id: 'm4', metricName: 'ausentismo', value: 3.5, unit: 'percent', percentile: null, sampleSize: null },
        ],
        priorPeriod: null,
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

  /**
   * A question's distribution, in the survey's own option order and with each figure in
   * its own column.
   *
   * The percentage is the server's `percentage` field. A renderer that computed count
   * over answered count would agree with it on this fixture and disagree the moment a
   * question's answered count and its bucket total differ — so the assertion that
   * matters is the positional one: the count in the count column, the share in the
   * share column, neither swapped for the other.
   */
  it('prints a question’s distribution in the author’s option order', () => {
    renderSections()

    expect(screen.getByText('¿Qué tanto apoyo sientes de tu jefatura?')).toBeTruthy()
    // "1" before "4", though "4" won five votes to two.
    expect(rowCells('Nunca')).toEqual(['Nunca', '2', '28,6 %'])
    expect(rowCells('Casi siempre')).toEqual(['Casi siempre', '5', '71,4 %'])
  })

  /**
   * THE open-text guarantee, on the most exposed page in the product.
   *
   * A word cloud is a frequency map floored server-side, and it is the only open-text
   * surface this platform has — "Voices" was closed permanently on the rule that
   * verbatim answers are never returned. So the assertion is made against the whole
   * rendered text, case-folded: the sentence must not appear, no word of it may appear,
   * and no pair of the words that DO appear may be printed adjacently, because a
   * renderer that joined a cloud into a phrase would produce a sentence nobody wrote.
   */
  it('prints words and counts, and never a sentence', () => {
    const { container } = renderSections()

    // The cloud is there, as words with numbers beside them.
    expect(rowCells('carga')).toEqual(['carga', 'Español', '9', '6'])
    expect(rowCells('workload')).toEqual(['workload', 'Inglés', '4', '3'])

    const page = (container.textContent ?? '').normalize('NFC').toLowerCase()
    expect(page).not.toContain(CONFESSION.normalize('NFC').toLowerCase())
    for (const word of ['trámite', 'visa', 'estresante']) {
      // On a word boundary, not as a substring: the insight's own "revisar" contains
      // "visa", and a check that could not tell the two apart would fail on copy that
      // has nothing to do with anybody's answer.
      expect(page).not.toMatch(new RegExp(`\\b${word.normalize('NFC').toLowerCase()}\\b`, 'u'))
    }
    // And the two words that ARE shown are never run together into a phrase.
    expect(page).not.toContain('carga workload')
    expect(page).not.toContain('workload carga')
  })

  /**
   * "Withheld" and "none" are different statements, and a floored list shown without its
   * counter makes the first read as the second — it tells the reader they are seeing
   * everything people said.
   *
   * The count is 5, not the document's 4: the server withheld four words for appearing
   * in too few answers, and the parser refused a fifth entry that was not a word at all.
   * Both are withheld, and the reader is owed one honest total rather than a list that
   * quietly shortened itself.
   */
  it('says how many words were withheld, and that only frequencies are shown', () => {
    renderSections()

    expect(screen.getByText(/5 palabras quedan reservadas/)).toBeTruthy()
    expect(
      screen.getByText(/Solo se muestra con qué frecuencia se usó cada palabra/),
    ).toBeTruthy()
  })

  /**
   * A withheld demographic group renders as *protected*, which is a different claim
   * from *empty*.
   *
   * `respondentCount` is 0 on a suppressed group because the server zeroed it, and
   * printing that zero would say nobody in the group answered — false, and also the
   * number a reader subtracts with. A blank cell is no better: `ProtectedCell` exists
   * because a hatched, padlocked box says a guarantee was enforced on purpose while a
   * gap says the product failed to collect something.
   *
   * The accessible name is asserted too, because the hatch is the whole message and a
   * screen reader that got an empty cell would be reading the same failure in another
   * modality.
   */
  it('renders a withheld group as protected, never as a blank or a zero', () => {
    renderSections()

    // The disclosed group prints its figures, in their own columns.
    expect(rowCells('2-5 años')).toEqual(['2-5 años', '9', '4,2'])

    // The withheld group keeps its name and collapses its measurements into one cell.
    const cells = rowCells('Menos de un año')
    // Two cells: the name, and ONE spanning the respondents column and every score
    // column. Several cells each saying "withheld" would read as several withheld
    // measurements rather than one withheld group.
    expect(cells).toHaveLength(2)
    expect(cells[1]).toContain('Protegido')
    expect(cells[1]).toContain('Menos de 8 personas respondieron')
    // No zero, in any column — the count the server withheld does not reappear here.
    expect(cells.join(' ')).not.toMatch(/\b0\b/)

    // Hatched, padlocked and named, the same grammar the climate map uses.
    expect(
      screen.getByRole('img', { name: /Menos de un año: protegido/i }),
    ).toBeTruthy()
  })

  /**
   * The number of withheld groups is reportable. The number of *people* behind them is
   * not: it is the sub-threshold count the floor exists to hide, and publishing it —
   * directly, or as one half of a pair a reader subtracts — hands over exactly what the
   * guarantee protects. `SegmentBreakdownPanel` makes the same refusal inside the
   * tenant; this page has no session at all.
   */
  it('counts the withheld groups and never the people inside them', () => {
    const { container } = renderSections()

    expect(
      screen.getByText(/Se reservan 2 grupo\(s\) porque cada uno tiene menos de 8 personas/),
    ).toBeTruthy()
    expect(container.textContent ?? '').not.toContain(String(WITHHELD_HEADCOUNT))
  })

  /**
   * A suppressed section publishes nothing, and the three new blocks are the three most
   * damaging things it could publish: a per-question distribution, a word cloud, and a
   * demographic group's score. The fixture's second survey carries all three while being
   * below the floor — a document the server does not produce and a client must survive.
   */
  it('publishes no question, word or group from a section below the floor', () => {
    const { container } = renderSections()

    const page = (container.textContent ?? '').normalize('NFC').toLowerCase()
    for (const leak of ['How safe do you feel raising a concern?', 'retaliation', 'Sede central']) {
      expect(page).not.toContain(leak.normalize('NFC').toLowerCase())
    }
  })

  /**
   * The section prints authored text — question text, option labels, the author's own
   * category names — and a reader of a stored document has no other way to know which
   * language it is in. It is per section, and it is not the reader's UI language: this
   * page renders in Spanish throughout while the second survey's content is English.
   *
   * A section from a generator older than the field says nothing at all, rather than
   * claiming a language it was never told.
   */
  it('names the language each section’s content is printed in', () => {
    renderSections()

    expect(screen.getByText(/Impreso en Español/)).toBeTruthy()
    expect(screen.getByText(/Impreso en Inglés/)).toBeTruthy()
    // Three surveys, two of which carry a resolved locale.
    expect(screen.getAllByText(/Impreso en/)).toHaveLength(2)
  })

  /**
   * The benchmark table, figure by figure and column by column.
   *
   * Every number here is `BenchmarkPriorPeriod.BuildChanges`' own — the same code
   * `GET /admin/benchmarks/{id}` serves — so the assertion that matters is that the
   * client printed them rather than derived them. `changeRatio` is the one most likely
   * to be got wrong: it arrives as a fraction (0.057), and a renderer that treated it as
   * percentage points would print "0,1 %" beside a four-point rise.
   */
  it('prints a benchmark’s value, prior period, change and relative change', () => {
    renderSections()

    expect(rowCells('engagement')).toEqual([
      'engagement',
      '74 percent',
      '70 percent',
      '+4',
      '+5,7 %',
    ])
    expect(screen.getByText('Comparado con Compromiso 2025.')).toBeTruthy()
  })

  /**
   * `BenchmarkMetric.Unit` is a free string, so the same metric can arrive as `s` one
   * year and `ms` the next; 1.2 against 1200 then reads as a catastrophe rather than as
   * the same number twice. The server compares units before values and withholds the
   * change, reporting both units *so a caller can say why*.
   *
   * Saying why is this renderer's half of that bargain. A dash in the change column
   * would look like missing data and invite the reader to do the subtraction themselves,
   * which is the confidently wrong number #89 exists to avoid.
   */
  it('says why a change is absent when the two periods used different units', () => {
    renderSections()

    const cells = rowCells('latencia')
    expect(cells[1]).toBe('1,2 s')
    // Bare, not "1.200": Spanish groups from five digits up (CLDR's
    // `minimumGroupingDigits: 2`), and `Intl` is what knows that.
    expect(cells[2]).toBe('1200 ms')
    // One cell over both change columns, carrying the reason and not a dash.
    expect(cells).toHaveLength(4)
    expect(cells[3]).toContain('Se registró en s frente a ms')
  })

  /**
   * `priorPeriod: null` has three causes and `priorPeriodStatus` is the only thing that
   * tells them apart. "An administrator has said there is no prior period" is an answer;
   * "nobody has linked one yet" is a silence; "the linked row is not in this report" is
   * neither. One sentence for all three would state a fact the document does not carry.
   */
  it('distinguishes the three reasons a benchmark has no prior period', () => {
    renderSections()

    expect(screen.getByText(/Todavía no se ha vinculado un periodo anterior/)).toBeTruthy()
    expect(screen.getByText(/no tiene periodo anterior: es la primera medición/)).toBeTruthy()
    expect(screen.getByText(/El periodo anterior vinculado a esta referencia no forma parte/)).toBeTruthy()

    // And a global row says it is shared rather than this organisation's own.
    expect(screen.getByText(/Compartida entre organizaciones/)).toBeTruthy()
  })

  /**
   * A benchmark with no prior period gets a table of current readings and a caption
   * that says so. Reusing the comparison table's caption described a comparison the
   * table did not contain — a defect no assertion in this file could see, because the
   * string was present and correct for the table it was written for. The PNG caught it.
   */
  it('does not caption a readings-only table as a comparison', () => {
    renderSections()

    expect(screen.getByText('Cada medición de Compromiso global')).toBeTruthy()
    expect(
      screen.getByText('Cada medición de Compromiso 2026, frente a la misma medición de un periodo anterior'),
    ).toBeTruthy()
    // The comparison caption belongs to the one benchmark that has a comparison.
    expect(screen.getAllByText(/frente a la misma medición de un periodo anterior/)).toHaveLength(1)
  })
})
