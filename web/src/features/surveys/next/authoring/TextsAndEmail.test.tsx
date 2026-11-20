import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import { clearToken, setToken } from '../../../../auth/token'
import { COMPANY_CONTEXT_STORAGE_KEY, CompanyContextProvider } from '../../../../company-context'
import { tokenFor } from '../../../../test/jwtFixture'
import es from '../../../../i18n/es.json'
import SurveyBuilderNextPage from './SurveyBuilderNextPage'
import { SurveyTextsAndEmailCard } from './SurveyTextsAndEmailCard'
import * as drafts from '../../api/surveyDrafts'
import * as creating from '../../api/surveyCreate'
import * as sources from '../../api/respondentContentSources'
import * as settingsApi from '../../../org-structure/api/companySettings'
import { textSourceOf, type RespondentContentView } from '../../api/respondentContentSources'
import { contentView, emptyByLocale } from '../../../../test/respondentContentRegistry'

/**
 * «Textos y correo» (audit 2026-11-19, gap #2): reachable while creating a survey, opening the
 * same two dialogs Distribución opens, and saying per text whether it is «Predeterminado», «De la
 * empresa» or set for this survey.
 */

const T = es.surveys.next.builder.texts

vi.mock('../../api/respondentContentSources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/respondentContentSources')>()),
  getSurveyRespondentContent: vi.fn(),
  getCompanyRespondentContent: vi.fn(),
}))
vi.mock('../../api/surveyDrafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveyDrafts')>()),
  getLatestSurveyDraft: vi.fn(),
  createSurveyDraft: vi.fn(),
  autosaveSurveyDraft: vi.fn(),
  deleteSurveyDraft: vi.fn(async () => undefined),
  recoverSurveyDraft: vi.fn(async () => undefined),
}))
vi.mock('../../api/surveyCreate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveyCreate')>()),
  createSurvey: vi.fn(),
  setSurveyUserTargets: vi.fn(async () => undefined),
}))
vi.mock('../../../org-structure/api/departments', () => ({
  listDepartments: vi.fn(async () => [{ id: 'd1', name: 'Teletrabajo', employeeCount: 2, isActive: true }]),
}))
vi.mock('../../../org-structure/api/users', () => ({
  listUsers: vi.fn(async () => [
    { id: 'u1', name: 'José Mora', email: 'jose.mora@esph.test', departmentId: 'd1', isActive: true, role: 'employee' },
  ]),
}))
vi.mock('../../../org-structure/api/companySettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../org-structure/api/companySettings')>()),
  getCompanySettings: vi.fn(),
}))
vi.mock('../../api/surveyTemplates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveyTemplates')>()),
  listSurveyTemplates: vi.fn(async () => []),
  getSurveyTemplate: vi.fn(),
  instantiateSurveyTemplate: vi.fn(),
}))
vi.mock('../../api/surveys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveys')>()),
  listSurveyDimensions: vi.fn(async () => []),
  deleteSurvey: vi.fn(async () => undefined),
}))

function view(over: Partial<RespondentContentView> = {}): RespondentContentView {
  return {
    level: 'survey',
    companyId: 'c1',
    surveyId: 's1',
    language: 'es',
    requiredLocales: ['es'],
    editable: true,
    surveyStatus: 'draft',
    companyValues: { es: {}, en: {}, '*': {} },
    surveyValues: { es: {}, en: {}, '*': {} },
    ...over,
  }
}

/** The chip(s) printed beside one text. */
function sourceOf(key: string): string {
  return within(screen.getByTestId(`texts-source-${key}`).querySelector('dd') as HTMLElement)
    .getAllByText(/./)
    .map((chip) => chip.textContent)
    .join(' | ')
}

function Landed() {
  const { id } = useParams()
  const { search } = useLocation()
  return <p data-testid="landed">{`${id}${search}`}</p>
}

