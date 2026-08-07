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

  /**
   * The inverse of what this test used to assert.
   *
   * It read `expect(links).not.toContain('/action-plans')`, because the page had
   * no company-picker and a SuperAdmin landing there would have been silently
   * scoped to whatever company their own user row pointed at. #124 built the
   * picker (`company-context/`), so the entry is restored -- and the property
   * that made withholding it correct is now asserted where it actually lives,
   * in `company-context/companyContext.test.ts`: a SuperAdmin with no selection
   * resolves to `needs-selection`, never to a company.
   */
  it('gives a super_admin Action Plans, Microclimates and AI Insights, now that a company-context selector exists', () => {
    const links = hrefs(buildNavSections('super_admin', 'company-1'))
    expect(links).toContain('/action-plans')
    expect(links).toContain('/microclimates')
    expect(links).toContain('/analytics/ai-insights')
  })

  it('still gives a super_admin no company-scoped URL, even though they now reach company-scoped pages', () => {
    // The company comes from the selector, not from the href. If a company id
    // ever appeared in one of these links it would be the SuperAdmin's *own*
    // claim interpolated in -- the exact silent scoping #124 removed.
    const links = hrefs(buildNavSections('super_admin', 'company-1'))
    expect(links.some((href) => href.includes('company-1'))).toBe(false)
  })

  it('gives a company_admin an Action Plans link scoped to their own company session', () => {
    const links = hrefs(buildNavSections('company_admin', 'company-1'))
    expect(links).toContain('/action-plans')
  })

  /**
   * Benchmarks is the one analytics page a SuperAdmin does get, and the contrast
   * with Action Plans above is deliberate. `GET /admin/benchmarks` returns every
   * tenant's rows plus the global ones for this role, so the page is a real
   * cross-company view rather than a silently single-company one.
   */
  it('gives a super_admin a Benchmarks link, because that page has a genuine cross-company view', () => {
    expect(hrefs(buildNavSections('super_admin', 'company-1'))).toContain('/analytics/benchmarks')
  })

  /**
   * AI Insights takes a required company id, and since #191 a global
   * super_admin's `companyId` claim is the empty string (`User.CompanyId` is
   * `Guid?`). That is why this entry used to be withheld from the role: the page
   * could only ever have said "no company associated". #124's selector is what
   * supplies the id the claim cannot -- see the restored-entries test above.
   */
  it('keeps Benchmarks on a super_admin mobile tab bar, so the restored entries do not displace it', () => {
    // `leafNavItems` -- not `hrefs` -- is what MobileNav reads, and it takes the
    // first four. The group's two children come first, so Benchmarks holds the
    // third slot and the three #124 entries have to be appended after it.
    const leaves = leafNavItems(buildNavSections('super_admin', 'company-1')).map((item) => item.href)
    expect(leaves.slice(0, 4)).toEqual([
      '/admin/companies',
      '/admin/system-settings',
      '/analytics/benchmarks',
      '/action-plans',
    ])
  })

  it('gives a company_admin both analytics pages', () => {
    const links = hrefs(buildNavSections('company_admin', 'company-1'))
    expect(links).toContain('/analytics/benchmarks')
    expect(links).toContain('/analytics/ai-insights')
  })

  it('gives a company_admin links scoped to their own company only', () => {
    const links = hrefs(buildNavSections('company_admin', 'company-1'))
    expect(links).toContain('/admin/companies/company-1')
    expect(links).toContain('/admin/companies/company-1/users')
    expect(links).toContain('/admin/companies/company-1/demographic-fields')
    expect(links).not.toContain('/admin/system-settings')
  })

  it('gives a company_admin Reports and Analytics links scoped to their own company', () => {
    const links = hrefs(buildNavSections('company_admin', 'company-1'))
    expect(links).toContain('/admin/companies/company-1/reports')
    expect(links).toContain('/admin/companies/company-1/analytics')
  })

  it('does not give a super_admin Reports or Analytics links -- their sections carry no company id', () => {
    // Unlike Action Plans, these two pages are NOT unsafe for a SuperAdmin: they take
    // their company from the URL, and ReportEndpoints/BenchmarkEndpoints admit a
    // SuperAdmin for any company. They are absent here for the plainer reason asserted
    // just above -- a super_admin's nav is deliberately company-agnostic, so there is
    // no id to interpolate. A SuperAdmin reaches them from CompanyDetailPage.
    const links = hrefs(buildNavSections('super_admin', 'company-1'))
    expect(links.some((href) => href.endsWith('/reports'))).toBe(false)
    expect(links.some((href) => href.endsWith('/analytics'))).toBe(false)
  })

  it('gives a company_admin with no companyId claim only the per-user links', () => {
    // Replaces an earlier `toEqual([])`. Every company-scoped href this branch could
    // have built would have been `/admin/companies/undefined/...`, so the empty array
    // was right until #99 -- but neither /notifications nor /surveys/my needs a
    // companyId at all, so the fallback is now those two rows rather than nothing.
    expect(hrefs(buildNavSections('company_admin', undefined))).toEqual([
      '/surveys/my',
      '/notifications',
    ])
  })

  it.each(['employee', 'supervisor', 'leader', undefined])('gives %s only the per-user links (no admin page exists for this role yet)', (role) => {
    // Both endpoints behind these resolve the caller's OWN user row and read no role
    // claim, which is precisely what makes them loadable by a role with no admin
    // surface. Anything company- or role-scoped would 403 here.
    expect(hrefs(buildNavSections(role, 'company-1'))).toEqual([
      '/surveys/my',
      '/notifications',
    ])
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
    // behind "More" rather than pushing one of them off the bar. Asserted for
    // both admin roles: #124 appended three entries to the super_admin branch,
    // and appending them *after* NOTIFICATIONS_ITEM is the obvious way to get
    // this wrong.
    for (const role of ['company_admin', 'super_admin']) {
      const links = hrefs(buildNavSections(role, 'company-1'))
      expect(links[links.length - 1], `${role} does not end on notifications`).toBe('/notifications')
    }
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
      // After Microclimates, a peer work surface -- and deliberately NOT before
      // Action Plans, which would take Action Plans' fourth mobile tab slot. The
      // first four leaves above are unchanged by #109.
      '/surveys',
      '/analytics/benchmarks',
      '/analytics/ai-insights',
      // After the top-level rows, not inside the admin group: `leafNavItems` puts a
      // group's children ahead of everything that follows it, so grouping these two
      // would take the fourth mobile tab slot away from Action Plans.
      '/admin/companies/company-1/reports',
      '/admin/companies/company-1/analytics',
      // Last, for the same four-slot reason -- see 'puts Notifications last' above.
      '/notifications',
    ])
    expect(leaves.every((item) => !item.sub?.length)).toBe(true)
  })

  it('keeps a childless item as itself', () => {
    const leaves = leafNavItems(buildNavSections('super_admin', 'company-1'))
    expect(leaves.map((item) => item.href)).toEqual([
      '/admin/companies',
      '/admin/system-settings',
      '/analytics/benchmarks',
      // Restored by #124. They sit after Benchmarks rather than before it so the
      // four-slot mobile tab bar keeps the three rows it already had.
      '/action-plans',
      '/microclimates',
      '/analytics/ai-insights',
      // A super_admin gets the survey listing because `ListAsync` applies no company
      // predicate for them -- a genuine cross-company view, the same reason
      // Benchmarks is here. Appended last of the destinations so #124's pinned first
      // four leaves are untouched.
      '/surveys',
      '/notifications',
    ])
  })

  it('does not offer a super_admin the respondent listing, which would always be empty for them', () => {
    // `User.CompanyId` is NULL for a global super_admin (#191), so `/surveys/my`
    // correctly returns an empty list rather than an error. An always-empty page is
    // not a destination, so it belongs to the fallback branch and not this one.
    expect(hrefs(buildNavSections('super_admin', 'company-1'))).not.toContain('/surveys/my')
  })

  it('gives a role with no admin pages exactly its two per-user leaves, so the mobile bar has something to render', () => {
    expect(leafNavItems(buildNavSections('employee', 'company-1')).map((item) => item.href)).toEqual([
      '/surveys/my',
      '/notifications',
    ])
  })
})
