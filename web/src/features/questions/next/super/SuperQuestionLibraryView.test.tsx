import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import QuestionLibraryNextPage from './SuperQuestionLibraryView'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../../i18n'
import { setToken, clearToken } from '../../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../../company-context'
import { clearCompanyNameCache } from '../../../../company-context/useCompanyName'
import type { QuestionCategory, QuestionLibraryItem, QuestionLibraryItemDetail } from '../../api/questionLibrary'
import { tokenFor } from '../../../../test/jwtFixture'
import en from '../../../../i18n/en.json'

const next = en.questionLibraryAdmin.next
const OWN = 'company-1'

const CATEGORY: QuestionCategory = {
  id: 'cat-feedback',
  companyId: null,
  parentCategoryId: null,
  nameEn: 'Feedback',
  nameEs: 'Retroalimentación',
  descriptionEn: null,
  descriptionEs: null,
  order: 1,
  icon: null,
  color: null,
  isActive: true,
  itemCount: 1,
}

function libraryItem(overrides: Partial<QuestionLibraryItem> = {}): QuestionLibraryItem {
  return {
    id: 'item-1',
    companyId: null,
    questionCategoryId: 'cat-feedback',
    textEn: 'My manager gives me useful feedback on my work.',
    textEs: 'Mi jefatura me da retroalimentación útil sobre mi trabajo.',
    type: 'likert',
    dimension: 'Liderazgo',
    usageCount: 0,
    lastUsedAt: null,
    isActive: true,
    version: 1,
    tags: [],
    ...overrides,
  }
}

function detail(overrides: Partial<QuestionLibraryItemDetail> = {}): QuestionLibraryItemDetail {
  return {
    ...libraryItem(),
    tags: ['feedback'],
    language: 'both',
    scaleMin: 1,
    scaleMax: 5,
    scaleLabelMinEn: 'Strongly disagree',
    scaleLabelMinEs: 'Muy en desacuerdo',
    scaleLabelMaxEn: 'Strongly agree',
    scaleLabelMaxEs: 'Muy de acuerdo',
    previousVersionId: null,
    createdAt: '2026-09-10T00:00:00Z',
    updatedAt: '2026-09-10T00:00:00Z',
    options: [],
    ...overrides,
  }
}

function serve(items: QuestionLibraryItem[], categories: QuestionCategory[] = [CATEGORY], itemDetail = detail()) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    if (init?.method === 'PUT' || init?.method === 'POST') return ok(itemDetail)
    if (/\/admin\/question-library\/[^/?]+$/.test(url)) return ok(itemDetail)
    if (url.includes('/admin/question-library')) return ok({ items })
    if (url.includes('/admin/question-categories')) return ok({ categories })
    if (url.includes('/admin/companies')) return ok({ companies: [] })
    if (url.includes('/profile')) return ok({ companyName: 'Meridiano' })
    return Promise.resolve(new Response(null, { status: 404 }))
  })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <CompanyContextProvider>
          <QuestionLibraryNextPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function requests(method: string, pattern: RegExp) {
  return vi.mocked(fetch).mock.calls.filter(([input, init]) => (init?.method ?? 'GET') === method && pattern.test(String(input)))
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  vi.stubGlobal('fetch', vi.fn())
  setToken(tokenFor({ role: 'super_admin' }))
})

afterEach(() => {
  cleanup()
  clearToken()
  clearCompanyNameCache()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  localStorage.removeItem(LOCALE_STORAGE_KEY)
  vi.unstubAllGlobals()
})

