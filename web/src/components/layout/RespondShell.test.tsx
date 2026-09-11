import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { RespondShell, RespondCaption, RespondReading, BrandLockup } from './RespondShell'
import { SidebarBrand } from './SidebarBrand'
import { CHIP_SELECT_STYLE } from './chipSelectStyle'
import { TranslationProvider } from '../../i18n'
import { LOCALE_STORAGE_KEY } from '../../i18n/locale'

function renderShell(children: React.ReactNode = <p>body</p>) {
  return render(
    <TranslationProvider>
      <RespondShell skipLabel="Skip to the survey">{children}</RespondShell>
    </TranslationProvider>,
  )
}

/** The `d` of every path in an element's first `<svg>`, i.e. the glyph itself. */
function glyph(root: Element | null | undefined): string {
  const svg = root?.querySelector('svg')
  if (!svg) return ''
  return [...svg.querySelectorAll('path')].map((path) => path.getAttribute('d')).join('|')
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('RespondShell', () => {
  /**
   * The whole reason the respond flows have a shell of their own. `AdminLayout`
   * reads the JWT claims to build a role-aware rail, mounts the company-context
   * switcher, a notification bell and a sign-out control — every one of which is a
   * way for a tenant's structure to appear on a page an ordinary employee, or on
   * `/survey/:id` anybody holding a link, can open.
   */
  it('renders none of the authenticated shell', () => {
    renderShell()

    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(screen.queryByRole('button', { name: /sign out|cerrar sesión/i })).toBeNull()
  })

  it('puts the skip link first in the DOM, so it is first in the tab order', () => {
    const { container } = renderShell()

    const skip = screen.getByRole('link', { name: 'Skip to the survey' })
    expect(container.firstElementChild?.firstElementChild).toBe(skip)
    expect(skip.getAttribute('href')).toBe('#respond')
    expect(container.querySelector('#respond')).toBeTruthy()
  })

  it('targets the id it is given, so a page can name its own anchor', () => {
    render(
      <TranslationProvider>
        <RespondShell skipLabel="Skip" contentId="survey">
          <p>body</p>
        </RespondShell>
      </TranslationProvider>,
    )

    expect(screen.getByRole('link', { name: 'Skip' }).getAttribute('href')).toBe('#survey')
  })

  /**
   * A respondent arriving from an email has no stored preference and no
   * authenticated locale, and `ShellControls` — the only other place either picker
   * has ever lived — is inside the shell this page deliberately does not use. This
   * is the one page where being unable to change the language means being unable to
   * answer at all.
   */
  it('offers the language and theme pickers', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    renderShell()

    expect(screen.getByRole('combobox', { name: 'Switch Language' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Theme' })).toBeTruthy()
  })

  /**
   * `AdminLayout` names `--admin-size-content-max` as belonging to the standalone
   * centred pages precisely because a page with no rail beside it has nothing for a
   * centred column to drift away from. The cap is the layout; without it the
   * questions run the full width of a 2560px monitor.
   */
  /**
   * The canvas draws this surface as a phone (RespondSurveyPhone and its siblings, 10 Sep):
   * one column of cards, and on a wide screen the same column centred with the lockup over
   * it. `max-w-field` (32rem), not `max-w-content`: a question card stretched to 1280px put
   * the five scale boxes 250px apart. The header is capped the same, so the lockup sits over
   * the questions rather than at the window's edge.
   */
  it('caps and centres the content column at the phone column’s width, header included', () => {
    const { container } = renderShell()

    const main = container.querySelector('main')
    expect(main?.className.split(/\s+/)).toContain('max-w-field')
    expect(main?.className).toContain('mx-auto')
    const header = container.querySelector('header')
    expect(header?.className.split(/\s+/)).toContain('max-w-field')
    expect(header?.className).toContain('mx-auto')
  })

  /**
   * The header used to read "Organizational Climate Platform" in plain grey text,
   * with the two pickers floating beside it. For most employees this is the only
   * screen of this product they ever see, and it carried nothing that connects it
   * to the email that sent them here.
   */
  /**
   * The canvas's "Español" and "Claro" are 22px chips that hug their word. A native
   * `<select>` is as wide as its widest option, which drew "Claro" in a chip with a blank
   * tail the width of "Sistema"; `field-sizing: content` sizes it to what it shows.
   * happy-dom keeps no unknown CSS property, so this reads the shared style both pickers
   * spread — the screenshot at 390 is where the width itself was looked at.
   */
  it('sizes each picker chip to its word', () => {
    expect(CHIP_SELECT_STYLE.fieldSizing).toBe('content')
    expect(CHIP_SELECT_STYLE.appearance).toBe('none')
  })

  it('opens on the brand lockup rather than on the product name in plain text', () => {
    const { container } = renderShell()

    const lockup = container.querySelector('[data-slot="brand-lockup"]')
    expect(lockup).toBeTruthy()
    expect(lockup?.textContent).toBe('CLIMATE')
    expect(screen.queryByText('Organizational Climate Platform')).toBeNull()
  })

  /**
   * "Reuse rather than re-draw." Comparing the rendered path data is the assertion
   * that actually holds: two components can both *say* `Waves` in a comment, and a
   * later edit that reaches for a different lucide glyph here compiles, renders and
   * looks deliberate. This fails.
   */
  it('draws the same mark the signed-in rail draws, not a second one', () => {
    const respond = render(<BrandLockup />)
    const respondMark = glyph(respond.container.querySelector('[data-slot="brand-lockup"]'))
    cleanup()

    const rail = render(
      <TranslationProvider>
        <SidebarBrand collapsed={false} onToggleCollapsed={() => {}} />
      </TranslationProvider>,
    )
    const railMark = glyph(rail.container.querySelector('[data-slot="sidebar-brand"]'))

    // Guard the guard: two empty strings would compare equal.
    expect(respondMark.length).toBeGreaterThan(0)
    expect(respondMark).toBe(railMark)
  })

  /**
   * The canvas's respond strip (RespondSurveyPhone and its two siblings, 10 Sep) is the
   * lockup and the two pickers, and nothing else. The anonymity promise is the green block
   * the page opens on — the invitation landing card's, then the form's — so a chip up here
   * was the same promise said twice, in two wordings, one of them a single word.
   */
  it('draws the lockup and the two pickers in its header, and no anonymity chip', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    const { container } = renderShell()

    const header = container.querySelector('header')
    expect(header).toBeTruthy()
    expect(header!.querySelector('[data-slot="chip"]')).toBeNull()
    expect(header!.textContent).not.toMatch(/Anónima|Anonymous/)
    // The strip lost a chip, not its controls: both pickers are still in it.
    expect(header!.querySelectorAll('select')).toHaveLength(2)
  })
})

describe('RespondCaption', () => {
  it('names the thing being answered as the page heading, under its kind', () => {
    render(
      <RespondCaption eyebrow="Survey" title="Clima laboral 2026" description="Es confidencial" />,
    )

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Clima laboral 2026')
    expect(screen.getByText('Survey')).toBeTruthy()
    expect(screen.getByText('Es confidencial')).toBeTruthy()
  })

  it('renders no description element when the survey has none', () => {
    const { container } = render(<RespondCaption eyebrow="Survey" title="Untitled" />)

    expect(container.querySelector('p')).toBeNull()
  })
})

describe('RespondReading', () => {
  /**
   * The one typographic rule the redesign rests on: every reading is set in mono
   * with tabular figures, and prose stays in the sans face. A reading that inherits
   * the sans face reflows as it changes and reads as a sentence rather than as a
   * measurement.
   */
  it('sets the value in mono with tabular figures and leaves the label alone', () => {
    render(<RespondReading label="Time left" value="09:41" sub="Nothing is submitted for you" />)

    const value = screen.getByText('09:41')
    expect(value.className).toContain('font-mono')
    expect(value.className).toContain('tabular-nums')

    const label = screen.getByText('Time left')
    expect(label.className).not.toContain('font-mono')
  })

  it('renders no sub-line when it is not given', () => {
    render(<RespondReading label="Questions" value="12" />)

    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.queryByText('Nothing is submitted for you')).toBeNull()
  })
})
