import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Note } from './note'

afterEach(cleanup)

describe('Note', () => {
  it('renders its text and keeps the icon out of the accessible name', () => {
    const { container } = render(
      <Note icon={<svg data-testid="glyph" />}>Los comentarios se muestran como frecuencia de palabras.</Note>,
    )
    expect(screen.getByText('Los comentarios se muestran como frecuencia de palabras.')).toBeTruthy()
    const glyph = screen.getByTestId('glyph')
    expect(glyph.closest('[aria-hidden="true"]')).not.toBeNull()
    // A standing fact, not an event: no live role.
    expect(container.querySelector('[role]')).toBeNull()
  })

  it('draws neutral on the quiet grey fill by default', () => {
    render(<Note>Texto</Note>)
    const note = screen.getByText('Texto').closest('[data-slot="note"]') as HTMLElement
    expect(note.getAttribute('data-tone')).toBe('neutral')
    expect(note.className.split(/\s+/)).toContain('bg-surface-fill-subtle')
    expect(note.className.split(/\s+/)).not.toContain('bg-accent-blue-soft')
  })

  it('draws info on the blue tint', () => {
    render(<Note tone="info">Texto</Note>)
    const note = screen.getByText('Texto').closest('[data-slot="note"]') as HTMLElement
    expect(note.className.split(/\s+/)).toContain('bg-accent-blue-soft')
    expect(note.className.split(/\s+/)).not.toContain('bg-surface-fill-subtle')
  })

  it('never offers a tone in a result-area colour', () => {
    // Amber, green and red are Oportunidad, Fortaleza and Crítica only. A note has no tone
    // that paints with them.
    const { container } = render(
      <>
        <Note>a</Note>
        <Note tone="info">b</Note>
      </>,
    )
    expect(container.innerHTML).not.toMatch(/band-|chip-warning|accent-amber|accent-green|accent-red/)
  })
})
