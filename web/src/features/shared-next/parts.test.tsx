import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { EmptyRow, IconBox } from './parts'

// happy-dom has no layout: the classes are the pin. The evidence that they read as the boards is
// in the PR's shots (bank-light.png, insights-light.png, analytics-light.png, locked-light.png).

afterEach(() => cleanup())

describe('EmptyRow', () => {
  it("runs its lines the row's full width in the boards' type and inks: the reason secondary, the rest tertiary", () => {
    render(<EmptyRow icon={<svg />} title="title" lines={['reason', 'next']} />)
    const reason = screen.getByText('reason').className.split(' ')
    const next = screen.getByText('next').className.split(' ')
    expect(reason).toEqual(expect.arrayContaining(['text-sm', 'leading-normal', 'text-fg-secondary']))
    expect(next).toEqual(expect.arrayContaining(['text-sm', 'leading-normal', 'text-fg-tertiary']))
    // No board caps these at the reading measure (QuestionBank / AIInsights / AnalyticsDashboard).
    expect([...reason, ...next]).not.toContain('max-w-measure')
    expect(screen.getByText('title').className.split(' ')).toContain('text-base')
  })

  it("applies a board's cap only when a page passes one", () => {
    render(<EmptyRow icon={<svg />} title="title" lines={['reason']} measure="max-w-[100ch]" />)
    expect(screen.getByText('reason').className.split(' ')).toContain('max-w-[100ch]')
  })
})

describe('IconBox', () => {
  it('is the tinted tile on a card, and the white tile on a ground-tinted row', () => {
    render(
      <>
        <IconBox>
          <svg />
        </IconBox>
        <IconBox tone="card">
          <svg />
        </IconBox>
      </>,
    )
    const [tint, card] = [...document.querySelectorAll('[data-tone]')]
    expect(tint.getAttribute('data-tone')).toBe('tint')
    expect(tint.className.split(' ')).toContain('bg-surface-icon-box')
    expect(card.getAttribute('data-tone')).toBe('card')
    expect(card.className.split(' ')).toContain('bg-surface-card')
    expect(card.className.split(' ')).not.toContain('bg-surface-icon-box')
  })
})
