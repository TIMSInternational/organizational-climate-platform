import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'
import { tokenFor } from '../../../test/jwtFixture'
import { listMyNotifications, type NotificationDetail } from '../api/notifications'
import { getNotificationPreferences, updateNotificationPreferences, type NotificationPreferences } from '../api/notificationPreferences'
import { getProfile, type Profile } from '../../profile/api/profile'
import NotificationsNextPage from './NotificationsNextPage'
import en from '../../../i18n/en.json'
import es from '../../../i18n/es.json'

const copy = en.notifications.next

vi.mock('../api/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/notifications')>()),
  listMyNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
}))
vi.mock('../api/notificationPreferences', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/notificationPreferences')>()),
  getNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
}))
vi.mock('../../profile/api/profile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../profile/api/profile')>()),
  getProfile: vi.fn(),
}))

const prefs: NotificationPreferences = { emailSurveys: true, emailMicroclimates: true, emailActionPlans: true, emailReminders: true, digestFrequency: 'weekly' }

function closed(over: Partial<NotificationDetail> = {}): NotificationDetail {
  return {
    id: 'n1', userId: 'u1', companyId: 'c1', type: 'survey_completion', channel: 'in_app', priority: 'medium', status: 'delivered',
    title: 'Q3 closed', message: '24 responses.', data: JSON.stringify({ surveyId: 's-q3' }), templateId: null,
    scheduledFor: new Date().toISOString(), sentAt: null, deliveredAt: null, openedAt: null, failedAt: null, failureReason: null, retryCount: 0,
    createdAt: new Date().toISOString(), ...over,
  }
}

function renderAs(claims: Record<string, unknown>) {
  setToken(tokenFor({ sub: 'u1', nodoId: '', ...claims }))
  return render(
    <TranslationProvider>
      <CompanyContextProvider>
        <MemoryRouter initialEntries={['/notifications']}>
          <NotificationsNextPage />
        </MemoryRouter>
      </CompanyContextProvider>
    </TranslationProvider>,
  )
}

describe('NotificationsNextPage (/notifications)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('preferredLocale', 'en')
    vi.mocked(listMyNotifications).mockReset().mockResolvedValue([])
    vi.mocked(getNotificationPreferences).mockReset().mockResolvedValue(prefs)
    vi.mocked(updateNotificationPreferences).mockReset().mockImplementation(async (_base, next) => next)
    vi.mocked(getProfile).mockReset().mockResolvedValue({ email: 'ana.rojas@meridiano.test' } as Profile)
  })
  afterEach(() => {
    cleanup()
    clearToken()
    window.localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  })

  it('stands the sample rows in — marked — only when the real inbox loaded empty', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    expect(await screen.findByText(copy.sample.planOverdue.title)).toBeTruthy()
    expect(document.querySelectorAll('[data-slot="sample-chip"]')).toHaveLength(1)
    cleanup()

    vi.mocked(listMyNotifications).mockResolvedValue([closed()])
    renderAs({ role: 'company_admin', companyId: 'c1' })
    expect(await screen.findByText('Q3 closed')).toBeTruthy()
    expect(screen.queryByText(copy.sample.planOverdue.title)).toBeNull()
    expect(document.querySelectorAll('[data-slot="sample-chip"]')).toHaveLength(0)
  })

  it('writes the stand-in rows in the viewer’s language, from the catalogue', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    expect(await screen.findByText('Overdue plan in Finanzas')).toBeTruthy()
    expect(screen.getByText(copy.sample.q3Reminder.body)).toBeTruthy()
    expect(screen.queryByText('Plan atrasado en Finanzas')).toBeNull()
    cleanup()

    window.localStorage.setItem('preferredLocale', 'es')
    renderAs({ role: 'company_admin', companyId: 'c1' })
    expect(await screen.findByText('Plan atrasado en Finanzas')).toBeTruthy()
    expect(screen.getByText(es.notifications.next.sample.q3Reminder.body)).toBeTruthy()
    expect(document.querySelectorAll('[data-slot="notification-row"]')).toHaveLength(6)
  })

  it('offers the results only to a viewer who may open them', async () => {
    vi.mocked(listMyNotifications).mockResolvedValue([closed()])
    renderAs({ role: 'company_admin', companyId: 'c1' })
    const link = await screen.findByRole('link', { name: copy.actionResults })
    expect(link.getAttribute('href')).toBe('/surveys/s-q3/results')
    cleanup()

    renderAs({ role: 'employee', companyId: 'c1' })
    await screen.findByText('Q3 closed')
    expect(screen.queryByRole('link', { name: copy.actionResults })).toBeNull()
  })

  it('turns every mail notice off at once from "By email", and leaves the digest as it was', async () => {
    renderAs({ role: 'employee', companyId: 'c1' })
    await screen.findByText(copy.channelEmail)
    const email = screen.getByText(copy.channelEmail).closest('label')!.querySelector('[role="switch"]') as HTMLElement
    await userEvent.click(email)
    expect(vi.mocked(updateNotificationPreferences).mock.calls[0][1]).toEqual({
      emailSurveys: false, emailMicroclimates: false, emailActionPlans: false, emailReminders: false, digestFrequency: 'weekly',
    })
  })

  it('explains local mail only to a .test address', async () => {
    renderAs({ role: 'employee', companyId: 'c1' })
    await screen.findByText(copy.channelEmail)
    expect(document.querySelector('[data-slot="local-mail-note"]')).not.toBeNull()
    cleanup()

    vi.mocked(getProfile).mockResolvedValue({ email: 'ana@meridiano.cr' } as Profile)
    renderAs({ role: 'employee', companyId: 'c1' })
    await screen.findByText(copy.channelEmail)
    expect(document.querySelector('[data-slot="local-mail-note"]')).toBeNull()
  })
})
