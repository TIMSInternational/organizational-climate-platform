import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { listDepartments, createDepartment, updateDepartment } from './departments'

const BASE_URL = 'http://localhost:5080'

describe('departments API client', () => {
  beforeEach(() => {
    localStorage.setItem('climate_platform_token', 'test-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('lists departments for a company', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ departments: [{ id: 'd1', companyId: 'c1', name: 'Engineering', description: null, parentDepartmentId: null, isActive: true, employeeCount: 0 }] }),
    }))

    const result = await listDepartments(BASE_URL, 'c1')

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Engineering')
  })

  it('creates a department', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'd2', companyId: 'c1', name: 'Sales', description: null, parentDepartmentId: null, isActive: true, employeeCount: 0 }),
    }))

    const result = await createDepartment(BASE_URL, { companyId: 'c1', name: 'Sales', isActive: true })

    expect(result.name).toBe('Sales')
  })

  it('updates a department', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'd1', companyId: 'c1', name: 'Engineering', description: 'Renamed', parentDepartmentId: null, isActive: true, employeeCount: 0 }),
    }))

    const result = await updateDepartment(BASE_URL, 'd1', { description: 'Renamed' })

    expect(result.description).toBe('Renamed')
  })
})
