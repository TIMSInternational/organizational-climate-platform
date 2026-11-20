import { useTranslation } from '../../../../i18n'
import { RespondCaption, RespondReading } from '../../../../components/layout'
import { Button, CanvasArrowRightIcon } from '../../../../components/ui'
import { instantDay } from '../../../../lib/calendarDay'
import { AnonymityNotice } from '../../components/SurveyRespondForm'
import { PrivacyNoticeLink } from '../../components/PrivacyNoticeLink'
import type { SurveyRespondView } from '../../api/surveyResponses'
import { textAlignOf } from '../../api/respondentContent'
import { clientText } from '../../clientText'
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
 * promise about what is and is not stored, then the one action, and nothing after it.
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
 * `/survey-invitations/:token` are the same component.
 *
 * ## The promise is made here, and only here
 *
 * «Anónima» is shown on this card and not repeated over the first question (PROCOMER,
 * 2026-11-18): `PublicSurveyLinkPage` hands the form `entryPromise`, and the form draws no
 * block of its own. That is sound only because this card draws it from the same respond
 * view, with the same three inputs, that the form would have used.
 */
export function PublicRespondEntryView({ view, locale, onBegin }: PublicRespondEntryViewProps) {
  // The client's words where the survey or its company wrote some, the catalogue's elsewhere
  // (`clientText`, docs/decisions/editable-respondent-content.md).
  const { t: catalogue } = useTranslation('surveyRespond')
  const { t } = clientText(view, locale, catalogue)

  const count = view.questions.length
  const pace = entryPace(count, view.estimatedMinutes)

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
        align={textAlignOf(view.content)}
      />

      {/* Two across at 390px, as the artboard draws them: both readings are short
          (`10 oct`, `6`) and stacking them would push the promise below the fold on a
          phone. `grid-cols-2` is `repeat(2, minmax(0, 1fr))`, so neither can widen the
          page — the sideways overflow a sibling lane shipped. */}
      <section aria-label={t('panelLabel')} className="grid grid-cols-2 gap-panel-gap">
        {/* `instantDay`, in the reader's own zone: the survey stops taking answers at
            the instant `endDate` names, and read in UTC a close at or after 18:00 in
            Costa Rica printed as the next day (audit 2026-10-22, R2). */}
        <RespondReading
          label={t('closesReading')}
          value={instantDay(Date.parse(view.endDate), locale)}
        />
        <RespondReading label={t('questionsReading')} value={String(count)} />
      </section>

      {/* `view.anonymous` — `Survey.Settings.Anonymous`, the flag the server writes the
          response under. Never the link payload's `allowAnonymous`, which is the
          distribution's access rule and answers a different question entirely. */}
      <AnonymityNotice anonymous={view.anonymous} recordsParticipation={view.asksParticipantIdentity === true} content={view} />
      {/* The company's privacy notice, readable before the respondent begins; nothing when none is set. */}
      <PrivacyNoticeLink view={view} />

      <Button
        type="button"
        variant="primary"
        onClick={onBegin}
        data-slot="entry-begin"
        size="lg"
        className="w-full"
      >
        {t('next.entryStart')}
        <CanvasArrowRightIcon className="size-icon" />
      </Button>

      {/* Nothing under the button (PROCOMER, 2026-11-19: «"Empezar a responder" y ya. Abajo
          no debe aparecer nada»). «Después, una pregunta por pantalla» and the floor line
          («Llegó con un enlace compartido · no necesita cuenta») were drawn here; their
          catalogue keys stay (additive catalogues), nothing renders them. */}
    </>
  )
}
