import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { listActionPlanTemplates, createActionPlanTemplate } from './actionPlanTemplates'

const baseUrl = 'http://api.test'

describe('actionPlanTemplates api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('lists templates for a company', async () => {
    const templates = [{ id: 't1', name: 'Template', description: 'desc', category: 'hr', companyId: 'c1', tags: [], usageCount: 0, isActive: true }]
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ templates }), { status: 200 }))
    const result = await listActionPlanTemplates(baseUrl, 'c1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/action-plan-templates?companyId=c1`, expect.anything())
    expect(result).toEqual(templates)
  })

  it('creates a template', async () => {
    const created = { id: 't1', name: 'Template', description: 'desc', category: 'hr', companyId: 'c1', tags: [], usageCount: 0, isActive: true }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201 }))
    const result = await createActionPlanTemplate(baseUrl, { name: 'Template', description: 'desc', category: 'hr', companyId: 'c1' })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/action-plan-templates`, expect.objectContaining({ method: 'POST' }))
    expect(result).toEqual(created)
  })

  it('asks for the names in the reader\'s language when given a locale', async () => {
    // The create form's template picker offered the English half of every bilingual
    // name on a Spanish screen; the API resolved `lang` all along.
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ templates: [] }), { status: 200 }))
    await listActionPlanTemplates(baseUrl, 'c1', 'es')
    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]), 'http://test.local')
    expect(url.pathname).toBe('/action-plan-templates')
    expect(url.searchParams.get('companyId')).toBe('c1')
    expect(url.searchParams.get('lang')).toBe('es')
  })
})
