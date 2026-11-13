import { describe, it, expect } from 'vitest'
import { readFileSync, globSync } from 'node:fs'
import { join, sep } from 'node:path'
import {
  activeHref,
  buildNavSections,
  drawsRespondentShell,
  isPerUserOnly,
  isUnder,
  leafNavItems,
  mobileTabs,
  sectionTitleKeyForPath,
  type NavSection,
} from './navSections'
import { RailCompaniesIcon, RailConsolidatedIcon, RailQuestionBankIcon, RailQuestionLibraryIcon, RailStatusIcon } from './railIcons'
import { canReach } from './roleCapabilities'
import { CATALOGUES, LOCALES } from '../i18n/locale'
import { createTranslator } from '../i18n/translate'

function hrefs(sections: ReturnType<typeof buildNavSections>): string[] {
  return sections.flatMap((section) => section.items.flatMap((item) => [item.href, ...(item.sub ?? []).map((sub) => sub.href)]))
}

function leaves(role: string | undefined, companyId: string | undefined = 'company-1', trackingEnabled = false): string[] {
  return leafNavItems(buildNavSections(role, companyId, { trackingEnabled })).map((item) => item.href)
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
  ...buildNavSections('leader', 'company-1'),
  ...buildNavSections('employee', 'company-1', { trackingEnabled: true }),
]

const ROLES = ['super_admin', 'company_admin', 'leader', 'supervisor', 'employee', undefined] as const

/**
 * Every destination each role's rail offered BEFORE the 11 Nov regroup, written out by hand
 * from the pre-regroup `leafNavItems` pins (this file at 5c3f3d6f) — less `/notifications`,
 * which the regroup moved to the bell. The regroup is presentation: these sets are what
 * "no role gains or loses a destination" means, asserted as sets so the new ORDER is free.
 */
const DESTINATIONS_BEFORE_THE_REGROUP: Record<string, { off: string[]; on: string[] }> = {
  super_admin: {
    off: [
      '/dashboard', '/admin/companies', '/admin/system-settings', '/analytics/benchmarks', '/action-plans',
      '/microclimates', '/analytics/ai-insights', '/surveys', '/surveys/templates', '/surveys/climate-trends',
      '/departments', '/admin/system', '/admin/question-bank', '/admin/question-library', '/admin/audit',
    ],
    on: [
      '/dashboard', '/admin/companies', '/admin/system-settings', '/analytics/benchmarks', '/tracking',
      '/tracking/planes', '/microclimates', '/analytics/ai-insights', '/surveys', '/surveys/templates',
      '/surveys/climate-trends', '/departments', '/admin/system', '/admin/question-bank',
      '/admin/question-library', '/admin/audit',
    ],
  },
  company_admin: {
    off: [
      '/dashboard', '/admin/companies/company-1', '/admin/companies/company-1/users',
      '/admin/companies/company-1/demographic-fields', '/action-plans', '/microclimates', '/surveys',
      '/surveys/templates', '/surveys/climate-trends', '/analytics/benchmarks', '/analytics/ai-insights',
      '/admin/companies/company-1/reports', '/admin/companies/company-1/analytics', '/departments',
      '/admin/question-bank', '/admin/question-library', '/admin/audit',
    ],
    on: [
      '/dashboard', '/admin/companies/company-1', '/admin/companies/company-1/users',
      '/admin/companies/company-1/demographic-fields', '/tracking', '/tracking/planes', '/microclimates',
      '/surveys', '/surveys/templates', '/surveys/climate-trends', '/analytics/benchmarks',
      '/analytics/ai-insights', '/admin/companies/company-1/reports', '/admin/companies/company-1/analytics',
      '/departments', '/admin/question-bank', '/admin/question-library', '/admin/audit',
    ],
  },
  leader: {
    off: ['/dashboard', '/surveys/my', '/action-plans'],
    on: ['/dashboard', '/surveys/my', '/tracking/tablero', '/tracking/planes', '/tracking/mis-tareas'],
  },
  supervisor: { off: ['/dashboard', '/surveys/my'], on: ['/dashboard', '/surveys/my', '/tracking/mis-tareas'] },
  employee: { off: ['/dashboard', '/surveys/my'], on: ['/dashboard', '/surveys/my', '/tracking/mis-tareas'] },
}

