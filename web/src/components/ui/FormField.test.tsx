import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  CheckboxField,
  RadioField,
  SelectField,
  SwitchField,
  TextField,
  TextareaField,
} from './FormField'

afterEach(cleanup)

describe('TextField', () => {
  it('reports the value, not the event', async () => {
    const onChange = vi.fn()
    render(<TextField label="Name" onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Name'), 'A')
    expect(onChange).toHaveBeenCalledWith('A')
  })

  it('wires label, description and error to the control', () => {
    render(<TextField label="Name" description="Legal name" error="Required" />)
    const control = screen.getByLabelText(/Name/)
    expect(control.getAttribute('aria-invalid')).toBe('true')

    const describedBy = control.getAttribute('aria-describedby')?.split(' ') ?? []
    expect(describedBy).toContain(screen.getByText('Legal name').id)
    expect(describedBy).toContain(screen.getByRole('alert').id)
  })

  it('marks a required field without putting the asterisk in the accessible name', () => {
    render(<TextField label="Name" required />)
    // Queried by role, so this goes through the accessible-name algorithm, which
    // honours the `*`'s aria-hidden — the name is "Name", not "Name*". A
    // getByLabelText query would see the raw textContent and disagree.
    const control = screen.getByRole('textbox', { name: 'Name' })
    expect(control.hasAttribute('required')).toBe(true)
    // The marker is still on screen for sighted users.
    expect(screen.getByText('*')).toBeTruthy()
  })

  it('shows no alert when there is no error', () => {
    render(<TextField label="Name" />)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('TextareaField', () => {
  it('reports the value', async () => {
    const onChange = vi.fn()
    render(<TextareaField label="Notes" onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Notes'), 'x')
    expect(onChange).toHaveBeenCalledWith('x')
  })
})

describe('CheckboxField', () => {
  it('reports a boolean, never "indeterminate"', async () => {
    const onChange = vi.fn()
    render(<CheckboxField label="Active" onChange={onChange} />)
    await userEvent.click(screen.getByRole('checkbox'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('is labelled', () => {
    render(<CheckboxField label="Active" />)
    expect(screen.getByRole('checkbox', { name: /Active/ })).toBeTruthy()
  })
})

describe('SwitchField', () => {
  it('reports the new state', async () => {
    const onChange = vi.fn()
    render(<SwitchField label="Login enabled" onChange={onChange} />)
    await userEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe('SelectField', () => {
  it('reports the chosen value', async () => {
    const onChange = vi.fn()
    render(
      <SelectField
        label="Priority"
        placeholder="Choose"
        onChange={onChange}
        options={[
          { value: 'low', label: 'Low' },
          { value: 'high', label: 'High' },
        ]}
      />,
    )
    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.click(await screen.findByRole('option', { name: 'High' }))
    expect(onChange).toHaveBeenCalledWith('high')
  })

  it('honours a disabled option', async () => {
    render(
      <SelectField
        label="Priority"
        placeholder="Choose"
        options={[
          { value: 'low', label: 'Low', disabled: true },
          { value: 'high', label: 'High' },
        ]}
      />,
    )
    await userEvent.click(screen.getByRole('combobox'))
    const option = await screen.findByRole('option', { name: 'Low' })
    expect(option.getAttribute('data-disabled')).not.toBeNull()
  })
})

describe('RadioField', () => {
  it('reports the chosen value', async () => {
    const onChange = vi.fn()
    render(
      <RadioField
        label="Priority"
        onChange={onChange}
        options={[
          { value: 'low', label: 'Low' },
          { value: 'high', label: 'High' },
        ]}
      />,
    )
    await userEvent.click(screen.getByLabelText('High'))
    expect(onChange).toHaveBeenCalledWith('high')
  })

  it('labels every option', () => {
    render(
      <RadioField
        label="Priority"
        options={[
          { value: 'low', label: 'Low' },
          { value: 'high', label: 'High' },
        ]}
      />,
    )
    expect(screen.getByLabelText('Low')).toBeTruthy()
    expect(screen.getByLabelText('High')).toBeTruthy()
  })
})
