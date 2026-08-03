import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SuccessDialog } from './success-dialog'

afterEach(cleanup)

describe('SuccessDialog', () => {
  it('shows the copy it is given', async () => {
    render(
      <SuccessDialog
        open
        onOpenChange={vi.fn()}
        title="Company created"
        description="It is ready to use."
        dismissText="Done"
      />,
    )
    expect(await screen.findByText('Company created')).toBeTruthy()
    expect(screen.getByText('It is ready to use.')).toBeTruthy()
  })

  it('dismisses through onOpenChange', async () => {
    const onOpenChange = vi.fn()
    render(
      <SuccessDialog
        open
        onOpenChange={onOpenChange}
        title="Company created"
        description="It is ready to use."
        dismissText="Done"
      />,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Done' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders nothing while closed', () => {
    render(
      <SuccessDialog
        open={false}
        onOpenChange={vi.fn()}
        title="Company created"
        description="It is ready to use."
        dismissText="Done"
      />,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
