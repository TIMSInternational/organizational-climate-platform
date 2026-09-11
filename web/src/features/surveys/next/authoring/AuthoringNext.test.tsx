import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import { clearToken, setToken } from '../../../../auth/token'
import { COMPANY_CONTEXT_STORAGE_KEY, CompanyContextProvider } from '../../../../company-context'
import { tokenFor } from '../../../../test/jwtFixture'
import type { SurveyDetail } from '../../api/surveys'
import type { SurveyInvitationList } from '../../api/surveyDistribution'
import { SurveyDetailView } from './SurveyDetailNextPage'
import { DistributionView, INVITATION_PREVIEW_ROWS } from './SurveyDistributionNextPage'
import SurveyBuilderNextPage from './SurveyBuilderNextPage'
import * as drafts from '../../api/surveyDrafts'
import * as creating from '../../api/surveyCreate'

vi.mock('../../api/surveyDrafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveyDrafts')>()),
  getLatestSurveyDraft: vi.fn(),
  createSurveyDraft: vi.fn(),
  autosaveSurveyDraft: vi.fn(),
  deleteSurveyDraft: vi.fn(async () => undefined),
  recoverSurveyDraft: vi.fn(async () => undefined),
}))
vi.mock('../../api/surveyCreate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveyCreate')>()),
  createSurvey: vi.fn(),
}))
vi.mock('../../../org-structure/api/departments', () => ({ listDepartments: vi.fn(async () => []) }))
vi.mock('../../api/surveyTemplates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveyTemplates')>()),
  listSurveyTemplates: vi.fn(async () => []),
}))
vi.mock('../../api/surveys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveys')>()),
  listSurveyDimensions: vi.fn(async () => []),
}))

/** A share-link path segment. Low entropy on purpose: it stands for a credential, and is not one. */
const LINK_SEGMENT = 'qqqqzzzzqqqqzzzz'

function survey(over: Partial<SurveyDetail> = {}): SurveyDetail {
  const question = (order: number, category: string, text: string) => ({
    id: `q${order}`, text, type: 'likert', options: null, scaleMin: 1, scaleMax: 5,
    scaleLabelMin: 'Muy en desacuerdo', scaleLabelMax: 'Muy de acuerdo', required: true,
    commentRequired: false, commentPrompt: null, order, category,
  })
  return {
    id: 's1', title: 'Encuesta de Clima Q4 (abierta)', description: 'Abierta a respuestas.', companyId: 'c1', createdBy: 'u1',
    type: 'periodic', status: 'active', language: 'both', resolvedLocale: 'es', fallbackFields: [],
    startDate: '2026-09-03T12:00:00Z', endDate: '2026-10-10T12:00:00Z', responseCount: 3, targetAudienceCount: 24, version: 1,
    departmentIds: ['d1', 'd2'],
    questions: [question(0, 'psychological_safety', 'Puedo plantear preocupaciones.'), question(1, 'workload', 'Mi carga es sostenible.')],
    settings: { anonymous: false, notificationReminderFrequencyDays: 3 } as SurveyDetail['settings'],
    allowedStatusTransitions: ['closed'], isContentEditable: false, createdAt: '', updatedAt: '',
    ...over,
  }
}

function invitationList(count = 0, over: Partial<SurveyInvitationList> = {}): SurveyInvitationList {
  return {
    invitations: Array.from({ length: count }, (_, i) => ({
      id: `i${i}`, surveyId: 's1', userId: `u${i}`, email: `persona${i}@meridiano.test`, status: 'sent', isExpired: false,
      sentAt: null, openedAt: null, startedAt: null, completedAt: null, reminderCount: 0, lastReminderSent: null, expiresAt: '', createdAt: '',
    })),
    summary: { total: count, pending: 0, sent: count, opened: 0, started: 0, completed: 0, revoked: 0, expired: 0 },
    anonymity: { anonymous: false, highestRecordableState: 'completed', suppressedStates: [], guarantee: 'Frase del servidor sobre lo que se registra.' },
    ...over,
  }
}

