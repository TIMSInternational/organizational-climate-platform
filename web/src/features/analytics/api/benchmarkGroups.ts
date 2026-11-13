import { authFetch } from '../../../api/authFetch'

/**
 * `/admin/benchmark-groups` (`BenchmarkGroupEndpoints.cs`): reference groups computed from the
 * platform's own clients, ruled 3 Nov 2026. Super admin only on every route.
 *
 * A group is criteria and nothing else; its medians are computed when a reading is asked
 * for, from each matching company's latest closed survey of the group's instrument family.
 */

export interface BenchmarkGroup {
  id: string
  name: string
  industry: string | null
  companySize: string | null
  country: string | null
  serviceType: string
  /** Companies meeting the criteria with a qualifying survey, across every company. */
  companyCount: number
  minimumCompanies: number
  /** The newest of those surveys' close dates. */
  latestSurveyOn: string | null
}

export interface BenchmarkGroupOptions {
  industries: string[]
  companySizes: string[]
  countries: string[]
  serviceTypes: string[]
}

export interface BenchmarkGroupCriteria {
  industry: string | null
  companySize: string | null
  country: string | null
  serviceType: string
}

export interface CreateBenchmarkGroupInput extends BenchmarkGroupCriteria {
  name: string
}

export type BenchmarkReadingKind = 'ready' | 'insufficient' | 'no_survey' | 'service_mismatch' | 'survey_suppressed'

export interface BenchmarkGroupDimension {
  key: string
  /** The subject's 0–100 index on this dimension. */
  score: number
  /** The group's median, or null when fewer than the minimum companies scored this dimension. */
  median: number | null
  /** How many group companies scored this exact dimension. */
  companies: number
}

export interface BenchmarkGroupReading {
  kind: BenchmarkReadingKind
  groupId: string
  companyId: string
  companyName: string | null
  survey: { id: string; title: string | null; endDate: string; serviceType: string | null } | null
  /** The OTHER companies the reading used: the subject is never one of its own group. */
  companyCount: number
  minimumCompanies: number
  companyIndex: number | null
  groupMedian: number | null
  dimensions: BenchmarkGroupDimension[]
}

const ROOT = '/admin/benchmark-groups'

export async function listBenchmarkGroups(baseUrl: string): Promise<BenchmarkGroup[]> {
  const response = await authFetch(`${baseUrl}${ROOT}`)
  return response.json() as Promise<BenchmarkGroup[]>
}

export async function getBenchmarkGroupOptions(baseUrl: string): Promise<BenchmarkGroupOptions> {
  const response = await authFetch(`${baseUrl}${ROOT}/options`)
  return response.json() as Promise<BenchmarkGroupOptions>
}

/** How many companies meet these criteria today, before the group is created. */
export async function previewBenchmarkGroup(baseUrl: string, criteria: BenchmarkGroupCriteria): Promise<number> {
  const params = new URLSearchParams({ serviceType: criteria.serviceType })
  if (criteria.industry) params.set('industry', criteria.industry)
  if (criteria.companySize) params.set('companySize', criteria.companySize)
  if (criteria.country) params.set('country', criteria.country)
  const response = await authFetch(`${baseUrl}${ROOT}/preview?${params.toString()}`)
  const body = (await response.json()) as { companyCount: number }
  return body.companyCount
}

export async function createBenchmarkGroup(baseUrl: string, input: CreateBenchmarkGroupInput): Promise<BenchmarkGroup> {
  const response = await authFetch(`${baseUrl}${ROOT}`, { method: 'POST', body: JSON.stringify(input) })
  return response.json() as Promise<BenchmarkGroup>
}

export async function deleteBenchmarkGroup(baseUrl: string, id: string): Promise<void> {
  await authFetch(`${baseUrl}${ROOT}/${id}`, { method: 'DELETE' })
}

export async function readBenchmarkGroup(
  baseUrl: string,
  groupId: string,
  companyId: string,
  surveyId: string | null,
  lang?: string,
): Promise<BenchmarkGroupReading> {
  const params = new URLSearchParams({ companyId })
  if (surveyId) params.set('surveyId', surveyId)
  if (lang) params.set('lang', lang)
  const response = await authFetch(`${baseUrl}${ROOT}/${groupId}/reading?${params.toString()}`)
  return response.json() as Promise<BenchmarkGroupReading>
}
