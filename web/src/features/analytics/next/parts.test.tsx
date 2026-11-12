import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TranslationProvider } from '../../../i18n'
import en from '../../../i18n/en.json'
import { ReviewNote, SectionHeading } from './parts'

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

  it('cautions the reader to check the evidence, and claims nothing about where the text came from', () => {
    wrap(<ReviewNote />)
    const note = screen.getByText(en.insights.next.reviewNote).closest('[data-slot="review-note"]') as HTMLElement
    expect(note).toBeTruthy()
    // No origin claim: the server stores whatever text it is sent (AIInsightEndpoints.cs).
    expect(note.textContent).not.toMatch(/\b(AI|IA)\b|generated|generad/i)
  })
})
