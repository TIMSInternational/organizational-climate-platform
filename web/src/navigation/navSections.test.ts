import { describe, it, expect } from 'vitest'
import { readFileSync, globSync } from 'node:fs'
import { join, sep } from 'node:path'
import {
  activeHref,
  buildNavSections,
  isUnder,
  leafNavItems,
  sectionTitleKeyForPath,
  withUnreadBadge,
  type NavSection,
} from './navSections'
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
  // The tracking-enabled variants (#125). Without these the label sweeps below
  // would never see `navigation.trackingConsolidado` or
  // `navigation.trackingDashboard`, which is exactly how an unresolved key ships:
  // `t()` falls back to the dotted path and a Spanish reader gets
  // "navigation.trackingConsolidado" in their sidebar.
  ...buildNavSections('super_admin', 'company-1', { trackingEnabled: true }),
  ...buildNavSections('company_admin', 'company-1', { trackingEnabled: true }),
  ...buildNavSections('leader', 'company-1', { trackingEnabled: true }),
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
    // first four. Dashboard leads (#132: it is where every role now lands after
    // login, so the bar has to be able to return to it), then the group's two
    // children, so Benchmarks holds the fourth slot and the three #124 entries
    // still have to be appended after it.
    const leaves = leafNavItems(buildNavSections('super_admin', 'company-1')).map((item) => item.href)
    expect(leaves.slice(0, 4)).toEqual([
      '/dashboard',
      '/admin/companies',
      '/admin/system-settings',
      '/analytics/benchmarks',
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
    // #132 added a third, for the same reason: /dashboard needs no companyId either
    // and its employee branch is scoped to the caller's own user row.
    expect(hrefs(buildNavSections('company_admin', undefined))).toEqual([
      '/dashboard',
      '/surveys/my',
      '/notifications',
    ])
  })

  it.each(['employee', 'supervisor', 'leader', undefined])('gives %s only the per-user links (no admin page exists for this role yet)', (role) => {
    // Both endpoints behind these resolve the caller's OWN user row and read no role
    // claim, which is precisely what makes them loadable by a role with no admin
    // surface. Anything company- or role-scoped would 403 here. /dashboard joins
    // them on the same test (#132): `DashboardPage` dispatches on the role and this
    // branch's roles reach either the department view (leader/supervisor, scoped to
    // their own user row's department) or the employee view.
    expect(hrefs(buildNavSections(role, 'company-1'))).toEqual([
      '/dashboard',
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

  /**
   * `climate-project#22`, item 4, closed by measurement rather than by a design
   * pass. The complaint was that "a super admin's sidebar interleaves uppercase
   * section headers with 5 header-less expandable groups" — `RoleBasedNav` renders
   * `.nav-section-title` only `if (section.titleKey)`, so a section with `''`
   * contributes rows under no heading at all.
   *
   * The tree that had five such groups did not survive the stack migration, and
   * the three-group shape #124 arrived at has no unheaded section left in any
   * branch. This is the pin that keeps it that way: `NavSection.titleKey` still
   * documents `''` as legal, so nothing but this fails if one comes back.
   */
  it('gives every section a heading, so no rows hang under nothing', () => {
    let swept = 0
    for (const role of ['super_admin', 'company_admin', 'employee', 'supervisor', 'leader', undefined]) {
      for (const companyId of ['company-1', undefined]) {
        for (const section of buildNavSections(role, companyId)) {
          swept += 1
          expect(section.titleKey, `${role}/${companyId} has an unheaded section`).not.toBe('')
        }
      }
    }
    // Guard the guard: the loop above passes vacuously if `buildNavSections`
    // ever returns an empty array for every branch it is asked for.
    expect(swept, 'swept no sections at all').toBeGreaterThan(0)
  })

  /**
   * The other half of item 4: a heading with nothing under it is the same defect
   * seen from the other side — `RoleBasedNav` maps `section.items` unconditionally,
   * so an empty section renders as a bare uppercase label.
   */
  it('gives every section at least one row', () => {
    let swept = 0
    for (const role of ['super_admin', 'company_admin', 'employee', undefined]) {
      for (const section of buildNavSections(role, 'company-1')) {
        swept += 1
        expect(section.items.length, `${role}: ${section.titleKey} is empty`).toBeGreaterThan(0)
      }
    }
    // Guard the guard, as above: a role that produced no sections at all would
    // satisfy "every section has a row" without there being one.
    expect(swept, 'swept no sections at all').toBeGreaterThan(0)
  })

  /**
   * The tracking module's nav rules (#125).
   *
   * Two decisions are pinned here. Federico's, on 2026-08-21: where a tenant uses
   * tracking, `/action-plans` and `/tracking` are two models of the same idea and
   * the client should see ONE place to manage plans — so the generic row is hidden
   * rather than the two being converged. And the standing house rule: never offer a
   * row that would 403, which for the consolidado is `Roles.Admin` and nothing else.
   */
  describe('the tracking module', () => {
    it('changes nothing at all where no tracking service is configured', () => {
      // The default. Every other assertion in this file calls `buildNavSections`
      // with two arguments, so this is what keeps them meaningful.
      for (const role of ['super_admin', 'company_admin', 'leader', 'employee']) {
        const links = hrefs(buildNavSections(role, 'company-1'))
        expect(links.some((href) => href.startsWith('/tracking')), `${role}`).toBe(false)
      }
      expect(hrefs(buildNavSections('super_admin', 'company-1'))).toContain('/action-plans')
      expect(hrefs(buildNavSections('company_admin', 'company-1'))).toContain('/action-plans')
    })

    it('hides the generic Action Plans row for both admin roles where tracking is enabled', () => {
      for (const role of ['super_admin', 'company_admin']) {
        const links = hrefs(buildNavSections(role, 'company-1', { trackingEnabled: true }))
        expect(links, `${role} still offers the generic listing`).not.toContain('/action-plans')
        expect(links, `${role} has no tracking entry`).toContain('/tracking')
      }
    })

    it('offers the consolidado to exactly the roles the tracking service will not forbid', () => {
      // `DashboardEndpoints.ConsolidadoAsync` returns Results.Forbid() for anything
      // outside `Roles.Admin` = company_admin | super_admin.
      for (const role of ['super_admin', 'company_admin']) {
        expect(hrefs(buildNavSections(role, 'company-1', { trackingEnabled: true }))).toContain('/tracking')
      }
      for (const role of ['leader', 'supervisor', 'employee', undefined]) {
        expect(
          hrefs(buildNavSections(role, 'company-1', { trackingEnabled: true })),
          `${role} is offered a row that would 403`,
        ).not.toContain('/tracking')
      }
    })

    it('gives a node leader their own board and nobody else one', () => {
      // A leader is `Roles.PlanCreator` in the tracking service and the role §7
      // gives the full board to. `TableroAsync` hands them their own nodo when the
      // URL names none, so the row needs no id in it.
      expect(hrefs(buildNavSections('leader', 'company-1', { trackingEnabled: true }))).toContain(
        '/tracking/tablero',
      )
      // Not the admins: their own nodoId claim is `unassigned-<companyId>` or
      // empty, so this row would lead to an empty board every time — the same
      // always-empty-page rule that keeps /surveys/my out of the super_admin branch.
      for (const role of ['super_admin', 'company_admin', 'supervisor', 'employee']) {
        expect(
          hrefs(buildNavSections(role, 'company-1', { trackingEnabled: true })),
          `${role} is offered a board that would be empty`,
        ).not.toContain('/tracking/tablero')
      }
    })

    it('keeps the four mobile tab slots, because the swap is in place rather than appended', () => {
      // The reason `workspacePlanItems` returns its rows in `/action-plans`' own
      // position: `leafNavItems` feeds MobileNav the first four leaves, and
      // removing a row from the middle while appending another at the end would
      // shift every role's bottom bar.
      expect(
        leafNavItems(buildNavSections('super_admin', 'company-1', { trackingEnabled: true }))
          .slice(0, 4)
          .map((item) => item.href),
      ).toEqual(['/dashboard', '/admin/companies', '/admin/system-settings', '/analytics/benchmarks'])
      expect(
        leafNavItems(buildNavSections('company_admin', 'company-1', { trackingEnabled: true }))
          .slice(0, 4)
          .map((item) => item.href),
      ).toEqual([
        '/dashboard',
        '/admin/companies/company-1',
        '/admin/companies/company-1/users',
        '/admin/companies/company-1/demographic-fields',
      ])
    })

    it('still ends every admin branch on Notifications', () => {
      for (const role of ['super_admin', 'company_admin']) {
        const links = hrefs(buildNavSections(role, 'company-1', { trackingEnabled: true }))
        expect(links[links.length - 1], `${role}`).toBe('/notifications')
      }
    })

    /**
     * `buildNavSections`' third argument has a default, so a caller that forgets it
     * loses the tracking rows **silently** — the sidebar simply does not show the
     * module and nothing fails. There are exactly two callers and this reads both.
     *
     * A source read rather than a render, for the same reason `router.test.ts`
     * reads `router.tsx`: what is being asserted is the wiring, and a rendered
     * assertion would need the whole shell plus a stubbed env to see it.
     */
    it('is asked for by both callers of buildNavSections', () => {
      const src = join(process.cwd(), 'src')
      const callers = ['app/AdminLayout.tsx', 'components/layout/PageTopBar.tsx']

      // Guard the guard: if a third caller appears, this list is stale and the
      // assertion below would silently stop covering it.
      //
      // Found by the IMPORT rather than by `buildNavSections(` in the text.
      // `CommandPalette.tsx` names the call in its own doc comment while taking
      // `sections` as a prop, so a text match reports it as a caller it is not.
      const found = globSync('**/*.tsx', { cwd: src })
        .filter((file) => !/\.test\.tsx$/.test(file))
        .filter((file) =>
          /^\s*import\s*\{[^}]*\bbuildNavSections\b/m.test(readFileSync(join(src, file), 'utf8')),
        )
      expect(found.sort()).toEqual(callers.map((file) => file.replace(/\//g, sep)).sort())

      for (const caller of callers) {
        const source = readFileSync(join(src, caller), 'utf8')
        expect(source, `${caller} does not pass trackingEnabled`).toMatch(
          /buildNavSections\([^)]*trackingEnabled: isTrackingEnabled\(\)/s,
        )
      }
    })
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
      // #132's landing page, first in every branch -- see DASHBOARD_ITEM.
      '/dashboard',
      '/admin/companies/company-1',
      '/admin/companies/company-1/users',
      '/admin/companies/company-1/demographic-fields',
      '/action-plans',
      '/microclimates',
      // After Microclimates, a peer work surface -- and deliberately NOT before
      // Action Plans, which would take Action Plans' fourth mobile tab slot. The
      // first four leaves above are unchanged by #109.
      '/surveys',
      '/surveys/templates',
      // Climate over time, appended beside the other survey rows. Well past the fourth
      // leaf, so the pinned mobile tab slots above are untouched.
      '/surveys/climate-trends',
      '/analytics/benchmarks',
      '/analytics/ai-insights',
      // After the top-level rows, not inside the admin group: `leafNavItems` puts a
      // group's children ahead of everything that follows it, so grouping these two
      // would take the fourth mobile tab slot away from Action Plans.
      '/admin/companies/company-1/reports',
      '/admin/companies/company-1/analytics',
      // #142. Top-level rather than inside the admin group, and appended after the
      // existing rows: nested, it would flatten ahead of Action Plans and take its
      // fourth mobile tab slot.
      '/departments',
      // #114, appended last in Workspace for the same four-slot reason. A curation
      // surface an admin visits occasionally is not one of the four things they do
      // most, and every leaf above is unmoved by it.
      '/admin/question-bank',
      // Last, for the same four-slot reason -- see 'puts Notifications last' above.
      '/notifications',
    ])
    expect(leaves.every((item) => !item.sub?.length)).toBe(true)
  })

  it('keeps a childless item as itself', () => {
    const leaves = leafNavItems(buildNavSections('super_admin', 'company-1'))
    expect(leaves.map((item) => item.href)).toEqual([
      // #132's landing page, first in every branch -- see DASHBOARD_ITEM.
      '/dashboard',
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
      '/surveys/templates',
      // Climate over time, appended for the same reason and in the same place as in the
      // company_admin branch above.
      '/surveys/climate-trends',
      // #142, appended for the same reason as the two above.
      '/departments',
      // #275's System Health, appended for that same reason -- it belongs beside
      // Companies by subject, but the ADMINISTRATION section feeds the mobile tab bar.
      '/admin/system',
      // #114's question bank, appended last in Workspace for the same reason again.
      // Both admin branches get the identical entry: no companyId is interpolated,
      // because the endpoint scopes by role rather than by a URL segment.
      '/admin/question-bank',
      '/notifications',
    ])
  })

  /**
   * The pin behind both `toEqual`s above, stated once as its own assertion.
   *
   * The two lists are long enough that appending to them is easy and reordering
   * them is easy by accident. What actually matters is the first four leaves of
   * each role: `MobileNav` renders exactly those as the bottom tab bar. This
   * fails loudly if a future entry is inserted rather than appended, without
   * anyone having to notice which of thirteen hrefs moved.
   */
  it('keeps the four mobile tab slots each role already had', () => {
    // #132 changed these once, deliberately and for both admin roles: Dashboard
    // takes the first slot and Action Plans moves behind "More". A bottom bar that
    // cannot return to the page login lands on is a bar missing its home button.
    // The pin still does its job -- any FURTHER insertion has to argue with it.
    expect(leafNavItems(buildNavSections('super_admin', 'company-1')).slice(0, 4).map((item) => item.href)).toEqual([
      '/dashboard',
      '/admin/companies',
      '/admin/system-settings',
      '/analytics/benchmarks',
    ])
    expect(leafNavItems(buildNavSections('company_admin', 'company-1')).slice(0, 4).map((item) => item.href)).toEqual([
      '/dashboard',
      '/admin/companies/company-1',
      '/admin/companies/company-1/users',
      '/admin/companies/company-1/demographic-fields',
    ])
  })

  it('does not offer a super_admin the respondent listing, which would always be empty for them', () => {
    // `User.CompanyId` is NULL for a global super_admin (#191), so `/surveys/my`
    // correctly returns an empty list rather than an error. An always-empty page is
    // not a destination, so it belongs to the fallback branch and not this one.
    expect(hrefs(buildNavSections('super_admin', 'company-1'))).not.toContain('/surveys/my')
  })

  it('gives a role with no admin pages exactly its three per-user leaves, so the mobile bar has something to render', () => {
    expect(leafNavItems(buildNavSections('employee', 'company-1')).map((item) => item.href)).toEqual([
      '/dashboard',
      '/surveys/my',
      '/notifications',
    ])
  })
})

describe('sectionTitleKeyForPath', () => {
  const sections = buildNavSections('company_admin', 'company-1')

  it('names the group a page sits in, which is what the page eyebrow prints', () => {
    expect(sectionTitleKeyForPath('/admin/companies/company-1/users', sections)).toBe(
      'navigation.sectionAdministration',
    )
    expect(sectionTitleKeyForPath('/action-plans', sections)).toBe('navigation.sectionWorkspace')
    expect(sectionTitleKeyForPath('/notifications', sections)).toBe(
      'navigation.sectionCommunication',
    )
  })

  /**
   * The bug `activeHref` exists for, asserted on the eyebrow rather than on the
   * rail. `/admin/companies/company-1` is a prefix of
   * `.../demographic-fields`, so a plain `startsWith` matches both — and both are
   * in the same group here, which is exactly why this needs a case where the two
   * candidates disagree. `/surveys` (Workspace) is a prefix of nothing in
   * Administration, so the discriminating pair is a sub-route of a *detail* page:
   * `/action-plans/abc` sits under `/action-plans` and under nothing else.
   */
  it('resolves a detail route to its list page group rather than to no group', () => {
    expect(sectionTitleKeyForPath('/action-plans/abc-123', sections)).toBe(
      'navigation.sectionWorkspace',
    )
    expect(sectionTitleKeyForPath('/surveys/abc-123/results', sections)).toBe(
      'navigation.sectionWorkspace',
    )
  })

  it('prints no eyebrow for a route the nav does not cover, rather than guessing one', () => {
    expect(sectionTitleKeyForPath('/dev/chart-gallery', sections)).toBeNull()
    expect(sectionTitleKeyForPath('/login', sections)).toBeNull()
  })

  it('is empty for a role with no sections at all, so a signed-out header prints nothing', () => {
    expect(sectionTitleKeyForPath('/action-plans', buildNavSections(undefined, undefined))).toBeNull()
  })
})

/**
 * `activeHref` and `isUnder` moved here from `RoleBasedNav` when the page eyebrow
 * needed the same answer. Asserted directly, because the two properties they exist
 * for are both invisible from the eyebrow: the groups a mis-resolved path lands in
 * happen to be the same one.
 *
 * Both cases below were confirmed to fail when the property is removed — reverting
 * `longest` to `shortest` and `isUnder` to a bare `startsWith` each turns exactly
 * one of them red, and neither turned anything else in the 1557-test suite red
 * before this block existed.
 */
describe('activeHref', () => {
  const sections = buildNavSections('company_admin', 'company-1')

  it('picks the longest matching row, so a child page does not also light its parent', () => {
    // `/admin/companies/company-1` (Company Settings) is a string prefix of this
    // path, and both are nav rows. The more specific one wins.
    expect(activeHref('/admin/companies/company-1/demographic-fields', sections)).toBe(
      '/admin/companies/company-1/demographic-fields',
    )
    expect(activeHref('/admin/companies/company-1/users', sections)).toBe(
      '/admin/companies/company-1/users',
    )
    // The parent still wins on its own path.
    expect(activeHref('/admin/companies/company-1', sections)).toBe('/admin/companies/company-1')
  })

  it('matches on whole segments, so /surveys does not claim /surveys-archive', () => {
    expect(isUnder('/surveys-archive', '/surveys')).toBe(false)
    expect(isUnder('/action-plansX', '/action-plans')).toBe(false)
    expect(isUnder('/surveys/my', '/surveys')).toBe(true)
    expect(isUnder('/surveys', '/surveys')).toBe(true)
  })

  it('returns null where no row matches', () => {
    expect(activeHref('/dev/chart-gallery', sections)).toBeNull()
  })
})

describe('withUnreadBadge', () => {
  const sections = buildNavSections('company_admin', 'company-1')

  function badges(decorated: NavSection[]) {
    return decorated
      .flatMap((section) => section.items)
      .filter((item) => item.badge !== undefined)
      .map((item) => [item.href, item.badge])
  }

  it('badges the notifications row and nothing else', () => {
    expect(badges(withUnreadBadge(sections, 3))).toEqual([['/notifications', '3']])
  })

  it('renders no badge at zero, rather than a pill reading 0', () => {
    expect(badges(withUnreadBadge(sections, 0))).toEqual([])
    expect(withUnreadBadge(sections, 0)).toBe(sections)
  })

  it('caps a large count so it cannot push the row label into an ellipsis', () => {
    expect(badges(withUnreadBadge(sections, 99))).toEqual([['/notifications', '99']])
    expect(badges(withUnreadBadge(sections, 100))).toEqual([['/notifications', '99+']])
    expect(badges(withUnreadBadge(sections, 4321))).toEqual([['/notifications', '99+']])
  })

  it('does not mutate the sections it was given', () => {
    const before = buildNavSections('company_admin', 'company-1')
    withUnreadBadge(before, 7)
    expect(badges(before)).toEqual([])
  })

  it('badges the row for every role, since every role has notifications', () => {
    for (const role of ['super_admin', 'company_admin', 'employee', 'supervisor', 'leader']) {
      expect(badges(withUnreadBadge(buildNavSections(role, 'company-1'), 2))).toEqual([
        ['/notifications', '2'],
      ])
    }
  })
})
