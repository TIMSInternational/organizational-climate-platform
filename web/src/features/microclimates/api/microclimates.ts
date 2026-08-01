import { authFetch } from '../../../api/authFetch'

export interface Question {
  id: string
  text: string
  type: string
  options: string[] | null
  required: boolean
  order: number
}

export interface CreateQuestionInput {
  text: string
  type: string
  options?: string[]
  required: boolean
  order: number
}

export interface Microclimate {
  id: string
  title: string
  companyId: string
  status: string
  responseCount: number
  targetParticipantCount: number
  createdAt: string
}

export interface MicroclimateDetail {
  id: string
  title: string
  description: string | null
  companyId: string
  createdBy: string
  status: string
  responseCount: number
  targetParticipantCount: number
  startTime: string
  endTime: string
  anonymousResponses: boolean
  showLiveResults: boolean
  questions: Question[]
}

export interface CreateMicroclimateInput {
  title: string
  description?: string
  companyId: string
  startTime: string
  endTime: string
  targetParticipantCount: number
  anonymousResponses: boolean
  templateId?: string
  questions?: CreateQuestionInput[]
}

export interface UpdateMicroclimateInput {
  title?: string
  description?: string
  status?: string
  endTime?: string
}

export interface WordCloudEntry {
  text: string
  value: number
}

export interface LiveResults {
  sentimentScore: number
  engagementLevel: string
  wordCloud: WordCloudEntry[]
  responseCount: number
  targetParticipantCount: number
}

export async function listMicroclimates(baseUrl: string, companyId: string): Promise<Microclimate[]> {
  const response = await authFetch(`${baseUrl}/microclimates?companyId=${companyId}`)
  const body = (await response.json()) as { microclimates: Microclimate[] }
  return body.microclimates
}

export async function createMicroclimate(baseUrl: string, input: CreateMicroclimateInput): Promise<MicroclimateDetail> {
  const response = await authFetch(`${baseUrl}/microclimates`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<MicroclimateDetail>
}

export async function getMicroclimate(baseUrl: string, id: string): Promise<MicroclimateDetail> {
  const response = await authFetch(`${baseUrl}/microclimates/${id}`)
  return response.json() as Promise<MicroclimateDetail>
}

export interface PublicMicroclimateDetail {
  id: string
  title: string
  description: string | null
  status: string
  questions: Question[]
}

// Deliberately does not use authFetch -- this backs the unauthenticated public respond
// page (Task 7). The backend route (`GET /microclimates/{id}/respond`) is registered with
// AllowAnonymous specifically so a genuinely anonymous visitor (no token at all) can read
// the microclimate's title/description/status/questions before submitting a response;
// `authFetch` against the authenticated `GET /microclimates/{id}` route would 401 for such
// a visitor (that route sits behind `.RequireAuthorization()`) and authFetch's 401 handler
// clears any token and hard-redirects to /login, which would break this page entirely.
export async function getMicroclimateForRespond(baseUrl: string, id: string): Promise<PublicMicroclimateDetail> {
  const response = await fetch(`${baseUrl}/microclimates/${id}/respond`)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error((body && body.message) || `Request failed: ${response.status}`)
  }
  return response.json() as Promise<PublicMicroclimateDetail>
}

export async function updateMicroclimate(baseUrl: string, id: string, input: UpdateMicroclimateInput): Promise<MicroclimateDetail> {
  const response = await authFetch(`${baseUrl}/microclimates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<MicroclimateDetail>
}

export async function getLiveResults(baseUrl: string, id: string): Promise<LiveResults> {
  const response = await authFetch(`${baseUrl}/microclimates/${id}/live-results`)
  return response.json() as Promise<LiveResults>
}

// Deliberately does not use authFetch -- this is called from the unauthenticated
// public respond page (Task 7) when the microclimate allows anonymous responses.
// A token IS still attached if one happens to be present (an already-logged-in
// admin previewing the form), but its absence must not block the request.
export async function submitResponse(baseUrl: string, id: string, answers: Record<string, string>): Promise<void> {
  const response = await fetch(`${baseUrl}/microclimates/${id}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error((body && body.message) || `Request failed: ${response.status}`)
  }
}
