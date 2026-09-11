import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { PageMetaSentences } from './PageMeta'

describe('PageMetaSentences', () => {
  afterEach(cleanup)

  it('draws each later sentence’s "·" in its own 8px box, pulled into an 18px gap and clipped by the run, so a sentence that wraps leaves it behind', () => {
    const { container } = render(
      <PageMetaSentences
        sentences={[
          { id: 'when', text: 'abierta hasta el 11 de septiembre a las 21:06' },
          { id: 'tally', text: '0 de 20 respuestas', muted: true },
        ]}
      />,
    )
    const run = container.querySelector<HTMLElement>('[data-slot="page-meta-sentences"]')
    expect(run).not.toBeNull()
    const [first, second] = [...run!.children] as HTMLElement[]
    // The first sentence carries no separator.
    expect(first!.querySelector('[data-slot="page-meta-separator"]')).toBeNull()
    expect(first!.textContent).toBe('abierta hasta el 11 de septiembre a las 21:06')
    // A later one: its "·" is decoration in an 8px box, and the sentence is pulled back by exactly that box.
    const separator = second!.querySelector<HTMLElement>('[data-slot="page-meta-separator"]')
    expect(separator?.textContent).toBe('·')
    expect(separator?.getAttribute('aria-hidden')).toBe('true')
    expect(separator?.className.split(' ')).toContain('w-2')
    expect(second!.className.split(' ')).toContain('-ml-2')
    // The sentence's own text never carries the "·": that is what opened the wrapped line.
    expect(second!.lastElementChild?.textContent).toBe('0 de 20 respuestas')
    // Mid-line: 18px of gap less the 8px leave the board's 10px before the "·". At a line's
    // start the 8px fall outside the run, which clips them.
    expect(run!.className.split(' ')).toContain('gap-x-4.5')
    expect(run!.className.split(' ')).toContain('overflow-hidden')
    // The tally keeps the board's tertiary ink, its "·" included.
    expect(second!.className.split(' ')).toContain('text-fg-tertiary')
    expect(first!.className.split(' ')).not.toContain('text-fg-tertiary')
  })
})
