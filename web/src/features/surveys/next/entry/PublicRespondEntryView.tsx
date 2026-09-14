import { useTranslation } from '../../../../i18n'
import { RespondCaption, RespondReading } from '../../../../components/layout'
import { Button, CanvasArrowRightIcon } from '../../../../components/ui'
import { calendarDay } from '../../../../lib/calendarDay'
import { AnonymityNotice } from '../../components/SurveyRespondForm'
import type { SurveyRespondView } from '../../api/surveyResponses'
import { entryPace } from './derive'

export interface PublicRespondEntryViewProps {
  view: SurveyRespondView
  locale: string
  onBegin: () => void
}

/**
 * `/s/:token`, before the first question — the PublicRespondEntry artboard (10 Sep).
 *
 * ## What it says, in the order it says it
 *
 * The eyebrow, the survey's own name, and one line for how long this will take. Then
 * the two readings the artboard draws — when it closes, how many questions — then the
 * promise about what is and is not stored, then the one action, then the sentence that
 * tells the respondent what the next screen looks like.
 *
 * ## Why there is a card in front of the questions at all
 *
 * There was not one before: `/s/:token` resolved its token and mounted the form. That
 * is defensible for a link handed to a whole company, and it is what made the seam this
 * lane exists to close — a respondent arriving from a printed QR code went from a
 * browser address bar straight into question 1 of 6, with the close date, the length
 * and the anonymity promise all arriving at once above it. The artboard splits that
 * into a page that answers "what is this, can it come back to me, how long" and a page
 * that asks a question.
 *
 * ## Every part of it is a shared piece
 *
 * `RespondCaption` and `RespondReading` are `RespondShell`'s own, and `AnonymityNotice`
 * is the block the form opens on and the employee's Home draws beside the task. Nothing
 * here is a second implementation of any of them, which is what makes the handover
 * continuous rather than merely similar: the caption on this page and the caption on
 * `/survey-invitations/:token` are the same component, and the promise the respondent
 * reads here is character for character the one the next screen repeats.
 */
export function PublicRespondEntryView({ view, locale, onBegin }: PublicRespondEntryViewProps) {
  const { t } = useTranslation('surveyRespond')

  const count = view.questions.length
  const pace = entryPace(count)

  return (
    <>
      {/* The pace line rather than the author's description, deliberately — see
          `entryPace`. The description is the survey's subject and the form prints it
          over the first question; this line is what the respondent is about to be
          asked to do, which is the question this screen exists to answer. */}
      <RespondCaption
        eyebrow={t('eyebrow')}
        title={view.title ?? t('untitledSurvey')}
        description={t(pace.key, pace.params)}
      />

      {/* Two across at 390px, as the artboard draws them: both readings are short
          (`10 oct`, `6`) and stacking them would push the promise below the fold on a
          phone. `grid-cols-2` is `repeat(2, minmax(0, 1fr))`, so neither can widen the
          page — the sideways overflow a sibling lane shipped. */}
      <section aria-label={t('panelLabel')} className="grid grid-cols-2 gap-panel-gap">
        {/* `calendarDay`, because a close date is a calendar day stamped at UTC
            midnight: read in the reader's own zone it is the day before for the whole
            of Costa Rica. */}
        <RespondReading
          label={t('closesReading')}
          value={calendarDay(Date.parse(view.endDate), locale)}
        />
        <RespondReading label={t('questionsReading')} value={String(count)} />
      </section>

      {/* `view.anonymous` — `Survey.Settings.Anonymous`, the flag the server writes the
          response under. Never the link payload's `allowAnonymous`, which is the
          distribution's access rule and answers a different question entirely. */}
      <AnonymityNotice anonymous={view.anonymous} />

      <Button
        type="button"
        variant="primary"
        onClick={onBegin}
        data-slot="entry-begin"
        className="h-11 w-full"
      >
        {t('next.entryStart')}
        <CanvasArrowRightIcon className="size-icon" />
      </Button>

      <p className="m-0 text-center text-sm text-fg-secondary">{t('next.entryAfter')}</p>

      {/* The artboard's floor line, pushed to the bottom of the column. It names the
          two things that are true of this visitor and of no other respondent in the
          product: they arrived on a link somebody shared, and they need no account.
          `mt-auto` works because `RespondSurface` is the flex column `RespondShell`'s
          `<main>` gives a `flex-1` to.

          `text-fg-secondary`, not the canvas's `#8a82a5`: `respondContrast.test.ts`
          measures `text-fg-tertiary` — the token that ink maps to — as failing AA on
          this page and bans it from the feature by name. Same call `AnonymityNotice`
          made about the canvas's green. */}
      <p className="m-0 mt-auto flex flex-wrap items-center justify-between gap-inline text-2xs text-fg-secondary">
        <span>{t('next.entryArrivedByLink')}</span>
        <span>{t('next.entryNoAccount')}</span>
      </p>
    </>
  )
}
