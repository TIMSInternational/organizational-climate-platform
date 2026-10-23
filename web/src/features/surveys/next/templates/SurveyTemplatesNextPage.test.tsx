import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { TranslationProvider } from '../../../../i18n'
import { setToken, clearToken } from '../../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../../company-context'
import { tokenFor } from '../../../../test/jwtFixture'
import {
  createSurveyTemplate,
  deleteSurveyTemplate,
  getSurveyTemplate,
  updateSurveyTemplate,
  listSurveyTemplates,
  type SurveyTemplateDetail,
  type SurveyTemplateListItem,
} from '../../api/surveyTemplates'
import { getSurvey, listSurveys, type SurveyDetail, type SurveyListItem } from '../../api/surveys'
import SurveyTemplatesNextPage from './SurveyTemplatesNextPage'
import en from '../../../../i18n/en.json'

const copy = en.surveys.next.templates

vi.mock('../../api/surveyTemplates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveyTemplates')>()),
  listSurveyTemplates: vi.fn(),
  getSurveyTemplate: vi.fn(),
  createSurveyTemplate: vi.fn(),
  updateSurveyTemplate: vi.fn(),
  deleteSurveyTemplate: vi.fn(),
}))
vi.mock('../../api/surveys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveys')>()),
  listSurveys: vi.fn(),
  getSurvey: vi.fn(),
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

/** Meridiano's running Q4 as `GET /surveys` lists it (`language: "both"`, six questions). */
const q4: SurveyListItem = {
  id: 's-q4', title: 'Q4 Climate Survey (open)', companyId: 'c1', type: 'periodic', status: 'active', language: 'both',
  startDate: '2026-09-03T02:03:39Z', endDate: '2026-10-10T02:03:39Z', responseCount: 3, targetAudienceCount: 24, questionCount: 6,
  createdAt: '2026-09-10T02:03:39Z',
}
const empty: SurveyListItem = { ...q4, id: 's-empty', title: 'Draft with no questions', questionCount: 0 }

/** `GET /surveys/s-q4?lang=` — its first question as the API resolves it in each language. */
function q4Detail(lang: string): SurveyDetail {
  const spanish = lang === 'es'
  return {
    fallbackFields: [],
    questions: [
      {
        id: 'q-safety', text: spanish ? 'Puedo plantear preocupaciones sin miedo a represalias.' : 'I can raise concerns without fear of retaliation.',
        type: 'likert', options: null, scaleMin: 1, scaleMax: 5, scaleLabelMin: null, scaleLabelMax: null, required: true, commentRequired: true,
        commentPrompt: null, order: 0, category: 'psychological_safety',
      },
    ],
  } as unknown as SurveyDetail
}

function TemplatePage() {
  const { id } = useParams()
  return <p>{`template page ${id}`}</p>
}

