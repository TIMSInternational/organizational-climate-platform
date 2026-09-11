import { describe, it, expect } from 'vitest'
import { createTranslator } from '../../../i18n'
import { CATALOGUES } from '../../../i18n/locale'
import type { ReportShareSummary } from '../api/reportShares'
import {
  activeShares,
  commonSurvey,
  companyLinks,
  contentsReading,
  expiryPreview,
  formatsSentence,
  inactiveShares,
  inactiveSpan,
  linkReading,
  maskedShareUrl,
  previewLifetime,
  reportTypeLabel,
  sameUtcDay,
  scheduleReading,
} from './derive'
import type { ReportRow } from './model'
import { sampleContents } from './sampleModel'

const es = createTranslator(CATALOGUES.es, CATALOGUES.en)

function share(over: Partial<ReportShareSummary> = {}): ReportShareSummary {
  return {
    id: 's',
    createdAt: '2026-09-10T02:14:45Z',
    expiresAt: '2026-10-10T02:14:45Z',
    revokedAt: null,
    accessCount: 2,
    lastAccessedAt: null,
    isActive: true,
    ...over,
  }
}

function row(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: 'r',
    title: 'Datos de clima — T3 2026',
    type: 'climate_summary',
    format: 'csv',
    status: 'completed',
    createdAt: '2026-09-10T02:06:09Z',
    isRecurring: false,
    recurrencePattern: null,
    nextGeneration: null,
    shares: [],
    contents: sampleContents,
    ...over,
  }
}

describe('reports derive — links', () => {
  it('counts only the links that open now, and their opens, the first to expire at the head', () => {
    // The CSV report on 10 Sep: one live link opened twice, five revoked links opened twice
    // each. "2 aperturas en total" is today's exposure, not the revoked links' history.
    const shares = [
      share({ id: 'live', accessCount: 2 }),
      ...[1, 2, 3, 4, 5].map((n) =>
        share({ id: `dead${n}`, isActive: false, revokedAt: '2026-09-10T02:55:09Z', accessCount: 2 }),
      ),
    ]
    expect(linkReading(shares)).toEqual({ active: 1, firstExpiry: '2026-10-10T02:14:45Z', opens: 2 })
    expect(activeShares(shares).map((s) => s.id)).toEqual(['live'])
    expect(inactiveShares(shares)).toHaveLength(5)
  })

  it('reads an unread list as unread, never as none', () => {
    expect(linkReading(null)).toBeNull()
    // One completed report whose links could not be read makes the company tile unknown:
    // counting the rows that loaded would print a plausible wrong number.
    expect(companyLinks([row({ id: 'a', shares: [share()] }), row({ id: 'b', shares: null })])).toBeNull()
    // A report that is not completed is not read, and does not make the tile unknown.
    expect(companyLinks([row({ id: 'a', shares: [share()] }), row({ id: 'b', status: 'generating', shares: null })])).toEqual({
      active: 1,
      firstExpiry: '2026-10-10T02:14:45Z',
      opens: 2,
    })
  })

  it('puts the link that expires first at the head, whatever order the server sent', () => {
    const shares = [share({ id: 'late', expiresAt: '2026-12-01T00:00:00Z' }), share({ id: 'soon', expiresAt: '2026-10-01T00:00:00Z' })]
    expect(activeShares(shares)[0].id).toBe('soon')
    expect(linkReading(shares)?.firstExpiry).toBe('2026-10-01T00:00:00Z')
  })

  it('spans the inactive links by the day each stopped opening, revoked else expired', () => {
    const span = inactiveSpan([
      share({ isActive: false, revokedAt: '2026-09-10T02:55:09Z' }),
      share({ isActive: false, revokedAt: '2026-09-10T02:55:10Z' }),
    ])
    expect(span).not.toBeNull()
    expect(sameUtcDay(span!.first, span!.last)).toBe(true)
    const wider = inactiveSpan([
      share({ isActive: false, revokedAt: '2026-09-01T10:00:00Z' }),
      share({ isActive: false, revokedAt: null, expiresAt: '2026-09-09T10:00:00Z' }),
    ])
    expect(sameUtcDay(wider!.first, wider!.last)).toBe(false)
  })

  it('names an earlier link by its route and never by any part of a token', () => {
    expect(maskedShareUrl('climate.example')).toBe('climate.example/shared/reports/····')
  })
})

describe('reports derive — the share lifetime preview', () => {
  it('mirrors the server clamp [1, 365] and its default of 30', () => {
    expect(previewLifetime('30')).toBe(30)
    expect(previewLifetime('0')).toBe(1)
    expect(previewLifetime('900')).toBe(365)
    expect(previewLifetime('')).toBe(30)
  })

  it('lands 30 days after now', () => {
    const now = Date.parse('2026-09-10T12:00:00Z')
    expect(new Date(expiryPreview(30, now)).toISOString()).toBe('2026-10-10T12:00:00.000Z')
  })
})

describe('reports derive — tiles', () => {
  it('says "un CSV con los datos y un PDF para leer" for one of each, counted', () => {
    expect(formatsSentence(es, [row({ format: 'csv' }), row({ id: 'p', format: 'pdf' })])).toBe(
      'un CSV con los datos y un PDF para leer',
    )
    expect(formatsSentence(es, [row({ format: 'csv' }), row({ id: 'c2', format: 'csv' }), row({ id: 'p', format: 'pdf' })])).toBe(
      '2 CSV con los datos y 1 PDF para leer',
    )
    expect(formatsSentence(es, [])).toBeNull()
  })

  it('counts the recurring reports and names the earliest next run', () => {
    expect(scheduleReading([row(), row({ id: 'b' })])).toEqual({ count: 0, next: null })
    expect(
      scheduleReading([
        row({ id: 'a', isRecurring: true, recurrencePattern: 'monthly', nextGeneration: '2026-11-01T00:00:00Z' }),
        row({ id: 'b', isRecurring: true, recurrencePattern: 'weekly', nextGeneration: '2026-09-17T00:00:00Z' }),
      ]),
    ).toEqual({ count: 2, next: '2026-09-17T00:00:00Z' })
  })

  it('names the survey only when every row names the same one', () => {
    expect(commonSurvey([row(), row({ id: 'b' })])).toBe('Encuesta de Clima Q3')
    expect(commonSurvey([row(), row({ id: 'b', contents: { ...sampleContents, surveyName: 'Otra' } })])).toBeNull()
    expect(commonSurvey([row(), row({ id: 'b', contents: null })])).toBeNull()
    expect(commonSurvey([])).toBeNull()
  })

  it('labels the type the product itself writes, and prints an unknown one as sent', () => {
    expect(reportTypeLabel(es, 'climate_summary')).toBe('Resumen de clima')
    expect(reportTypeLabel(es, 'bespoke')).toBe('bespoke')
  })
})

describe('reports derive — contents under the floor', () => {
  it('counts the groups it prints and names the protected ones without a number', () => {
    expect(contentsReading(sampleContents)).toEqual({
      shown: 4,
      total: 5,
      protectedGroups: ['Finanzas'],
      suppressed: false,
    })
  })

  it('marks a whole survey under the floor as suppressed, so no response count is printed', () => {
    expect(contentsReading({ ...sampleContents, responses: 4 }).suppressed).toBe(true)
    expect(contentsReading({ ...sampleContents, responses: 5 }).suppressed).toBe(false)
  })
})
