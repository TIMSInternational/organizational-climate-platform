import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import LiveSessionPanel from './LiveSessionPanel'
import type { Microclimate } from '../api/microclimates'
import { TranslationProvider } from '../../../i18n'
import { MINIMUM_RESPONDENTS } from '../microclimatePrivacy'

function session(overrides: Partial<Microclimate> = {}): Microclimate {
  return {
    id: 'm1',
    title: 'Ops all-hands',
    companyId: 'c1',
    status: 'active',
    language: 'en',
    responseCount: 31,
    targetParticipantCount: 48,
    createdAt: '2026-08-11T09:00:00Z',
    ...overrides,
  }
}

function renderPanel(sessions: Microclimate[]) {
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <LiveSessionPanel sessions={sessions} />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

afterEach(cleanup)

describe('LiveSessionPanel', () => {
  it('reads the count in mono against the target in prose', () => {
    renderPanel([session()])

    const count = screen.getByText('31')
    expect(count.className).toContain('font-mono')
    expect(count.className).toContain('tabular-nums')
    expect(screen.getByText('of 48 responded')).toBeTruthy()
  })

  it('draws the meter at the participation rate', () => {
    renderPanel([session({ responseCount: 31, targetParticipantCount: 48 })])

    // 31/48 is 64.58%, which rounds to 65.
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('65')
  })

  it('omits the meter entirely when no target was recorded', () => {
    // A bar over a target of zero states a participation rate nobody supplied.
    renderPanel([session({ targetParticipantCount: 0 })])

    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByText('responded')).toBeTruthy()
  })

  it('replaces the results button with a lock below the anonymity floor', () => {
    renderPanel([session({ responseCount: MINIMUM_RESPONDENTS - 1 })])

    expect(screen.queryByRole('link', { name: 'Open results' })).toBeNull()
    expect(screen.getByRole('img', { name: /Ops all-hands: protected/ })).toBeTruthy()
    expect(screen.getByText('Protected')).toBeTruthy()
    // The live view stays reachable: it is the room, and it enforces its own floor.
    expect(screen.getByRole('link', { name: 'View Live' }).getAttribute('href')).toBe(
      '/microclimates/m1/live',
    )
  })

  it('offers the results once the session reaches the floor', () => {
    renderPanel([session({ responseCount: MINIMUM_RESPONDENTS })])

    expect(screen.getByRole('link', { name: 'Open results' }).getAttribute('href')).toBe(
      '/microclimates/m1/results',
    )
    expect(screen.queryByRole('img', { name: /protected/ })).toBeNull()
  })

  it('says nothing is open rather than rendering an empty strip', () => {
    renderPanel([])

    expect(screen.getByText('Nothing is open right now')).toBeTruthy()
  })

  it('renders one card per open session', () => {
    renderPanel([session({ id: 'a', title: 'Ops all-hands' }), session({ id: 'b', title: 'Finance stand-up' })])

    expect(screen.getByText('Ops all-hands')).toBeTruthy()
    expect(screen.getByText('Finance stand-up')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'View Live' })).toHaveLength(2)
  })
})
