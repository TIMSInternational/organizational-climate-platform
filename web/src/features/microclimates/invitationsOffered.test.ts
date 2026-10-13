import { describe, it, expect } from 'vitest'
import { MICROCLIMATE_INVITATIONS_OFFERED } from './invitationsOffered'

/**
 * A deliberate tripwire, pinned to what the decision record says — the same device as
 * `CrossServiceTokenTests.The_window_a_revoked_token_stays_live_over_there_for_is_the_token_lifetime`.
 *
 * It exists because `MicroclimateDetailNextPage.test.tsx` MOCKS this module: it has to, so
 * that the withdrawn invitation flow stays covered against the day the ruling is reverted.
 * That mock means no test there reads the shipped value, and flipping this constant would
 * have put the invite action back on the board with every suite still green.
 *
 * If this fails, mode 3 has been reverted. That is a decision, not a bug — change the
 * assertion when the record changes, and not before.
 */
describe('mode 3', () => {
  it('does not offer to invite anybody to a microclimate', () => {
    expect(MICROCLIMATE_INVITATIONS_OFFERED).toBe(false)
  })
})
