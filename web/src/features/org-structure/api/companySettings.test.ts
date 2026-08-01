import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { updateCompanySettings } from './companySettings'

const baseUrl = 'http://api.test'

describe('companySettings api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('updates company settings', async () => {
    const result = {
      companyId: 'c1',
      settings: { surveyFrequency: 'monthly', microclimateEnabled: true, aiInsightsEnabled: true, anonymousSurveys: false, dataRetentionDays: 2555, timezone: 'UTC', language: 'en' },
      branding: { logoUrl: null, primaryColor: '#3B82F6', secondaryColor: '#1F2937', fontFamily: 'Inter', customCss: null },
    }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(result), { status: 200 }))

    const response = await updateCompanySettings(baseUrl, 'c1', { surveyFrequency: 'monthly' })

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/companies/c1/settings`, expect.objectContaining({ method: 'PUT' }))
    expect(response.settings.surveyFrequency).toBe('monthly')
  })
})
