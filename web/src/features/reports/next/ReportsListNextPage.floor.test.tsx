import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider } from '../../../company-context'
import { tokenFor } from '../../../test/jwtFixture'
import type { ReportListItem } from '../api/reports'
import ReportsListNextPage from './ReportsListNextPage'

/**
 * The privacy floor on "Contiene", at render.
 *
 * `derive.contentsReading().suppressed` is pinned on its own in `derive.test.ts`; this pins
 * the branch of the PAGE that reads it, because a mutation printing
 * "{survey} · {responses} respuestas" for a suppressed survey survived every other test.
 * The column is sample-fed today, and phase 2 will feed a real `reportOutput` through this
 * very branch — so a survey UNDER the floor is fed through the page's own seam here, by
 * replacing `sampleModel` for this file only: 3 responses against a floor of 5, both of
 * its groups withheld.
 */
vi.mock('./sampleModel', () => ({
  sampleContents: {
    surveyName: 'Pulso de Tesorería',
    responses: 3,
    groups: [
      { name: 'Finanzas', isProtected: true },
      { name: 'Tesorería', isProtected: true },
    ],
    floor: 5,
  },
}))

const CID = 'c1'

const report: ReportListItem = {
  id: 'r-csv',
  title: 'Datos de clima — T3 2026',
  type: 'climate_summary',
  companyId: CID,
  status: 'completed',
  format: 'csv',
  createdAt: '2026-09-10T02:06:09Z',
  isRecurring: false,
  recurrencePattern: null,
  nextGeneration: null,
}

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://test.local')
      if (url.pathname.endsWith('/admin/reports')) return Promise.resolve(new Response(JSON.stringify([report])))
      if (url.pathname.endsWith('/shares')) return Promise.resolve(new Response('[]'))
      return Promise.resolve(new Response(null, { status: 404 }))
    }),
  )
  setToken(tokenFor({ sub: 'u1', nodoId: '', role: 'company_admin', companyId: CID }))
})

afterEach(() => {
  cleanup()
  clearToken()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe('ReportsListNextPage — a survey under the floor', () => {
  it('names the survey and prints no response count, no group count, and no number but the floor', async () => {
    render(
      <TranslationProvider>
        <MemoryRouter initialEntries={[`/admin/companies/${CID}/reports`]}>
          <CompanyContextProvider>
            <Routes>
              <Route path="/admin/companies/:companyId/reports" element={<ReportsListNextPage />} />
            </Routes>
          </CompanyContextProvider>
        </MemoryRouter>
      </TranslationProvider>,
    )
    await screen.findByText('Datos de clima — T3 2026')

    const cell = document.querySelector('tr[data-report-id="r-csv"] [data-slot="report-contents"]')
    expect(cell, 'the contents cell').not.toBeNull()
    const lines = [...cell!.children].map((line) => line.textContent ?? '')
    expect(lines[0]).toBe('Pulso de Tesorería · bajo el umbral, sin números')
    // "x de y grupos" is not printed either: every group of a withheld survey is withheld with it.
    expect(cell!.textContent).not.toContain('grupos')
    // The floor is the one number the cell may carry; the 3 responses never appear.
    expect(lines.at(-1)).toBe('umbral de 5 aplicado · sin texto libre')
    expect((cell!.textContent ?? '').replace('umbral de 5 aplicado', '')).not.toMatch(/\d/)
  })
})
