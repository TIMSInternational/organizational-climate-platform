import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { listMicroclimateTemplates, createMicroclimateTemplate } from './microclimateTemplates'

const baseUrl = 'http://api.test'

describe('microclimateTemplates api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('lists templates for a company', async () => {
    const templates = [{ id: 't1', name: 'Template', description: 'desc', category: 'engagement', companyId: 'c1', isSystemTemplate: false, usageCount: 0, isActive: true }]
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ templates }), { status: 200 }))
    const result = await listMicroclimateTemplates(baseUrl, 'c1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/microclimate-templates?companyId=c1`, expect.anything())
    expect(result).toEqual(templates)
  })

  it('creates a template', async () => {
    const created = { id: 't1', name: 'Template', description: 'desc', category: 'engagement', companyId: 'c1', isSystemTemplate: false, usageCount: 0, isActive: true }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201 }))
    const result = await createMicroclimateTemplate(baseUrl, { name: 'Template', description: 'desc', category: 'engagement', companyId: 'c1' })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/microclimate-templates`, expect.objectContaining({ method: 'POST' }))
    expect(result).toEqual(created)
  })
})
