import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider } from '../../../company-context'
import { tokenFor } from '../../../test/jwtFixture'
import { getQuestionLibraryItem, listQuestionCategories, listQuestionLibraryItems, type QuestionCategory, type QuestionLibraryItem, type QuestionLibraryItemDetail } from '../api/questionLibrary'
import { listQuestionBankCategories, listQuestionBankEffectiveness, listQuestionBankItems, type QuestionBankItem } from '../api/questionBank'
import { createQuestionLibraryItem, updateQuestionLibraryItem } from '../api/questionLibraryAdmin'
import QuestionBankNextPage from './QuestionBankNextPage'
import QuestionLibraryNextPage from './QuestionLibraryNextPage'
import { bankRows, categoryTree, libraryTypeLabel } from './model'
import en from '../../../i18n/en.json'

vi.mock('../api/questionLibrary', async (orig) => ({
  ...(await orig<typeof import('../api/questionLibrary')>()),
  listQuestionCategories: vi.fn(),
  listQuestionLibraryItems: vi.fn(),
  getQuestionLibraryItem: vi.fn().mockRejectedValue(new Error('not needed')),
}))
vi.mock('../api/questionBank', async (orig) => ({
  ...(await orig<typeof import('../api/questionBank')>()),
  listQuestionBankItems: vi.fn(),
  listQuestionBankCategories: vi.fn(),
  listQuestionBankEffectiveness: vi.fn(),
}))
vi.mock('../api/questionLibraryAdmin', async (orig) => ({
  ...(await orig<typeof import('../api/questionLibraryAdmin')>()),
  createQuestionLibraryItem: vi.fn(),
  updateQuestionLibraryItem: vi.fn(),
}))
vi.mock('../../../company-context/useCompanyName', () => ({
  useCompanyName: () => 'Grupo Meridiano S.A.',
  clearCompanyNameCache: () => {},
}))

const bank = en.questionBank.next
const lib = en.questionLibrary.next
const COMPANY = 'c1'

const cat = (over: Partial<QuestionCategory>): QuestionCategory => ({
  id: 'x', companyId: null, parentCategoryId: null, nameEn: 'X', nameEs: 'X', descriptionEn: null, descriptionEs: null,
  order: 1, icon: null, color: null, isActive: true, itemCount: 0, ...over,
})
const item = (over: Partial<QuestionLibraryItem>): QuestionLibraryItem => ({
  id: 'i', companyId: null, questionCategoryId: 'lead', textEn: 'EN', textEs: 'ES', type: 'likert', dimension: 'Liderazgo',
  usageCount: 0, lastUsedAt: null, isActive: true, version: 1, tags: [], ...over,
})
const categories = [cat({ id: 'lead', nameEn: 'Leadership', order: 1 }), cat({ id: 'fb', nameEn: 'Feedback', parentCategoryId: 'lead', order: 1 }), cat({ id: 'comm', nameEn: 'Communication', order: 2 })]
const items = [
  item({ id: 'a', textEn: 'Global lead A' }),
  item({ id: 'b', textEn: 'Global lead B' }),
  item({ id: 'c', questionCategoryId: 'fb', textEn: 'Global feedback C' }),
  item({ id: 'd', questionCategoryId: 'fb', textEn: 'Own feedback D', companyId: COMPANY }),
]

