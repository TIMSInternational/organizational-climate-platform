import { useState } from 'react'
import ShareLinkQr from '../../components/ShareLinkQr'
import { Button, H3 } from '../../../../components/ui'
import { useTranslation } from '../../../../i18n'
import { cn } from '../../../../lib/cn'
import { ShareLinkField, type ShareLinkAction } from './parts'

/**
 * The public link and its QR code, together, on screen, in one place.
 *
 * ## Why this exists
 *
 * Reaching the QR code used to take seven steps, three of them behind a menu and two more
 * behind nested disclosures: pick a company, open the survey, open Distribución, "Crear
 * enlace", "Opciones del enlace", "Código QR del enlace", "Mostrar código QR". Every one of
 * those is defensible on its own and the sum of them was not: a real client conversation
 * ended with the team believing the product could only send individual invitations, because
 * nobody found the link. A capability nobody can find is indistinguishable from a capability
 * that does not exist.
 *
 * So the link and the code are both rendered, by default, wherever an administrator is
 * plausibly trying to distribute a survey.
 *
 * ## The screen-share guard is kept, moved rather than removed
 *
 * The old default hid both because a camera can read a QR off a shared screen. That reasoning
 * is right and is why "Ocultar" sits on the link row and beside the code, and why this panel
 * says when to use it. What changed is which case pays: hiding by default charged every
 * administrator preparing a distribution alone, to protect the rarer one presenting to a room.
 *
 * The important half of the resolution is that **copying the link and downloading the PNG
 * display nothing**, so they stay available whether or not the code is on screen. "Use it" and
 * "show it" were the same gesture before; they are not the same risk.
 */
export default function SharePanel({
  publicLink,
  accessType,
  surveyId,
  requireLogin = false,
  onCreate,
  creating = false,
  stacked = false,
  actions = [],
  className,
}: {
  /** Site-relative `/s/<token>`, or null when the survey is invitation-only. */
  publicLink: string | null
  /** Only `public` carries a QR; `ShareLinkQr` enforces that a second time. */
  accessType?: string
  surveyId?: string
  /**
   * Whether the distribution demands a session. It selects which of the two true sentences
   * the reader gets, and it is NOT the survey's anonymity flag — the two disagreed in
   * production, which is its own defect.
   */
  requireLogin?: boolean
  /** Offered only where the caller can actually mint a link (`canAuthorSurveys`). */
  onCreate?: () => void
  creating?: boolean
  /**
   * Force the single-column layout instead of letting the QR sit beside the link from `md`.
   *
   * A viewport breakpoint is a lie inside a narrow column: the detail page renders this in a
   * right-hand rail that is ~20rem wide at every viewport where `md:` is true, so the row
   * layout would overflow it. The caller knows its own width; the media query does not.
   */
  stacked?: boolean
  /** Destructive link actions (replace, delete). The QR is NOT one of them any more: it is
   *  on the panel, so a menu item that opens it would be a second door to the same room. */
  actions?: ShareLinkAction[]
  className?: string
}) {
  const { t } = useTranslation()
  const share = (key: string) => t(`surveys.next.share.${key}`)
  const dist = (key: string) => t(`surveys.next.distribution.${key}`)
  const link = (key: string) => t(`surveys.next.shareLink.${key}`)
  // ONE switch for the address and the code together. Hiding the text while the QR stayed on
  // screen hid nothing — a camera reads the code, and the code is the address — so the
  // screen-share advice would have been false the moment it was followed. The children read
  // their initial state from props, so the key remounts them rather than adding a controlled
  // mode to each.
  const [shown, setShown] = useState(true)

  if (publicLink === null) {
    return (
      <div className={cn('flex flex-col gap-2', className)} data-slot="share-panel" data-testid="share-panel" data-state="no-link">
        <H3>{share('title')}</H3>
        <p className="m-0 text-sm text-fg-secondary">{dist('noLink')}</p>
        {onCreate && (
          <div>
            <Button type="button" variant="outline" disabled={creating} onClick={onCreate}>
              {dist('createLink')}
            </Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-panel-gap', className)} data-slot="share-panel" data-testid="share-panel" data-state="link">
      <H3>{share('title')}</H3>
      <div className={cn('flex flex-col gap-4', !stacked && 'md:flex-row md:items-start')}>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <ShareLinkField key={shown ? 'shown' : 'hidden'} link={publicLink} startRevealed={shown} actions={actions} />
            <Button type="button" variant="outline" size="sm" onClick={() => setShown(!shown)}>
              {shown ? link('hide') : link('reveal')}
            </Button>
          </div>
          <p className="m-0 text-sm text-fg-secondary">
            {requireLogin ? dist('linkHelpLogin') : dist('linkHelpOpen')}
          </p>
          {/* Secondary ink, not tertiary, and not a warning tile. It is advice for one
              situation rather than a problem with the page, so an alert would cry wolf on
              every visit — but `text-fg-tertiary` measures 3.90:1 on a card in light and is
              banned by name across this feature (`respondContrast.test.ts`). Hierarchy is not
              worth an AA failure; the sentence carries its own weight. */}
          <p className="m-0 text-sm text-fg-secondary">{share('screenShare')}</p>
        </div>
        {shown && (
        <ShareLinkQr
          publicLink={publicLink}
          accessType={accessType}
          surveyId={surveyId}
          defaultShown
          // Narrower than the component's own 20rem default: at 20rem the code dominated the
          // card and left the link column with ~400px of dead space. Measured on the rendered
          // screen, not reasoned about.
          // Chromeless on purpose: the component's own bordered panel read as a card inside
          // a card once it sat in this one. The code keeps its white plaque (the quiet zone
          // a scanner needs); everything around it is this panel's surface.
          className={cn('flex flex-col gap-2', stacked ? 'w-full' : 'md:w-[14rem] md:shrink-0')}
        />
        )}
      </div>
    </div>
  )
}
