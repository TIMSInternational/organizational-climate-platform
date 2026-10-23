/**
 * A tag the product wrote rather than a person: `department:<id>`, `dimension:<key>`. The
 * results screen stamps these on a plan it raises and the detail page reads its finding back
 * out of them (`findingFromTags`), so they are kept exactly as they are and never offered for
 * editing — a reader who deleted one would silently unhook the plan from its finding.
 */
export function isProvenanceTag(tag: string): boolean {
  return tag.includes(':')
}

/** The comma-separated text a reader edits, back into the tag list, deduplicated and trimmed. */
export function parseTags(text: string): string[] {
  const seen = new Set<string>()
  for (const part of text.split(',')) {
    const tag = part.trim()
    if (tag !== '' && !isProvenanceTag(tag)) seen.add(tag)
  }
  return [...seen]
}
