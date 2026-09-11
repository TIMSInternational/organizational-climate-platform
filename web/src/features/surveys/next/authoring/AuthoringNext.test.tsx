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
import type { SurveyInvitationDetail, SurveyInvitationList } from '../../api/surveyDistribution'
import type { AuthoringQuestion } from '../../api/surveyQuestionAuthoring'
import { SurveyDetailView } from './SurveyDetailNextPage'
import SurveyDistributionNextPage, { DistributionView, INVITATION_COLUMNS, INVITATION_PREVIEW_ROWS } from './SurveyDistributionNextPage'
import SurveyBuilderNextPage from './SurveyBuilderNextPage'
import type { DistributionActions, DistributionModel } from './useDistributionModel'
import * as drafts from '../../api/surveyDrafts'
import * as creating from '../../api/surveyCreate'
import * as surveysApi from '../../api/surveys'
import * as distributionApi from '../../api/surveyDistribution'
import * as templatesApi from '../../api/surveyTemplates'
import * as questionAuthoring from '../../api/surveyQuestionAuthoring'
import * as bankApi from '../../../questions/api/questionBank'
import * as usersApi from '../../../org-structure/api/users'

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
  getSurveyTemplate: vi.fn(),
  instantiateSurveyTemplate: vi.fn(),
}))
vi.mock('../../api/surveyQuestionAuthoring', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveyQuestionAuthoring')>()),
  getSurveyQuestionAuthoring: vi.fn(),
  replaceSurveyQuestions: vi.fn(async () => undefined),
}))
vi.mock('../../../questions/api/questionBank', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../questions/api/questionBank')>()),
  listQuestionBankItems: vi.fn(async () => ({ items: [], total: 0 })),
  getQuestionBankItem: vi.fn(),
}))
vi.mock('../../api/surveyDistribution', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveyDistribution')>()),
  getSurveyDistribution: vi.fn(),
  listSurveyInvitations: vi.fn(),
}))
vi.mock('../../../org-structure/api/users', () => ({ listUsers: vi.fn(async () => []) }))
vi.mock('../../api/surveys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveys')>()),
  listSurveyDimensions: vi.fn(async () => []),
  getSurvey: vi.fn(),
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
    settings: { anonymous: false, notificationSendReminders: true, notificationReminderFrequencyDays: 3 } as SurveyDetail['settings'],
    allowedStatusTransitions: ['closed'], isContentEditable: false, createdAt: '', updatedAt: '',
    ...over,
  }
}

function invitationList(count = 0, row: Partial<SurveyInvitationDetail> = {}): SurveyInvitationList {
  return {
    invitations: Array.from({ length: count }, (_, i) => ({
      id: `i${i}`, surveyId: 's1', userId: `u${i}`, email: `persona${i}@meridiano.test`, status: 'sent', isExpired: false,
      sentAt: null, openedAt: null, startedAt: null, completedAt: null, reminderCount: 0, lastReminderSent: null,
      expiresAt: '2026-10-10T12:00:00Z', createdAt: '', ...row,
    })),
    summary: { total: count, pending: 0, sent: count, opened: 0, started: 0, completed: 0, revoked: 0, expired: 0 },
    anonymity: { anonymous: false, highestRecordableState: 'completed', suppressedStates: [], guarantee: 'Frase del servidor sobre lo que se registra.' },
  }
}

const departments = [
  { id: 'd1', name: 'Finanzas', employeeCount: 6 },
  { id: 'd2', name: 'Ingeniería', employeeCount: 14 },
] as never[]

const users = Array.from({ length: 6 }, (_, i) => ({
  id: `u${i}`, email: `persona${i}@meridiano.test`, name: `Persona ${i}`, role: 'employee', departmentId: i % 2 ? 'd2' : 'd1', isActive: true,
})) as never[]

