import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MicroclimateFilters from './MicroclimateFilters'

describe('MicroclimateFilters', () => {
  it('renders every status option with "All statuses" for the empty value', () => {
    render(<MicroclimateFilters value={{ status: '' }} onChange={vi.fn()} />)

    const select = screen.getByRole('combobox') as HTMLSelectElement
    const optionLabels = Array.from(select.options).map((o) => o.textContent)
    expect(optionLabels).toEqual(['All statuses', 'draft', 'active', 'closed'])
  })

  it('reflects the current value as the selected option', () => {
    render(<MicroclimateFilters value={{ status: 'active' }} onChange={vi.fn()} />)

    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('active')
  })

  it('calls onChange with the newly selected status when the user picks one', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<MicroclimateFilters value={{ status: '' }} onChange={onChange} />)

    await user.selectOptions(screen.getByRole('combobox'), 'closed')

    expect(onChange).toHaveBeenCalledWith({ status: 'closed' })
  })

  it('calls onChange with an empty status when the user picks "All statuses"', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<MicroclimateFilters value={{ status: 'draft' }} onChange={onChange} />)

    await user.selectOptions(screen.getByRole('combobox'), 'All statuses')

    expect(onChange).toHaveBeenCalledWith({ status: '' })
  })
})
