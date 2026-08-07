/**
 * DOM ids for the respond form's controls.
 *
 * A plain `.ts` module rather than exports beside the component, for two reasons.
 * The page moves focus onto a question by id after a failed submit, so the id has to
 * be derivable from *outside* the component that renders it — and oxlint's
 * `react/only-export-components` is right that a `.tsx` file exporting both a
 * component and a helper breaks fast refresh.
 *
 * Every id is derived from a question id, which is a GUID and therefore already
 * unique and already safe in an id attribute. Option *values* are deliberately never
 * interpolated: they are author-supplied strings that may contain spaces, quotes or
 * anything else, and an id built from one would sometimes be unselectable.
 */

export function questionFieldId(questionId: string): string {
  return `question-${questionId}`
}

export function questionErrorId(questionId: string): string {
  return `${questionFieldId(questionId)}-error`
}

export function questionLegendId(questionId: string): string {
  return `${questionFieldId(questionId)}-legend`
}

/** @param optionIndex the option's index in the question's own option list, not its rank. */
export function rankButtonId(
  questionId: string,
  optionIndex: number,
  direction: 'up' | 'down',
): string {
  return `${questionFieldId(questionId)}-rank-${optionIndex}-${direction}`
}
