import { describe, expect, it } from 'vitest'
import type { SuperAdminDashboard } from '../../api/dashboard'
import type { Company } from '../../../org-structure/api/companies'
import type { SystemJobStatus } from '../../../org-structure/api/systemStatus'
import type { SystemSettingsData } from '../../../org-structure/api/systemSettings'
import type { SurveyListItem } from '../../../surveys/api/surveys'
import {
  ago,
  attentionItems,
  companyRows,
  composePlatform,
  isBehindPace,
  latestSuccess,
  peopleWithoutCompany,
  statusMix,
  toneOf,
  worstJob,
} from './derive'

/**
 * The platform as the local API answered on 10 Sep 2026 — three tenants, 92 people, twelve
 * surveys — so every rule is pinned against the figures the canvas was drawn from.
 */
const MERIDIANO = 'm-1'
const ACME = 'a-1'
const VERIFY = 'v-1'
const AS_OF = '2026-09-10'

// Deliberately NOT in activity order, so the ordering rule has something to do.
const dashboard: SuperAdminDashboard = {
  companyCount: 3,
  userCount: 92,
  activeUserCount: 91,
  surveyCount: 12,
  activeSurveyCount: 2,
  responseCount: 149,
  completedResponseCount: 149,
  companies: [
    { id: VERIFY, name: 'Verify Co', userCount: 1, activeSurveyCount: 0, completedResponseCount: 0, createdAt: '2026-07-31T20:42:50Z' },
    { id: ACME, name: 'Acme Corporation', userCount: 45, activeSurveyCount: 1, completedResponseCount: 73, createdAt: '2026-08-07T15:44:32Z' },
    { id: MERIDIANO, name: 'Grupo Meridiano S.A.', userCount: 42, activeSurveyCount: 1, completedResponseCount: 76, createdAt: '2026-09-10T01:58:51Z' },
  ],
}

const companies: Company[] = [
  { id: VERIFY, name: 'Verify Co', emailDomain: 'verifyco.test', industry: null, size: null, country: null, subscriptionTier: null, createdAt: '2026-07-31T20:42:50Z' },
  { id: ACME, name: 'Acme Corporation', emailDomain: 'acme.test', industry: 'Manufacturing', size: '500-1000', country: 'Colombia', subscriptionTier: 'enterprise', createdAt: '2026-08-07T15:44:32Z' },
  { id: MERIDIANO, name: 'Grupo Meridiano S.A.', emailDomain: 'meridiano.test', industry: 'Servicios', size: 'medium', country: 'Costa Rica', subscriptionTier: 'basic', createdAt: '2026-09-10T01:58:51Z' },
]

function survey(
  companyId: string,
  status: string,
  title: string,
  startDate: string,
  endDate: string,
  extra: Partial<SurveyListItem> = {},
): SurveyListItem {
  return {
    id: `${companyId}:${title}`,
    title,
    companyId,
    type: 'periodic',
    status,
    language: 'both',
    startDate,
    endDate,
    responseCount: 24,
    targetAudienceCount: null,
    questionCount: 6,
    createdAt: '2026-09-10T02:00:00Z',
    ...extra,
  }
}

