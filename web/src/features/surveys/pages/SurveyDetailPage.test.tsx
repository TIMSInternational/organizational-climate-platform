import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { setToken, clearToken } from '../../../auth/token'
import SurveyDetailPage from './SurveyDetailPage'
import type { SurveyDetail } from '../api/surveys'

/**
 * These tests render the real page rather than asserting against the components in
 * isolation, deliberately: #79 recorded five defects that a 516-test unit suite could
 * not see because nothing ever mounted the page. What they pin is the set of rules
 * this page is required NOT to reimplement — the transition matrix, the publish gate
 * and the locale resolution all belong to the server, and the failure mode for each is
 * a client that quietly disagrees with it.
 */

function detail(overrides: Partial<SurveyDetail> = {}): SurveyDetail {
  return {
    id: 's1',
    title: 'Q3 climate survey',
    description: null,
    companyId: 'c1',
    createdBy: 'u1',
    type: 'periodic',
    status: 'draft',
    language: 'en',
    resolvedLocale: 'en',
    fallbackFields: [],
    startDate: '2026-09-01T00:00:00Z',
    endDate: '2026-09-30T00:00:00Z',
    responseCount: 0,
    targetAudienceCount: null,
    version: 1,
    departmentIds: [],
    questions: [],
    settings: {
      anonymous: true,
      allowPartialResponses: false,
      randomizeQuestions: false,
      showProgress: true,
      autoSave: true,
      timeLimitMinutes: null,
      responseLimit: null,
      notificationSendInvitations: true,
      notificationSendReminders: true,
      notificationReminderFrequencyDays: 3,
      invitationCustomMessage: null,
      invitationCustomSubject: null,
      invitationIncludeCredentials: false,
      invitationSendImmediately: false,
      invitationBrandingEnabled: true,
    },
    allowedStatusTransitions: ['scheduled', 'active', 'archived'],
    isContentEditable: true,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/surveys/s1']}>
        <Routes>
          <Route path="/surveys/:id" element={<SurveyDetailPage />} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  setToken('test-token')
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SurveyDetailPage', () => {
  it('offers exactly the transitions the server returned, and no others', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(detail())))
    renderPage()

    // draft -> scheduled | active | archived. The three the server sent.
    expect(await screen.findByRole('button', { name: 'Move to Scheduled' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Move to Active' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Move to Archived' })).toBeTruthy()
    // `draft -> closed` is absent from the matrix, so it must be absent here.
    expect(screen.queryByRole('button', { name: 'Move to Closed' })).toBeNull()
  })

  it('offers View results as soon as the survey has responses, whatever its status', async () => {
    // Decision 07 of the admin round: a closed survey's only forward motion used
    // to be "content is frozen — duplicate it", with 24 responses sitting on a
    // page reachable only by URL. Gated on responses, not status: an active
    // survey mid-run has something to show too.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(ok(detail({ status: 'closed', responseCount: 24 }))),
    )
    renderPage()

    const link = await screen.findByRole('link', { name: 'View results' })
    expect(link.getAttribute('href')).toBe('/surveys/s1/results')
  })

  it('offers no results link while nobody has responded', async () => {
    // The results page could only explain that there is nothing yet, and the
    // response count on this page already said so.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(detail({ responseCount: 0 }))))
    renderPage()

    // findAll: the title renders in the heading and again in the breadcrumb.
    await screen.findAllByText('Q3 climate survey')
    expect(screen.queryByRole('link', { name: 'View results' })).toBeNull()
  })

  it('renders no transition buttons for a terminal status, rather than inventing one', async () => {
    // `archived` has no outgoing edges. A client-side matrix is exactly the thing
    // that would offer "reopen" here.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(ok(detail({ status: 'archived', allowedStatusTransitions: [] }))),
    )
    renderPage()

    expect(await screen.findByText('This survey is archived and its status is final.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Move to/ })).toBeNull()
  })

  it('sends the reader’s UI locale as ?lang rather than letting the server default it', async () => {
    // Defaulting resolves against the *survey’s* language, not the reader’s, so a
    // Spanish reader would silently get English on a bilingual survey.
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    const fetchMock = vi.fn().mockResolvedValue(ok(detail()))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await screen.findByRole('heading', { name: 'Q3 climate survey' })
    expect(String(fetchMock.mock.calls[0][0])).toContain('lang=es')
  })

  it('says so when the content is not in the language the reader asked for', async () => {
    // The whole point of shipping `resolvedLocale`. A Spanish-only survey read by an
    // English reader comes back in Spanish; rendering it without saying so is the
    // silent substitution #195 exists to prevent.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        ok(detail({ language: 'es', resolvedLocale: 'es', fallbackFields: ['title'] })),
      ),
    )
    renderPage()

    expect(
      await screen.findByText('Showing content in Spanish because it is not available in English.'),
    ).toBeTruthy()
    expect(screen.getByText('1 individual fields fell back to another language.')).toBeTruthy()
  })

  it('reports per-field fallback even when the payload as a whole is in the right language', async () => {
    // A bilingual survey whose third question was never translated: `resolvedLocale`
    // matches the reader, so the banner is correctly silent, but the field detail is
    // not. Keying the notice off `fallbackFields` alone, or off `resolvedLocale`
    // alone, would lose one of these two cases.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        ok(detail({ language: 'both', fallbackFields: ['questions[2].text'] })),
      ),
    )
    renderPage()

    expect(await screen.findByText('1 individual fields fell back to another language.')).toBeTruthy()
    expect(screen.queryByText(/Showing content in/)).toBeNull()
  })

  it('renders the server’s refusal without blanking the survey underneath it', async () => {
    // The publish gate is server-side and strict only for `language: 'both'`. The page
    // does not pre-check it; it lets the call fail and shows what came back, which
    // names the untranslated field in a way no client-side guess could.
    const message = 'Cannot publish: questions[2].text is missing its English translation.'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(detail({ language: 'both' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message }), { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Move to Active' }))

    expect((await screen.findByRole('alert')).textContent).toContain(message)
    // Still on the page, still showing the survey it was about.
    expect(screen.getByRole('heading', { name: 'Q3 climate survey' })).toBeTruthy()
  })

  it('takes the refreshed transitions from the status response instead of refetching', async () => {
    // The PUT returns the updated detail, so the buttons and the status cannot
    // disagree for a frame.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(detail()))
      .mockResolvedValueOnce(
        ok(detail({ status: 'active', allowedStatusTransitions: ['closed'], isContentEditable: false })),
      )
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Move to Active' }))

    expect(await screen.findByRole('button', { name: 'Move to Closed' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Move to Scheduled' })).toBeNull()
    // Two calls: the initial GET and the PUT. No third.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('drives the editability notice from isContentEditable rather than from the status word', async () => {
    // The server applies a strictly stronger rule than "draft ⇒ editable" (it also
    // refuses when any response exists), so restating the status check here would be
    // restating the weaker half.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(ok(detail({ status: 'draft', isContentEditable: false }))),
    )
    renderPage()

    expect(
      await screen.findByText("This survey's content is frozen. Duplicate it to make changes."),
    ).toBeTruthy()
  })
})
