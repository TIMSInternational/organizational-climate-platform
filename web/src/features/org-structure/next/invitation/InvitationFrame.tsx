import type { ReactNode } from 'react'
import { LanguageSwitcher } from '../../../../i18n'
import { BrandLockup, ThemeSwitcher } from '../../../../components/layout'
import { SkipLink } from '../../../../components/ui'

/**
 * The frame the AcceptInvitation artboard draws (10 Sep): a full-bleed strip carrying the
 * lockup on the left edge and the language and theme chips on the right, over one centred
 * column.
 *
 * ## Why this is not `RespondShell`
 *
 * It is the same strip, and the respond pages are where it came from — but `RespondShell`
 * caps its header at the column's own width, deliberately, "so on a wide screen the lockup
 * sits over the questions rather than stranded at the window's edge". That is right for a
 * surface the canvas draws as a 390px phone, where the cap never binds and the lockup IS at
 * the edge. This artboard is 1440 wide and draws the strip full width with the lockup at
 * the left margin, so on a desktop the two disagree — measured: at 1440 the lockup rendered
 * centred over the card, 668px in.
 *
 * ## Why it is not `AuthShell` either
 *
 * `AuthShell`'s admin variant floats the brand centred *above* the card and puts the two
 * switchers *below* it. Neither is what this artboard draws.
 *
 * It is local to this lane rather than added to `components/layout` because one screen
 * needs it. When the rest of the unauthenticated pages are drawn from their own artboards —
 * Login, Register, AuthError, AccountInactive, AuthTransition all have one — this and
 * whatever they build should become the same component, in `components/layout`, and this
 * file should go.
 */
export function InvitationFrame({
  skipLabel,
  contentId = 'invitation',
  children,
}: {
  /** Already-translated label for the skip link. */
  skipLabel: string
  contentId?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-outer">
      {/* First focusable thing on the page, so a keyboard user is not made to Tab through
          the language and theme pickers on the way to the form. */}
      <SkipLink href={`#${contentId}`}>{skipLabel}</SkipLink>

      {/* Transparent and unruled, like the shell's own top strip: the card below is the
          only surface, and a filled bar here would read as a second one with a seam between
          them. 16px in from the edge and 14px down, as the artboard sets it. */}
      <header className="flex w-full flex-wrap items-center justify-between gap-inline px-4 py-3.5">
        <BrandLockup size="compact" />
        <span className="flex flex-wrap items-center gap-1.5">
          <LanguageSwitcher variant="chip" />
          <ThemeSwitcher variant="chip" />
        </span>
      </header>

      <main
        id={contentId}
        // `max-w-invitation-card` does not exist and should not: 28rem is the artboard's
        // 440px card plus the 16px gutter either side of it, and this is the only screen
        // drawn at that measure. `flex flex-col` so a short state — a dead invitation — is
        // a card at the top of the column rather than a stub stranded mid-page.
        className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 pb-6 pt-2"
      >
        {children}
      </main>
    </div>
  )
}
