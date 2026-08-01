import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import {
  listMicroclimates,
  createMicroclimate,
  getMicroclimate,
  updateMicroclimate,
  getLiveResults,
  submitResponse,
  getMicroclimateForRespond,
} from './microclimates'

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

  it('gets public respond details against the /respond route without an Authorization header, even when a token is set', async () => {
    const publicDetail = { id: 'm1', title: 'Pulse', description: null, status: 'active', questions: [] }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(publicDetail), { status: 200 }))

    const result = await getMicroclimateForRespond(baseUrl, 'm1')

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/microclimates/m1/respond`)
    const [, init] = vi.mocked(fetch).mock.calls[0]
    const headers = new Headers((init as RequestInit | undefined)?.headers)
    expect(headers.has('Authorization')).toBe(false)
    expect(result).toEqual(publicDetail)
  })

  it('surfaces the backend error message when getMicroclimateForRespond gets a non-401 error (e.g. a 404 for an unknown id)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Microclimate not found' }), { status: 404 }))
    await expect(getMicroclimateForRespond(baseUrl, 'unknown')).rejects.toThrow('Microclimate not found')
  })
})
