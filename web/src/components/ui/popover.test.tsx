import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { Button } from './button'

afterEach(cleanup)

function Example() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button>Options</Button>
      </PopoverTrigger>
      <PopoverContent>
        <Button>Inside</Button>
      </PopoverContent>
    </Popover>
  )
}

describe('Popover', () => {
  it('is closed until triggered', () => {
    render(<Example />)
    expect(screen.queryByRole('button', { name: 'Inside' })).toBeNull()
  })

  it('opens on click and reports expanded state', async () => {
    render(<Example />)
    const trigger = screen.getByRole('button', { name: 'Options' })
    await userEvent.click(trigger)

    expect(await screen.findByRole('button', { name: 'Inside' })).toBeTruthy()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('closes on Escape and restores focus', async () => {
    render(<Example />)
    const trigger = screen.getByRole('button', { name: 'Options' })
    await userEvent.click(trigger)
    await screen.findByRole('button', { name: 'Inside' })

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Inside' })).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('is not modal — it does not hide the page from assistive tech', async () => {
    render(
      <div>
        <p data-testid="behind">behind</p>
        <Example />
      </div>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Options' }))
    await screen.findByRole('button', { name: 'Inside' })
    // The distinction from Dialog: a popover leaves the rest of the page readable.
    expect(screen.getByTestId('behind').closest('[aria-hidden=true]')).toBeNull()
  })
})
