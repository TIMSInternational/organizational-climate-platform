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
import * as surveysApi from '../../api/surveys'
import * as settingsApi from '../../../org-structure/api/companySettings'
import SurveyDetailNextPage, { SurveyDetailView } from './SurveyDetailNextPage'
import es from '../../../../i18n/es.json'

vi.mock('../../api/surveys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveys')>()),
  getSurvey: vi.fn(),
  updateSurveyWindow: vi.fn(),
  updateSurveyStatus: vi.fn(),
  deleteSurvey: vi.fn(),
}))
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
  getCompanySettings: vi.fn(),
}))

const window_ = es.surveys.next.detail.window
const del = es.surveys.next.detail.delete
const CR = 'America/Costa_Rica'

function survey(over: Partial<SurveyDetail> = {}): SurveyDetail {
  return {
    id: 's1', title: 'Clima 2026 (Copia)', description: null, companyId: 'c1', createdBy: 'u1',
    type: 'periodic', serviceType: null, status: 'active', language: 'es', resolvedLocale: 'es', fallbackFields: [],
    startDate: '2026-09-01T14:00:00Z', endDate: '2026-09-30T23:00:00Z', responseCount: 0, targetAudienceCount: null, version: 1,
    departmentIds: [], userIds: [],
    questions: [],
    settings: { anonymous: true } as SurveyDetail['settings'],
    allowedStatusTransitions: ['closed'], isContentEditable: false, createdAt: '', updatedAt: '',
    ...over,
  }
}

/** A closed survey's duplicate: a draft carrying its source's window, already behind "now". */
const duplicatedFromClosed = (over: Partial<SurveyDetail> = {}) =>
  survey({
    status: 'draft',
    startDate: '2026-09-01T14:00:00Z', // 08:00 in Costa Rica
    endDate: '2026-09-05T23:00:00Z', // 17:00 in Costa Rica
    allowedStatusTransitions: ['scheduled', 'active', 'archived'],
    isContentEditable: true,
    ...over,
  })

function renderPage(role = 'company_admin') {
  setToken(tokenFor({ role, companyId: 'c1', sub: 'u-viewer', name: 'Ana Rojas' }))
  return render(
    <TranslationProvider>
      <CompanyContextProvider>
        <MemoryRouter initialEntries={['/surveys/s1']}>
          <Routes>
            <Route path="/surveys/:id" element={<SurveyDetailNextPage />} />
            <Route path="/surveys" element={<p data-testid="survey-list">list</p>} />
          </Routes>
        </MemoryRouter>
      </CompanyContextProvider>
    </TranslationProvider>,
  )
}

function renderView(s: SurveyDetail, handlers: { onSaveWindow?: () => Promise<void>; onDelete?: () => Promise<void> } = {}, role = 'company_admin') {
  setToken(tokenFor({ role, companyId: 'c1', sub: 'u-viewer', name: 'Ana Rojas' }))
  return render(
    <TranslationProvider>
      <CompanyContextProvider>
        <MemoryRouter>
          <SurveyDetailView
            model={{ survey: s, departments: [], distribution: null, invitations: null, users: null, timeZone: CR }}
            pending={null}
            actionError={null}
            onTransition={() => undefined}
            onDuplicate={() => undefined}
            onSaveWindow={handlers.onSaveWindow ?? (async () => undefined)}
            onDelete={handlers.onDelete ?? (async () => undefined)}
            now={new Date('2026-09-10T15:00:00Z')}
          />
        </MemoryRouter>
      </CompanyContextProvider>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  // Only the clock is faked, so user-event's own timers run: "now" is 10 Sep 2026, the day the
  // fixtures' windows are measured against.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-10T15:00:00Z') })
  localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
  vi.mocked(settingsApi.getCompanySettings).mockResolvedValue({
    companyId: 'c1',
    settings: { timezone: CR } as never,
    branding: {} as never,
  })
})
afterEach(() => {
  vi.useRealTimers()
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  localStorage.removeItem(LOCALE_STORAGE_KEY)
  vi.clearAllMocks()
})

