import { describe, expect, it } from 'vitest'
import type { SurveyListItem } from '../../../surveys/api/surveys'
import { mixNote, plainTitle, shortCompanyName, waveOf, withoutLegalForm } from './derive'
import type { PlatformCompanyRow } from './model'

/**
 * The names and labels the platform overview prints in its sentences, from the tenant's
 * real titles and names (`GET /surveys`, `GET /dashboard/super-admin` as captured on 10 Sep).
 */

const M = '16c97c29'
const A = '22cc8ed9'
const V = '5b0d1f3e'
const rows = [
  { id: M, name: 'Grupo Meridiano S.A.' },
  { id: A, name: 'Acme Corporation' },
  { id: V, name: 'Verify Co' },
] as unknown as PlatformCompanyRow[]

function survey(companyId: string, status: string, title: string): SurveyListItem {
  return { companyId, status, title } as unknown as SurveyListItem
}

const PLATFORM = [
  survey(M, 'archived', 'Encuesta de Clima Q4 (abierta) (Copia)'),
  survey(M, 'closed', 'Encuesta de Clima Q3'),
  survey(M, 'active', 'Encuesta de Clima Q4 (abierta)'),
  survey(A, 'active', 'Encuesta de Clima Q4 (abierta)'),
  survey(A, 'closed', 'Q2 Encuesta de Clima'),
  survey(A, 'draft', 'Engagement Check'),
  survey(A, 'draft', 'Onboarding Pulse'),
  survey(A, 'draft', 'Q3 Climate Pulse'),
]

describe('the names a sentence carries', () => {
  it('drops the legal form, then a generic lead word', () => {
    expect(shortCompanyName('Grupo Meridiano S.A.')).toBe('Meridiano')
    expect(shortCompanyName('Acme Corporation')).toBe('Acme')
    expect(shortCompanyName('Verify Co')).toBe('Verify')
    expect(withoutLegalForm('Grupo Meridiano S.A.')).toBe('Grupo Meridiano')
    expect(withoutLegalForm('Acme Corporation')).toBe('Acme Corporation')
    expect(withoutLegalForm('Verify Co')).toBe('Verify Co')
  })

  it('never empties a name that is only those words', () => {
    expect(shortCompanyName('Grupo')).toBe('Grupo')
    expect(shortCompanyName('Costco')).toBe('Costco')
  })

  it('reads the wave code a title carries, and nothing from a title without one', () => {
    expect(waveOf('Encuesta de Clima Q4 (abierta)')).toBe('Q4')
    expect(waveOf('Q2 Encuesta de Clima')).toBe('Q2')
    expect(waveOf('Engagement Check')).toBeNull()
    expect(waveOf(null)).toBeNull()
  })

  it('strips the parentheticals that repeat the status', () => {
    expect(plainTitle('Encuesta de Clima Q4 (abierta)')).toBe('Encuesta de Clima Q4')
    expect(plainTitle('Encuesta de Clima Q4 (abierta) (Copia)')).toBe('Encuesta de Clima Q4')
    expect(plainTitle('  ')).toBeNull()
  })
})

describe('mixNote', () => {
  it('says the two open ones are each company’s Q4, and the three drafts are one company’s', () => {
    expect(mixNote(rows, PLATFORM)).toEqual({
      open: { kind: 'same-wave', count: 2, code: 'Q4' },
      drafts: { kind: 'one-company', count: 3, company: 'Acme Corporation' },
    })
  })

  it('names the companies when the open ones do not share a wave', () => {
    const mixed = [survey(M, 'active', 'Encuesta de Clima Q4'), survey(A, 'active', 'Encuesta de Clima Q3')]
    expect(mixNote(rows, mixed)?.open).toEqual({ kind: 'companies', companies: ['Grupo Meridiano S.A.', 'Acme Corporation'] })
  })

  it('names the companies when one company holds both open ones', () => {
    const same = [survey(M, 'active', 'Encuesta de Clima Q4'), survey(M, 'active', 'Pulso Q4')]
    expect(mixNote(rows, same)?.open).toEqual({ kind: 'companies', companies: ['Grupo Meridiano S.A.'] })
  })

  it('says nothing when the survey list failed', () => {
    expect(mixNote(rows, null)).toBeNull()
  })
})
