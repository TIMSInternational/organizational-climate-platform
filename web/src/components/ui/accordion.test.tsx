import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './accordion'

afterEach(cleanup)

function Example({ type = 'single' as const }) {
  return (
    <Accordion type={type} collapsible>
      <AccordionItem value="a">
        <AccordionTrigger>Section A</AccordionTrigger>
        <AccordionContent>body A</AccordionContent>
      </AccordionItem>
      <AccordionItem value="b">
        <AccordionTrigger>Section B</AccordionTrigger>
        <AccordionContent>body B</AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

describe('Accordion', () => {
  it('starts collapsed', () => {
    render(<Example />)
    expect(screen.getByRole('button', { name: 'Section A' }).getAttribute('aria-expanded')).toBe(
      'false',
    )
  })

  it('expands on click and reports it', async () => {
    render(<Example />)
    await userEvent.click(screen.getByRole('button', { name: 'Section A' }))
    await waitFor(() => expect(screen.getByText('body A')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Section A' }).getAttribute('aria-expanded')).toBe(
      'true',
    )
  })

  it('collapses again when collapsible', async () => {
    render(<Example />)
    const trigger = screen.getByRole('button', { name: 'Section A' })
    await userEvent.click(trigger)
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('true'))
    await userEvent.click(trigger)
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'))
  })

  it('closes the other section in single mode', async () => {
    render(<Example />)
    await userEvent.click(screen.getByRole('button', { name: 'Section A' }))
    await userEvent.click(screen.getByRole('button', { name: 'Section B' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Section A' }).getAttribute('aria-expanded')).toBe(
        'false',
      ),
    )
  })

  it('links each trigger to its region', async () => {
    render(<Example />)
    const trigger = screen.getByRole('button', { name: 'Section A' })
    await userEvent.click(trigger)
    const region = await screen.findByRole('region')
    expect(trigger.getAttribute('aria-controls')).toBe(region.id)
  })
})
