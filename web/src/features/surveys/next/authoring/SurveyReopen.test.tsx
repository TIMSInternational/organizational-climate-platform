import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import { clearToken, setToken } from '../../../../auth/token'
import { CompanyContextProvider } from '../../../../company-context'
import { tokenFor } from '../../../../test/jwtFixture'
import { ApiError } from '../../../../api/authFetch'
import type { SurveyDetail } from '../../api/surveys'
import { SurveyDetailView } from './SurveyDetailNextPage'
import es from '../../../../i18n/es.json'

const R = es.surveys.next.detail.reopen
const CR = 'America/Costa_Rica'
const NOW = new Date('2026-09-10T15:00:00Z')

function closed(over: Partial<SurveyDetail> = {}): SurveyDetail {
  return {
    id: 's1', title: 'Clima Eagle 2026', description: null, companyId: 'c1', createdBy: 'u1',
    type: 'periodic', serviceType: null, status: 'closed', language: 'es', resolvedLocale: 'es', fallbackFields: [],
    startDate: '2026-09-01T14:00:00Z', endDate: '2026-09-08T05:59:00Z', responseCount: 239, targetAudienceCount: null, version: 1,
    departmentIds: [], userIds: [], questions: [],
    settings: { anonymous: true } as SurveyDetail['settings'],
    allowedStatusTransitions: ['archived'], isContentEditable: false, createdAt: '', updatedAt: '',
    ...over,
  }
}

function renderView(s: SurveyDetail, role: string, onReopen = vi.fn(async () => undefined)) {
  setToken(tokenFor({ role, companyId: role === 'super_admin' ? undefined : 'c1', sub: 'u-viewer', name: 'Ana Rojas' }))
  render(
    <TranslationProvider>
      <CompanyContextProvider>
        <MemoryRouter>
          <SurveyDetailView
            model={{ survey: s, departments: [], distribution: null, invitations: null, users: null, timeZone: CR }}
            pending={null}
            actionError={null}
            onTransition={() => undefined}
            onDuplicate={() => undefined}
            onReopen={onReopen}
            now={NOW}
          />
        </MemoryRouter>
      </CompanyContextProvider>
    </TranslationProvider>,
  )
  return onReopen
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
})
afterEach(() => {
  vi.useRealTimers()
  cleanup()
  clearToken()
  localStorage.removeItem(LOCALE_STORAGE_KEY)
})

/**
 * «Reabrir» (ruled 2026-11-08): reopening Eagle on 27 Oct took a developer and an UPDATE. A super
 * admin can now do it from the survey page, with a new close and a reason; nobody else is offered it.
 */
describe('Reopening a closed survey', () => {
  it('is offered to a super admin on a closed survey', async () => {
    renderView(closed(), 'super_admin')

    const status = await screen.findByTestId('tile-status')
    expect(within(status).getByRole('button', { name: R.action })).toBeTruthy()
  })

  it('is not offered to a client administrator, nor on a survey that is not closed', async () => {
    renderView(closed(), 'company_admin')
    expect(within(await screen.findByTestId('tile-status')).queryByRole('button', { name: R.action })).toBeNull()
    cleanup()

    renderView(closed({ status: 'active', allowedStatusTransitions: ['closed'] }), 'super_admin')
    expect(within(await screen.findByTestId('tile-status')).queryByRole('button', { name: R.action })).toBeNull()
  })

  it('says what reopening costs, asks for the new close and a reason, then sends both', async () => {
    const user = userEvent.setup()
    const onReopen = renderView(closed(), 'super_admin')

    await user.click(within(await screen.findByTestId('tile-status')).getByRole('button', { name: R.action }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByTestId('reopen-cost').textContent).toBe(R.cost)

    // Nothing chosen yet: refused before anything is sent.
    await user.click(within(dialog).getByRole('button', { name: R.confirm }))
    expect(within(dialog).getByRole('alert').textContent).toBe(R.errorMissing)

    // 30 Sep 23:59 on the company's clock is 1 Oct 05:59 UTC.
    await user.click(within(dialog).getByRole('button', { name: /^Nuevo cierre/ }))
    await screen.findByRole('grid')
    await user.click(document.body.querySelector<HTMLElement>('td[data-day="2026-09-30"] button')!)
    const time = screen.getByRole('textbox', { name: es.microclimates.next.create.time })
    await user.clear(time)
    await user.type(time, '23:59')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('grid')).toBeNull())

    // A reason is required too.
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: R.confirm }))
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toBe(R.errorReason.replace('{min}', '5'))
    expect(onReopen).not.toHaveBeenCalled()

    await user.type(within(screen.getByRole('dialog')).getByLabelText(R.reasonLabel), 'Irene pidió dos días más')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: R.confirm }))

    expect(onReopen).toHaveBeenCalledWith({ endDate: '2026-10-01T05:59:00.000Z', reason: 'Irene pidió dos días más' })
  })

  it('says a server refusal in Spanish', async () => {
    const user = userEvent.setup()
    renderView(closed(), 'super_admin', vi.fn(async () => {
      throw new ApiError(400, 'English', 'survey_reopen_end_too_soon')
    }))

    await user.click(within(await screen.findByTestId('tile-status')).getByRole('button', { name: R.action }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Nuevo cierre/ }))
    await screen.findByRole('grid')
    await user.click(document.body.querySelector<HTMLElement>('td[data-day="2026-09-30"] button')!)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('grid')).toBeNull())
    await user.type(within(screen.getByRole('dialog')).getByLabelText(R.reasonLabel), 'Ampliación pedida')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: R.confirm }))

    expect(await within(screen.getByRole('dialog')).findByText(es.errors.api.codes.survey_reopen_end_too_soon)).toBeTruthy()
  })
})
