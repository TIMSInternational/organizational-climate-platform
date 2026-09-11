import { describe, it, expect } from 'vitest'
import { companyShortName } from './companyShortName'

describe('companyShortName', () => {
  it('drops a trailing legal form, as the canvas names a tenant in a sentence', () => {
    expect(companyShortName('Acme Corporation')).toBe('Acme')
    expect(companyShortName('Grupo Meridiano S.A.')).toBe('Grupo Meridiano')
    expect(companyShortName('Verify Co')).toBe('Verify')
    expect(companyShortName('Exportadora del Sur, S.R.L.')).toBe('Exportadora del Sur')
  })

  it('keeps a name with no legal form, and a name that is nothing but one', () => {
    expect(companyShortName('Banco Nacional')).toBe('Banco Nacional')
    expect(companyShortName('Corporation')).toBe('Corporation')
    // Only a whole trailing word: "Cosa" does not end in the legal form "SA".
    expect(companyShortName('La Cosa')).toBe('La Cosa')
  })
})
