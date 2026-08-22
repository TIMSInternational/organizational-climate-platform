import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { TranslationProvider } from '../../../i18n'
import RegistrarAvanceForm from './RegistrarAvanceForm'

/**
 * **The 0–1 vs 0–100 trap, pinned.**
 *
 * A user types 60. `RegistrarAvanceRequest.PorcentajeAvance` must receive `0.6`.
 * Sending `60` would hit
 * `ArgumentOutOfRangeException("porcentaje_avance debe estar entre 0 y 1")` and
 * come back a 400 — and, far worse, sending `1` for "1%" would *succeed* and
 * silently record the plan as finished.
 */
function renderForm(currentAvance = 0.4, onSubmit = vi.fn()) {
  render(
    <TranslationProvider>
      <RegistrarAvanceForm currentAvance={currentAvance} today="2026-08-21" onSubmit={onSubmit} />
    </TranslationProvider>,
  )
  return onSubmit
}

function avanceInput(): HTMLInputElement {
  return screen.getByLabelText(/Avance/) as HTMLInputElement
}

afterEach(cleanup)

describe('registrar avance', () => {
  it('sends the typed percentage as the fraction the domain accepts', () => {
    const onSubmit = renderForm()
    fireEvent.change(avanceInput(), { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar avance' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ porcentajeAvance: 0.6, fecha: '2026-08-21' }),
    )
  })

  it('sends 1, not 100, for a plan taken to completion', () => {
    const onSubmit = renderForm()
    fireEvent.change(avanceInput(), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar avance' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ porcentajeAvance: 1 }))
  })

  it('starts at the percentage already on record', () => {
    // `0.4` on the wire is "40%" on screen — the inverse of the same conversion, so
    // the common case starts from the truth rather than from blank.
    renderForm(0.4)
    expect(avanceInput().value).toBe('40')
  })

  it('refuses an out-of-range percentage instead of clamping it silently', () => {
    // A typed 600 is a mistake. Quietly recording 100% would be recording something
    // the user did not mean.
    const onSubmit = renderForm()
    fireEvent.change(avanceInput(), { target: { value: '600' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar avance' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Escriba un porcentaje entre 0 y 100.')).toBeTruthy()
  })

  it('sends the comment as null rather than as an empty string when untouched', () => {
    const onSubmit = renderForm()
    fireEvent.change(avanceInput(), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar avance' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ comentario: null }))
  })

  it('defaults the fecha to the day it was handed, not to an instant', () => {
    const onSubmit = renderForm()
    fireEvent.change(avanceInput(), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar avance' }))

    const [input] = onSubmit.mock.calls[0] as [{ fecha: string }]
    expect(input.fecha).toBe('2026-08-21')
    expect(input.fecha).not.toContain('T')
  })
})
