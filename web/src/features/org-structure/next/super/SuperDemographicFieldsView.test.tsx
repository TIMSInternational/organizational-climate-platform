import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import DemographicFieldsPage from '../../pages/DemographicFieldsPage'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../../i18n'
import { CompanyContextProvider } from '../../../../company-context'
import { setToken, clearToken } from '../../../../auth/token'
import { tokenFor } from '../../../../test/jwtFixture'
import type { DemographicField } from '../../api/demographicFields'
import en from '../../../../i18n/en.json'

/**
 * `/admin/companies/:companyId/demographic-fields` for a super administrator — the
 * per-role canvas's Campos demográficos. Rendered through `DemographicFieldsPage`, so the
 * dispatch is pinned with the view; `DemographicFieldsPage.test.tsx` keeps pinning the
 * page a company administrator gets. The tenant is Meridiano's size: 42 active people.
 */
const copy = en.superadmin.next.demographics
const C = 'c1'

function field(values: number, extra: Partial<DemographicField> = {}): DemographicField {
  return {
    id: 'f1',
    companyId: C,
    field: 'antiguedad',
    label: 'Antigüedad',
    type: 'select',
    options: Array.from({ length: values }, (_, index) => ({ order: index, value: `v${index}`, label: `V${index}` })),
    required: false,
    order: 1,
    isActive: true,
    resolvedLocale: 'es',
    fallbackFields: [],
    ...extra,
  }
}

interface Call {
  method: string
  url: string
  body: string | undefined
}
let calls: Call[] = []

function serve(fields: DemographicField[] = []) {
  calls = []
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ method, url, body: typeof init?.body === 'string' ? init.body : undefined })
    const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    if (method === 'POST' && url.includes('/admin/demographic-fields')) return ok(field(4))
    if (url.includes('/admin/demographic-fields')) return ok({ fields })
    if (url.includes('/dashboard/company-admin')) return ok({ companyId: C, activeUserCount: 42, userCount: 42, departments: [] })
    if (url.includes('/admin/departments')) {
      return ok({
        departments: [
          { id: 'd1', companyId: C, name: 'Finanzas', description: null, parentDepartmentId: null, isActive: true, employeeCount: 6 },
          { id: 'd2', companyId: C, name: 'Calidad 18', description: null, parentDepartmentId: null, isActive: false, employeeCount: 0 },
        ],
      })
    }
    if (url.includes(`/admin/companies/${C}`)) {
      return ok({ id: C, name: 'Grupo Meridiano S.A.', emailDomain: null, industry: null, size: null, country: null, subscriptionTier: null, createdAt: '2026-09-10T00:00:00Z', userCount: 42 })
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[`/admin/companies/${C}/demographic-fields`]}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/admin/companies/:companyId/demographic-fields" element={<DemographicFieldsPage />} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

async function addValues(count: number) {
  await userEvent.click(screen.getByRole('button', { name: copy.form.addValue }))
  const input = screen.getByPlaceholderText(copy.form.valuePlaceholder)
  for (let index = 0; index < count; index += 1) await userEvent.type(input, `Tramo ${index + 1}{enter}`)
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  setToken(tokenFor({ role: 'super_admin', companyId: '' }))
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('SuperDemographicFieldsView', () => {
  it('says what results divide by today when the catalogue is empty', async () => {
    serve()
    renderPage()
    expect(await screen.findByText(copy.catalogue.emptyText.replace('{count}', '1'))).toBeTruthy()
    expect(screen.getByText(copy.tiles.fieldsNone)).toBeTruthy()
  })

  it('opens an empty catalogue on the canvas’s first field, its verdict on screen before anything is typed: 42 people across 4 values is 10.5 each, and 9 values would tip it', async () => {
    serve()
    const { container } = renderPage()
    const label = (await screen.findByLabelText(new RegExp(`^${copy.form.label}`))) as HTMLInputElement
    expect(label.value).toBe(copy.starter.label)
    expect((screen.getByLabelText(new RegExp(`^${copy.form.key}`)) as HTMLInputElement).value).toBe(copy.starter.key)
    for (const band of [copy.starter.under1, copy.starter.oneToThree, copy.starter.threeToFive, copy.starter.overFive]) {
      expect(screen.getByText(band)).toBeTruthy()
    }
    expect(container.querySelector('[data-verdict]')?.getAttribute('data-verdict')).toBe('usable')
    expect(container.querySelector('[data-verdict]')?.textContent).toContain('10.5')
    expect(screen.getByText(/With/).textContent).toMatch(/9\D+4\.7/)
    // The key still follows a label the operator types.
    await userEvent.clear(label)
    await userEvent.type(label, 'Antigüedad')
    expect((screen.getByLabelText(new RegExp(`^${copy.form.key}`)) as HTMLInputElement).value).toBe('antiguedad')
  })

  it('calls nine values too narrow, and offers no tipping point past it', async () => {
    serve()
    const { container } = renderPage()
    await screen.findByLabelText(new RegExp(`^${copy.form.label}`))
    await addValues(9)
    expect(container.querySelector('[data-verdict]')?.getAttribute('data-verdict')).toBe('narrow')
    expect(screen.getByText(copy.form.narrowLead)).toBeTruthy()
    // The numbers sit in their own mono spans, so the sentence is read off the page's text.
    expect(document.body.textContent).not.toMatch(/With \d+ values the mean/)
  })

  it('creates the field through the same client, with the values as labels', async () => {
    serve()
    renderPage()
    const label = await screen.findByLabelText(new RegExp(`^${copy.form.label}`))
    await userEvent.clear(label)
    await userEvent.type(label, 'Antigüedad')
    await addValues(2)
    await userEvent.click(screen.getByRole('button', { name: copy.form.create }))
    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true))
    const post = calls.find((call) => call.method === 'POST')
    expect(JSON.parse(post?.body ?? '')).toEqual({
      companyId: C,
      field: 'antiguedad',
      label: 'Antigüedad',
      type: 'select',
      options: [copy.starter.under1, copy.starter.oneToThree, copy.starter.threeToFive, copy.starter.overFive, 'Tramo 1', 'Tramo 2'].map(
        (text) => ({ label: text }),
      ),
      required: false,
      order: 1,
    })
  })

  it('lists an existing field with its verdict, and opens it for editing with its key locked', async () => {
    serve([field(4)])
    renderPage()
    expect(await screen.findByText(copy.catalogue.usable)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: copy.catalogue.editNamed.replace('{label}', 'Antigüedad') }))
    expect(screen.getByRole('heading', { level: 2, name: copy.form.editHeading.replace('{label}', 'Antigüedad') })).toBeTruthy()
    expect((screen.getByLabelText(new RegExp(`^${copy.form.key}`)) as HTMLInputElement).disabled).toBe(true)
  })
})
