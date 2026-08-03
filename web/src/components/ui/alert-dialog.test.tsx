import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog'
import { Button } from './button'

afterEach(cleanup)

function Example({ onConfirm }: { onConfirm?: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button>Delete</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Confirm</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

describe('AlertDialog', () => {
  it('uses the alertdialog role, not dialog', async () => {
    render(<Example />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    // The distinct role is what tells a screen reader this needs an answer.
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
  })

  it('has no close button — it must be answered', async () => {
    render(<Example />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await screen.findByRole('alertdialog')
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })

  it('confirms and closes', async () => {
    const onConfirm = vi.fn()
    render(<Example onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await screen.findByRole('alertdialog')

    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('cancels without confirming', async () => {
    const onConfirm = vi.fn()
    render(<Example onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await screen.findByRole('alertdialog')

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('restores focus to the trigger on close', async () => {
    render(<Example />)
    const trigger = screen.getByRole('button', { name: 'Delete' })
    await userEvent.click(trigger)
    await screen.findByRole('alertdialog')

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })
})
