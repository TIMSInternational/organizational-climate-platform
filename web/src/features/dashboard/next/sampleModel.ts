import type { AdminDashboardModel } from './model'

/**
 * SAMPLE DATA. This is not a measurement of anything.
 *
 * It stands in for the endpoints the redesigned Panel de Control will read once
 * `useAdminDashboardModel()` is wired, and it is the reason the page wears a
 * "sample data" chip while `isSample` is true:
 *
 * | Section                    | Endpoint                                  |
 * |----------------------------|-------------------------------------------|
 * | company, participation     | `GET /dashboard/company-admin`            |
 * | dimension series per wave  | `GET /surveys/climate-trends`             |
 * | the map of the latest wave | `GET /surveys/{id}/results`               |
 * | overdue tracking plans     | tracking `GET /api/consolidado`           |
 * | open action plans          | `GET /action-plans`                       |
 * | the live microclimate      | `GET /microclimates`                      |
 *
 * The figures are the approved mockup's Grupo Meridiano numbers, so the screen
 * can be compared against the design pixel for pixel. Nothing in here is typed as
 * a derived value: the average, the deltas, the percentages and "below target"
 * are all computed in `derive.ts` from these inputs.
 */
export const sampleModel: AdminDashboardModel = {
  isSample: true,
  asOf: '2026-09-10',
  companyName: 'Grupo Meridiano S.A.',
  target: 3.7,
  latestClosedWave: {
    id: 's-q3',
    code: 'Q3',
    name: 'Encuesta de Clima Q3',
    status: 'closed',
    closedAt: '2026-08-06',
  },
  previousWave: {
    id: 's-q2',
    code: 'Q2',
    name: 'Encuesta de Clima Q2',
    status: 'closed',
    closedAt: '2026-05-13',
  },
  openSurvey: {
    id: 's-q4',
    code: 'Q4',
    name: 'Encuesta de Clima Q4',
    responses: 1,
    audience: 24,
    closesAt: '2026-10-10',
  },
  participation: { responses: 24, completed: 24 },
  dimensions: [
    { key: 'pertenencia', name: 'Pertenencia', values: [3.3, 3.7, 4.0] },
    { key: 'desarrollo', name: 'Desarrollo', values: [3.2, 3.5, 3.8] },
    { key: 'seguridad', name: 'Seguridad psicológica', values: [3.2, 3.5, 3.8] },
    { key: 'confianza', name: 'Confianza', values: [3.0, 3.3, 3.7] },
    { key: 'reconocimiento', name: 'Reconocimiento', values: [2.8, 3.1, 3.4] },
    { key: 'carga', name: 'Carga de trabajo', values: [2.8, 3.0, 3.3] },
  ],
  waves: [
    { id: 's-q1', code: 'Q1', name: 'Encuesta de Clima Q1', status: 'closed', closedAt: '2026-02-12' },
    { id: 's-q2', code: 'Q2', name: 'Encuesta de Clima Q2', status: 'closed', closedAt: '2026-05-13' },
    { id: 's-q3', code: 'Q3', name: 'Encuesta de Clima Q3', status: 'closed', closedAt: '2026-08-06' },
    { id: 's-q4', code: 'Q4', name: 'Encuesta de Clima Q4', status: 'open', closesAt: '2026-10-10' },
    { id: 's-q1-2027', code: 'Q1 2027', name: 'Encuesta de Clima Q1 2027', status: 'planned' },
  ],
  map: {
    dimensionKeys: ['seguridad', 'carga', 'confianza', 'reconocimiento', 'desarrollo', 'pertenencia'],
    rows: [
      { departmentId: 'd-fin', name: 'Finanzas', responses: 3, scores: [3.1, 2.9, 3.4, 3.0, 3.3, 3.5] },
      { departmentId: 'd-ing', name: 'Ingeniería', responses: 7, scores: [4.0, 3.7, 4.0, 3.5, 4.2, 4.3] },
      { departmentId: 'd-ops', name: 'Operaciones', responses: 5, scores: [2.6, 2.4, 3.0, 2.8, 3.0, 3.2] },
      { departmentId: 'd-per', name: 'Personas', responses: 5, scores: [4.4, 4.0, 4.0, 3.6, 4.2, 4.4] },
      { departmentId: 'd-ven', name: 'Ventas', responses: 5, scores: [4.0, 3.4, 3.8, 3.6, 3.8, 4.0] },
    ],
  },
  plans: { open: 4, overdue: 1, overdueNodo: 'Finanzas' },
  attention: [
    {
      kind: 'lowest-cell',
      plan: { id: 'ap-1', name: 'Reducir la carga de trabajo en Operaciones', progress: 0 },
    },
    {
      kind: 'overdue-plan',
      nodo: 'Finanzas',
      plan: {
        id: 'tp-1',
        name: 'Reponer la reunión de handover entre turnos',
        progress: 0,
        owner: 'Adriana Marín',
        dueAt: '2026-08-20',
      },
    },
    { kind: 'low-participation', surveyId: 's-q4', remindersSent: 0 },
  ],
  liveMicroclimate: {
    id: 'mc-1',
    name: 'Pulso semanal — ¿cómo fue la semana?',
    responses: 0,
    closesAt: '2026-09-11',
  },
}
