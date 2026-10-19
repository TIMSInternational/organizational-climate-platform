import type { SurveyRespondQuestion } from './api/surveyResponses'
import { UNCATEGORISED_DIMENSION, dimensionKeyOf } from './surveyResultsMap'

/**
 * The sections the respond form asks its questions under.
 *
 * The approved employee design prints a dimension heading — PSYCHOLOGICAL SAFETY,
 * WORKLOAD, IN YOUR WORDS — above each run of questions, with a range reading
 * ("1–2 of 12") beside it. Its note says why: twelve questions on one page is
 * right, because a wizard makes "save and finish later" meaningless and hides how
 * much is left, but an ungrouped run of twelve tells the respondent nothing about
 * what is being asked. The headings are the same `category` the results screen
 * aggregates by, so the respondent sees the structure the analysis will use.
 *
 * This module decides only the grouping. It holds no copy — every heading is the
 * author's own `category` text, which is free text the server neither controls nor
 * translates, and the sentinel below is rendered by the page from the catalogue.
 *
 * ## The normalisation is `dimensionKeyOf`, not a second copy of it
 *
 * `SurveyRespondQuestion.category` and `SurveyQuestionResult.category` are the same
 * `varchar(100)` free-text column, read at two ends of the same survey. There is no
 * controlled vocabulary and no server-side label, so "Workload" and " Workload "
 * are one dimension on the results screen and must be one section here — a second
 * normaliser would eventually disagree with the first, and the respondent would
 * then be asked under two headings what is reported under one.
 * `UNCATEGORISED_DIMENSION` comes from the same module for the same reason.
 *
 * ## A randomised survey prints no headings at all
 *
 * `orderQuestions` shuffles the flat list with a session-seeded PRNG when
 * `Survey.Settings.RandomizeQuestions` is on — all of it but the free-text questions,
 * which it holds back and asks last — and this module then prints that list as one
 * flat, unsectioned run. Randomisation and the hidden dimension are one
 * setting because they are one promise: a respondent who can read the construct
 * above a question can still answer it as that construct, which is the bias the
 * shuffle exists to remove.
 *
 * `docs/runbooks/procomer-instrument-2026.md` states it as a commitment to a client
 * — "`randomizeQuestions: true` carries both commitments from the 12 Aug minuta at
 * once: the questions are asked in a random order AND the dimension is not shown" —
 * and ESPH's 2026-10-18 review names the same thing as a defect in its own words:
 * *"viene sobre la pregunta la categoria ... las preguntas deben ir en aleatorio
 * justamente para que la persona no pueda asociarlas a una categoria"*.
 *
 * ## The superseded ruling, and why it did not survive
 *
 * Ruled 2026-10-13 (#556), reversed 2026-10-18: that ruling kept the headings on a
 * randomised survey and shuffled the SECTION order instead, so an 80-item,
 * ten-dimension instrument would stay navigable rather than arrive as eighty
 * unlabelled questions. Three things count against it, and none of them is taste:
 *
 * 1. It made the PROCOMER runbook false the day it shipped. That runbook records a
 *    commitment to a client and an on-screen verification of it ("no theme or
 *    dimension appeared anywhere"); neither was revisited.
 * 2. Sections laid end to end ask each dimension's questions CONSECUTIVELY. The
 *    section order moves, but the grouping the respondent can see does not, so the
 *    association the shuffle exists to break survives it.
 * 3. Its own argument no longer holds. The form asks one question per page
 *    (`SurveyRespondForm`, "one question at a time on small screens"), so a heading
 *    sits over a single question and orients nothing -- there is no run of eighty to
 *    navigate. The ruling was written for a page that had already been split.
 *
 * What is lost is real, and is recorded here rather than denied: a long randomised
 * instrument gives the respondent no sense of what is being asked about. The progress
 * reading ("4 de 63") is what is left to orient them.
 *
 * Two cases still print no headings, because a heading there would say nothing: every
 * category null or blank (there is no structure to show), and a single distinct
 * category (one heading over the whole form is a title, not a section).
 */

