import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import MicroclimateDetailPage from './MicroclimateDetailPage'
import { getMicroclimate, updateMicroclimate } from '../api/microclimates'
import type { MicroclimateDetail } from '../api/microclimates'

vi.mock('../api/microclimates', () => ({
  getMicroclimate: vi.fn(),
  updateMicroclimate: vi.fn(),
}))

// LiveResultsPanel polls on its own interval and is exercised by its own tests --
// stub it here so this page's tests stay focused on the detail/status behavior.
vi.mock('../components/LiveResultsPanel', () => ({
  default: () => <div>live-results-panel</div>,
}))

const mockGetMicroclimate = vi.mocked(getMicroclimate)
const mockUpdateMicroclimate = vi.mocked(updateMicroclimate)

const detail: MicroclimateDetail = {
  id: 'm1',
  title: 'Weekly pulse',
  description: null,
  companyId: 'c1',
  createdBy: 'u1',
  status: 'draft',
  responseCount: 0,
  targetParticipantCount: 10,
  startTime: '2026-01-01T09:00',
  endTime: '2026-01-01T10:00',
  anonymousResponses: true,
  showLiveResults: false,
  questions: [],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/microclimates/m1']}>
      <Routes>
        <Route path="/microclimates/:id" element={<MicroclimateDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('MicroclimateDetailPage', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://api.test')
    mockGetMicroclimate.mockReset()
    mockUpdateMicroclimate.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('loads and renders the microclimate on mount', async () => {
    mockGetMicroclimate.mockResolvedValue(detail)

    renderPage()

    expect(await screen.findByText('Weekly pulse')).toBeInTheDocument()
    expect(mockGetMicroclimate).toHaveBeenCalledWith('http://api.test', 'm1')
    expect(screen.getByRole('combobox')).toHaveValue('draft')
  })

  it('surfaces an error alert when the initial load fails', async () => {
    mockGetMicroclimate.mockRejectedValue(new Error('not found'))

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('not found')
  })

  it('updates the status and reloads on success', async () => {
    const user = userEvent.setup()
    mockGetMicroclimate.mockResolvedValueOnce(detail).mockResolvedValueOnce({ ...detail, status: 'active' })
    mockUpdateMicroclimate.mockResolvedValue({ ...detail, status: 'active' })

    renderPage()
    await screen.findByText('Weekly pulse')

    await user.selectOptions(screen.getByRole('combobox'), 'active')

    expect(mockUpdateMicroclimate).toHaveBeenCalledWith('http://api.test', 'm1', { status: 'active' })
    expect(await screen.findByRole('combobox')).toHaveValue('active')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('surfaces an alert and resets the select to the server value when the status change fails', async () => {
    const user = userEvent.setup()
    mockGetMicroclimate.mockResolvedValue(detail)
    mockUpdateMicroclimate.mockRejectedValue(new Error('Forbidden'))

    renderPage()
    await screen.findByText('Weekly pulse')

    await user.selectOptions(screen.getByRole('combobox'), 'active')

    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden')
    expect(screen.getByRole('combobox')).toHaveValue('draft')
    // Only the initial load call plus the failed update -- reload() must not
    // have run a second time after the rejected update.
    expect(mockGetMicroclimate).toHaveBeenCalledTimes(1)
  })

  it('clears a previous status error once a subsequent status change succeeds', async () => {
    const user = userEvent.setup()
    mockGetMicroclimate.mockResolvedValueOnce(detail).mockResolvedValueOnce({ ...detail, status: 'active' })
    mockUpdateMicroclimate.mockRejectedValueOnce(new Error('Forbidden')).mockResolvedValueOnce({ ...detail, status: 'active' })

    renderPage()
    await screen.findByText('Weekly pulse')

    await user.selectOptions(screen.getByRole('combobox'), 'active')
    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden')

    await user.selectOptions(screen.getByRole('combobox'), 'active')

    expect(await screen.findByRole('combobox')).toHaveValue('active')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
