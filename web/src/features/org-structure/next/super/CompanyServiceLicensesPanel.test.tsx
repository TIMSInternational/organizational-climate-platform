import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CompanyServiceLicensesPanel from './CompanyServiceLicensesPanel'
import { TranslationProvider } from '../../../../i18n'
import en from '../../../../i18n/en.json'

const copy = en.superadmin.next.companyDetail.licenses
const COMPANY = 'c1'

function service(overrides: Record<string, unknown> = {}) {
  return {
    serviceType: 'general_climate',
    seatsTotal: 100,
    seatsUsed: 3,
    status: 'active',
    licensed: true,
    notes: null,
    updatedAt: '2026-09-16T00:00:00Z',
    ...overrides,
  }
}

function serve() {
  return vi.fn((_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          services: [
            service(),
            service({ serviceType: 'organizational_culture', licensed: false, seatsTotal: 0, seatsUsed: 0 }),
            service({ serviceType: 'microclimate', seatsTotal: 50, seatsUsed: 50 }),
          ],
        }),
      })
    }
    // PUT grant
    const body = JSON.parse((init?.body as string) ?? '{}')
    return Promise.resolve({ ok: true, json: () => Promise.resolve(service({ seatsTotal: body.seatsTotal, seatsUsed: 3 })) })
  })
}

function renderPanel() {
  return render(
    <TranslationProvider>
      <CompanyServiceLicensesPanel companyId={COMPANY} />
    </TranslationProvider>,
  )
}

describe('CompanyServiceLicensesPanel', () => {
  beforeEach(() => {
    localStorage.setItem('climate_platform_token', 'test-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    cleanup()
  })

  it('shows every metered service, its seat usage, and the unlicensed state', async () => {
    vi.stubGlobal('fetch', serve())
    renderPanel()

    expect(await screen.findByText(copy.serviceGeneralClimate)).toBeTruthy()
    expect(screen.getByText(copy.serviceOrganizationalCulture)).toBeTruthy()
    expect(screen.getByText(copy.serviceMicroclimate)).toBeTruthy()
    expect(screen.getByText(copy.notLicensed)).toBeTruthy()
    expect(screen.getByText('3 / 100 seats')).toBeTruthy()
  })

  it('grants seats with a PUT and reflects the new total', async () => {
    const fetchMock = serve()
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()

    const seatsInput = (await screen.findAllByLabelText(copy.seatsField))[0]
    await userEvent.clear(seatsInput)
    await userEvent.type(seatsInput, '250')
    await userEvent.click(screen.getAllByRole('button', { name: copy.save })[0])

    await waitFor(() => {
      const put = fetchMock.mock.calls.find((c) => (c[1]?.method ?? 'GET') === 'PUT')
      expect(put).toBeTruthy()
      expect(String(put?.[0])).toContain(`/admin/companies/${COMPANY}/licenses/general_climate`)
      expect(JSON.parse((put?.[1]?.body as string) ?? '{}')).toEqual({ seatsTotal: 250 })
    })
  })
})
