import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MicroclimateForm from './MicroclimateForm'

describe('MicroclimateForm', () => {
  it('renders the base fields with their default values', () => {
    render(<MicroclimateForm onSubmit={vi.fn()} />)

    expect(screen.getByLabelText('Title')).toHaveValue('')
    expect(screen.getByLabelText('Start time')).toHaveValue('')
    expect(screen.getByLabelText('End time')).toHaveValue('')
    expect(screen.getByLabelText('Target participants')).toHaveValue(10)
    expect(screen.getByLabelText('Anonymous responses')).toBeChecked()
    expect(screen.queryByPlaceholderText('Question text')).not.toBeInTheDocument()
  })

  it('adds a new question row each time "Add question" is clicked', async () => {
    const user = userEvent.setup()
    render(<MicroclimateForm onSubmit={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Add question' }))
    expect(screen.getAllByPlaceholderText('Question text')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Add question' }))
    expect(screen.getAllByPlaceholderText('Question text')).toHaveLength(2)
  })

  it('updates only the edited question, leaving other questions untouched', async () => {
    const user = userEvent.setup()
    render(<MicroclimateForm onSubmit={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Add question' }))
    await user.click(screen.getByRole('button', { name: 'Add question' }))

    const questionInputs = screen.getAllByPlaceholderText('Question text')
    await user.type(questionInputs[1], 'Second question')

    const updatedInputs = screen.getAllByPlaceholderText('Question text')
    expect(updatedInputs[0]).toHaveValue('')
    expect(updatedInputs[1]).toHaveValue('Second question')
  })

  it('updates only the edited question type, leaving other question types untouched', async () => {
    const user = userEvent.setup()
    render(<MicroclimateForm onSubmit={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Add question' }))
    await user.click(screen.getByRole('button', { name: 'Add question' }))

    const typeSelects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    await user.selectOptions(typeSelects[1], 'rating')

    expect(typeSelects[0].value).toBe('open_text')
    expect(typeSelects[1].value).toBe('rating')
  })

  it('submits the current form values, including questions, to onSubmit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<MicroclimateForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('Title'), 'Weekly pulse')
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '2026-01-01T09:00' } })
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '2026-01-01T10:00' } })
    fireEvent.change(screen.getByLabelText('Target participants'), { target: { value: '25' } })
    await user.click(screen.getByLabelText('Anonymous responses'))

    await user.click(screen.getByRole('button', { name: 'Add question' }))
    await user.type(screen.getByPlaceholderText('Question text'), 'How are you?')
    await user.selectOptions(screen.getByRole('combobox'), 'rating')

    await user.click(screen.getByRole('button', { name: 'Create microclimate' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Weekly pulse',
      startTime: '2026-01-01T09:00',
      endTime: '2026-01-01T10:00',
      targetParticipantCount: 25,
      anonymousResponses: false,
      questions: [{ text: 'How are you?', type: 'rating', required: true, order: 1 }],
    })
  })

  it('shows a submitting state and disables the submit button while onSubmit is pending', async () => {
    const user = userEvent.setup()
    let resolveSubmit: () => void = () => {}
    const onSubmit = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve
        }),
    )
    render(<MicroclimateForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('Title'), 'Weekly pulse')
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '2026-01-01T09:00' } })
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '2026-01-01T10:00' } })

    const submitButton = screen.getByRole('button', { name: 'Create microclimate' })
    await user.click(submitButton)

    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled()

    resolveSubmit()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create microclimate' })).not.toBeDisabled())
  })

  it('clears the form back to defaults after a successful submit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<MicroclimateForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('Title'), 'Weekly pulse')
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '2026-01-01T09:00' } })
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '2026-01-01T10:00' } })
    await user.click(screen.getByRole('button', { name: 'Create microclimate' }))

    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue(''))
    expect(screen.getByLabelText('Start time')).toHaveValue('')
    expect(screen.queryByPlaceholderText('Question text')).not.toBeInTheDocument()
  })

  it('surfaces the error and keeps the entered values when onSubmit rejects', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('Title already used'))
    render(<MicroclimateForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('Title'), 'Weekly pulse')
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '2026-01-01T09:00' } })
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '2026-01-01T10:00' } })
    await user.click(screen.getByRole('button', { name: 'Create microclimate' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Title already used')
    expect(screen.getByLabelText('Title')).toHaveValue('Weekly pulse')
    expect(screen.getByRole('button', { name: 'Create microclimate' })).not.toBeDisabled()
  })

  it('falls back to a generic error message when the rejection is not an Error', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue('boom')
    render(<MicroclimateForm onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('Title'), 'Weekly pulse')
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '2026-01-01T09:00' } })
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '2026-01-01T10:00' } })
    await user.click(screen.getByRole('button', { name: 'Create microclimate' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed')
  })
})
