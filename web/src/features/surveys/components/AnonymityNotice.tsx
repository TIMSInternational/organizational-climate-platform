import { EyeOff, ShieldCheck } from 'lucide-react'
import { useTranslation } from '../../../i18n'

/**
 * The anonymity promise, stated precisely and in both directions.
 *
 * Telling someone a survey is anonymous is part of the consent, not decoration — and
 * the inverse matters just as much. A survey that records who answered must say so;
 * saying nothing lets a respondent assume the more private of the two.
 *
 * The wording tracks what the server actually does. An anonymous response is written
 * with no user id, no IP address and no user agent, and a demographic whose cohort is
 * too small is not recorded either, so "not linked to you" is a description of the
 * row rather than a promise about who looks at it.
 *
 * ## The canvas's block (RespondSurveyPhone, EmployeeDashboard, 10 Sep)
 *
 * One compact block, first on the respond page and beside the task on Home: a soft
 * green box with a hairline, the eye-off glyph, an uppercase label and one paragraph.
 * The label is the state word (`anonymousChip` / `identifiedChip`) and the paragraph is
 * the body, both unchanged — the lane that drew this ruled the copy of the promise
 * untouched, so only the box moved. The title (`anonymousTitle` / `identifiedTitle`)
 * is kept as the block's heading for assistive technology and the document outline,
 * and is visually hidden: the canvas draws no third line, and the label already says
 * the same thing in a word.
 *
 * ## The state is carried by a word, never by the colour
 *
 * Green means anonymous and blue means identified, but the label spells out which —
 * WCAG 1.4.1, and the same rule the rest of the redesign keeps.
 *
 * The anonymous label is inked `text-accent-green-ink` as the canvas draws it
 * (`#0f7f4e`), which `respondContrast.test.ts` measures on the soft green fill in both
 * palettes — unlike `text-accent-green`, the plain accent, which it measures at 3.49:1
 * and bans. The identified label stays in the secondary ink: there is no measured blue
 * ink for the soft blue fill.
 *
 * ## One component for every place the promise is made
 *
 * The respond form opens on it, `/survey-invitations/:token`'s landing card carries it
 * before the questions load, and the employee's Home puts it beside the survey it is
 * about. It has to be *this* promise, character for character, in all three: two blocks
 * that both claim to describe how a response is stored and disagree by a clause is
 * worse than one of them not existing.
 */
export function AnonymityNotice({ anonymous }: { anonymous: boolean }) {
  const { t } = useTranslation('surveyRespond')

  return (
    <section
      data-slot="anonymity-notice"
      data-anonymous={anonymous}
      className={
        anonymous
          ? 'flex gap-2.5 rounded-xl border border-accent-green-ring bg-accent-green-soft px-3.5 py-3'
          : 'flex gap-2.5 rounded-xl border border-accent-blue-ring bg-accent-blue-soft px-3.5 py-3'
      }
    >
      {anonymous ? (
        <EyeOff aria-hidden="true" className="mt-px size-icon shrink-0 text-accent-green-ink" />
      ) : (
        <ShieldCheck aria-hidden="true" className="mt-px size-icon shrink-0 text-accent-blue" />
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="sr-only">{anonymous ? t('anonymousTitle') : t('identifiedTitle')}</h2>
        <span
          data-slot="anonymity-label"
          className={
            anonymous
              ? 'text-2xs font-bold uppercase tracking-label text-accent-green-ink'
              : 'text-2xs font-bold uppercase tracking-label text-fg-secondary'
          }
        >
          {anonymous ? t('anonymousChip') : t('identifiedChip')}
        </span>
        <p className="m-0 text-sm text-fg-secondary">
          {anonymous ? t('anonymousBody') : t('identifiedBody')}
        </p>
      </div>
    </section>
  )
}
