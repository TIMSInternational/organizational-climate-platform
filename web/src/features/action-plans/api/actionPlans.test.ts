import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { listActionPlans, createActionPlan, getActionPlan, updateActionPlan, recordProgress } from './actionPlans'

const baseUrl = 'http://api.test'

describe('actionPlans api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  const detail = {
    id: 'p1', title: 'Plan', description: 'desc', companyId: 'c1', departmentId: null, createdBy: 'u1',
    dueDate: '2026-12-01', status: 'not_started', priority: 'medium', tags: [], templateId: null,
    kpis: [], objectives: [],
  }

  it('lists action plans', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ actionPlans: [detail] }), { status: 200 }))
    const result = await listActionPlans(baseUrl, 'c1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/action-plans?companyId=c1`, expect.anything())
    expect(result).toEqual([detail])
  })

  it('creates an action plan', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 201 }))
    const result = await createActionPlan(baseUrl, { title: 'Plan', description: 'desc', companyId: 'c1', dueDate: '2026-12-01', priority: 'medium' })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/action-plans`, expect.objectContaining({ method: 'POST' }))
    expect(result).toEqual(detail)
  })

  it('normalizes a bare "YYYY-MM-DD" due date to an explicit UTC-midnight instant before sending', async () => {
    // A bare date-only string deserializes on the server as midnight in the
    // *server process's* local offset, not UTC -- see actionPlans.ts's
    // normalizeDueDate for the full explanation. Pin the wire format here so a
    // future change can't silently regress back to the ambiguous bare date.
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 201 }))
    await createActionPlan(baseUrl, { title: 'Plan', description: 'desc', companyId: 'c1', dueDate: '2026-12-01', priority: 'medium' })

    const [, init] = vi.mocked(fetch).mock.calls[0]
    const sentBody = JSON.parse(init!.body as string)
    expect(sentBody.dueDate).toBe('2026-12-01T00:00:00.000Z')
  })

  it('leaves an already-explicit due date untouched', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 201 }))
    await createActionPlan(baseUrl, {
      title: 'Plan', description: 'desc', companyId: 'c1', dueDate: '2026-12-01T00:00:00.000-05:00', priority: 'medium',
    })

    const [, init] = vi.mocked(fetch).mock.calls[0]
    const sentBody = JSON.parse(init!.body as string)
    expect(sentBody.dueDate).toBe('2026-12-01T00:00:00.000-05:00')
  })

  it('normalizes a bare due date on update too', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 200 }))
    await updateActionPlan(baseUrl, 'p1', { dueDate: '2026-12-01' })

    const [, init] = vi.mocked(fetch).mock.calls[0]
    const sentBody = JSON.parse(init!.body as string)
    expect(sentBody.dueDate).toBe('2026-12-01T00:00:00.000Z')
  })

  it('gets an action plan', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 200 }))
    const result = await getActionPlan(baseUrl, 'p1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/action-plans/p1`, expect.anything())
    expect(result).toEqual(detail)
  })

  it('updates an action plan', async () => {
    const updated = { ...detail, status: 'in_progress' }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(updated), { status: 200 }))
    const result = await updateActionPlan(baseUrl, 'p1', { status: 'in_progress' })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/action-plans/p1`, expect.objectContaining({ method: 'PUT' }))
    expect(result.status).toBe('in_progress')
  })

  it('records progress', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: 'pu1', updateDate: '2026-01-01', overallNotes: 'notes', updatedBy: 'u1' }), { status: 201 }))
    const result = await recordProgress(baseUrl, 'p1', { overallNotes: 'notes', kpiUpdates: [], objectiveUpdates: [] })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/action-plans/p1/progress`, expect.objectContaining({ method: 'POST' }))
    expect(result.overallNotes).toBe('notes')
  })
})
