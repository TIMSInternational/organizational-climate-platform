import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { TranslationProvider } from '../../../../i18n'
import { setToken, clearToken } from '../../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../../company-context'
import { clearCompanyNameCache } from '../../../../company-context/useCompanyName'
import { tokenFor } from '../../../../test/jwtFixture'
import { getMicroclimate, updateMicroclimate, type MicroclimateDetail } from '../../api/microclimates'
import {
  createMicroclimateInvitations,
  listMicroclimateInvitations,
  type MicroclimateInvitationList,
} from '../../api/microclimateInvitations'
import { listDepartments } from '../../../org-structure/api/departments'
import MicroclimateDetailNextPage from './MicroclimateDetailNextPage'
import es from '../../../../i18n/es.json'

const copy = es.microclimates.next

vi.mock('../../api/microclimates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/microclimates')>()),
  getMicroclimate: vi.fn(),
  updateMicroclimate: vi.fn(),
}))
vi.mock('../../api/microclimateInvitations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/microclimateInvitations')>()),
  listMicroclimateInvitations: vi.fn(),
  createMicroclimateInvitations: vi.fn(),
}))
vi.mock('../../../org-structure/api/departments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../org-structure/api/departments')>()),
  listDepartments: vi.fn(),
}))

const COMPANY = 'c1'

const detail: MicroclimateDetail = {
  id: 'm1',
  title: 'Pulso semanal — ¿cómo fue la semana?',
  description: 'Cinco minutos, dos preguntas, anónimo.',
  companyId: COMPANY,
  createdBy: 'u-ana',
  status: 'active',
  responseCount: 0,
  targetParticipantCount: 20,
  startTime: '2026-09-10T02:06:08.991+00:00',
  endTime: '2026-09-12T02:06:08.992+00:00',
  anonymousResponses: true,
  showLiveResults: true,
  questions: [
    { id: 'q1', text: '¿Cómo se sintió esta semana?', type: 'likert', options: null, required: true, order: 0, emojiOptions: null },
    { id: 'q2', text: 'En una palabra, ¿qué ayudaría más?', type: 'open_ended', options: null, required: false, order: 1, emojiOptions: null },
  ],
  language: 'en',
  resolvedLocale: 'es',
  fallbackFields: [],
}

/** `GET /microclimates/{id}/invitations` on the tenant, 11 Sep: none sent, the anonymous contract. */
const invitations: MicroclimateInvitationList = {
  invitations: [],
  summary: { total: 0, pending: 0, sent: 0, opened: 0, started: 0, completed: 0, revoked: 0, expired: 0 },
  anonymity: {
    anonymous: true,
    highestRecordableState: 'opened',
    suppressedStates: ['started', 'completed'],
    guarantee: 'This microclimate is anonymous.',
  },
}

