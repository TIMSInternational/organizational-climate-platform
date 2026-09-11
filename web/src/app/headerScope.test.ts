import { describe, expect, it } from 'vitest'
import { headerSwitcherStandsDown } from './headerScope'

const M = '16c97c29-07f8-4522-86fc-e6cc56298829'

describe('headerSwitcherStandsDown', () => {
  it('stands down where the page names its own company', () => {
    expect(headerSwitcherStandsDown('/admin/companies', null)).toBe(true)
    expect(headerSwitcherStandsDown('/admin/companies/', M)).toBe(true)
    expect(headerSwitcherStandsDown(`/admin/companies/${M}`, null)).toBe(true)
    expect(headerSwitcherStandsDown(`/admin/companies/${M}/users`, M)).toBe(true)
    expect(headerSwitcherStandsDown(`/admin/companies/${M}/analytics`, M)).toBe(true)
  })

  it('stands down on the platform overview only while nothing is selected', () => {
    expect(headerSwitcherStandsDown('/dashboard', null)).toBe(true)
    expect(headerSwitcherStandsDown('/dashboard', M)).toBe(false)
  })

  it('stays everywhere else', () => {
    expect(headerSwitcherStandsDown('/surveys', null)).toBe(false)
    expect(headerSwitcherStandsDown('/action-plans', M)).toBe(false)
    expect(headerSwitcherStandsDown('/admin/system-settings', null)).toBe(false)
    expect(headerSwitcherStandsDown('/admin/companiesX', null)).toBe(false)
  })
})
