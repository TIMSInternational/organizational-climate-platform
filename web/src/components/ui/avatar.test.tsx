import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Avatar, AvatarFallback, AvatarImage } from './avatar'

afterEach(cleanup)

describe('Avatar', () => {
  it('shows the fallback until the image has loaded', async () => {
    render(
      <Avatar>
        <AvatarImage src="/nope.png" alt="Ana" />
        <AvatarFallback>AT</AvatarFallback>
      </Avatar>,
    )
    // Radix only swaps in the image on a load event, so the fallback is what a
    // user sees first — and all they ever see if the URL is broken.
    expect(await screen.findByText('AT')).toBeTruthy()
  })

  it('renders the fallback alone', () => {
    render(
      <Avatar>
        <AvatarFallback>AT</AvatarFallback>
      </Avatar>,
    )
    expect(screen.getByText('AT')).toBeTruthy()
  })

  it('is sized to the icon-box token, not shadcn 40px', () => {
    const { container } = render(
      <Avatar>
        <AvatarFallback>AT</AvatarFallback>
      </Avatar>,
    )
    expect(container.querySelector('[data-slot=avatar]')?.className).toContain('size-icon-box')
  })
})
