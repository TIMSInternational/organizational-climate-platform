import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import ProfilePage from './ProfilePage'
import {
  changePassword,
  getProfile,
  getProfileActivity,
  getProfilePreferences,
  updateProfile,
  updateProfileDisplayPreferences,
  type Profile,
  type ProfileActivityEntry,
  type ProfilePreferences,
} from '../api/profile'

vi.mock('../api/profile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/profile')>()),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  changePassword: vi.fn(),
  getProfileActivity: vi.fn(),
  getProfilePreferences: vi.fn(),
  updateProfileDisplayPreferences: vi.fn(),
}))

afterEach(cleanup)

const PROFILE: Profile = {
  id: '11111111-1111-1111-1111-111111111111',
  companyId: '22222222-2222-2222-2222-222222222222',
  companyName: 'Acme',
  email: 'person@acme.com',
  name: 'A Person',
  role: 'employee',
  departmentId: null,
  departmentName: 'Engineering',
  managerId: null,
  isActive: true,
  hasPassword: true,
  lastLoginAt: '2026-08-01T09:00:00Z',
  createdAt: '2026-01-01T09:00:00Z',
  demographics: {},
}

const PREFERENCES: ProfilePreferences = {
  display: { language: 'en', timezone: 'UTC', theme: 'light', dashboardLayout: 'default' },
  notifications: {
    emailSurveys: false,
    emailMicroclimates: true,
    emailActionPlans: true,
    emailReminders: false,
    digestFrequency: 'monthly',
  },
}

const ACTIVITY: ProfileActivityEntry[] = [
  {
    id: 'a1',
    action: 'profile.password_change',
    resource: 'profile',
    resourceId: PROFILE.id,
    success: false,
    timestamp: '2026-08-02T10:00:00Z',
  },
  {
    id: 'a2',
    action: 'profile.update',
    resource: 'profile',
    resourceId: PROFILE.id,
    success: true,
    timestamp: '2026-08-01T10:00:00Z',
  },
]

