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
import { bankRows, categoryTree, dimensionName, libraryTypeLabel } from './model'
import en from '../../../i18n/en.json'
import es from '../../../i18n/es.json'

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
const RIVAL = 'c2'

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
    const tree = categoryTree(categories, items, COMPANY)
    expect(tree.globals.map((n) => [n.category.id, n.count])).toEqual([['lead', 4], ['comm', 0]])
    expect(tree.globals[0].children[0].count).toBe(2)
  })

  // scripts/shot-fixtures/question-library.json carries a rival tenant's category: whatever the
  // payload holds, another company's row is never drawn, never filed under this company and never
  // counted — not as a category, and not as a question inside a global one.
  it("drops another company's categories and questions before anything is counted", () => {
    const tree = categoryTree(
      [...categories, cat({ id: 'own', companyId: COMPANY, nameEn: 'Own' }), cat({ id: 'rival', companyId: RIVAL, nameEn: 'Rival' })],
      [...items, item({ id: 'r1', questionCategoryId: 'rival', companyId: RIVAL }), item({ id: 'r2', questionCategoryId: 'lead', companyId: RIVAL })],
      COMPANY,
    )
    expect(tree.own.map((n) => n.category.id)).toEqual(['own'])
    expect(tree.globals.map((n) => [n.category.id, n.count])).toEqual([['lead', 4], ['comm', 0]])
    // With no company in scope, only the global rows remain.
    expect(categoryTree([cat({ id: 'own', companyId: COMPANY })], [], undefined).own).toEqual([])
  })

  it('names a dimension in words, and leaves out a code no catalogue knows', () => {
    const tEs = (key: string) => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], es) as string ?? key
    expect(dimensionName('psychological_safety', tEs)).toBe(es.surveyRespond.dimensions.psychological_safety)
    expect(dimensionName('leadership', tEs)).toBe(es.questionLibrary.dimensionNames.leadership)
    expect(dimensionName('operations', tEs)).toBe('Operaciones')
    expect(dimensionName('some_unknown_code', tEs)).toBeNull()
    expect(dimensionName('Comunicación interna', tEs)).toBe('Comunicación interna')
    expect(dimensionName(null, tEs)).toBeNull()
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
    // The board's eyebrow: "GRUPO MERIDIANO S.A." (uppercased by CSS).
    expect(screen.getByText('Grupo Meridiano S.A.')).toBeTruthy()
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
    // Retire changes state, so it lives in the row's trailing overflow menu, not as a link.
    expect(within(rows[0]).queryByRole('button', { name: bank.rowActions.replace('{text}', 'Global row') })).toBeNull()
    expect(within(rows[0]).queryByRole('button', { name: bank.retire })).toBeNull()
    expect(within(rows[1]).queryByRole('button', { name: bank.retire })).toBeNull()
    expect(within(rows[0]).getAllByRole('cell')[4].textContent).toBe('—')
    await userEvent.click(within(rows[1]).getByRole('button', { name: bank.rowActions.replace('{text}', 'Own row') }))
    expect(await screen.findByRole('menuitem', { name: bank.retire })).toBeTruthy()
  })

  // happy-dom applies no media query, so this pins the classes that do the work at 390px: the
  // six secondary columns leave below `sm`, and the question cell's meta line (shown only there)
  // carries owner, category, type and the three counts.
  it('stacks a row as a list cell below sm, keeping every column from sm up', async () => {
    vi.mocked(listQuestionBankItems).mockResolvedValue({
      items: [{ id: 'g', companyId: null, text: 'Global row', type: 'likert', category: 'trust', isActive: true } as QuestionBankItem],
      total: 1,
    })
    vi.mocked(listQuestionBankCategories).mockResolvedValue([])
    vi.mocked(listQuestionBankEffectiveness).mockResolvedValue([])
    vi.mocked(listQuestionCategories).mockResolvedValue(categories)
    vi.mocked(listQuestionLibraryItems).mockResolvedValue(items)
    renderAs(<QuestionBankNextPage />)
    const [row] = await screen.findAllByTestId('bank-row')
    const cells = within(row).getAllByRole('cell')
    // Question, six secondary columns, and the trailing actions cell, which stays at every width.
    expect(cells).toHaveLength(8)
    expect(cells[0].className).not.toContain('hidden')
    expect(cells[7].className.split(/\s+/)).not.toContain('hidden')
    for (const cell of cells.slice(1, 7)) expect(cell.className.split(/\s+/)).toEqual(expect.arrayContaining(['hidden', 'sm:table-cell']))
    const meta = row.querySelector('[data-slot="bank-row-meta"]') as HTMLElement
    expect(meta.className.split(/\s+/)).toContain('sm:hidden')
    expect(within(meta).getByText(bank.ownerGlobal)).toBeTruthy()
    expect(meta.textContent).toContain(`${bank.colAsked} — · ${bank.colAnswered} — · ${bank.colSkipped} —`)
  })
})

