import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible'

afterEach(cleanup)

describe('Collapsible', () => {
  it('toggles its content', async () => {
    render(
      <Collapsible>
        <CollapsibleTrigger>Advanced</CollapsibleTrigger>
        <CollapsibleContent>hidden details</CollapsibleContent>
      </Collapsible>,
    )
    const trigger = screen.getByRole('button', { name: 'Advanced' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    await userEvent.click(trigger)
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('true'))
    expect(screen.getByText('hidden details')).toBeTruthy()
  })

  it('honours defaultOpen', () => {
    render(
      <Collapsible defaultOpen>
        <CollapsibleTrigger>Advanced</CollapsibleTrigger>
        <CollapsibleContent>hidden details</CollapsibleContent>
      </Collapsible>,
    )
    expect(screen.getByText('hidden details')).toBeTruthy()
  })
})
