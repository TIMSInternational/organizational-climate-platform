import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import MicroclimatesListNextPage from './MicroclimatesListNextPage'
import type { Microclimate, MicroclimateDetail } from '../api/microclimates'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { clearToken, setToken } from '../../../auth/token'
import { COMPANY_CONTEXT_STORAGE_KEY, CompanyContextProvider } from '../../../company-context'
import { tokenFor } from '../../../test/jwtFixture'

/**
 * The redesigned Microclimas (`/microclimates`), against the MicroclimatesList artboard:
 * the flow card reads the session in progress, the row prints the detail's facts and
 * never guesses them, a past session's results sit behind the floor, and only an
 * administrator is ever sent a request.
 */

// Built from local components so the printed date is the same in every time zone.
const CLOSES = new Date(2026, 8, 11, 21, 6).toISOString()
const OPENED = new Date(2026, 8, 9, 21, 6).toISOString()

function row(overrides: Partial<Microclimate> = {}): Microclimate {
  return {
    id: 'm1',
    title: 'Pulso semanal — ¿cómo fue la semana?',
    companyId: 'their-co',
    status: 'active',
    language: 'es',
    responseCount: 0,
    targetParticipantCount: 20,
    createdAt: '2026-09-10T02:06:08Z',
    ...overrides,
  }
}

function detailFor(source: Microclimate, overrides: Partial<MicroclimateDetail> = {}): MicroclimateDetail {
  return {
    id: source.id,
    title: source.title,
    description: null,
    companyId: source.companyId,
    createdBy: 'u1',
    status: source.status,
    responseCount: source.responseCount,
    targetParticipantCount: source.targetParticipantCount,
    startTime: OPENED,
    endTime: CLOSES,
    anonymousResponses: true,
    showLiveResults: true,
    questions: [
      { id: 'q1', text: '¿Cómo se sintió?', type: 'likert', options: null, required: true, order: 0 },
      { id: 'q2', text: 'En una palabra', type: 'open_ended', options: null, required: false, order: 1 },
    ],
    language: 'es',
    resolvedLocale: 'es',
    fallbackFields: [],
    ...overrides,
  }
}

/** Answers the list, and each detail from `details` (a missing one answers 500). */
function routeFetch(rows: Microclimate[], details: Record<string, MicroclimateDetail> = {}) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    const one = /\/microclimates\/([^/?]+)/.exec(url)
    if (one) {
      const found = details[one[1]]
      return Promise.resolve(
        found
          ? new Response(JSON.stringify(found), { status: 200 })
          : new Response(JSON.stringify({ message: 'boom' }), { status: 500 }),
      )
    }
    return Promise.resolve(new Response(JSON.stringify({ microclimates: rows }), { status: 200 }))
  })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <CompanyContextProvider>
          <MicroclimatesListNextPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function listCalls(): string[] {
  return vi.mocked(fetch).mock.calls.map(([input]) => String(input)).filter((url) => /\/microclimates\?/.test(url))
}

const OPEN = row()

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  vi.stubGlobal('fetch', vi.fn())
  setToken(tokenFor({ role: 'company_admin', companyId: 'their-co' }))
  routeFetch([OPEN], { m1: detailFor(OPEN) })
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function section(name: string): HTMLElement {
  return screen.getByRole('region', { name })
}

describe('the flow card', () => {
  it('fills the steps up to where the session in progress stands, and names it', async () => {
    renderPage()
    await screen.findByText('“Pulso semanal” is at step 3')

    const steps = document.querySelectorAll('[data-slot="flow-step"]')
    expect([...steps].map((step) => step.getAttribute('data-reached'))).toEqual(['true', 'true', 'true', 'false'])
    expect(steps[2].getAttribute('aria-current')).toBe('step')
  })

  it('puts a draft at the first step', async () => {
    const draft = row({ id: 'd1', status: 'draft' })
    routeFetch([draft], { d1: detailFor(draft) })
    renderPage()
    await screen.findByText('“Pulso semanal” is at step 1')

    const steps = document.querySelectorAll('[data-slot="flow-step"]')
    expect([...steps].map((step) => step.getAttribute('data-reached'))).toEqual(['true', 'false', 'false', 'false'])
  })
})

