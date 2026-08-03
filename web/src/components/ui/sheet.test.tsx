import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from './sheet'
import { Button } from './button'

afterEach(cleanup)

describe('Sheet', () => {
  it('opens, traps focus, and restores it on Escape', async () => {
    render(
      <Sheet>
        <SheetTrigger asChild>
          <Button>Open</Button>
        </SheetTrigger>
        <SheetContent closeLabel="Close">
          <SheetTitle>Filters</SheetTitle>
          <Button>Apply</Button>
        </SheetContent>
      </Sheet>,
    )
    const trigger = screen.getByRole('button', { name: 'Open' })
    await userEvent.click(trigger)

    const sheet = await screen.findByRole('dialog')
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true))

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('records the side it is anchored to', async () => {
    render(
      <Sheet defaultOpen>
        <SheetContent side="left" closeLabel="Close">
          <SheetTitle>Filters</SheetTitle>
        </SheetContent>
      </Sheet>,
    )
    const sheet = await screen.findByRole('dialog')
    expect(sheet.getAttribute('data-side')).toBe('left')
  })

  it('defaults to the right edge', async () => {
    render(
      <Sheet defaultOpen>
        <SheetContent closeLabel="Close">
          <SheetTitle>Filters</SheetTitle>
        </SheetContent>
      </Sheet>,
    )
    expect((await screen.findByRole('dialog')).getAttribute('data-side')).toBe('right')
  })
})
