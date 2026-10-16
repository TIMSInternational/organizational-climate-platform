import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { RespondShell, RespondCaption, RespondReading, BrandLockup } from './RespondShell'
import { SidebarBrand } from './SidebarBrand'
import { CHIP_SELECT_STYLE } from './chipSelectStyle'
import { TranslationProvider } from '../../i18n'
import { LOCALE_STORAGE_KEY } from '../../i18n/locale'
import { setToken, clearToken } from '../../auth/token'
import { tokenFor } from '../../test/jwtFixture'
import { clearCompanyNameCache } from '../../company-context/useCompanyName'

function renderShell(children: React.ReactNode = <p>body</p>) {
  return render(
    <TranslationProvider>
      <RespondShell skipLabel="Skip to the survey">{children}</RespondShell>
    </TranslationProvider>,
  )
}

/**
 * The `glyph()` helper that used to live here compared the drawn geometry of two inline
 * `<svg>` marks, so that the rail and the respond header could be proved to draw the SAME
 * artwork rather than two lookalikes. The OCC lockup is one static asset referenced by
 * `src`, so the same guarantee is now one string comparison and the helper has no reader.
 */

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  clearToken()
  clearCompanyNameCache()
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
    expect(lockup?.querySelector('[data-slot="occ-logo"]')?.getAttribute('alt')).toBe('OCC')
    expect(screen.queryByText('Organizational Climate Platform')).toBeNull()
  })

  /**
   * "Reuse rather than re-draw." Comparing the rendered geometry is the assertion that
   * actually holds: two components can both *say* they draw the mark, and a later edit
   * that re-draws it here compiles, renders and looks deliberate. This fails.
   */
  /**
   * The size floor, which replaced the old ramp guarantee.
   *
   * `ClimateMark` needed a light ramp and a dark one because its deepest cells measured
   * 1.13:1 on the navy rail and vanished. The OCC mark is a single ink that was measured
   * on every surface first — 3.70:1 on the light paper, 4.68:1 on the navy shell — so
   * there is no tone to pin. What it has instead is a FLOOR: six figures in a ring were
   * rendered and read at 16/24/32/48/64, and below 32px they stop resolving. Nothing in
   * either shell may draw it smaller, and this is what stops a later "the rail feels
   * cramped" from quietly taking it back to 24.
   */
  it('never draws the mark below the size its figures need', () => {
    const collapsed = render(
      <TranslationProvider>
        <SidebarBrand collapsed onToggleCollapsed={() => {}} />
      </TranslationProvider>,
    )
    const mark = collapsed.container.querySelector('[data-slot="occ-mark"]')
    expect(mark).toBeTruthy()
    expect(Number(mark?.getAttribute('height'))).toBeGreaterThanOrEqual(32)
    cleanup()

    // The lockup carries the mark at its own height, so the floor rides on that.
    const respond = render(<BrandLockup size="compact" />)
    const logo = respond.container.querySelector('[data-slot="occ-logo"]')
    expect(Number(logo?.getAttribute('height'))).toBeGreaterThanOrEqual(32)
  })

  it('draws the same artwork the signed-in rail draws, not a second one', () => {
    const respond = render(<BrandLockup />)
    const respondSrc = respond.container
      .querySelector('[data-slot="occ-logo"]')
      ?.getAttribute('src')
    cleanup()

    const rail = render(
      <TranslationProvider>
        <SidebarBrand collapsed={false} onToggleCollapsed={() => {}} />
      </TranslationProvider>,
    )
    const railSrc = rail.container.querySelector('[data-slot="occ-logo"]')?.getAttribute('src')

    // Guard the guard: two undefineds would compare equal.
    expect(respondSrc).toBeTruthy()
    expect(respondSrc).toBe(railSrc)
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

  /**
   * A class-presence assertion rather than a measurement, because happy-dom has no
   * layout engine and cannot be asked how wide a word is. What it pins is a pair that
   * was measured in Chromium at 390px and is easy to half-remove: the title is
   * author-supplied, and a survey named with one long unhyphenated token ran off the
   * right edge of `/s/:token`. `break-words` on its own did NOT fix it — this
   * `<header>` is a grid and a grid item's automatic minimum size is its min-content
   * width, so the track simply grew to the length of the word. Both PNGs are in the
   * lane report.
   */
  it('keeps a long unbroken title inside the column', () => {
    render(<RespondCaption eyebrow="Survey" title="RetroalimentacionInstitucional2026" />)

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.className).toContain('break-words')
    expect(heading.className).toContain('min-w-0')
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

/**
 * White-label, and the boundary around it.
 *
 * `RespondShell` is shared by one authenticated route and six that anybody holding a link
 * may open, and its own remarks refuse any claim about a tenant on those six. The logo is
 * opt-in with the default off, so the question these ask is not "does the logo render" but
 * "can it render where it must not".
 *
 * ## They stub the API on purpose
 *
 * The suite has no `VITE_API_BASE_URL`, so `useOwnCompanyBrand` asks nothing and answers
 * nulls — which means a test written without this stub passes whether the default is off or
 * ON. It would assert the absence of a request, not the boundary. The stub is what makes
 * the negative cases mean something: the logo IS reachable here, and still must not appear.
 */
describe('the tenant logo', () => {
  const LOGO = '/brand/esph-logo.png'

  function serveProfile() {
    vi.stubEnv('VITE_API_BASE_URL', 'http://api.test')
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'u1',
              companyId: 'c1',
              companyName: 'ESPH',
              email: 'a@esph-sa.com',
              name: 'Ana',
              role: 'employee',
              departmentId: null,
              departmentName: null,
              managerId: null,
              isActive: true,
              hasPassword: true,
              lastLoginAt: null,
              createdAt: '2026-01-01T00:00:00Z',
              demographics: {},
              companyLogoUrl: LOGO,
            }),
            { status: 200 },
          ),
        ),
      ),
    )
  }

  function renderWith(props: { showCompanyLogo?: boolean }) {
    render(
      <TranslationProvider initialLocale="es">
        <RespondShell skipLabel="Saltar a la encuesta" {...props}>
          <p>body</p>
        </RespondShell>
      </TranslationProvider>,
    )
  }

  const logo = () => document.querySelector('[data-slot="company-logo"]')

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('shows the signed-in respondent their own company logo when the caller opts in', () => {
    // The control for every negative case below. Without it they could all pass over a
    // component that never renders a logo under any circumstances.
    serveProfile()
    setToken(tokenFor({ name: 'Ana', role: 'employee', companyId: 'c1' }))
    renderWith({ showCompanyLogo: true })

    return waitFor(() => {
      expect(logo()).not.toBeNull()
      expect(logo()!.getAttribute('src')).toBe(LOGO)
    })
  })

  it('renders no company logo by default, which is what the six link-holder routes get', async () => {
    serveProfile()
    setToken(tokenFor({ name: 'Ana', role: 'employee', companyId: 'c1' }))
    renderWith({})

    // The profile would answer with a logo; the default refuses to ask for it.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(logo()).toBeNull()
  })

  it('renders no company logo for a visitor holding a link, even when the caller opts in', async () => {
    // The second of `useOwnCompanyBrand`'s two locks, and the one that does not depend on a
    // prop being passed correctly: `/profile` is RequireAuthorization(), so with no token
    // there is nothing to render. This is what makes the guarantee structural.
    serveProfile()
    clearToken()
    renderWith({ showCompanyLogo: true })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(logo()).toBeNull()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('keeps the product lockup beside the tenant logo rather than being replaced by it', async () => {
    // A tenant mark replacing the product lockup would misrepresent whose product this is,
    // and for most respondents this is the only screen of it they ever see.
    serveProfile()
    setToken(tokenFor({ name: 'Ana', role: 'employee', companyId: 'c1' }))
    renderWith({ showCompanyLogo: true })

    await waitFor(() => expect(logo()).not.toBeNull())
    const occ = [...document.querySelectorAll('img')].filter((img) => img !== logo())
    expect(occ.length).toBeGreaterThan(0)
  })
})

/**
 * A sweep, not a named list. `resultsContrast` named four files and missed the fifth; the
 * guard that swept its directory caught it. The risk here is the same shape: a SEVENTH
 * caller of `RespondShell` added on a public route and opted in by copy-paste.
 */
describe('who may opt into the tenant logo', () => {
  it('is exactly one page, and it is the one inside RequireAuth', () => {
    const root = join(process.cwd(), 'src')
    const callers = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((rel) => (rel.endsWith('.tsx') || rel.endsWith('.ts')) && !rel.endsWith('.test.tsx') && !rel.endsWith('.test.ts'))
      .filter((rel) => readFileSync(join(root, rel), 'utf8').includes('showCompanyLogo'))
      .sort()

    expect(callers).toEqual([
      join('components', 'layout', 'RespondShell.tsx'),
      join('features', 'surveys', 'pages', 'SurveyRespondPage.tsx'),
    ])
  })
})
