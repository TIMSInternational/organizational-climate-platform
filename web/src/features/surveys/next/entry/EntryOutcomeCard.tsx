import type { SVGProps } from 'react'
import { Link } from 'react-router'
import { useTranslation } from '../../../../i18n'
import {
  Button,
  Card,
  CanvasClockIcon,
  CanvasLinkIcon,
  CanvasLockIcon,
} from '../../../../components/ui'
import { outcomeLook, type EntryOutcome, type OutcomeGlyph } from './derive'

export interface EntryOutcomeCardProps {
  outcome: EntryOutcome
  /**
   * The server's own message, used only when `outcome.bodyKey` is null — i.e. when this
   * client has no sentence of its own for what came back. Empty when the response
   * carried none, in which case the generic error copy stands in.
   */
  serverMessage: string
}

/**
 * The card that stands in the entry's place when there is no survey to start.
 *
 * ## The artboard
 *
 * PublicRespondEntryStates (10 Sep) draws seven of these on one sheet and says what
 * they have in common: "Una frase por caso, en el lugar de la entrada. Ninguno ofrece
 * «Reintentar», porque reintentar no cambia la respuesta; el último pide iniciar
 * sesión." So: a white card on the ground, a 32px tinted tile with one glyph, a
 * 14px semibold line, one 12px paragraph under it, and no control at all except the
 * sign-in on the last.
 *
 * The uppercase caption over each card on that sheet — "ENLACE DIRECTO · ENCUESTA
 * CERRADA", "INVITACIÓN PERSONAL · ANULADA" — is the sheet naming its own variants, the
 * way the sheet's own eyebrow and "Otros estados de la entrada" heading are. Exactly
 * one of these ever renders, at which point a caption classifying it would be the page
 * explaining its own taxonomy to somebody who just wants to know what to do.
 *
 * ## Why it replaced the `Alert`
 *
 * This was an amber (or green) `Alert` box. The respond flow it stands in front of is
 * cards on the ground — `RespondSurface` dropped its own panel for exactly that reason
 * — so an alert box here was the one screen in the flow with a different surface under
 * its text, and it was the *first* screen a failed respondent saw. One shape, either
 * side of the seam.
 *
 * ## Why there is still no retry and no link into the app
 *
 * Unchanged from the component this replaces, and restated because the redesign is the
 * moment somebody adds a button: nothing here is retryable — a revoked token stays
 * revoked and a wrong one is wrong on the next click — and the visitor may have no
 * account at all, so a link into the app would meet them with `RequireAuth` and a
 * sign-in form they did not ask for. The one exception is the outcome whose answer
 * genuinely is signing in, and `derive.ts` decides that, not this file.
 */
export function EntryOutcomeCard({ outcome, serverMessage }: EntryOutcomeCardProps) {
  const { t } = useTranslation('surveyRespond')
  const { t: tRoot } = useTranslation()

  const success = outcome.tone === 'success'
  const look = outcomeLook(outcome.titleKey, outcome.tone)
  const description =
    outcome.bodyKey === null ? serverMessage || tRoot('errors.generic') : t(outcome.bodyKey)

  return (
    <Card
      data-slot="entry-outcome"
      data-outcome={outcome.titleKey}
      // `alert` interrupts, `status` waits its turn. A dead link is the reason the page
      // exists and the respondent needs it now; an already-answered survey is a
      // confirmation — the same rule the respond form applies to those two cases.
      role={success ? 'status' : 'alert'}
      className="gap-panel-gap px-4 pb-4 pt-3.5"
    >
      <div className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-3">
        <span
          aria-hidden="true"
          data-slot="outcome-tile"
          className={`grid size-8 shrink-0 place-items-center rounded-lg ${TILE[look.tile]}`}
        >
          <OutcomeGlyphIcon glyph={look.glyph} className="size-icon" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          {/* The page's only heading when this card is what the page is, so it is an
              `<h1>` — a level, not a size. `font-sans` and the weight are both
              load-bearing: `index.css` gives every bare `h1` the storefront display
              serif at weight 400 and 24px, which is right for a page title and wrong
              for a 14px line inside a card — it rendered as decoration, measured on the
              first shot of this card. `SurveyRespondForm`'s own `<h1>` carries
              `font-sans` for the same reason. `text-lg` is this scale's 14px, which is
              what the artboard sets. */}
          <h1 className="m-0 font-sans text-lg font-semibold leading-snug text-fg-primary">
            {t(outcome.titleKey)}
          </h1>
          <p className="m-0 text-sm text-fg-secondary">{description}</p>
        </div>
      </div>

      {outcome.signIn && (
        // The artboard's full-width primary control. `asChild` because this is
        // navigation and has to be a link — `index.css` cards a bare `<button>` and a
        // button that navigates is unreachable to anyone browsing by links.
        <Button asChild variant="primary" className="h-11 w-full">
          <Link to="/login">{t('signIn')}</Link>
        </Button>
      )}
    </Card>
  )
}

/**
 * The tile fills, as the artboard tints them: the plain recessed tile for an outcome
 * nobody did anything wrong in, amber for one that needs attention, green for the one
 * that is not a failure at all.
 *
 * The glyph is `aria-hidden` and the sentence beside it carries the whole meaning, so
 * no state here is told by colour alone (WCAG 1.4.1). As non-text content the inks need
 * 3:1 rather than 4.5:1 (1.4.11), which is why `accent-green-ink` is usable here and is
 * not for the 10px label in `AnonymityNotice`.
 */
const TILE: Readonly<Record<string, string>> = {
  neutral: 'bg-surface-icon-box text-fg-secondary',
  warning: 'bg-accent-amber-soft text-accent-amber-ink',
  good: 'bg-accent-green-soft text-accent-green-ink',
}

/**
 * The artboard's own glyphs, in its own 16-unit box at its own 1.8 stroke.
 *
 * Three of the seven already exist as shared canvas glyphs; the four that do not are
 * drawn here from the artboard's source paths rather than substituted from lucide,
 * which draws in a 24-unit box and would set a visibly lighter line beside the three
 * that stayed.
 */
function OutcomeGlyphIcon({ glyph, ...props }: { glyph: OutcomeGlyph } & SVGProps<SVGSVGElement>) {
  switch (glyph) {
    case 'link':
      return <CanvasLinkIcon strokeWidth={1.8} {...props} />
    case 'clock':
      return <CanvasClockIcon strokeWidth={1.8} {...props} />
    case 'lock':
      return <CanvasLockIcon strokeWidth={1.8} {...props} />
    case 'calendar':
      return (
        <EntryGlyph {...props}>
          <rect x="2" y="3" width="12" height="11" rx="1.5" />
          <path d="M2 7h12M5 2v2M11 2v2" />
        </EntryGlyph>
      )
    case 'alert':
      return (
        <EntryGlyph {...props}>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5v3.5M8 11h.01" />
        </EntryGlyph>
      )
    case 'search':
      return (
        <EntryGlyph {...props}>
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5L14 14" />
        </EntryGlyph>
      )
    case 'check':
      return (
        <EntryGlyph {...props}>
          <path d="M3 8.5l3 3 7-7" />
        </EntryGlyph>
      )
  }
}

function EntryGlyph({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}
