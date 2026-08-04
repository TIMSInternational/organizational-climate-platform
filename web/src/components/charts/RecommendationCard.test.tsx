import { cleanup, render as rtlRender, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TranslationProvider } from '../../i18n'
import RecommendationCard, { type RecommendedAction } from './RecommendationCard'

afterEach(cleanup)

function render(ui: ReactElement) {
  return rtlRender(<TranslationProvider initialLocale="en">{ui}</TranslationProvider>)
}

const base = {
  title: 'Run a listening session in Support',
  description: 'Support scored lowest on psychological safety for the second quarter running.',
  kind: 'action' as const,
  priority: 'high' as const,
  confidence: 0.72,
  category: 'Psychological safety',
  locale: 'en',
}

const actions: RecommendedAction[] = [
  {
    id: 'a1',
    title: 'Schedule the session',
    description: 'Book 90 minutes with the Support leads.',
    effort: 'low',
    impact: 'high',
    timeline: '2 weeks',
    assignee: 'Ana',
  },
]

describe('RecommendationCard', () => {
  it('renders the recommendation, its category and its kind', () => {
    render(<RecommendationCard {...base} />)
    expect(screen.getByRole('heading', { name: base.title })).toBeTruthy()
    expect(screen.getByText(base.description)).toBeTruthy()
    expect(screen.getByText('Psychological safety')).toBeTruthy()
    expect(screen.getByText('Action')).toBeTruthy()
  })

  describe('priority', () => {
    /**
     * Legacy mapped both `high` and `critical` onto the `destructive` badge, so the
     * two most important levels rendered identically — exactly where the distinction
     * matters most.
     */
    it('distinguishes high from critical', () => {
      const high = render(<RecommendationCard {...base} priority="high" />)
      const highBadge = screen.getByText('High priority').className
      cleanup()

      render(<RecommendationCard {...base} priority="critical" />)
      const criticalBadge = screen.getByText('Critical').className

      expect(highBadge).not.toBe(criticalBadge)
      void high
    })

    it('labels every level', () => {
      for (const [priority, label] of [
        ['low', 'Low priority'],
        ['medium', 'Medium priority'],
        ['high', 'High priority'],
        ['critical', 'Critical'],
      ] as const) {
        render(<RecommendationCard {...base} priority={priority} />)
        expect(screen.getByText(label)).toBeTruthy()
        cleanup()
      }
    })
  })

  describe('confidence', () => {
    it('is labelled, so it cannot be mistaken for the size of the effect', () => {
      render(<RecommendationCard {...base} confidence={0.72} />)
      expect(screen.getByText('Confidence')).toBeTruthy()
      expect(screen.getByText('72%')).toBeTruthy()
    })

    /** Legacy did `Math.round(confidence * 100)` unguarded, so 42 displayed "4200%". */
    it('clamps a value passed as a percentage rather than a fraction', () => {
      render(<RecommendationCard {...base} confidence={42} />)
      expect(screen.queryByText('4200%')).toBeNull()
      expect(screen.getByText('100%')).toBeTruthy()
    })

    it('clamps a negative confidence to zero', () => {
      render(<RecommendationCard {...base} confidence={-1} />)
      expect(screen.getByText('0%')).toBeTruthy()
    })

    it('does not render NaN for a non-finite confidence', () => {
      const { container } = render(<RecommendationCard {...base} confidence={Number.NaN} />)
      expect(container.textContent).not.toContain('NaN')
    })
  })

  describe('metrics', () => {
    it('shows current against target with a progress bar', () => {
      render(
        <RecommendationCard
          {...base}
          metrics={{ current: 62, target: 80, format: { kind: 'percentage' } }}
        />,
      )
      expect(screen.getByText('62%')).toBeTruthy()
      expect(screen.getByText('80%')).toBeTruthy()
      // Confidence has one too, so scope to the metric's own accessible name.
      expect(screen.getByRole('progressbar', { name: '62% of 80%' })).toBeTruthy()
    })

    /** Legacy computed `(current / target) * 100` unguarded — a width of `Infinity%`. */
    it('does not divide by a zero target', () => {
      const { container } = render(
        <RecommendationCard {...base} metrics={{ current: 3, target: 0 }} />,
      )
      expect(container.textContent).not.toContain('Infinity')
      expect(screen.getByRole('progressbar', { name: '3 of 0' }).getAttribute('aria-valuenow')).toBe(
        '0',
      )
    })
  })

  describe('affected areas', () => {
    it('lists them', () => {
      render(<RecommendationCard {...base} affectedAreas={['Support', 'Onboarding']} />)
      expect(screen.getByText('Support')).toBeTruthy()
      expect(screen.getByText('Onboarding')).toBeTruthy()
    })

    it('omits the section when there are none', () => {
      render(<RecommendationCard {...base} />)
      expect(screen.queryByText('Affected areas')).toBeNull()
    })
  })

  describe('recommended actions', () => {
    /**
     * Radix Collapsible wires `aria-expanded` and `aria-controls` between the trigger
     * and the panel. Legacy used a bare `<button onClick={setIsExpanded}>`, so a
     * screen reader could not tell the section was collapsed.
     */
    it('is collapsed to start, and says so', () => {
      render(<RecommendationCard {...base} actions={actions} />)
      const trigger = screen.getByRole('button', { name: 'Recommended actions (1)' })
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      expect(screen.queryByText('Schedule the session')).toBeNull()
    })

    it('expands to show each action', async () => {
      render(<RecommendationCard {...base} actions={actions} />)
      await userEvent.click(screen.getByRole('button', { name: 'Recommended actions (1)' }))

      expect(screen.getByText('Schedule the session')).toBeTruthy()
      expect(screen.getByText('Timeline 2 weeks')).toBeTruthy()
      expect(screen.getByText('Ana')).toBeTruthy()
    })

    /**
     * Effort and impact are labelled text, not traffic-light chips. Legacy coloured
     * both green-to-red, but the polarity is inverted between them — high impact is
     * good news and high effort is not — so a reader scanning for green had to
     * remember which column reversed the meaning.
     */
    it('labels effort and impact instead of colouring them', async () => {
      const { container } = render(<RecommendationCard {...base} actions={actions} />)
      await userEvent.click(screen.getByRole('button', { name: 'Recommended actions (1)' }))

      expect(screen.getByText('Effort')).toBeTruthy()
      expect(screen.getByText('Impact')).toBeTruthy()
      expect(screen.getByText('Low')).toBeTruthy()
      expect(screen.getByText('High')).toBeTruthy()
      // No status fills inside the action detail.
      expect(container.querySelector('.bg-accent-red')).toBeNull()
    })

    it('omits the section when there are no actions', () => {
      render(<RecommendationCard {...base} />)
      expect(screen.queryByText(/Recommended actions/)).toBeNull()
    })
  })

  describe('accept and dismiss', () => {
    it('calls back rather than deciding for itself', async () => {
      const onAccept = vi.fn()
      const onDismiss = vi.fn()
      render(<RecommendationCard {...base} onAccept={onAccept} onDismiss={onDismiss} />)

      await userEvent.click(screen.getByRole('button', { name: 'Accept' }))
      expect(onAccept).toHaveBeenCalledTimes(1)

      await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
      expect(onDismiss).toHaveBeenCalledTimes(1)
    })

    /**
     * The important half. Legacy set its own `isAccepted` the instant the button was
     * clicked, so a failed mutation left the card claiming "Accepted" for something
     * the server had rejected. Acceptance is a fact about the server.
     */
    it('does not claim acceptance until the caller says so', async () => {
      const onAccept = vi.fn()
      render(<RecommendationCard {...base} onAccept={onAccept} />)

      await userEvent.click(screen.getByRole('button', { name: 'Accept' }))
      expect(screen.queryByText('Accepted')).toBeNull()
      expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy()
    })

    it('shows acceptance when the caller reports it', () => {
      render(<RecommendationCard {...base} isAccepted onAccept={() => {}} onDismiss={() => {}} />)
      expect(screen.getByRole('status').textContent).toBe('Accepted')
      expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
    })

    it('renders no action buttons when no handlers are given', () => {
      render(<RecommendationCard {...base} />)
      expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'View details' })).toBeNull()
    })

    it('keeps View details available after acceptance', () => {
      const onViewDetails = vi.fn()
      render(<RecommendationCard {...base} isAccepted onViewDetails={onViewDetails} />)
      expect(screen.getByRole('button', { name: 'View details' })).toBeTruthy()
    })
  })

  /** Red means bad throughout the UI, so only `alert` may claim it. */
  it('reserves the red edge for alerts', () => {
    const alert = render(<RecommendationCard {...base} kind="alert" />)
    expect(alert.container.querySelector('.border-l-accent-red')).toBeTruthy()
    cleanup()

    const insight = render(<RecommendationCard {...base} kind="insight" />)
    expect(insight.container.querySelector('.border-l-accent-red')).toBeNull()
    expect(insight.container.querySelector('.border-l-accent-blue')).toBeTruthy()
  })
})
