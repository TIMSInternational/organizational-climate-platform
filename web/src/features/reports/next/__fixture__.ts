import type { ReportContents } from './model'

/**
 * A `ReportContents` fixture, for tests only. Nothing in production imports it.
 *
 * It was `sampleModel.ts`, and until 2026-09-21 it was the runtime source of the Informes
 * "Contiene" column: `useReportsListModel` stamped this ONE object on every completed row,
 * so every report in every tenant claimed "Encuesta de Clima Q3 · 24 respuestas · 4 de 5
 * grupos · Finanzas protegido" whatever it actually held. The column now reads the
 * report's own `reportOutput` through `parseReportDocument` and `derive.contentsOf`, which
 * is what the table below always said would replace it:
 *
 * | Field                     | Endpoint that provides it                                               |
 * |---------------------------|-------------------------------------------------------------------------|
 * | `surveyName`, `responses` | `GET /admin/reports/{id}` → `reportOutput.surveys[].title`, `.participation.responseCount` |
 * | `groups[].name`, `.isProtected` | the same section's `departments[].name`, `.isSuppressed`            |
 * | `floor`                   | the same section's `minimumGroupSize`                                   |
 *
 * Kept as a fixture because it is a realistic single-survey shape and `derive.test.ts`
 * asserts the readings against it. Shaped from the real document of "Datos de clima — T3
 * 2026" as the local API returned it on 10 Sep 2026: its Q3 section, 24 responses, five
 * departments of which Finanzas is under the floor of 5. Nothing derived is typed here —
 * "4 de 5 grupos" is counted in `derive.ts`.
 */
export const contentsFixture: ReportContents = {
  surveyName: 'Encuesta de Clima Q3',
  surveyCount: 1,
  responses: 24,
  isSuppressed: false,
  groups: [
    { name: 'Finanzas', isProtected: true },
    { name: 'Ingeniería', isProtected: false },
    { name: 'Operaciones', isProtected: false },
    { name: 'Personas', isProtected: false },
    { name: 'Ventas', isProtected: false },
  ],
  floor: 5,
}
