import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TranslationProvider } from '../../i18n'
import ShareLinkPanel from './ShareLinkPanel'

afterEach(cleanup)

const LINK = '/survey-links/not-a-real-token-not-a-real-token-not-a-real'

function renderPanel(publicLink: string | null, handlers: Record<string, () => void> = {}) {
  return render(
    <TranslationProvider>
      <ShareLinkPanel
        publicLink={publicLink}
        onCreate={handlers.onCreate ?? (() => {})}
        onRegenerate={handlers.onRegenerate ?? (() => {})}
        onRevoke={handlers.onRevoke ?? (() => {})}
      />
    </TranslationProvider>,
  )
}

describe('ShareLinkPanel', () => {
  it('offers to mint a link, and shows none, when the survey is invitation-only', () => {
    const onCreate = vi.fn()
    const { container } = renderPanel(null, { onCreate })

    expect(screen.getByText(/No open link exists/)).toBeTruthy()
    expect(container.textContent).not.toContain('survey-links')
    expect(screen.queryByRole('button', { name: 'Reveal' })).toBeNull()
  })

  /**
   * A share link is a bearer credential that happens to be meant for distribution. It is
   * shown, unlike an invitation token — but not by default, because the failure mode is
   * a distribution page being screen-shared, screenshotted into a ticket, or pasted into
   * a status report with the link sitting in plain sight.
   */
  it('masks the link until it is explicitly revealed', async () => {
    const { container } = renderPanel(LINK)

    expect(container.textContent).not.toContain(LINK)

    await userEvent.click(screen.getByRole('button', { name: 'Reveal' }))
    expect(screen.getByText(LINK)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(container.textContent).not.toContain(LINK)
  })

  it('does not leak the link through the mask’s length', () => {
    // A mask that preserves length still tells a reader how long the secret is, and two
    // partial screenshots of a length-preserving mask reconstruct one secret.
    const { container } = renderPanel(LINK)
    const masked = container.querySelector('[data-slot="share-link-value"]')?.textContent ?? ''
    expect(masked).not.toContain('survey-links')
    expect(masked.length).not.toBe(LINK.length)
  })

  it('warns that anyone holding the link can open the survey', () => {
    renderPanel(LINK)
    expect(screen.getByText(/Anyone holding this link can open the survey/)).toBeTruthy()
  })

  it('offers replacement and deletion, which is what makes a leak recoverable', async () => {
    const onRegenerate = vi.fn()
    const onRevoke = vi.fn()
    renderPanel(LINK, { onRegenerate, onRevoke })

    await userEvent.click(screen.getByRole('button', { name: 'Replace link' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete link' }))

    expect(onRegenerate).toHaveBeenCalledTimes(1)
    expect(onRevoke).toHaveBeenCalledTimes(1)
  })

  it('starts masked again for a replacement link', async () => {
    const { rerender, container } = renderPanel(LINK)
    await userEvent.click(screen.getByRole('button', { name: 'Reveal' }))

    const replacement = '/survey-links/a-replacement-token-a-replacement-token-abc'
    rerender(
      <TranslationProvider>
        <ShareLinkPanel
          publicLink={replacement}
          onCreate={() => {}}
          onRegenerate={() => {}}
          onRevoke={() => {}}
        />
      </TranslationProvider>,
    )

    // Revealing one link is consent to see that link. Carrying the reveal across a
    // regeneration would put a freshly-minted credential on screen unasked — which is
    // exactly the moment someone is most likely to be sharing their screen.
    expect(container.textContent).not.toContain(replacement)
    expect(screen.getByRole('button', { name: 'Reveal' })).toBeTruthy()
  })
})
