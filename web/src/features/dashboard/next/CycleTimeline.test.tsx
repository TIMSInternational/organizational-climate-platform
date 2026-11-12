import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import CycleTimeline from './CycleTimeline'

afterEach(cleanup)

const steps = [
  { id: 'a', code: 'Q1', detail: 'cerró 14 mar', status: 'closed' as const },
  { id: 'b', code: 'Pulso de incorporación abierta', detail: 'cierra 30 sept', status: 'open' as const },
  { id: 'c', code: 'Entrevista de salida', detail: 'por planificar', status: 'planned' as const },
]

// happy-dom has no layout, so this pins the contract the screenshot measured: the rail
// turns vertical by the width of the CARD it sits in (a container query), not the window.
// At 1440 the rail's card is about 440px and the horizontal rail wrapped every label.
describe('CycleTimeline', () => {
  it('is its own size container, and turns vertical under 36rem of it rather than under the sm viewport', () => {
    const { container } = render(<CycleTimeline steps={steps} label="Ciclo" />)
    const root = container.querySelector('[data-slot="cycle"]') as HTMLElement
    expect(root.className.split(/\s+/)).toContain('@container')
    const track = container.querySelector('[data-slot="cycle-track"]') as HTMLElement
    expect(track.className.split(/\s+/)).toContain('@max-xl:hidden')
    const list = container.querySelector('ol') as HTMLElement
    expect(list.className.split(/\s+/)).toContain('@max-xl:grid-flow-row')
    // No viewport breakpoint left anywhere in the rail.
    expect(container.innerHTML).not.toMatch(/(^|[\s"])(max-)?sm:/)
  })
})
