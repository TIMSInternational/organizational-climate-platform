import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import MicroclimatesListPage from './MicroclimatesListPage'
import { listMicroclimates, createMicroclimate } from '../api/microclimates'
import type { Microclimate } from '../api/microclimates'
import { setToken, clearToken } from '../../../auth/token'

vi.mock('../api/microclimates', () => ({
  listMicroclimates: vi.fn(),
  createMicroclimate: vi.fn(),
}))

const mockListMicroclimates = vi.mocked(listMicroclimates)
const mockCreateMicroclimate = vi.mocked(createMicroclimate)

function makeToken(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify(payload))
  return `${header}.${body}.signature`
}

const microclimates: Microclimate[] = [
  { id: 'm1', title: 'Weekly pulse', companyId: 'c1', status: 'active', responseCount: 3, targetParticipantCount: 10, createdAt: '2026-01-01' },
  { id: 'm2', title: 'Draft survey', companyId: 'c1', status: 'draft', responseCount: 0, targetParticipantCount: 5, createdAt: '2026-01-02' },
]

function renderPage() {
  return render(
    <MemoryRouter>
      <MicroclimatesListPage />
    </MemoryRouter>,
  )
}

describe('MicroclimatesListPage', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://api.test')
    setToken(makeToken({ sub: 'user-1', role: 'company_admin', companyId: 'c1' }))
    mockListMicroclimates.mockReset()
    mockCreateMicroclimate.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    clearToken()
  })

  it('shows an alert and never calls the API when the JWT has no companyId claim', async () => {
    setToken(makeToken({ sub: 'user-1', role: 'company_admin' }))
    mockListMicroclimates.mockResolvedValue(microclimates)

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to determine your company. Please log in again.')
    expect(mockListMicroclimates).not.toHaveBeenCalled()
  })

  it('shows an alert and never calls the API when there is no stored token at all', async () => {
    clearToken()
    mockListMicroclimates.mockResolvedValue(microclimates)

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to determine your company. Please log in again.')
    expect(mockListMicroclimates).not.toHaveBeenCalled()
  })

  it('loads and renders microclimates for the company derived from the JWT on mount', async () => {
    mockListMicroclimates.mockResolvedValue(microclimates)

    renderPage()

    expect(await screen.findByText('Weekly pulse')).toBeInTheDocument()
    expect(screen.getByText('Draft survey')).toBeInTheDocument()
    expect(mockListMicroclimates).toHaveBeenCalledWith('http://api.test', 'c1')
    expect(mockListMicroclimates).toHaveBeenCalledTimes(1)
  })

  it('surfaces an error alert when loading fails', async () => {
    mockListMicroclimates.mockRejectedValue(new Error('network down'))

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('network down')
  })

  it('filters the rendered list by the selected status without re-fetching', async () => {
    const user = userEvent.setup()
    mockListMicroclimates.mockResolvedValue(microclimates)

    renderPage()
    await screen.findByText('Weekly pulse')

    await user.selectOptions(screen.getByRole('combobox'), 'draft')

    expect(screen.queryByText('Weekly pulse')).not.toBeInTheDocument()
    expect(screen.getByText('Draft survey')).toBeInTheDocument()
    expect(mockListMicroclimates).toHaveBeenCalledTimes(1)
  })

  it('toggles the create form visibility when the "New microclimate" button is clicked', async () => {
    const user = userEvent.setup()
    mockListMicroclimates.mockResolvedValue([])

    renderPage()
    await screen.findByText('No microclimates found.')

    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'New microclimate' }))
    expect(screen.getByLabelText('Title')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
  })

  it('creates a microclimate, hides the form, and reloads the list on success', async () => {
    const user = userEvent.setup()
    mockListMicroclimates.mockResolvedValueOnce([]).mockResolvedValueOnce(microclimates)
    mockCreateMicroclimate.mockResolvedValue({
      id: 'm3', title: 'Weekly pulse', description: null, companyId: 'c1', createdBy: 'u1', status: 'draft',
      responseCount: 0, targetParticipantCount: 10, startTime: '2026-01-01T09:00', endTime: '2026-01-01T10:00',
      anonymousResponses: true, showLiveResults: false, questions: [],
    })

    renderPage()
    await screen.findByText('No microclimates found.')

    await user.click(screen.getByRole('button', { name: 'New microclimate' }))
    await user.type(screen.getByLabelText('Title'), 'Weekly pulse')

    const form = screen.getByLabelText('Title').closest('form') as HTMLFormElement
    fireEvent.change(within(form).getByLabelText('Start time'), { target: { value: '2026-01-01T09:00' } })
    fireEvent.change(within(form).getByLabelText('End time'), { target: { value: '2026-01-01T10:00' } })

    await user.click(screen.getByRole('button', { name: 'Create microclimate' }))

    await waitFor(() => expect(mockCreateMicroclimate).toHaveBeenCalledTimes(1))
    expect(mockCreateMicroclimate).toHaveBeenCalledWith('http://api.test', {
      title: 'Weekly pulse',
      companyId: 'c1',
      startTime: '2026-01-01T09:00',
      endTime: '2026-01-01T10:00',
      targetParticipantCount: 10,
      anonymousResponses: true,
      questions: [],
    })

    await waitFor(() => expect(mockListMicroclimates).toHaveBeenCalledTimes(2))
    await screen.findByText('Weekly pulse')
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
  })

  it('keeps the form open and shows the error when creation fails', async () => {
    const user = userEvent.setup()
    mockListMicroclimates.mockResolvedValue([])
    mockCreateMicroclimate.mockRejectedValue(new Error('Title is required'))

    renderPage()
    await screen.findByText('No microclimates found.')

    await user.click(screen.getByRole('button', { name: 'New microclimate' }))

    await user.type(screen.getByLabelText('Title'), 'Weekly pulse')
    const form = screen.getByLabelText('Title').closest('form') as HTMLFormElement
    fireEvent.change(within(form).getByLabelText('Start time'), { target: { value: '2026-01-01T09:00' } })
    fireEvent.change(within(form).getByLabelText('End time'), { target: { value: '2026-01-01T10:00' } })

    await user.click(screen.getByRole('button', { name: 'Create microclimate' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Title is required')
    expect(screen.getByLabelText('Title')).toBeInTheDocument()
    expect(mockListMicroclimates).toHaveBeenCalledTimes(1)
  })
})