function renderPage() {
  const router = createMemoryRouter([{ path: '/profile', element: <ProfilePage /> }], {
    initialEntries: ['/profile'],
  })
  return render(
    <TranslationProvider>
      <RouterProvider router={router} />
    </TranslationProvider>,
  )
}

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.mocked(getProfile).mockReset().mockResolvedValue(PROFILE)
    vi.mocked(getProfilePreferences).mockReset().mockResolvedValue(PREFERENCES)
    vi.mocked(getProfileActivity).mockReset().mockResolvedValue(ACTIVITY)
    vi.mocked(updateProfile).mockReset()
    vi.mocked(changePassword).mockReset()
    vi.mocked(updateProfileDisplayPreferences).mockReset()
  })

  it('renders the account, password, preferences and activity sections', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Your profile' })).toBeTruthy()
    expect(await screen.findByDisplayValue('A Person')).toBeTruthy()
    expect(screen.getByText('person@acme.com')).toBeTruthy()
    expect(screen.getByText('Engineering')).toBeTruthy()
    expect(screen.getByText('Employee')).toBeTruthy()

    expect(await screen.findByLabelText(/Current password/)).toBeTruthy()
    expect(await screen.findByDisplayValue('UTC')).toBeTruthy()

    // Failed events are shown, not filtered out.
    expect(await screen.findByText('Password change')).toBeTruthy()
    expect(screen.getByText('Failed')).toBeTruthy()
    expect(screen.getByText('Profile updated')).toBeTruthy()
  })

  it('saves the name and refreshes the activity list', async () => {
    const renamed = { ...PROFILE, name: 'Renamed Person' }
    vi.mocked(updateProfile).mockResolvedValue(renamed)
    renderPage()

    const input = await screen.findByLabelText(/Full name/)
    await userEvent.clear(input)
    await userEvent.type(input, 'Renamed Person')
    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])

    await waitFor(() => expect(updateProfile).toHaveBeenCalledTimes(1))
    // Read the argument rather than matching on the whole call: `VITE_API_BASE_URL` is
    // undefined under vitest, and `expect.anything()` does not match undefined.
    expect(vi.mocked(updateProfile).mock.calls[0][1]).toBe('Renamed Person')
    expect(await screen.findByText('Your profile was saved.')).toBeTruthy()
    // One load on mount, one after the write.
    await waitFor(() => expect(getProfileActivity).toHaveBeenCalledTimes(2))
  })

  /**
   * A whitespace-only name is the case the input's own `required` does not catch — the
   * browser considers " " filled in — which is exactly why the form checks the trimmed
   * value as well.
   */
  it('refuses to submit a whitespace-only name without calling the API', async () => {
    renderPage()

    const input = await screen.findByLabelText(/Full name/)
    await userEvent.clear(input)
    await userEvent.type(input, '   ')
    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])

    expect(await screen.findByText('Enter your name.')).toBeTruthy()
    expect(updateProfile).not.toHaveBeenCalled()
  })

  /**
   * A mistyped confirmation is caught in the browser — the server receives one string and
   * cannot tell a typo from a policy failure.
   */
  it('refuses to submit when the confirmation does not match', async () => {
    renderPage()

    await userEvent.type(await screen.findByLabelText(/Current password/), 'Current1Pass')
    await userEvent.type(screen.getByLabelText(/^New password/), 'Rep1acementPass')
    await userEvent.type(screen.getByLabelText(/Confirm new password/), 'Rep1acementTypo')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('The new passwords do not match.')).toBeTruthy()
    expect(changePassword).not.toHaveBeenCalled()
  })

  it('sends both passwords and clears the fields once the change succeeds', async () => {
    vi.mocked(changePassword).mockResolvedValue('replacement-token')
    renderPage()

    const current = await screen.findByLabelText(/Current password/)
    await userEvent.type(current, 'Current1Pass')
    await userEvent.type(screen.getByLabelText(/^New password/), 'Rep1acementPass')
    await userEvent.type(screen.getByLabelText(/Confirm new password/), 'Rep1acementPass')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))

    await waitFor(() => expect(changePassword).toHaveBeenCalledTimes(1))
    expect(vi.mocked(changePassword).mock.calls[0].slice(1)).toEqual([
      'Current1Pass',
      'Rep1acementPass',
    ])
    expect(await screen.findByText('Your password was changed.')).toBeTruthy()
    // Nothing left sitting in an input after the save.
    expect((current as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/^New password/) as HTMLInputElement).value).toBe('')
  })

  /**
   * A password change now revokes every session for the account (#284), the one that made it
   * included — so the replacement token in the response is this page's next session. Dropping
   * it means the very next request 401s and `authFetch` sends the user to the login page off
   * the back of their own successful save.
   */
  it('stores the replacement token before anything else is fetched', async () => {
    // Every token the page sees when it loads its activity list, in order. The last entry is
    // the reload the password change triggers, and it has to be the replacement -- storing
    // the token after that request goes out would be a 401 and a bounce to /login.
    const tokensAtActivityLoad: (string | null)[] = []

    localStorage.setItem('climate_platform_token', 'stale-token')
    vi.mocked(changePassword).mockResolvedValue('replacement-token')
    vi.mocked(getProfileActivity).mockImplementation(async () => {
      tokensAtActivityLoad.push(localStorage.getItem('climate_platform_token'))
      return ACTIVITY
    })

    renderPage()

    await userEvent.type(await screen.findByLabelText(/Current password/), 'Current1Pass')
    await userEvent.type(screen.getByLabelText(/^New password/), 'Rep1acementPass')
    await userEvent.type(screen.getByLabelText(/Confirm new password/), 'Rep1acementPass')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))

    await waitFor(() => expect(changePassword).toHaveBeenCalledTimes(1))
    expect(localStorage.getItem('climate_platform_token')).toBe('replacement-token')

    // The initial load ran on the old token; the refresh after the change ran on the new one.
    await waitFor(() => expect(tokensAtActivityLoad).toEqual(['stale-token', 'replacement-token']))
  })

  /**
   * Somebody on this form is quite likely there *because* they think they were compromised,
   * so whether the act ends that compromise is the most useful thing to know before
   * submitting. The disclosure is standing copy, shown before they submit rather than in the
   * success alert, and it must survive a refactor of this card. Until #284 it said the
   * opposite, truthfully; this asserts it now says the new truth.
   */
  it('warns that other devices will be signed out, before the change is submitted', async () => {
    renderPage()

    expect(await screen.findByText(/signs you out everywhere else/i)).toBeTruthy()
    // Present from the outset, not only after a successful save.
    expect(screen.queryByText('Your password was changed.')).toBeNull()
  })

  it('surfaces the server rejection verbatim rather than a generic message', async () => {
    vi.mocked(changePassword).mockRejectedValue(new Error('Current password is incorrect'))
    renderPage()

    await userEvent.type(await screen.findByLabelText(/Current password/), 'wrong')
    await userEvent.type(screen.getByLabelText(/^New password/), 'Rep1acementPass')
    await userEvent.type(screen.getByLabelText(/Confirm new password/), 'Rep1acementPass')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Current password is incorrect')
  })

  /**
   * A Google-only account has no current password to prove knowledge of, so the form could
   * never succeed. Hidden rather than disabled — a greyed-out form still reads as a setting.
   */
  it('hides the password form for an account with no password', async () => {
    vi.mocked(getProfile).mockResolvedValue({ ...PROFILE, hasPassword: false })
    renderPage()

    await screen.findByDisplayValue('A Person')
    expect(screen.queryByLabelText(/Current password/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change password' })).toBeNull()
  })

  it('saves display preferences and never a notification preference', async () => {
    vi.mocked(updateProfileDisplayPreferences).mockImplementation((_, display) =>
      Promise.resolve({ display, notifications: PREFERENCES.notifications }),
    )
    renderPage()

    const timezone = await screen.findByLabelText(/Time zone/)
    await userEvent.clear(timezone)
    await userEvent.type(timezone, 'America/Bogota')
    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[1])

    await waitFor(() => expect(updateProfileDisplayPreferences).toHaveBeenCalledTimes(1))
    const [, sent] = vi.mocked(updateProfileDisplayPreferences).mock.calls[0]
    expect(sent.timezone).toBe('America/Bogota')
    expect(Object.keys(sent).some((key) => key.toLowerCase().includes('email'))).toBe(false)
    expect(await screen.findByText('Your preferences were saved.')).toBeTruthy()
  })

  /**
   * Two editors for one set of opt-outs is how they start disagreeing. The profile page
   * links to the notification preferences page instead of restating its switches.
   */
  it('links to the notification preferences page instead of duplicating it', async () => {
    renderPage()

    const link = await screen.findByRole('link', { name: 'Notification preferences' })
    expect(link.getAttribute('href')).toBe('/settings/notifications')
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
  })

  it('shows a load failure instead of an empty page', async () => {
    vi.mocked(getProfile).mockRejectedValue(new Error('Request failed: 500'))
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Your profile could not be loaded.')
    expect(alert.textContent).toContain('Request failed: 500')
    expect(screen.queryByLabelText(/Full name/)).toBeNull()
  })

  /**
   * The three loads are independent: a failure to read the audit trail is no reason to
   * refuse to show someone their own name.
   */
  it('still renders the account when only the activity load fails', async () => {
    vi.mocked(getProfileActivity).mockRejectedValue(new Error('Request failed: 500'))
    renderPage()

    expect(await screen.findByDisplayValue('A Person')).toBeTruthy()
    expect(screen.queryByText('Recent activity')).toBeNull()
  })
})
