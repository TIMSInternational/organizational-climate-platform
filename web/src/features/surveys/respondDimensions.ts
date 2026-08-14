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
 * ## Why randomisation switches sectioning off entirely
 *
 * `orderQuestions` shuffles the flat list with a survey-id-seeded PRNG when
 * `Survey.Settings.RandomizeQuestions` is on. Grouping that list would gather the
 * shuffled questions back into their categories — which is not a re-ordering of the
 * sections, it is the *undoing* of the randomisation the survey author asked for:
 * every question of a dimension would sit together again, in a merely different
 * order. So a randomised survey is asked as one flat, unsectioned run, and the page
 * prints no headings over it.
 *
 * The same answer covers the two cases where a heading would say nothing: every
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
 * @param randomizeQuestions `SurveyRespondView.randomizeQuestions`. When true the
 * result is a single unsectioned run; see the module note.
 *
 * Sections appear in order of first appearance of their category, so the survey
 * author's ordering survives — the same rule, and for the same reason, that
 * `climateDimensions` orders the map's columns by.
 */
export function respondDimensions(
  questions: readonly SurveyRespondQuestion[],
  randomizeQuestions: boolean,
): RespondDimensionModel {
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

  const sections: RespondSection[] = []
  let position = 1
  for (const [key, sectionQuestions] of grouped) {
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
