import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TranslationProvider } from '../../../i18n'
import en from '../../../i18n/en.json'
import { GeneratedChip, GeneratedNote, SectionHeading } from './parts'

afterEach(cleanup)

const wrap = (node: React.ReactNode) => render(<TranslationProvider>{node}</TranslationProvider>)

describe('analytics parts', () => {
  it('puts the count inside the heading, in the sans at tabular figures, never a third face', () => {
    wrap(<SectionHeading id="h" title="Findings" count={4} aside="most serious first" />)
    expect(screen.getByRole('heading', { name: 'Findings 4' })).toBeTruthy()
    const count = document.querySelector('[data-slot="section-count"]') as HTMLElement
    expect(count.className.split(/\s+/)).toContain('tabular-nums')
    expect(count.className.split(/\s+/)).not.toContain('font-mono')
    expect(screen.getByText('most serious first')).toBeTruthy()
  })

  it('labels machine-authored content as generated, in a neutral chip and a note that it may be wrong', () => {
    wrap(
      <>
        <GeneratedChip />
        <GeneratedNote />
      </>,
    )
    const chip = screen.getByText(en.insights.next.generatedLabel).closest('[data-slot="chip"]') as HTMLElement
    expect(chip.className).not.toMatch(/chip-(good|warning|critical)/)
    expect(screen.getByText(en.insights.next.generatedNote).closest('[data-slot="generated-note"]')).toBeTruthy()
  })
})
