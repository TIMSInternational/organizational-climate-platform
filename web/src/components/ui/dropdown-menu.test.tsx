import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu'
import { Button } from './button'

afterEach(cleanup)

function Example({ onEdit }: { onEdit?: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>Actions</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Manage</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
        <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

describe('DropdownMenu', () => {
  it('opens on click and exposes a menu', async () => {
    render(<Example />)
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }))
    expect(await screen.findByRole('menu')).toBeTruthy()
    expect(screen.getAllByRole('menuitem')).toHaveLength(2)
  })

  it('runs the selected item and closes', async () => {
    const onEdit = vi.fn()
    render(<Example onEdit={onEdit} />)
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))

    expect(onEdit).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('opens from the keyboard and moves through items with arrows', async () => {
    render(<Example />)
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')

    const items = await screen.findAllByRole('menuitem')
    await waitFor(() => expect(document.activeElement).toBe(items[0]))

    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(items[1])
  })

  it('closes on Escape and restores focus to the trigger', async () => {
    render(<Example />)
    const trigger = screen.getByRole('button', { name: 'Actions' })
    await userEvent.click(trigger)
    await screen.findByRole('menu')

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('marks a destructive item so it is visually distinct', async () => {
    render(<Example />)
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }))
    const destructive = await screen.findByRole('menuitem', { name: 'Delete' })
    expect(destructive.getAttribute('data-variant')).toBe('destructive')
  })
})