/** One run of questions asked under one dimension heading. */
export interface RespondSection {
  /**
   * The author's category, trimmed — or `UNCATEGORISED_DIMENSION` for the questions
   * that carry none. The sentinel is kept as a section rather than dropped, exactly
   * as `climateDimensions` keeps it as a column: dropping those questions would
   * remove them from the form, and hiding them under a neighbouring heading would
   * file them against a construct their author did not choose.
   *
   * Always `UNCATEGORISED_DIMENSION` when `sectioned` is false — see below.
   */
  key: string
  /** The questions, in the order they are asked. Never re-sorted within a section. */
  questions: SurveyRespondQuestion[]
  /**
   * 1-based positions of this section's first and last question **in reading
   * order**, so `1–2 of 12` can be printed as it stands and is true of what is on
   * screen. Equal when the section holds one question, which is the design's
   * "3 of 12" form.
   *
   * Reading order, not the order the questions arrived in: when an author
   * interleaves categories (A, B, A) the grouping pulls the third question up under
   * the first heading, so a range taken from the arrival order would be a lie about
   * which questions sit under it.
   */
  firstIndex: number
  lastIndex: number
}

export interface RespondDimensionModel {
  /**
   * Whether the page should print headings at all.
   *
   * False means "render `sections[0].questions` as one flat list" — the sections
   * array is still the whole form, so a caller can render from it either way and
   * never has to hold two shapes.
   */
  sectioned: boolean
  sections: RespondSection[]
}

/**
 * The whole form as one nameless run.
 *
 * The lone section is deliberately keyed `UNCATEGORISED_DIMENSION` even when every
 * question shares a real category. A key here is an invitation to print a heading,
 * and in the randomised case that heading would sit over questions gathered from
 * every dimension. One rule — no sections, no name — is the only one that cannot be
 * got wrong at the call site.
 */
function unsectioned(questions: readonly SurveyRespondQuestion[]): RespondDimensionModel {
  // No questions is no section, rather than an empty one. An empty section renders
  // a heading and a "1–0 of 0" reading over nothing at all.
  if (questions.length === 0) return { sectioned: false, sections: [] }
  return {
    sectioned: false,
    sections: [
      {
        key: UNCATEGORISED_DIMENSION,
        questions: [...questions],
        firstIndex: 1,
        lastIndex: questions.length,
      },
    ],
  }
}

/**
 * Groups the questions the respondent will be asked into dimension sections.
 *
 * @param questions the questions **in the order they are asked** — the output of
 * `orderQuestions`, not the raw payload. This function never sorts.
 * @param randomizeQuestions `SurveyRespondView.randomizeQuestions`. When true there
 * are no sections at all and the whole form is one nameless run -- see the module
 * note. It takes no seed of its own: the only shuffle a randomised survey needs has
 * already happened in `orderQuestions`, and this function never reorders.
 *
 * Sections appear in order of first appearance of their category, so the survey
 * author's ordering survives — the same rule, and for the same reason, that
 * `climateDimensions` orders the map's columns by.
 */
export function respondDimensions(
  questions: readonly SurveyRespondQuestion[],
  randomizeQuestions: boolean,
): RespondDimensionModel {
  // Before any grouping: a randomised survey is asked as the flat shuffled list it
  // arrived as, under no heading. Grouping first and discarding the result would be
  // the same answer by a longer road, but it would also leave `sections` holding a
  // structure the page must then be trusted not to print.
  if (randomizeQuestions) return unsectioned(questions)

  // Insertion order IS first-appearance order, which is the ordering rule.
  const grouped = new Map<string, SurveyRespondQuestion[]>()
  for (const question of questions) {
    const key = dimensionKeyOf(question)
    const existing = grouped.get(key)
    if (existing) existing.push(question)
    else grouped.set(key, [question])
  }

  // One key covers both "nobody categorised anything" (the key is the sentinel) and
  // "every question is in one dimension". Zero keys is the empty form.
  if (grouped.size < 2) return unsectioned(questions)

  // First-appearance order: the author's own ordering, which survives because this is
  // the only path left -- a randomised survey returned above.
  const keys = [...grouped.keys()]

  const sections: RespondSection[] = []
  let position = 1
  for (const key of keys) {
    // Non-null: every key came from `grouped` itself a line ago.
    const sectionQuestions = grouped.get(key)!
    sections.push({
      key,
      questions: sectionQuestions,
      firstIndex: position,
      lastIndex: position + sectionQuestions.length - 1,
    })
    position += sectionQuestions.length
  }
  return { sectioned: true, sections }
}