describe('the sessions', () => {
  it('holds open sessions and drafts in progress, and closed ones in the past', async () => {
    const draft = row({ id: 'd1', title: 'People pulse', status: 'draft' })
    const shut = row({ id: 'c1', title: 'Engineering retro', status: 'closed', responseCount: 12 })
    routeFetch([shut, draft, OPEN], { m1: detailFor(OPEN), d1: detailFor(draft) })
    renderPage()
    await screen.findByText('Engineering retro')

    const inProgress = within(section('In progress'))
    expect(inProgress.getByText('Pulso semanal — ¿cómo fue la semana?')).toBeTruthy()
    expect(inProgress.getByText('People pulse')).toBeTruthy()
    expect(inProgress.getByText('2 sessions')).toBeTruthy()
    expect(within(section('Past sessions')).getByText('Engineering retro')).toBeTruthy()
    // Only a session in progress costs a detail read; the past rows print what the list has.
    const detailReads = vi.mocked(fetch).mock.calls.map(([input]) => String(input)).filter((url) => /\/microclimates\/[^?]/.test(url))
    expect(detailReads.some((url) => url.includes('/c1'))).toBe(false)
  })

  it('prints the row as the artboard does, from the list and the detail', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    renderPage()
    const meta = await screen.findByText((_, node) => node?.getAttribute('data-slot') === 'session-meta' && /preguntas/.test(node.textContent ?? ''))

    expect(meta.textContent).toBe(
      '0 de 20 respuestas · abierto hasta el 11 sept a las 21:06 · 2 preguntas · anónimo · palabras protegidas hasta 5',
    )
    // The counts are readings: the figure face, and nothing else in the line.
    expect([...meta.querySelectorAll('.font-mono')].map((node) => node.textContent)).toEqual(['0', '20'])
  })

  it('leaves the detail’s facts off when that read fails, rather than guessing them', async () => {
    routeFetch([OPEN], {})
    renderPage()
    const meta = await screen.findByText((_, node) => node?.getAttribute('data-slot') === 'session-meta')

    expect(meta.textContent).toBe('0 of 20 responses · words protected until 5')
    // No close date, so the empty past note names no session.
    expect(screen.getByText(/when a microclimate closes/)).toBeTruthy()
  })

  it('invents no target: no "of 0" and no bar', async () => {
    const open = row({ targetParticipantCount: 0, responseCount: 31 })
    routeFetch([open], { m1: detailFor(open) })
    renderPage()
    const meta = await screen.findByText((_, node) => node?.getAttribute('data-slot') === 'session-meta' && /questions/.test(node.textContent ?? ''))

    expect(meta.textContent).toMatch(/^31 responses · /)
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('names the open session and its closing day in the empty past note', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    renderPage()

    expect(
      await screen.findByText(/La primera aparece aquí cuando «Pulso semanal» cierre el 11 de septiembre: .* si 5 personas respondieron\./),
    ).toBeTruthy()
    expect(screen.getByText('ninguna todavía')).toBeTruthy()
  })

  it('offers no results link for a past session under the floor, and the hatch instead', async () => {
    const few = row({ id: 'few', title: 'Tiny team', status: 'closed', responseCount: 4 })
    const many = row({ id: 'many', title: 'Whole floor', status: 'closed', responseCount: 5 })
    routeFetch([few, many], {})
    renderPage()
    await screen.findByText('Tiny team')

    const rows = [...document.querySelectorAll('[data-slot="past-row"]')] as HTMLElement[]
    const tiny = rows.find((node) => node.textContent?.includes('Tiny team'))!
    const whole = rows.find((node) => node.textContent?.includes('Whole floor'))!
    expect(within(tiny).queryByRole('link', { name: 'Results' })).toBeNull()
    expect(within(tiny).getByRole('img', { name: /Tiny team/ })).toBeTruthy()
    expect(within(whole).getByRole('link', { name: 'Results' }).getAttribute('href')).toBe('/microclimates/many/results')
  })

  it('wears no sample chip: every field on the screen has an endpoint', async () => {
    renderPage()
    await screen.findByText('“Pulso semanal” is at step 3')
    expect(screen.queryByText('Sample data')).toBeNull()
    expect(document.querySelector('[data-slot="sample-chip"]')).toBeNull()
  })
})

