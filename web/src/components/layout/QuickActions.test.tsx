import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { ClipboardList } from 'lucide-react'
import { QuickActions, type QuickAction } from './QuickActions'

function renderActions(actions: QuickAction[]) {
  return render(
    <MemoryRouter>
      <QuickActions actions={actions} />
    </MemoryRouter>,
  )
}

const BASE: QuickAction = {
  id: 'survey',
  label: 'Create New Survey',
  href: '/surveys/new',
  icon: ClipboardList,
}

describe('QuickActions', () => {
  afterEach(cleanup)

  it('renders each action as a link to its destination', () => {
    renderActions([BASE])

    expect(screen.getByRole('link', { name: /Create New Survey/ }).getAttribute('href')).toBe(
      '/surveys/new',
    )
  })

  /**
   * The dashboard's three tiles are the only invitation on that page to start something,
   * and a bare verb is not enough to choose between them.
   */
  it('renders the second line when an action has one', () => {
    renderActions([{ ...BASE, description: 'From a template or blank' }])

    expect(screen.getByText('From a template or blank')).toBeTruthy()
  })

  /**
   * `CompanyDetailPage` passes four actions with no description; the tile must not grow an
   * empty line for them.
   */
  it('renders nothing extra when an action has no second line', () => {
    renderActions([BASE])

    const link = screen.getByRole('link', { name: /Create New Survey/ })
    expect(link.textContent).toBe('Create New Survey')
  })
})
