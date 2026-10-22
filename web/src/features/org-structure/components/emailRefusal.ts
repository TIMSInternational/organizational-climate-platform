import type { TranslateFn } from '../../../i18n'
import { UserEmailError, type UserEmailRefusal } from '../api/users'

// Spelled out rather than built from the code, so keysExist.test.ts can see every key.
const REFUSAL_KEYS: Record<UserEmailRefusal, string> = {
  email_invalid: 'users.next.edit.emailErrors.email_invalid',
  email_undeliverable: 'users.next.edit.emailErrors.email_undeliverable',
  email_taken: 'users.next.edit.emailErrors.email_taken',
  email_invited: 'users.next.edit.emailErrors.email_invited',
}

/**
 * The refusal text for a save that failed, translated when it is one of the four address
 * refusals (`UserEndpoints.UpdateAsync`): the API's own message is English, and these are the
 * ones an administrator can act on. Anything else keeps the old behaviour -- the server's message.
 */
export function updateErrorText(t: TranslateFn, err: unknown, fallback: string): string {
  if (err instanceof UserEmailError) {
    return t(REFUSAL_KEYS[err.code])
  }
  return err instanceof Error ? err.message : fallback
}
