import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ScrollArea } from './scroll-area'

afterEach(cleanup)

describe('ScrollArea', () => {
  it('renders its children inside a viewport', () => {
    const { container } = render(
      <ScrollArea>
        <p>a long list</p>
      </ScrollArea>,
    )
    expect(screen.getByText('a long list')).toBeTruthy()
    expect(container.querySelector('[data-slot=scroll-area-viewport]')).toBeTruthy()
  })

  it('keeps content in the accessibility tree — the scroller is not a barrier', () => {
    render(
      <ScrollArea>
        <button>Deep item</button>
      </ScrollArea>,
    )
    expect(screen.getByRole('button', { name: 'Deep item' })).toBeTruthy()
  })
})
