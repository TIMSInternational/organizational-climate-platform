import { ChevronDown, EyeOff, ShieldCheck } from 'lucide-react'
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
 * The anonymous label is green, as the canvas draws it, but not the canvas's `#0f7f4e`:
 * `respondContrast.test.ts` measures that ink at 4.31:1 on the soft green fill over the
 * respond page's ground — under AA for 10px text — and records it as rejected. The label
 * takes `text-chip-good-ink` (`#0e7246` light, `#4ade80` dark), the ink the product's own
 * green chip was measured onto, which the same file measures on this fill in both
 * palettes, over the page ground and over a card. The identified label stays in the secondary ink: there is no measured blue
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
export function AnonymityNotice({
  anonymous,
  collapsible = false,
}: {
  anonymous: boolean
  /**
   * Draw the promise collapsed behind a disclosure, open on demand.
   *
   * Only the respond form passes this, and only from the second question on — see the
   * note on the `<details>` branch below for why that is not a weakening of the block
   * and why the three other callers must never set it.
   */
  collapsible?: boolean
}) {
  const { t } = useTranslation('surveyRespond')

  const box = anonymous
    ? 'rounded-xl border border-accent-green-ring bg-accent-green-soft px-3.5 py-3'
    : 'rounded-xl border border-accent-blue-ring bg-accent-blue-soft px-3.5 py-3'
  const glyph = anonymous ? (
    <EyeOff aria-hidden="true" className="mt-px size-icon shrink-0 text-accent-green-ink" />
  ) : (
    <ShieldCheck aria-hidden="true" className="mt-px size-icon shrink-0 text-accent-blue" />
  )
  const label = (
    <span
      data-slot="anonymity-label"
      className={
        anonymous
          ? 'text-2xs font-bold uppercase tracking-label text-chip-good-ink'
          : 'text-2xs font-bold uppercase tracking-label text-fg-secondary'
      }
    >
      {anonymous ? t('anonymousChip') : t('identifiedChip')}
    </span>
  )
  const heading = <h2 className="sr-only">{anonymous ? t('anonymousTitle') : t('identifiedTitle')}</h2>
  const body = (
    <p className="m-0 text-sm text-fg-secondary">
      {anonymous ? t('anonymousBody') : t('identifiedBody')}
    </p>
  )

  /*
   * One question at a time costs the promise its room. Measured on the TIMS
   * instrument — 40 likert statements, Spanish, 390×844 — the open block is ~148px of
   * an 844px fold and the page comes to 938px, which puts Siguiente below the fold on
   * every question. Collapsed it is ~40px, and the screen fits.
   *
   * **The copy is not shortened, and that is the point.** This component's own rule is
   * that the promise is the same characters everywhere it is made, because two blocks
   * that both describe how a response is stored and disagree by a clause are worse
   * than one of them not existing. A one-line paraphrase would have been exactly that
   * second, shorter claim. A `<details>` keeps `anonymousBody` intact, in the DOM, on
   * every page — reachable by find-in-page and by a screen reader walking the
   * document, and one tap from the respondent's eye — and spends only the vertical
   * room, which is all that was ever the problem.
   *
   * Question 1 stays open: the promise is read **before the first answer**, which is
   * where the consent actually happens, and the three other callers draw it open for
   * the same reason — the invitation card and Home are each the first time a given
   * respondent sees it.
   *
   * A `<details>` and not a toggle button, for `ChartTable`'s reasons: no state, free
   * keyboard operation, and the content stays in the document. The summary's accessible
   * name is the state word itself, which is what a disclosure here should announce.
   */
  if (collapsible) {
    return (
      <details data-slot="anonymity-notice" data-anonymous={anonymous} className={`group ${box}`}>
        <summary className="flex cursor-pointer list-none items-center gap-2.5 [&::-webkit-details-marker]:hidden">
          {glyph}
          {label}
          <ChevronDown
            aria-hidden="true"
            className="ml-auto size-icon shrink-0 text-fg-secondary transition-transform group-open:rotate-180"
          />
        </summary>
        {/* Indented past the glyph so the sentence lands under the state word, exactly
            where it sits in the open block above. `gap-2.5` is the summary's own gap. */}
        <div className="mt-2 flex min-w-0 flex-col gap-0.5 pl-[calc(var(--admin-size-icon)+calc(var(--spacing)*2.5))]">
          {heading}
          {body}
        </div>
      </details>
    )
  }

  return (
    <section data-slot="anonymity-notice" data-anonymous={anonymous} className={`flex gap-2.5 ${box}`}>
      {glyph}
      <div className="flex min-w-0 flex-col gap-0.5">
        {heading}
        {label}
        {body}
      </div>
    </section>
  )
}
