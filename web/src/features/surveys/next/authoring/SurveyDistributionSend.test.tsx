import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import { clearToken, setToken } from '../../../../auth/token'
import { COMPANY_CONTEXT_STORAGE_KEY, CompanyContextProvider } from '../../../../company-context'
import { tokenFor } from '../../../../test/jwtFixture'
import type { SurveyDetail } from '../../api/surveys'
import type { SurveyInvitationBatchResult, SurveyInvitationList } from '../../api/surveyDistribution'
import SurveyDistributionNextPage from './SurveyDistributionNextPage'
import * as surveysApi from '../../api/surveys'
import * as distributionApi from '../../api/surveyDistribution'
import * as usersApi from '../../../org-structure/api/users'

/**
 * G9, G10 and G11 of the 2026-10-22 gap audit, through the page and its model.
 *
 * - G9: "Enviar" to a per-survey audience over 100 used to be ONE request the server refused.
 *   It is now the same request repeated while the server says people remain, with progress,
 *   a stop on failure, and a resume that mails nobody twice (the server skips key holders).
 * - G10: the invitations block printed "Enviadas 0 / Pendientes = everyone / Sin enviar" for
 *   ever, because nothing is mailed any more. It now counts what is true.
 * - G11: controls that could not succeed are gone, and a draft is offered no send (409).
 */

vi.mock('../../api/surveyDistribution', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveyDistribution')>()),
  getSurveyDistribution: vi.fn(),
  listSurveyInvitations: vi.fn(),
  createSurveyInvitations: vi.fn(),
}))
vi.mock('../../../org-structure/api/departments', () => ({ listDepartments: vi.fn(async () => []) }))
vi.mock('../../../org-structure/api/users', () => ({ listUsers: vi.fn(async () => []) }))
vi.mock('../../../org-structure/api/companies', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listCompanies: vi.fn(async () => [{ id: 'c1', name: 'Servicio Público de Heredia' }]),
}))
vi.mock('../../api/surveys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveys')>()),
  getSurvey: vi.fn(),
  getSurveyParticipation: vi.fn(async () => ({
    surveyId: 's1',
    collectsParticipantIdentity: true,
    answeredCount: 0,
    pendingCount: 0,
    answered: [],
    pending: [],
    startedCount: 0,
    notStartedCount: 0,
    roster: [],
    tracksIndividuals: true,
  })),
}))

/** The audience: six people, company-wide (the survey targets no department and nobody by name). */
const users = Array.from({ length: 6 }, (_, i) => ({
  id: `u${i}`, email: `persona${i}@esph.test`, name: `Persona ${i}`, role: 'employee', departmentId: null, isActive: true,
})) as never[]

function survey(over: Partial<SurveyDetail> = {}): SurveyDetail {
  return {
    id: 's1', title: 'Clima Organizacional', description: null, companyId: 'c1', createdBy: 'u-admin',
    type: 'periodic', serviceType: null, status: 'active', language: 'es', resolvedLocale: 'es', fallbackFields: [],
    startDate: '2026-10-19T12:00:00Z', endDate: '2026-10-28T05:59:00Z', responseCount: 0, targetAudienceCount: null, version: 1,
    departmentIds: [], userIds: [], questions: [],
    settings: { anonymous: true, notificationSendReminders: true, notificationReminderFrequencyDays: 3 } as SurveyDetail['settings'],
    allowedStatusTransitions: ['closed'], isContentEditable: false, createdAt: '', updatedAt: '',
    ...over,
  } as SurveyDetail
}

function list(mode: 'per_survey' | 'shared', rows: { hasCode?: boolean; status?: string }[] = []): SurveyInvitationList {
  const withCode = rows.filter((r) => r.hasCode && r.status !== 'revoked').length
  return {
    credentialMode: mode,
    invitations: rows.map((row, i) => ({
      id: `i${i}`, surveyId: 's1', userId: `u${i}`, email: `persona${i}@esph.test`, status: row.status ?? 'pending', isExpired: false,
      sentAt: null, openedAt: null, startedAt: null, completedAt: null, reminderCount: 0, lastReminderSent: null,
      expiresAt: '2026-10-28T05:59:00Z', createdAt: '', hasCode: row.hasCode ?? false,
    })),
    summary: {
      total: rows.length,
      pending: rows.filter((r) => (r.status ?? 'pending') === 'pending').length,
      sent: 0, opened: 0, started: 0, completed: 0,
      revoked: rows.filter((r) => r.status === 'revoked').length,
      expired: 0,
      withCode,
    },
    anonymity: { anonymous: true, highestRecordableState: 'opened', suppressedStates: ['started', 'completed'], guarantee: 'Frase.' },
  }
}

