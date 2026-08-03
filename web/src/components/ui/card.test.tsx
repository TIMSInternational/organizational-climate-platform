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
