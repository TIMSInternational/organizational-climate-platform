import { describe, it, expect } from 'vitest'
import { cn } from './cn'

describe('cn', () => {
  it('joins class names', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('drops falsy values and flattens conditionals', () => {
    // Read from a variable rather than written as `false && 'b'`, which the
    // linter correctly flags as a constant expression.
    const enabled = false as boolean
    expect(cn('a', enabled && 'b', undefined, null, ['c', 'd'])).toBe('a c d')
  })

  /**
   * The reason this file exists. A stock tailwind-merge leaves both classes in
   * place for every case below, which hands the decision to Tailwind's layer
   * order instead of to the caller — so `<Button className="h-10" />` would not
   * reliably be 40px.
   */
  describe('project-specific scales resolve, so className wins', () => {
    it.each([
      ['h-control-lg', 'h-10'],
      ['h-control-sm', 'h-control-lg'],
      ['p-card', 'p-4'],
      ['p-4', 'p-panel'],
      ['px-inline', 'px-2'],
      ['gap-inline', 'gap-2'],
      ['gap-row', 'gap-section'],
      ['w-sidebar', 'w-full'],
      ['size-icon', 'size-8'],
      ['max-w-content', 'max-w-full'],
      ['text-2xs', 'text-base'],
    ])('%s then %s keeps only the second', (first, second) => {
      expect(cn(first, second)).toBe(second)
    })
  })

  describe('stock behaviour still holds', () => {
    it.each([
      ['bg-surface-panel', 'bg-accent-blue'],
      ['text-fg-primary', 'text-fg-secondary'],
      ['rounded-md', 'rounded-xl'],
      ['border-line-default', 'border-accent-red'],
    ])('%s then %s keeps only the second', (first, second) => {
      expect(cn(first, second)).toBe(second)
    })
  })

  it('keeps a font size and a colour together — different groups', () => {
    // Both must survive: `text-` is overloaded, and collapsing them would drop
    // either the size or the colour.
    expect(cn('text-base', 'text-fg-primary')).toBe('text-base text-fg-primary')
    // The canvas's named steps are sizes too: registered, they keep the colour beside them
    // and replace another size.
    expect(cn('text-3xs', 'text-fg-label')).toBe('text-3xs text-fg-label')
    expect(cn('text-2xs', 'text-3xs')).toBe('text-3xs')
    expect(cn('text-3xl', 'text-kpi-hero')).toBe('text-kpi-hero')
    // The one that needs registering: not a t-shirt size, so unregistered it reads as a colour.
    expect(cn('text-reading', 'text-fg-primary')).toBe('text-reading text-fg-primary')
    // The respond card's 17px question step (`text-question`), beside an ink and over another size.
    expect(cn('text-question', 'text-fg-primary')).toBe('text-question text-fg-primary')
    expect(cn('text-xl', 'text-question')).toBe('text-question')
    // The respond steps: unregistered, `text-respond` read as a colour and dropped the
    // primary button's `text-fg-on-accent` -- a near-black label on the blue fill.
    expect(cn('text-fg-on-accent', 'text-respond')).toBe('text-fg-on-accent text-respond')
    expect(cn('text-respond-sm', 'text-fg-secondary')).toBe('text-respond-sm text-fg-secondary')
    expect(cn('text-base', 'text-respond-question')).toBe('text-respond-question')
    // The Apple design's 14px row/control step.
    expect(cn('text-ui', 'text-fg-primary')).toBe('text-ui text-fg-primary')
    expect(cn('text-base', 'text-ui')).toBe('text-ui')
  })

  it('resolves the Apple design radii and box padding as their own groups', () => {
    expect(cn('rounded-xl', 'rounded-box')).toBe('rounded-box')
    expect(cn('rounded-box', 'rounded-sheet')).toBe('rounded-sheet')
    expect(cn('px-6', 'px-box-x')).toBe('px-box-x')
    expect(cn('tracking-tight', 'tracking-display')).toBe('tracking-display')
  })
})