describe('the regroup (11 Nov): same destinations, new sections', () => {
  it.each(Object.keys(DESTINATIONS_BEFORE_THE_REGROUP))(
    'gives %s exactly the destinations it had before, with tracking off and on',
    (role) => {
      const before = DESTINATIONS_BEFORE_THE_REGROUP[role]!
      expect([...leaves(role, 'company-1', false)].sort()).toEqual([...before.off].sort())
      expect([...leaves(role, 'company-1', true)].sort()).toEqual([...before.on].sort())
    },
  )

  it('repeats no destination within a rail, so no page has two rows to light', () => {
    for (const role of ROLES) {
      for (const trackingEnabled of [false, true]) {
        const list = leaves(role, 'company-1', trackingEnabled)
        expect(list.length, `${role} tracking=${trackingEnabled}`).toBe(new Set(list).size)
      }
    }
  })

  it('draws the administrators’ rail in the boards’ sections, in the boards’ order', () => {
    for (const role of ['super_admin', 'company_admin']) {
      expect(buildNavSections(role, 'company-1').map((section) => section.titleKey), role).toEqual([
        '',
        'navigation.sectionSurveys',
        'navigation.sectionFollowUp',
        'navigation.sectionAnalytics',
        'navigation.sectionOrganization',
        'navigation.sectionSystem',
      ])
    }
  })

  it('files each super administrator destination where the Main board does', () => {
    const bySection = (trackingEnabled: boolean) =>
      Object.fromEntries(
        buildNavSections('super_admin', 'company-1', { trackingEnabled }).map((section) => [section.titleKey, hrefs([section])]),
      )
    expect(bySection(false)).toEqual({
      '': ['/dashboard'],
      'navigation.sectionSurveys': ['/surveys', '/surveys/templates', '/surveys/climate-trends', '/admin/question-bank', '/admin/question-bank', '/admin/question-library'],
      'navigation.sectionFollowUp': ['/action-plans', '/microclimates'],
      'navigation.sectionAnalytics': ['/analytics/benchmarks', '/analytics/ai-insights'],
      'navigation.sectionOrganization': ['/departments', '/admin/companies'],
      'navigation.sectionSystem': ['/admin/system-settings', '/admin/system', '/admin/audit'],
    })
    // Tracking on: Planes de acción, then the Vista consolidada, as the boards order them.
    expect(bySection(true)['navigation.sectionFollowUp']).toEqual(['/tracking/planes', '/tracking', '/microclimates'])
  })

  it('files each company administrator destination where the CompanyHome board does', () => {
    const bySection = Object.fromEntries(
      buildNavSections('company_admin', 'company-1').map((section) => [section.titleKey, hrefs([section])]),
    )
    expect(bySection).toEqual({
      '': ['/dashboard'],
      'navigation.sectionSurveys': ['/surveys', '/surveys/templates', '/surveys/climate-trends', '/admin/question-bank', '/admin/question-bank', '/admin/question-library'],
      'navigation.sectionFollowUp': ['/action-plans', '/microclimates'],
      'navigation.sectionAnalytics': [
        '/admin/companies/company-1/analytics',
        '/analytics/benchmarks',
        '/analytics/ai-insights',
        '/admin/companies/company-1/reports',
      ],
      'navigation.sectionOrganization': [
        '/admin/companies/company-1/users',
        '/departments',
        '/admin/companies/company-1/demographic-fields',
        '/admin/companies/company-1',
      ],
      'navigation.sectionSystem': ['/admin/audit'],
    })
  })

  it('opens a leader’s rail on their team, as the TeamHome board does', () => {
    const sections = buildNavSections('leader', 'company-1', { trackingEnabled: true })
    expect(sections.map((section) => section.titleKey)).toEqual(['', 'navigation.sectionFollowUp'])
    expect(sections[0]!.items.map((item) => item.labelKey)).toEqual(['navigation.myTeam', 'navigation.mySurveys'])
    expect(hrefs(sections)).toEqual(['/dashboard', '/surveys/my', '/tracking/tablero', '/tracking/planes', '/tracking/mis-tareas'])
  })

  it('puts the two question surfaces under one Preguntas disclosure, the bank first', () => {
    for (const role of ['super_admin', 'company_admin']) {
      const questions = buildNavSections(role, 'company-1')
        .flatMap((section) => section.items)
        .find((item) => item.labelKey === 'navigation.questions')
      expect(questions?.sub?.map((sub) => sub.href), role).toEqual(['/admin/question-bank', '/admin/question-library'])
      // A group's own href is its first child's: what the collapsed rail links to.
      expect(questions?.href).toBe('/admin/question-bank')
    }
  })

  /**
   * Notificaciones left the rail for the bell. The destination did not leave anybody: every
   * role still holds `/notifications` in `roleCapabilities.ts`, and `AdminLayout.test.tsx`
   * pins the bell in the shell header of every rail role.
   */
  it('offers Notificaciones from no rail, and takes it from no role', () => {
    for (const role of ROLES) {
      for (const trackingEnabled of [false, true]) {
        expect(hrefs(buildNavSections(role, 'company-1', { trackingEnabled })), `${role}`).not.toContain('/notifications')
      }
      expect(canReach(role, '/notifications'), `${role} lost /notifications`).toBe(true)
    }
  })
})

