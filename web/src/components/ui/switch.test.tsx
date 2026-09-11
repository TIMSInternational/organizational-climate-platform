import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Switch } from './switch'

afterEach(cleanup)

describe('Switch', () => {
  it('toggles on click', async () => {
    const onCheckedChange = vi.fn()
    render(<Switch aria-label="Login enabled" onCheckedChange={onCheckedChange} />)
    await userEvent.click(screen.getByRole('switch'))
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('toggles on Space', async () => {
    const onCheckedChange = vi.fn()
    render(<Switch aria-label="Login enabled" onCheckedChange={onCheckedChange} />)
    await userEvent.tab()
    await userEvent.keyboard(' ')
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('reports checked state, and reflects a controlled value', () => {
    render(<Switch aria-label="Login enabled" checked />)
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  })

  it('does not toggle while disabled', async () => {
    const onCheckedChange = vi.fn()
    render(<Switch aria-label="Login enabled" disabled onCheckedChange={onCheckedChange} />)
    await userEvent.click(screen.getByRole('switch'))
    expect(onCheckedChange).not.toHaveBeenCalled()
  })

  it('lays the thumb out as a knob: no button padding on the track, and a thumb that cannot shrink', () => {
    // index.css pads every bare <button> 12px a side; on the 28px track that squeezed the
    // flex-shrinking thumb to a 2px sliver. happy-dom has no layout, so the classes are the pin
    // and the authoring screenshots are the evidence.
    render(<Switch aria-label="Login enabled" checked />)
    const root = screen.getByRole('switch')
    expect(root.className.split(' ')).toContain('p-0')
    expect(root.querySelector('[data-slot="switch-thumb"]')?.className.split(' ')).toContain('shrink-0')
  })

  it('starts the thumb at the track’s left edge, so the translate alone says on or off', () => {
    // index.css also gives every bare <button> `justify-content: center`. Centred first and then
    // translated, an off knob sat mid-track and read as on, and an on knob ran past the right
    // end (bank-light.png, draft-light.png). The class is the pin; the shots are the evidence.
    for (const checked of [false, true]) {
      cleanup()
      render(<Switch aria-label="Login enabled" checked={checked} />)
      expect(screen.getByRole('switch').className.split(' ')).toContain('justify-start')
    }
  })

  it('draws the SurveyBuilder artboard’s 16×28 track and 12px knob at size sm, and the 18×32 default elsewhere', () => {
    // SurveyBuilder.dc.html draws `width: 28px; height: 16px` with the knob at `left: 14px`;
    // Departments.dc.html and Notifications.dc.html draw 32×18. The classes are the pin, the
    // builder shot the evidence (switch measured 28×16 at the artboard's x, 1px apart).
    render(<Switch aria-label="small" size="sm" checked />)
    const small = screen.getByRole('switch')
    expect(small.getAttribute('data-size')).toBe('sm')
    expect(small.className.split(' ')).toEqual(expect.arrayContaining(['h-4', 'w-7']))
    expect(small.querySelector('[data-slot="switch-thumb"]')?.className.split(' ')).toEqual(
      expect.arrayContaining(['size-3', 'translate-x-px', 'data-[state=checked]:translate-x-3.25']),
    )
    cleanup()
    render(<Switch aria-label="default" checked />)
    const normal = screen.getByRole('switch')
    expect(normal.getAttribute('data-size')).toBe('default')
    expect(normal.className.split(' ')).toEqual(expect.arrayContaining(['h-4.5', 'w-8']))
    expect(normal.querySelector('[data-slot="switch-thumb"]')?.className.split(' ')).toEqual(
      expect.arrayContaining(['size-3.5', 'translate-x-0.5', 'data-[state=checked]:translate-x-3.5']),
    )
  })
})