describe('QuestionLibraryNextPage (the old page\'s guarantees, on the redesigned screen)', () => {
  it('lists the categories and the chosen category\'s questions in both languages', async () => {
    serve([libraryItem()])
    renderPage()
    expect(await screen.findByRole('button', { name: /Feedback/, pressed: true })).toBeTruthy()
    const row = document.querySelector('tr[data-library-item="item-1"]') as HTMLElement
    expect(within(row).getByText('Mi jefatura me da retroalimentación útil sobre mi trabajo.')).toBeTruthy()
    expect(within(row).getByText('My manager gives me useful feedback on my work.')).toBeTruthy()
  })

  it('asks for the global rows too, by sending no companyId on either read', async () => {
    localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'acme')
    serve([libraryItem()])
    renderPage()
    await screen.findByText('My manager gives me useful feedback on my work.')
    for (const [input] of [...requests('GET', /\/admin\/question-categories/), ...requests('GET', /\/admin\/question-library(\?|$)/)]) {
      expect(String(input)).not.toContain('companyId')
    }
  })

  it('loads the full question before editing, and carries its tags and scale back on save', async () => {
    serve([libraryItem()])
    renderPage()
    const spanish = await screen.findByRole('textbox', { name: next.fieldTextEs })
    await waitFor(() => expect((spanish as HTMLInputElement).value).toBe(detail().textEs))
    await userEvent.clear(spanish)
    await userEvent.type(spanish, 'Mi jefatura me orienta.')
    await userEvent.click(screen.getByRole('button', { name: next.saveQuestion }))
    await waitFor(() => expect(requests('PUT', /\/admin\/question-library\/item-1$/)).toHaveLength(1))
    const body = JSON.parse(String(requests('PUT', /item-1$/)[0][1]?.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      textEs: 'Mi jefatura me orienta.',
      tags: ['feedback'],
      scaleMin: 1,
      scaleMax: 5,
      scaleLabelMinEs: 'Muy en desacuerdo',
      scaleLabelMaxEn: 'Strongly agree',
    })
    expect(body).not.toHaveProperty('type')
    expect(body).not.toHaveProperty('companyId')
  })

  it('refuses a category whose Spanish name is only whitespace, and sends no request', async () => {
    serve([libraryItem()])
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: next.newCategory }))
    await userEvent.type(screen.getByRole('textbox', { name: next.nameEs }), '   ')
    await userEvent.type(screen.getByRole('textbox', { name: next.nameEn }), 'Wellbeing')
    await userEvent.click(screen.getByRole('button', { name: next.saveCategory }))
    expect(await screen.findByText(en.questionLibraryAdmin.bothLanguagesRequired)).toBeTruthy()
    expect(requests('POST', /question-categories/)).toHaveLength(0)
  })

  it('creates a new question as global for a super administrator with no company chosen', async () => {
    serve([libraryItem()])
    renderPage()
    await screen.findByText('My manager gives me useful feedback on my work.')
    await userEvent.click(screen.getByRole('button', { name: next.newQuestion }))
    const editor = document.querySelector('[data-slot="library-editor"]') as HTMLElement
    await userEvent.type(within(editor).getByRole('textbox', { name: next.fieldTextEs }), 'Nueva')
    await userEvent.type(within(editor).getByRole('textbox', { name: next.fieldTextEn }), 'New')
    await userEvent.click(within(editor).getByRole('button', { name: next.saveQuestion }))
    await waitFor(() => expect(requests('POST', /\/admin\/question-library$/)).toHaveLength(1))
    expect(JSON.parse(String(requests('POST', /question-library$/)[0][1]?.body))).not.toHaveProperty('companyId')
  })
})

describe('QuestionLibraryNextPage — a company administrator', () => {
  it('opens a global question read-only, with no Save, and says who edits it', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    serve([libraryItem()])
    renderPage()
    expect(await screen.findByText(next.readOnlyNote)).toBeTruthy()
    expect(screen.queryByRole('button', { name: next.saveQuestion })).toBeNull()
    expect((screen.getByRole('textbox', { name: next.fieldTextEs }) as HTMLInputElement).disabled).toBe(true)
  })

  it('offers no ownership choice on a new question — it is their company\'s', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
    serve([libraryItem({ companyId: OWN })], [{ ...CATEGORY, companyId: OWN }], detail({ companyId: OWN }))
    renderPage()
    await screen.findByText('My manager gives me useful feedback on my work.')
    await userEvent.click(screen.getByRole('button', { name: next.newQuestion }))
    const editor = document.querySelector('[data-slot="library-editor"]') as HTMLElement
    const owner = within(editor).getByRole('combobox', { name: next.fieldOwner }) as HTMLSelectElement
    expect(owner.disabled).toBe(true)
    expect(owner.value).toBe('company')
  })
})

