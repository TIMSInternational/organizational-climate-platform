import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { buildNavSections, type NavItem } from './navSections'
import {
  RailActivityIcon,
  RailAnalyticsIcon,
  RailBenchmarksIcon,
  RailCompaniesIcon,
  RailConsolidatedIcon,
  RailDepartmentsIcon,
  RailHomeIcon,
  RailInsightsIcon,
  RailMicroclimatesIcon,
  RailMySurveysIcon,
  RailPeopleIcon,
  RailPlansIcon,
  RailQuestionBankIcon,
  RailQuestionLibraryIcon,
  RailQuestionsIcon,
  RailReportsIcon,
  RailSettingsIcon,
  RailStatusIcon,
  RailSurveysIcon,
  RailTasksIcon,
  RailTemplatesIcon,
  RailTrendsIcon,
} from './railIcons'

function flatten(items: NavItem[]): NavItem[] {
  return items.flatMap((item) => [item, ...flatten(item.sub ?? [])])
}

function iconsOf(role: string, trackingEnabled: boolean) {
  const items = flatten(buildNavSections(role, 'company-1', { trackingEnabled }).flatMap((section) => section.items))
  return (labelKey: string) => items.find((item) => item.labelKey === labelKey)?.icon
}

describe('the rail draws the canvas glyphs', () => {
  it('gives every row of the company administrator rail its glyph', () => {
    const icon = iconsOf('company_admin', true)
    expect(icon('navigation.home')).toBe(RailHomeIcon)
    expect(icon('navigation.surveys')).toBe(RailSurveysIcon)
    expect(icon('navigation.templates')).toBe(RailTemplatesIcon)
    expect(icon('navigation.climateTrends')).toBe(RailTrendsIcon)
    expect(icon('navigation.questions')).toBe(RailQuestionsIcon)
    expect(icon('navigation.questionBank')).toBe(RailQuestionBankIcon)
    expect(icon('navigation.questionLibrary')).toBe(RailQuestionLibraryIcon)
    expect(icon('navigation.trackingPlans')).toBe(RailPlansIcon)
    expect(icon('navigation.trackingConsolidado')).toBe(RailConsolidatedIcon)
    expect(icon('navigation.microclimates')).toBe(RailMicroclimatesIcon)
    expect(icon('navigation.overview')).toBe(RailAnalyticsIcon)
    expect(icon('navigation.references')).toBe(RailBenchmarksIcon)
    expect(icon('navigation.aiInsights')).toBe(RailInsightsIcon)
    expect(icon('navigation.reports')).toBe(RailReportsIcon)
    expect(icon('navigation.people')).toBe(RailPeopleIcon)
    expect(icon('navigation.departments')).toBe(RailDepartmentsIcon)
    expect(icon('navigation.companySettings')).toBe(RailCompaniesIcon)
    expect(icon('navigation.activity')).toBe(RailActivityIcon)
  })

  it('gives the super administrator’s Sistema rows and a leader’s rows their glyphs', () => {
    const superIcon = iconsOf('super_admin', false)
    expect(superIcon('navigation.companies')).toBe(RailCompaniesIcon)
    expect(superIcon('navigation.systemConfiguration')).toBe(RailSettingsIcon)
    expect(superIcon('navigation.status')).toBe(RailStatusIcon)
    const leaderIcon = iconsOf('leader', true)
    expect(leaderIcon('navigation.myTeam')).toBe(RailPeopleIcon)
    expect(leaderIcon('navigation.mySurveys')).toBe(RailMySurveysIcon)
    expect(leaderIcon('navigation.trackingMisTareas')).toBe(RailTasksIcon)
    expect(leaderIcon('navigation.trackingDashboard')).toBe(RailConsolidatedIcon)
  })

  it('never draws two rows of one rail with the same glyph', () => {
    for (const role of ['super_admin', 'company_admin', 'leader']) {
      for (const trackingEnabled of [false, true]) {
        const items = flatten(buildNavSections(role, 'company-1', { trackingEnabled }).flatMap((section) => section.items))
        // A group and its first child share an href, never a glyph: two rows with one picture is
        // how a reader learns to stop trusting the pictures.
        const glyphs = items.map((item) => item.icon)
        expect(glyphs.length, `${role} tracking=${trackingEnabled}`).toBe(new Set(glyphs).size)
      }
    }
  })

  it('keeps the two-ring target on the action plans row when tracking is off', () => {
    expect(iconsOf('company_admin', false)('navigation.actionPlans')).toBe(RailPlansIcon)
  })

  it('strokes each glyph as the canvas does: 16px box, currentColor, 1.6 wide, round caps', () => {
    const { container } = render(<RailPlansIcon className="nav-icon" />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16')
    expect(svg?.getAttribute('stroke')).toBe('currentColor')
    expect(svg?.getAttribute('stroke-width')).toBe('1.6')
    expect(svg?.getAttribute('stroke-linecap')).toBe('round')
    expect(svg?.getAttribute('fill')).toBe('none')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(svg?.getAttribute('class')).toBe('nav-icon')
    // Two rings, as drawn; lucide's Target has three.
    expect([...(svg?.querySelectorAll('circle') ?? [])].map((circle) => circle.getAttribute('r'))).toEqual(['6', '2.5'])
  })
})
