import { describe, expect, it } from 'vitest'
import { countryNames, countryOptions } from './countries'

describe('the País select’s options', () => {
  it('names the countries in the reader’s language, and no grouping that is not a country', () => {
    const es = countryNames('es')
    expect(es).toContain('Costa Rica')
    expect(es).toContain('Panamá')
    expect(es).not.toContain('Unión Europea')
    expect(es).not.toContain('Naciones Unidas')
    expect(countryNames('en')).toContain('Panama')
  })

  it('keeps a tenant’s country spelled some other way as the first option, so opening the form changes nothing', () => {
    expect(countryOptions('es', 'República de Costa Rica')[0]).toBe('República de Costa Rica')
    expect(countryOptions('es', 'Costa Rica').filter((name) => name === 'Costa Rica')).toHaveLength(1)
    expect(countryOptions('es', '')).toEqual(countryNames('es'))
  })
})
