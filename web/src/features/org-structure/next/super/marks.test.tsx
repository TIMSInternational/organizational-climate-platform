import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Switch } from '../../../../components/ui'
import { MiniBar } from './parts'

/**
 * Two marks the fidelity refuter found missing on screen while every behaviour test was
 * green — happy-dom has no layout, so the token each one paints with is what is pinned here.
 */

afterEach(cleanup)

describe('the marks the shots showed missing', () => {
  it('paints the mini bar’s track in line-default: line-light IS the dark card’s colour (#1f173b)', () => {
    const { container } = render(<MiniBar percent={40} />)
    const track = container.firstElementChild as HTMLElement
    expect(track.className.split(/\s+/)).toContain('bg-line-default')
    expect(track.className.split(/\s+/)).not.toContain('bg-line-light')
  })

  it('gives the switch a white knob (fg-on-accent), as the canvas draws it', () => {
    const { container } = render(<Switch checked aria-label="on" />)
    const knob = container.querySelector('[data-slot="switch-thumb"]') as HTMLElement
    expect(knob.className.split(/\s+/)).toContain('bg-fg-on-accent')
    expect(knob.className.split(/\s+/)).not.toContain('bg-surface-panel')
  })
})
