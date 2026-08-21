import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setToken } from '../../auth/token'
import { TranslationProvider } from '../../i18n'
import QuestionLibraryBrowser from './QuestionLibraryBrowser'
import type { QuestionLibraryItemDetail } from '../../features/questions/api/questionLibrary'

const OWN = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'

const CATEGORIES = [
  {
    id: 'leadership',
    companyId: null,
    parentCategoryId: null,
    nameEn: 'Leadership',
    nameEs: 'Liderazgo',
    descriptionEn: null,
    descriptionEs: null,
    order: 0,
    icon: null,
    color: null,
    isActive: true,
    itemCount: 1,
  },
  {
    id: 'trust',
    companyId: null,
    parentCategoryId: 'leadership',
    nameEn: 'Trust in leadership',
    nameEs: 'Confianza en el liderazgo',
    descriptionEn: null,
    descriptionEs: null,
    order: 0,
    icon: null,
    color: null,
    isActive: true,
    itemCount: 1,
  },
]

const ITEMS = [
  {
    id: 'likert-1',
    companyId: null,
    questionCategoryId: 'trust',
    textEn: 'My manager keeps their word',
    textEs: 'Mi jefe cumple su palabra',
    type: 'likert',
    dimension: 'psychological_safety',
    usageCount: 3,
    lastUsedAt: null,
    isActive: true,
    version: 1,
    tags: ['trust'],
  },
  {
    id: 'choice-1',
    companyId: null,
    questionCategoryId: 'leadership',
    textEn: 'How often do you meet your manager?',
    textEs: '¿Con qué frecuencia te reúnes con tu jefe?',
    type: 'multiple_choice',
    dimension: null,
    usageCount: 0,
    lastUsedAt: null,
    isActive: true,
    version: 1,
    tags: [],
  },
  {
    id: 'other-tenant',
    companyId: OTHER,
    questionCategoryId: 'leadership',
    textEn: 'A question belonging to another company',
    textEs: 'Una pregunta de otra empresa',
    type: 'likert',
    dimension: null,
    usageCount: 0,
    lastUsedAt: null,
    isActive: true,
    version: 1,
    tags: [],
  },
]

/** The DETAIL of the multiple-choice item. Note the options: the list row has none. */
const CHOICE_DETAIL: QuestionLibraryItemDetail = {
  ...ITEMS[1],
  language: 'both',
  scaleMin: null,
  scaleMax: null,
  scaleLabelMinEn: null,
  scaleLabelMinEs: null,
  scaleLabelMaxEn: null,
  scaleLabelMaxEs: null,
  previousVersionId: null,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
  options: [
    { order: 0, value: 'weekly', labelEn: 'Weekly', labelEs: 'Semanalmente' },
    { order: 1, value: 'monthly', labelEn: 'Monthly', labelEs: 'Mensualmente' },
  ],
}

const LIKERT_DETAIL: QuestionLibraryItemDetail = {
  ...ITEMS[0],
  language: 'both',
  scaleMin: 1,
  scaleMax: 5,
  scaleLabelMinEn: 'Never',
  scaleLabelMinEs: 'Nunca',
  scaleLabelMaxEn: 'Always',
  scaleLabelMaxEs: 'Siempre',
  previousVersionId: null,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
  options: [],
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

/** Routes by URL, so the order of the component's own calls is not pinned. */
function stubApi(overrides: { detailFails?: boolean } = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const href = String(url)
      if (href.includes('/admin/question-categories')) {
        return jsonResponse({ categories: CATEGORIES })
      }
      if (href.endsWith('/admin/question-library/choice-1')) {
        if (overrides.detailFails) return new Response('{}', { status: 500 })
        return jsonResponse(CHOICE_DETAIL)
      }
      if (href.endsWith('/admin/question-library/likert-1')) {
        return jsonResponse(LIKERT_DETAIL)
      }
      if (href.includes('/admin/question-library')) {
        return jsonResponse({ items: ITEMS })
      }
      throw new Error(`unexpected fetch: ${href}`)
    }),
  )
}

