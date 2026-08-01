import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MicroclimateList from './MicroclimateList'
import type { Microclimate } from '../api/microclimates'

function renderWithRouter(microclimates: Microclimate[]) {
  return render(
    <MemoryRouter>
      <MicroclimateList microclimates={microclimates} />
    </MemoryRouter>,
  )
}

describe('MicroclimateList', () => {
  it('shows an empty-state message when there are no microclimates', () => {
    renderWithRouter([])

    expect(screen.getByText('No microclimates found.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('renders a row per microclimate with title link, status, and response counts', () => {
    const microclimates: Microclimate[] = [
      { id: 'm1', title: 'Weekly pulse', companyId: 'c1', status: 'active', responseCount: 3, targetParticipantCount: 10, createdAt: '2026-01-01' },
      { id: 'm2', title: 'Monthly check-in', companyId: 'c1', status: 'draft', responseCount: 0, targetParticipantCount: 5, createdAt: '2026-01-02' },
    ]
    renderWithRouter(microclimates)

    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(3) // header + 2 data rows

    const link1 = screen.getByRole('link', { name: 'Weekly pulse' })
    expect(link1).toHaveAttribute('href', '/microclimates/m1')

    const link2 = screen.getByRole('link', { name: 'Monthly check-in' })
    expect(link2).toHaveAttribute('href', '/microclimates/m2')

    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.getByText('draft')).toBeInTheDocument()
    expect(screen.getByText('3 / 10')).toBeInTheDocument()
    expect(screen.getByText('0 / 5')).toBeInTheDocument()
  })
})
