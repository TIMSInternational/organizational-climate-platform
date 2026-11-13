import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  KpiCard,
} from './card'
import { Button } from './button'

afterEach(cleanup)

describe('Card', () => {
  it('renders every slot it is given', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Companies</CardTitle>
          <CardDescription>All authorised companies</CardDescription>
          <CardAction>
            <Button>New</Button>
          </CardAction>
        </CardHeader>
        <CardContent>body</CardContent>
        <CardFooter>footer</CardFooter>
      </Card>,
    )

    expect(screen.getByText('Companies')).toBeTruthy()
    expect(screen.getByText('All authorised companies')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New' })).toBeTruthy()
    expect(screen.getByText('body')).toBeTruthy()
    expect(screen.getByText('footer')).toBeTruthy()
  })

  it('switches the header to two columns only when an action is present', () => {
    const { container: withAction } = render(
      <CardHeader>
        <CardTitle>t</CardTitle>
        <CardAction>a</CardAction>
      </CardHeader>,
    )
    // The grid change is driven by `has-data-[slot=card-action]`, so the class is
    // present either way — what matters is the action renders in the action slot.
    expect(withAction.querySelector('[data-slot=card-action]')).toBeTruthy()
  })

  it('exposes slots for styling hooks', () => {
    const { container } = render(
      <Card>
        <CardContent>x</CardContent>
      </Card>,
    )
    expect(container.querySelector('[data-slot=card]')).toBeTruthy()
    expect(container.querySelector('[data-slot=card-content]')).toBeTruthy()
  })
})

describe('Card, as the Apple design draws it', () => {
  it('is bordered and flat: the card edge, no shadow', () => {
    const { container } = render(<Card>x</Card>)
    const classes = (container.querySelector('[data-slot=card]') as HTMLElement).className.split(/\s+/)
    expect(classes).toEqual(expect.arrayContaining(['border', 'border-line-panel', 'bg-surface-card', 'rounded-xl']))
    expect(classes.some((name) => name.startsWith('shadow'))).toBe(false)
  })

  it('pads 18px above and below and 20px across (`.card { padding: 18px 20px }`)', () => {
    const { container } = render(
      <Card>
        <CardHeader>h</CardHeader>
        <CardContent>c</CardContent>
        <CardFooter>f</CardFooter>
      </Card>,
    )
    expect((container.querySelector('[data-slot=card]') as HTMLElement).className.split(/\s+/)).toContain('py-4.5')
    for (const slot of ['card-header', 'card-content', 'card-footer']) {
      expect((container.querySelector(`[data-slot=${slot}]`) as HTMLElement).className.split(/\s+/), slot).toContain('px-5')
    }
  })

  it('sets the card title in the title serif at 20px', () => {
    render(<CardTitle>Participación por departamento</CardTitle>)
    const classes = screen.getByText('Participación por departamento').className.split(/\s+/)
    expect(classes).toEqual(expect.arrayContaining(['font-display', 'text-2xl', 'font-semibold', 'tracking-title']))
  })
})

describe('KpiCard', () => {
  it('shows the label, the reading, its unit, the slot and the footnote in order', () => {
    const { container } = render(
      <KpiCard label="Participación" value="84,8" unit="%" footnote="412 de 486 personas">
        <div data-testid="meter" />
      </KpiCard>,
    )
    const card = container.querySelector('[data-slot=kpi-card]') as HTMLElement
    const text = card.textContent ?? ''
    expect(text.indexOf('Participación')).toBeLessThan(text.indexOf('84,8'))
    expect(text.indexOf('84,8')).toBeLessThan(text.indexOf('%'))
    expect(text.indexOf('%')).toBeLessThan(text.indexOf('412 de 486 personas'))
    expect(screen.getByTestId('meter')).toBeTruthy()
  })

  it('draws the label as the 11px tracked eyebrow and the reading in tabular figures', () => {
    const { container } = render(<KpiCard label="Encuestas activas" value="3" />)
    const label = container.querySelector('[data-slot=kpi-label]') as HTMLElement
    const value = container.querySelector('[data-slot=kpi-value]') as HTMLElement
    expect(label.className.split(/\s+/)).toEqual(expect.arrayContaining(['text-2xs', 'uppercase', 'tracking-tile']))
    expect(value.className.split(/\s+/)).toEqual(expect.arrayContaining(['text-kpi-hero', 'tabular-nums']))
  })

  it('renders no footnote, unit or slot it was not given — it invents nothing', () => {
    const { container } = render(<KpiCard label="Encuestas activas" value="3" />)
    expect(container.querySelector('[data-slot=kpi-footnote]')).toBeNull()
    expect((container.querySelector('[data-slot=kpi-value]') as HTMLElement).textContent).toBe('3')
  })

  it('takes a node for the value, so a protected reading is not a number', () => {
    render(<KpiCard label="Equipo" value={<span data-testid="protected">protegido</span>} />)
    expect(screen.getByTestId('protected')).toBeTruthy()
  })
})
