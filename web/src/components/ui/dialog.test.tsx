import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog'
import { Button } from './button'

afterEach(cleanup)

function Example() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Open</Button>
      </DialogTrigger>
      <DialogContent closeLabel="Close">
        <DialogHeader>
          <DialogTitle>Delete company</DialogTitle>
          <DialogDescription>This cannot be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button>Cancel</Button>
          <Button variant="destructive">Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

describe('Dialog', () => {
  it('is closed until the trigger is used', () => {
    render(<Example />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens from the trigger', async () => {
    render(<Example />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('hides the rest of the page from assistive tech while open', async () => {
    render(
      <div>
        <p data-testid="behind">behind</p>
        <Example />
      </div>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    const dialog = await screen.findByRole('dialog')

    // Radix implements modality by aria-hidden-ing the content outside the
    // portal, not by setting aria-modal on the dialog — verified against the
    // rendered output rather than assumed. Without this a screen-reader user can
    // wander out of the dialog even though sighted users cannot.
    const outside = Array.from(document.body.children).filter(
      (child) => !child.contains(dialog),
    )
    expect(outside.length).toBeGreaterThan(0)
    for (const element of outside) {
      expect(element.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('is named and described by its own title and description', async () => {
    render(<Example />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))

    const dialog = await screen.findByRole('dialog')
    // Radix wires these; assert them because a hand-rolled port usually forgets.
    expect(dialog.getAttribute('aria-labelledby')).toBe(
      screen.getByText('Delete company').id,
    )
    expect(dialog.getAttribute('aria-describedby')).toBe(
      screen.getByText('This cannot be undone.').id,
    )
  })

  it('moves focus into the dialog on open', async () => {
    render(<Example />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))

    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  })

  it('traps Tab inside the dialog', async () => {
    render(<Example />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))

    // Cycle past the last control; focus must come back round, never escape to
    // the trigger behind the overlay.
    for (let i = 0; i < 6; i += 1) {
      await userEvent.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })

  it('closes on Escape and restores focus to the trigger', async () => {
    render(<Example />)
    const trigger = screen.getByRole('button', { name: 'Open' })
    await userEvent.click(trigger)
    await screen.findByRole('dialog')

    await userEvent.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // Restore-focus-on-close is the other half of the trap, and the half that
    // regresses silently.
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('closes from its own close button', async () => {
    render(<Example />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    await screen.findByRole('dialog')

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('can omit the close button when the caller supplies its own', async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent showCloseButton={false}>
          <DialogTitle>t</DialogTitle>
        </DialogContent>
      </Dialog>,
    )
    await screen.findByRole('dialog')
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })
})