function renderAs(ui: React.ReactNode, role = 'company_admin') {
  setToken(tokenFor({ sub: 'u1', nodoId: '', role, companyId: COMPANY }))
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <CompanyContextProvider>{ui}</CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

afterEach(() => {
  cleanup()
  clearToken()
  vi.clearAllMocks()
})

describe('question models', () => {
  it('rolls a parent category count up over its children', () => {
    const tree = categoryTree(categories, items)
    expect(tree.globals.map((n) => [n.category.id, n.count])).toEqual([['lead', 4], ['comm', 0]])
    expect(tree.globals[0].children[0].count).toBe(2)
  })

  it('derives skipped from asked minus answered, and a missing measurement as null — never 0', () => {
    const bankItem = { id: 'q', companyId: null } as QuestionBankItem
    const [measured] = bankRows([bankItem], [{ questionBankItemId: 'q', text: null, language: 'es', category: 'c', subcategory: null, isActive: true, metrics: { questionBankItemId: 'q', surveysUsedIn: 1, questionsCreated: 1, timesAsked: 10, timesAnswered: 4, responseRate: 40, skipRate: 60, averageTimeSpentSeconds: null, lastUsedAt: null } }])
    expect([measured.asked, measured.answered, measured.skipped, measured.attention]).toEqual([10, 4, 6, true])
    const [unmeasured] = bankRows([bankItem], [])
    expect([unmeasured.asked, unmeasured.skipped, unmeasured.attention]).toEqual([null, null, false])
  })
})

describe('QuestionBankNextPage', () => {
  it('explains the split with counted library figures and says when an empty bank fills', async () => {
    vi.mocked(listQuestionBankItems).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listQuestionBankCategories).mockResolvedValue([])
    vi.mocked(listQuestionBankEffectiveness).mockResolvedValue([])
    vi.mocked(listQuestionCategories).mockResolvedValue(categories)
    vi.mocked(listQuestionLibraryItems).mockResolvedValue(items)
    renderAs(<QuestionBankNextPage />)
    expect(await screen.findByText(bank.emptyTitle)).toBeTruthy()
    // The board's eyebrow: "PROPUESTA · GRUPO MERIDIANO S.A." (uppercased by CSS).
    expect(screen.getByText(`${en.insights.next.proposal} · Grupo Meridiano S.A.`)).toBeTruthy()
    expect(screen.getByText(bank.emptyMeanwhile.replace('{company}', 'Grupo Meridiano S.A.'))).toBeTruthy()
    // 3 of the 4 items and all 3 categories are global.
    expect(screen.getByText(new RegExp(bank.splitCounts.replace('{questions}', '3').replace('{categories}', '3')))).toBeTruthy()
  })

  it('offers retire only on rows the server lets this role write', async () => {
    vi.mocked(listQuestionBankItems).mockResolvedValue({
      items: [
        { id: 'g', companyId: null, text: 'Global row', type: 'likert', category: 'trust', isActive: true } as QuestionBankItem,
        { id: 'o', companyId: COMPANY, text: 'Own row', type: 'likert', category: 'trust', isActive: true } as QuestionBankItem,
      ],
      total: 2,
    })
    vi.mocked(listQuestionBankCategories).mockResolvedValue([])
    vi.mocked(listQuestionBankEffectiveness).mockResolvedValue([])
    vi.mocked(listQuestionCategories).mockResolvedValue(categories)
    vi.mocked(listQuestionLibraryItems).mockResolvedValue(items)
    renderAs(<QuestionBankNextPage />)
    const rows = await screen.findAllByTestId('bank-row')
    expect(within(rows[0]).queryByRole('button', { name: bank.retire })).toBeNull()
    expect(within(rows[1]).getByRole('button', { name: bank.retire })).toBeTruthy()
    expect(within(rows[0]).getAllByRole('cell')[4].textContent).toBe('—')
  })
})

