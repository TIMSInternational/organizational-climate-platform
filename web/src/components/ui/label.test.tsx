import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Label } from './label'

afterEach(cleanup)

describe('Label', () => {
  it('focuses its control when clicked', async () => {
    render(
      <>
        <Label htmlFor="name">Name</Label>
        <input id="name" />
      </>,
    )
    await userEvent.click(screen.getByText('Name'))
    expect(document.activeElement).toBe(screen.getByRole('textbox'))
  })

  it('names its control for assistive tech', () => {
    render(
      <>
        <Label htmlFor="name">Name</Label>
        <input id="name" />
      </>,
    )
    expect(screen.getByLabelText('Name')).toBeTruthy()
  })

  it('drops the form-row margin the bare label element carries', () => {
    // index.css makes a bare <label> a stacked row; this primitive sits inline.
    render(<Label>Name</Label>)
    expect(screen.getByText('Name').className).toContain('mb-0')
  })
})
