/**
 * The number a reader counts a question by. `order` is the builder's 0-based position, so the
 * first question is order 0 and number 1 («P1» / «Q1»).
 *
 * One helper for every surface that prints it — the results screen, the legacy results page and
 * the results CSV's «Número de pregunta» column. Review of 12 Nov: the screen had moved to
 * `order + 1` on its own while the CSV still wrote the raw 0-based order and the legacy page
 * printed «P0», so question P1 on screen was row 0 in the export a reader matched it against.
 */
export function questionNumber(question: { order: number }): number {
  return question.order + 1
}