function renderBrowser(onAdd = vi.fn(), allowedTypes = ['likert', 'multiple_choice']) {
  render(
    <TranslationProvider>
      <QuestionLibraryBrowser
        open
        onOpenChange={vi.fn()}
        companyId={OWN}
        allowedTypes={allowedTypes}
        typeLabel={(type) => type}
        onAdd={onAdd}
      />
    </TranslationProvider>,
  )
  return onAdd
}

beforeEach(() => {
  setToken('test-token')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('QuestionLibraryBrowser', () => {
  it('lists the library, and never another tenant rows', async () => {
    stubApi()
    renderBrowser()

    expect(await screen.findByText('My manager keeps their word')).toBeTruthy()
    expect(screen.getByText('How often do you meet your manager?')).toBeTruthy()
    // The list endpoint applies no company filter for a SuperAdmin, so this row IS
    // in the response the component received.
    expect(screen.queryByText('A question belonging to another company')).toBeNull()
  })

  /**
   * The other half of the scoping argument, and the half that has no visible symptom.
   *
   * `ListItemsAsync` answers a SuperAdmin's `?companyId=` with `i.CompanyId ==
   * companyId`, which EXCLUDES every global row — the shipped library this picker
   * mostly exists to offer. A picker that sent it would look like it worked and would
   * quietly show a tenant only their own handful of questions, so what is pinned here
   * is the request, not the rendering.
   */
  it('never asks the server to scope by company, which would drop the global rows', async () => {
    stubApi()
    renderBrowser()
    await screen.findByText('My manager keeps their word')

    const requested = vi
      .mocked(fetch)
      .mock.calls.map(([url]) => String(url))
      .filter((url) => /\/admin\/question-(library|categories)(\?|$)/.test(url))

    expect(requested).toHaveLength(2)
    for (const url of requested) {
      expect(new URL(url, 'http://localhost').searchParams.get('companyId')).toBeNull()
    }
  })

  it('narrows to a category and its descendants when one is chosen', async () => {
    stubApi()
    const user = userEvent.setup()
    renderBrowser()

    await screen.findByText('My manager keeps their word')
    await user.click(screen.getByRole('button', { name: /Trust in leadership/ }))

    // "Trust in leadership" is a child of "Leadership"; only the item filed on it
    // survives.
    expect(screen.getByText('My manager keeps their word')).toBeTruthy()
    expect(screen.queryByText('How often do you meet your manager?')).toBeNull()
  })

  it('searches across both languages', async () => {
    stubApi()
    const user = userEvent.setup()
    renderBrowser()

    await screen.findByText('My manager keeps their word')
    await user.type(screen.getByLabelText(/Search the library/), 'frecuencia')

    expect(screen.getByText('How often do you meet your manager?')).toBeTruthy()
    expect(screen.queryByText('My manager keeps their word')).toBeNull()
  })

  it('previews an item with the options the list row does not carry', async () => {
    stubApi()
    const user = userEvent.setup()
    renderBrowser()

    await screen.findByText('How often do you meet your manager?')
    await user.click(
      screen.getByRole('button', { name: /Preview "How often do you meet your manager\?"/ }),
    )

    // The option row reads `Weekly / Semanalmente (weekly)` — the stable value is
    // printed beside the labels because it is what the copied question will carry.
    expect(await screen.findByText(/Weekly \/ Semanalmente/)).toBeTruthy()
    expect(screen.getByText('(weekly)')).toBeTruthy()
  })

  it('adds a question with the options and scale bounds from the DETAIL endpoint', async () => {
    // THE guarantee. `GET /admin/question-library` omits `options`, `scaleMin`/`Max`
    // and the four scale-label columns, so a multiple_choice question copied out of
    // a list row is an unanswerable question created silently.
    stubApi()
    const user = userEvent.setup()
    const onAdd = renderBrowser()

    await screen.findByText('How often do you meet your manager?')
    await user.click(
      screen.getByRole('button', { name: /Add "How often do you meet your manager\?"/ }),
    )

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    const [added] = onAdd.mock.calls[0] as [QuestionLibraryItemDetail[]]
    expect(added).toHaveLength(1)
    expect(added[0].options.map((option) => option.value)).toEqual(['weekly', 'monthly'])
  })

  it('quick-add adds exactly the row clicked and leaves the selection alone', async () => {
    stubApi()
    const user = userEvent.setup()
    const onAdd = renderBrowser()

    await screen.findByText('My manager keeps their word')

    // Tick the OTHER row, then quick-add this one.
    await user.click(screen.getByRole('checkbox', { name: 'My manager keeps their word' }))
    await user.click(
      screen.getByRole('button', { name: /Add "How often do you meet your manager\?"/ }),
    )

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    const [added] = onAdd.mock.calls[0] as [QuestionLibraryItemDetail[]]
    expect(added.map((item) => item.id)).toEqual(['choice-1'])
    // The ticked row is still ticked, and the footer still counts it.
    expect(
      (screen.getByRole('checkbox', { name: 'My manager keeps their word' }) as HTMLElement)
        .getAttribute('data-state'),
    ).toBe('checked')
    expect(screen.getByText('1 selected')).toBeTruthy()
  })

  it('adds a whole multi-selection in one go', async () => {
    stubApi()
    const user = userEvent.setup()
    const onAdd = renderBrowser()

    await screen.findByText('My manager keeps their word')
    await user.click(screen.getByRole('checkbox', { name: 'My manager keeps their word' }))
    await user.click(
      screen.getByRole('checkbox', { name: 'How often do you meet your manager?' }),
    )
    await user.click(screen.getByRole('button', { name: 'Add 2 selected' }))

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    const [added] = onAdd.mock.calls[0] as [QuestionLibraryItemDetail[]]
    expect(added.map((item) => item.id)).toEqual(['likert-1', 'choice-1'])
    expect(added[0].scaleLabelMinEn).toBe('Never')
  })

  it('hands the wizard nothing when the detail read fails', async () => {
    // Half a copied question is worse than none: `onAdd` runs only after every
    // detail has arrived.
    stubApi({ detailFails: true })
    const user = userEvent.setup()
    const onAdd = renderBrowser()

    await screen.findByText('How often do you meet your manager?')
    await user.click(
      screen.getByRole('button', { name: /Add "How often do you meet your manager\?"/ }),
    )

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('says the library is unavailable rather than pretending it is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    renderBrowser()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('still write questions by hand')
  })

  it('offers only the types the destination surface can render', async () => {
    stubApi()
    renderBrowser(vi.fn(), ['likert'])

    expect(await screen.findByText('My manager keeps their word')).toBeTruthy()
    expect(screen.queryByText('How often do you meet your manager?')).toBeNull()
  })

  /**
   * The picker cannot see the wizard. `addedIds` is a record of what THIS dialog
   * handed over, not of what the questions step still holds, so an author who adds a
   * question, deletes the card and comes back for it must not find the row greyed out
   * with no way to un-grey it. Reopening is a new session.
   */
  it('offers a question again after the dialog has been closed and reopened', async () => {
    stubApi()
    const user = userEvent.setup()
    const onAdd = vi.fn()

    function Harness({ open }: { open: boolean }) {
      return (
        <TranslationProvider>
          <QuestionLibraryBrowser
            open={open}
            onOpenChange={vi.fn()}
            companyId={OWN}
            allowedTypes={['likert', 'multiple_choice']}
            typeLabel={(type) => type}
            onAdd={onAdd}
          />
        </TranslationProvider>
      )
    }

    const { rerender } = render(<Harness open />)
    await screen.findByText('My manager keeps their word')
    await user.click(
      screen.getByRole('button', { name: /Add "How often do you meet your manager\?"/ }),
    )
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    // While the dialog stays open the row is spent, so it cannot be added twice.
    expect(
      screen
        .getByRole('button', { name: /Add "How often do you meet your manager\?"/ })
        .hasAttribute('disabled'),
    ).toBe(true)

    rerender(<Harness open={false} />)
    rerender(<Harness open />)

    await screen.findByText('My manager keeps their word')
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: /Add "How often do you meet your manager\?"/ })
          .hasAttribute('disabled'),
      ).toBe(false),
    )

    await user.click(
      screen.getByRole('button', { name: /Add "How often do you meet your manager\?"/ }),
    )
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2))
  })
})
