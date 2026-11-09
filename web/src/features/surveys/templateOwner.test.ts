import { describe, expect, it } from 'vitest'
import en from '../../i18n/en.json'
import { templateOptionLabel, templateOwner } from './templateOwner'

const t = ((key: string) => (key === 'surveys.globalTemplate' ? en.surveys.globalTemplate : key)) as never

describe('templateOwner', () => {
  it('names the owning company, says Global for a global template, and nothing when the API did not say', () => {
    expect(templateOwner(t, { isGlobal: false, companyName: 'ESPH' })).toBe('ESPH')
    expect(templateOwner(t, { isGlobal: true, companyName: null })).toBe(en.surveys.globalTemplate)
    expect(templateOwner(t, { isGlobal: false })).toBeNull()
  })

  it('tells three copies of one instrument apart in a dropdown', () => {
    const name = 'Instrumento de clima estándar (6 dimensiones)'
    const labels = [
      templateOptionLabel(t, { name, isGlobal: false, companyName: 'ESPH' }),
      templateOptionLabel(t, { name, isGlobal: false, companyName: 'PROCOMER' }),
      templateOptionLabel(t, { name, isGlobal: true, companyName: null }),
    ]
    expect(new Set(labels).size).toBe(3)
    expect(labels[0]).toBe(`${name} · ESPH`)
    expect(templateOptionLabel(t, { name, isGlobal: false })).toBe(name)
  })
})
