import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken, clearToken } from '../../../auth/token'
import { listMicroclimates, createMicroclimate, getMicroclimate, getMicroclimatePublic, updateMicroclimate, getLiveResults, submitResponse } from './microclimates'

const baseUrl = 'http://api.test'

describe('microclimates api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  const detail = {
    id: 'm1', title: 'Pulse', description: null, companyId: 'c1', createdBy: 'u1', status: 'draft',
    responseCount: 0, targetParticipantCount: 10, startTime: '2026-01-01', endTime: '2026-01-02',
    anonymousResponses: true, showLiveResults: true, questions: [],
  }

  it('lists microclimates', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ microclimates: [detail] }), { status: 200 }))
    const result = await listMicroclimates(baseUrl, 'c1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/microclimates?companyId=c1`, expect.anything())
    expect(result).toEqual([detail])
  })

  it('creates a microclimate', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 201 }))
    const result = await createMicroclimate(baseUrl, { title: 'Pulse', companyId: 'c1', startTime: '2026-01-01', endTime: '2026-01-02', targetParticipantCount: 10, anonymousResponses: true })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/microclimates`, expect.objectContaining({ method: 'POST' }))
    expect(result).toEqual(detail)
  })

  it('gets a microclimate', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 200 }))
    const result = await getMicroclimate(baseUrl, 'm1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/microclimates/m1`, expect.anything())
    expect(result).toEqual(detail)
  })

  it('updates a microclimate', async () => {
    const updated = { ...detail, status: 'active' }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(updated), { status: 200 }))
    const result = await updateMicroclimate(baseUrl, 'm1', { status: 'active' })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/microclimates/m1`, expect.objectContaining({ method: 'PUT' }))
    expect(result.status).toBe('active')
  })

  it('gets live results', async () => {
    const live = { sentimentScore: 0, engagementLevel: 'medium', wordCloud: [], responseCount: 2, targetParticipantCount: 10 }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(live), { status: 200 }))
    const result = await getLiveResults(baseUrl, 'm1')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/microclimates/m1/live-results`, expect.anything())
    expect(result).toEqual(live)
  })

  it('submits a response without auth', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 201 }))
    await submitResponse(baseUrl, 'm1', { q1: 'good' })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/microclimates/m1/responses`, expect.objectContaining({ method: 'POST' }))
  })

  describe('getMicroclimatePublic', () => {
    it('fetches without an Authorization header when no token is stored', async () => {
      clearToken()
      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 200 }))
      const result = await getMicroclimatePublic(baseUrl, 'm1')
      expect(fetch).toHaveBeenCalledWith(`${baseUrl}/microclimates/m1`, { headers: {} })
      expect(result).toEqual(detail)
    })

    it('attaches an Authorization header when a token happens to be present', async () => {
      setToken('test-token')
      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(detail), { status: 200 }))
      await getMicroclimatePublic(baseUrl, 'm1')
      expect(fetch).toHaveBeenCalledWith(`${baseUrl}/microclimates/m1`, { headers: { Authorization: 'Bearer test-token' } })
    })

    it('throws a plain error on a non-ok response instead of redirecting to /login', async () => {
      clearToken()
      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Authentication required to view this microclimate' }), { status: 401 }))
      await expect(getMicroclimatePublic(baseUrl, 'm1')).rejects.toThrow('Authentication required to view this microclimate')
    })
  })
})
