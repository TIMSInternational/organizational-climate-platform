import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { credentialModeOf, getCompanySettings, updateCompanySettings } from './companySettings'
import { getIntakeCredentialMode, IntakeRequestError, submitIntakeRows } from './intake'

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

  it('reads the settings with a GET, never a write', async () => {
    const result = {
      companyId: 'c1',
      settings: { surveyFrequency: 'monthly', microclimateEnabled: true, aiInsightsEnabled: true, anonymousSurveys: false, dataRetentionDays: 2555, timezone: 'UTC', language: 'es', credentialMode: 'per_survey' },
      branding: { logoUrl: null, primaryColor: '#3B82F6', secondaryColor: '#1F2937', fontFamily: 'Inter', customCss: null },
    }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(result), { status: 200 }))

    const response = await getCompanySettings(baseUrl, 'c1')

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit | undefined]
    expect(url).toBe(`${baseUrl}/admin/companies/c1/settings`)
    expect(init?.method ?? 'GET').toBe('GET')
    expect(init?.body).toBeUndefined()
    expect(response.settings.credentialMode).toBe('per_survey')
  })

  it('reads an absent or unknown mode as the API default, shared', () => {
    expect(credentialModeOf({ credentialMode: 'per_survey' })).toBe('per_survey')
    expect(credentialModeOf({ credentialMode: 'shared' })).toBe('shared')
    expect(credentialModeOf({})).toBe('shared')
    expect(credentialModeOf(null)).toBe('shared')
  })

  it('gives the intake wizard the mode, or null when the settings cannot be read', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ companyId: 'c1', settings: { credentialMode: 'per_survey' }, branding: {} }), { status: 200 }),
    )
    expect(await getIntakeCredentialMode(baseUrl, 'c1')).toBe('per_survey')

    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ message: 'no' }), { status: 403 }))
    expect(await getIntakeCredentialMode(baseUrl, 'c1')).toBeNull()
  })

  it('keeps the code of a 400 from the rows endpoint, so the wizard can say it in the reader’s language', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'This company issues credentials per survey…', code: 'credentials_not_available_per_survey' }), { status: 400 }),
    )

    const error = await submitIntakeRows(baseUrl, 'c1', [], true, [], true).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(IntakeRequestError)
    expect((error as IntakeRequestError).code).toBe('credentials_not_available_per_survey')
    expect((error as IntakeRequestError).status).toBe(400)
  })
})
