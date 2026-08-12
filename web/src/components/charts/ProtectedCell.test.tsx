import { cleanup, render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { TranslationProvider } from '../../i18n'
import ProtectedCell from './ProtectedCell'
import { isSuppressed } from './suppression'

afterEach(cleanup)

function render(ui: ReactElement, locale: 'en' | 'es' = 'en') {
  return rtlRender(<TranslationProvider initialLocale={locale}>{ui}</TranslationProvider>)
}

describe('ProtectedCell', () => {
  it('renders the reading when the floor is met', () => {
    render(
      <ProtectedCell responses={12}>
        <span>74</span>
      </ProtectedCell>,
    )
    expect(screen.getByText('74')).toBeTruthy()
  })

  it('renders the reading when the count is exactly at the floor', () => {
    // The floor is "fewer than five is withheld", so five itself is shown. An
    // off-by-one here either leaks a four-response cell or needlessly withholds
    // a five-response one, and both are silent.
    render(
      <ProtectedCell responses={5}>
        <span>74</span>
      </ProtectedCell>,
    )
    expect(screen.getByText('74')).toBeTruthy()
  })

  it('withholds the reading below the floor', () => {
    render(
      <ProtectedCell responses={4}>
        <span>74</span>
      </ProtectedCell>,
    )
    expect(screen.queryByText('74')).toBeNull()
  })

  it('shows that it is protected rather than rendering nothing', () => {
    // The whole point: an empty cell reads as missing data, which says the
    // product failed to collect something. A labelled locked cell says a
    // guarantee was enforced.
    const { container } = render(
      <ProtectedCell responses={4}>
        <span>74</span>
      </ProtectedCell>,
    )
    const cell = container.querySelector('[role="img"]')
    expect(cell, 'a suppressed cell must still be announced, not empty').not.toBeNull()
    expect(cell?.getAttribute('aria-label')).toContain('Protected')
    expect(container.querySelector('svg'), 'the padlock should render').not.toBeNull()
  })

  it('names what the cell is, so a grid of them is navigable', () => {
    const { container } = render(
      <ProtectedCell responses={4} description="Finance, psychological safety">
        <span>74</span>
      </ProtectedCell>,
    )
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain(
      'Finance, psychological safety',
    )
  })

  describe('the response count never escapes', () => {
    // This is the one that matters. Publishing an exact sub-threshold count
    // defeats the floor: with a known headcount it re-identifies people, and two
    // adjacent published counts can be differenced.
    it.each([1, 2, 3, 4])('does not render or announce a count of %i', (responses) => {
      const { container } = render(
        <ProtectedCell responses={responses} description="Finance, workload">
          <span>74</span>
        </ProtectedCell>,
      )
      // All three surfaces assert on the BARE NUMBER, not on the phrase
      // `${responses} response`. Three verifier lanes independently landed the same
      // finding here: with the phrase form, appending the raw count to the
      // accessible name or the tooltip — `title={`${label} (${responses})`}` — left
      // 416 tests green, because a bare `(3)` contains no "3 response" substring.
      // The leak that actually matters is the digit; the sentence around it is
      // whatever the leaking code happened to write. The count reached this
      // component precisely so it could be withheld, so the guard has to cover
      // every surface it could reach, in the form a leak would really take.
      expect(container.textContent ?? '').not.toContain(String(responses))
      const label = container.querySelector('[role="img"]')?.getAttribute('aria-label') ?? ''
      expect(label).not.toContain(String(responses))
      // The title attribute is a second surface that would leak it just as well —
      // and the one a mouse user actually reads.
      expect(container.querySelector('[role="img"]')?.getAttribute('title') ?? '').not.toContain(
        String(responses),
      )
    })

    it('does state the floor itself, which is not sensitive', () => {
      const { container } = render(<ProtectedCell responses={3}>{null}</ProtectedCell>)
      expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('5')
    })
  })

  describe('the floor is a per-company setting, not a constant', () => {
    it('withholds at a raised threshold that the default would have shown', () => {
      // A company that raised its floor to 10 must not have a 7-response cell
      // published because a component hardcoded 5.
      render(
        <ProtectedCell responses={7} threshold={10}>
          <span>74</span>
        </ProtectedCell>,
      )
      expect(screen.queryByText('74')).toBeNull()
    })

    it('reports the raised floor rather than the default', () => {
      const { container } = render(
        <ProtectedCell responses={7} threshold={10}>
          <span>74</span>
        </ProtectedCell>,
      )
      const label = container.querySelector('[role="img"]')?.getAttribute('aria-label') ?? ''
      expect(label).toContain('10')
      expect(label).not.toContain('5')
    })
  })

  it('announces in Spanish when the catalogue is Spanish', () => {
    const { container } = render(<ProtectedCell responses={3}>{null}</ProtectedCell>, 'es')
    const label = container.querySelector('[role="img"]')?.getAttribute('aria-label') ?? ''
    expect(label).toContain('Protegido')
    // A missing key would fall through as the raw key name; this catches that.
    expect(label).not.toContain('charts.')
  })

  /**
   * The word is this component's job, not the caller's. It used to be composed by
   * each call site, gated on the caller re-deriving `isSuppressed` by hand with the
   * same two arguments — and `DepartmentList` simply never did it, so it rendered a
   * hatched padlocked box with nothing saying what it meant.
   */
  describe('the word beside the padlock', () => {
    // The leaf, not the wrapper: the wrapper's `textContent` is also "Protected"
    // because the word is its only text, so matching on text alone finds the
    // wrapper first and every assertion below reads the wrong element.
    const wordOf = (container: HTMLElement) =>
      [...container.querySelectorAll('span')].find(
        (el) => el.textContent === 'Protected' && el.children.length === 0,
      )

    it('renders by default, so a caller cannot forget it', () => {
      const { container } = render(<ProtectedCell responses={3}>{null}</ProtectedCell>)
      expect(wordOf(container)).toBeTruthy()
    })

    it('is announced once, not twice', () => {
      // The word sits *beside* the box, not inside it, so `role="img"` does not
      // swallow it — without `aria-hidden` assistive technology reads the box's
      // accessible name and then the word, hearing "protected" twice. Nothing
      // caught this when the contract landed; a mutation removing the attribute
      // passed all 500 tests across charts and microclimates.
      const { container } = render(<ProtectedCell responses={3}>{null}</ProtectedCell>)
      expect(wordOf(container)?.getAttribute('aria-hidden')).toBe('true')
      // And the statement is still on the box, so it is announced exactly once.
      // Case-insensitive: the unnamed string opens with "Protected — withheld
      // below 5 responses" and the named one lowercases it after the description.
      expect(container.querySelector('[role="img"]')?.getAttribute('aria-label') ?? '').toMatch(
        /protected/i,
      )
    })

    it('is omitted where a surface already carries the statement', () => {
      // `ClimateMap` (a legend under the whole matrix) and `LiveOpenAnswers` (a
      // badge above and a sentence below) are the two opt-outs; see `showWord`.
      const { container } = render(
        <ProtectedCell responses={3} showWord={false}>
          {null}
        </ProtectedCell>,
      )
      expect(wordOf(container)).toBeUndefined()
      // The box itself is unaffected — still hatched, locked and labelled for AT.
      expect(container.querySelector('[role="img"]')).toBeTruthy()
    })

    it('sizes the box, not the word, from suppressedClassName', () => {
      // Callers size the box for one 12px padlock (`w-7`, `h-5 w-14`). If the class
      // landed on the wrapper instead, the word would be clipped by a width chosen
      // before the word existed.
      const { container } = render(
        <ProtectedCell responses={3} suppressedClassName="h-5 w-7">
          {null}
        </ProtectedCell>,
      )
      const box = container.querySelector('[role="img"]')
      expect(box?.className).toContain('w-7')
      expect(wordOf(container)?.className ?? '').not.toContain('w-7')
    })
  })

  describe('isSuppressed', () => {
    it('is the same decision the component makes', () => {
      expect(isSuppressed(4)).toBe(true)
      expect(isSuppressed(5)).toBe(false)
      expect(isSuppressed(7, 10)).toBe(true)
      expect(isSuppressed(10, 10)).toBe(false)
    })
  })
})
