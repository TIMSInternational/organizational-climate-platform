import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'

afterEach(cleanup)

function Example() {
  return (
    <Tabs defaultValue="users">
      <TabsList>
        <TabsTrigger value="users">Users</TabsTrigger>
        <TabsTrigger value="invitations">Invitations</TabsTrigger>
      </TabsList>
      <TabsContent value="users">user list</TabsContent>
      <TabsContent value="invitations">invitation list</TabsContent>
    </Tabs>
  )
}

describe('Tabs', () => {
  it('exposes a tablist with tabs and shows only the active panel', () => {
    render(<Example />)
    expect(screen.getByRole('tablist')).toBeTruthy()
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(screen.getByText('user list')).toBeTruthy()
    expect(screen.queryByText('invitation list')).toBeNull()
  })

  it('switches panel on click', async () => {
    render(<Example />)
    await userEvent.click(screen.getByRole('tab', { name: 'Invitations' }))
    expect(screen.getByText('invitation list')).toBeTruthy()
    expect(screen.queryByText('user list')).toBeNull()
  })

  it('reports the selected tab', async () => {
    render(<Example />)
    expect(screen.getByRole('tab', { name: 'Users' }).getAttribute('aria-selected')).toBe('true')
    await userEvent.click(screen.getByRole('tab', { name: 'Invitations' }))
    expect(screen.getByRole('tab', { name: 'Invitations' }).getAttribute('aria-selected')).toBe(
      'true',
    )
  })

  it('is a single tab stop with arrow-key navigation', async () => {
    render(<Example />)
    const [users, invitations] = screen.getAllByRole('tab')

    await userEvent.tab()
    expect(document.activeElement).toBe(users)

    await userEvent.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(invitations)
  })

  it('links each tab to its panel', () => {
    render(<Example />)
    const tab = screen.getByRole('tab', { name: 'Users' })
    const panel = screen.getByRole('tabpanel')
    expect(tab.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-labelledby')).toBe(tab.id)
  })
})
