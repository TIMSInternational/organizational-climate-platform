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

  it('names each meter after its own session', () => {
    // Two open sessions put two meters on the screen. Labelled "Participation"
    // alone they are indistinguishable to a screen reader, which is the one
    // reader who cannot use the card around them to tell which is which.
    renderPanel([
      session({ id: 'a', title: 'Ops all-hands' }),
      session({ id: 'b', title: 'Finance stand-up' }),
    ])

    const labels = screen
      .getAllByRole('progressbar')
      .map((bar) => bar.getAttribute('aria-label'))
    expect(labels).toEqual(['Participation — Ops all-hands', 'Participation — Finance stand-up'])
  })

  it('lets the odd card out span the row rather than sitting alone in a column', () => {
    // The same hole the one-session case avoids, at the bottom of the grid.
    renderPanel([
      session({ id: 'a', title: 'One' }),
      session({ id: 'b', title: 'Two' }),
      session({ id: 'c', title: 'Three' }),
    ])

    const card = (title: string) => screen.getByText(title).closest('div.rounded-lg')!
    expect(card('Three').className).toContain('md:col-span-2')
    expect(card('One').className).not.toContain('md:col-span-2')
    expect(card('Two').className).not.toContain('md:col-span-2')
  })

  it('does not span a lone card across a grid that has only one track', () => {
    // With one session the wrapper never takes `md:grid-cols-2`, so a span of two
    // would conjure an implicit second column for the card to hang off.
    renderPanel([session({ title: 'Only' })])

    expect(screen.getByText('Only').closest('div.rounded-lg')!.className).not.toContain(
      'md:col-span-2',
    )
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

  it('sets both state words in the ink token rather than the identity accent', () => {
    // Measured against tokens.css, `text-accent-amber` on this card's
    // `bg-surface-icon-box` is 2.80:1 and `text-accent-green` is 3.31:1 — and
    // both words are `text-2xs`, which tokens.css defines as 10px, so the bar is
    // WCAG AA 4.5:1. `accentInkContrast.test.ts` guards the numbers; this guards
    // that the component actually reaches for them. happy-dom does no painting,
    // so nothing else in this suite could ever notice these classes reverting.
    renderPanel([session({ responseCount: MINIMUM_RESPONDENTS - 1 })])

    expect(screen.getByText('Protected').className).toContain('text-accent-amber-ink')
    expect(screen.getByText('Active').className).toContain('text-accent-green-ink')
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
