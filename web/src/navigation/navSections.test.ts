import { describe, it, expect } from 'vitest'
import { buildNavSections, leafNavItems, type NavSection } from './navSections'
import { CATALOGUES, LOCALES } from '../i18n/locale'
import { createTranslator } from '../i18n/translate'

function hrefs(sections: ReturnType<typeof buildNavSections>): string[] {
  return sections.flatMap((section) => section.items.flatMap((item) => [item.href, ...(item.sub ?? []).map((sub) => sub.href)]))
}

function labelKeys(sections: NavSection[]): string[] {
  return sections.flatMap((section) => [
    ...(section.titleKey ? [section.titleKey] : []),
    ...section.items.flatMap((item) => [item.labelKey, ...(item.sub ?? []).map((sub) => sub.labelKey)]),
  ])
}

/** Every set of sections this module can produce, for the sweeps below. */
const ALL_SECTIONS: NavSection[] = [
  ...buildNavSections('super_admin', 'company-1'),
  ...buildNavSections('company_admin', 'company-1'),
]

describe('buildNavSections', () => {
  it('gives a super_admin links to Companies and System settings, never a company-scoped URL', () => {
    const links = hrefs(buildNavSections('super_admin', 'company-1'))
    expect(links).toContain('/admin/companies')
    expect(links).toContain('/admin/system-settings')
    expect(links.some((href) => href.includes('company-1'))).toBe(false)
  })

  it('does not give a super_admin an Action Plans link -- that page has no company-picker and would silently mis-scope', () => {
    const links = hrefs(buildNavSections('super_admin', 'company-1'))
    expect(links).not.toContain('/action-plans')
  })

  it('gives a company_admin an Action Plans link scoped to their own company session', () => {
    const links = hrefs(buildNavSections('company_admin', 'company-1'))
    expect(links).toContain('/action-plans')
  })

  it('gives a company_admin links scoped to their own company only', () => {
    const links = hrefs(buildNavSections('company_admin', 'company-1'))
    expect(links).toContain('/admin/companies/company-1')
    expect(links).toContain('/admin/companies/company-1/users')
    expect(links).toContain('/admin/companies/company-1/demographic-fields')
    expect(links).not.toContain('/admin/system-settings')
  })

  it('gives a company_admin with no companyId claim only the Notifications link', () => {
    // Was `toEqual([])` before #99. Every company-scoped href it could have built
    // would have been `/admin/companies/undefined/...`, so the empty array was
    // right -- but /notifications needs no companyId at all.
    expect(hrefs(buildNavSections('company_admin', undefined))).toEqual(['/notifications'])
  })

  it.each(['employee', 'supervisor', 'leader', undefined])('gives %s only the Notifications link (no admin page exists for this role yet)', (role) => {
    expect(hrefs(buildNavSections(role, 'company-1'))).toEqual(['/notifications'])
  })

  it('gives every role a Notifications link, because /notifications/mine authorizes per user rather than per role', () => {
    for (const role of ['super_admin', 'company_admin', 'employee', 'supervisor', 'leader', undefined]) {
      expect(hrefs(buildNavSections(role, 'company-1')), `${role} has no notifications link`).toContain(
        '/notifications',
      )
    }
  })

  it('puts Notifications last for an admin, so it does not displace their primary pages', () => {
    // The mobile tab bar takes the first four leaves (see leafNavItems). A
    // company_admin's four are their own company's pages; Notifications sits
    // behind "More" rather than pushing one of them off the bar.
    const links = hrefs(buildNavSections('company_admin', 'company-1'))
    expect(links[links.length - 1]).toBe('/notifications')
  })
})

describe('nav labels', () => {
  /**
   * The guard that replaces `i18n/noHardcodedStrings.test.ts` here.
   *
   * That sweep reads `.tsx` files only, so when this module carried English
   * labels (`label: 'Companies'`) nothing failed — the sidebar and mobile nav just
   * rendered untranslated for a Spanish user. Keys are only an improvement if they
   * resolve, and a key that does not resolve renders as the key itself, which is
   * worse than English.
   */
  it('uses catalogue keys, not literal copy', () => {
    for (const key of labelKeys(ALL_SECTIONS)) {
      expect(key, `${key} does not look like a catalogue path`).toMatch(/^[a-z][\w]*\.[\w]+$/)
    }
  })

  it('resolves every label in every locale', () => {
    const keys = labelKeys(ALL_SECTIONS)
    expect(keys.length).toBeGreaterThan(0)

    for (const locale of LOCALES) {
      const t = createTranslator(CATALOGUES[locale])
      for (const key of keys) {
        const value = t(key)
        // The translator falls back to the key when it cannot resolve one, so an
        // equal value means a missing translation rather than a literal match.
        expect(value, `${key} is unresolved in ${locale}`).not.toBe(key)
        expect(value.trim(), `${key} is blank in ${locale}`).not.toBe('')
      }
    }
  })

  it('translates the labels differently in Spanish, so the sidebar really is localised', () => {
    // Guard the guard: the assertion above would pass if es.json were a copy of
    // en.json. At least the ones that are genuinely different words must differ.
    const en = createTranslator(CATALOGUES.en)
    const es = createTranslator(CATALOGUES.es)
    expect(es('navigation.companies')).not.toBe(en('navigation.companies'))
    expect(es('navigation.users')).not.toBe(en('navigation.users'))
    expect(es('navigation.demographicFields')).not.toBe(en('navigation.demographicFields'))
  })
})

describe('leafNavItems', () => {
  it('replaces a grouped item with its children, because a group is a toggle and not a destination', () => {
    const sections = buildNavSections('company_admin', 'company-1')
    const leaves = leafNavItems(sections)

    expect(leaves.map((item) => item.href)).toEqual([
      '/admin/companies/company-1',
      '/admin/companies/company-1/users',
      '/admin/companies/company-1/demographic-fields',
      '/action-plans',
      '/microclimates',
      '/notifications',
    ])
    expect(leaves.every((item) => !item.sub?.length)).toBe(true)
  })

  it('keeps a childless item as itself', () => {
    const leaves = leafNavItems(buildNavSections('super_admin', 'company-1'))
    expect(leaves.map((item) => item.href)).toEqual([
      '/admin/companies',
      '/admin/system-settings',
      '/notifications',
    ])
  })

  it('gives a role with no admin pages exactly one leaf, so the mobile bar has something to render', () => {
    expect(leafNavItems(buildNavSections('employee', 'company-1')).map((item) => item.href)).toEqual([
      '/notifications',
    ])
  })
})
