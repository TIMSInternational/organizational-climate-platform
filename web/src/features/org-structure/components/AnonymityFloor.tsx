import { Lock } from 'lucide-react'
import { ANONYMITY_FLOOR } from '../../../components/charts'
import { useTranslation } from '../../../i18n'

/**
 * The anonymity floor, on the one screen that is about settings.
 *
 * ## Why the control is locked rather than absent, or editable-and-ignored
 *
 * This is the product's central promise made visible: no result computed from
 * fewer than `ANONYMITY_FLOOR` responses is shown to anybody, including the
 * account owner. There were three ways to render that and two of them are wrong.
 *
 * - **Leave it off the page.** Then the promise is a sentence in a sales deck. An
 *   HR buyer's whole question is "who can un-set this?", and a settings screen
 *   that does not mention it answers "we would rather not say".
 * - **Render an editable field.** Nothing on the API can store a different floor
 *   (`CompanySettingsDto` has no such member — checked), so the control would
 *   accept a number, appear to save, and change nothing. A promise that silently
 *   ignores you is worse than no control at all.
 * - **Render it locked, and say why.** Which is this: the number, the word
 *   *Locked*, and a sentence stating both directions — raising is allowed,
 *   lowering is refused.
 *
 * ## The number is not written twice
 *
 * `ANONYMITY_FLOOR` is the same constant `isSuppressed` and `ProtectedCell`
 * default to, so the figure this page promises is provably the figure the
 * suppression code applies. A literal `5` here would be a promise nothing
 * enforces the moment the predicate's default moved.
 */
export function AnonymityFloorReading() {
  const { t } = useTranslation()

  return (
    <div className="grid gap-1">
      <span className="text-xs font-semibold text-fg-secondary">
        {t('companySettings.anonymityFloor')}
      </span>
      {/* `min-h-control-lg` rather than a hard `h-control-lg`, matching
          `SettingReadout` on the page that renders this. Three pieces of copy
          share the row — the figure, its unit and the word `Locked` — and two
          of the three are translated. Measured in a browser, the row does not
          in fact wrap today: in Spanish at 420, 390, 360, 320, 300 and 280px,
          and in English at 390 and 1440px, the content stays one 19.5px line
          inside the 32px box. A fixed height is
          still the wrong container for it, because the moment it does wrap the
          second line is painted through the bottom border rather than growing
          the box — which is exactly what `SettingReadout` was doing with a
          36-character email domain. `min-h` + `py-1` is a measured no-op here —
          32px stays 32px at every width tested — and stops being one only in
          the case it exists for. `flex-wrap` is deliberately *not* added with
          it: tried, and it made the row break onto two lines at 280px where it
          had been fitting on one, which is a change to a screen that was not
          broken. */}
      <div className="flex min-h-control-lg items-center gap-inline rounded-md border border-line-default bg-surface-input px-3 py-1">
        {/* The reading, in mono with tabular figures, like every other number in
            the product. */}
        <span className="font-mono font-semibold tabular-nums">{ANONYMITY_FLOOR}</span>
        <span className="text-fg-secondary">{t('companySettings.responsesUnit')}</span>
        {/* The padlock never carries the state on its own: the word `Locked` is
            beside it, so the control still reads as locked without colour or
            iconography (WCAG 1.4.1). */}
        <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-fg-secondary">
          <Lock aria-hidden="true" className="size-3" />
          {t('companySettings.locked')}
        </span>
      </div>
      <span className="text-xs text-fg-secondary">
        {t('companySettings.floorLockedHint', { threshold: ANONYMITY_FLOOR })}
      </span>
    </div>
  )
}

/** The paragraph that states the rule in both directions. */
export function AnonymityFloorNotice() {
  const { t } = useTranslation()

  return (
    <div className="flex gap-panel-gap rounded-lg border border-line-light bg-surface-icon-box p-card">
      <span className="flex size-icon-box shrink-0 items-center justify-center rounded-md bg-accent-blue-soft text-accent-blue">
        <Lock aria-hidden="true" className="size-icon" />
      </span>
      <div className="min-w-0">
        <b className="text-lg font-semibold">{t('companySettings.floorCannotBeLowered')}</b>
        <p className="mb-0 mt-1 max-w-prose text-fg-secondary">
          {t('companySettings.floorExplanation', { threshold: ANONYMITY_FLOOR })}
        </p>
      </div>
    </div>
  )
}