function renderAs(role: string, element: ReactNode, companyId = 'c1', entry = '/x', path = '/x') {
  setToken(tokenFor({ role, companyId, sub: 'u-viewer', name: 'Ana Rojas' }))
  return render(
    <TranslationProvider>
      <CompanyContextProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path={path} element={element} />
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

const reading = (testId: string) => screen.getByTestId(testId).querySelector('[data-slot="reading"]')?.textContent

const detail = (s: SurveyDetail, role = 'company_admin', extra: Partial<Parameters<typeof SurveyDetailView>[0]['model']> = {}) =>
  renderAs(
    role,
    <SurveyDetailView
      model={{ survey: s, departments, distribution: { publicLink: `/s/${LINK_SEGMENT}` } as never, invitations: invitationList(), users: null, ...extra }}
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
    // No directory read and no invitations: the stated target is the only audience known.
    expect(screen.getByTestId('tile-responses').textContent).toContain('de 24 · 13 %')
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
    expect(reading('tile-audience')).toBe('—')
  })

  it("prints Distribución's audience: the directory's 6 over the stated 24, and the invited 41 once they exist", () => {
    detail(survey(), 'company_admin', { users })
    expect(reading('tile-audience')).toBe('6')
    expect(screen.getByTestId('tile-responses').textContent).toContain('de 6 · 50 %')
    expect(screen.getByTestId('tile-responses').textContent).not.toContain('24')
    cleanup()
    detail(survey(), 'company_admin', { users, invitations: invitationList(41) })
    expect(reading('tile-audience')).toBe('41')
    expect(screen.getByTestId('tile-responses').textContent).toContain('de 41 · 7 %')
  })

  it('never puts a character of the share-link token on screen until the reader asks for the link', async () => {
    detail(survey())
    expect(document.body.textContent).not.toContain(LINK_SEGMENT.slice(0, 6))
    await userEvent.click(within(screen.getByTestId('detail-link')).getByRole('button', { name: 'Opciones del enlace' }))
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['Mostrar el enlace'])
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mostrar el enlace' }))
    expect(screen.getByTestId('detail-link').textContent).toContain(`/s/${LINK_SEGMENT}`)
  })

  it("prints the fact sheet's rows as the artboard does: sentence-case type, no anonymity row", () => {
    detail(survey())
    const sheet = screen.getByTestId('detail-sheet')
    expect(sheet.textContent).toContain('Encuesta periódica')
    expect(sheet.textContent).not.toContain('Anonimato')
    expect(sheet.textContent).not.toContain('Con nombre')
  })

  it('states when results are computed as the product computes them: at every read, never "al cerrar"', () => {
    detail(survey())
    expect(document.body.textContent).toContain('Los resultados se calculan cada vez que se leen. Nadie ve las respuestas una por una.')
    expect(document.body.textContent).not.toContain('al cerrar')
  })
})

const noop: DistributionActions = {
  invite: () => undefined,
  remind: () => undefined,
  createLink: () => undefined,
  regenerateLink: () => undefined,
  revokeLink: () => undefined,
  resendInvitation: () => undefined,
  revokeInvitation: () => undefined,
  openCopy: () => undefined,
  editCopy: () => undefined,
  saveCopy: async () => true,
}

const distribution = (
  list: SurveyInvitationList,
  role = 'company_admin',
  scoped = true,
  over: Partial<DistributionModel> = {},
  actions: DistributionActions = noop,
) =>
  renderAs(
    role,
    <DistributionView
      model={{
        survey: survey(),
        distribution: { publicLink: `/s/${LINK_SEGMENT}`, accessType: 'public', accessRules: { requireLogin: true } } as never,
        invitations: list,
        departments,
        users,
        scoped,
        ...over,
      }}
      busy={false}
      notice={null}
      actionError={null}
      actions={actions}
      now={new Date(2026, 8, 10)}
    />,
  )

