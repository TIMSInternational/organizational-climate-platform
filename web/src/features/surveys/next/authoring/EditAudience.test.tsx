import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import { clearToken, setToken } from '../../../../auth/token'
import { COMPANY_CONTEXT_STORAGE_KEY, CompanyContextProvider } from '../../../../company-context'
import { tokenFor } from '../../../../test/jwtFixture'
import { ApiError } from '../../../../api/authFetch'
import type { SurveyDetail } from '../../api/surveys'
import type { Department } from '../../../org-structure/api/departments'
import type { User } from '../../../org-structure/api/users'
import * as surveysApi from '../../api/surveys'
import * as audienceApi from '../../api/surveyAudience'
import * as usersApi from '../../../org-structure/api/users'
import * as departmentsApi from '../../../org-structure/api/departments'
import SurveyDetailNextPage, { SurveyDetailView } from './SurveyDetailNextPage'
import { audienceEditability } from './audienceEdit'
import es from '../../../../i18n/es.json'

vi.mock('../../api/surveys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveys')>()),
  getSurvey: vi.fn(),
}))
vi.mock('../../api/surveyAudience', () => ({ updateSurveyAudience: vi.fn() }))
vi.mock('../../api/surveyDistribution', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveyDistribution')>()),
  getSurveyDistribution: vi.fn(async () => null),
  listSurveyInvitations: vi.fn(async () => {
    throw new Error('unread')
  }),
}))
vi.mock('../../../org-structure/api/departments', () => ({ listDepartments: vi.fn(async () => []) }))
vi.mock('../../../org-structure/api/users', () => ({ listUsers: vi.fn(async () => []) }))
vi.mock('../../../org-structure/api/companySettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../org-structure/api/companySettings')>()),
  getCompanySettings: vi.fn(async () => ({ companyId: 'c1', settings: { timezone: 'America/Costa_Rica' }, branding: {} })),
}))

const K = es.surveys.next.detail.audienceEdit

function person(id: string, name: string, departmentId: string | null = null, isActive = true): User {
  return { id, email: `${id}@acme.test`, name, role: 'employee', departmentId, isActive, lastLoginAt: null, createdAt: '', username: null }
}
const USERS = [person('a', 'Ana Rojas', 'ops'), person('b', 'Bruno Solís', 'ops'), person('c', 'Carla Mora', 'tic'), person('x', 'Xavier Retirado', 'tic', false)]
const DEPARTMENTS: Department[] = [
  { id: 'ops', companyId: 'c1', name: 'Operaciones', description: null, parentDepartmentId: null, isActive: true, employeeCount: 2 },
  { id: 'tic', companyId: 'c1', name: 'TIC', description: null, parentDepartmentId: null, isActive: true, employeeCount: 1 },
]

function survey(over: Partial<SurveyDetail> = {}): SurveyDetail {
  return {
    id: 's1', title: 'Teletrabajo 2026', description: null, companyId: 'c1', createdBy: 'u1',
    type: 'periodic', serviceType: null, status: 'active', language: 'es', resolvedLocale: 'es', fallbackFields: [],
    startDate: '2026-10-19T14:00:00Z', endDate: '2026-10-30T23:00:00Z', responseCount: 4, targetAudienceCount: null, version: 1,
    departmentIds: [], userIds: ['a'],
    questions: [],
    settings: { anonymous: true } as SurveyDetail['settings'],
    allowedStatusTransitions: ['closed'], isContentEditable: false, createdAt: '', updatedAt: '',
    ...over,
  }
}

function renderView(s: SurveyDetail, onSaveAudience = vi.fn(async () => undefined), publicLink: string | null = null) {
  setToken(tokenFor({ role: 'company_admin', companyId: 'c1', sub: 'u-viewer', name: 'Ana Rojas' }))
  render(
    <TranslationProvider>
      <CompanyContextProvider>
        <MemoryRouter>
          <SurveyDetailView
            model={{
              survey: s,
              departments: DEPARTMENTS,
              distribution: publicLink === null ? null : ({ publicLink, accessType: 'public' } as never),
              invitations: null,
              users: USERS,
              timeZone: 'America/Costa_Rica',
            }}
            pending={null}
            actionError={null}
            onTransition={() => undefined}
            onDuplicate={() => undefined}
            onSaveAudience={onSaveAudience}
            now={new Date('2026-10-22T15:00:00Z')}
          />
        </MemoryRouter>
      </CompanyContextProvider>
    </TranslationProvider>,
  )
  return onSaveAudience
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(screen.getByTestId('detail-departments')).getByRole('button', { name: K.action }))
  return screen.findByRole('dialog')
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
})
afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  localStorage.removeItem(LOCALE_STORAGE_KEY)
  vi.clearAllMocks()
})

