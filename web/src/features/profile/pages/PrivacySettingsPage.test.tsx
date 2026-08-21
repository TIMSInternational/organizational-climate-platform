import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { downloadTextFile } from '../../../lib/downloadTextFile'
import PrivacySettingsPage from './PrivacySettingsPage'
import { getMyDataExport, type SubjectAccessExport } from '../api/gdpr'

vi.mock('../api/gdpr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/gdpr')>()),
  getMyDataExport: vi.fn(),
}))

vi.mock('../../../lib/downloadTextFile', () => ({ downloadTextFile: vi.fn() }))

afterEach(cleanup)

const TRACKING_DETAIL =
  'NOT INCLUDED. The climate-tracking service keeps its own Postgres and this API cannot read it.'

const EXPORT: SubjectAccessExport = {
  subject: {
    userId: '11111111-1111-1111-1111-111111111111',
    email: 'person@acme.com',
    name: 'A Person',
  },
  generatedAt: '2026-08-20T09:00:00Z',
  complete: false,
  sources: [
    {
      name: 'organizational-climate-platform (this API Postgres)',
      included: true,
      detail: 'Read in full: one section for each classified table.',
    },
    {
      name: 'services/tracking-api (climate-tracking Postgres)',
      included: false,
      detail: TRACKING_DETAIL,
    },
  ],
  limitations: ['Responses submitted anonymously carry no user_id and are not linked to you.'],
  sections: [
    {
      entity: 'User',
      table: 'users',
      link: 1,
      treatment: 1,
      lawfulBasis: 'Art. 6(1)(b) - necessary to provide the service.',
      retention: 'For as long as the account exists.',
      recordCount: 1,
      records: [
        {
          _link: 'Id',
          Email: 'person@acme.com',
          ConsentUpdatedAt: '2026-07-01T08:00:00Z',
          'Consent.Essential': true,
          'Consent.Analytics': false,
        },
      ],
    },
    {
      entity: 'Survey',
      table: 'surveys',
      link: 2,
      treatment: 2,
      lawfulBasis: 'Art. 6(1)(f) - legitimate interest.',
      retention: 'For as long as the record exists.',
      recordCount: 3,
      records: [],
    },
    // `audit_logs` deliberately: it is the one table in this fixture that the erasure
    // lists do not also name, so "absent before the disclosure is opened" is a claim
    // about the empty-tables list and not about some other panel.
    {
      entity: 'AuditLog',
      table: 'audit_logs',
      link: 1,
      treatment: 1,
      lawfulBasis: 'Art. 6(1)(f) - legitimate interest.',
      retention: 'Retained; never swept.',
      recordCount: 0,
      records: [],
    },
  ],
}

function renderPage() {
  const router = createMemoryRouter(
    [{ path: '/settings/privacy', element: <PrivacySettingsPage /> }],
    { initialEntries: ['/settings/privacy'] },
  )
  return render(
    <TranslationProvider>
      <RouterProvider router={router} />
    </TranslationProvider>,
  )
}

/**
 * `surveys` rather than `users` as the settle signal: `users` is on this page twice, once
 * as a table that holds records about the reader and once in the erasure list, and a
 * matcher that hit either would not prove the export had rendered.
 */
async function requestExport() {
  await userEvent.click(screen.getByRole('button', { name: 'Request my data' }))
  await screen.findByText('surveys')
}

