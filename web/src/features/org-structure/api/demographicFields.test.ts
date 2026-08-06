import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { listDemographicFields, createDemographicField, updateDemographicField } from './demographicFields'

const baseUrl = 'http://api.test'

describe('demographicFields api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('lists fields for a company', async () => {
    const fields = [{ id: 'f1', companyId: 'c1', field: 'gender', label: 'Gender', type: 'select', options: ['A', 'B'], required: true, order: 1, isActive: true }]
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ fields }), { status: 200 }))
    const result = await listDemographicFields(baseUrl, 'c1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/demographic-fields?companyId=c1`, expect.anything())
    expect(result).toEqual(fields)
  })

  it('creates a field', async () => {
    const created = { id: 'f1', companyId: 'c1', field: 'gender', label: 'Gender', type: 'select', options: ['A', 'B'], required: true, order: 1, isActive: true }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201 }))
    const result = await createDemographicField(baseUrl, { companyId: 'c1', field: 'gender', label: 'Gender', type: 'select', options: [{ label: 'A' }, { label: 'B' }], required: true, order: 1 })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/demographic-fields`, expect.objectContaining({ method: 'POST' }))
    expect(result).toEqual(created)
  })

  it('updates a field', async () => {
    const updated = { id: 'f1', companyId: 'c1', field: 'gender', label: 'Gender Identity', type: 'select', options: ['A', 'B'], required: true, order: 1, isActive: true }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(updated), { status: 200 }))
    const result = await updateDemographicField(baseUrl, 'f1', { label: 'Gender Identity' })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/admin/demographic-fields/f1`, expect.objectContaining({ method: 'PUT' }))
    expect(result.label).toBe('Gender Identity')
  })
})