describe('audienceEditability — the server rule, not a client table', () => {
  it('departments and people on a draft nobody answered; people only once live or answered; nothing once ended', () => {
    expect(audienceEditability({ status: 'draft', isContentEditable: true, responseCount: 0 })).toBe('all')
    expect(audienceEditability({ status: 'draft', isContentEditable: true, responseCount: 2 })).toBe('people')
    expect(audienceEditability({ status: 'scheduled', isContentEditable: false, responseCount: 0 })).toBe('people')
    expect(audienceEditability({ status: 'active', isContentEditable: false, responseCount: 9 })).toBe('people')
    expect(audienceEditability({ status: 'closed', isContentEditable: false, responseCount: 9 })).toBe('ended')
    expect(audienceEditability({ status: 'archived', isContentEditable: false, responseCount: 9 })).toBe('ended')
    expect(audienceEditability({ status: 'mystery', isContentEditable: true, responseCount: 0 })).toBe('ended')
  })
})

describe('Editar audiencia on the survey detail page (G14 follow-up)', () => {
  it('on an active survey: states who gains access and that nobody is notified, then saves the people only', async () => {
    const user = userEvent.setup()
    const save = renderView(survey())
    const dialog = await openDialog(user)

    // Departments are content: on an active survey they are not offered for editing.
    expect(within(dialog).queryByTestId('audience-edit-departments')).toBeNull()
    const saveButton = within(dialog).getByRole('button', { name: K.save }) as HTMLButtonElement
    expect(saveButton.disabled).toBe(true)
    expect(within(dialog).getByTestId('audience-consequence').textContent).toContain(K.unchanged)

    await user.click(within(dialog).getByRole('checkbox', { name: 'Bruno Solís' }))

    expect(within(dialog).getByTestId('audience-before').textContent).toBe('1 persona')
    expect(within(dialog).getByTestId('audience-after').textContent).toBe('2 personas')
    expect(within(dialog).getByTestId('audience-gained').textContent).toBe(`${K.gainedOne} Bruno Solís`)
    expect(within(dialog).queryByTestId('audience-lost')).toBeNull()
    expect(within(dialog).getByTestId('audience-no-mail').textContent).toBe(K.nobodyNotified)
    expect(within(dialog).getByTestId('audience-gained-note').textContent).toBe(K.gainedShared)

    await user.click(saveButton)
    await waitFor(() => expect(save).toHaveBeenCalledWith({ userIds: ['a', 'b'] }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('names who loses access when a person is taken off', async () => {
    const user = userEvent.setup()
    renderView(survey({ userIds: ['a', 'b'] }))
    const dialog = await openDialog(user)

    await user.click(within(dialog).getByRole('checkbox', { name: 'Ana Rojas' }))

    expect(within(dialog).getByTestId('audience-lost').textContent).toBe(`${K.lostOne} Ana Rojas`)
    expect(within(dialog).getByTestId('audience-consequence').textContent).toContain(K.lostNote)
  })

  it('unticking the last named person is stated as opening the survey to the whole company', async () => {
    const user = userEvent.setup()
    renderView(survey())
    const dialog = await openDialog(user)

    await user.click(within(dialog).getByRole('checkbox', { name: 'Ana Rojas' }))

    expect(within(dialog).getByTestId('audience-after').textContent).toBe('toda la empresa (3 personas)')
    expect(within(dialog).getByTestId('audience-widens').textContent).toBe(K.widens)
    expect(within(dialog).getByTestId('audience-gained').textContent).toContain('Bruno Solís')
  })

  it('naming a person on a company-wide survey is stated as closing it to everybody else', async () => {
    const user = userEvent.setup()
    renderView(survey({ userIds: [] }))
    const dialog = await openDialog(user)

    await user.click(within(dialog).getByRole('checkbox', { name: 'Carla Mora' }))

    expect(within(dialog).getByTestId('audience-narrows').textContent).toBe(K.narrows)
    expect(within(dialog).getByTestId('audience-lost').textContent).toBe(`${K.lostMany.replace('{count}', '2')} Ana Rojas y Bruno Solís`)
  })

  it('on a per-person-key survey, says the people added have no key yet and where it is issued', async () => {
    const user = userEvent.setup()
    renderView(survey({ settings: { anonymous: true, credentialMode: 'per_survey' } as never }))
    const dialog = await openDialog(user)

    await user.click(within(dialog).getByRole('checkbox', { name: 'Carla Mora' }))

    expect(within(dialog).getByTestId('audience-gained-note').textContent).toBe(K.gainedPerSurvey)
  })

  it('says the link and QR are untouched when the survey has one', async () => {
    const user = userEvent.setup()
    renderView(survey(), undefined, 'https://climate.example/s/abc')
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('checkbox', { name: 'Carla Mora' }))
    expect(within(dialog).getByTestId('audience-public-link').textContent).toBe(K.publicLink)
  })

  it('on a draft nobody answered: departments are offered too, and both are sent', async () => {
    const user = userEvent.setup()
    const save = renderView(
      survey({ status: 'draft', isContentEditable: true, responseCount: 0, allowedStatusTransitions: ['scheduled', 'active'] }),
    )
    const dialog = await openDialog(user)

    await user.click(within(within(dialog).getByTestId('audience-edit-departments')).getByRole('checkbox', { name: 'TIC' }))
    expect(within(dialog).getByTestId('audience-consequence').textContent).toContain(K.draftNote)
    await user.click(within(dialog).getByRole('button', { name: K.save }))

    await waitFor(() => expect(save).toHaveBeenCalledWith({ departmentIds: ['tic'], userIds: ['a'] }))
  })

  it('a refusal is said in Spanish and the dialog stays open', async () => {
    const user = userEvent.setup()
    renderView(survey({ status: 'draft', isContentEditable: true, responseCount: 0 }), vi.fn(async () => {
      throw new ApiError(409, 'A survey in status ...')
    }))
    const dialog = await openDialog(user)
    await user.click(within(within(dialog).getByTestId('audience-edit-departments')).getByRole('checkbox', { name: 'TIC' }))
    await user.click(within(dialog).getByRole('button', { name: K.save }))

    expect((await within(dialog).findByRole('alert')).textContent).toBe(K.refusedStatus)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it.each(['closed', 'archived'])('on a %s survey the action is disabled and says why', (status) => {
    renderView(survey({ status, allowedStatusTransitions: [] }))
    const button = within(screen.getByTestId('detail-departments')).getByRole('button', { name: K.action }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByTestId('audience-frozen').textContent).toBe(K.endedReason)
  })
})

describe('Editar audiencia through the page model', () => {
  it('PUTs through updateSurveyAudience and the audience card moves with the answer', async () => {
    const user = userEvent.setup()
    setToken(tokenFor({ role: 'company_admin', companyId: 'c1', sub: 'u-viewer', name: 'Ana Rojas' }))
    vi.mocked(surveysApi.getSurvey).mockResolvedValue(survey())
    vi.mocked(usersApi.listUsers).mockResolvedValue(USERS)
    vi.mocked(departmentsApi.listDepartments).mockResolvedValue(DEPARTMENTS)
    vi.mocked(audienceApi.updateSurveyAudience).mockImplementation(async (_b, _id, targets) => survey({ userIds: [...targets.userIds] }))
    render(
      <TranslationProvider>
        <CompanyContextProvider>
          <MemoryRouter initialEntries={['/surveys/s1']}>
            <Routes>
              <Route path="/surveys/:id" element={<SurveyDetailNextPage />} />
            </Routes>
          </MemoryRouter>
        </CompanyContextProvider>
      </TranslationProvider>,
    )

    const card = await screen.findByTestId('detail-departments')
    await user.click(within(card).getByRole('button', { name: K.action }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).getByRole('checkbox', { name: 'Carla Mora' })).toBeTruthy())
    await user.click(within(dialog).getByRole('checkbox', { name: 'Carla Mora' }))
    await user.click(within(dialog).getByRole('button', { name: K.save }))

    await waitFor(() => expect(vi.mocked(audienceApi.updateSurveyAudience).mock.calls[0]?.slice(1)).toEqual(['s1', { userIds: ['a', 'c'] }, 'es']))
    await waitFor(() => expect(screen.getByTestId('detail-departments').textContent).toContain('2'))
  })
})
