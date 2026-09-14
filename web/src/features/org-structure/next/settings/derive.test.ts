import { describe, it, expect } from 'vitest'
import { changesOf, draftOf, utcOffset } from './derive'
import type { CompanySettingsResponse } from '../../api/companySettings'

const AT = new Date('2026-09-11T12:00:00Z')

describe('utcOffset', () => {
  it('names UTC itself "UTC", although ICU calls it "GMT+0"', () => {
    // Node's ICU answers `GMT+0` for these zones (measured: `Intl.DateTimeFormat('en-US',
    // { timeZone: 'UTC', timeZoneName: 'shortOffset' })` → "GMT+0"), which read as "UTC+0" and
    // printed "UTC (UTC+0)" in the time-zone select.
    expect(utcOffset('UTC', AT)).toBe('UTC')
    expect(utcOffset('Etc/UTC', AT)).toBe('UTC')
  })

  it('reads a real offset with the true minus sign and any minutes', () => {
    expect(utcOffset('America/Costa_Rica', AT)).toBe('UTC−6')
    expect(utcOffset('Asia/Kolkata', AT)).toBe('UTC+5:30')
    expect(utcOffset('Europe/Madrid', AT)).toBe('UTC+2')
  })

  it('answers null for a zone the platform does not know', () => {
    expect(utcOffset('Not/A_Zone', AT)).toBeNull()
  })
})

describe('changesOf', () => {
  const response: CompanySettingsResponse = {
    companyId: 'c1',
    settings: {
      surveyFrequency: 'quarterly',
      microclimateEnabled: true,
      aiInsightsEnabled: true,
      anonymousSurveys: false,
      dataRetentionDays: 2555,
      timezone: 'UTC',
      language: 'en',
    },
    branding: { logoUrl: null, primaryColor: '#3B82F6', secondaryColor: '#1E40AF', fontFamily: 'Inter', customCss: null },
  }

  it('never carries the microclimate or AI flag — the form has no control for either', () => {
    const initial = draftOf(response)
    expect(Object.keys(initial).sort()).toEqual(['anonymousSurveys', 'dataRetentionDays', 'language', 'primaryColor', 'surveyFrequency', 'timezone'])
    expect(changesOf(initial, { ...initial, language: 'es' })).toEqual({ language: 'es' })
  })
})
