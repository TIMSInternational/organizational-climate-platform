import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { TranslationProvider } from '../../../i18n'
import InvolucradosPicker from './InvolucradosPicker'
import type { PersonaPickerItem } from '../api/trackingPickers'

/**
 * The acceptance criterion the issue words as "Involucrados supports multiple
 * selection", and the parked follow-up it comes from: the legacy screen used a
 * single `<select>`, which cannot express an `IReadOnlyList<string>`.
 */
const PERSONAS: PersonaPickerItem[] = [
  { id: 'persona-1', name: 'Ana Rojas', email: 'ana@acme.test' },
  { id: 'persona-2', name: 'Beto Solís', email: 'beto@acme.test' },
  { id: 'persona-3', name: 'Carla Mora', email: 'carla@acme.test' },
]

function Harness({
  onChange,
  initial = [],
  locked = [],
}: {
  onChange: (value: string[]) => void
  initial?: string[]
  locked?: string[]
}) {
  return (
    <TranslationProvider>
      <InvolucradosPicker
        label="Involucrados"
        personas={PERSONAS}
        value={initial}
        onChange={onChange}
        locked={locked}
      />
    </TranslationProvider>
  )
}

afterEach(cleanup)

describe('the involucrados picker', () => {
  it('offers every person as its own checkbox rather than one dropdown', () => {
    render(<Harness onChange={vi.fn()} />)
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('adds to the selection rather than replacing it', () => {
    // The whole difference from a single `<select>`: picking a second person must
    // not unpick the first.
    const onChange = vi.fn()
    const { rerender } = render(<Harness onChange={onChange} initial={['persona-1']} />)

    fireEvent.click(screen.getByRole('checkbox', { name: /Beto/ }))
    expect(onChange).toHaveBeenCalledWith(['persona-1', 'persona-2'])

    rerender(<Harness onChange={onChange} initial={['persona-1', 'persona-2']} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Carla/ }))
    expect(onChange).toHaveBeenLastCalledWith(['persona-1', 'persona-2', 'persona-3'])
  })

  it('un-picks a person who is picked again', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} initial={['persona-1', 'persona-2']} />)

    fireEvent.click(screen.getByRole('checkbox', { name: /Ana/ }))
    expect(onChange).toHaveBeenCalledWith(['persona-2'])
  })

  it('says how many are chosen', () => {
    render(<Harness onChange={vi.fn()} initial={['persona-1', 'persona-3']} />)
    expect(screen.getByText('Seleccionadas: 2')).toBeTruthy()
  })

  it('narrows the list by name or email without losing the selection', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} initial={['persona-1']} />)

    fireEvent.change(screen.getByPlaceholderText('Buscar por nombre o correo'), {
      target: { value: 'carla@' },
    })
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    // The chosen person is still chosen even though they are filtered out of view.
    expect(screen.getByText('Seleccionadas: 1')).toBeTruthy()
  })

  it('shows people already on the plan as fixed, because the service cannot remove one', () => {
    // `AgregarInvolucradoAsync` is the only involucrados endpoint; there is no
    // DELETE and `PlanDeAccion` has no `QuitarInvolucrado`.
    const onChange = vi.fn()
    render(<Harness onChange={onChange} locked={['persona-2']} />)

    const beto = screen.getByRole('checkbox', { name: /Beto/ }) as HTMLButtonElement
    expect(beto.getAttribute('data-state')).toBe('checked')
    expect(beto.disabled).toBe(true)

    fireEvent.click(beto)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('explains itself when the caller has no directory to pick from', () => {
    // `TrackingPickerEndpoints` refuses every role but the two admin ones, so a
    // leader routinely gets nothing here.
    render(
      <TranslationProvider>
        <InvolucradosPicker label="Involucrados" personas={[]} value={[]} onChange={vi.fn()} />
      </TranslationProvider>,
    )
    expect(
      screen.getByText('No hay un directorio de personas disponible para este usuario.'),
    ).toBeTruthy()
  })
})