describe('buildNavSections', () => {
  it('gives a super_admin links to Companies and System settings, never a company-scoped URL', () => {
    const links = hrefs(buildNavSections('super_admin', 'company-1'))
    expect(links).toContain('/admin/companies')
    expect(links).toContain('/admin/system-settings')
    expect(links.some((href) => href.includes('company-1'))).toBe(false)
  })

  /**
   * The leader is the one non-admin role the action plans list answers: `ListAsync` scopes
   * them to the plans they own, and the due-date nudge sends them there.
   */
  it('gives a leader without a tracking service the per-user links plus their own action plans', () => {
    expect(hrefs(buildNavSections('leader', 'company-1'))).toEqual(['/dashboard', '/surveys/my', '/action-plans'])
  })

  it('gives a super_admin Action Plans, Microclimates and AI Insights, now that a company-context selector exists', () => {
    const links = hrefs(buildNavSections('super_admin', 'company-1'))
    expect(links).toContain('/action-plans')
    expect(links).toContain('/microclimates')
    expect(links).toContain('/analytics/ai-insights')
  })

  it('gives a super_admin a Benchmarks link, because that page has a genuine cross-company view', () => {
    expect(hrefs(buildNavSections('super_admin', 'company-1'))).toContain('/analytics/benchmarks')
  })

  it('gives a company_admin links scoped to their own company only', () => {
    const links = hrefs(buildNavSections('company_admin', 'company-1'))
    expect(links).toContain('/admin/companies/company-1')
    expect(links).toContain('/admin/companies/company-1/users')
    expect(links).toContain('/admin/companies/company-1/demographic-fields')
    expect(links).toContain('/admin/companies/company-1/reports')
    expect(links).toContain('/admin/companies/company-1/analytics')
    expect(links).not.toContain('/admin/system-settings')
  })

  it('does not give a super_admin Reports or Analytics links -- their sections carry no company id', () => {
    const links = hrefs(buildNavSections('super_admin', 'company-1'))
    expect(links.some((href) => href.endsWith('/reports'))).toBe(false)
    expect(links.some((href) => href.endsWith('/analytics'))).toBe(false)
  })

  it('gives a company_admin with no companyId claim only the per-user links', () => {
    // Every company-scoped href this branch could build would be
    // `/admin/companies/undefined/...`; neither /dashboard nor /surveys/my needs a companyId.
    expect(hrefs(buildNavSections('company_admin', undefined))).toEqual(['/dashboard', '/surveys/my'])
  })

  it.each(['employee', 'supervisor', undefined])('gives %s only the per-user links (no admin page exists for this role yet)', (role) => {
    expect(hrefs(buildNavSections(role, 'company-1'))).toEqual(['/dashboard', '/surveys/my'])
  })

  /**
   * `climate-project#22`, item 4: a super admin's sidebar "interleaves uppercase section
   * headers with header-less expandable groups". The boards of 11 Nov open every rail with
   * the home row on its own, unheaded — so the rule is no longer "every section has a
   * heading" but "only the FIRST may lack one, and only to hold the home rows". Anything
   * else unheaded is the interleaving #22 was about.
   */
  it('leaves only the first section unheaded, and only for the reader’s home rows', () => {
    const HOME_ROWS = new Set(['/dashboard', '/surveys/my'])
    let swept = 0
    for (const role of ROLES) {
      for (const companyId of ['company-1', undefined]) {
        for (const trackingEnabled of [false, true]) {
          buildNavSections(role, companyId, { trackingEnabled }).forEach((section, index) => {
            swept += 1
            if (index > 0) {
              expect(section.titleKey, `${role}/${companyId}: section ${index} is unheaded`).not.toBe('')
            } else if (section.titleKey === '') {
              for (const item of section.items) expect(HOME_ROWS.has(item.href), `${role}: ${item.href} is not a home row`).toBe(true)
            }
          })
        }
      }
    }
    // Guard the guard: the loop passes vacuously if every branch returns nothing.
    expect(swept, 'swept no sections at all').toBeGreaterThan(0)
  })

  /**
   * The other half of item 4: a heading with nothing under it is the same defect seen from
   * the other side — `RoleBasedNav` maps `section.items` unconditionally, so an empty
   * section renders as a bare uppercase label.
   */
  it('gives every section at least one row', () => {
    let swept = 0
    for (const role of ROLES) {
      for (const trackingEnabled of [false, true]) {
        for (const section of buildNavSections(role, 'company-1', { trackingEnabled })) {
          swept += 1
          expect(section.items.length, `${role}: ${section.titleKey} is empty`).toBeGreaterThan(0)
        }
      }
    }
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
      expect(hrefs(buildNavSections('leader', 'company-1', { trackingEnabled: true }))).toContain('/tracking/tablero')
      for (const role of ['super_admin', 'company_admin', 'supervisor', 'employee']) {
        expect(
          hrefs(buildNavSections(role, 'company-1', { trackingEnabled: true })),
          `${role} is offered a board that would be empty`,
        ).not.toContain('/tracking/tablero')
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
    expect(es('navigation.people')).not.toBe(en('navigation.people'))
    expect(es('navigation.demographicFields')).not.toBe(en('navigation.demographicFields'))
  })
})

describe('leafNavItems', () => {
  it('replaces a grouped item with its children, because a group is a toggle and not a destination', () => {
    expect(leaves('company_admin')).toEqual([
      '/dashboard',
      '/surveys',
      '/surveys/templates',
      '/surveys/climate-trends',
      // Preguntas is a disclosure: its two children, never the group row itself.
      '/admin/question-bank',
      '/admin/question-library',
      '/action-plans',
      '/microclimates',
      '/admin/companies/company-1/analytics',
      '/analytics/benchmarks',
      '/analytics/ai-insights',
      '/admin/companies/company-1/reports',
      '/admin/companies/company-1/users',
      '/departments',
      '/admin/companies/company-1/demographic-fields',
      '/admin/companies/company-1',
      '/admin/audit',
    ])
    const items = leafNavItems(buildNavSections('company_admin', 'company-1'))
    expect(items.every((item) => !item.sub?.length)).toBe(true)
  })

  it('keeps a childless item as itself', () => {
    expect(leaves('super_admin')).toEqual([
      '/dashboard',
      '/surveys',
      '/surveys/templates',
      '/surveys/climate-trends',
      '/admin/question-bank',
      '/admin/question-library',
      '/action-plans',
      '/microclimates',
      '/analytics/benchmarks',
      '/analytics/ai-insights',
      '/departments',
      '/admin/companies',
      '/admin/system-settings',
      '/admin/system',
      '/admin/audit',
    ])
  })

  it('does not offer a super_admin the respondent listing, which would always be empty for them', () => {
    // `User.CompanyId` is NULL for a global super_admin (#191), so `/surveys/my`
    // correctly returns an empty list rather than an error.
    expect(hrefs(buildNavSections('super_admin', 'company-1'))).not.toContain('/surveys/my')
  })

  it('gives a role with no admin pages exactly its per-user leaves', () => {
    expect(leaves('employee')).toEqual(['/dashboard', '/surveys/my'])
  })
})

/**
 * The phone's tab bar is one tab per section of the rail (`mobileTabs`). Before the regroup it
 * was the first four leaves, which in the new order would be Inicio and three Encuestas rows,
 * with Seguimiento behind "Más".
 */
describe('mobileTabs', () => {
  const tabs = (role: string, trackingEnabled = false) => mobileTabs(buildNavSections(role, 'company-1', { trackingEnabled }))

  it('gives an administrator Inicio and one tab per section, named for the section', () => {
    for (const role of ['super_admin', 'company_admin']) {
      expect(tabs(role).map((tab) => tab.labelKey), role).toEqual([
        'navigation.home',
        'navigation.sectionSurveys',
        'navigation.sectionFollowUp',
        'navigation.sectionAnalytics',
      ])
    }
  })

  it('leads each section tab to the section’s first destination', () => {
    expect(tabs('super_admin').map((tab) => tab.href)).toEqual(['/dashboard', '/surveys', '/action-plans', '/analytics/benchmarks'])
    expect(tabs('super_admin', true).map((tab) => tab.href)).toEqual(['/dashboard', '/surveys', '/tracking/planes', '/analytics/benchmarks'])
    expect(tabs('company_admin').map((tab) => tab.href)).toEqual([
      '/dashboard',
      '/surveys',
      '/action-plans',
      '/admin/companies/company-1/analytics',
    ])
  })

  it('gives every home row its own tab, so a leader keeps Mi equipo and Mis encuestas', () => {
    expect(tabs('leader').map((tab) => [tab.labelKey, tab.href])).toEqual([
      ['navigation.myTeam', '/dashboard'],
      ['navigation.mySurveys', '/surveys/my'],
      ['navigation.sectionFollowUp', '/action-plans'],
    ])
    expect(tabs('leader', true).map((tab) => tab.href)).toEqual(['/dashboard', '/surveys/my', '/tracking/tablero'])
  })

  it('never spends a slot on a group toggle, and never takes more than four', () => {
    for (const role of ['super_admin', 'company_admin', 'leader']) {
      const destinations = new Set(leaves(role))
      const list = tabs(role)
      expect(list.length, role).toBeLessThanOrEqual(4)
      for (const tab of list) expect(destinations.has(tab.href), `${role}: ${tab.href}`).toBe(true)
    }
    // The slot count is a parameter, honoured.
    expect(mobileTabs(buildNavSections('super_admin', 'company-1'), 2)).toHaveLength(2)
  })
})

describe('sectionTitleKeyForPath', () => {
  const sections = buildNavSections('company_admin', 'company-1')

  it('names the group a page sits in, which is what the page eyebrow prints', () => {
    expect(sectionTitleKeyForPath('/admin/companies/company-1/users', sections)).toBe('navigation.sectionOrganization')
    expect(sectionTitleKeyForPath('/action-plans', sections)).toBe('navigation.sectionFollowUp')
    expect(sectionTitleKeyForPath('/surveys/templates', sections)).toBe('navigation.sectionSurveys')
    expect(sectionTitleKeyForPath('/admin/question-library', sections)).toBe('navigation.sectionSurveys')
    expect(sectionTitleKeyForPath('/admin/audit', sections)).toBe('navigation.sectionSystem')
  })

  it('resolves a detail route to its list page group rather than to no group', () => {
    expect(sectionTitleKeyForPath('/action-plans/abc-123', sections)).toBe('navigation.sectionFollowUp')
    expect(sectionTitleKeyForPath('/surveys/abc-123/results', sections)).toBe('navigation.sectionSurveys')
  })

  it('prints no eyebrow on the home row, which sits under no heading', () => {
    expect(sectionTitleKeyForPath('/dashboard', sections)).toBeNull()
  })

  it('prints no eyebrow for a route the nav does not cover, rather than guessing one', () => {
    expect(sectionTitleKeyForPath('/dev/chart-gallery', sections)).toBeNull()
    expect(sectionTitleKeyForPath('/login', sections)).toBeNull()
    // The inbox is reached from the bell now, not from a rail row.
    expect(sectionTitleKeyForPath('/notifications', sections)).toBeNull()
  })

  it('is empty for a role with no titled section, so a signed-out header prints nothing', () => {
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

  it('lights the tracking deployment’s Planes de Acción row on /action-plans too, while it still leads to the tracking listing', () => {
    // The ActionPlansList artboard highlights "Planes de Acción" on /action-plans in a
    // rail that also carries the Vista Consolidada, i.e. where tracking is on.
    const tracking = buildNavSections('company_admin', 'company-1', { trackingEnabled: true })
    expect(activeHref('/action-plans', tracking)).toBe('/tracking/planes')
    expect(activeHref('/action-plans/p1', tracking)).toBe('/tracking/planes')
    expect(activeHref('/tracking/planes/abc', tracking)).toBe('/tracking/planes')
    expect(activeHref('/tracking', tracking)).toBe('/tracking')
    // Where no tracking service is configured, the generic row is the one that lights.
    expect(activeHref('/action-plans', buildNavSections('company_admin', 'company-1'))).toBe('/action-plans')
  })

  it('lights no row, rather than the wrong one, on a destination the rail does not carry', () => {
    // /surveys/my sits under /surveys, but it is "Mis encuestas": an administrator's rail has no
    // such row, and lighting "Todas las encuestas" there named the wrong place (sweep, 12 Nov).
    expect(activeHref('/surveys/my', sections)).toBeNull()
    expect(activeHref('/surveys/my', buildNavSections('super_admin', undefined))).toBeNull()
    expect(activeHref('/surveys/sv-1', sections)).toBe('/surveys')
    // Where the rail does carry it, its own row lights.
    expect(activeHref('/surveys/my', buildNavSections('employee', 'company-1'))).toBe('/surveys/my')
    // The same for an administrator's own task list under the consolidado's /tracking.
    const tracking = buildNavSections('company_admin', 'company-1', { trackingEnabled: true })
    expect(activeHref('/tracking/mis-tareas', tracking)).toBeNull()
    expect(activeHref('/tracking/tablero', tracking)).toBe('/tracking')
    // The leader's tracking rail lights each of its three rows on its own route.
    const leader = buildNavSections('leader', 'company-1', { trackingEnabled: true })
    expect(activeHref('/tracking/tablero', leader)).toBe('/tracking/tablero')
    expect(activeHref('/tracking/planes/p1', leader)).toBe('/tracking/planes')
    expect(activeHref('/tracking/mis-tareas', leader)).toBe('/tracking/mis-tareas')
  })

  it('draws the tablero with the consolidado’s table glyph, as the TrackingTablero artboard does', () => {
    const rows = buildNavSections('leader', 'company-1', { trackingEnabled: true }).flatMap((section) => section.items)
    expect(rows.find((row) => row.href === '/tracking/tablero')?.icon).toBe(RailConsolidatedIcon)
  })
})

describe('the administrators’ rail glyphs', () => {
  it('draws Empresas, Estado, Banco and Biblioteca with their own glyphs', () => {
    const rows = buildNavSections('super_admin', 'company-1').flatMap((section) =>
      section.items.flatMap((item) => [item, ...(item.sub ?? [])]),
    )
    const icon = (key: string) => rows.find((row) => row.labelKey === key)?.icon
    expect(icon('navigation.companies')).toBe(RailCompaniesIcon)
    expect(icon('navigation.status')).toBe(RailStatusIcon)
    // Banco and Biblioteca sit side by side under Preguntas, so they must not share a glyph.
    expect(icon('navigation.questionBank')).toBe(RailQuestionBankIcon)
    expect(icon('navigation.questionLibrary')).toBe(RailQuestionLibraryIcon)
  })
})

describe('isPerUserOnly', () => {
  /**
   * `AdminLayout` draws a 236px rail, a mobile tab bar and a command-palette chip only
   * when this is false. It is the whole gate, so the cases below are the shell's
   * behaviour, not a helper's.
   */
  const sections = (role: string | undefined, trackingEnabled = false) =>
    buildNavSections(role, 'company-1', { trackingEnabled })

  it.each(['employee', 'supervisor'])('is true for %s, whose every page is its own', (role) => {
    expect(isPerUserOnly(sections(role))).toBe(true)
  })

  it('stays true with the tracking module on, because Mis Tareas is also their own', () => {
    // Tracking is a DEPLOYMENT capability, so a build with the service configured adds a
    // fourth row for these roles. It is still their own task list, so it must not bring
    // the rail back — and a local build with `VITE_TRACKING_API_BASE_URL` set is exactly
    // where this would otherwise be noticed only by eye.
    expect(leafNavItems(sections('employee', true)).map((item) => item.href)).toContain(
      '/tracking/mis-tareas',
    )
    expect(isPerUserOnly(sections('employee', true))).toBe(true)
  })

  it.each(['super_admin', 'company_admin', 'leader'])(
    'is false for %s, who can reach somewhere the page is not',
    (role) => {
      expect(isPerUserOnly(sections(role))).toBe(false)
    },
  )

  it('comes back on its own the day one of those roles gains an admin page', () => {
    // The reason this reads the SECTIONS instead of a role list. A hardcoded
    // ['employee','supervisor'] would answer today and then go quietly stale: the rail
    // would stay gone from a role that had somewhere to go, and nothing would say so.
    const withAnAdminPage: NavSection[] = [
      ...sections('employee'),
      {
        titleKey: 'navigation.sectionOrganization',
        items: [{ labelKey: 'x', href: '/admin/companies', icon: RailCompaniesIcon }],
      },
    ]

    expect(isPerUserOnly(withAnAdminPage)).toBe(false)
  })

  it('is false for no sections at all, so an unknown role keeps the shell it had', () => {
    // Stripping the chrome off a role this module has never heard of is a guess, and the
    // shell it already has is the safer wrong answer.
    expect(isPerUserOnly([])).toBe(false)
    expect(isPerUserOnly([{ titleKey: 'empty', items: [] } satisfies NavSection])).toBe(false)
  })
})

describe('drawsRespondentShell', () => {
  /**
   * The shell's actual gate: `AdminLayout` draws the railless strip, and `useRespondentShell`
   * reports it, exactly when this is true. It is {@link isPerUserOnly} less the supervisor.
   */
  const sections = (role: string | undefined, trackingEnabled = false) =>
    buildNavSections(role, 'company-1', { trackingEnabled })

  it.each([false, true])('is true for an employee (tracking %s), as ESPH asked on 18 Oct', (tracking) => {
    expect(drawsRespondentShell('employee', sections('employee', tracking))).toBe(true)
  })

  it.each([false, true])(
    'is false for a supervisor (tracking %s), whose rows are all its own — ruled 2026-11-12',
    (tracking) => {
      // The rows did not change: this is still a per-user-only set, so the exception is what
      // brings the rail back and not a new destination.
      expect(isPerUserOnly(sections('supervisor', tracking))).toBe(true)
      expect(drawsRespondentShell('supervisor', sections('supervisor', tracking))).toBe(false)
    },
  )

  it.each(['super_admin', 'company_admin', 'leader'])('is false for %s, as before', (role) => {
    expect(drawsRespondentShell(role, sections(role))).toBe(false)
  })
})
