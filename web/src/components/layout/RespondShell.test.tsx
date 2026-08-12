import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { RespondShell, RespondCaption, RespondReading } from './RespondShell'
import { TranslationProvider } from '../../i18n'
import { LOCALE_STORAGE_KEY } from '../../i18n/locale'

function renderShell(children: React.ReactNode = <p>body</p>) {
  return render(
    <TranslationProvider>
      <RespondShell skipLabel="Skip to the survey">{children}</RespondShell>
    </TranslationProvider>,
  )
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
  it('caps and centres the content column', () => {
    const { container } = renderShell()

    const main = container.querySelector('main')
    expect(main?.className).toContain('max-w-content')
    expect(main?.className).toContain('mx-auto')
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
