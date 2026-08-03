import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { FormControl, FormDescription, FormItem, FormLabel, FormMessage } from './form'
import { useFormField } from './formContext'
import { Input } from './input'

afterEach(cleanup)

function Row({ invalid, error }: { invalid?: boolean; error?: string }) {
  return (
    <FormItem invalid={invalid}>
      <FormLabel>Company name</FormLabel>
      <FormControl>
        <Input />
      </FormControl>
      <FormDescription>As it appears on the invoice</FormDescription>
      <FormMessage>{error}</FormMessage>
    </FormItem>
  )
}

describe('FormItem wiring', () => {
  it('connects the label to the control', () => {
    render(<Row />)
    // getByLabelText only resolves if htmlFor/id actually match.
    expect(screen.getByLabelText('Company name')).toBeTruthy()
  })

  it('points the control at its description', () => {
    render(<Row />)
    const control = screen.getByLabelText('Company name')
    const describedBy = control.getAttribute('aria-describedby') ?? ''
    const description = screen.getByText('As it appears on the invoice')
    expect(describedBy.split(' ')).toContain(description.id)
  })

  it('leaves the control valid and unannotated by default', () => {
    render(<Row />)
    expect(screen.getByLabelText('Company name').getAttribute('aria-invalid')).toBeNull()
  })

  it('marks the control invalid and references the message when invalid', () => {
    render(<Row invalid error="Required" />)
    const control = screen.getByLabelText('Company name')
    expect(control.getAttribute('aria-invalid')).toBe('true')

    const message = screen.getByRole('alert')
    expect(message.textContent).toBe('Required')
    expect(control.getAttribute('aria-describedby')?.split(' ')).toContain(message.id)
  })

  it('renders nothing for an empty message, so an absent error is not an empty alert', () => {
    render(<Row invalid />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('gives each row its own ids', () => {
    render(
      <>
        <Row />
        <Row />
      </>,
    )
    const [first, second] = screen.getAllByLabelText('Company name')
    expect(first.id).not.toBe(second.id)
    expect(first.id).toBeTruthy()
  })

  it('throws when a part is used outside a FormItem', () => {
    function Orphan() {
      useFormField()
      return null
    }
    expect(() => render(<Orphan />)).toThrow(/must be used inside a FormItem/)
  })
})