const drafts = { responseCount: 0, questionCount: 1, language: 'en' }
const surveys: SurveyListItem[] = [
  survey(MERIDIANO, 'archived', 'Encuesta de Clima Q4 (abierta) (Copia)', '2026-09-03T02:03:39Z', '2026-10-10T02:03:39Z', { responseCount: 1, targetAudienceCount: 24 }),
  survey(MERIDIANO, 'closed', 'Encuesta de Clima Q3', '2026-07-16T02:05:22Z', '2026-08-06T02:05:22Z'),
  survey(MERIDIANO, 'active', 'Encuesta de Clima Q4 (abierta)', '2026-09-03T02:03:39Z', '2026-10-10T02:03:39Z', { responseCount: 3, targetAudienceCount: 24 }),
  survey(MERIDIANO, 'closed', 'Encuesta de Clima Q2', '2026-04-22T02:03:12Z', '2026-05-13T02:03:12Z'),
  survey(MERIDIANO, 'closed', 'Encuesta de Clima Q1', '2026-01-22T03:02:44Z', '2026-02-12T03:02:44Z'),
  // Acme's open wave closes at 18:21 UTC: counted in instants that is 16.76 days away.
  survey(ACME, 'active', 'Encuesta de Clima Q4 (abierta)', '2026-08-20T18:21:20Z', '2026-09-26T18:21:20Z', { responseCount: 1, targetAudienceCount: 24 }),
  survey(ACME, 'closed', 'Q2 Encuesta de Clima', '2026-04-08T18:20:53Z', '2026-04-29T18:20:53Z'),
  survey(ACME, 'closed', 'Q1 Encuesta de Clima', '2026-01-08T19:20:26Z', '2026-01-29T19:20:26Z'),
  survey(ACME, 'closed', 'Encuesta de Clima Q3', '2026-07-15T00:00:00Z', '2026-08-05T23:59:59Z'),
  survey(ACME, 'draft', 'Engagement Check', '2026-09-01T14:00:00Z', '2026-09-15T22:00:00Z', { ...drafts, createdAt: '2026-08-08T04:30:13Z' }),
  survey(ACME, 'draft', 'Onboarding Pulse', '2026-09-01T14:00:00Z', '2026-09-15T22:00:00Z', { ...drafts, createdAt: '2026-08-08T04:06:46Z' }),
  survey(ACME, 'draft', 'Q3 Climate Pulse', '2026-09-01T14:00:00Z', '2026-09-15T22:00:00Z', { ...drafts, createdAt: '2026-08-08T04:04:24Z' }),
]

function settings(smtpEnabled: boolean): SystemSettingsData {
  return {
    loginEnabled: true,
    maintenanceMode: false,
    maintenanceMessage: null,
    maxLoginAttempts: 5,
    sessionTimeoutMinutes: 60,
    passwordPolicy: { minLength: 8, requireUppercase: true, requireLowercase: true, requireNumbers: true, requireSpecialChars: false },
    emailSettings: { smtpEnabled, fromEmail: null, smtpHost: null, smtpPort: null },
    updatedAt: '2026-08-12T02:47:06Z',
  }
}

describe('statusMix', () => {
  it('reads the twelve surveys as 2 open, 6 closed, 3 drafts and 1 archived', () => {
    expect(statusMix(surveys)).toEqual({ active: 2, closed: 6, draft: 3, archived: 1, total: 12 })
  })
})

describe('companyRows', () => {
  it('orders by activity: an open survey, then completed responses, then the name', () => {
    expect(companyRows(dashboard, companies, surveys).map((row) => row.name)).toEqual([
      'Grupo Meridiano S.A.',
      'Acme Corporation',
      'Verify Co',
    ])
  })

  it('joins each tenant to its profile and to its open wave', () => {
    const [meridiano, , verify] = companyRows(dashboard, companies, surveys)
    expect(meridiano).toMatchObject({ industry: 'Servicios', country: 'Costa Rica', people: 42, surveyCount: 5 })
    expect(meridiano.openSurvey).toMatchObject({ code: 'Q4', responses: 3, audience: 24 })
    expect(verify).toMatchObject({ surveyCount: 0, openSurvey: null, profileKnown: true })
  })

  it('reads a survey list or a profile it could not fetch as unknown, never as none', () => {
    const [meridiano] = companyRows(dashboard, null, null)
    expect(meridiano).toMatchObject({ surveyCount: null, openSurvey: null, profileKnown: false, industry: null })
  })
})

describe('peopleWithoutCompany', () => {
  it('is the platform total minus every tenant: 92 − 88 = 4', () => {
    expect(peopleWithoutCompany(dashboard)).toBe(4)
  })

  it('is never negative', () => {
    expect(peopleWithoutCompany({ ...dashboard, userCount: 10 })).toBe(0)
  })
})

