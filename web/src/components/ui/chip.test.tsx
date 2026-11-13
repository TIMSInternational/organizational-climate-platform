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

  it('is the Apple design’s chip — 22px tall, 12px at 600, 8px across — in every tone', () => {
    // `occ.css` `.chip` (11 Nov): height 22px, padding 0 8px, 12px at weight 600. It lives in
    // the shared part of the table rather than per tone; h-5.5 is 5.5 x the 4px --spacing
    // token, `rounded-lg` the token layer's chip radius.
    for (const tone of ['good', 'warning', 'critical', 'accent', 'neutral'] as const) {
      const classes = chipVariants({ tone }).split(/\s+/)
      expect(classes, tone).toContain('h-5.5')
      expect(classes, tone).toContain('px-2')
      expect(classes, tone).toContain('text-xs')
      expect(classes, tone).toContain('font-semibold')
      expect(classes, tone).toContain('rounded-lg')
      expect(classes, tone).not.toContain('font-medium')
    }
  })

  it('draws no border on any tone: a chip is a word on a tint, not a control', () => {
    // The 10 Sep canvas bordered each tone in its own tint; the Apple design's `.chip` has no
    // border. A border width in the shared table would put one back on every chip.
    for (const tone of ['good', 'warning', 'critical', 'accent', 'neutral'] as const) {
      const classes = chipVariants({ tone }).split(/\s+/)
      expect(classes, tone).not.toContain('border')
      expect(classes.filter((name) => name.startsWith('border-')), tone).toEqual([])
    }
  })

  it('draws the three result areas on the band colours', () => {
    // Fortaleza, Oportunidad and Crítica are the only green, amber and red chips. The chip
    // tokens carry the band values (`tokens.css`); the pairing is measured, per theme and
    // surface, in `styles/chipVariantContrast.test.ts`.
    expect(chipVariants({ tone: 'good' })).toContain('bg-chip-good-fill')
    expect(chipVariants({ tone: 'warning' })).toContain('bg-chip-warning-fill')
    expect(chipVariants({ tone: 'critical' })).toContain('bg-chip-critical-fill')
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

describe('the live chip', () => {
  it('is the accent pair with the live dot', () => {
    render(<Chip tone="live" label="Activa" />)
    const chip = screen.getByText('Activa')
    const classes = chip.className.split(/\s+/)
    expect(chip.getAttribute('data-live')).toBe('true')
    expect(classes).toEqual(expect.arrayContaining(['bg-chip-accent-fill', 'text-chip-accent-ink']))
    // The dot: 6px, in the word's own ink.
    expect(classes).toEqual(expect.arrayContaining(['before:size-1.5', 'before:rounded-full', 'before:bg-current']))
  })

  it('keeps the word: the dot never stands alone', () => {
    render(<Chip tone="live" label="Activa" />)
    expect(screen.getByText('Activa').textContent).toBe('Activa')
  })

  it('puts the dot on the live chip only, not on every blue chip', () => {
    render(<Chip tone="accent" label="Generada con IA" />)
    const chip = screen.getByText('Generada con IA')
    expect(chip.getAttribute('data-live')).toBeNull()
    expect(chip.className).not.toContain('before:')
  })

  it('leaves every other status gray', () => {
    render(<Chip label="Borrador" />)
    expect(screen.getByText('Borrador').className.split(/\s+/)).toContain('bg-chip-neutral-fill')
  })
})
