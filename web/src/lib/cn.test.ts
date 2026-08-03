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
  })
})
