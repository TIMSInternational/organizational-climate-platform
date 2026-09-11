import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../../../i18n'
import { setToken, clearToken } from '../../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../../company-context'
import { tokenFor } from '../../../../test/jwtFixture'
import { getSurveyTemplate, listSurveyTemplates, type SurveyTemplateDetail, type SurveyTemplateListItem } from '../../api/surveyTemplates'
import SurveyTemplatesNextPage from './SurveyTemplatesNextPage'
import en from '../../../../i18n/en.json'

const copy = en.surveys.next.templates

vi.mock('../../api/surveyTemplates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveyTemplates')>()),
  listSurveyTemplates: vi.fn(),
  getSurveyTemplate: vi.fn(),
}))

function item(id: string, name: string, category: string, usageCount: number): SurveyTemplateListItem {
  return {
    id, name, description: `${name} description`, category, industry: null, companySize: null, isPublic: false, companyId: 'c1', isGlobal: false,
    tags: [], usageCount, rating: 0, questionCount: 2, lastUsed: null, createdAt: '2026-01-01T00:00:00Z',
  }
}

const question = (order: number, category: string | null) => ({
  id: `q${order}`, text: 'Q', type: 'likert', options: null, scaleMin: 1, scaleMax: 5, scaleLabelMin: null, scaleLabelMax: null,
  required: true, commentRequired: false, commentPrompt: null, order, category,
})

function renderAs(claims: Record<string, unknown>) {
  setToken(tokenFor({ sub: 'u1', nodoId: '', ...claims }))
  return render(
    <TranslationProvider>
      <CompanyContextProvider>
        <MemoryRouter initialEntries={['/surveys/templates']}>
          <SurveyTemplatesNextPage />
        </MemoryRouter>
      </CompanyContextProvider>
    </TranslationProvider>,
  )
}

describe('SurveyTemplatesNextPage (/surveys/templates)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('preferredLocale', 'en')
    vi.mocked(listSurveyTemplates).mockReset().mockResolvedValue([item('clima', 'Climate standard', 'climate', 0), item('pulso', 'Engagement pulse', 'pulse', 1)])
    vi.mocked(getSurveyTemplate).mockReset().mockImplementation(async (_base, id) =>
      id === 'clima'
        ? ({ questions: [question(1, 'trust'), question(2, 'workload')] } as unknown as SurveyTemplateDetail)
        : Promise.reject(new Error('boom')),
    )
  })
  afterEach(() => {
    cleanup()
    clearToken()
    window.localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  })

  it('orders by use, counts every category the artboard offers — zero included — and reads dimensions and scale from the questions', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    expect(await screen.findByRole('heading', { name: '2 templates' })).toBeTruthy()
    const names = [...document.querySelectorAll('[data-slot="template-card"] h3')].map((node) => node.textContent)
    expect(names).toEqual(['Engagement pulse', 'Climate standard'])
    const chips = [...document.querySelectorAll('[data-slot="category-chip"]')].map((node) => node.textContent)
    expect(chips).toEqual(['All 2', 'Climate 1', 'Pulse 1', 'Engagement 0', 'Exit 0'])
    expect(screen.getByText('Climate · 2 questions · Likert 1–5')).toBeTruthy()
    expect(screen.getByText('Trust · Workload')).toBeTruthy()
    expect(screen.getByText(copy.dimensionsUnavailable)).toBeTruthy()
  })

  it('offers "Use" only to a viewer who may author a survey', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByRole('heading', { name: '2 templates' })
    expect(screen.getAllByRole('link', { name: copy.use })[0].getAttribute('href')).toBe('/surveys/new?template=pulso')
    cleanup()

    renderAs({ role: 'super_admin' })
    await screen.findByRole('heading', { name: '2 templates' })
    expect(screen.queryByRole('link', { name: copy.use })).toBeNull()
    expect(screen.getAllByRole('link', { name: copy.preview })).toHaveLength(2)
  })

  it('pushes the search to the server as q, and filters the category on the chips', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByRole('heading', { name: '2 templates' })
    await userEvent.type(screen.getByRole('searchbox'), 'pulse')
    await userEvent.click(screen.getByRole('button', { name: en.common.filter }))
    expect(vi.mocked(listSurveyTemplates).mock.calls.at(-1)?.[1]).toEqual({ q: 'pulse' })
    await screen.findByRole('heading', { name: '2 templates' })
    await userEvent.click(screen.getByRole('button', { name: 'Climate 1' }))
    expect(screen.getByRole('heading', { name: '1 templates' })).toBeTruthy()
  })
})
