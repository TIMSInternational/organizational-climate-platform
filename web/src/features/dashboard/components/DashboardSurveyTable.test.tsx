import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import DashboardSurveyTable from './DashboardSurveyTable'
import { TranslationProvider } from '../../../i18n'

/**
 * The ongoing-surveys table the company and department dashboards share. The department
 * payload sends a team count under the floor of 5 as `null` (`DashboardEndpoints.DepartmentCountFloor`),
 * and the table must draw that as protected — a 0 would read "nobody in this team answered".
 */
describe('DashboardSurveyTable', () => {
  afterEach(cleanup)

  it('draws a count the server withheld as a protected cell, never as 0', () => {
    render(
      <TranslationProvider>
        <MemoryRouter>
          <DashboardSurveyTable
            showTarget={false}
            surveys={[
              { id: 'q4', title: 'Clima Q4', status: 'active', endDate: '2026-10-10T02:03:39Z', responseCount: null },
              { id: 'y', title: 'Clima 2026', status: 'active', endDate: '2026-10-10T02:03:39Z', responseCount: 14 },
            ]}
          />
        </MemoryRouter>
      </TranslationProvider>,
    )

    const [, withheld, counted] = screen.getAllByRole('row')
    expect(within(withheld!).getByRole('img')).toBeTruthy()
    expect(withheld!.textContent).not.toMatch(/(^|\D)0(\D|$)/)
    // The counted row prints its number, so this does not pass by printing nothing.
    expect(within(counted!).queryByRole('img')).toBeNull()
    expect(counted!.textContent).toContain('14')
  })
})
