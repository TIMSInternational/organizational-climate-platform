import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PoweredByNexadev } from './PoweredByNexadev'
import { RespondShell } from './RespondShell'
import { TranslationProvider } from '../../i18n'
import { LOCALE_STORAGE_KEY } from '../../i18n/locale'

function renderIn(locale: 'en' | 'es', node: React.ReactNode) {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  return render(<TranslationProvider>{node}</TranslationProvider>)
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('PoweredByNexadev', () => {
  it('reads "Powered by Nexadev" in English and "Desarrollado por Nexadev" in Spanish', () => {
    renderIn('en', <PoweredByNexadev />)
    expect(screen.getByText('Powered by Nexadev')).toBeTruthy()
    cleanup()
    renderIn('es', <PoweredByNexadev />)
    expect(screen.getByText('Desarrollado por Nexadev')).toBeTruthy()
  })

  it('is a badge, not a link: ruled so a respondent is not offered a way off the survey', () => {
    const { container } = renderIn('es', <PoweredByNexadev />)
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('[role="link"]')).toBeNull()
  })

  it('draws both marks, decorative, and leaves the choice between them to the stylesheet', () => {
    const { container } = renderIn('en', <PoweredByNexadev />)
    const marks = Array.from(container.querySelectorAll('img'))
    expect(marks.map((img) => img.getAttribute('src'))).toEqual([
      '/brand/nexadev-mark.png',
      '/brand/nexadev-mark-white.png',
    ])
    for (const img of marks) {
      expect(img.getAttribute('alt')).toBe('')
      expect(img.getAttribute('aria-hidden')).toBe('true')
    }
    // happy-dom has no layout, so which mark is visible cannot be measured here -- the rules
    // that decide it are asserted as text instead. The rail is navy in both themes, so
    // `.on-shell` must swap as well as the dark theme.
    const css = readFileSync(join(__dirname, '../../index.css'), 'utf8')
    expect(css).toMatch(/\.nexadev-mark--dark\s*\{\s*display:\s*none;/)
    expect(css).toMatch(/:root\[data-admin-theme='dark'\] \.nexadev-mark--light,\s*\.on-shell \.nexadev-mark--light\s*\{\s*display:\s*none;/)
    expect(css).toMatch(/:root\[data-admin-theme='dark'\] \.nexadev-mark--dark,\s*\.on-shell \.nexadev-mark--dark\s*\{\s*display:\s*inline;/)
  })

  it('ships both mark assets', () => {
    for (const asset of ['nexadev-mark.png', 'nexadev-mark-white.png']) {
      const bytes = readFileSync(join(__dirname, '../../../public/brand', asset))
      // PNG signature, so a renamed or empty file cannot pass for the artwork.
      expect(Array.from(bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
    }
  })
})

describe('where the badge is drawn', () => {
  it('every respondent screen carries it, after the survey and outside <main>', () => {
    const { container } = renderIn('es', <RespondShell skipLabel="Saltar">{<p>pregunta</p>}</RespondShell>)
    const badge = container.querySelector('[data-slot="powered-by-nexadev"]')
    expect(badge?.textContent).toBe('Desarrollado por Nexadev')
    expect(badge?.closest('main')).toBeNull()
    expect(badge?.closest('footer')).not.toBeNull()
  })

  it('the sign-in canvas, the older sign-in shell, the rail, the mobile menu and the shared report draw it', () => {
    // These screens need routing, auth and data to mount; that their source renders the
    // component is the claim, so it is checked at the source.
    const sources: Record<string, string> = {
      'auth/next/AuthCanvas.tsx': '<PoweredByNexadev className="on-shell" />',
      'auth/AuthShell.tsx': '<PoweredByNexadev />',
      'app/AdminLayout.tsx': '<PoweredByNexadev className="px-4 pb-3 pt-1" />',
      'features/reports/next/shared/SharedReportNextPage.tsx': '<PoweredByNexadev />',
    }
    for (const [file, needle] of Object.entries(sources)) {
      expect(readFileSync(join(__dirname, '../..', file), 'utf8'), file).toContain(needle)
    }
    expect(readFileSync(join(__dirname, '../../app/AdminLayout.tsx'), 'utf8')).toContain(
      '<PoweredByNexadev className="pt-2" />',
    )
  })
})

describe('one wording on screen, in email and in PDF', () => {
  it('the catalogue sentences are the C# constants the API uses (NexadevCredit.cs)', async () => {
    // The API composes the email and PDF credit; the web catalogues hold the screen's. Two
    // languages, two codebases, so this reads the C# and compares, rather than trusting a comment.
    const cs = readFileSync(
      join(__dirname, '../../../../src/ClimateProject.Application/Localization/NexadevCredit.cs'),
      'utf8',
    )
    const constant = (name: string) => cs.match(new RegExp(`const string ${name} = "([^"]+)"`))?.[1]
    const en = (await import('../../i18n/en.json')).default as { shell: { poweredByNexadev: string } }
    const es = (await import('../../i18n/es.json')).default as { shell: { poweredByNexadev: string } }
    expect(constant('English')).toBe(en.shell.poweredByNexadev)
    expect(constant('Spanish')).toBe(es.shell.poweredByNexadev)
  })
})
