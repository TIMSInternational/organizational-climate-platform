// One-shot generator for `shared-report.json`.
//
// `reports.report_output` is a TEXT column holding JSON, and `ReportDetail` hands it back
// as a string — so the fixture's `reportOutput` has to be a JSON string *inside* JSON.
// Hand-escaping that is how a fixture comes to be subtly not the wire shape, so it is
// built here instead and this file is kept beside it as the record of how.
//
//   node scripts/shot-fixtures/build-shared-report.mjs
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

const document = {
  generationNote: '',
  surveys: [
    {
      surveyId: '44444444-4444-4444-4444-444444444444',
      title: 'Encuesta de clima organizacional Q3',
      status: 'closed',
      resolvedLocale: 'es',
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
        byLanguage: [
          { language: 'es', count: 118 },
          { language: 'en', count: 57 },
        ],
      },
      dimensions: [
        { dimension: 'psychological_safety', questionCount: 4, answeredCount: 170, averageScore: 3.94 },
        { dimension: 'workload', questionCount: 3, answeredCount: 168, averageScore: 3.12 },
        { dimension: 'comunicación jefe-equipo', questionCount: 3, answeredCount: 165, averageScore: 4.21 },
        { dimension: 'enps', questionCount: 1, answeredCount: 172, averageScore: 7.8 },
      ],
      departments: [
        { departmentId: 'd1', name: 'Operaciones', respondentCount: 62, participationRate: 84.9, isSuppressed: false },
        { departmentId: 'd2', name: 'Promoción Comercial', respondentCount: 48, participationRate: 77.4, isSuppressed: false },
        { departmentId: 'd3', name: 'Tecnologías de Información', respondentCount: 41, participationRate: 68.3, isSuppressed: false },
        { departmentId: 'd4', name: 'Dirección General', respondentCount: 0, participationRate: null, isSuppressed: true },
      ],
      suppressedDepartmentCount: 1,
      suppressedRespondentCount: 4,
      unsegmentedRespondentCount: 20,
      // Demographic breakdowns beyond department: one dimension, one withheld group in
      // it, so the screenshot carries the ProtectedCell grammar in a table that also
      // has real readings to sit beside.
      demographics: [
        {
          dimension: 'antigüedad',
          segments: [
            {
              key: '0-1',
              label: 'Menos de un año',
              respondentCount: 34,
              isSuppressed: false,
              dimensions: [
                { dimension: 'psychological_safety', averageScore: 3.71 },
                { dimension: 'workload', averageScore: 3.4 },
              ],
            },
            {
              key: '2-5',
              label: 'Entre uno y cinco años',
              respondentCount: 88,
              isSuppressed: false,
              dimensions: [
                { dimension: 'psychological_safety', averageScore: 4.02 },
                { dimension: 'workload', averageScore: 3.05 },
              ],
            },
            {
              key: '10+',
              label: 'Más de diez años',
              respondentCount: 0,
              isSuppressed: true,
              dimensions: [],
            },
          ],
          suppressedSegmentCount: 1,
          suppressedRespondentCount: 3,
          unsegmentedRespondentCount: 20,
        },
      ],
      // Per-question distributions and word clouds. The open question's cloud is a
      // frequency map floored at two answers; `suppressedWordCount` is non-zero so the
      // screenshot shows the sentence that says something was withheld rather than
      // absent.
      questions: [
        {
          questionId: 'aaaaaaaa-0000-0000-0000-000000000001',
          order: 0,
          type: 'likert',
          text: '¿Qué tanto apoyo sientes de tu jefatura?',
          category: 'psychological_safety',
          answeredCount: 170,
          distribution: [
            { value: '1', label: 'Nunca', count: 9, percentage: 5.29, averageRank: null },
            { value: '2', label: 'Rara vez', count: 17, percentage: 10, averageRank: null },
            { value: '3', label: 'A veces', count: 38, percentage: 22.35, averageRank: null },
            { value: '4', label: 'Casi siempre', count: 71, percentage: 41.76, averageRank: null },
            { value: '5', label: 'Siempre', count: 35, percentage: 20.59, averageRank: null },
          ],
          average: 3.62,
          median: 4,
          scaleMin: 1,
          scaleMax: 5,
          scaleLabelMin: 'Nunca',
          scaleLabelMax: 'Siempre',
          words: [],
          suppressedWordCount: 0,
        },
        {
          questionId: 'aaaaaaaa-0000-0000-0000-000000000002',
          order: 1,
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
          words: [
            { language: 'es', word: 'turnos', count: 41, responseCount: 29 },
            { language: 'es', word: 'comunicación', count: 33, responseCount: 26 },
            { language: 'es', word: 'reconocimiento', count: 24, responseCount: 21 },
            { language: 'es', word: 'capacitación', count: 18, responseCount: 15 },
            { language: 'en', word: 'workload', count: 12, responseCount: 9 },
            { language: 'en', word: 'schedule', count: 7, responseCount: 6 },
          ],
          suppressedWordCount: 118,
        },
      ],
      isSuppressed: false,
      suppressionReason: null,
      minimumGroupSize: 5,
    },
    {
      surveyId: '55555555-5555-5555-5555-555555555555',
      title: 'Microclima de Dirección General',
      status: 'closed',
      resolvedLocale: 'es',
      participation: {
        invitedCount: 6,
        responseCount: 4,
        completedCount: 4,
        partialCount: 0,
        participationRate: 66.7,
        completionRate: 100,
        averageCompletionSeconds: 240,
        firstResponseAt: '2026-07-14T09:00:00Z',
        lastResponseAt: '2026-07-15T16:20:00Z',
        byLanguage: [{ language: 'es', count: 4 }],
      },
      dimensions: [],
      departments: [],
      demographics: [],
      questions: [],
      suppressedDepartmentCount: 0,
      suppressedRespondentCount: 4,
      unsegmentedRespondentCount: 0,
      isSuppressed: true,
      suppressionReason: 'below_minimum_respondents',
      minimumGroupSize: 5,
    },
  ],
  // Benchmark comparisons: the company's own rows plus the global ones every tenant
  // compares against, each with the year-over-year reading #89 computes. The four
  // states a row can be in, so one screenshot judges them all: a real change, the
  // units-differ refusal, a global row nobody has linked yet, and a first measurement.
  benchmarks: [
    {
      benchmarkId: '88888888-8888-8888-8888-888888888881',
      name: 'Compromiso organizacional 2026',
      category: 'engagement',
      type: 'industry',
      companyId: '11111111-1111-1111-1111-111111111111',
      priorPeriodStatus: 'linked',
      metrics: [
        { id: 'me1', metricName: 'compromiso', value: 74.2, unit: 'percent', percentile: 68, sampleSize: 175 },
        { id: 'me2', metricName: 'tiempo de respuesta', value: 1.2, unit: 's', percentile: null, sampleSize: null },
      ],
      priorPeriod: {
        id: '88888888-8888-8888-8888-888888888880',
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
          {
            metricName: 'rotación voluntaria',
            value: 8.4,
            unit: 'percent',
            priorValue: 11.9,
            priorUnit: 'percent',
            delta: -3.5,
            changeRatio: -3.5 / 11.9,
          },
          // Recorded in seconds this year and milliseconds last: the server withholds
          // the change and reports both units so this page can say why.
          {
            metricName: 'tiempo de respuesta',
            value: 1.2,
            unit: 's',
            priorValue: 1400,
            priorUnit: 'ms',
            delta: null,
            changeRatio: null,
          },
        ],
      },
    },
    {
      benchmarkId: '88888888-8888-8888-8888-888888888882',
      name: 'Referencia sectorial de compromiso',
      category: 'engagement',
      type: 'industry',
      companyId: null,
      priorPeriodStatus: 'unlinked',
      metrics: [
        { id: 'mg1', metricName: 'compromiso', value: 65.8, unit: 'percent', percentile: null, sampleSize: 4200 },
      ],
      priorPeriod: null,
    },
    {
      benchmarkId: '88888888-8888-8888-8888-888888888883',
      name: 'Ausentismo 2026',
      category: 'absence',
      type: 'internal',
      companyId: '11111111-1111-1111-1111-111111111111',
      priorPeriodStatus: 'none',
      metrics: [
        { id: 'ma1', metricName: 'ausentismo', value: 3.5, unit: 'percent', percentile: null, sampleSize: 175 },
      ],
      priorPeriod: null,
    },
  ],
  aiInsights: [
    {
      id: '66666666-6666-6666-6666-666666666666',
      type: 'risk',
      category: 'workload',
      title: 'La carga percibida subió en Operaciones',
      description:
        'La puntuación de carga de trabajo bajó 0,4 puntos respecto del trimestre anterior, y el descenso se concentra en los turnos de fin de semana.',
      confidenceScore: 87,
      priority: 'high',
      affectedSegments: ['Operaciones'],
      recommendedActions: [
        'Revisar la distribución de turnos de fin de semana',
        'Contrastar con las horas extra registradas en el trimestre',
      ],
      isAcknowledged: false,
    },
    {
      id: '77777777-7777-7777-7777-777777777777',
      type: 'trend',
      category: 'psychological_safety',
      title: 'La seguridad psicológica se mantiene por encima del promedio',
      description:
        'Tercer trimestre consecutivo por encima de 3,9. Las respuestas abiertas mencionan reuniones de equipo más frecuentes.',
      confidenceScore: 74,
      priority: 'medium',
      affectedSegments: [],
      recommendedActions: ['Documentar la práctica de reuniones y extenderla a Promoción Comercial'],
      isAcknowledged: true,
    },
  ],
}

const report = {
  title: 'Informe ejecutivo de clima — Q3 2026',
  description:
    'Resultados consolidados de las encuestas de clima cerradas entre julio y agosto de 2026.',
  type: 'executive',
  generatedAt: '2026-08-01T10:00:00Z',
  reportOutput: JSON.stringify(document),
}

writeFileSync(
  resolve(HERE, 'shared-report.json'),
  `${JSON.stringify({ 'GET /shared/reports/*': report }, null, 2)}\n`,
)

// The dead-link fixture: the flat, undifferentiated refusal the endpoint owes an
// expired, revoked or invented token alike. The body carries a message on purpose —
// `SharedReportUnavailableError` must not let it reach the screen.
writeFileSync(
  resolve(HERE, 'shared-report-dead.json'),
  `${JSON.stringify(
    { 'GET /shared/reports/* 404': { message: 'Report not found' } },
    null,
    2,
  )}\n`,
)
