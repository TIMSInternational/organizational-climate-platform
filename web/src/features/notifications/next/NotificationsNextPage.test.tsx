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
const DAY = 24 * 60 * 60 * 1000

function closed(over: Partial<NotificationDetail> = {}): NotificationDetail {
  return {
    id: 'n1', userId: 'u1', companyId: 'c1', type: 'survey_completion', channel: 'in_app', priority: 'medium', status: 'delivered',
    title: 'Q3 closed', message: '24 responses.', data: JSON.stringify({ surveyId: 's-q3' }), templateId: null,
    scheduledFor: new Date().toISOString(), sentAt: null, deliveredAt: null, openedAt: null, failedAt: null, failureReason: null, retryCount: 0,
    createdAt: new Date().toISOString(), ...over,
  }
}

/** Three rows as `GET /notifications/mine` could answer them: two unread, one read, the oldest two days back. */
function inbox(): NotificationDetail[] {
  return [
    closed({ id: 'a', createdAt: new Date(Date.now() - DAY / 2).toISOString() }),
    closed({ id: 'b', title: 'Q2 closed', openedAt: new Date().toISOString(), status: 'opened', createdAt: new Date(Date.now() - 2 * DAY).toISOString() }),
    closed({ id: 'c', type: 'deadline_reminder', title: 'Plan due', data: JSON.stringify({ actionPlanId: 'p1' }), createdAt: new Date(Date.now() - DAY).toISOString() }),
  ]
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

  it('draws an empty inbox as exactly that — no rows, no counts, no sample chip, nothing to mark — when the inbox answers none', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    expect(await screen.findByText(copy.emptyTitle)).toBeTruthy()
    expect(screen.getByText(copy.emptyBody)).toBeTruthy()
    expect(document.querySelectorAll('[data-slot="notification-row"]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-slot="facet-chip"]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-slot="sample-chip"]')).toHaveLength(0)
    expect(screen.queryByText(new RegExp(copy.nothingBefore.split('{date}')[0]))).toBeNull()
    expect(screen.queryByRole('button', { name: copy.markAll })).toBeNull()
  })

  it('counts only the rows the inbox returned, dates the footer from the oldest of them, and offers "Mark all as read" while one is unread', async () => {
    const rows = inbox()
    vi.mocked(listMyNotifications).mockResolvedValue(rows)
    renderAs({ role: 'company_admin', companyId: 'c1' })
    expect(await screen.findByText('Plan due')).toBeTruthy()
    expect(document.querySelectorAll('[data-slot="notification-row"]')).toHaveLength(3)
    const chips = [...document.querySelectorAll('[data-slot="facet-chip"]')].map((node) => node.textContent)
    expect(chips).toEqual([
      `${copy.facet.all} 3`,
      `${copy.facet.unread} 2`,
      `${copy.facet.surveys} 2`,
      `${copy.facet.plans} 1`,
      `${copy.facet.reports} 0`,
    ])
    const oldest = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long' }).format(new Date(rows[1].createdAt))
    expect(screen.getByText(copy.nothingBefore.replace('{date}', oldest))).toBeTruthy()
    expect((screen.getByRole('button', { name: copy.markAll }) as HTMLButtonElement).disabled).toBe(false)
    expect(document.querySelectorAll('[data-slot="sample-chip"]')).toHaveLength(0)
  })

  it('keeps "Mark all as read" on the bar but disabled while nothing is unread', async () => {
    vi.mocked(listMyNotifications).mockResolvedValue(inbox().map((row) => ({ ...row, openedAt: new Date().toISOString() })))
    renderAs({ role: 'employee', companyId: 'c1' })
    await screen.findByText('Plan due')
    expect((screen.getByRole('button', { name: copy.markAll }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('draws "Adjust by kind of notice" in the secondary ink, as the artboard does, not the blue link colour', async () => {
    renderAs({ role: 'employee', companyId: 'c1' })
    const link = await screen.findByRole('link', { name: copy.byType })
    expect(link.getAttribute('href')).toBe('/settings/notifications')
    expect(link.className.split(/\s+/)).toContain('text-fg-secondary')
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