describe('isBehindPace', () => {
  const [meridiano, acme] = companyRows(dashboard, companies, surveys)

  it("flags Acme's wave: 1 of 24 with 21 of its 37 days gone", () => {
    expect(isBehindPace(acme.openSurvey!, AS_OF)).toBe(true)
  })

  it("leaves Meridiano's alone: 3 of 24 with 7 of 37 gone", () => {
    expect(isBehindPace(meridiano.openSurvey!, AS_OF)).toBe(false)
  })

  it('has no pace to judge without an invitation list', () => {
    expect(isBehindPace({ ...acme.openSurvey!, audience: null }, AS_OF)).toBe(false)
  })
})

describe('attentionItems', () => {
  const rows = companyRows(dashboard, companies, surveys)
  const items = attentionItems(rows, surveys, settings(false), AS_OF)

  it('raises the four items the canvas draws, in its order', () => {
    expect(items.map((item) => item.kind)).toEqual(['behind-pace', 'mail-off', 'drafts', 'unconfigured'])
  })

  it('counts the days to a close by calendar day, the way the screen prints the close', () => {
    const behind = items.find((item) => item.kind === 'behind-pace')
    expect(behind).toMatchObject({ companyName: 'Acme Corporation', daysLeft: 16 })
  })

  it("describes Acme's drafts from the survey list itself", () => {
    expect(items.find((item) => item.kind === 'drafts')).toMatchObject({
      companyName: 'Acme Corporation',
      count: 3,
      singleQuestion: true,
      languages: ['en'],
      since: '2026-08-08T04:04:24Z',
      closesOn: '2026-09-15T22:00:00Z',
      names: ['Engagement Check', 'Onboarding Pulse', 'Q3 Climate Pulse'],
    })
  })

  it('names everything Verify Co lacks, surveys included', () => {
    expect(items.find((item) => item.kind === 'unconfigured')).toMatchObject({
      companyName: 'Verify Co',
      people: 1,
      missing: ['sector', 'country', 'plan', 'surveys'],
    })
  })

  it('says nothing about mail that is on, nor about a profile it could not read', () => {
    const quiet = attentionItems(companyRows(dashboard, null, surveys), surveys, settings(true), AS_OF)
    expect(quiet.map((item) => item.kind)).toEqual(['behind-pace', 'drafts'])
  })
})

describe('composePlatform', () => {
  it('names the tenants behind the open waves and the drafts, and which reads failed', () => {
    const model = composePlatform({ dashboard, companies, surveys, system: null, settings: null }, AS_OF)
    expect(model.openCompanies).toEqual(['Grupo Meridiano S.A.', 'Acme Corporation'])
    expect(model.draftCompanies).toEqual(['Acme Corporation'])
    expect(model.missing).toEqual({ companies: false, surveys: false, system: true, settings: true })
  })
})

describe('the system card', () => {
  function job(status: SystemJobStatus['status'], lastSuccessAt: string | null): SystemJobStatus {
    return { jobName: status, intervalSeconds: 300, lastAttemptAt: lastSuccessAt, lastSuccessAt, consecutiveFailures: 0, status }
  }

  it('reports the worst job, and nothing when none has reported', () => {
    expect(worstJob([])).toBeNull()
    expect(worstJob([job('ok', null), job('stale', null)])).toBe('stale')
    expect(worstJob([job('stale', null), job('failing', null), job('ok', null)])).toBe('failing')
  })

  it('takes the latest success across the jobs', () => {
    expect(latestSuccess([job('ok', '2026-09-10T19:15:46Z'), job('ok', '2026-09-10T19:20:09Z'), job('ok', null)])).toBe(
      '2026-09-10T19:20:09Z',
    )
  })

  it('reads the tokens as the system page does', () => {
    expect(toneOf('ok')).toBe('good')
    expect(toneOf('never-run')).toBe('warning')
    expect(toneOf('unhealthy')).toBe('critical')
    expect(toneOf('unknown')).toBe('neutral')
  })

  it('says how long ago in the reader’s language', () => {
    expect(ago('2026-09-10T19:20:09Z', '2026-09-10T19:20:37Z', 'es')).toBe('hace 28 segundos')
  })
})
