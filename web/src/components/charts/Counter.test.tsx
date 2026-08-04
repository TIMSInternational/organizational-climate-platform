import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Counter from './Counter'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/**
 * The number is deliberately in the DOM twice: an sr-only `<output>` carrying the
 * settled value, and a visible `aria-hidden` span that animates. So a bare
 * `getByText` matches both and throws -- these helpers make each assertion say
 * which one it means, which is also the distinction that matters.
 */
function visible(container: HTMLElement): string {
  const node = container.querySelector('[aria-hidden="true"]')
  if (!node) throw new Error('no visible number rendered')
  return node.textContent ?? ''
}

function announced(): string {
  return screen.getByRole('status').textContent ?? ''
}

/**
 * `durationMs={0}` in most tests: the count-up is real behaviour but asserting
 * mid-animation values means asserting on frame timing, which is flaky by
 * construction. The animation itself is covered by the reduced-motion tests and by
 * the settled-value tests.
 */
describe('Counter', () => {
  it('renders the value', () => {
    const { container } = render(<Counter value={42} durationMs={0} />)
    expect(visible(container)).toBe('42')
    expect(announced()).toBe('42')
  })

  it('appends a suffix', () => {
    const { container } = render(<Counter value={87} suffix="%" durationMs={0} />)
    expect(visible(container)).toBe('87%')
  })

  it('shows a label when given one', () => {
    render(<Counter value={5} label="Open action plans" durationMs={0} />)
    expect(screen.getByText('Open action plans')).toBeTruthy()
  })

  /**
   * The visible number animates and is hidden from assistive tech; the settled
   * value lives in an `<output>`. Without that split a screen reader narrates
   * every intermediate frame — a slot machine instead of an answer.
   */
  describe('accessibility', () => {
    it('exposes the settled value to assistive tech', () => {
      render(<Counter value={1234} suffix="%" durationMs={600} />)
      expect(announced()).toBe('1,234%')
    })

    it('hides the animated number from the accessibility tree', () => {
      const { container } = render(<Counter value={99} durationMs={600} />)
      const animated = container.querySelector('[aria-hidden="true"]')
      expect(animated).toBeTruthy()
    })

    it('announces the final value even mid-animation', () => {
      // The output carries `value`, not `displayed`, so it is correct on the
      // first paint rather than only after the animation settles.
      render(<Counter value={500} durationMs={10_000} />)
      expect(announced()).toBe('500')
    })
  })

  describe('prefers-reduced-motion', () => {
    function stubReducedMotion(matches: boolean) {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    }

    // A number ticking upward is exactly what that setting exists to suppress,
    // and animating through wrong values is worse than decorative for a KPI.
    it('renders the final value immediately when motion is reduced', () => {
      stubReducedMotion(true)
      const { container } = render(<Counter value={365} durationMs={5000} />)
      expect(visible(container)).toBe('365')
    })

    it('starts from zero when motion is not reduced', () => {
      stubReducedMotion(false)
      const { container } = render(<Counter value={365} durationMs={5000} />)
      // First paint, before any frame has run.
      expect(visible(container)).toBe('0')
    })
  })

  describe('formatting', () => {
    beforeEach(() => {
      document.documentElement.lang = 'en'
    })

    it('groups thousands', () => {
      const { container } = render(<Counter value={1234567} durationMs={0} />)
      expect(visible(container)).toBe('1,234,567')
    })

    // Spanish groups with dots and decimalises with a comma. Hardcoding en-US
    // would print 1,234.5 to a Spanish reader, which is a different number.
    it('follows the document locale', () => {
      document.documentElement.lang = 'es'
      const { container } = render(<Counter value={1234.5} durationMs={0} />)
      expect(visible(container)).toBe('1234,5')
    })

    it('honours an explicit locale over the document', () => {
      document.documentElement.lang = 'es'
      const { container } = render(<Counter value={1234.5} locale="en-US" durationMs={0} />)
      expect(visible(container)).toBe('1,234.5')
    })

    it('shows no decimals for a whole number', () => {
      const { container } = render(<Counter value={80} durationMs={0} />)
      expect(visible(container)).toBe('80')
    })

    it('shows one decimal for a fractional number by default', () => {
      const { container } = render(<Counter value={72.46} durationMs={0} />)
      expect(visible(container)).toBe('72.5')
    })

    it('respects an explicit decimal count', () => {
      const { container } = render(<Counter value={72} decimals={2} durationMs={0} />)
      expect(visible(container)).toBe('72.00')
    })
  })

  describe('edge cases', () => {
    it('renders zero', () => {
      // A falsy value must not be mistaken for "no value".
      const { container } = render(<Counter value={0} durationMs={0} />)
      expect(visible(container)).toBe('0')
    })

    it('renders a negative value', () => {
      const { container } = render(<Counter value={-12} durationMs={0} />)
      expect(visible(container)).toBe('-12')
    })

    it('does not animate a non-finite value', () => {
      // Interpolating towards Infinity produces NaN frames.
      const { container } = render(<Counter value={Number.POSITIVE_INFINITY} durationMs={600} />)
      expect(visible(container)).toBe('∞')
    })
  })
})