describe('PrivacySettingsPage', () => {
  beforeEach(() => {
    vi.mocked(getMyDataExport).mockReset().mockResolvedValue(EXPORT)
    vi.mocked(downloadTextFile).mockClear()
  })

  it('names its own area, because the nav covers no route under /settings', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Privacy and your data' })
    expect(document.querySelector('[data-slot="page-eyebrow"]')?.textContent).toBe('Account')
  })

  /**
   * Every `GET /gdpr/access` writes an `audit_logs` row, because it is a bulk disclosure of
   * one person's data and the endpoint treats the fact that it happened as evidence. One
   * row per page view would turn that record into noise, so the request has to be an act
   * the reader takes.
   */
  it('discloses nothing until the reader asks', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Privacy and your data' })
    expect(getMyDataExport).not.toHaveBeenCalled()

    await requestExport()
    expect(getMyDataExport).toHaveBeenCalledTimes(1)
  })

  it('lists what is held, and searches tables that hold nothing without hiding them', async () => {
    renderPage()
    await requestExport()

    // Held: one row per table with records, with its basis and retention beside it.
    // `users` is on the page twice — here and in the erasure list — so it is counted
    // rather than fetched.
    expect(screen.getAllByText('users').length).toBe(2)
    expect(screen.getByText('surveys')).toBeTruthy()
    expect(screen.getByText('Exists because you exist')).toBeTruthy()
    expect(screen.getByText('Names you as its author or owner')).toBeTruthy()
    expect(screen.getByText('Identifier and title only')).toBeTruthy()

    // Empty: behind a disclosure, but present and countable.
    expect(screen.queryByText('audit_logs')).toBeNull()
    await userEvent.click(
      screen.getByRole('button', {
        // The count is at the end and the noun is never singular, so neither locale
        // has to agree a number it cannot see.
        name: 'Tables searched that hold nothing about you (1)',
      }),
    )
    expect(screen.getByText('audit_logs')).toBeTruthy()
  })

  /**
   * The one claim this page must never make. `SubjectAccessExport` hardcodes
   * `Complete: false` today because the tracking service's database cannot be read from
   * this API, and presenting a partial export as a finished one is precisely the failure
   * the endpoint's own `Limitations` exist to prevent.
   */
  it('says the answer is incomplete, and names the store that was not read', async () => {
    renderPage()
    await requestExport()

    expect(screen.getByText('This answer is incomplete')).toBeTruthy()
    expect(screen.getByText(TRACKING_DETAIL, { exact: false })).toBeTruthy()
    expect(screen.getAllByText('Not read').length).toBe(1)
  })

  it('stops warning about completeness when the API stops reporting a gap', async () => {
    vi.mocked(getMyDataExport).mockResolvedValue({
      ...EXPORT,
      complete: true,
      sources: [EXPORT.sources[0]],
    })
    renderPage()
    await requestExport()

    expect(screen.queryByText('This answer is incomplete')).toBeNull()
    expect(screen.queryByText('Not read')).toBeNull()
  })

  it('repeats the platform limitations verbatim rather than summarising them', async () => {
    renderPage()
    await requestExport()
    expect(screen.getByText(EXPORT.limitations[0])).toBeTruthy()
  })

  /**
   * Art. 15(3) asks for a commonly used electronic form. A BOM would make the file throw
   * in `JSON.parse`, so the download must ask for none — see `lib/downloadTextFile.ts`.
   */
  it('downloads the whole export as parseable JSON', async () => {
    renderPage()
    await requestExport()
    await userEvent.click(screen.getByRole('button', { name: 'Download as JSON' }))

    const [fileName, mimeType, contents, options] = vi.mocked(downloadTextFile).mock.calls[0]
    expect(fileName).toBe('my-data-2026-08-20.json')
    expect(mimeType).toBe('application/json')
    expect(options).toEqual({ byteOrderMark: false })
    expect(JSON.parse(contents)).toEqual(EXPORT)
  })

  it('offers no download before there is an export to download', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Privacy and your data' })
    expect(screen.queryByRole('button', { name: 'Download as JSON' })).toBeNull()
  })

  it('reports a failed request with the API message and keeps the page usable', async () => {
    vi.mocked(getMyDataExport).mockRejectedValue(new Error('Session expired'))
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Request my data' }))

    expect(await screen.findByText('Your data could not be prepared.')).toBeTruthy()
    expect(screen.getByText('Session expired')).toBeTruthy()
  })

  describe('consent', () => {
    it('shows the stored consent columns once the export has arrived', async () => {
      renderPage()

      expect(
        screen.getByText(
          'Request your data above to see the consent stored on your account. There is no other way to read these columns.',
        ),
      ).toBeTruthy()

      await requestExport()

      expect(screen.getByText('Essential')).toBeTruthy()
      expect(screen.getByText('Granted')).toBeTruthy()
      expect(screen.getByText('Analytics')).toBeTruthy()
      expect(screen.getByText('Not granted')).toBeTruthy()
    })

    /**
     * Nothing in this product writes `UserConsent`, so these values are defaults rather
     * than decisions. Presenting them as choices the reader made would be the page's
     * easiest lie.
     */
    it('says outright that these columns record no decision the reader was offered', async () => {
      renderPage()
      // Worded so it reads in both states: the empty state has no table above it, and a
      // sentence pointing at columns that are not on screen was what the first
      // screenshot of this page showed.
      const note =
        'No screen in this product sets these consent columns, so they hold whatever your account was created with. They are shown because they are stored about you, not because they record a decision you were offered.'
      expect(screen.getByText(note)).toBeTruthy()

      await requestExport()
      expect(screen.getByText(note)).toBeTruthy()
    })
  })

  describe('erasure', () => {
    /**
     * `POST /gdpr/erasure` is administrators only AND refuses a caller naming their own
     * user id, so there is no role for which a self-service erasure button could succeed.
     * A control that could only ever fail is worse than none on a page about trust.
     */
    it('offers no control that would try to erase the reader', async () => {
      renderPage()
      await requestExport()

      const labels = screen.getAllByRole('button').map((button) => button.textContent ?? '')
      expect(labels.filter((label) => /erase|delete|borrar|eliminar/i.test(label))).toEqual([])
      expect(screen.getByText('Erasure is not a button on this page')).toBeTruthy()
    })

    it('states plainly what an erasure removes and what it keeps', async () => {
      renderPage()

      // Removed outright, by table.
      expect(screen.getByText('notifications')).toBeTruthy()
      expect(screen.getByText('user_demographics')).toBeTruthy()

      // Kept, link severed — the claim the issue singles out as the one not to overstate.
      expect(screen.getByText('responses')).toBeTruthy()
      expect(
        screen.getByText(/the answers themselves and the demographic values attached/),
      ).toBeTruthy()

      // Kept in full — and named, because only one of the two audit tables is.
      expect(
        screen.getByText(/The platform-wide audit trail \(audit_logs\) is kept in full/),
      ).toBeTruthy()
      expect(screen.getByText(/Free text is not scrubbed/)).toBeTruthy()

      // The divergence between SubjectDataMap and SubjectErasure, stated the way the code
      // behaves rather than the way the map declares it. `SubjectDataMap` marks
      // survey_audit_logs `Redacted`, but `SubjectErasure` calls
      // `db.SurveyAuditLogs.RemoveRange(...)` and `GdprEndpointsTests` asserts none survive.
      // Telling a data subject the row is kept with their details overwritten would be false
      // in the worst direction. See ERASURE_MAP_DIVERGENCES in `components/privacyScope.ts`.
      expect(screen.getByText('survey_audit_logs')).toBeTruthy()
      expect(screen.getByText(/Your rows are deleted outright, not overwritten/)).toBeTruthy()
    })

    it('hands over the identifiers a controller needs, once they are known', async () => {
      renderPage()
      expect(screen.queryByRole('button', { name: 'Copy details' })).toBeNull()

      await requestExport()

      expect(screen.getByText(/Account id: 11111111-1111-1111-1111-111111111111/)).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Copy details' })).toBeTruthy()
    })

    it('does not claim a copy succeeded when the clipboard refused', async () => {
      const writeText = vi.fn().mockRejectedValue(new Error('denied'))
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })

      renderPage()
      await requestExport()
      await userEvent.click(screen.getByRole('button', { name: 'Copy details' }))

      await waitFor(() => {
        expect(
          screen.getByText('Copying was blocked - select the text above instead.'),
        ).toBeTruthy()
      })
      expect(screen.queryByText('Copied.')).toBeNull()
      vi.unstubAllGlobals()
    })
  })
})