function renderAs(claims: Record<string, unknown>) {
  setToken(tokenFor({ sub: 'u1', nodoId: '', ...claims }))
  return render(
    <TranslationProvider>
      <CompanyContextProvider>
        <MemoryRouter initialEntries={['/surveys/templates']}>
          <Routes>
            <Route path="/surveys/templates" element={<SurveyTemplatesNextPage />} />
            <Route path="/surveys/templates/:id" element={<TemplatePage />} />
          </Routes>
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
    vi.mocked(createSurveyTemplate).mockReset().mockResolvedValue({ id: 'new-1' } as SurveyTemplateDetail)
    vi.mocked(updateSurveyTemplate).mockReset().mockResolvedValue({ id: 'clima' } as SurveyTemplateDetail)
    vi.mocked(deleteSurveyTemplate).mockReset().mockResolvedValue(undefined)
    vi.mocked(listSurveys).mockReset().mockResolvedValue([q4, empty])
    vi.mocked(getSurvey).mockReset().mockImplementation(async (_base, _id, lang) => q4Detail(lang ?? 'en'))
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

  it('prints no category count while the list request has failed — never “All 0” for templates it could not read', async () => {
    vi.mocked(listSurveyTemplates).mockRejectedValue(new Error('boom'))
    renderAs({ role: 'company_admin', companyId: 'c1' })
    expect(await screen.findByText(copy.loadFailed)).toBeTruthy()
    expect(document.querySelectorAll('[data-slot="category-chip"]')).toHaveLength(0)
    expect(screen.queryByRole('group', { name: copy.categoriesLabel })).toBeNull()
  })

  it('counts in Spanish singulars: one “plantilla”, one “pregunta”', async () => {
    window.localStorage.setItem('preferredLocale', 'es')
    vi.mocked(listSurveyTemplates).mockResolvedValue([{ ...item('uno', 'Pulso corto', 'pulse', 0), questionCount: 1 }])
    renderAs({ role: 'company_admin', companyId: 'c1' })
    expect(await screen.findByRole('heading', { name: '1 plantilla' })).toBeTruthy()
    expect(screen.getByText('Pulso · 1 pregunta')).toBeTruthy()
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
    expect(screen.getByRole('heading', { name: '1 template' })).toBeTruthy()
  })

  it('makes a new template from a survey’s questions — each language read, one POST naming this company, then the new template’s page', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await userEvent.click(await screen.findByRole('button', { name: copy.newTemplate }))
    const dialog = await screen.findByRole('dialog')
    const from = (await within(dialog).findByLabelText(new RegExp(copy.newFromSurvey))) as HTMLSelectElement
    // Only surveys that have questions to copy are offered.
    expect([...from.options].map((option) => option.value)).toEqual(['', 's-q4'])
    await userEvent.selectOptions(from, 's-q4')
    const name = within(dialog).getByLabelText(new RegExp(copy.newName)) as HTMLInputElement
    expect(name.value).toBe('Q4 Climate Survey (open)')
    const create = within(dialog).getByRole('button', { name: copy.newCreate }) as HTMLButtonElement
    // The server refuses a template without a description, so the form does too.
    expect(create.disabled).toBe(true)
    await userEvent.type(within(dialog).getByLabelText(new RegExp(copy.newDescriptionLabel)), 'The Q4 questions')
    await userEvent.click(create)

    expect(await screen.findByText('template page new-1')).toBeTruthy()
    expect(vi.mocked(listSurveys).mock.calls[0][1]).toEqual({ companyId: 'c1' })
    expect(vi.mocked(getSurvey).mock.calls.map((call) => [call[1], call[2]])).toEqual([
      ['s-q4', 'en'],
      ['s-q4', 'es'],
    ])
    expect(vi.mocked(createSurveyTemplate)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createSurveyTemplate).mock.calls[0][1]).toEqual({
      name: 'Q4 Climate Survey (open)',
      description: 'The Q4 questions',
      category: 'climate',
      companyId: 'c1',
      sourceSurveyId: 's-q4',
      language: 'both',
      questions: [
        {
          text: { en: 'I can raise concerns without fear of retaliation.', es: 'Puedo plantear preocupaciones sin miedo a represalias.' },
          type: 'likert',
          required: true,
          commentRequired: true,
          order: 0,
          scaleMin: 1,
          scaleMax: 5,
          category: 'psychological_safety',
        },
      ],
    })
  })

  it('offers no "New template" to a super administrator with no company chosen: the only company-less template is a global one', async () => {
    renderAs({ role: 'super_admin' })
    await screen.findByRole('heading', { name: '2 templates' })
    expect(screen.queryByRole('button', { name: copy.newTemplate })).toBeNull()
  })

  it('says so, and stays open, when the server refuses the template', async () => {
    vi.mocked(createSurveyTemplate).mockRejectedValue(new Error('Name, description, and category are required'))
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await userEvent.click(await screen.findByRole('button', { name: copy.newTemplate }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.selectOptions(await within(dialog).findByLabelText(new RegExp(copy.newFromSurvey)), 's-q4')
    await userEvent.type(within(dialog).getByLabelText(new RegExp(copy.newDescriptionLabel)), 'x')
    await userEvent.click(within(dialog).getByRole('button', { name: copy.newCreate }))
    expect(await within(dialog).findByText(copy.newFailed)).toBeTruthy()
    // Still the open dialog, attached to the page — not a detached node that kept its last text
    // (a dialog that closed on the refusal passed the line above).
    expect(dialog.isConnected).toBe(true)
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect((within(dialog).getByRole('button', { name: copy.newCreate }) as HTMLButtonElement).disabled).toBe(false)
    // The server's English sentence is not shown to a Spanish-speaking admin.
    expect(within(dialog).queryByText('Name, description, and category are required')).toBeNull()
  })
  describe('edit and delete (PUT / DELETE /survey-templates/{id})', () => {
    const global = { ...item('global', 'Global instrument', 'climate', 7), companyId: null, isGlobal: true }
    const other = { ...item('ajena', 'Other tenant', 'climate', 0), companyId: 'c2' }

    function detail(fallbackFields: string[] = []): SurveyTemplateDetail {
      return {
        name: 'Climate standard', description: 'Climate standard description', category: 'climate', fallbackFields,
        questions: [question(1, 'trust')],
      } as unknown as SurveyTemplateDetail
    }

    function card(name: string): HTMLElement {
      const heading = screen.getByRole('heading', { name })
      return heading.closest('[data-slot="template-card"]') as HTMLElement
    }

    it('draws Edit and Delete only on a template the viewer may write: a company admin never on a global one', async () => {
      vi.mocked(listSurveyTemplates).mockResolvedValue([item('clima', 'Climate standard', 'climate', 0), global, other])
      renderAs({ role: 'company_admin', companyId: 'c1' })
      await screen.findByRole('heading', { name: '3 templates' })
      expect(within(card('Climate standard')).getByRole('button', { name: 'Edit the template Climate standard' })).toBeTruthy()
      expect(within(card('Climate standard')).getByRole('button', { name: 'Delete the template Climate standard' })).toBeTruthy()
      expect(within(card('Global instrument')).queryByRole('button', { name: /Edit the template|Delete the template/ })).toBeNull()
      expect(within(card('Other tenant')).queryByRole('button', { name: /Edit the template|Delete the template/ })).toBeNull()
      cleanup()

      renderAs({ role: 'super_admin' })
      await screen.findByRole('heading', { name: '3 templates' })
      expect(within(card('Global instrument')).getByRole('button', { name: 'Edit the template Global instrument' })).toBeTruthy()
      expect(within(card('Global instrument')).getByRole('button', { name: 'Delete the template Global instrument' })).toBeTruthy()
    })

    it('edits name, description and category, writing back to the language on screen, then reloads the list', async () => {
      vi.mocked(getSurveyTemplate).mockResolvedValue(detail())
      renderAs({ role: 'company_admin', companyId: 'c1' })
      await screen.findByRole('heading', { name: '2 templates' })
      const loads = vi.mocked(listSurveyTemplates).mock.calls.length
      await userEvent.click(within(card('Climate standard')).getByRole('button', { name: 'Edit the template Climate standard' }))
      const dialog = await screen.findByRole('dialog')
      const name = (await within(dialog).findByLabelText(new RegExp(copy.newName))) as HTMLInputElement
      expect(name.value).toBe('Climate standard')
      expect(within(dialog).getByText(copy.editKeepsSurveys)).toBeTruthy()
      await userEvent.clear(name)
      await userEvent.type(name, 'Climate 2027')
      await userEvent.selectOptions(within(dialog).getByLabelText(new RegExp(copy.newCategory)), 'pulse')
      await userEvent.click(within(dialog).getByRole('button', { name: copy.editSave }))

      expect(vi.mocked(updateSurveyTemplate)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(updateSurveyTemplate).mock.calls[0][1]).toBe('clima')
      expect(vi.mocked(updateSurveyTemplate).mock.calls[0][2]).toEqual({
        name: { en: 'Climate 2027' },
        description: { en: 'Climate standard description' },
        category: 'pulse',
      })
      await screen.findByRole('heading', { name: '2 templates' })
      expect(vi.mocked(listSurveyTemplates).mock.calls.length).toBeGreaterThan(loads)
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('writes a name that was shown from the other language back to that language, never over the reader’s', async () => {
      // Read in English, but the template has only a Spanish name: the server printed it with
      // `name` in fallbackFields. The edit must replace the Spanish half, not invent an English one.
      vi.mocked(getSurveyTemplate).mockResolvedValue(detail(['name']))
      renderAs({ role: 'company_admin', companyId: 'c1' })
      await screen.findByRole('heading', { name: '2 templates' })
      await userEvent.click(within(card('Climate standard')).getByRole('button', { name: 'Edit the template Climate standard' }))
      const dialog = await screen.findByRole('dialog')
      const name = (await within(dialog).findByLabelText(new RegExp(copy.newName))) as HTMLInputElement
      await userEvent.type(name, ' bis')
      await userEvent.click(within(dialog).getByRole('button', { name: copy.editSave }))
      expect(vi.mocked(updateSurveyTemplate).mock.calls[0][2]).toMatchObject({ name: { es: 'Climate standard bis' }, description: { en: 'Climate standard description' } })
    })

    it('refuses a blank name as create does, and keeps the dialog open with its own words when the server refuses', async () => {
      vi.mocked(getSurveyTemplate).mockResolvedValue(detail())
      vi.mocked(updateSurveyTemplate).mockRejectedValue(new Error('Category is required'))
      renderAs({ role: 'company_admin', companyId: 'c1' })
      await screen.findByRole('heading', { name: '2 templates' })
      await userEvent.click(within(card('Climate standard')).getByRole('button', { name: 'Edit the template Climate standard' }))
      const dialog = await screen.findByRole('dialog')
      const name = (await within(dialog).findByLabelText(new RegExp(copy.newName))) as HTMLInputElement
      const save = within(dialog).getByRole('button', { name: copy.editSave }) as HTMLButtonElement
      await userEvent.clear(name)
      expect(save.disabled).toBe(true)
      await userEvent.type(name, 'Renamed')
      await userEvent.click(save)
      expect(await within(dialog).findByText(copy.editFailed)).toBeTruthy()
      expect(screen.getByRole('dialog')).toBe(dialog)
      expect(within(dialog).queryByText('Category is required')).toBeNull()
    })

    it('deletes only after a confirmation that says surveys built from it are kept, then reloads', async () => {
      renderAs({ role: 'company_admin', companyId: 'c1' })
      await screen.findByRole('heading', { name: '2 templates' })
      await userEvent.click(within(card('Engagement pulse')).getByRole('button', { name: 'Delete the template Engagement pulse' }))
      const dialog = await screen.findByRole('alertdialog')
      expect(within(dialog).getByText(copy.deleteBodyOne)).toBeTruthy()
      expect(vi.mocked(deleteSurveyTemplate)).not.toHaveBeenCalled()
      await userEvent.click(within(dialog).getByRole('button', { name: copy.deleteConfirm }))
      expect(vi.mocked(deleteSurveyTemplate).mock.calls.map((call) => call[1])).toEqual(['pulso'])
      await screen.findByRole('heading', { name: '2 templates' })
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })

    it('says so when the delete is refused, in its own words', async () => {
      vi.mocked(deleteSurveyTemplate).mockRejectedValue(new Error('Forbidden'))
      renderAs({ role: 'company_admin', companyId: 'c1' })
      await screen.findByRole('heading', { name: '2 templates' })
      await userEvent.click(within(card('Climate standard')).getByRole('button', { name: 'Delete the template Climate standard' }))
      const dialog = await screen.findByRole('alertdialog')
      expect(within(dialog).getByText(copy.deleteBody.replace('{count}', '0'))).toBeTruthy()
      await userEvent.click(within(dialog).getByRole('button', { name: copy.deleteConfirm }))
      expect(await screen.findByText(copy.deleteFailed)).toBeTruthy()
      expect(screen.queryByText('Forbidden')).toBeNull()
    })
  })
})
