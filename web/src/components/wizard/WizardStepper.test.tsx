import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import WizardStepper, { type WizardStep } from './WizardStepper'
import { TranslationProvider } from '../../i18n'
import { LOCALE_STORAGE_KEY } from '../../i18n/locale'

function steps(overrides: Partial<Record<string, readonly string[]>> = {}): WizardStep[] {
  return [
    { id: 'one', label: 'Basics', description: 'What it is called', errors: overrides.one ?? [] },
    { id: 'two', label: 'Schedule', errors: overrides.two ?? [] },
    { id: 'three', label: 'Review', errors: overrides.three ?? [] },
  ]
}

/** Drives `currentIndex` the way a real page does, so navigation is observable. */
function Harness({
  stepList,
  onSubmit = () => {},
}: {
  stepList: WizardStep[]
  onSubmit?: () => void
}) {
  const [index, setIndex] = useState(0)
  return (
    <TranslationProvider>
      <WizardStepper
        steps={stepList}
        currentIndex={index}
        onNavigate={setIndex}
        onSubmit={onSubmit}
        submitLabel="Create it"
        progressLabel={`Step ${index + 1} of ${stepList.length}`}
        stepListLabel="Wizard steps"
      >
        <p>Fields for {stepList[index].label}</p>
      </WizardStepper>
    </TranslationProvider>
  )
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('WizardStepper', () => {
  it('advances only while the current step is error free', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    render(<Harness stepList={steps()} />)

    expect(screen.getByText('Fields for Basics')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Fields for Schedule')).toBeTruthy()
  })

  it('reveals the reasons rather than disabling Continue, and does not move', async () => {
    // A disabled Continue with no stated reason is the "the form is broken" ticket.
    // Every message is listed, because a count is not an instruction.
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    render(<Harness stepList={steps({ one: ['Enter a title.', 'Pick a language.'] })} />)

    const next = screen.getByRole('button', { name: 'Next' })
    expect((next as HTMLButtonElement).disabled).toBe(false)

    await userEvent.click(next)

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Enter a title.')
    expect(alert.textContent).toContain('Pick a language.')
    expect(screen.getByText('Fields for Basics')).toBeTruthy()
  })

  it('never gates going back, and clears the error panel on the way', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    render(<Harness stepList={steps({ two: ['Choose an end time.'] })} />)

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('alert').textContent).toContain('Choose an end time.')

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Fields for Basics')).toBeTruthy()
    // Being told about step 2's problems while looking at step 1 is noise.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('locks a later step behind an incomplete one, so the list is not a way around the gate', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    render(<Harness stepList={steps({ two: ['Choose an end time.'] })} />)

    expect((screen.getByRole('button', { name: /Schedule/ }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: /Review/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('submits from the last step instead of advancing', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    const onSubmit = vi.fn()
    render(<Harness stepList={steps()} onSubmit={onSubmit} />)

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create it' }))

    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('marks the visible step for assistive technology', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    render(<Harness stepList={steps()} />)

    expect(screen.getByRole('button', { name: /Basics/ }).getAttribute('aria-current')).toBe('step')
    expect(screen.getByRole('button', { name: /Schedule/ }).getAttribute('aria-current')).toBeNull()
  })

  it('translates its own controls rather than taking them as props', async () => {
    // Back/Next come from `common.*` here: this component is app level and has
    // translation context, unlike the `ui/` primitives that take their labels in.
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    render(<Harness stepList={steps()} />)

    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Atrás' })).toBeTruthy()
  })
})
