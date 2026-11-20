import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CompanyRespondentContentPanel from './CompanyRespondentContentPanel'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import es from '../../../../i18n/es.json'
import en from '../../../../i18n/en.json'
import type { RespondentContentView } from '../../../surveys/api/respondentContent'
import { contentView, registryScreenKeys } from '../../../../test/respondentContentRegistry'

const C = es.surveys.next.respondentContent
const COMPANY = '11111111-1111-1111-1111-111111111111'

type Sent = { method: string; url: string; body: unknown }
let sent: Sent[] = []

/** `GET/PUT /admin/companies/{id}/respondent-content`; a PUT answers with `after`. */
function serve(before: RespondentContentView, after: RespondentContentView = before) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    sent.push({ method, url: String(input), body: init?.body ? JSON.parse(init.body as string) : null })
    return Promise.resolve(new Response(JSON.stringify(method === 'PUT' ? after : before), { status: 200 }))
  })
}

function renderPanel() {
  render(
    <TranslationProvider>
      <CompanyRespondentContentPanel companyId={COMPANY} />
    </TranslationProvider>,
  )
}

async function box(group: string, label: string, locale = 'es') {
  const fields = await waitFor(() => {
    const found = document.querySelector<HTMLElement>(`[data-slot="respondent-content-fields"][data-locale="${locale}"]`)
    if (!found) throw new Error('no fields yet')
    return found
  })
  return within(fields.querySelector<HTMLElement>(`[data-group="${group}"]`)!).getByLabelText(label, { exact: false }) as
    | HTMLTextAreaElement
    | HTMLInputElement
}

beforeEach(() => {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
  vi.stubGlobal('fetch', vi.fn())
  sent = []
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe('CompanyRespondentContentPanel («Textos para quien responde» of a company)', () => {
  it('lists every screen text, each showing the product default as its placeholder', async () => {
    serve(contentView({ companyId: COMPANY, companyValues: { es: { 'identity.intro': 'Texto de la empresa' }, en: {}, '*': {} } }))
    renderPanel()

    const anonymity = await box('anonymity', C.fields.anonymousBody)
    expect(anonymity.value).toBe('')
    expect(anonymity.placeholder).toBe(es.surveyRespond.anonymousBody)
    expect((await box('identity', C.fields.identity_intro)).value).toBe('Texto de la empresa')
    const boxes = document.querySelectorAll('[data-slot="respondent-content-fields"] textarea, [data-slot="respondent-content-fields"] input')
    expect(boxes).toHaveLength(registryScreenKeys().length)
    // The company level is per language with the default where a language has none: no
    // «every language» note, which is a survey publish-gate rule.
    expect(screen.queryByText(C.everyLocale, { exact: false })).toBeNull()
    // And the placeholder line names the allowed `{placeholders}`.
    expect(screen.getAllByText(C.placeholders.replace('{list}', '{date}'), { exact: false }).length).toBeGreaterThan(0)
  })

  it('offers both languages whatever the company’s own, the English defaults in English', async () => {
    serve(contentView({ companyId: COMPANY }))
    renderPanel()
    await box('anonymity', C.fields.anonymousBody)
    await userEvent.click(screen.getByRole('tab', { name: es.surveys.distribution.locale.en }))
    expect((await box('anonymity', C.fields.anonymousBody, 'en')).placeholder).toBe(en.surveyRespond.anonymousBody)
  })

  it('saves only what changed, per language, and the alignment under «*»', async () => {
    const before = contentView({ companyId: COMPANY, companyValues: { es: { participationBody: 'Viejo' }, en: {}, '*': {} } })
    const after = contentView({
      companyId: COMPANY,
      companyValues: { es: { 'demographics.intro': 'Para comparar áreas de PROCOMER.' }, en: {}, '*': { 'display.textAlign': 'start' } },
    })
    serve(before, after)
    renderPanel()

    await userEvent.clear(await box('anonymity', C.fields.participationBody))
    await userEvent.type(await box('demographics', C.fields.demographics_intro), 'Para comparar áreas de PROCOMER.')
    await userEvent.click(screen.getByLabelText(C.alignStart))
    await userEvent.click(screen.getByRole('button', { name: C.company.save }))

    await screen.findByText(C.company.saved)
    const put = sent.find((s) => s.method === 'PUT')!
    expect(put.url).toContain(`/admin/companies/${COMPANY}/respondent-content`)
    expect(put.body).toEqual({
      values: {
        es: { participationBody: '', 'demographics.intro': 'Para comparar áreas de PROCOMER.' },
        '*': { 'display.textAlign': 'start' },
      },
    })
    // The boxes now hold what the server stored.
    expect((await box('anonymity', C.fields.participationBody)).value).toBe('')
  })

  it('sends nothing when nothing changed', async () => {
    serve(contentView({ companyId: COMPANY }))
    renderPanel()
    await box('anonymity', C.fields.anonymousBody)
    await userEvent.click(screen.getByRole('button', { name: C.company.save }))
    expect(await screen.findByText(C.company.nothingToSave)).toBeTruthy()
    expect(sent.some((s) => s.method === 'PUT')).toBe(false)
  })
})
