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

  describe('isSuppressed', () => {
    it('is the same decision the component makes', () => {
      expect(isSuppressed(4)).toBe(true)
      expect(isSuppressed(5)).toBe(false)
      expect(isSuppressed(7, 10)).toBe(true)
      expect(isSuppressed(10, 10)).toBe(false)
    })
  })
})
