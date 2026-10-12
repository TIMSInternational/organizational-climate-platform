import { describe, expect, it } from 'vitest'
import { looksLikeEmail, participantProblem } from './participantIdentity'
import { formatParticipationDay } from '../next/authoring/participationDay'

/** The client half of `ParticipantIdentity.Validate`; the server is the authority. */
describe('participant identity', () => {
  it('needs a name and nothing else', () => {
    expect(participantProblem('   ', '')).toBe('name')
    expect(participantProblem('José Mora', '')).toBeNull()
    expect(participantProblem('José Mora', '   ')).toBeNull()
  })

  it('refuses an email the pending list could never match', () => {
    for (const bad of ['ana', 'ana@planta', 'ana@@planta.test', '@planta.test', 'ana@planta.', 'ana maria@planta.test']) {
      expect(looksLikeEmail(bad), bad).toBe(false)
    }
    expect(looksLikeEmail(' Ana@Planta.test ')).toBe(true)
    expect(participantProblem('Ana', 'ana@planta')).toBe('email')
  })

  it('prints a stored day as that day, wherever the reader is', () => {
    // The suite runs in America/Chicago: a UTC parse of 2026-10-12 would print the 11th.
    expect(formatParticipationDay('2026-10-12', 'es')).toMatch(/12/)
    expect(formatParticipationDay('not-a-day', 'es')).toBe('not-a-day')
  })
})
