import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import SharedReportNotes from './SharedReportNotes'
import { TranslationProvider } from '../../../../i18n'

const notes = {
  locale: 'es',
  introduction: 'Primer párrafo de la introducción.\n\nSegundo párrafo.',
  conclusions: null,
  recommendations: 'Revisar la carga de trabajo.',
}

describe('SharedReportNotes', () => {
  afterEach(() => {
    cleanup()
  })

  it('opens with the introduction, one paragraph per block, in the report language', () => {
    render(
      <TranslationProvider initialLocale="en">
        <SharedReportNotes notes={notes} part="opening" />
      </TranslationProvider>,
    )

    expect(screen.getByRole('heading', { name: 'Introduction' })).toBeTruthy()
    const first = screen.getByText('Primer párrafo de la introducción.')
    expect(first.tagName).toBe('P')
    expect(screen.getByText('Segundo párrafo.').tagName).toBe('P')
    expect(first.closest('[lang]')?.getAttribute('lang')).toBe('es')
    expect(screen.queryByText('Revisar la carga de trabajo.')).toBeNull()
  })

  it('closes with only the notes that are set', () => {
    render(
      <TranslationProvider initialLocale="es">
        <SharedReportNotes notes={notes} part="closing" />
      </TranslationProvider>,
    )

    expect(screen.queryByRole('heading', { name: 'Conclusiones' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Recomendaciones' })).toBeTruthy()
    expect(screen.getByText('Revisar la carga de trabajo.')).toBeTruthy()
  })

  it('renders nothing without notes', () => {
    const { container } = render(
      <TranslationProvider initialLocale="es">
        <SharedReportNotes notes={null} part="opening" />
      </TranslationProvider>,
    )
    expect(container.textContent).toBe('')
  })
})
