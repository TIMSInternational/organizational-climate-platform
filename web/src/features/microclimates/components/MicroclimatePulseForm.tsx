import { useEffect, useState, type FormEvent } from "react";
import { EyeOff, Info } from "lucide-react";
import {
  getMicroclimatePublic,
  submitResponse,
  type PublicMicroclimateDetail,
  type Question,
} from "../api/microclimates";
import { useTranslation } from "../../../i18n";
import { detectLocale } from "../../../i18n/locale";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Textarea,
} from "../../../components/ui";
import { SegmentedScale } from "../../../components/ui/SegmentedScale";
import MicroclimateContentNotice from "./MicroclimateContentNotice";

/**
 * The scale a likert or rating question is answered on when it configures no
 * options of its own — the same 1–5 run `MicroclimateEndpoints.cs` validates a
 * submitted answer against (`int.TryParse(answer, …) && rating is >= 1 and <= 5`).
 * Named here so the control and the server's contract cannot drift apart silently.
 */
const SCALE_MIN = 1;
const SCALE_MAX = 5;

/** The `<legend>` that names one question's group of controls. */
function questionLegendId(questionId: string): string {
  return `microclimate-question-${questionId}`;
}

function QuestionInput({
  question,
  legendId,
  value,
  onChange,
}: {
  question: Question;
  /** Id of the `<legend>` holding the question, for controls that need naming. */
  legendId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();

  switch (question.type) {
    // An emoji scale is answered on the values ITS AUTHOR configured, so unlike
    // likert/rating there is no 1-5 fallback to draw when the set is missing --
    // `MicroclimateEndpoints` refuses to create such a question and rejects any answer
    // to one that reached the database another way, so drawing a scale here would be
    // offering a control whose every answer is a 400.
    case "emoji_rating":
      if (!question.emojiOptions || question.emojiOptions.length === 0) {
        return (
          <p role="alert" className="text-sm text-fg-secondary">
            {t("microclimates.questionHasNoOptions")}
          </p>
        );
      }
      return (
        <EmojiScale question={question} value={value} onChange={onChange} />
      );
    case "multiple_choice":
      // The backend now rejects multiple_choice questions with fewer than 2 options at
      // creation time, but this stays defensive against any question created before that
      // validation existed -- an empty radiogroup with no message is indistinguishable from
      // a loading/broken UI to the respondent.
      if (!question.options || question.options.length === 0) {
        return (
          <p role="alert" className="text-sm text-fg-secondary">
            {t("microclimates.questionHasNoOptions")}
          </p>
        );
      }
      return (
        <ChoiceList
          // The stable value, never the label. Submitting the label is what
          // splits one answer into two across languages (#195).
          choices={question.options.map((option) => ({
            value: option.value,
            label: option.label ?? option.value,
          }))}
          question={question}
          value={value}
          onChange={onChange}
          stacked
        />
      );
    // likert and rating render identically -- a 1-5 scale unless the question
    // configures its own option set. They stay distinct types because they mean
    // different things (agreement vs quality), not because they look different.
    case "likert":
    case "rating":
      // An AUTHORED option set is not a numeric scale: its values are words
      // (`strongly_agree`), and `SegmentedScale` draws the points of an inclusive
      // integer run and emits `String(point)`. Those questions keep the choice list
      // they already had -- and the server validates them against their own option
      // values rather than against 1-5, so the two branches match the two branches
      // `MicroclimateEndpoints.cs` validates with.
      if (question.options && question.options.length > 0) {
        return (
          <ChoiceList
            choices={question.options.map((option) => ({
              value: option.value,
              label: option.label ?? option.value,
            }))}
            question={question}
            value={value}
            onChange={onChange}
          />
        );
      }
      return (
        <SegmentedScale
          min={SCALE_MIN}
          max={SCALE_MAX}
          // Nothing in the payload names the ends of an unlabelled 1-5 scale -- a
          // microclimate question carries no anchor words, only a `text` -- so the
          // generic pair is used rather than inventing an anchor the author never
          // wrote. An authored scale states its own ends, and takes the branch above.
          minLabel={t("charts.levelLow")}
          maxLabel={t("charts.levelHigh")}
          // '' means unanswered, which is not a point on the scale.
          value={value === "" ? null : value}
          onChange={onChange}
          // The group's name, exactly as `ChoiceList` names its radiogroup.
          label={question.text ?? undefined}
          required={question.required}
        />
      );
    case "yes_no":
      return (
        <ChoiceList
          choices={[
            { value: "yes", label: t("common.yes") },
            { value: "no", label: t("common.no") },
          ]}
          question={question}
          value={value}
          onChange={onChange}
        />
      );
    case "open_ended":
    default:
      // A `<textarea>`, not the single-line `<input type="text">` this used to be:
      // the design draws free text as the box under the scale ("Anything you want to
      // add?"), and one 32px line for a sentence someone is invited to write is the
      // control telling them not to bother.
      //
      // `aria-labelledby` because a `<legend>` names the FIELDSET, not the control
      // inside it -- so this box had no accessible name at all before. Same fix
      // `surveys/RespondQuestionField.tsx` already carries for its comment box.
      return (
        <Textarea
          aria-labelledby={legendId}
          required={question.required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/**
 * A row of radios, laid out for a phone.
 *
 * The three radio-shaped branches above used to spell out their own `<label><input
 * …/>{label}</label>` markup, three times, with the input nested inside the label
 * and no hit target beyond the words. A native radio is about 13px, which is far
 * under the 24px WCAG 2.2 target minimum on the device this page is mostly
 * answered on, so the label is given a full control-height strip and `htmlFor`
 * puts the hit target on it. Same treatment as
 * `surveys/RespondQuestionField.tsx`, which set the precedent.
 */
function ChoiceList({
  choices,
  question,
  value,
  onChange,
  stacked = false,
}: {
  choices: { value: string; label: string }[];
  question: Question;
  value: string;
  onChange: (value: string) => void;
  /** One per line, for authored options that can be long. Scales wrap in a row. */
  stacked?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={question.text ?? undefined}
      className={
        stacked ? "grid gap-1" : "flex flex-wrap gap-x-section gap-y-1"
      }
    >
      {choices.map((choice) => {
        const inputId = `${question.id}-${choice.value}`;
        return (
          <span key={choice.value} className="flex items-center gap-inline">
            <input
              type="radio"
              id={inputId}
              name={question.id}
              value={choice.value}
              checked={value === choice.value}
              required={question.required}
              onChange={(e) => onChange(e.target.value)}
            />
            <label
              htmlFor={inputId}
              className="mb-0 flex min-h-control-lg items-center text-base font-normal text-fg-primary"
            >
              {choice.label}
            </label>
          </span>
        );
      })}
    </div>
  );
}

/**
 * The emoji scale of an `emoji_rating` question (#198).
 *
 * ## The glyph is not the name
 *
 * Every face is drawn `aria-hidden`, and the control's accessible name comes from the
 * authored `label` beside it. This is the entire reason the backend stores an emoji
 * scale in its own table instead of reusing the plain option rows: an emoji-only radio
 * is announced by whatever the reader's own emoji dictionary calls the character, in
 * whatever language that dictionary happens to be in — so a Spanish respondent could
 * hear an English phrase, and a respondent on a reader without that character in its
 * table could hear nothing at all. The server refuses to store a face without a label,
 * so `label` is present on anything authored through the product; `?? String(value)`
 * is the type-level acknowledgement of a row that predates that rule, not a fallback
 * anyone is meant to see.
 *
 * ## The label is visible, not screen-reader-only
 *
 * `sr-only` would have kept the drawing pure emoji and still passed an automated a11y
 * check. It is not used, because this product's stated audience includes people with
 * low digital literacy and a bare face is ambiguous to a sighted respondent too — 🙂
 * as "fine" or as "not bad"? The word under each face is the answer to that, for
 * everybody.
 *
 * ## What is submitted
 *
 * `String(option.value)`, never the glyph and never the label — the same rule
 * `ChoiceList` follows for the stable option value (#195), and what the server
 * validates against.
 */
function EmojiScale({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: string;
  onChange: (value: string) => void;
}) {
  const options = question.emojiOptions ?? [];

  return (
    <div
      role="radiogroup"
      aria-label={question.text ?? undefined}
      className="flex flex-wrap gap-x-section gap-y-1"
    >
      {options.map((option) => {
        const submitted = String(option.value);
        const inputId = `${question.id}-emoji-${option.order}`;
        return (
          <span key={option.order} className="flex items-center gap-inline">
            <input
              type="radio"
              id={inputId}
              name={question.id}
              value={submitted}
              checked={value === submitted}
              required={question.required}
              onChange={(e) => onChange(e.target.value)}
            />
            <label
              htmlFor={inputId}
              className="mb-0 flex min-h-control-lg flex-col items-center justify-center text-base font-normal text-fg-primary"
            >
              {/* Decoration. The name is the line below it. */}
              <span aria-hidden="true" className="text-2xl leading-none">
                {option.emoji}
              </span>
              <span className="text-sm">
                {option.label ?? String(option.value)}
              </span>
            </label>
          </span>
        );
      })}
    </div>
  );
}

/**
 * A failure carried as data rather than as a finished string.
 *
 * The message from a real API error is already human-readable and locale-agnostic
 * here; only the fallback needs translating, and doing that at render keeps `t`
 * out of the fetch effect's dependency array.
 */
interface PageError {
  message: string | null;
}

function toPageError(err: unknown): PageError {
  return { message: err instanceof Error ? err.message : null };
}

/**
 * Answering a live microclimate session, without an account — everything inside the
 * respond shell, and none of the shell itself.
 *
 * ## Why this is a component and not the page it used to be
 *
 * Two routes render this now: `/microclimates/:id/respond`, which addresses a session by
 * its GUID, and `/microclimate-invitations/:token` (#130), which addresses one invitee's
 * personal link and puts a landing card in front of the questions. Both own a
 * `RespondShell` of their own — the invitation route needs one that is up before the
 * microclimate has resolved, so it can render a dead-link message inside the same frame —
 * and two nested shells would draw two lockups and two skip links.
 *
 * So the split is at the shell boundary: the frame belongs to the route, the questions
 * belong here. That is exactly the shape the survey side already has, where
 * `SurveyRespondForm` is a shell-free component both `/surveys/:id/respond` and
 * `/survey-invitations/:token` mount.
 *
 * Nothing about the drawing changed in the move. The markup below is the markup
 * `MicroclimateRespondPage` had, and `respondContrast.test.ts` sweeps this file by path
 * so the ban on the two AA-failing utilities followed it here rather than being left
 * behind on a file that no longer contains any classes.
 *
 * ## The pulse, drawn the way the approved design draws it
 *
 * The employee design's `pulse` screen is **one narrow centred column and nothing
 * else**: a small eyebrow, one large question, the segmented scale, an optional box
 * for free text, a single Send, and the anonymity line as a footnote under it. It is
 * a screen usually opened from a link in a meeting and answered in seconds, which is
 * a different act from working through a twelve-question climate survey.
 *
 * What was here until now was a three-column `lg:grid-cols-3` layout with a
 * `lg:sticky` right-hand rail carrying the anonymity promise and an answered-count
 * tile. **That rail was not a design decision — it was a test's.**
 * `components/layout/respondSticky.test.tsx` asserted a sticky panel on this route,
 * so the page kept one after the redesign had already cut the rail from the two
 * survey respond routes (their instrument moved to a bottom bar, which the design
 * does draw for a long form and does *not* draw here). The drawing has no rail and
 * no bar, so this page now has neither, and that test case was re-pointed at the
 * property that still holds on this route rather than left asserting a box that no
 * longer exists.
 *
 * Three consequences worth stating plainly:
 *
 * - **The answered-count tile is gone.** It was the rail's instrument, and the pulse
 *   draws no progress at all. A session with more than one question still numbers
 *   them (`1/2`, and the sentence beside it), which is the position information the
 *   tile was standing in for.
 * - **The anonymity note is now the footnote it is drawn as**, last in the column
 *   rather than beside the questions. On a one-question pulse the whole column is a
 *   screenful, so "last" is still in view; it no longer needs to stick to stay there.
 * - **`RespondCaption` is not used here**, though the two survey routes use it. Its
 *   `<h1>` is `text-2xl` — the same size this design gives the *question* — so on a
 *   screen whose whole job is to ask one thing, the session's name would compete with
 *   the ask. The eyebrow and the heading are inlined below at the design's weighting:
 *   context small, question large.
 *
 * The 1–5 scale is `ui/SegmentedScale` rather than a row of native radios: a native
 * radio is ~13px against the 24px WCAG 2.2 target minimum, on the screen that is
 * most often answered on a phone. **What that costs, stated plainly:** a button
 * group has no native `required`, so the browser no longer blocks submitting an
 * unanswered required scale question — it is `aria-required` and the word in the
 * legend now. The server never enforced it either (`MicroclimateEndpoints.cs`
 * validates the answers it is *sent*, not the ones it is not), so nothing that was
 * guaranteed has been lost; but a client-side check is the honest next step, and it
 * needs copy this catalogue does not have yet.
 *
 * ## Why the anonymity statement is on this page at all
 *
 * `PublicMicroclimateDetail` carries no `anonymousResponses` flag, so this page
 * cannot report the session's configuration and does not try to. What it states
 * instead is what this client verifiably does: `submitResponse` in
 * `api/microclimates.ts` posts with `Content-Type` alone and attaches no bearer
 * token, so no name and no account leaves this page with the answers. That is a
 * description of the request, not a promise about the server, and the copy says
 * exactly that much.
 *
 * ## Submitting is unchanged, and there is no receipt to build
 *
 * `POST /microclimates/{id}/responses` returns an empty 201 and individual responses
 * are not persisted against a respondent, so there is nothing to show back. The
 * confirmation stays the `role="status"` alert it already was — the design's `done`
 * screen belongs to the survey flow, which has a submission to describe.
 */
export default function MicroclimatePulseForm({
  microclimateId,
  onSubmitted,
}: {
  /** The session to load and answer. Undefined while a route parameter is missing. */
  microclimateId: string | undefined;
  /**
   * Called once, after the server has accepted the answers.
   *
   * The invitation route uses it to record `completed` on the invitation ladder. It is
   * deliberately fire-and-forget from this component's side: whether an administrator's
   * counter moved is not a precondition for a respondent finishing, and nothing here
   * waits on it or reports its failure.
   */
  onSubmitted?: () => void;
}) {
  const { t } = useTranslation();
  const id = microclimateId;
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string;
  const [microclimate, setMicroclimate] =
    useState<PublicMicroclimateDetail | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<PageError | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // An invited respondent has no stored preference and no authenticated locale, so
  // the language they are served has to come from the request itself -- exactly the
  // `?lang=` parameter web/src/i18n/README.md anticipated for this one public route.
  const locale = detectLocale();

  useEffect(() => {
    if (!id) return;
    getMicroclimatePublic(baseUrl, id, locale)
      .then(setMicroclimate)
      .catch((err) => setError(toPageError(err)));
  }, [id, baseUrl, locale]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!id) return;
    setError(null);
    setSubmitting(true);
    try {
      // Send the locale actually rendered, not the browser's current preference:
      // they are the same here, but the server records what the respondent saw.
      await submitResponse(
        baseUrl,
        id,
        answers,
        microclimate?.resolvedLocale ?? locale,
      );
      setSubmitted(true);
      onSubmitted?.();
    } catch (err) {
      setError(toPageError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const questions = microclimate?.questions ?? [];
  const total = questions.length;

  return (
    <Surface>
      {error ? (
        <Alert variant="warning" role="alert">
          <Info aria-hidden="true" />
          <AlertTitle>{t("microclimates.respondLoadFailedTitle")}</AlertTitle>
          <AlertDescription>
            {error.message ?? t("errors.generic")}
          </AlertDescription>
        </Alert>
      ) : submitted ? (
        <Alert variant="success" role="status">
          <EyeOff aria-hidden="true" />
          <AlertTitle>{t("microclimates.respondThanksTitle")}</AlertTitle>
          <AlertDescription>
            {t("microclimates.thankYouForResponse")}
          </AlertDescription>
        </Alert>
      ) : !microclimate ? (
        <p className="text-base text-fg-secondary">{t("common.loading")}</p>
      ) : microclimate.status !== "active" ? (
        <Alert variant="warning" role="status">
          <Info aria-hidden="true" />
          <AlertTitle>{t("microclimates.respondClosedTitle")}</AlertTitle>
          <AlertDescription>
            {t("microclimates.notAcceptingResponses")}
          </AlertDescription>
        </Alert>
      ) : (
        /* The whole screen: one column, capped at the prose measure and centred.
         No grid, no rail, no bar — every part of the pulse is in reading order
         down this one box, which is also why nothing on this page has to stick
         to stay in view. */
        <div
          data-slot="pulse-column"
          className="mx-auto grid w-full max-w-measure gap-panel-gap"
        >
          {/* The design's pulse heads the column with a small line naming the kind
            of thing, then goes straight to the ask. So the eyebrow keeps the
            shell's eyebrow treatment and the session's own name is set at
            `text-lg` — an `<h1>` for the document outline, deliberately quieter
            than the 20px question below it. */}
          <header className="grid gap-1">
            <span className="text-2xs font-semibold uppercase tracking-eyebrow text-fg-secondary">
              {t("microclimates.respondEyebrow")}
            </span>
            <h1 className="text-lg font-semibold tracking-tight text-fg-primary">
              {microclimate.title ?? t("microclimates.respondUntitled")}
            </h1>
          </header>

          <MicroclimateContentNotice
            language={microclimate.language}
            resolvedLocale={microclimate.resolvedLocale}
            fallbackFields={microclimate.fallbackFields}
          />

          <form onSubmit={handleSubmit} className="grid gap-section">
            {questions.map((question, index) => {
              const legendId = questionLegendId(question.id);
              return (
                <fieldset
                  key={question.id}
                  // `min-w-0` because this is a grid item, and a grid item's
                  // automatic minimum size is its MIN-CONTENT width -- a long
                  // unbroken option label would otherwise widen the card, the
                  // column and the document, and send the Send button off the
                  // side of a phone. `respondSticky.test.tsx` measures it.
                  className="min-w-0 rounded-xl border border-line-panel bg-surface-card p-panel transition-colors focus-within:border-accent-blue-ring"
                >
                  {/* `float-left w-full` closes the card's frame: a `<legend>`
                    in its default flow is cut out of the fieldset's own
                    border, so the question straddles the top edge and the
                    card reads as a form group rather than as a panel. The
                    block below clears the float. */}
                  <legend id={legendId} className="float-left w-full">
                    {/* Nothing numbers a session that asks ONE question: "1/1"
                      and "Question 1 of 1" are two ways of saying there is no
                      position to keep track of, and the design's pulse screen
                      draws neither. Both come back the moment there is a
                      second question to be somewhere in — and with the rail's
                      answered-count tile gone, this is now the only thing on
                      the page reporting position. */}
                    {total > 1 && (
                      <>
                        {/* The position as a reading: mono, tabular, and hidden
                          from assistive tech because the sentence beside it is
                          what "3/8" is supposed to say out loud. */}
                        <span
                          aria-hidden="true"
                          className="mr-inline inline-flex items-center rounded-md bg-surface-icon-box px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-fg-secondary"
                        >
                          {`${index + 1}/${total}`}
                        </span>
                        <span className="sr-only">
                          {t("microclimates.respondQuestionPosition", {
                            position: index + 1,
                            total,
                          })}
                        </span>
                      </>
                    )}
                    {/* The one thing being asked, at the size the design gives it
                      — 20px, and the largest type on the screen. This is the
                      whole page for most respondents. */}
                    <span className="text-2xl font-semibold tracking-tight text-fg-primary">
                      {question.text}
                    </span>
                    {/* The WORD carries whether an answer is required, never a
                      colour -- WCAG 1.4.1, and the same rule the survey
                      respond field keeps. On its own line under the question
                      now: at 20px an inline marker read as part of the ask. */}
                    <span className="mt-1 block text-sm font-normal text-fg-secondary">
                      {question.required
                        ? t("microclimates.respondRequiredMarker")
                        : t("microclimates.respondOptionalMarker")}
                    </span>
                  </legend>
                  <div className="clear-both mt-panel-gap">
                    <QuestionInput
                      question={question}
                      legendId={legendId}
                      value={answers[question.id] ?? ""}
                      onChange={(value) =>
                        setAnswers({ ...answers, [question.id]: value })
                      }
                    />
                  </div>
                </fieldset>
              );
            })}

            {/* One action. The design draws a single Send and no second control:
              there is no draft to save on a session whose responses are not
              persisted against a respondent. */}
            <div className="flex flex-wrap gap-inline">
              <Button
                type="submit"
                variant="primary"
                size="lg"
                disabled={submitting}
              >
                {submitting ? t("common.submitting") : t("common.submit")}
              </Button>
            </div>
          </form>

          {/* The footnote, where the drawing puts it. It used to ride the sticky
            rail; on a column this short it is on screen with the Send button
            that precedes it, which is the moment it is actually read. */}
          <AnonymityNote />
        </div>
      )}
    </Surface>
  );
}

/**
 * What this page does with the answers, stated as narrowly as it can be verified.
 *
 * Green plus the word: the chip spells out the state, so the colour is never the
 * only thing carrying it.
 */
function AnonymityNote() {
  const { t } = useTranslation();

  return (
    <section className="grid gap-inline rounded-xl border border-accent-green-ring bg-accent-green-soft p-card">
      <span className="flex items-center gap-inline">
        <span className="grid size-icon-box shrink-0 place-items-center rounded-md text-accent-green">
          <EyeOff aria-hidden="true" className="size-icon" />
        </span>
        {/* Secondary ink, not the accent: `text-accent-green` on the soft green
            fill measures 3.49:1 in light, under AA for text this size. The accent
            stays on the icon beside it. */}
        <span className="text-2xs font-semibold uppercase tracking-label text-fg-secondary">
          {t("microclimates.respondAnonymityChip")}
        </span>
      </span>
      <h2 className="text-base font-semibold text-fg-primary">
        {t("microclimates.respondAnonymityTitle")}
      </h2>
      <p className="text-sm text-fg-secondary">
        {t("microclimates.respondAnonymityBody")}
      </p>
    </section>
  );
}

/** The one panel on the page — every state renders inside it. */
function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col gap-panel-gap rounded-xl border border-line-panel bg-surface-panel p-panel">
      {children}
    </div>
  );
}
