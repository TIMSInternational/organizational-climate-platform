import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LanguageSwitcher, TranslationProvider } from '../../i18n'
import { ThemeSwitcher } from './ShellControls'
import { CHIP_SELECT_LABEL_CLASS, CHIP_SELECT_STYLE } from './chipSelectStyle'

afterEach(cleanup)

/**
 * The respond header's two chip pickers on a phone: a 44px target (HIG `accessibility.md`
 * › Mobility) and a chevron that says the chip opens a menu. happy-dom has no layout, so the
 * geometry is read out of the stylesheet that draws it, and the 390px screenshot is where it
 * was looked at.
 */
describe('the chip picker', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

  it('puts the chip-select class on both pickers’ labels', () => {
    render(
      <TranslationProvider initialLocale="es">
        <LanguageSwitcher variant="chip" />
        <ThemeSwitcher variant="chip" />
      </TranslationProvider>,
    )
    for (const select of screen.getAllByRole('combobox')) {
      expect(select.closest('label')?.classList.contains(CHIP_SELECT_LABEL_CLASS)).toBe(true)
    }
  })

  it('reads its height, bleed, ground and line through the switch the stylesheet sets', () => {
    expect(String(CHIP_SELECT_STYLE.height)).toMatch(/^var\(--chip-select-height,/)
    expect(String(CHIP_SELECT_STYLE.marginBlock)).toMatch(/^var\(--chip-select-bleed,/)
    expect(String(CHIP_SELECT_STYLE.background)).toMatch(/^var\(--chip-select-ground,/)
    expect(String(CHIP_SELECT_STYLE.border)).toMatch(/var\(--chip-select-line,/)
  })

  it('grows the target to 44px on a phone and bleeds it back so the row keeps 22px', () => {
    const block = /@media \(max-width: 47\.99rem\), \(pointer: coarse\) \{\s*\.chip-select \{([^}]*)\}/.exec(css)
    expect(block, 'index.css has no phone rule for .chip-select').not.toBeNull()
    const px = (name: string) => {
      const m = new RegExp(`${name}:\\s*calc\\(var\\(--admin-space-2\\) \\* (-?[\\d.]+)\\)`).exec(block![1])
      expect(m, `${name} is not a multiple of --admin-space-2`).not.toBeNull()
      return 2 * Number(m![1])
    }
    const height = px('--chip-select-height')
    expect(height).toBeGreaterThanOrEqual(44)
    // What is left in the row is the 22px chip the boards draw.
    expect(height + 2 * px('--chip-select-bleed')).toBe(22)
  })

  it('draws a chevron in the chip’s own ink', () => {
    const after = /\.chip-select::after \{([^}]*)\}/.exec(css)
    expect(after, 'index.css has no chevron for .chip-select').not.toBeNull()
    expect(after![1]).toMatch(/background-color:\s*currentColor/)
    expect(after![1]).toMatch(/mask:/)
    expect(after![1]).toMatch(/pointer-events:\s*none/)
  })
})
