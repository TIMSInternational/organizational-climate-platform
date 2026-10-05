import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { STALE_MS, claimLock, heldElsewhere, refreshLock, releaseLock } from './respondLock'

/**
 * Two tabs are two tab ids. The module's own `TAB_ID` is one per JavaScript context
 * and a test file is one context, so every function takes the tab explicitly and these
 * are the two that stand in for the real thing.
 */
const TAB_A = 'tab-a'
const TAB_B = 'tab-b'
const SURVEY = 'survey-1'
const T0 = 1_760_000_000_000

describe('respondLock', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('a free survey is claimed, and the claimant is not blocked by its own lock', () => {
    expect(claimLock(SURVEY, TAB_A, T0)).toBe(true)
    expect(heldElsewhere(SURVEY, TAB_A, T0)).toBe(false)
  })

  it('a second tab is refused while the first keeps beating', () => {
    expect(claimLock(SURVEY, TAB_A, T0)).toBe(true)

    expect(claimLock(SURVEY, TAB_B, T0 + 1_000)).toBe(false)
    expect(heldElsewhere(SURVEY, TAB_B, T0 + 1_000)).toBe(true)

    // Still refused well past the stale window, because A is still writing.
    expect(refreshLock(SURVEY, TAB_A, T0 + STALE_MS)).toBe(true)
    expect(claimLock(SURVEY, TAB_B, T0 + STALE_MS + 1)).toBe(false)
  })

  it('a lock nobody has beaten for STALE_MS is taken, and the dead holder is told', () => {
    claimLock(SURVEY, TAB_A, T0)

    // One millisecond inside the window is still A's.
    expect(claimLock(SURVEY, TAB_B, T0 + STALE_MS)).toBe(false)

    expect(claimLock(SURVEY, TAB_B, T0 + STALE_MS + 1)).toBe(true)
    // The whole point of the heartbeat's return value: A finds out it lost, and the
    // hook's contract is that it then stops rather than taking the lock back.
    expect(refreshLock(SURVEY, TAB_A, T0 + STALE_MS + 2)).toBe(false)
    expect(heldElsewhere(SURVEY, TAB_A, T0 + STALE_MS + 2)).toBe(true)
  })

  it('a release hands the survey straight over, and only the holder may release', () => {
    claimLock(SURVEY, TAB_A, T0)

    // B lost the race and must not be able to free A's lock on its own way out.
    releaseLock(SURVEY, TAB_B)
    expect(heldElsewhere(SURVEY, TAB_B, T0 + 1_000)).toBe(true)

    releaseLock(SURVEY, TAB_A)
    expect(claimLock(SURVEY, TAB_B, T0 + 1_000)).toBe(true)
  })

  it('a lock dated in the future is stale, so a backwards clock change cannot wedge it', () => {
    // Written by a tab whose clock then moved back an hour: `now - at` is negative for
    // as long as the offset, which without the second arm reads as perpetually fresh.
    window.localStorage.setItem(
      'surveyOpen:survey-1',
      JSON.stringify({ tab: TAB_A, at: T0 + STALE_MS + 1 }),
    )

    expect(heldElsewhere(SURVEY, TAB_B, T0)).toBe(false)
    expect(claimLock(SURVEY, TAB_B, T0)).toBe(true)
  })

  it('refresh re-takes a lock that expired with nobody waiting', () => {
    claimLock(SURVEY, TAB_A, T0)
    window.localStorage.removeItem('surveyOpen:survey-1')

    expect(refreshLock(SURVEY, TAB_A, T0 + 1_000)).toBe(true)
    expect(heldElsewhere(SURVEY, TAB_B, T0 + 1_000)).toBe(true)
  })

  it('is scoped per survey, so holding one never blocks another', () => {
    claimLock('survey-1', TAB_A, T0)

    expect(claimLock('survey-2', TAB_B, T0)).toBe(true)
    expect(heldElsewhere('survey-2', TAB_B, T0)).toBe(false)
  })

  it('a value that is not a lock is treated as no lock rather than throwing', () => {
    window.localStorage.setItem('surveyOpen:survey-1', 'not json')
    expect(heldElsewhere(SURVEY, TAB_B, T0)).toBe(false)
    expect(claimLock(SURVEY, TAB_B, T0)).toBe(true)

    window.localStorage.setItem('surveyOpen:survey-1', JSON.stringify({ tab: 7, at: 'soon' }))
    expect(heldElsewhere(SURVEY, TAB_A, T0)).toBe(false)
  })

  /**
   * Storage is blocked outright in some privacy modes. Spied on **`window.localStorage`
   * itself**, not on `Storage.prototype`: `setup.ts` installs a happy-dom Storage
   * INSTANCE, so a prototype spy is never the object the code reaches and every
   * assertion below would pass on the happy path — the mistake
   * `respondReceipt.test.ts` records.
   *
   * The spies are restored **here**, one by one, rather than left to the `afterEach`.
   * Measured on vitest 4.1.10: `vi.restoreAllMocks()` does not restore a `vi.spyOn`
   * taken against this instance, while `spy.mockRestore()` does. A file that relies on
   * the former leaves `getItem` throwing for every test that follows, where the module
   * swallows it and reports an empty store — which is a passing assertion about
   * nothing. `respondReceipt.test.ts` is exposed to exactly this and escapes only
   * because its blocked-storage test happens to be the last one in the file.
   */
  it('degrades to letting the respondent answer when storage throws', () => {
    const blocked = () => {
      throw new Error('blocked')
    }
    const spies = [
      vi.spyOn(window.localStorage, 'getItem').mockImplementation(blocked),
      vi.spyOn(window.localStorage, 'setItem').mockImplementation(blocked),
      vi.spyOn(window.localStorage, 'removeItem').mockImplementation(blocked),
    ]

    try {
      // Prove the mock bites before asserting anything about behaviour.
      expect(() => window.localStorage.getItem('x')).toThrow('blocked')
      expect(() => window.localStorage.setItem('x', '1')).toThrow('blocked')

      expect(heldElsewhere(SURVEY, TAB_A, T0)).toBe(false)
      expect(claimLock(SURVEY, TAB_A, T0)).toBe(true)
      expect(refreshLock(SURVEY, TAB_A, T0)).toBe(true)
      expect(() => releaseLock(SURVEY, TAB_A)).not.toThrow()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }

    // And prove the restoration bit, so a future vitest that changes this again is
    // caught here rather than as a baffling failure three tests later.
    window.localStorage.setItem('surveyOpen:probe', 'restored')
    expect(window.localStorage.getItem('surveyOpen:probe')).toBe('restored')
  })

  it('stores a tab id and a timestamp, and nothing about the respondent', () => {
    claimLock(SURVEY, TAB_A, T0)

    const keys = Object.keys(window.localStorage)
    expect(keys).toEqual(['surveyOpen:survey-1'])
    expect(JSON.parse(window.localStorage.getItem('surveyOpen:survey-1') ?? '{}')).toEqual({
      tab: TAB_A,
      at: T0,
    })
  })
})