// The SuperQuestionLibrary artboard's findings (10 Sep refuter, items 17-20).
describe('QuestionLibraryNextPage — the artboard\'s order, names and chips', () => {
  const ACME_COPY: QuestionCategory = { ...CATEGORY, id: 'cat-feedback-acme', companyId: 'acme' }
  const LIKERT = libraryItem({ id: 'likert' })
  const RATING = libraryItem({
    id: 'rating',
    type: 'rating',
    textEs: '¿Cómo calificaría la frecuencia de la retroalimentación que recibe?',
    textEn: 'How would you rate the frequency of feedback you receive?',
  })

  function serveWithAcme(itemDetail = detail()) {
    // The API's own order: by the English text, so the rating question arrives first.
    const items = [RATING, LIKERT, { ...RATING, id: 'rating-acme', companyId: 'acme', questionCategoryId: ACME_COPY.id }, { ...LIKERT, id: 'likert-acme', companyId: 'acme', questionCategoryId: ACME_COPY.id }]
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
      if (/\/admin\/question-library\/[^/?]+$/.test(url)) return ok(itemDetail)
      if (url.includes('/admin/question-library')) return ok({ items })
      if (url.includes('/admin/question-categories')) return ok({ categories: [CATEGORY, ACME_COPY] })
      if (url.includes('/admin/companies')) {
        return ok({ companies: [{ id: 'acme', name: 'Acme Corporation', emailDomain: null, industry: null, size: null, country: null, subscriptionTier: null, createdAt: '2026-01-01T00:00:00Z' }] })
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
  }

  it('lists and opens the Likert question first, whatever order the server sent', async () => {
    serveWithAcme()
    renderPage()
    const edit = await screen.findAllByRole('button', { name: next.editRow.replace('{text}', LIKERT.textEs) })
    const rows = [...document.querySelectorAll('tbody tr')].map((row) => row.textContent ?? '')
    expect(rows[0]).toContain(LIKERT.textEs)
    expect(rows[1]).toContain(RATING.textEs)
    expect(edit.length).toBe(1)
    await waitFor(() => expect(requests('GET', /\/admin\/question-library\/likert$/).length).toBeGreaterThan(0))
  })

  it('names Acme Corporation in full in the copy note, Acme in passing in its link and the categories line, and counts the copy in words', async () => {
    serveWithAcme()
    renderPage()
    const note = await waitFor(() => {
      const found = document.querySelector('[data-slot="copy-note"]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    // The artboard: "Las mismas dos preguntas existen como copia de Acme Corporation, con su
    // propia versión; editar una no toca la otra." — and the link "Ver las de Acme".
    const sentence = note.querySelector('span') as HTMLElement
    expect(sentence.textContent).toBe(next.copyNoteSame.replace('{count}', 'two').replace('{company}', 'Acme Corporation'))
    const link = within(note).getByRole('button', { name: next.copyLink.replace('{company}', 'Acme') })
    expect(link.textContent).not.toMatch(/Corporation/)
    expect(screen.getByText(next.categoriesMetaOne.replace('{global}', '1').replace('{tenant}', '1').replace('{company}', 'Acme'))).toBeTruthy()
  })

  it('draws each tag as a plain chip — the chip itself removes it, named so', async () => {
    serveWithAcme()
    renderPage()
    const chip = await screen.findByRole('button', { name: next.removeTag.replace('{tag}', 'feedback') })
    expect(chip.textContent).toBe('feedback')
    expect(chip.querySelector('svg')).toBeNull()
    // The chip IS the remove control: a click takes the tag off the editor…
    await userEvent.click(chip)
    expect(screen.queryByRole('button', { name: next.removeTag.replace('{tag}', 'feedback') })).toBeNull()
    // …and the save writes the question without it.
    await userEvent.click(screen.getByRole('button', { name: next.saveQuestion }))
    await waitFor(() => expect(requests('PUT', /\/admin\/question-library\/[^/?]+$/)).toHaveLength(1))
    const body = JSON.parse(String(requests('PUT', /\/admin\/question-library\/[^/?]+$/)[0][1]?.body)) as Record<string, unknown>
    expect(body.tags).toEqual([])
  })

  it('draws the question table on the artboard\'s grid — Spanish 12 + 1.25fr, English the rest, each cell padded on its left only', async () => {
    serveWithAcme()
    renderPage()
    await screen.findAllByRole('button', { name: next.editRow.replace('{text}', LIKERT.textEs) })
    const table = (document.querySelector('tr[data-library-item]') as HTMLElement).closest('table') as HTMLElement
    expect([...table.querySelectorAll('col')].map((col) => col.className)).toEqual(['w-[31.4%]', '', 'w-24', 'w-22', 'w-24', 'w-22.5'])
    const cells = [...table.querySelectorAll('tbody tr:first-child td')]
    expect(cells).toHaveLength(6)
    for (const cell of [...cells.slice(0, 5), ...table.querySelectorAll('th')].slice(0, 10)) {
      expect(cell.className.split(/\s+/)).toEqual(expect.arrayContaining(['pl-3', 'pr-0']))
    }
    expect(cells[5].className.split(/\s+/)).toContain('px-3')
    // A 31px header row: the card's 8px above the labels, 8px below, nothing on the <th>.
    for (const head of table.querySelectorAll('th')) expect(head.className.split(/\s+/)).toEqual(expect.arrayContaining(['pt-0', 'pb-2']))
  })
})