function Where() {
  const { search } = useLocation()
  return <p data-testid="where">{search}</p>
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  localStorage.removeItem(LOCALE_STORAGE_KEY)
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('textSourceOf', () => {
  it('reads the chain survey → company → default, per language, and never another language', () => {
    const v = view({
      companyValues: { es: { anonymousBody: 'De PROCOMER', thankYouTitle: 'Gracias, PROCOMER' }, en: {}, '*': {} },
      surveyValues: { es: { anonymousBody: 'Solo esta encuesta', 'identity.intro': '   ' }, en: {}, '*': {} },
    })
    expect(textSourceOf(v, 'anonymousBody', 'es')).toBe('survey')
    expect(textSourceOf(v, 'thankYouTitle', 'es')).toBe('company')
    expect(textSourceOf(v, 'participationBody', 'es')).toBe('default')
    // Whitespace is not a text: the level below shows through.
    expect(textSourceOf(v, 'identity.intro', 'es')).toBe('default')
    expect(textSourceOf(v, 'anonymousBody', 'en')).toBe('default')
    // The company level has no survey values at all.
    expect(textSourceOf(view({ surveyValues: null }), 'anonymousBody', 'es')).toBe('default')
  })
})

describe('«Textos y correo» in the builder’s Revisión', () => {
  const QUESTION = {
    textEn: '', textEs: 'Me siento escuchado.', type: 'likert', required: true, options: [], category: 'trust',
    scaleLabelMinEn: '', scaleLabelMinEs: '', scaleLabelMaxEn: '', scaleLabelMaxEs: '', scaleMin: null, scaleMax: null,
  }

  async function openReview() {
    vi.mocked(drafts.getLatestSurveyDraft).mockResolvedValue({
      id: 'dr1', sessionId: 'x', version: 1, currentStep: 5, updatedAt: '2026-11-19T10:00:00Z',
      content: {
        version: 1, templateId: '', language: 'es', titleEn: '', titleEs: 'Clima 2027', descriptionEn: '', descriptionEs: '',
        type: 'periodic', startDate: '2027-01-11T08:00', endDate: '2027-01-28T23:59', departmentIds: [], targetAudienceCount: '',
        anonymous: true, allowPartialResponses: true, showProgress: true, questions: [QUESTION],
      },
    } as never)
    vi.mocked(drafts.autosaveSurveyDraft).mockImplementation(async (_b, id) => ({ id, version: 2, updatedAt: '2026-11-19T10:01:00Z' }) as never)
    vi.mocked(settingsApi.getCompanySettings).mockResolvedValue({ companyId: 'c1', settings: { timezone: 'America/Costa_Rica' } } as never)
    setToken(tokenFor({ role: 'company_admin', companyId: 'c1', sub: 'u-viewer', name: 'Ana Rojas' }))
    render(
      <TranslationProvider>
        <CompanyContextProvider>
          <MemoryRouter initialEntries={['/surveys/new']}>
            <Routes>
              <Route path="/surveys/new" element={<SurveyBuilderNextPage />} />
              <Route path="/surveys/:id" element={<Landed />} />
            </Routes>
          </MemoryRouter>
        </CompanyContextProvider>
      </TranslationProvider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Restaurarla' }))
    return screen.findByTestId('builder-texts')
  }

  it('says which texts the new survey starts with: the company’s, or the default', async () => {
    vi.mocked(sources.getCompanyRespondentContent).mockResolvedValue(
      view({ level: 'company', surveyId: null, surveyValues: null, companyValues: { es: { anonymousBody: 'De PROCOMER' }, en: {}, '*': {} } }),
    )
    const section = await openReview()

    expect(within(section).getByRole('heading', { name: T.title })).toBeTruthy()
    await screen.findByTestId('texts-sources')
    expect(sourceOf('anonymousBody')).toBe(T.source.company)
    expect(sourceOf('thankYouTitle')).toBe(T.source.default)
    expect(sourceOf('email.personalLink.subject')).toBe(T.source.default)
    expect(vi.mocked(sources.getCompanyRespondentContent).mock.calls[0][1]).toBe('c1')
  })

  it('creates the draft and lands on its page with the texts editor asked for', async () => {
    vi.mocked(sources.getCompanyRespondentContent).mockResolvedValue(view({ level: 'company', surveyValues: null }))
    vi.mocked(creating.createSurvey).mockResolvedValue({ id: 'new-survey' } as never)
    const section = await openReview()

    await userEvent.click(within(section).getByRole('button', { name: T.createAndEditTexts }))

    expect((await screen.findByTestId('landed')).textContent).toBe('new-survey?open=texts')
    expect(creating.createSurvey).toHaveBeenCalledTimes(1)
  })

  it('lands with the email editor asked for from the other button', async () => {
    vi.mocked(sources.getCompanyRespondentContent).mockResolvedValue(view({ level: 'company', surveyValues: null }))
    vi.mocked(creating.createSurvey).mockResolvedValue({ id: 'new-survey' } as never)
    const section = await openReview()

    await userEvent.click(within(section).getByRole('button', { name: T.createAndEditEmail }))

    expect((await screen.findByTestId('landed')).textContent).toBe('new-survey?open=email')
  })

  it('says it does not know rather than guessing when the company’s texts cannot be read', async () => {
    vi.mocked(sources.getCompanyRespondentContent).mockRejectedValue(new Error('403'))
    const section = await openReview()

    expect(await within(section).findByTestId('builder-texts-unknown')).toBeTruthy()
    expect(within(section).queryByTestId('texts-sources')).toBeNull()
    expect(within(section).getByRole('button', { name: T.createAndEditTexts })).toBeTruthy()
  })
})

describe('«Textos y correo» on the survey page', () => {
  /** The two dialogs read the survey themselves; any GET answers a draft survey in Spanish. */
  function serveDialogs() {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') return Promise.resolve(new Response('{}', { status: 200 }))
      // The texts dialog reads the registry and the stored words from the respondent-content
      // route (lane L1); everything else it and the email dialog read is the survey itself.
      if (String(input).endsWith('/surveys/s1/respondent-content')) {
        return Promise.resolve(
          new Response(
            JSON.stringify(contentView({ level: 'survey', surveyId: 's1', surveyStatus: 'draft', surveyValues: emptyByLocale() })),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            language: 'es', status: 'draft', fallbackFields: [], questions: [],
            settings: { respondentIntro: null, closingMessage: null, estimatedMinutes: null, invitationCustomSubject: null, invitationCustomMessage: null },
          }),
          { status: 200 },
        ),
      )
    })
  }

  function renderCard(entry: string) {
    return render(
      <TranslationProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/surveys/:id" element={<><SurveyTextsAndEmailCard surveyId="s1" /><Where /></>} />
          </Routes>
        </MemoryRouter>
      </TranslationProvider>,
    )
  }

  it('says per text whether it is this survey’s, the company’s or the default', async () => {
    serveDialogs()
    vi.mocked(sources.getSurveyRespondentContent).mockResolvedValue(
      view({
        companyValues: { es: { thankYouTitle: 'Gracias, PROCOMER' }, en: {}, '*': {} },
        surveyValues: { es: { anonymousBody: 'Solo esta encuesta' }, en: {}, '*': {} },
      }),
    )
    renderCard('/surveys/s1')

    await screen.findByTestId('texts-sources')
    expect(sourceOf('anonymousBody')).toBe(T.source.survey)
    expect(sourceOf('thankYouTitle')).toBe(T.source.company)
    expect(sourceOf('participationBody')).toBe(T.source.default)
    expect(vi.mocked(sources.getSurveyRespondentContent).mock.calls[0][1]).toBe('s1')
  })

  it('names the language on each chip of a bilingual survey', async () => {
    serveDialogs()
    vi.mocked(sources.getSurveyRespondentContent).mockResolvedValue(
      view({ language: 'both', requiredLocales: ['es', 'en'], surveyValues: { es: { anonymousBody: 'Solo esta encuesta' }, en: {}, '*': {} } }),
    )
    renderCard('/surveys/s1')

    await screen.findByTestId('texts-sources')
    expect(sourceOf('anonymousBody')).toBe(`ES · ${T.source.survey} | EN · ${T.source.default}`)
  })

  it('opens the texts dialog the builder asked for, once, and reads the sources again after a save', async () => {
    serveDialogs()
    vi.mocked(sources.getSurveyRespondentContent).mockResolvedValue(view())
    renderCard('/surveys/s1?open=texts')

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: es.surveys.next.respondentTexts.title })).toBeTruthy()
    // The address no longer asks, so a reload does not reopen it.
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(''))

    const reads = vi.mocked(sources.getSurveyRespondentContent).mock.calls.length
    await userEvent.click(await within(dialog).findByRole('button', { name: es.common.save }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(vi.mocked(sources.getSurveyRespondentContent).mock.calls.length).toBe(reads + 1)
    expect(screen.getByRole('status').textContent).toBe(es.surveys.next.respondentTexts.saved)
  })

  it('opens the invitation email dialog the builder asked for', async () => {
    serveDialogs()
    vi.mocked(sources.getSurveyRespondentContent).mockResolvedValue(view())
    renderCard('/surveys/s1?open=email')

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: es.surveys.next.distribution.link.emailTitle })).toBeTruthy()
  })

  it('opens either dialog from its own button', async () => {
    serveDialogs()
    vi.mocked(sources.getSurveyRespondentContent).mockResolvedValue(view())
    renderCard('/surveys/s1')
    await screen.findByTestId('texts-sources')
    expect(screen.queryByRole('dialog')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: T.editEmail }))
    expect(within(await screen.findByRole('dialog')).getByRole('heading', { name: es.surveys.next.distribution.link.emailTitle })).toBeTruthy()
  })
})
