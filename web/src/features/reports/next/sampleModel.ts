import type { ReportContents } from './model'

/**
 * SAMPLE DATA. This is not a measurement of any report on screen.
 *
 * It feeds the one column of the Informes artboard that no list endpoint provides —
 * "Contiene", and the survey the "Informes" tile names — and it is the reason those two
 * regions wear the "Datos de muestra" chip while `isSample` is true:
 *
 * | Field                     | Endpoint that will provide it                                           |
 * |---------------------------|-------------------------------------------------------------------------|
 * | `surveyName`, `responses` | `GET /admin/reports/{id}` → `reportOutput.surveys[].title`, `.participation.responseCount` |
 * | `groups[].name`, `.isProtected` | the same section's `departments[].name`, `.isSuppressed`            |
 * | `floor`                   | the same section's `minimumGroupSize`                                   |
 *
 * `reportOutput` is read through `parseReportDocument` (`../reportDocument.ts`) and never
 * displayed raw. `GET /admin/reports` (`ReportListItem`, seven columns plus the schedule)
 * carries none of it, so phase 2 either reads the detail once per row or adds the fields
 * to the list projection — that choice is a ruling, not this file's.
 *
 * Shaped from the real document of "Datos de clima — T3 2026" as the local API returned it
 * on 10 Sep 2026: its Q3 section, 24 responses, five departments of which Finanzas is under
 * the floor of 5. Nothing derived is typed here: "4 de 5 grupos" is counted in `derive.ts`.
 */
export const sampleContents: ReportContents = {
  surveyName: 'Encuesta de Clima Q3',
  responses: 24,
  groups: [
    { name: 'Finanzas', isProtected: true },
    { name: 'Ingeniería', isProtected: false },
    { name: 'Operaciones', isProtected: false },
    { name: 'Personas', isProtected: false },
    { name: 'Ventas', isProtected: false },
  ],
  floor: 5,
}
