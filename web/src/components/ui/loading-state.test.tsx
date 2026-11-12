import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TranslationProvider } from '../../i18n'
import es from '../../i18n/es.json'
import { LoadingState } from './loading-state'

afterEach(cleanup)

function renderLoading(props: Parameters<typeof LoadingState>[0] = {}) {
  return render(
    <TranslationProvider initialLocale="es">
      <LoadingState {...props} />
    </TranslationProvider>,
  )
}

describe('LoadingState', () => {
  it('announces once, politely, in the catalogue’s word', () => {
    renderLoading()
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toBe(es.ui.state.loading)
  })

  it('announces what the caller says is loading', () => {
    renderLoading({ label: 'Cargando encuestas' })
    expect(screen.getByRole('status').textContent).toBe('Cargando encuestas')
  })

  it('draws the requested placeholder rows, hidden from assistive technology', () => {
    const { container } = renderLoading({ rows: 4 })
    const rows = container.querySelectorAll('[data-slot="skeleton"]')
    expect(rows).toHaveLength(4)
    for (const row of rows) expect(row.getAttribute('aria-hidden')).toBe('true')
    // The last row is short, so the block reads as a list.
    expect(rows[3]!.className).toContain('w-2/3')
    expect(rows[0]!.className).not.toContain('w-2/3')
  })

  it('draws at least one row for a nonsense count', () => {
    const { container } = renderLoading({ rows: 0 })
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(1)
  })

  it('paints its rows in the control fill, the canvas’s `.sk`', () => {
    const { container } = renderLoading()
    const row = container.querySelector('[data-slot="skeleton"]') as HTMLElement
    expect(row.className.split(/\s+/)).toContain('bg-surface-fill')
    expect(row.className.split(/\s+/)).not.toContain('bg-surface-icon-box')
  })
})
