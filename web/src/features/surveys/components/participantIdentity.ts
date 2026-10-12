/** The server's limits (`ParticipantIdentity.NameMaxLength` / `EmailMaxLength`). */
export const PARTICIPANT_NAME_MAX = 200
export const PARTICIPANT_EMAIL_MAX = 320

export type ParticipantProblem = 'name' | 'email' | null

/**
 * The same rule the server applies (`ParticipantIdentity.LooksLikeEmail`): one `@`, a domain
 * with a dot in it, no whitespace. Checked here only so the respondent hears about a typo on
 * the identity screen rather than after the last question; the server does not trust it.
 */
export function looksLikeEmail(value: string): boolean {
  const email = value.trim()
  if (email === '' || /\s/.test(email)) return false
  const at = email.indexOf('@')
  if (at <= 0 || at !== email.lastIndexOf('@')) return false
  const domain = email.slice(at + 1)
  const dot = domain.lastIndexOf('.')
  return dot > 0 && dot < domain.length - 1
}

/** What stops the identity screen being left: a missing name, then a malformed (optional) email. */
export function participantProblem(name: string, email: string): ParticipantProblem {
  if (name.trim() === '') return 'name'
  if (email.trim() !== '' && !looksLikeEmail(email)) return 'email'
  return null
}
