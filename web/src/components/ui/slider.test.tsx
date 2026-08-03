import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Slider } from './slider'

afterEach(cleanup)

describe('Slider', () => {
  it('exposes a labelled slider with its value', () => {
    // The legacy version had no aria plumbing at all.
    render(<Slider aria-label="Weight" defaultValue={[40]} max={100} />)
    const slider = screen.getByRole('slider', { name: 'Weight' })
    expect(slider.getAttribute('aria-valuenow')).toBe('40')
    expect(slider.getAttribute('aria-valuemax')).toBe('100')
  })

  it('renders one thumb per value, so a range is supported', () => {
    render(<Slider aria-label="Range" defaultValue={[20, 60]} max={100} />)
    expect(screen.getAllByRole('slider')).toHaveLength(2)
  })

  it('names each end of a range separately', () => {
    // Both thumbs reading as "Range" is indistinguishable to a screen-reader user.
    render(
      <Slider
        thumbLabels={['Minimum', 'Maximum']}
        defaultValue={[20, 60]}
        max={100}
      />,
    )
    expect(screen.getByRole('slider', { name: 'Minimum' })).toBeTruthy()
    expect(screen.getByRole('slider', { name: 'Maximum' })).toBeTruthy()
  })

  it('changes value with the arrow keys', async () => {
    const onValueChange = vi.fn()
    render(
      <Slider aria-label="Weight" defaultValue={[40]} max={100} onValueChange={onValueChange} />,
    )
    await userEvent.tab()
    await userEvent.keyboard('{ArrowRight}')
    expect(onValueChange).toHaveBeenCalledWith([41])
  })

  it('does not respond while disabled', async () => {
    const onValueChange = vi.fn()
    render(
      <Slider
        aria-label="Weight"
        defaultValue={[40]}
        max={100}
        disabled
        onValueChange={onValueChange}
      />,
    )
    await userEvent.tab()
    await userEvent.keyboard('{ArrowRight}')
    expect(onValueChange).not.toHaveBeenCalled()
  })
})