describe('QuestionLibraryNextPage', () => {
  function arrange() {
    vi.mocked(listQuestionCategories).mockResolvedValue(categories)
    vi.mocked(listQuestionLibraryItems).mockResolvedValue(items)
  }

  it('opens global rows read-only for a company administrator and their own rows for editing', async () => {
    arrange()
    renderAs(<QuestionLibraryNextPage />)
    const rows = await screen.findAllByTestId('library-row')
    expect(rows.map((row) => within(row).getByRole('button').textContent)).toEqual([lib.view, lib.view, lib.view, lib.edit])
    expect(screen.getByText(lib.subcategoryOf.replace('{parent}', 'Leadership').replace('{count}', '2'))).toBeTruthy()
  })

  it('lets a super administrator edit a global row', async () => {
    arrange()
    renderAs(<QuestionLibraryNextPage />, 'super_admin')
    const rows = await screen.findAllByTestId('library-row')
    expect(within(rows[0]).getByRole('button').textContent).toBe(lib.edit)
  })

  it('creates a question in both languages, owned by the caller company', async () => {
    arrange()
    vi.mocked(createQuestionLibraryItem).mockResolvedValue({} as never)
    renderAs(<QuestionLibraryNextPage />)
    await userEvent.click(await screen.findByRole('button', { name: lib.newQuestion }))
    await userEvent.type(screen.getByLabelText(new RegExp(lib.textEs.replace(/[()]/g, '\\$&'))), 'Pregunta')
    await userEvent.type(screen.getByLabelText(new RegExp(lib.textEn.replace(/[()]/g, '\\$&'))), 'Question')
    await userEvent.click(screen.getByRole('button', { name: lib.createQuestion }))
    expect(vi.mocked(createQuestionLibraryItem).mock.calls[0][1]).toMatchObject({ questionCategoryId: 'lead', textEs: 'Pregunta', textEn: 'Question', type: 'likert', companyId: COMPANY })
  })

  it('offers no authoring control to a role that cannot write', async () => {
    arrange()
    renderAs(<QuestionLibraryNextPage />, 'leader')
    await screen.findAllByTestId('library-row')
    expect(screen.queryByRole('button', { name: lib.newQuestion })).toBeNull()
    expect(screen.queryByRole('button', { name: lib.newCategory })).toBeNull()
  })
})

