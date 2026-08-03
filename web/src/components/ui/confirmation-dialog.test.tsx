import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ConfirmationDialog } from './confirmation-dialog'

afterEach(cleanup)

function Harness({ onConfirm }: { onConfirm: () => void | Promise<void> }) {
  const [open, setOpen] = useState(true)
  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={setOpen}
      title="Delete company"
      description="This cannot be undone."
      confirmText="Delete"
      cancelText="Cancel"
      variant="destructive"
      onConfirm={onConfirm}
    />
  )
}

describe('ConfirmationDialog', () => {
  it('shows the copy it is given', async () => {
    render(<Harness onConfirm={vi.fn()} />)
    expect(await screen.findByText('Delete company')).toBeTruthy()
    expect(screen.getByText('This cannot be undone.')).toBeTruthy()
  })

  it('runs onConfirm and then closes', async () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    await userEvent.click(await screen.findByRole('button', { name: /Delete/ }))

    expect(onConfirm).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('stays open when onConfirm rejects, so the failure is not hidden', async () => {
    // The legacy version closed immediately and left the promise unobserved, so a
    // failed confirm looked identical to a successful one.
    const onConfirm = vi.fn().mockRejectedValue(new Error('403'))
    render(<Harness onConfirm={onConfirm} />)

    await userEvent.click(await screen.findByRole('button', { name: /Delete/ }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    expect(screen.queryByRole('alertdialog')).not.toBeNull()
  })

  it('waits for a slow onConfirm before closing', async () => {
    let release: () => void = () => {}
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    render(<Harness onConfirm={onConfirm} />)
    await userEvent.click(await screen.findByRole('button', { name: /Delete/ }))

    // Still open while in flight.
    expect(screen.queryByRole('alertdialog')).not.toBeNull()

    release()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('cancels without calling onConfirm', async () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
