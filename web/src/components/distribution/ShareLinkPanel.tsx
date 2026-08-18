import { useState } from 'react'
import { useTranslation } from '../../i18n'
import { Alert, AlertDescription, Badge, Button } from '../ui'

/**
 * The open share link for a survey: mint it, reveal it, replace it, kill it.
 *
 * ## Why this is masked by default and an invitation token is not shown at all
 *
 * Both are bearer credentials, but they are not the same kind of thing.
 *
 * An **invitation token** identifies one named employee. Whoever holds it can answer the
 * survey *as them*. Nothing an admin does requires seeing one, so no read DTO carries one
 * and no component here renders one — see `InvitationTable`.
 *
 * A **share link** names nobody and exists precisely to be handed out. An admin who
 * cannot see it cannot use the feature, so hiding it entirely would be theatre. What is
 * worth preventing is the accidental disclosure: the link sitting in plain sight while a
 * distribution page is screen-shared into a stand-up, pasted into a status report, or
 * captured in a screenshot filed against a ticket. So it is masked until asked for, and
 * revealing it is a deliberate act.
 *
 * The link is never auto-copied and never written anywhere on mount. `Regenerate` is
 * offered as the remedy when one does leak, next to the statement that regenerating
 * breaks the old link — because an admin who does not know that will not use it.
 *
 * ## Why this panel does not print its own title
 *
 * The distribution page wraps it in a `<section aria-labelledby>` whose `<h2>` carries
 * "Open share link", so a `SectionLabel` here rendered the same words a second time,
 * directly under the heading. The heading is the landmark and the accessible name; a
 * panel inside it names nothing.
 */
export interface ShareLinkPanelProps {
  /** The share link, or `null` when the survey is `tokenized` and none is minted. */
  publicLink: string | null
  onCreate: () => void
  onRegenerate: () => void
  onRevoke: () => void
  busy?: boolean
}

/**
 * A stable placeholder rather than the link with characters starred out. A mask that
 * preserves the length and shape of a 43-character token still leaks its length, and
 * partially-masked secrets have a habit of being reconstructed from two screenshots.
 */
const MASK = '••••••••••••••••••••'

export default function ShareLinkPanel({
  publicLink,
  onCreate,
  onRegenerate,
  onRevoke,
  busy = false,
}: ShareLinkPanelProps) {
  const { t } = useTranslation()
  // The link that was revealed, not a boolean. Revealing one link is consent to see *that*
  // link — carrying a `true` across a regeneration would put a freshly-minted credential
  // on screen unasked, at the exact moment an admin is most likely to be screen-sharing.
  // Deriving `revealed` by comparison resets it on a new link with no effect to forget.
  const [revealedLink, setRevealedLink] = useState<string | null>(null)
  const revealed = revealedLink !== null && revealedLink === publicLink

  if (publicLink === null) {
    return (
      <div className="flex flex-col gap-panel-gap">
        <p className="text-fg-secondary">{t('surveys.distribution.shareLinkNone')}</p>
        <div>
          <Button onClick={onCreate} disabled={busy}>
            {t('surveys.distribution.shareLinkCreate')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-panel-gap">
      <Alert variant="default">
        <AlertDescription>{t('surveys.distribution.shareLinkWarning')}</AlertDescription>
      </Alert>

      <p className="flex flex-wrap items-center gap-inline">
        <Badge variant="outline">
          {/* `data-slot` rather than a test id on the text: a test asserting the link is
              absent must be able to find the container even when the link is not in it. */}
          <span data-slot="share-link-value">{revealed ? publicLink : MASK}</span>
        </Badge>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRevealedLink(revealed ? null : publicLink)}
        >
          {revealed ? t('surveys.distribution.shareLinkHide') : t('surveys.distribution.shareLinkReveal')}
        </Button>
      </p>

      <div className="flex flex-wrap gap-inline">
        <Button variant="outline" onClick={onRegenerate} disabled={busy}>
          {t('surveys.distribution.shareLinkRegenerate')}
        </Button>
        <Button variant="outline" onClick={onRevoke} disabled={busy}>
          {t('surveys.distribution.shareLinkRevoke')}
        </Button>
      </div>
    </div>
  )
}
