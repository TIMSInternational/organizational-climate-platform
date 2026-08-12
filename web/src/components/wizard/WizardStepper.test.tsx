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
  aside,
}: {
  stepList: WizardStep[]
  onSubmit?: () => void
  aside?: React.ReactNode
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
        aside={aside}
      >
        <p>Fields for {stepList[index].label}</p>
      </WizardStepper>
    </TranslationProvider>
  )
}

/**
 * The completion reading, which is one `<p>` holding a numerator text node and a
 * `<span>` for the dimmed denominator.
 *
 * A plain `getByText('2/3')` cannot see it: RTL's default matcher compares only an
 * element's *own* text nodes, so the `<p>` reads as "2" and the `<span>` as "/3". This
 * asserts on the paragraph's whole text instead, which is what a reader sees.
 */
function meterReading(): string {
  const paragraphs = [...document.querySelectorAll('p')]
  const meter = paragraphs.find((p) => /^\d+\/\d+$/.test(p.textContent ?? ''))
  return meter?.textContent ?? ''
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

/**
 * The rail: what it says about a step you are not looking at.
 *
 * This is the part of the redesign that did not exist before. The old step list
 * carried two bits — filled or not, ticked or not — so "what does step 4 still want"
 * was only answerable by walking to step 4 and pressing Continue. Every assertion
 * below is about a step other than the current one.
 */
describe('WizardStepper rail', () => {
  it('counts what a step is still missing, rather than only that something is', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    render(
      <Harness stepList={steps({ two: ['Choose an end time.', 'Choose a start time.'] })} />,
    )

    // The count is the whole point: "something is wrong with step 2" is not a plan,
    // "2 outstanding" is. The messages themselves stay behind Continue.
    expect(screen.getByRole('button', { name: /Schedule/ }).textContent).toContain('2 outstanding')
  })

  it('uses the singular form for one, because the translator has no plural rules', () => {
    // In Spanish, deliberately. English pluralises this by adding nothing —
    // "1 outstanding" and "{count} outstanding" render identically at count 1, so an
    // English assertion here would pass whether or not the singular key is ever used.
    // Spanish is "1 pendiente" against "{count} pendientes", where the one-key
    // implementation produces the wrong string and this can see it.
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    render(<Harness stepList={steps({ two: ['Elija una hora de cierre.'] })} />)

    const schedule = screen.getByRole('button', { name: /Schedule/ }).textContent
    expect(schedule).toContain('1 pendiente')
    expect(schedule).not.toContain('1 pendientes')
  })

  it('calls a step complete rather than locked when it needs nothing, so the meter agrees', () => {
    // The audience step of the survey wizard is optional, so it is error-free from the
    // start and the meter counts it. Rendering the rail with `locked` winning showed
    // "1 / 3 steps complete" beside a list in which nothing said Complete.
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    render(<Harness stepList={steps({ one: ['Enter a title.'] })} />)

    const review = screen.getByRole('button', { name: /Review/ })
    expect(review.textContent).toContain('Complete')
    expect(review.textContent).not.toContain('Locked')
    // Complete and still out of reach: step one is unfinished, so the gate holds.
    expect((review as HTMLButtonElement).disabled).toBe(true)
  })

  it('says Locked only for a step that is both unfinished and out of reach', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    render(<Harness stepList={steps({ one: ['Enter a title.'], three: ['Confirm it.'] })} />)

    expect(screen.getByRole('button', { name: /Review/ }).textContent).toContain('Locked')
  })

  it('reads out how many steps are complete, and moves as they are', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    render(<Harness stepList={steps({ two: ['Choose an end time.'] })} />)

    // Two of the three steps have nothing outstanding.
    expect(meterReading()).toBe('2/3')
    expect(
      screen.getByRole('progressbar', { name: 'Steps complete' }).getAttribute('aria-valuenow'),
    ).toBe('66.66666666666666')

    // The numerator is the number of error-free steps, not the step you are on.
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(meterReading()).toBe('2/3')
  })

  it('numbers every step, in the mono face that every reading in this product uses', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    render(<Harness stepList={steps()} />)

    const ordinals = [...document.querySelectorAll('span.font-mono.tabular-nums')].map(
      (node) => node.textContent,
    )
    // Zero-padded so the column does not shift between 9 and 10, which is the whole
    // reason a position is set in tabular figures.
    expect(ordinals).toEqual(['01', '02', '03'])
  })

  it('renders the page aside in the rail, and nothing at all without one', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    const { unmount } = render(<Harness stepList={steps()} aside={<p>Started from a template</p>} />)
    const nav = screen.getByRole('navigation', { name: 'Wizard steps' })
    expect(nav.textContent).toContain('Started from a template')

    unmount()
    render(<Harness stepList={steps()} />)
    expect(screen.queryByText('Started from a template')).toBeNull()
  })
})
