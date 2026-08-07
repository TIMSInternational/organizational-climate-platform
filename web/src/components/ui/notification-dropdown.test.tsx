import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotificationDropdown, type NotificationItem } from './notification-dropdown'
import { DropdownMenuItem } from './dropdown-menu'

afterEach(cleanup)

const items: NotificationItem[] = [
  { id: '1', title: 'Survey closed', description: 'Q3 climate', timestamp: 'hace 2 h' },
  { id: '2', title: 'New response', read: true },
]

function Example({ notifications = items, onSelect }: {
  notifications?: NotificationItem[]
  onSelect?: (n: NotificationItem) => void
}) {
  return (
    <NotificationDropdown
      notifications={notifications}
      triggerLabel="Notificaciones"
      heading="Notificaciones"
      emptyText="Sin notificaciones"
      onSelect={onSelect}
    />
  )
}

describe('NotificationDropdown', () => {
  it('labels its trigger from the caller', () => {
    render(<Example />)
    expect(screen.getByRole('button', { name: 'Notificaciones' })).toBeTruthy()
  })

  it('shows the unread count, not the total', () => {
    // One of the two fixtures is read.
    render(<Example />)
    expect(screen.getByText('1')).toBeTruthy()
  })

  /**
   * Capped at the same 99 the sidebar's `.nav-badge` uses, so the two places the
   * shell shows this number cannot print different ones. Rendered in Chrome at 150
   * unread before the cap existed: the rail said "99+" and the bell said "150".
   */
  it('caps the count so the rail and the bell agree, and the badge stays on the icon', () => {
    const many = Array.from({ length: 150 }, (_, index) => ({ id: String(index), title: 'x' }))
    render(<Example notifications={many} />)
    expect(screen.getByText('99+')).toBeTruthy()
    expect(screen.queryByText('150')).toBeNull()
  })

  it('does not cap a count that fits', () => {
    const some = Array.from({ length: 99 }, (_, index) => ({ id: String(index), title: 'x' }))
    render(<Example notifications={some} />)
    expect(screen.getByText('99')).toBeTruthy()
  })

  it('shows no count badge when everything is read', () => {
    render(<Example notifications={[{ id: '1', title: 'x', read: true }]} />)
    expect(screen.queryByText('1')).toBeNull()
  })

  it('lists the notifications it is given', async () => {
    render(<Example />)
    await userEvent.click(screen.getByRole('button', { name: 'Notificaciones' }))
    expect(await screen.findByText('Survey closed')).toBeTruthy()
    expect(screen.getByText('Q3 climate')).toBeTruthy()
    expect(screen.getByText('hace 2 h')).toBeTruthy()
  })

  it('reports the selected notification and closes', async () => {
    const onSelect = vi.fn()
    render(<Example onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: 'Notificaciones' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Survey closed/ }))

    expect(onSelect).toHaveBeenCalledWith(items[0])
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('shows the caller-supplied empty text', async () => {
    render(<Example notifications={[]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Notificaciones' }))
    expect(await screen.findByText('Sin notificaciones')).toBeTruthy()
  })

  it('fetches nothing itself — the data contract stays generic for #99', async () => {
    // The legacy version fetched its own notifications and knew the legacy row
    // shape. This one only renders what it is handed.
    render(<Example notifications={[{ id: 'x', title: 'Only what I was given' }]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Notificaciones' }))
    expect(await screen.findByText('Only what I was given')).toBeTruthy()
    expect(screen.queryByText('Survey closed')).toBeNull()
  })

  it('renders a footer action when given one', async () => {
    render(
      <NotificationDropdown
        notifications={items}
        triggerLabel="Notificaciones"
        heading="Notificaciones"
        emptyText="Sin notificaciones"
        footer={<DropdownMenuItem>Marcar todo como leído</DropdownMenuItem>}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Notificaciones' }))
    expect(await screen.findByRole('menuitem', { name: 'Marcar todo como leído' })).toBeTruthy()
  })
})
