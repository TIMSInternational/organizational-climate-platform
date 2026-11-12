import { ChevronDown, Lock, ShieldCheck } from 'lucide-react'
import { useTranslation } from '../../../i18n'

/**
 * The anonymity promise, stated precisely and in both directions.
 *
 * Telling someone a survey is anonymous is part of the consent, not decoration — and
 * the inverse matters just as much. A survey that records who answered must say so;
 * saying nothing lets a respondent assume the more private of the two.
 *
 * The wording tracks what the server actually does, and it was rewritten when
 * self-declared demographics shipped. An anonymous response is still written with no
 * user id, no IP address and no user agent -- that first sentence is a description of
 * the row and remains exact.
 *
 * Two clauses went, and both for the same reason. The copy used to promise that a
 * demographic whose cohort is too small "tampoco se registra" -- is not RECORDED --
 * which was true while every demographic came from a profile and passed
 * `SurveyResponsePrivacy.Filter`'s write-time cohort floor. A respondent who declares
 * their own area has no population to be counted against, so that floor cannot be
 * computed for them and the value IS recorded; the protection moves to read time, where
 * `SurveyResultsPrivacy.MinimumSegmentRespondents` withholds the segment. The sentence
 * now promises what is actually enforced: the GROUP is not reported.
 *
 * It also used to say nobody, not even an administrator, could trace a response back to
 * you. That was a claim about capability rather than about the row, and area plus tenure
 * plus sex on one row makes it thinner than it sounds. Ruled out rather than reworded:
 * the two sentences that remain are each checkable against a column or a threshold.
 *
 * ## The block (Apple design, Respond board, 12 Nov)
 *
 * One quiet card, first on the respond page and beside the task on Home: the card
 * surface with its hairline, a padlock in the blue tint, an uppercase label and one
 * paragraph. The label is the state word (`anonymousChip` / `identifiedChip`) and the
 * paragraph is the body, both unchanged — the copy of the promise is ruled, only the box
 * moved. The title (`anonymousTitle` / `identifiedTitle`) is kept as the block's heading
 * for assistive technology and the document outline, and is visually hidden.
 *
 * ## Why it is no longer green
 *
 * It used to be a soft green box with a green label. The Apple-design ruling (11 Nov)
 * gives green, amber and red to the three result areas and nothing else — a green panel
 * on the respond page reads as «Fortaleza». The board draws the promise as a plain card
 * row with the padlock in the tint, so that is what this is. The label is set in the
 * secondary ink on the card, which `respondContrast.test.ts` measures in both palettes.
 *
 * ## The state is carried by a word, never by the colour
 *
 * Both modes say «Anónima» (ruled 2026-10-16: every survey is anonymous to the client),
 * and the two are told apart by `data-anonymous` and by the body, never by a colour —
 * WCAG 1.4.1.
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
  recordsParticipation = false,
  intro = null,
}: {
  anonymous: boolean
  /**
   * The survey's own paragraph (`SurveyRespondView.respondentIntro`), in place of `anonymousBody`.
   * Eagle's corrections, 2026-10-20: a client words the promise for its own people, per survey,
   * and every other survey keeps the default. Ignored on an IDENTIFIED response, on purpose: an
   * author's prose must never be able to hide that names are kept. Only callers holding the
   * respond view pass it; Home has no survey text to pass and draws the default.
   */
  intro?: string | null
  /**
   * The respondent is asked their name and email (`asksParticipantIdentity`). The anonymous
   * body stays true word for word — the response row still holds no name, account, IP or
   * browser — but it no longer says everything that is kept, so a second sentence says the
   * rest: that they answered is recorded, apart from what they answered. Only the respond
   * form passes it, and only when the server said it asks: the invitation card and Home have
   * no respondent with no account to describe.
   */
  recordsParticipation?: boolean
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

  const frame = 'rounded-xl border border-line-panel bg-surface-card'
  const box = `${frame} px-4 py-3.5`
  const glyph = anonymous ? (
    <Lock aria-hidden="true" className="mt-px size-icon shrink-0 text-accent-blue-ink" />
  ) : (
    <ShieldCheck aria-hidden="true" className="mt-px size-icon shrink-0 text-accent-blue-ink" />
  )
  const label = (
    <span
      data-slot="anonymity-label"
      className="text-2xs font-semibold uppercase tracking-eyebrow text-fg-secondary"
    >
      {anonymous ? t('anonymousChip') : t('identifiedChip')}
    </span>
  )
  const heading = <h2 className="sr-only">{anonymous ? t('anonymousTitle') : t('identifiedTitle')}</h2>
  const body = (
    <>
      {/* `whitespace-pre-line`: an author's own paragraph may carry line breaks. */}
      <p className="m-0 whitespace-pre-line text-respond text-fg-secondary">
        {anonymous ? (intro?.trim() ? intro : t('anonymousBody')) : t('identifiedBody')}
      </p>
      {anonymous && recordsParticipation ? (
        <p data-slot="participation-promise" className="m-0 mt-1 text-respond text-fg-secondary">
          {t('participationBody')}
        </p>
      ) : null}
    </>
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
      <details data-slot="anonymity-notice" data-anonymous={anonymous} className={`group ${frame}`}>
        {/* The padding is on the summary, not the box, so the whole 44px row is the tap
            target (HIG › Accessibility: hit targets of at least 44pt). */}
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 rounded-xl px-4 py-2.5 [&::-webkit-details-marker]:hidden">
          {glyph}
          {label}
          <ChevronDown
            aria-hidden="true"
            className="ml-auto size-icon shrink-0 text-fg-secondary transition-transform group-open:rotate-180"
          />
        </summary>
        {/* Indented past the glyph so the sentence lands under the state word, exactly
            where it sits in the open block above. `gap-2.5` is the summary's own gap. */}
        <div className="flex min-w-0 flex-col gap-0.5 pb-3.5 pl-[calc(var(--admin-size-icon)+calc(var(--spacing)*6.5))] pr-4">
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