describe('Distribución (Distribution artboard)', () => {
  it('closes on the sentence the server wrote, verbatim, under the good-ink shield', () => {
    distribution(invitationList())
    expect(screen.getByTestId('guarantee').textContent).toContain('Frase del servidor sobre lo que se registra.')
    expect(screen.getByTestId('guarantee').querySelector('[data-slot="guarantee-shield"]')?.getAttribute('class')).toContain('text-chip-good-ink')
  })

  it('reads 3 of 4 steps and names the invitations as what is missing', () => {
    distribution(invitationList())
    expect(reading('tile-ready')).toBe('3')
    expect(screen.getByTestId('tile-ready').textContent).toContain('Falta que las invitaciones salgan')
    expect(screen.getByTestId('step-invitations').getAttribute('data-state')).toBe('missing')
    expect(screen.getByTestId('step-audience').textContent).toContain('2 departamentos · 6 personas. Finanzas y Ingeniería.')
  })

  it("shows the first rows of the invitations and the rest on request, in the artboard's columns and link ink", async () => {
    distribution(invitationList(6))
    const table = within(screen.getByTestId('step-invitations')).getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(INVITATION_PREVIEW_ROWS + 1)
    expect([...table.querySelectorAll('col')].map((col) => col.style.width)).toEqual([...INVITATION_COLUMNS])
    const seeAll = screen.getByRole('button', { name: 'Ver las 6' })
    expect(seeAll.getAttribute('class')).toContain('text-fg-secondary')
    await userEvent.click(seeAll)
    expect(within(table).getAllByRole('row')).toHaveLength(7)
  })

  it('offers an administrator of another company no way to change the audience, send, or act on an invitation or the link', async () => {
    distribution(invitationList(2), 'company_admin', false)
    for (const name of [/Cambiar audiencia/, /Enviar invitaciones/, /Enviar recordatorio/, /Más acciones de las invitaciones/, /Acciones de la invitación/]) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    await userEvent.click(screen.getByRole('button', { name: 'Opciones del enlace' }))
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['Mostrar el enlace', 'Código QR del enlace'])
  })

  it('offers a leader no action at all', () => {
    distribution(invitationList(), 'leader', false)
    expect(screen.queryAllByRole('button').map((b) => b.textContent)).not.toContain('Enviar recordatorio')
    expect(screen.queryByRole('button', { name: 'Crear enlace' })).toBeNull()
  })

  it('never puts a character of the share-link token on screen until the reader asks, and hides it again', async () => {
    distribution(invitationList())
    expect(screen.getByTestId('step-link').textContent).toContain('/s/')
    expect(document.body.textContent).not.toContain(LINK_SEGMENT.slice(0, 6))
    await userEvent.click(screen.getByRole('button', { name: 'Opciones del enlace' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mostrar el enlace' }))
    expect(screen.getByTestId('step-link').textContent).toContain(`/s/${LINK_SEGMENT}`)
    await userEvent.click(screen.getByRole('button', { name: 'Opciones del enlace' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Ocultar el enlace' }))
    expect(document.body.textContent).not.toContain(LINK_SEGMENT.slice(0, 6))
  })

  it('replaces the link only after the confirmation says the old one stops working', async () => {
    const regenerateLink = vi.fn()
    distribution(invitationList(), 'company_admin', true, {}, { ...noop, regenerateLink })
    await userEvent.click(screen.getByRole('button', { name: 'Opciones del enlace' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Reemplazar enlace' }))
    expect(regenerateLink).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog').textContent).toContain('El enlace actual deja de funcionar')
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Reemplazar enlace' }))
    expect(regenerateLink).toHaveBeenCalledTimes(1)
  })

  it('prints one audience size: the reach, the response rate and the audience line agree', () => {
    // 6 people resolve from the directory; the survey states 24. One number, not both.
    distribution(invitationList())
    expect(reading('tile-reach')).toBe('6')
    expect(screen.getByTestId('tile-responses').textContent).toContain('de 6 · 50 %')
    expect(screen.getByTestId('tile-responses').textContent).not.toContain('24')
    expect(screen.getByTestId('step-audience').textContent).toContain('6 personas')
  })

  it('prints the invited once invitations exist — 41 invited over a directory of 6 — as the reach, the rate and the line', () => {
    distribution(invitationList(41))
    expect(reading('tile-reach')).toBe('41')
    expect(screen.getByTestId('tile-reach').textContent).toContain('personas invitadas')
    expect(screen.getByTestId('tile-responses').textContent).toContain('de 41 · 7 %')
    expect(screen.getByTestId('step-audience').textContent).toContain('2 departamentos · 41 personas.')
  })

  it('calls an audience this viewer cannot count unknown, never "sin personas", and counts it once invitations went out', () => {
    distribution(invitationList(), 'super_admin', false)
    const step = screen.getByTestId('step-audience')
    expect(step.getAttribute('data-state')).toBe('unknown')
    expect(step.textContent).toContain('Audiencia sin contar')
    expect(document.body.textContent).not.toContain('Audiencia sin personas')
    expect(document.body.textContent).not.toContain('Falta una audiencia con personas')
    cleanup()
    distribution(invitationList(41), 'super_admin', false)
    expect(screen.getByTestId('step-audience').getAttribute('data-state')).toBe('done')
    expect(screen.getByTestId('step-audience').textContent).toContain('41 personas invitadas.')
    expect(reading('tile-reach')).toBe('41')
  })

  it('dates the next automatic reminder from the schedule the worker runs, and never says they go by hand', () => {
    distribution(invitationList(2, { sentAt: '2026-09-10T15:30:00Z' }))
    const text = screen.getByTestId('step-reminders').textContent ?? ''
    expect(text).toContain('Ningún recordatorio enviado todavía. Uno programado para el 13 sep, 3 días después del último envío')
    expect(text).not.toContain('a mano')
  })

  it('says the reminders are off when the survey turned them off', () => {
    distribution(invitationList(2, { sentAt: '2026-09-10T15:30:00Z' }), 'company_admin', true, {
      survey: survey({ settings: { anonymous: false, notificationSendReminders: false, notificationReminderFrequencyDays: 3 } as SurveyDetail['settings'] }),
    })
    expect(screen.getByTestId('step-reminders').textContent).toContain('Los recordatorios automáticos están apagados para esta encuesta.')
  })

  it("offers each invitation's resend and revoke to its administrator, never a resend the server refuses", async () => {
    const resendInvitation = vi.fn()
    const list = invitationList(3)
    list.invitations[1] = { ...list.invitations[1], status: 'completed' }
    distribution(list, 'company_admin', true, {}, { ...noop, resendInvitation })
    await userEvent.click(screen.getByRole('button', { name: 'Acciones de la invitación de persona0@meridiano.test' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Reenviar' }))
    expect(resendInvitation).toHaveBeenCalledWith('i0')
    await userEvent.click(screen.getByRole('button', { name: 'Acciones de la invitación de persona1@meridiano.test' }))
    expect((await screen.findByRole('menuitem', { name: 'Reenviar' })).getAttribute('data-disabled')).not.toBeNull()
  })

  it("opens the invitation's own text from the invitations step", async () => {
    const openCopy = vi.fn()
    distribution(invitationList(), 'company_admin', true, {}, { ...noop, openCopy })
    await userEvent.click(screen.getByRole('button', { name: 'Más acciones de las invitaciones' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Texto de la invitación' }))
    expect(openCopy).toHaveBeenCalledTimes(1)
  })
})

describe('Distribución — the role half of the rule, through the page model', () => {
  beforeEach(() => {
    vi.mocked(surveysApi.getSurvey).mockResolvedValue(survey())
    vi.mocked(distributionApi.getSurveyDistribution).mockResolvedValue({ publicLink: `/s/${LINK_SEGMENT}`, accessType: 'public', accessRules: { requireLogin: true } } as never)
    vi.mocked(distributionApi.listSurveyInvitations).mockResolvedValue(invitationList())
    vi.mocked(usersApi.listUsers).mockResolvedValue(users)
  })
  const page = (role: string) => renderAs(role, <SurveyDistributionNextPage />, 'c1', '/surveys/s1/distribution', '/surveys/:surveyId/distribution')

  it('offers an administrator of the survey company the audience and send controls (the control)', async () => {
    page('company_admin')
    expect(await screen.findByRole('button', { name: 'Cambiar audiencia' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Enviar invitaciones/ })).toBeTruthy()
  })

  it("offers a leader of the survey's own company no audience, send, reminder or link control", async () => {
    page('leader')
    await screen.findByTestId('step-audience')
    for (const name of [/Cambiar audiencia/, /Enviar invitaciones/, /Enviar recordatorio/, /Crear enlace/, /Más acciones de las invitaciones/]) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    expect(usersApi.listUsers).not.toHaveBeenCalled()
  })
})

/** The Meridiano template's first two questions, read in `locale`. */
function templateRead(locale: 'es' | 'en', language = 'es') {
  const es = locale === 'es'
  return {
    id: 't1', name: 'Instrumento', language, resolvedLocale: locale, fallbackFields: [],
    questions: [
      { id: 'tq1', text: es ? 'Confío en la dirección.' : 'I trust leadership.', type: 'likert', options: null, scaleMin: 1, scaleMax: 5,
        scaleLabelMin: null, scaleLabelMax: null, required: true, commentRequired: false, commentPrompt: null, order: 0, category: 'trust' },
      { id: 'tq2', text: es ? 'Mi carga es sostenible.' : 'My workload is sustainable.', type: 'likert', options: null, scaleMin: 1, scaleMax: 5,
        scaleLabelMin: null, scaleLabelMax: null, required: true, commentRequired: false, commentPrompt: null, order: 1, category: 'workload' },
    ],
  } as never
}

function restoreDraft(step: number, over: Record<string, unknown> = {}) {
  const content = {
    version: 1, templateId: 't1', language: 'es', titleEn: '', titleEs: 'Clima Q1', descriptionEn: '', descriptionEs: '',
    type: 'periodic', startDate: '2027-01-11T09:00', endDate: '2027-02-01T17:00', departmentIds: [], targetAudienceCount: '',
    anonymous: true, allowPartialResponses: true, showProgress: true, questions: [], ...over,
  }
  vi.mocked(drafts.getLatestSurveyDraft).mockResolvedValue({ id: 'dr1', sessionId: 'x', version: 1, currentStep: step, content, updatedAt: '2026-09-10T10:00:00Z' } as never)
}

async function openBuilder() {
  renderAs('company_admin', <SurveyBuilderNextPage />)
  await userEvent.click(await screen.findByRole('button', { name: 'Restaurarla' }))
}

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

  it("starts in English for an English reader: the reader's locale, not a constant", async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    renderAs('company_admin', <SurveyBuilderNextPage />)
    const language = await screen.findByRole('combobox', { name: 'Content language' })
    expect(language.textContent).toContain('English')
    expect(language.textContent).not.toContain('Spanish')
  })

  it("draws a template's questions as rows like any other: a grip, a live switch and a menu on each", async () => {
    vi.mocked(templatesApi.getSurveyTemplate).mockResolvedValue(templateRead('es'))
    restoreDraft(4)
    await openBuilder()
    const list = await screen.findByTestId('builder-questions')
    await within(list).findByText('Confío en la dirección.')
    expect(screen.getByTestId('builder-step').textContent).toContain('Arrastre para reordenar.')
    expect(list.querySelectorAll('[data-slot="drag-grip"]')).toHaveLength(2)
    const switches = within(list).getAllByRole('switch')
    expect(switches).toHaveLength(2)
    for (const toggle of switches) expect(toggle.hasAttribute('disabled')).toBe(false)
    await userEvent.click(within(list).getByRole('button', { name: 'Acciones de la pregunta 1' }))
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['Subir', 'Bajar', 'Eliminar'])
  })

  it('adds from the bank, the library or blank — from a template too', async () => {
    vi.mocked(templatesApi.getSurveyTemplate).mockResolvedValue(templateRead('es'))
    restoreDraft(4)
    await openBuilder()
    const row = await screen.findByTestId('add-question')
    expect(row.textContent).toContain('· del banco, de la biblioteca o en blanco')
    await userEvent.click(within(row).getByRole('button', { name: /Agregar pregunta/ }))
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['Del banco', 'De la biblioteca', 'En blanco'])
  })

  it("keeps the reader's Spanish on a bilingual template, live — /use takes the language", async () => {
    vi.mocked(templatesApi.getSurveyTemplate).mockImplementation(async (_base, _id, lang) => templateRead(lang === 'en' ? 'en' : 'es', 'both'))
    restoreDraft(4)
    await openBuilder()
    await waitFor(() => expect(templatesApi.getSurveyTemplate).toHaveBeenCalledWith(expect.anything(), 't1', 'en'))
    const language = screen.getByRole('combobox', { name: 'Idioma del contenido' })
    expect(language.textContent).toContain('Español')
    expect(language.hasAttribute('disabled')).toBe(false)
  })

  it('creates a survey from an untouched template with /use alone, in the language shown', async () => {
    vi.mocked(templatesApi.getSurveyTemplate).mockResolvedValue(templateRead('es'))
    vi.mocked(templatesApi.instantiateSurveyTemplate).mockResolvedValue({ id: 'new-survey' } as never)
    restoreDraft(5)
    await openBuilder()
    await waitFor(() => expect(templatesApi.getSurveyTemplate).toHaveBeenCalled())
    await screen.findByText('2')
    await userEvent.click(screen.getByRole('button', { name: 'Crear el borrador' }))
    await waitFor(() => expect(templatesApi.instantiateSurveyTemplate).toHaveBeenCalledTimes(1))
    expect(vi.mocked(templatesApi.instantiateSurveyTemplate).mock.calls[0][2]).toMatchObject({ language: 'es', title: 'Clima Q1' })
    expect(questionAuthoring.replaceSurveyQuestions).not.toHaveBeenCalled()
  })

  it("writes a changed arrangement onto the template's copy: the copied question, the row's required flag", async () => {
    vi.mocked(templatesApi.getSurveyTemplate).mockResolvedValue(templateRead('es'))
    vi.mocked(templatesApi.instantiateSurveyTemplate).mockResolvedValue({ id: 'new-survey' } as never)
    const authored = (text: string) => ({ es: { text, authored: true }, en: { text: '', authored: false } })
    const blank = { es: { text: '', authored: false }, en: { text: '', authored: false } }
    const copied = (order: number, text: string): AuthoringQuestion => ({
      id: `c${order}`, type: 'likert', order, category: order === 0 ? 'trust' : 'workload', required: true, commentRequired: false,
      scaleMin: 1, scaleMax: 5, text: authored(text), scaleLabelMin: blank, scaleLabelMax: blank, commentPrompt: blank, options: null,
    })
    vi.mocked(questionAuthoring.getSurveyQuestionAuthoring).mockResolvedValue({
      surveyId: 'new-survey', title: 'Clima Q1', language: 'es', status: 'draft', locales: ['es'],
      questions: [copied(0, 'Confío en la dirección.'), copied(1, 'Mi carga es sostenible.')],
    })
    restoreDraft(4)
    await openBuilder()
    const list = await screen.findByTestId('builder-questions')
    await within(list).findByText('Confío en la dirección.')
    await userEvent.click(within(list).getAllByRole('switch')[0])
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Crear el borrador' }))
    await waitFor(() => expect(questionAuthoring.replaceSurveyQuestions).toHaveBeenCalledTimes(1))
    const [, id, sent] = vi.mocked(questionAuthoring.replaceSurveyQuestions).mock.calls[0]
    expect(id).toBe('new-survey')
    expect((sent as Record<string, unknown>[]).map((q) => [q.text, q.required, q.order])).toEqual([
      [{ es: 'Confío en la dirección.' }, false, 0],
      [{ es: 'Mi carga es sostenible.' }, true, 1],
    ])
  })

  it('adds a bank question that carries the bank item it came from into the create payload', async () => {
    vi.mocked(bankApi.listQuestionBankItems).mockResolvedValue({
      items: [{ id: 'b1', companyId: null, text: 'Me siento escuchado.', language: 'es', type: 'likert', category: 'trust', isActive: true } as never],
      total: 1,
    })
    vi.mocked(bankApi.getQuestionBankItem).mockResolvedValue({
      id: 'b1', companyId: null, text: 'Me siento escuchado.', language: 'es', type: 'likert', category: 'trust', isActive: true,
      scaleMin: 1, scaleMax: 5, scaleLabelMin: null, scaleLabelMax: null, options: [],
    } as never)
    vi.mocked(creating.createSurvey).mockResolvedValue({ id: 'new-survey' } as never)
    restoreDraft(4, {
      templateId: '',
      questions: [{ textEn: '', textEs: 'Confío en la dirección.', type: 'likert', required: true, options: [], category: 'trust',
        scaleLabelMinEn: '', scaleLabelMinEs: '', scaleLabelMaxEn: '', scaleLabelMaxEs: '', scaleMin: null, scaleMax: null }],
    })
    await openBuilder()
    await userEvent.click(within(await screen.findByTestId('add-question')).getByRole('button', { name: /Agregar pregunta/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Del banco' }))
    const bank = await screen.findByTestId('bank-items')
    await userEvent.click(within(bank).getByRole('button', { name: 'Agregar' }))
    await waitFor(() => expect(within(bank).getByRole('button', { name: 'Agregada' })).toBeTruthy())
    await userEvent.keyboard('{Escape}')
    await within(screen.getByTestId('builder-questions')).findByText('Me siento escuchado.')
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Crear el borrador' }))
    await waitFor(() => expect(creating.createSurvey).toHaveBeenCalledTimes(1))
    const sent = vi.mocked(creating.createSurvey).mock.calls[0][1]
    expect(sent.questions?.map((q) => q.sourceQuestionBankItemId)).toEqual([undefined, 'b1'])
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
