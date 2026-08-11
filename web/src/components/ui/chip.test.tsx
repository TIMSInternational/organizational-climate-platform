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
    // `chipVariants({ tone: 'neutral' })`: `cn` runs tailwind-merge, which drops
    // the base `border-transparent` once `border-line-light` overrides it, so the
    // raw table string and the rendered string are legitimately different.
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

  it('is a fixed 20px tall and 11px semibold, in every tone', () => {
    // The geometry is what makes a chip line up with a table row, and it lives in
    // the shared part of the table rather than per tone. h-5 is 5 x the 4px
    // --spacing token.
    for (const tone of ['good', 'warning', 'critical', 'accent', 'neutral'] as const) {
      const classes = chipVariants({ tone }).split(/\s+/)
      expect(classes, tone).toContain('h-5')
      expect(classes, tone).toContain('text-xs')
      expect(classes, tone).toContain('font-semibold')
      expect(classes, tone).toContain('rounded-lg')
    }
  })

  it('keeps every tone the same height by bordering the four that have no rule', () => {
    // `neutral` is the only tone with a visible hairline. Without a transparent
    // border on the others they would be 2px shorter, which is invisible in a
    // test and obvious in a row of chips.
    for (const tone of ['good', 'warning', 'critical', 'accent'] as const) {
      expect(chipVariants({ tone }).split(/\s+/), tone).toContain('border-transparent')
    }
    expect(chipVariants({ tone: 'neutral' })).toContain('border-line-light')
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
