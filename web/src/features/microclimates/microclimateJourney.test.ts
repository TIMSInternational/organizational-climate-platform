import { describe, it, expect } from 'vitest'
import { microclimateJourney } from './microclimateJourney'
import { CATALOGUES } from '../../i18n/locale'
import { createTranslator } from '../../i18n/translate'

const t = createTranslator(CATALOGUES.en)
const START = '2026-08-04T09:00:00Z'
const END = '2026-08-11T17:00:00Z'

function journey(status: string) {
  return microclimateJourney(t, status, START, END, 'en-US')
}

function states(status: string) {
  return journey(status).map((step) => step.status)
}

describe('microclimateJourney', () => {
  it('marks the current status active and everything before it completed', () => {
    expect(states('draft')).toEqual(['active', 'pending', 'pending'])
    expect(states('active')).toEqual(['completed', 'active', 'pending'])
  })

  /**
   * `closed` is terminal — `NEXT_STATUSES.closed` is `[]` — so the last step is
   * finished rather than in progress. Drawing it `active` would put a clock on a
   * session that has stopped collecting, next to copy saying results are final.
   */
  it('marks a closed session completed rather than active on its last step', () => {
    expect(states('closed')).toEqual(['completed', 'completed', 'completed'])
  })

  it('claims nothing at all for a status the server has not told us about', () => {
    expect(states('archived')).toEqual(['pending', 'pending', 'pending'])
  })

  /**
   * A draft carries a start and an end because both were chosen at creation, but
   * neither has happened. A date printed against a step that has not occurred reads
   * as history.
   */
  it('dates only the steps that have actually happened', () => {
    expect(journey('draft').map((step) => step.timestamp)).toEqual([
      undefined,
      undefined,
      undefined,
    ])

    const active = journey('active')
    expect(active[1].timestamp).toBeTruthy()
    expect(active[2].timestamp).toBeUndefined()

    const closed = journey('closed')
    expect(closed[1].timestamp).toBeTruthy()
    expect(closed[2].timestamp).toBeTruthy()
  })

  it('renders no untranslated key paths', () => {
    for (const step of journey('active')) {
      expect(step.title).not.toMatch(/^microclimates\./)
      expect(step.description).not.toMatch(/^microclimates\./)
    }
  })
})