function renderAs(claims: Record<string, unknown>, state?: unknown) {
  setToken(tokenFor({ sub: 'u-ana', nodoId: '', ...claims }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[{ pathname: '/microclimates/m1', state }]}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/microclimates/:id" element={<MicroclimateDetailNextPage />} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

describe('MicroclimateDetailNextPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('preferredLocale', 'es')
    vi.mocked(getMicroclimate).mockReset().mockResolvedValue(detail)
    vi.mocked(updateMicroclimate).mockReset()
    vi.mocked(listMicroclimateInvitations).mockReset().mockResolvedValue(invitations)
    vi.mocked(createMicroclimateInvitations).mockReset()
    vi.mocked(listDepartments).mockReset().mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    clearToken()
    clearCompanyNameCache()
    window.localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  })

  it('shares a live session: the respond link, its QR, and the invitations as the server counts them', async () => {
    renderAs({ role: 'company_admin', companyId: COMPANY })
    expect(await screen.findByText(`${window.location.host}/microclimates/m1/respond`)).toBeTruthy()
    const qr = screen.getByRole('img', { name: copy.detail.qrAlt })
    expect(Number(qr.getAttribute('data-qr-modules'))).toBeGreaterThan(20)
    expect(await screen.findByText('0 pendientes · 0 enviadas · 0 abiertas')).toBeTruthy()
    expect(screen.getByText(copy.detail.invitationsEmptyTitle)).toBeTruthy()
  })

  it('draws the board’s glyphs in the Después boxes — the waves for Ver en vivo, the bars for Resultados — and one arrow at each row’s end', async () => {
    const { container } = renderAs({ role: 'company_admin', companyId: COMPANY })
    const live = await waitFor(() => {
      const link = container.querySelector<HTMLAnchorElement>('li a[href="/microclimates/m1/live"]')
      expect(link).not.toBeNull()
      return link!
    })
    const results = container.querySelector<HTMLAnchorElement>('li a[href="/microclimates/m1/results"]')
    expect(results).not.toBeNull()
    const glyphs = (row: Element) =>
      [...row.querySelectorAll('svg')].map((svg) => [...svg.querySelectorAll('path')].map((path) => path.getAttribute('d')).join(''))
    // MicroclimateDetail.dc.html, "Después": each row is its box glyph, then one trailing arrow.
    expect(glyphs(live)).toHaveLength(2)
    expect(glyphs(live)[0]).toBe('M2 5c2-2 4 2 6 0s4-2 6 0M2 8.5c2-2 4 2 6 0s4-2 6 0M2 12c2-2 4 2 6 0s4-2 6 0')
    expect(glyphs(results!)).toHaveLength(2)
    expect(glyphs(results!)[0]).toBe('M3 13V8M8 13V4M13 13V6')
    expect(glyphs(live)[1]).toBe(glyphs(results!)[1])
    expect(glyphs(live)[1]).not.toBe(glyphs(live)[0])
  })

  it('draws the header’s Resultados with the board’s bars, and every button of the board at its 34px', async () => {
    const { container } = renderAs({ role: 'company_admin', companyId: COMPANY })
    await screen.findByText(`${window.location.host}/microclimates/m1/respond`)
    // The header's links are the ones outside the Después list.
    const outsideList = (href: string) =>
      [...container.querySelectorAll<HTMLAnchorElement>(`a[href="${href}"]`)].filter((link) => !link.closest('li'))
    const results = outsideList('/microclimates/m1/results')
    expect(results).toHaveLength(1)
    // MicroclimateDetail.dc.html, the header's Resultados: three bars, no axis.
    expect([...results[0]!.querySelectorAll('svg path')].map((path) => path.getAttribute('d'))).toEqual(['M3 13V8M8 13V4M13 13V6'])
    expect(results[0]!.className.split(' ')).toContain('h-control-canvas')
    const live = outsideList('/microclimates/m1/live')
    expect(live).toHaveLength(1)
    expect(live[0]!.className.split(' ')).toContain('h-control-canvas')
    expect(screen.getByRole('button', { name: copy.detail.moreActions }).className.split(' ')).toContain('size-control-canvas')
    for (const name of [copy.detail.copyLink, copy.detail.downloadQr, copy.detail.invite, copy.detail.closeNow]) {
      expect(screen.getByRole('button', { name }).className.split(' ')).toContain('h-control-canvas')
    }
  })

  it('leads the tally with a "·" that is not part of its copy, so at 1024 a wrapped tally opens its line with the number', async () => {
    const { container } = renderAs({ role: 'company_admin', companyId: COMPANY })
    // An exact match: the copy itself carries no "·".
    const tally = await screen.findByText('0 de 20 respuestas')
    const run = container.querySelector('[data-slot="page-meta-sentences"]')
    expect(run?.contains(tally)).toBe(true)
    const sentences = [...(run?.children ?? [])]
    expect(sentences).toHaveLength(2)
    expect(sentences[1]!.lastElementChild).toBe(tally)
    expect(sentences[1]!.querySelector('[data-slot="page-meta-separator"]')?.textContent).toBe('·')
    expect(sentences[0]!.textContent).not.toContain('·')
  })

  it('draws the anonymous ladder from the payload: up to opened, started and completed struck', async () => {
    renderAs({ role: 'company_admin', companyId: COMPANY })
    await screen.findByText(copy.detail.ladderTitle)
    for (const rung of [copy.detail.rungPending, copy.detail.rungSent, copy.detail.rungOpened]) {
      expect(screen.getByText(rung).closest('s')).toBeNull()
    }
    for (const rung of [copy.detail.rungStarted, copy.detail.rungCompleted]) {
      expect(screen.getByText(rung).tagName).toBe('S')
    }
    expect(screen.getByText(copy.detail.anonymityNote)).toBeTruthy()
  })

  it('closes a live session only after the confirmation, through the old page’s PUT', async () => {
    vi.mocked(updateMicroclimate).mockResolvedValue({ ...detail, status: 'closed' })
    renderAs({ role: 'company_admin', companyId: COMPANY })
    const after = (await screen.findByRole('heading', { name: copy.detail.afterTitle })).closest('section') as HTMLElement
    await userEvent.click(within(after).getByRole('button', { name: copy.detail.closeNow }))
    expect(updateMicroclimate).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: copy.detail.closeNow }))
    await waitFor(() => expect(vi.mocked(updateMicroclimate).mock.calls[0]?.slice(1)).toEqual(['m1', { status: 'closed' }]))
    expect(await screen.findAllByText(copy.status.closed)).not.toHaveLength(0)
  })

  it('launches a draft with its one primary action', async () => {
    vi.mocked(getMicroclimate).mockResolvedValue({ ...detail, status: 'draft' })
    vi.mocked(updateMicroclimate).mockResolvedValue(detail)
    renderAs({ role: 'company_admin', companyId: COMPANY })
    const launch = await screen.findByRole('button', { name: copy.detail.launch })
    // The header's primary, at the canvas's 34px like the rest of the header.
    expect(launch.className.split(' ')).toContain('h-control-canvas')
    await userEvent.click(launch)
    await waitFor(() => expect(vi.mocked(updateMicroclimate).mock.calls[0]?.slice(1)).toEqual(['m1', { status: 'active' }]))
  })

  it('invites the whole company with exactly one selector', async () => {
    vi.mocked(createMicroclimateInvitations).mockResolvedValue({
      requested: 12,
      created: 12,
      invitationIds: [],
      skippedUserIds: [],
      notificationsQueued: 12,
      undeliverableRecipients: 0,
      note: null,
    })
    renderAs({ role: 'company_admin', companyId: COMPANY })
    await userEvent.click(await screen.findByRole('button', { name: copy.detail.invite }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: copy.detail.inviteSend }))
    await waitFor(() => expect(vi.mocked(createMicroclimateInvitations).mock.calls[0]?.slice(1)).toEqual(['m1', { allCompanyUsers: true }]))
    expect(await within(dialog).findByText('Se crearon 12 invitaciones.')).toBeTruthy()
    // The list is read again, so the card counts what the server now holds.
    await waitFor(() => expect(listMicroclimateInvitations).toHaveBeenCalledTimes(2))
  })

  it('says why a session Crear created did not launch', async () => {
    vi.mocked(getMicroclimate).mockResolvedValue({ ...detail, status: 'draft' })
    renderAs({ role: 'company_admin', companyId: COMPANY }, { launchError: 'Faltan traducciones: questions[0].text' })
    expect(await screen.findByText(/no se pudo lanzar: Faltan traducciones/)).toBeTruthy()
  })

  it('offers a super administrator every action with no company chosen', async () => {
    renderAs({ role: 'super_admin' })
    expect(await screen.findByRole('button', { name: copy.detail.invite })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: copy.detail.closeNow }).length).toBeGreaterThan(0)
  })

  it('offers no write to an administrator of another company', async () => {
    renderAs({ role: 'company_admin', companyId: 'c2' })
    await screen.findByText(copy.detail.ladderTitle)
    expect(screen.queryByRole('button', { name: copy.detail.invite })).toBeNull()
    expect(screen.queryByRole('button', { name: copy.detail.closeNow })).toBeNull()
  })

  it('refuses an employee before any request is sent', async () => {
    renderAs({ role: 'employee', companyId: COMPANY })
    expect(await screen.findByText(copy.noAccessTitle)).toBeTruthy()
    expect(getMicroclimate).not.toHaveBeenCalled()
    expect(listMicroclimateInvitations).not.toHaveBeenCalled()
  })
})