describe('Detalle de encuesta — the window and delete (audit G16)', () => {
  it('runs a duplicated survey again: past window, "Activar" disabled → change the close → "Activar" enabled', async () => {
    const user = userEvent.setup()
    vi.mocked(surveysApi.getSurvey).mockResolvedValue(duplicatedFromClosed())
    vi.mocked(surveysApi.updateSurveyWindow).mockImplementation(async (_b, _id, w) =>
      duplicatedFromClosed({ startDate: w.startDate!, endDate: w.endDate }),
    )
    const { baseElement } = renderPage()

    const status = await screen.findByTestId('tile-status')
    expect((within(status).getByRole('button', { name: 'Activar' }) as HTMLButtonElement).disabled).toBe(true)

    // The warning that always said "cambia primero las fechas" now has the way to do it.
    await user.click(within(screen.getByTestId('status-end-passed-block')).getByRole('button', { name: window_.edit }))
    const dialog = await screen.findByRole('dialog')
    // Read on the company's clock, and says so.
    expect(dialog.textContent).toContain('America/Costa_Rica (GMT-6)')
    const startField = within(dialog).getByRole('button', { name: new RegExp(`^${window_.start} `) })
    const endField = within(dialog).getByRole('button', { name: new RegExp(`^${window_.end} `) })
    expect(startField.textContent).toBe('01/09/2026 · 08:00')
    expect(endField.textContent).toBe('05/09/2026 · 17:00')

    // A close in the past is refused before anything is sent.
    await user.click(within(dialog).getByRole('button', { name: window_.save }))
    expect(within(dialog).getByRole('alert').textContent).toBe(window_.errorPast)
    expect(surveysApi.updateSurveyWindow).not.toHaveBeenCalled()

    await user.click(endField)
    await screen.findByRole('grid')
    await user.click(baseElement.querySelector<HTMLElement>('td[data-day="2026-09-30"] button')!)
    const time = screen.getByRole('textbox', { name: es.microclimates.next.create.time })
    await user.clear(time)
    await user.type(time, '23:59')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('grid')).toBeNull())

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: window_.save }))

    // True instants: 23:59 on the 30th in Costa Rica is 05:59 UTC on 1 October.
    await waitFor(() =>
      expect(vi.mocked(surveysApi.updateSurveyWindow).mock.calls.map((call) => call.slice(1))).toEqual([
        ['s1', { startDate: '2026-09-01T14:00:00.000Z', endDate: '2026-10-01T05:59:00.000Z' }, 'es'],
      ]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((within(screen.getByTestId('tile-status')).getByRole('button', { name: 'Activar' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByTestId('sheet-end').textContent).toBe('30 sep 2026 · 23:59')
  })

  it("moves only a live survey's close: the opening is shown, not offered, and not sent", async () => {
    const onSaveWindow = vi.fn(async () => undefined)
    renderView(survey(), { onSaveWindow })

    await userEvent.click(screen.getByRole('button', { name: window_.edit }))
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByRole('button', { name: new RegExp(`^${window_.start} `) }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(dialog).getByTestId('window-start-locked').textContent).toBe(window_.startLocked)
    expect(within(dialog).getByTestId('window-live').textContent).toBe(window_.liveNote)

    await userEvent.click(within(dialog).getByRole('button', { name: window_.save }))
    await waitFor(() => expect(onSaveWindow).toHaveBeenCalledWith({ endDate: '2026-09-30T23:00:00.000Z' }))
  })

  it("says the server's refusal in Spanish, never in the endpoint's English", async () => {
    const onSaveWindow = vi.fn(async () => {
      throw new ApiError(409, 'A survey in status \'closed\' can no longer be rescheduled.')
    })
    renderView(survey(), { onSaveWindow })

    await userEvent.click(screen.getByRole('button', { name: window_.edit }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: window_.save }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toBe(window_.refusedStatus)
    expect(alert.textContent).not.toContain('rescheduled')
  })

  it('offers no date editor once a survey has ended, and none to a leader', () => {
    renderView(survey({ status: 'closed', allowedStatusTransitions: ['archived'], responseCount: 4 }))
    expect(screen.queryByRole('button', { name: window_.edit })).toBeNull()
    cleanup()
    renderView(survey(), {}, 'leader')
    expect(screen.queryByRole('button', { name: window_.edit })).toBeNull()
    expect(screen.queryByRole('button', { name: del.action })).toBeNull()
  })

  it('prints the window on the company clock with its zone, not the browser clock', () => {
    renderView(survey({ startDate: '2026-09-01T03:00:00Z' }))
    // 03:00 UTC on the 1st is 21:00 on 31 August in Costa Rica.
    expect(screen.getByTestId('sheet-start').textContent).toBe('31 ago 2026 · 21:00')
    expect(screen.getByTestId('detail-sheet').textContent).toContain('America/Costa_Rica (GMT-6)')
  })

  it('dates the close tile on the same clock as the sheet, so the two cannot disagree', () => {
    // 05:59 UTC on the 11th is 23:59 on the 10th in Costa Rica.
    renderView(duplicatedFromClosed({ endDate: '2026-10-11T05:59:00Z' }))
    expect(screen.getByTestId('tile-closes').textContent).toContain('10 oct')
    expect(screen.getByTestId('sheet-end').textContent).toBe('10 oct 2026 · 23:59')
  })

  it('never offers "Eliminar" once somebody has answered', () => {
    renderView(survey({ responseCount: 1 }))
    expect(screen.queryByRole('button', { name: del.action })).toBeNull()
  })

  it('deletes only after the word is typed, then goes back to the list', async () => {
    const user = userEvent.setup()
    vi.mocked(surveysApi.getSurvey).mockResolvedValue(duplicatedFromClosed())
    vi.mocked(surveysApi.deleteSurvey).mockResolvedValue(undefined)
    renderPage()

    await user.click(await screen.findByRole('button', { name: del.action }))
    const dialog = await screen.findByRole('alertdialog')
    const confirm = within(dialog).getByRole('button', { name: del.confirm }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    await user.type(within(dialog).getByRole('textbox'), 'elimin')
    expect(confirm.disabled).toBe(true)
    await user.type(within(dialog).getByRole('textbox'), 'ar')
    expect(confirm.disabled).toBe(false)
    await user.click(confirm)

    await waitFor(() => expect(vi.mocked(surveysApi.deleteSurvey).mock.calls.map((call) => call[1])).toEqual(['s1']))
    expect(await screen.findByTestId('survey-list')).toBeTruthy()
  })

  it('says a live survey is live before deleting it, and says a refusal in Spanish', async () => {
    const onDelete = vi.fn(async () => {
      throw new ApiError(409, 'This survey has responses and cannot be deleted. Archive it instead.')
    })
    renderView(survey(), { onDelete })

    await userEvent.click(screen.getByRole('button', { name: del.action }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('Está activa: quien tenga el enlace o un código dejará de poder responder.')
    await userEvent.type(within(dialog).getByRole('textbox'), del.word)
    await userEvent.click(within(dialog).getByRole('button', { name: del.confirm }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toBe(del.refusedResponses)
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  })
})