describe('QuestionLibraryNextPage', () => {
  function arrange() {
    vi.mocked(listQuestionCategories).mockResolvedValue(categories)
    vi.mocked(listQuestionLibraryItems).mockResolvedValue(items)
  }

  it("never draws or counts another company's category, and names the rail in full", async () => {
    vi.mocked(listQuestionCategories).mockResolvedValue([
      ...categories,
      cat({ id: 'own', companyId: COMPANY, nameEn: 'Own onboarding', order: 3 }),
      cat({ id: 'rival', companyId: RIVAL, nameEn: 'RIVAL TENANT — never drawn', order: 4 }),
    ])
    vi.mocked(listQuestionLibraryItems).mockResolvedValue([...items, item({ id: 'r1', questionCategoryId: 'rival', companyId: RIVAL, textEn: 'Rival question' })])
    renderAs(<QuestionLibraryNextPage />)
    await screen.findAllByTestId('library-row')
    expect(screen.queryByText('RIVAL TENANT — never drawn')).toBeNull()
    expect(screen.queryByText('Rival question')).toBeNull()
    // 3 global categories and 1 of this company's — the rival row is not the second "own" one.
    expect(
      screen.getByText(lib.categoriesSummary.replace('{globals}', '3').replace('{own}', lib.ownSome.replace('{count}', '1'))),
    ).toBeTruthy()
    // A long name wraps to two lines with its full text on hover, never a one-line ellipsis.
    const name = screen.getByTitle('Own onboarding')
    expect(name.className.split(' ')).toEqual(expect.arrayContaining(['line-clamp-2']))
    expect(name.className.split(' ')).not.toContain('truncate')
  })

  it("prints a row's dimension in words, never its code", async () => {
    vi.mocked(listQuestionCategories).mockResolvedValue(categories)
    vi.mocked(listQuestionLibraryItems).mockResolvedValue([
      item({ id: 'a', textEn: 'Coded dimension', dimension: 'psychological_safety' }),
      item({ id: 'b', textEn: 'Unknown code', dimension: 'some_unknown_code' }),
    ])
    renderAs(<QuestionLibraryNextPage />)
    const rows = await screen.findAllByTestId('library-row')
    expect(rows[0].textContent).toContain(lib.dimensionOf.replace('{dimension}', en.surveyRespond.dimensions.psychological_safety))
    expect(rows[0].textContent).not.toContain('psychological_safety')
    expect(rows[1].textContent).not.toContain('some_unknown_code')
    // The row's action is a bordered secondary button, not a blue text link.
    const action = within(rows[0]).getByRole('button').className.split(' ')
    expect(action).toContain('border-line-default')
    expect(action).not.toContain('text-accent-blue-ink')
  })

  it('opens global rows read-only for a company administrator and their own rows for editing', async () => {
    arrange()
    renderAs(<QuestionLibraryNextPage />)
    const rows = await screen.findAllByTestId('library-row')
    expect(rows.map((row) => within(row).getByRole('button').textContent)).toEqual([lib.view, lib.view, lib.view, lib.edit])
    // Each button's accessible name says which question it opens, not a bare «Ver» four times.
    const admin = en.questionLibraryAdmin.next
    expect(rows.map((row) => within(row).getByRole('button').getAttribute('aria-label'))).toEqual([
      admin.viewRow.replace('{text}', 'Global lead A'),
      admin.viewRow.replace('{text}', 'Global lead B'),
      admin.viewRow.replace('{text}', 'Global feedback C'),
      admin.editRow.replace('{text}', 'Own feedback D'),
    ])
    expect(screen.getByText(lib.subcategoryOf.replace('{parent}', 'Leadership').replace('{count}', '2'))).toBeTruthy()
  })

  // The page's one role branch (roles/super-admin-2): a super administrator gets the global
  // catalogue view, `super/SuperQuestionLibraryView`, where a global row is theirs to edit — and
  // never this page's company list.
  it('sends a super administrator to the global catalogue view, where a global row is editable', async () => {
    arrange()
    // That view also reads the companies that own rows.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ companies: [] }), { status: 200 }))))
    try {
      renderAs(<QuestionLibraryNextPage />, 'super_admin')
      const edits = await screen.findAllByRole('button', { name: en.questionLibraryAdmin.next.editRow.replace('{text}', 'ES') })
      expect(edits.length).toBeGreaterThan(0)
      expect(screen.queryAllByTestId('library-row')).toHaveLength(0)
    } finally {
      vi.unstubAllGlobals()
    }
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
      expect.arrayContaining(['xl:col-[2]', 'xl:row-[1]', 'xl:justify-self-end', 'xl:w-98', 'xl:z-1']),
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
    await userEvent.click(within(row).getByRole('button', { name: en.questionLibraryAdmin.next.editRow.replace('{text}', 'Own MC') }))
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

  it('heads the page with the company alone, and sits the search on the row', async () => {
    arrange()
    renderAs(<QuestionLibraryNextPage />)
    expect(await screen.findByText('Grupo Meridiano S.A.')).toBeTruthy()
    expect(screen.queryByText(/Proposal|Propuesta/)).toBeNull()
    expect(screen.getByPlaceholderText(lib.search).className.split(' ')).toContain('mt-0')
    // …and runs the row to the type select: index.css caps every `label > input` at the field
    // max, and the board's search is `width: 100%` (library-light.png is the evidence).
    expect(screen.getByPlaceholderText(lib.search).className.split(' ')).toContain('max-w-none')
  })
})

// The boards' spacing, inks and type (QuestionBank / QuestionLibrary .dc.html). happy-dom has no
// layout: the classes are the pin, and bank-light.png / library-new-light.png are the evidence.
describe('question bank and library — the boards\' spacing, inks and type', () => {
  function arrangeLibrary() {
    vi.mocked(listQuestionCategories).mockResolvedValue(categories)
    vi.mocked(listQuestionLibraryItems).mockResolvedValue(items)
  }
  function arrangeEmptyBank() {
    vi.mocked(listQuestionBankItems).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listQuestionBankCategories).mockResolvedValue([])
    vi.mocked(listQuestionBankEffectiveness).mockResolvedValue([])
    arrangeLibrary()
  }

  it("keeps the intro card 24px above the filters, the board's column gap", async () => {
    arrangeEmptyBank()
    renderAs(<QuestionBankNextPage />)
    await screen.findByText(bank.emptyTitle)
    expect(screen.getByTestId('bank-split').className.split(' ')).toContain('mb-section')
  })

  it("runs the empty bank's lines to the board's 100ch, the reason secondary and the rest tertiary", async () => {
    arrangeEmptyBank()
    renderAs(<QuestionBankNextPage />)
    const reason = (await screen.findByText(bank.emptyWhen)).className.split(' ')
    expect(reason).toEqual(expect.arrayContaining(['max-w-[100ch]', 'text-sm', 'leading-normal', 'text-fg-secondary']))
    expect(reason).not.toContain('max-w-measure')
    expect(screen.getByText(bank.emptyMeanwhile.replace('{company}', 'Grupo Meridiano S.A.')).className.split(' ')).toContain('text-fg-tertiary')
  })

  it("sets the drawer's fields without the label margin, under the board's 20px title", async () => {
    arrangeLibrary()
    renderAs(<QuestionLibraryNextPage />)
    await userEvent.click(await screen.findByRole('button', { name: lib.newQuestion }))
    const drawer = screen.getByRole('complementary')
    const fields = [...drawer.querySelectorAll('label')].filter((label) => label.className.split(' ').includes('flex-col'))
    expect(fields.length).toBeGreaterThanOrEqual(6)
    for (const field of fields) {
      expect(field.className.split(' ')).toEqual(expect.arrayContaining(['mb-0', 'gap-1.5', '[&>input]:mt-0', '[&>select]:mt-0', '[&>textarea]:mt-0']))
    }
    expect(within(drawer).getByRole('heading', { name: lib.newQuestion }).className.split(' ')).toContain('text-2xl')
  })

  it("caps the category description at the board's 480px, so it wraps before the drawer", async () => {
    arrangeLibrary()
    renderAs(<QuestionLibraryNextPage />)
    const description = await screen.findByTestId('library-category-description')
    // QuestionLibrary.dc.html: `max-width: 480px; line-height: 1.5` — library-new-light.png shows it
    // wrapping at "Ninguna de sus 4 / preguntas…", clear of the drawer, as the board does.
    expect(description.className.split(' ')).toEqual(expect.arrayContaining(['max-w-120', 'leading-normal']))
  })

  it("caps the globals note at the board's 480px of text, so it wraps before the drawer", async () => {
    arrangeLibrary()
    renderAs(<QuestionLibraryNextPage />)
    const note = await screen.findByTestId('library-globals-note')
    expect(note.textContent).toBe(lib.globalsNote)
    // 126 steps of the 4px spacing token: 504px (31.5rem), in the token, not a literal.
    expect(note.className.split(' ')).toContain('max-w-126')
  })
})
