import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Chip } from './chip'
import { chipVariants } from './chipVariants'

afterEach(cleanup)

/**
 * happy-dom computes no colour and does no layout, so the two claims worth
 * checking here are the ones that survive that: the word is always rendered, and
 * the tone reaches the element as the class the browser will paint from. The
 * colour itself is measured in `styles/chipVariantContrast.test.ts` and looked at
 * in `/dev/chart-gallery`.
 */
describe('Chip', () => {
  it('renders the word', () => {
    render(<Chip tone="good" label="Active" />)
    expect(screen.getByText('Active')).toBeTruthy()
  })

  it('renders the word even when an icon is supplied', () => {
    // The whole point of the component: colour and glyph never stand alone
    // (WCAG 1.4.1). An icon must not displace the label.
    render(<Chip tone="critical" label="Overdue" icon={<svg data-testid="glyph" />} />)
    expect(screen.getByText('Overdue')).toBeTruthy()
    expect(screen.getByTestId('glyph')).toBeTruthy()
  })

  it('hides the icon from assistive technology, because the word already says it', () => {
    const { container } = render(<Chip label="Draft" icon={<svg data-testid="glyph" />} />)
    const wrapper = container.querySelector('[aria-hidden="true"]')
    expect(wrapper).not.toBeNull()
    expect(wrapper!.querySelector('svg')).not.toBeNull()
  })

  it('carries the tone class the variant table names', () => {
    render(<Chip tone="warning" label="At risk" />)
    const chip = screen.getByText('At risk')
    expect(chip.getAttribute('data-slot')).toBe('chip')
    // Not a restatement of the table: the expected class comes from the table.
    for (const name of chipVariants({ tone: 'warning' }).split(/\s+/)) {
      expect(chip.className.split(/\s+/)).toContain(name)
    }
  })

  it('paints a different tone differently', () => {
    // Guard the test above: if `tone` were dropped on the floor, every chip would
    // carry the default classes and the loop above would still pass.
    render(<Chip tone="warning" label="At risk" />)
    render(<Chip tone="critical" label="Overdue" />)
    expect(screen.getByText('At risk').className).not.toBe(
      screen.getByText('Overdue').className,
    )
  })

  it('defaults to the neutral tone', () => {
    // Compared against a rendered neutral chip rather than against
    // `chipVariants({ tone: 'neutral' })`: `cn` runs tailwind-merge over the table,
    // so the raw table string and the rendered string can legitimately differ.
    render(<Chip label="Draft" />)
    render(<Chip tone="neutral" label="Explicitly neutral" />)
    expect(screen.getByText('Draft').className).toBe(
      screen.getByText('Explicitly neutral').className,
    )
  })

  it('is not neutral once a tone is asked for', () => {
    // Guard the test above: if `tone` never reached the table, the default test
    // would pass by both chips being wrong in the same way.
    render(<Chip label="Draft" />)
    render(<Chip tone="accent" label="Live" />)
    expect(screen.getByText('Live').className).not.toBe(screen.getByText('Draft').className)
  })

  it('is the canvas chip — 22px tall, 11px at 500, 8px across — in every tone', () => {
    // The approved canvas's `.chip` (10 Sep): height 22px, radius 6px, padding 0 8px,
    // 11px at weight 500. It lives in the shared part of the table rather than per
    // tone; h-5.5 is 5.5 x the 4px --spacing token.
    for (const tone of ['good', 'warning', 'critical', 'accent', 'neutral'] as const) {
      const classes = chipVariants({ tone }).split(/\s+/)
      expect(classes, tone).toContain('h-5.5')
      expect(classes, tone).toContain('px-2')
      expect(classes, tone).toContain('text-xs')
      expect(classes, tone).toContain('font-medium')
      expect(classes, tone).toContain('rounded-lg')
      expect(classes, tone).not.toContain('font-semibold')
    }
  })

  it("borders every tone in its own tint, the canvas's hairline, so all five are one height", () => {
    // The canvas draws the green chip with rgba(18,148,91,.2), the red with
    // rgba(221,12,21,.2), the neutral with the default hairline — the `accent-*-ring`
    // tokens are those tints. Every tone carries a border, so none is 2px shorter.
    const ring = { good: 'border-accent-green-ring', warning: 'border-accent-amber-ring', critical: 'border-accent-red-ring', accent: 'border-accent-blue-ring', neutral: 'border-line-default' } as const
    for (const [tone, border] of Object.entries(ring) as [keyof typeof ring, string][]) {
      const classes = chipVariants({ tone }).split(/\s+/)
      expect(classes, tone).toContain('border')
      expect(classes, tone).toContain(border)
      expect(classes, tone).not.toContain('border-transparent')
    }
  })

  it('draws its glyph 13px, as every chip glyph on the canvas', () => {
    // The approved canvas (10 Sep) sizes each chip glyph `width: 13px; height: 13px`, 23 of
    // 23 across 12 artboards. happy-dom does no layout, so what can be pinned is the class
    // the browser sizes it from: 3.25 x the 4px --spacing token.
    const { container } = render(<Chip label="Protected" icon={<svg data-testid="glyph" />} />)
    const slot = container.querySelector('[aria-hidden="true"]')
    expect(slot).not.toBeNull()
    expect(slot!.className.split(/\s+/)).toContain('[&>svg]:size-3.25')
    expect(slot!.className.split(/\s+/)).not.toContain('[&>svg]:size-3')
  })

  it('passes through the rest of its span props', () => {
    render(<Chip label="Live" title="Closes in 3 days" id="survey-status" />)
    const chip = screen.getByText('Live')
    expect(chip.getAttribute('title')).toBe('Closes in 3 days')
    expect(chip.getAttribute('id')).toBe('survey-status')
  })

  it('appends the caller class rather than replacing the tone', () => {
    render(<Chip tone="good" label="Active" className="ml-2" />)
    const chip = screen.getByText('Active')
    expect(chip.className).toContain('ml-2')
    expect(chip.className).toContain('bg-chip-good-fill')
  })
})
