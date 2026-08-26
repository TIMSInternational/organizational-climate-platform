import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input, Label } from './index'
import { RADIX_FOCUS_TRAP_NODES } from '../../test/a11y'

/**
 * The behaviour `test/a11y.ts`'s `RADIX_FOCUS_TRAP_NODES` exclusion assumes (#83).
 *
 * axe's `aria-hidden-focus` rule fires on every open Radix overlay in this app,
 * on two nodes: the `[data-radix-focus-guard]` sentinels, which are focusable *on
 * purpose* so they can catch a Tab leaving the dialog, and `[data-aria-hidden]` —
 * the page behind the modal, which Radix correctly removes from the accessibility
 * tree while still containing focusable elements. Neither is a defect; there is no
 * spelling of a modal that satisfies both halves of that rule at once.
 *
 * So the harness excludes those two selectors. **This file is the price of that
 * exclusion.** An exclusion justified by "the focus trap makes the background
 * unreachable" is worth nothing unless the trap is tested, so Tab and Shift+Tab
 * are driven all the way round an open dialog here and focus is required to stay
 * inside it. If Radix ever stops trapping, this goes red rather than the sweep
 * going quietly green over a modal a keyboard user can fall out of.
 *
 * WCAG 2.1.2 (No Keyboard Trap) is satisfied by Escape, which is asserted last:
 * the point of a modal is that focus cannot *wander* out, not that it cannot
 * leave.
 */

afterEach(cleanup)

function TrappedDialog() {
  return (
    <>
      {/* The page behind the modal. Radix marks its wrapper `aria-hidden` while the
          dialog is open; a keyboard user must not be able to reach these. */}
      <Button>Fondo primero</Button>
      <Dialog>
        <DialogTrigger asChild>
          <Button>Abrir</Button>
        </DialogTrigger>
        <DialogContent closeLabel="Cerrar">
          <DialogHeader>
            <DialogTitle>Registrar avance</DialogTitle>
          </DialogHeader>
          <Label htmlFor="avance">Porcentaje</Label>
          <Input id="avance" defaultValue="40" />
          <DialogFooter>
            <Button>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Button>Fondo último</Button>
    </>
  )
}

/** Everything a keyboard user must not reach while the dialog owns the screen. */
const BACKGROUND = ['Fondo primero', 'Abrir', 'Fondo último']

function focusedName(): string {
  const active = document.activeElement as HTMLElement | null
  return active?.textContent?.trim() || active?.getAttribute('aria-label') || active?.id || 'none'
}

describe('an open dialog traps focus', () => {
  it('keeps Tab inside the dialog all the way round', async () => {
    render(<TrappedDialog />)
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    const dialog = await screen.findByRole('dialog')

    // Twice round the dialog's own controls (close, input, save) with slack, so a
    // trap that leaks only on the wrap-around is caught rather than a trap that
    // merely holds for the first few presses.
    const seen: string[] = []
    for (let press = 0; press < 12; press += 1) {
      await userEvent.tab()
      seen.push(focusedName())
      expect(
        dialog.contains(document.activeElement),
        `Tab ${press + 1} left the dialog and landed on ${focusedName()}`,
      ).toBe(true)
    }

    // The vacuity control for the loop above: a trap that focused nothing at all
    // would satisfy `dialog.contains(document.body)`… it would not, but a trap
    // that parked focus on one node forever would satisfy every assertion while
    // proving nothing about a wrap-around. Tab must actually move.
    expect(new Set(seen).size).toBeGreaterThan(1)
    for (const name of BACKGROUND) expect(seen).not.toContain(name)
  })

  it('keeps Shift+Tab inside the dialog too', async () => {
    render(<TrappedDialog />)
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    const dialog = await screen.findByRole('dialog')

    for (let press = 0; press < 6; press += 1) {
      await userEvent.tab({ shift: true })
      expect(
        dialog.contains(document.activeElement),
        `Shift+Tab ${press + 1} left the dialog and landed on ${focusedName()}`,
      ).toBe(true)
    }
  })

  it('is not a keyboard trap — Escape closes it and the page comes back', async () => {
    render(<TrappedDialog />)
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    await screen.findByRole('dialog')

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()

    // And the background is reachable again, which is the other half of 2.1.2.
    await userEvent.tab()
    expect(document.querySelectorAll('[data-aria-hidden]')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Fondo primero' })).toBeTruthy()
  })

  it('the two excluded selectors are the ones Radix actually emits', async () => {
    // The vacuity control for the exclusion itself. If Radix renamed either
    // attribute the harness would be excluding nothing, `aria-hidden-focus` would
    // start firing across the sweep, and the next person would have no way to tell
    // a real regression from a renamed internal. Assert both selectors match
    // something on an open dialog.
    render(<TrappedDialog />)
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    await screen.findByRole('dialog')

    for (const selector of RADIX_FOCUS_TRAP_NODES) {
      expect(
        document.querySelectorAll(selector).length,
        `${selector} matched nothing on an open dialog — the axe exclusion is stale`,
      ).toBeGreaterThan(0)
    }
  })
})