function batch(over: Partial<SurveyInvitationBatchResult>): SurveyInvitationBatchResult {
  return {
    requested: 617, created: 0, invitationIds: [], skippedUserIds: [], notificationsQueued: 0, undeliverableRecipients: 0, note: null,
    credentialsIssued: 0, credentialsNotSent: 0, remaining: 0, credentialsNotSentEmails: [],
    ...over,
  }
}

function open(s: SurveyDetail, invitations: SurveyInvitationList) {
  vi.mocked(surveysApi.getSurvey).mockResolvedValue(s)
  vi.mocked(distributionApi.getSurveyDistribution).mockResolvedValue(null)
  vi.mocked(distributionApi.listSurveyInvitations).mockResolvedValue(invitations)
  vi.mocked(usersApi.listUsers).mockResolvedValue(users)
  setToken(tokenFor({ role: 'company_admin', companyId: 'c1', sub: 'u-admin', name: 'Ana Rojas' }))
  return render(
    <TranslationProvider>
      <CompanyContextProvider>
        <MemoryRouter initialEntries={['/surveys/s1/distribution']}>
          <Routes>
            <Route path="/surveys/:surveyId/distribution" element={<SurveyDistributionNextPage />} />
          </Routes>
        </MemoryRouter>
      </CompanyContextProvider>
    </TranslationProvider>,
  )
}

async function pressSend(name: RegExp) {
  await userEvent.click(await screen.findByRole('button', { name }))
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name }))
}

beforeEach(() => localStorage.setItem(LOCALE_STORAGE_KEY, 'es'))
afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  localStorage.removeItem(LOCALE_STORAGE_KEY)
  vi.clearAllMocks()
})

describe('Distribución — sending per-survey codes to any audience size (G9)', () => {
  it('repeats the same request while people remain, shows the progress, and names the address that failed', async () => {
    open(survey(), list('per_survey'))
    // 617 people. The first call reaches 99 and one address refuses; five more of 100; the
    // seventh reaches the last 17 and the refusing address fails again; the eighth issues
    // nothing, which is what ends the send instead of retrying that address for ever.
    let release: (value: SurveyInvitationBatchResult) => void = () => undefined
    const create = vi.mocked(distributionApi.createSurveyInvitations)
    create.mockResolvedValueOnce(batch({ created: 100, credentialsIssued: 99, credentialsNotSent: 1, remaining: 518, credentialsNotSentEmails: ['rebota@esph.test'] }))
    create.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
    for (const remaining of [318, 218, 118, 18]) create.mockResolvedValueOnce(batch({ created: 100, credentialsIssued: 100, remaining }))
    create.mockResolvedValueOnce(batch({ created: 17, credentialsIssued: 17, credentialsNotSent: 1, remaining: 1, credentialsNotSentEmails: ['rebota@esph.test'] }))
    create.mockResolvedValueOnce(batch({ credentialsNotSent: 1, remaining: 1, credentialsNotSentEmails: ['rebota@esph.test'] }))

    await pressSend(/Enviar códigos/)

    // Mid-send: the first call answered, the second is in flight.
    expect((await screen.findByTestId('send-progress')).textContent).toContain('Enviando códigos: 99 de 617…')
    release(batch({ created: 100, credentialsIssued: 100, remaining: 418 }))

    const outcome = await screen.findByTestId('send-outcome')
    expect(create).toHaveBeenCalledTimes(8)
    for (const call of create.mock.calls) expect(call[2]).toEqual({ allTargeted: true })
    expect(outcome.textContent).toContain('Se enviaron 616 códigos. 1 persona sigue sin código.')
    expect(within(screen.getByTestId('send-failed')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['rebota@esph.test'])
    expect(screen.queryByTestId('send-progress')).toBeNull()
    // Never the old copy: nothing is queued.
    expect(document.body.textContent).not.toContain('en cola')
  })

  it('stops on a failed call, says how far it got, and resumes with the same request', async () => {
    open(survey(), list('per_survey'))
    const create = vi.mocked(distributionApi.createSurveyInvitations)
    create.mockResolvedValueOnce(batch({ created: 100, credentialsIssued: 100, remaining: 517 }))
    create.mockRejectedValueOnce(new Error('The upstream request timed out'))

    await pressSend(/Enviar códigos/)
    const outcome = await screen.findByTestId('send-outcome')
    expect(create).toHaveBeenCalledTimes(2)
    expect(outcome.textContent).toContain('El envío se detuvo: se enviaron 100 códigos y 517 personas siguen sin el suyo.')
    // The server's English never reaches the screen.
    expect(document.body.textContent).not.toContain('timed out')

    create.mockResolvedValueOnce(batch({ created: 417, credentialsIssued: 100, remaining: 417 }))
    for (const remaining of [317, 217, 117, 17, 0]) create.mockResolvedValueOnce(batch({ credentialsIssued: remaining === 0 ? 17 : 100, remaining }))
    await userEvent.click(within(outcome).getByRole('button', { name: 'Reanudar el envío' }))
    await waitFor(() => expect(screen.getByTestId('send-outcome').textContent).toContain('Se enviaron 517 códigos. Todas las personas de la audiencia tienen el suyo.'))
    expect(create).toHaveBeenCalledTimes(8)
    expect(create.mock.calls[2][2]).toEqual({ allTargeted: true })
  })

  it('never invents a remainder when the very first call fails', async () => {
    open(survey(), list('per_survey'))
    vi.mocked(distributionApi.createSurveyInvitations).mockRejectedValueOnce(new Error('boom'))
    await pressSend(/Enviar códigos/)
    expect((await screen.findByTestId('send-outcome')).textContent).toContain(
      'El envío se detuvo después de enviar 0 códigos. Nadie recibe un código dos veces, así que puede reanudarlo.',
    )
    expect(screen.getByTestId('send-outcome').textContent).not.toContain('0 personas')
  })

  it('moves the keys mailed so far between the buckets while the send runs', async () => {
    open(survey(), list('per_survey'))
    const create = vi.mocked(distributionApi.createSurveyInvitations)
    create.mockResolvedValueOnce(batch({ created: 4, credentialsIssued: 4, remaining: 2 }))
    create.mockImplementationOnce(() => new Promise(() => undefined))
    await pressSend(/Enviar códigos/)
    await screen.findByText('Enviando códigos: 4 de 6…')
    const buckets = screen.getByTestId('invitation-buckets').textContent
    expect(buckets).toContain('Con código enviado4')
    expect(buckets).toContain('Sin código2')
    expect(document.body.textContent).not.toContain('Nadie tiene código todavía')
  })

  it('makes one call on a shared survey, mails nothing, and says so', async () => {
    open(survey(), list('shared'))
    vi.mocked(distributionApi.createSurveyInvitations).mockResolvedValueOnce(batch({ requested: 6, created: 6, remaining: 0 }))
    await pressSend(/Registrar la audiencia/)
    expect((await screen.findByTestId('send-outcome')).textContent).toBe('Se registraron 6 personas en la audiencia.')
    expect(distributionApi.createSurveyInvitations).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('send-progress')).toBeNull()
  })
})