describe('QuestionLibraryNextPage — drawer link, multiple choice, vocabulary', () => {
  function renderLibraryAt(path: string, role = 'company_admin') {
    setToken(tokenFor({ sub: 'u1', nodoId: '', role, companyId: COMPANY }))
    return render(
      <TranslationProvider>
        <MemoryRouter initialEntries={[path]}>
          <CompanyContextProvider>
            <QuestionLibraryNextPage />
          </CompanyContextProvider>
        </MemoryRouter>
      </TranslationProvider>,
    )
  }
  function arrange() {
    vi.mocked(listQuestionCategories).mockResolvedValue(categories)
    vi.mocked(listQuestionLibraryItems).mockResolvedValue(items)
  }
  const label = (text: string) => new RegExp(`^${text.replace(/[()]/g, '\\$&')}`)

  it('opens the create drawer from ?new=1 for a company administrator', async () => {
    arrange()
    renderLibraryAt('/admin/question-library?new=1')
    expect(await screen.findByRole('button', { name: lib.createQuestion })).toBeTruthy()
    const drawer = screen.getByRole('complementary')
    const list = drawer.parentElement?.querySelector('section')
    // Below xl the drawer spans both columns instead of the 14rem category column.
    expect(drawer.className.split(' ')).toContain('lg:col-span-2')
    // From xl it overlays the list, as the board draws it: the list's own grid cell, pinned to
    // its right edge at the board's 392px, painted above the rows. happy-dom has no layout, so
    // the classes are the pin and library-new-light.png is the evidence.
    expect(drawer.className.split(' ')).toEqual(
      expect.arrayContaining(['xl:col-[2]', 'xl:row-[1]', 'xl:justify-self-end', 'xl:w-[24.5rem]', 'xl:z-1']),
    )
    expect(list?.className.split(' ')).toEqual(expect.arrayContaining(['xl:col-[2]', 'xl:row-[1]']))
    // …and never as a third column that narrows the list.
    expect(drawer.parentElement?.className ?? '').not.toMatch(/xl:grid-cols-/)
  })

  it('opens nothing from ?new=1 for a role that cannot write', async () => {
    arrange()
    renderLibraryAt('/admin/question-library?new=1', 'leader')
    await screen.findAllByTestId('library-row')
    expect(screen.queryByRole('button', { name: lib.createQuestion })).toBeNull()
  })

  it('offers multiple choice, refuses it without options, and sends the options it is given', async () => {
    arrange()
    vi.mocked(createQuestionLibraryItem).mockResolvedValue({} as never)
    renderAs(<QuestionLibraryNextPage />)
    await userEvent.click(await screen.findByRole('button', { name: lib.newQuestion }))
    await userEvent.type(screen.getByLabelText(label(lib.textEs)), 'Pregunta')
    await userEvent.type(screen.getByLabelText(label(lib.textEn)), 'Question')
    await userEvent.selectOptions(screen.getByLabelText(label(lib.type)), 'multiple_choice')
    await userEvent.click(screen.getByRole('button', { name: lib.createQuestion }))
    expect(screen.getByText(en.questionLibraryAdmin.optionsRequired)).toBeTruthy()
    expect(createQuestionLibraryItem).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText(label(en.questionLibraryAdmin.options)), 'Daily{enter}Weekly')
    await userEvent.click(screen.getByRole('button', { name: lib.createQuestion }))
    expect(vi.mocked(createQuestionLibraryItem).mock.calls[0][1]).toMatchObject({
      type: 'multiple_choice',
      options: [{ labelEn: 'Daily', labelEs: 'Daily' }, { labelEn: 'Weekly', labelEs: 'Weekly' }],
    })
  })

  it('sends an edited multiple-choice question back with its options verbatim — keys and both languages', async () => {
    arrange()
    const own = item({ id: 'mc', companyId: COMPANY, type: 'multiple_choice', textEn: 'Own MC' })
    vi.mocked(listQuestionLibraryItems).mockResolvedValue([own])
    vi.mocked(getQuestionLibraryItem).mockResolvedValueOnce({
      ...own, language: 'both', scaleMin: null, scaleMax: null, scaleLabelMinEn: null, scaleLabelMinEs: null, scaleLabelMaxEn: null, scaleLabelMaxEs: null,
      previousVersionId: null, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
      options: [{ order: 0, value: 'yes-key', labelEn: 'Yes', labelEs: 'Sí' }],
    } as QuestionLibraryItemDetail)
    vi.mocked(updateQuestionLibraryItem).mockResolvedValue({} as never)
    renderAs(<QuestionLibraryNextPage />)
    const [row] = await screen.findAllByTestId('library-row')
    await userEvent.click(within(row).getByRole('button', { name: lib.edit }))
    await screen.findByDisplayValue('Yes')
    await userEvent.type(screen.getByLabelText(label(lib.textEn)), ' edited')
    await userEvent.click(screen.getByRole('button', { name: en.common.save }))
    expect(vi.mocked(updateQuestionLibraryItem).mock.calls[0][2]).toMatchObject({
      textEn: 'Own MC edited',
      options: [{ value: 'yes-key', labelEn: 'Yes', labelEs: 'Sí' }],
    })
  })

  it('keeps the bank search, both selects and the retired toggle on one line — no label margin under the flex row', async () => {
    vi.mocked(listQuestionBankItems).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listQuestionBankCategories).mockResolvedValue([])
    vi.mocked(listQuestionBankEffectiveness).mockResolvedValue([])
    arrange()
    renderAs(<QuestionBankNextPage />)
    await screen.findByText(bank.emptyTitle)
    // index.css gives every <label> a 12px bottom margin; centred in the row, that lifted the
    // search 6px above the selects (bank-light.png). happy-dom has no layout: the class is the pin.
    expect(screen.getByPlaceholderText(bank.searchPlaceholder).closest('label')?.className.split(' ')).toContain('mb-0')
    expect(screen.getByRole('switch').closest('label')?.className.split(' ')).toContain('mb-0')
  })

  it('names rating as the library board does, and every other type by the shared vocabulary', () => {
    expect(libraryTypeLabel((key) => key, 'rating')).toBe('questionLibrary.next.ratingType')
    expect(libraryTypeLabel((key) => key, 'likert')).toBe('surveys.questionTypeLikert')
  })

  it('heads the page with the proposal eyebrow and the company, and sits the search on the row', async () => {
    arrange()
    renderAs(<QuestionLibraryNextPage />)
    expect(await screen.findByText(`${en.insights.next.proposal} · Grupo Meridiano S.A.`)).toBeTruthy()
    expect(screen.getByPlaceholderText(lib.search).className.split(' ')).toContain('mt-0')
    // …and runs the row to the type select: index.css caps every `label > input` at the field
    // max, and the board's search is `width: 100%` (library-light.png is the evidence).
    expect(screen.getByPlaceholderText(lib.search).className.split(' ')).toContain('max-w-none')
  })
})
