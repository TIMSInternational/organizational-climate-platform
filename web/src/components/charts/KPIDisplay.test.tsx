import { cleanup, render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { TranslationProvider } from '../../i18n'
import KPIDisplay, { type Kpi } from './KPIDisplay'

afterEach(cleanup)

function render(ui: ReactElement) {
  return rtlRender(<TranslationProvider initialLocale="en">{ui}</TranslationProvider>)
}

const engagement: Kpi = { id: 'engagement', label: 'Engagement', value: 78 }

/**
 * `Counter` puts the number in the DOM twice by design — an sr-only `<output>` with
 * the settled value and a visible `aria-hidden` span that animates. Reading the
 * outputs is how these assertions name the settled value rather than a frame.
 */
function settledValues(): string[] {
  return screen.getAllByRole('status').map((node) => node.textContent ?? '')
}

describe('KPIDisplay', () => {
  it('renders a card per KPI', () => {
    render(
      <KPIDisplay
        kpis={[engagement, { id: 'enps', label: 'eNPS', value: 31 }]}
        locale="en"
      />,
    )
    expect(screen.getByText('Engagement')).toBeTruthy()
    expect(screen.getByText('eNPS')).toBeTruthy()
    expect(settledValues()).toEqual(['78', '31'])
  })

  it('shows the empty state rather than an empty grid', () => {
    render(<KPIDisplay kpis={[]} />)
    expect(screen.getByRole('status').textContent).toBe('No data to display')
  })

  it('shows loading separately from empty', () => {
    render(<KPIDisplay kpis={[]} isLoading />)
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Loading chart data')
  })

  describe('formatting', () => {
    it('formats a percentage', () => {
      render(
        <KPIDisplay
          kpis={[{ ...engagement, format: { kind: 'percentage' } }]}
          locale="en"
        />,
      )
      expect(settledValues()).toContain('78%')
    })

    /** Legacy hardcoded `$`; the client is Costa Rican. */
    it('formats a currency other than dollars', () => {
      render(
        <KPIDisplay
          kpis={[
            { id: 'budget', label: 'Budget', value: 1000, format: { kind: 'currency', currency: 'CRC' } },
          ]}
          locale="es"
        />,
      )
      expect(settledValues().join()).toContain('CRC')
    })

    /** Legacy called `toLocaleString()` with no argument, reading the host locale. */
    it('formats to the locale it is given, not the machine default', () => {
      render(
        <KPIDisplay kpis={[{ id: 'r', label: 'Responses', value: 1234 }]} locale="es" />,
      )
      expect(settledValues()).toContain('1234')
    })
  })

  describe('target', () => {
    it('shows the target and the percentage attained', () => {
      render(<KPIDisplay kpis={[{ ...engagement, target: 85 }]} locale="en" />)
      expect(screen.getByText('Target 85')).toBeTruthy()
      expect(screen.getByText('92%')).toBeTruthy()
    })

    it('renders a progressbar with the attained value', () => {
      render(<KPIDisplay kpis={[{ ...engagement, target: 85 }]} locale="en" />)
      const bar = screen.getByRole('progressbar')
      expect(bar.getAttribute('aria-valuenow')).toBe('92')
    })

    /**
     * Legacy clamped the *displayed percentage* to 100, so beating a target by 40%
     * looked identical to exactly meeting it. The bar cannot draw past its own end,
     * but the label states the true figure.
     */
    it('reports overshoot in the label while capping the bar', () => {
      render(<KPIDisplay kpis={[{ ...engagement, value: 119, target: 85 }]} locale="en" />)
      expect(screen.getByText('140%')).toBeTruthy()
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
    })

    /**
     * Legacy used `kpi.target ? ... : 100`, so a target of 0 -- legitimate for a
     * metric you want to eliminate -- was read as "no target" and showed a full bar.
     */
    it('treats a target of zero as a real target', () => {
      render(
        <KPIDisplay
          kpis={[{ id: 'incidents', label: 'Incidents', value: 3, target: 0 }]}
          locale="en"
        />,
      )
      expect(screen.getByText('Target 0')).toBeTruthy()
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0')
    })

    it('counts a zero target as met when the value is also zero', () => {
      render(
        <KPIDisplay
          kpis={[{ id: 'incidents', label: 'Incidents', value: 0, target: 0 }]}
          locale="en"
        />,
      )
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
    })

    it('shows no progress bar when there is no target', () => {
      render(<KPIDisplay kpis={[engagement]} locale="en" />)
      expect(screen.queryByRole('progressbar')).toBeNull()
    })
  })

  describe('change against the previous period', () => {
    it('states the relative change and the previous value', () => {
      render(<KPIDisplay kpis={[{ ...engagement, value: 110, previousValue: 100 }]} locale="en" />)
      expect(screen.getByText(/10\.0%/)).toBeTruthy()
      expect(screen.getByText('vs 100 previously')).toBeTruthy()
    })

    /**
     * The bug `deltaFraction` exists for: legacy divided by `previousValue`
     * unguarded, so a first-ever measurement rendered "Infinity%".
     */
    it('falls back to the absolute change when the previous value was zero', () => {
      const { container } = render(
        <KPIDisplay kpis={[{ ...engagement, value: 12, previousValue: 0 }]} locale="en" />,
      )
      expect(container.textContent).not.toContain('Infinity')
      expect(container.textContent).not.toContain('NaN')
      // The absolute change (12) rather than a percentage, and the previous value
      // is still stated so the reader can see where it came from.
      expect(screen.getByText('vs 0 previously')).toBeTruthy()
      expect(container.querySelector('.text-accent-green')?.textContent).toContain('12')
    })

    it('says so when nothing changed', () => {
      render(<KPIDisplay kpis={[{ ...engagement, value: 78, previousValue: 78 }]} locale="en" />)
      expect(screen.getByText(/No change/)).toBeTruthy()
    })

    /**
     * Direction and goodness are different questions. Legacy hardcoded
     * `up ? success : destructive`, which paints rising attrition green.
     */
    it('colours a rise as good when higher is better', () => {
      const { container } = render(
        <KPIDisplay kpis={[{ ...engagement, value: 110, previousValue: 100 }]} locale="en" />,
      )
      expect(container.querySelector('.text-accent-green')).toBeTruthy()
      expect(container.querySelector('.text-accent-red')).toBeNull()
    })

    it('colours a rise as bad when lower is better', () => {
      const { container } = render(
        <KPIDisplay
          kpis={[
            {
              id: 'attrition',
              label: 'Attrition',
              value: 14,
              previousValue: 10,
              higherIsBetter: false,
            },
          ]}
          locale="en"
        />,
      )
      expect(container.querySelector('.text-accent-red')).toBeTruthy()
      expect(container.querySelector('.text-accent-green')).toBeNull()
    })

    it('colours a fall as good when lower is better', () => {
      const { container } = render(
        <KPIDisplay
          kpis={[
            {
              id: 'attrition',
              label: 'Attrition',
              value: 8,
              previousValue: 10,
              higherIsBetter: false,
            },
          ]}
          locale="en"
        />,
      )
      expect(container.querySelector('.text-accent-green')).toBeTruthy()
    })

    it('shows nothing when there is no previous value', () => {
      render(<KPIDisplay kpis={[engagement]} locale="en" />)
      expect(screen.queryByText(/previously/)).toBeNull()
    })
  })

  it('renders the section heading when given one', () => {
    render(<KPIDisplay kpis={[engagement]} title="This quarter" locale="en" />)
    expect(screen.getByRole('heading', { name: 'This quarter' })).toBeTruthy()
  })
})