describe('sharing the link', () => {
  it('copies the absolute respond URL of an open anonymous session', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Share' }))

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/microclimates/m1/respond`)
    expect(await screen.findByRole('button', { name: 'Link copied' })).toBeTruthy()
  })

  it('shows the link to select by hand when the browser refuses the copy', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Share' }))

    expect(await screen.findByText(`${window.location.origin}/microclimates/m1/respond`)).toBeTruthy()
  })

  it('offers no public link for a named session, which is answered from invitations', async () => {
    routeFetch([OPEN], { m1: detailFor(OPEN, { anonymousResponses: false }) })
    renderPage()
    await screen.findByText(/named/)

    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Watch live' }).getAttribute('href')).toBe('/microclimates/m1/live')
  })

  it('offers no public link for a draft, anonymous or not: it takes no answers until it opens', async () => {
    const draft = row({ id: 'd1', status: 'draft' })
    routeFetch([draft], { d1: detailFor(draft) })
    renderPage()
    const meta = await screen.findByText(
      (_, node) => node?.getAttribute('data-slot') === 'session-meta' && /anonymous/.test(node.textContent ?? ''),
    )

    expect(meta.textContent).toMatch(/ · anonymous · /)
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('/microclimates/d1')
  })
})

describe('the glyphs', () => {
  it('draws the artboard’s own button glyphs: the plus, the one diagonal link and the arrow', async () => {
    renderPage()
    const share = await screen.findByRole('button', { name: 'Share' })

    expect(share.querySelector('path')?.getAttribute('d')).toMatch(/^M6\.5 9\.5l3-3/)
    const launch = screen.getByRole('link', { name: 'Launch a microclimate' })
    expect(launch.querySelector('path')?.getAttribute('d')).toBe('M8 3v10M3 8h10')
    const watch = screen.getByRole('link', { name: 'Watch live' })
    expect(watch.querySelector('path')?.getAttribute('d')).toBe('M3 8h10M9 4l4 4-4 4')
  })
})

describe('by role', () => {
  it('a company administrator reads the company and may launch', async () => {
    renderPage()
    await screen.findByText('Pulso semanal — ¿cómo fue la semana?')

    expect(screen.getByRole('link', { name: 'Launch a microclimate' }).getAttribute('href')).toBe('/microclimates/new')
    expect(listCalls()[0]).toMatch(/companyId=their-co/)
  })

  it('a super administrator with a company chosen reads that company and may launch', async () => {
    setToken(tokenFor({ role: 'super_admin' }))
    localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'chosen-co')
    renderPage()
    await screen.findByText('Pulso semanal — ¿cómo fue la semana?')

    expect(screen.getByRole('link', { name: 'Launch a microclimate' })).toBeTruthy()
    expect(listCalls()[0]).toMatch(/companyId=chosen-co/)
  })

  it('a super administrator with no company chosen is asked for one, and nothing is fetched', async () => {
    setToken(tokenFor({ role: 'super_admin' }))
    renderPage()

    expect(await screen.findByText('Choose a company')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Launch a microclimate' })).toBeNull()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it.each(['leader', 'supervisor', 'employee'])('a %s is told whose screen this is, and never sent a request that could only 403', async (role) => {
    setToken(tokenFor({ role, companyId: 'their-co' }))
    renderPage()

    expect(await screen.findByText('Microclimates belong to the administration')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Launch a microclimate' })).toBeNull()
    await waitFor(() => expect(vi.mocked(fetch)).not.toHaveBeenCalled())
  })
})
