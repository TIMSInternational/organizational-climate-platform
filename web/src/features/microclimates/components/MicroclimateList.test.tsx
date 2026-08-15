import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import MicroclimateList from './MicroclimateList'
import type { Microclimate } from '../api/microclimates'
import { TranslationProvider } from '../../../i18n'
import { MINIMUM_RESPONDENTS } from '../microclimatePrivacy'

/**
 * The Results column, which is where this table carries the anonymity floor.
 *
 * The assertions that matter are the negative ones: a locked cell must not be
 * empty (that reads as missing data), and it must not publish the count behind it
 * in any form a reader or a screen reader can reach.
 */
function session(overrides: Partial<Microclimate> = {}): Microclimate {
  return {
    id: 'm1',
    title: 'Finance check-in',
    companyId: 'c1',
    status: 'closed',
    language: 'en',
    responseCount: 4,
    targetParticipantCount: 4,
    createdAt: '2026-08-21T09:00:00Z',
    ...overrides,
  }
}

function renderList(sessions: Microclimate[]) {
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <MicroclimateList microclimates={sessions} />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

afterEach(cleanup)

describe('MicroclimateList results suppression', () => {
  it('locks and labels the results of a session under the floor', () => {
    renderList([session({ responseCount: MINIMUM_RESPONDENTS - 1 })])

    // Shown as withheld, not hidden: there is a cell, it says protected, and it
    // names which reading it is protecting.
    expect(screen.getByRole('img', { name: /Finance check-in: protected/ })).toBeTruthy()
    expect(screen.getByText('Protected')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Open results' })).toBeNull()
  })

  it('sets the protected word in the ink token rather than the identity accent', () => {
    // `text-accent-amber` on the panel is 3.19:1 at `text-2xs` (10px), under the
    // 4.5:1 this repo pins for text in `badgeVariantContrast.test.ts`.
    // `accentInkContrast.test.ts` guards the value; this guards the reach for it.
    renderList([session({ responseCount: MINIMUM_RESPONDENTS - 1 })])

    expect(screen.getByText('Protected').className).toContain('text-accent-amber-ink')
  })

  it('never puts the suppressed count in the locked cell or its accessible name', () => {
    // Publishing "4" for a protected cell leaks exactly what the floor exists to
    // protect. The Responses column shows the count; the lock must not repeat it.
    renderList([session({ responseCount: 4, targetParticipantCount: 4 })])

    const lock = screen.getByRole('img', { name: /protected/ })
    expect(lock.getAttribute('aria-label')).not.toContain('4')
    expect(lock.textContent).toBe('')
  })

  it('links to the results once the session reaches the floor', () => {
    renderList([session({ id: 'ok', responseCount: MINIMUM_RESPONDENTS })])

    const link = screen.getByRole('link', { name: 'Open results' })
    expect(link.getAttribute('href')).toBe('/microclimates/ok/results')
    expect(screen.queryByRole('img', { name: /protected/ })).toBeNull()
  })

  it('says a draft was never opened rather than locking it', () => {
    // A draft has collected nothing, so there is nothing to protect. A padlock
    // there would claim a rule is being enforced where none applies.
    renderList([session({ status: 'draft', responseCount: 0 })])

    expect(screen.getByText('Not opened yet')).toBeTruthy()
    expect(screen.queryByRole('img', { name: /protected/ })).toBeNull()
  })
})

describe('MicroclimateList readings', () => {
  it('sets the counts, the rate and the date in mono with tabular figures', () => {
    renderList([session({ responseCount: 19, targetParticipantCount: 23 })])

    for (const text of ['19 of 23', '83%', 'Aug 21']) {
      const cell = screen.getByText(text)
      expect(cell.className).toContain('font-mono')
      expect(cell.className).toContain('tabular-nums')
    }
  })

  it('omits the participation rate rather than inventing a denominator', () => {
    renderList([session({ responseCount: 0, targetParticipantCount: 0 })])

    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.queryByText('0%')).toBeNull()
  })

  it('states the count alone when no target was recorded, never "31 of 0"', () => {
    // The Participation cell beside it already refuses to divide by that zero.
    // The Responses cell was still printing it as a denominator, which is the
    // same invented reading in a different column — and the live card one row
    // above got it right, so the two disagreed on the same session.
    renderList([session({ responseCount: 31, targetParticipantCount: 0 })])

    expect(screen.queryByText('31 of 0')).toBeNull()
    const cell = screen.getByText('31 responded')
    expect(cell.className).toContain('font-mono')
    expect(cell.className).toContain('tabular-nums')
  })
})
