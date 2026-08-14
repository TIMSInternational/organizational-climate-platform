import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SegmentedScale } from './SegmentedScale'

afterEach(cleanup)

/**
 * happy-dom computes no colour and does no layout, so the claims worth checking
 * here are the ones that survive that: the roles and states assistive technology
 * reads, the keys the respondent presses, the value that would be submitted, and
 * the class the browser will paint the selected segment from. The colours
 * themselves are measured in `styles/accentContrast.test.ts` and
 * `features/surveys/respondContrast.test.ts`.
 */
function renderScale(overrides: Partial<Parameters<typeof SegmentedScale>[0]> = {}) {
  const onChange = vi.fn()
  render(
    <SegmentedScale
      min={1}
      max={5}
      minLabel="Never"
      maxLabel="Always"
      value={null}
      onChange={onChange}
      label="How is it going?"
      {...overrides}
    />,
  )
  return { onChange }
}

describe('SegmentedScale', () => {
  it('is one radiogroup with a segment per scale point', () => {
    renderScale()
    expect(screen.getByRole('radiogroup')).toBeTruthy()
    expect(screen.getAllByRole('radio').map((radio) => radio.textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ])
  })

  it('honours the question own bounds rather than assuming 1-5', () => {
    renderScale({ min: 0, max: 3 })
    expect(screen.getAllByRole('radio').map((radio) => radio.textContent)).toEqual([
      '0',
      '1',
      '2',
      '3',
    ])
  })

  it('names the group, because an unnamed radiogroup is announced as "group"', () => {
    renderScale()
    expect(screen.getByRole('radiogroup', { name: 'How is it going?' })).toBeTruthy()
  })

  it('takes its name from another element when asked to', () => {
    render(
      <div>
        <span id="legend">Workload over the last four weeks</span>
        <SegmentedScale
          min={1}
          max={3}
          minLabel="Never"
          maxLabel="Always"
          value={null}
          onChange={vi.fn()}
          labelledBy="legend"
        />
      </div>,
    )
    expect(
      screen.getByRole('radiogroup', { name: 'Workload over the last four weeks' }),
    ).toBeTruthy()
  })

  it('reports whether an answer is required', () => {
    renderScale({ required: true })
    expect(screen.getByRole('radiogroup').getAttribute('aria-required')).toBe('true')
    cleanup()
    renderScale()
    expect(screen.getByRole('radiogroup').getAttribute('aria-required')).toBeNull()
  })

  it('checks the chosen point, and only it', () => {
    renderScale({ value: '4' })
    expect(
      screen.getAllByRole('radio').map((radio) => radio.getAttribute('aria-checked')),
    ).toEqual(['false', 'false', 'false', 'true', 'false'])
  })

  it('checks nothing when unanswered', () => {
    renderScale()
    expect(
      screen.getAllByRole('radio').every((radio) => radio.getAttribute('aria-checked') === 'false'),
    ).toBe(true)
  })

  it('checks nothing when the saved code is not a point on this scale', () => {
    // A draft saved against a survey whose scale was edited afterwards. Rendering
    // it as answered would show the respondent a choice the form cannot submit.
    renderScale({ value: '9' })
    expect(
      screen.getAllByRole('radio').every((radio) => radio.getAttribute('aria-checked') === 'false'),
    ).toBe(true)
  })

  it('emits the stored code of the point clicked, never its label', () => {
    const { onChange } = renderScale()
    return userEvent.click(screen.getByRole('radio', { name: '3' })).then(() => {
      expect(onChange).toHaveBeenCalledWith('3')
    })
  })

  it('writes the two anchor words under the ends of the row', () => {
    renderScale()
    expect(screen.getByText('Never')).toBeTruthy()
    expect(screen.getByText('Always')).toBeTruthy()
  })

  it('is a single tab stop, on the chosen point', () => {
    renderScale({ value: '4' })
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('tabindex'))).toEqual([
      '-1',
      '-1',
      '-1',
      '0',
      '-1',
    ])
  })

  it('puts the tab stop on the first point while nothing is chosen', () => {
    // Otherwise an unanswered question cannot be reached by keyboard at all.
    renderScale()
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('tabindex'))).toEqual([
      '0',
      '-1',
      '-1',
      '-1',
      '-1',
    ])
  })

  it('moves to the next point on ArrowRight and ArrowDown', async () => {
    const { onChange } = renderScale({ value: '2' })
    const radios = screen.getAllByRole('radio')
    await userEvent.tab()
    expect(document.activeElement).toBe(radios[1])

    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('3')
    expect(document.activeElement).toBe(radios[2])

    // The group is controlled and this parent never re-renders with the new value,
    // so `value` is still '2' — but focus has moved, and the next key steps from
    // where the focus is. Down is the same step as right.
    await userEvent.keyboard('{ArrowDown}')
    expect(onChange).toHaveBeenLastCalledWith('4')
    expect(document.activeElement).toBe(radios[3])
  })

  it('moves to the previous point on ArrowLeft and ArrowUp', async () => {
    const { onChange } = renderScale({ value: '3' })
    const radios = screen.getAllByRole('radio')
    await userEvent.tab()
    await userEvent.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith('2')
    expect(document.activeElement).toBe(radios[1])

    await userEvent.keyboard('{ArrowUp}')
    expect(onChange).toHaveBeenLastCalledWith('1')
    expect(document.activeElement).toBe(radios[0])
  })

  it('wraps at both ends, as a radio group does', async () => {
    const { onChange } = renderScale({ value: '5' })
    await userEvent.tab()
    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('1')

    cleanup()
    const first = renderScale({ value: '1' })
    await userEvent.tab()
    await userEvent.keyboard('{ArrowLeft}')
    expect(first.onChange).toHaveBeenLastCalledWith('5')
  })

  it('jumps to the ends on Home and End', async () => {
    const { onChange } = renderScale({ value: '3' })
    await userEvent.tab()
    await userEvent.keyboard('{Home}')
    expect(onChange).toHaveBeenLastCalledWith('1')
    await userEvent.keyboard('{End}')
    expect(onChange).toHaveBeenLastCalledWith('5')
  })

  it('leaves every other key alone, so Tab still leaves the group', async () => {
    const { onChange } = renderScale({ value: '3' })
    await userEvent.tab()
    await userEvent.keyboard('{Tab}')
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getAllByRole('radio')).not.toContain(document.activeElement)
  })

  it('answers nothing while disabled', async () => {
    const { onChange } = renderScale({ disabled: true })
    expect(screen.getAllByRole('radio').every((radio) => radio.hasAttribute('disabled'))).toBe(true)
    expect(screen.getByRole('radiogroup').getAttribute('aria-disabled')).toBe('true')
    await userEvent.click(screen.getByRole('radio', { name: '3' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('is not disabled unless it is asked to be', () => {
    // Guard the test above: `aria-disabled="false"` on every question would be
    // announced, and a `disabled` attribute that never left would be worse.
    renderScale()
    expect(screen.getAllByRole('radio').some((radio) => radio.hasAttribute('disabled'))).toBe(false)
    expect(screen.getByRole('radiogroup').getAttribute('aria-disabled')).toBeNull()
  })

  it('renders nothing when the scale has no points', () => {
    // `scaleMin`/`scaleMax` are nullable server values; `choicesFor` guards the
    // same inversion. An empty radiogroup announces a group with nothing in it.
    const { container } = render(
      <SegmentedScale
        min={5}
        max={1}
        minLabel="Never"
        maxLabel="Always"
        value={null}
        onChange={vi.fn()}
        label="How is it going?"
      />,
    )
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(container.textContent).toBe('')
  })

  it('fills the chosen segment with the accent FILL, never the plain accent', () => {
    // tokens.css: the on-accent ink is 3.74:1 light / 2.49:1 dark on
    // `--admin-accent-blue` and 5.47:1 on `--admin-accent-blue-fill`. Asserted on
    // the class list split, because `bg-accent-blue` is a substring of
    // `bg-accent-blue-fill` and a `toContain` on the raw string would pass either
    // way.
    renderScale({ value: '4' })
    const classes = screen.getByRole('radio', { name: '4' }).className.split(/\s+/)
    expect(classes).toContain('bg-accent-blue-fill')
    expect(classes).not.toContain('bg-accent-blue')
    expect(classes).toContain('text-fg-on-accent')
  })

  it('leaves the unchosen segments on the input surface', () => {
    // Guard the test above: if the checked branch never ran, every segment would
    // carry the same classes and the assertion would pass on the wrong element.
    renderScale({ value: '4' })
    const classes = screen.getByRole('radio', { name: '2' }).className.split(/\s+/)
    expect(classes).toContain('bg-surface-input')
    expect(classes).not.toContain('bg-accent-blue-fill')
  })

  it('never sets outline-none, so the global focus ring survives', () => {
    // index.css provides the app's only focus indicator via :focus-visible, and a
    // keyboard-operated group that does not show where focus is is unusable.
    renderScale()
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.className).not.toMatch(/outline-none/)
    }
    expect(screen.getByRole('radiogroup').className).not.toMatch(/outline-none/)
  })

  it('gives every segment a 44px target', () => {
    // The reason the design replaced the radio row: a native radio is ~13px, far
    // under the WCAG 2.2 target minimum, on the screen most people answer on a
    // phone. h-11 is 11 x the 4px --spacing token.
    renderScale()
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.className.split(/\s+/)).toContain('h-11')
    }
  })

  it('is a real button, so it is focusable and submits nothing', () => {
    renderScale()
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.tagName).toBe('BUTTON')
      expect(radio.getAttribute('type')).toBe('button')
    }
  })
})
