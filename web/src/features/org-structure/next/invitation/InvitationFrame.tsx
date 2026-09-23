import type { ReactNode } from 'react'
import { AuthCanvas } from '../../../../auth/next/AuthCanvas'

/**
 * The invitation screen's frame — now `AuthCanvas`, which is what this file asked for.
 *
 * It used to build its own: a strip with the lockup and the two switchers over a centred
 * column, because when it was written the unauthenticated pages had no shared frame worth
 * joining. Its own comment set the condition — *"when the rest of the unauthenticated pages
 * are drawn from their own artboards … this and whatever they build should become the same
 * component, and this file should go."* They have been, so it has.
 *
 * What the reader gains: the stage. An invitation is first contact with this product, and
 * `cycle` is the slice that answers what someone is being asked to take part in — a
 * measurement per cycle, five-minute pulses between them, and a plan afterwards.
 *
 * What nobody loses: the skip link. `AuthCanvas` had none until this conversion needed one,
 * which is how a gap on seven other routes got found.
 *
 * The file stays, rather than every caller learning `AuthCanvas`, because the NAME is the
 * documentation: an invitation frame is a thing this lane has, and one indirection is
 * cheaper than the next reader wondering which stage variant an invitation takes.
 */
export function InvitationFrame({
  skipLabel,
  children,
}: {
  /** Already-translated label for the skip link. */
  skipLabel: string
  children: ReactNode
}) {
  return (
    <AuthCanvas stage="cycle" skipLabel={skipLabel}>
      {children}
    </AuthCanvas>
  )
}
