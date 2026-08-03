import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'
import { Button } from './button'

afterEach(cleanup)

function Example() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button>Save</Button>
      </TooltipTrigger>
      <TooltipContent>Saves without closing</TooltipContent>
    </Tooltip>
  )
}

describe('Tooltip', () => {
  it('is hidden until the trigger is focused or hovered', () => {
    render(<Example />)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('appears on keyboard focus, not only on hover', async () => {
    // Hover-only tooltips are invisible to keyboard users.
    render(<Example />)
    await userEvent.tab()
    expect(await screen.findByRole('tooltip')).toBeTruthy()
  })

  it('appears on hover', async () => {
    render(<Example />)
    await userEvent.hover(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('tooltip')).toBeTruthy()
  })

  it('needs no provider of its own', async () => {
    // Tooltip mounts its own TooltipProvider, so a caller cannot forget one.
    render(<Example />)
    await userEvent.tab()
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy())
  })
})