describe('Distribución — the invitations block counts what is true (G10)', () => {
  it('counts keys on a per-survey survey: with code, without code against the audience, and per row', async () => {
    // Six in the audience; three invited, two of whom hold a key; nobody "sent", as always now.
    open(survey(), list('per_survey', [{ hasCode: true }, { hasCode: true }, { hasCode: false }]))
    const step = await screen.findByTestId('step-invitations')
    expect(within(step).getByRole('heading', { level: 3 }).textContent).toBe('Códigos de acceso')
    const buckets = within(step).getByTestId('invitation-buckets').textContent
    expect(buckets).toContain('Con código enviado2')
    expect(buckets).toContain('Sin código4')
    expect(step.getAttribute('data-state')).toBe('missing')
    const chips = within(within(step).getByRole('table')).getAllByText(/código/i).map((chip) => chip.textContent)
    expect(chips).toEqual(['Código enviado', 'Código enviado', 'Sin código'])
    // The invitations block's old vocabulary. ("Pendientes" is checked in this step only: the
    // participation panel above has its own, true, "Pendientes" -- people who have not answered.)
    for (const stale of ['Sin enviar', 'Enviadas', 'Pendientes']) expect(step.textContent).not.toContain(stale)
    for (const stale of ['Recordatorios', 'Salen solos', 'Enviar recordatorio']) expect(document.body.textContent).not.toContain(stale)
  })

  it('completes the step once everyone in the audience holds a key', async () => {
    open(survey(), list('per_survey', Array.from({ length: 6 }, () => ({ hasCode: true }))))
    expect((await screen.findByTestId('step-invitations')).getAttribute('data-state')).toBe('done')
    expect(screen.getByTestId('tile-ready').textContent).toContain('Todo listo para lanzar')
  })

  it('completes a shared survey on the invitation records alone, though every one is "pending"', async () => {
    open(survey(), list('shared', Array.from({ length: 6 }, () => ({}))))
    const step = await screen.findByTestId('step-invitations')
    expect(step.getAttribute('data-state')).toBe('done')
    expect(within(step).getByTestId('invitation-buckets').textContent).toContain('Registradas6')
    expect(within(within(step).getByRole('table')).getAllByText('En la audiencia')).toHaveLength(4)
  })
})

describe('Distribución — a draft is offered no send (G11)', () => {
  it('shows no send and no audience change on a draft, and says why', async () => {
    open(survey({ status: 'draft', allowedStatusTransitions: ['active'] }), list('per_survey'))
    const step = await screen.findByTestId('step-invitations')
    expect(screen.queryByRole('button', { name: /Enviar códigos/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cambiar audiencia' })).toBeNull()
    expect(step.textContent).toContain('La encuesta es un borrador: se podrá enviar cuando esté publicada.')
  })
})