const departments = [
  { id: 'd1', name: 'Finanzas', employeeCount: 6 },
  { id: 'd2', name: 'Ingeniería', employeeCount: 14 },
] as never[]

const users = Array.from({ length: 6 }, (_, i) => ({
  id: `u${i}`, email: `persona${i}@meridiano.test`, name: `Persona ${i}`, role: 'employee', departmentId: i % 2 ? 'd2' : 'd1', isActive: true,
})) as never[]

function renderAs(role: string, element: ReactNode, companyId = 'c1') {
  setToken(tokenFor({ role, companyId, sub: 'u-viewer', name: 'Ana Rojas' }))
  return render(
    <TranslationProvider>
      <CompanyContextProvider>
        <MemoryRouter initialEntries={['/x']}>
          <Routes>
            <Route path="/x" element={element} />
          </Routes>
        </MemoryRouter>
      </CompanyContextProvider>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
  vi.mocked(drafts.getLatestSurveyDraft).mockResolvedValue(null)
})
afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  localStorage.removeItem(LOCALE_STORAGE_KEY)
  vi.clearAllMocks()
})

const detail = (s: SurveyDetail, role = 'company_admin', extra: Partial<Parameters<typeof SurveyDetailView>[0]['model']> = {}) =>
  renderAs(
    role,
    <SurveyDetailView
      model={{ survey: s, departments, distribution: { publicLink: `/s/${LINK_SEGMENT}` } as never, invitations: invitationList(), ...extra }}
      pending={null}
      actionError={null}
      onTransition={() => undefined}
      onDuplicate={() => undefined}
      now={new Date(2026, 8, 10)}
    />,
  )

describe('Detalle de encuesta (SurveyDetail artboard)', () => {
  it('offers a company administrator the header actions and the one transition the server allows', () => {
    detail(survey())
    expect(screen.getByRole('button', { name: 'Duplicar' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Resultados' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Distribución' }).getAttribute('href')).toBe('/surveys/s1/distribution')
    const status = screen.getByTestId('tile-status')
    expect(within(status).getAllByRole('button').map((b) => b.textContent)).toEqual(['Cerrar'])
    const responses = screen.getByTestId('tile-responses')
    expect(responses.textContent).toContain('3')
    expect(responses.textContent).toContain('de 24 · 13 %')
  })

  it('offers a leader nothing to press: no duplicate, no distribution, no transition, no results', () => {
    detail(survey(), 'leader')
    expect(screen.queryByRole('button', { name: 'Duplicar' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Distribución' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Resultados' })).toBeNull()
    expect(within(screen.getByTestId('tile-status')).queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByTestId('detail-questions').textContent).toContain('Puedo plantear preocupaciones.')
  })

  it('prints no count for any department and a dash, never a zero, for an audience nobody stated', () => {
    detail(survey({ targetAudienceCount: null }))
    const rows = within(screen.getByTestId('detail-departments')).getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual(['Finanzas— respuestas', 'Ingeniería— respuestas'])
    expect(screen.getByTestId('tile-audience').querySelector('[data-slot="reading"]')?.textContent).toBe('—')
  })

  it('never puts a character of the share-link token on screen', () => {
    detail(survey())
    expect(screen.getByTestId('detail-link').textContent).not.toContain(LINK_SEGMENT.slice(0, 6))
    expect(document.body.textContent).not.toContain(LINK_SEGMENT.slice(0, 6))
  })
})

const distribution = (list: SurveyInvitationList, role = 'company_admin', scoped = true) =>
  renderAs(
    role,
    <DistributionView
      model={{ survey: survey(), distribution: { publicLink: `/s/${LINK_SEGMENT}`, accessRules: { requireLogin: true } } as never, invitations: list, departments, users, scoped }}
      busy={false}
      notice={null}
      actionError={null}
      onInvite={() => undefined}
      onRemind={() => undefined}
      onCreateLink={() => undefined}
      now={new Date(2026, 8, 10)}
    />,
  )

