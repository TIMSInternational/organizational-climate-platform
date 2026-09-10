import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { buildNavSections, type NavItem } from './navSections'
import {
  RailAnalyticsIcon,
  RailBenchmarksIcon,
  RailConsolidatedIcon,
  RailDashboardIcon,
  RailDepartmentsIcon,
  RailInsightsIcon,
  RailMicroclimatesIcon,
  RailNotificationsIcon,
  RailPlansIcon,
  RailQuestionBankIcon,
  RailQuestionLibraryIcon,
  RailReportsIcon,
  RailShieldIcon,
  RailSurveysIcon,
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
  it('gives every row of the company administrator rail the glyph its artboard draws', () => {
    // Dashboard.png / SurveysList.png / ClimateTrends.png, rail rows top to bottom.
    const icon = iconsOf('company_admin', true)
    expect(icon('navigation.dashboard')).toBe(RailDashboardIcon)
    expect(icon('navigation.companyAdministration')).toBe(RailShieldIcon)
    expect(icon('navigation.trackingConsolidado')).toBe(RailConsolidatedIcon)
    expect(icon('navigation.trackingPlans')).toBe(RailPlansIcon)
    expect(icon('navigation.microclimates')).toBe(RailMicroclimatesIcon)
    expect(icon('navigation.surveys')).toBe(RailSurveysIcon)
    expect(icon('navigation.surveyTemplates')).toBe(RailTemplatesIcon)
    expect(icon('navigation.climateTrends')).toBe(RailTrendsIcon)
    expect(icon('navigation.benchmarks')).toBe(RailBenchmarksIcon)
    expect(icon('navigation.aiInsights')).toBe(RailInsightsIcon)
    expect(icon('navigation.reports')).toBe(RailReportsIcon)
    expect(icon('navigation.analytics')).toBe(RailAnalyticsIcon)
    expect(icon('navigation.departments')).toBe(RailDepartmentsIcon)
    expect(icon('navigation.questionBank')).toBe(RailQuestionBankIcon)
    expect(icon('navigation.questionLibrary')).toBe(RailQuestionLibraryIcon)
    expect(icon('notifications.title')).toBe(RailNotificationsIcon)
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
