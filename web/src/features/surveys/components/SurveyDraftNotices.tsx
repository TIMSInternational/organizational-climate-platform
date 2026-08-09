import { AlertCircle, Check, CloudOff, RotateCcw } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { Alert, AlertDescription, AlertTitle, Button, LiveRegion } from '../../../components/ui'
import type { SurveyDraftRecovery, SurveyDraftState } from '../useSurveyDraft'

/**
 * How the survey wizard tells you whether your work is being kept (#266).
 *
 * ## Why the failures are alerts and the successes are a line of text
 *
 * "Saved" is reassurance: it should be findable when looked for and invisible the rest
 * of the time. "Not saved" is the opposite — the whole reason #266 asks for the state to
 * be surfaced is that an autosave which has quietly stopped is worse than no autosave at
 * all, because it buys trust it is no longer earning. So the two failure states get a
 * full `role="alert"` panel that stays until something succeeds, and the healthy ones
 * get one muted line.
 *
 * The healthy line still lives in a `LiveRegion`, so a screen-reader user is told the
 * draft saved without having to go looking for a passage of text that changed.
 *
 * ## Both themes
 *
 * Every colour is a token — `text-fg-secondary`, `text-accent-green`, and the `warning`
 * and `destructive` Alert variants, whose soft fills are already contrast-checked in
 * light and dark.
 */

export interface SurveyDraftIndicatorProps {
  state: SurveyDraftState
  /** Display locale, for the saved-at time. */
  locale: string
  onSaveAnyway: () => void
}

function savedAtLabel(savedAt: string | null, locale: string): string | null {
  if (savedAt === null) return null
  const when = new Date(savedAt)
  return Number.isNaN(when.getTime()) ? null : when.toLocaleTimeString(locale)
}

export function SurveyDraftIndicator({ state, locale, onSaveAnyway }: SurveyDraftIndicatorProps) {
  const { t } = useTranslation()
  const time = savedAtLabel(state.savedAt, locale)

  if (state.status === 'conflict') {
    return (
      <Alert variant="warning" role="alert" className="mb-panel-gap">
        <CloudOff aria-hidden="true" />
        <AlertTitle>{t('surveys.draftConflictTitle')}</AlertTitle>
        <AlertDescription>
          <span>{t('surveys.draftConflictBody')}</span>
          <span className="mt-inline block">
            <Button variant="outline" type="button" onClick={onSaveAnyway}>
              <RotateCcw aria-hidden="true" className="size-icon" />
              {t('surveys.draftSaveAnyway')}
            </Button>
          </span>
        </AlertDescription>
      </Alert>
    )
  }

  if (state.status === 'error') {
    return (
      <Alert variant="destructive" role="alert" className="mb-panel-gap">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>{t('surveys.draftErrorTitle')}</AlertTitle>
        <AlertDescription>
          {/* The server's own message names what it objected to; showing it beats
              replacing it with a guess. It is additional to, never instead of, the
              sentence that says the work is not being kept. */}
          <span>{t('surveys.draftErrorBody')}</span>
          {state.message !== null && (
            <span className="mt-inline block text-fg-secondary">{state.message}</span>
          )}
        </AlertDescription>
      </Alert>
    )
  }

  // `off` has nothing to report, and `idle` must say nothing rather than "Not saved yet":
  // rendering caught that sitting under the recovery banner on a form nobody had touched,
  // where it read as a warning about the draft being *offered*. There is no reassurance to
  // give before there is anything to save.
  if (state.status === 'off' || state.status === 'idle') return null

  const text =
    state.status === 'saving'
      ? t('surveys.draftSaving')
      : state.status === 'pending'
        ? t('surveys.draftPending')
        : time !== null
          ? t('surveys.draftSavedAt', { time })
          : t('surveys.draftSaved')

  return (
    <LiveRegion visible className="mb-panel-gap flex items-center gap-inline text-fg-secondary">
      {state.status === 'saved' && (
        <Check aria-hidden="true" className="size-icon text-accent-green" />
      )}
      <span>{text}</span>
    </LiveRegion>
  )
}

export interface SurveyDraftRecoveryBannerProps {
  recovery: SurveyDraftRecovery
  locale: string
  onRestore: () => void
  onDiscard: () => void
  onDismiss: () => void
}

/**
 * The offer to pick up an unfinished survey.
 *
 * Three actions, and none of them is destructive by default. "Not now" exists because
 * the alternative is a banner whose only exits are "take it" and "delete it", which
 * turns a moment of indecision into lost work. The draft expires on its own.
 */
export function SurveyDraftRecoveryBanner({
  recovery,
  locale,
  onRestore,
  onDiscard,
  onDismiss,
}: SurveyDraftRecoveryBannerProps) {
  const { t } = useTranslation()
  const title = recovery.draft.title?.trim()
  const edited = new Date(recovery.draft.updatedAt)
  const when = Number.isNaN(edited.getTime()) ? null : edited.toLocaleString(locale)

  return (
    <Alert variant="info" role="region" aria-label={t('surveys.draftRecoveryTitle')} className="mb-panel-gap">
      <RotateCcw aria-hidden="true" />
      <AlertTitle>{t('surveys.draftRecoveryTitle')}</AlertTitle>
      <AlertDescription>
        <span>
          {when === null
            ? t('surveys.draftRecoveryBodyUndated', {
                title: title && title.length > 0 ? title : t('surveys.draftUntitled'),
              })
            : t('surveys.draftRecoveryBody', {
                title: title && title.length > 0 ? title : t('surveys.draftUntitled'),
                when,
              })}
        </span>
        <span className="mt-inline flex flex-wrap gap-inline">
          <Button variant="primary" type="button" onClick={onRestore}>
            {t('surveys.draftRestore')}
          </Button>
          <Button variant="outline" type="button" onClick={onDismiss}>
            {t('surveys.draftNotNow')}
          </Button>
          <Button variant="outline" type="button" onClick={onDiscard}>
            {t('surveys.draftDiscard')}
          </Button>
        </span>
      </AlertDescription>
    </Alert>
  )
}