describe('Distribución (Distribution artboard)', () => {
  it('closes on the sentence the server wrote, verbatim', () => {
    distribution(invitationList())
    expect(screen.getByTestId('guarantee').textContent).toContain('Frase del servidor sobre lo que se registra.')
  })

  it('reads 3 of 4 steps and names the invitations as what is missing', () => {
    distribution(invitationList())
    const ready = screen.getByTestId('tile-ready')
    expect(ready.querySelector('[data-slot="reading"]')?.textContent).toBe('3')
    expect(ready.textContent).toContain('Falta que las invitaciones salgan')
    expect(screen.getByTestId('step-invitations').getAttribute('data-state')).toBe('missing')
    expect(screen.getByTestId('step-audience').textContent).toContain('2 departamentos · 6 personas. Finanzas y Ingeniería.')
  })

  it('shows the first rows of the invitations and the rest on request', async () => {
    distribution(invitationList(6))
    const table = within(screen.getByTestId('step-invitations')).getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(INVITATION_PREVIEW_ROWS + 1)
    await userEvent.click(screen.getByRole('button', { name: 'Ver las 6' }))
    expect(within(table).getAllByRole('row')).toHaveLength(7)
  })

  it('offers an administrator of another company no way to change the audience or send', () => {
    distribution(invitationList(), 'company_admin', false)
    expect(screen.queryByRole('button', { name: 'Cambiar audiencia' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Enviar invitaciones/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Enviar recordatorio/ })).toBeNull()
  })

  it('offers a leader no action at all', () => {
    distribution(invitationList(), 'leader', false)
    expect(screen.queryAllByRole('button').map((b) => b.textContent)).not.toContain('Enviar recordatorio')
    expect(screen.queryByRole('button', { name: 'Crear enlace' })).toBeNull()
  })
})

describe('Nueva encuesta (SurveyBuilder artboard)', () => {
  it('refuses an employee the builder rather than a form that would 403', () => {
    renderAs('employee', <SurveyBuilderNextPage />)
    expect(screen.getByText('Esta cuenta no crea encuestas')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Siguiente' })).toBeNull()
  })

  it("starts in the reader's language, as PR #459 rules", async () => {
    renderAs('company_admin', <SurveyBuilderNextPage />)
    const language = await screen.findByRole('combobox', { name: 'Idioma del contenido' })
    expect(language.textContent).toContain('Español')
  })

  it('creates the survey with the wizard payload, `buildCreateInput` over the same values', async () => {
    const { buildCreateInput } = await import('../../wizardValues')
    const content = {
      version: 1, templateId: '', language: 'es', titleEn: '', titleEs: 'Pulso de octubre', descriptionEn: '', descriptionEs: '',
      type: 'pulse', startDate: '2026-10-01T09:00', endDate: '2026-10-15T17:00', departmentIds: [], targetAudienceCount: '',
      anonymous: true, allowPartialResponses: true, showProgress: true,
      questions: [{ textEn: '', textEs: 'Me siento escuchado.', type: 'likert', required: true, options: [], category: 'trust',
        scaleLabelMinEn: '', scaleLabelMinEs: '', scaleLabelMaxEn: '', scaleLabelMaxEs: '', scaleMin: null, scaleMax: null }],
    }
    vi.mocked(drafts.getLatestSurveyDraft).mockResolvedValue({ id: 'dr1', sessionId: 'x', version: 1, currentStep: 5, content, updatedAt: '2026-09-10T10:00:00Z' } as never)
    vi.mocked(creating.createSurvey).mockResolvedValue({ id: 'new-survey' } as never)
    renderAs('company_admin', <SurveyBuilderNextPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Restaurarla' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Crear el borrador' }))
    await waitFor(() => expect(creating.createSurvey).toHaveBeenCalledTimes(1))
    const sent = vi.mocked(creating.createSurvey).mock.calls[0][1]
    expect(sent.title).toBe('Pulso de octubre')
    expect(sent.questions).toEqual([{ text: 'Me siento escuchado.', type: 'likert', required: true, order: 0, category: 'trust' }])
    expect(Object.keys(sent).sort()).toEqual(Object.keys(buildCreateInput({ ...content, questions: [] } as never, 'c1')).concat('questions').filter((k, i, a) => a.indexOf(k) === i).sort())
  })
})
