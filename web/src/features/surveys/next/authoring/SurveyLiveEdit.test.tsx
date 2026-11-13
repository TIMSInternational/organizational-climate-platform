import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import { clearToken, setToken } from '../../../../auth/token'
import { CompanyContextProvider } from '../../../../company-context'
import { tokenFor } from '../../../../test/jwtFixture'
import { ApiError } from '../../../../api/authFetch'
import type { SurveyDetail } from '../../api/surveys'
import type { SurveyText } from '../../api/surveyText'
import { SurveyDetailView } from './SurveyDetailNextPage'
import es from '../../../../i18n/es.json'

vi.mock('../../api/surveyText', () => ({ getSurveyText: vi.fn() }))
import { getSurveyText } from '../../api/surveyText'

const D = es.surveys.next.detail
const R = D.rename
const CR = 'America/Costa_Rica'
const NOW = new Date('2026-11-11T19:30:00Z')

function survey(over: Partial<SurveyDetail> = {}): SurveyDetail {
  return {
    id: 's1', title: 'Encuesta de Clima Organizacional PROCOMER 2026 (DEMO por invitación)', description: '¡Tu opinión cuenta!',
    companyId: 'c1', createdBy: 'u1', type: 'periodic', serviceType: null, status: 'active', language: 'es', resolvedLocale: 'es',
    fallbackFields: [], startDate: '2026-11-05T14:00:00Z', endDate: '2026-11-30T05:59:00Z', responseCount: 0, targetAudienceCount: 3,
    version: 1, departmentIds: [], userIds: [], questions: [],
    settings: { anonymous: true } as SurveyDetail['settings'],
    allowedStatusTransitions: ['closed'], isContentEditable: false, createdAt: '', updatedAt: '',
    ...over,
  }
}

function text(over: Partial<SurveyText> = {}): SurveyText {
  const blank = { text: '', authored: false }
  return {
    language: 'es',
    locales: ['es'],
    title: { es: { text: 'Encuesta de Clima Organizacional PROCOMER 2026 (DEMO por invitación)', authored: true }, en: blank },
    description: { es: { text: '¡Tu opinión cuenta!', authored: true }, en: blank },
    ...over,
  }
}

function renderView(s: SurveyDetail, role: string, onSaveText = vi.fn(async () => undefined)) {
  setToken(tokenFor({ role, companyId: role === 'super_admin' ? undefined : 'c1', sub: 'u-viewer', name: 'Audrey Herra' }))
  render(
    <TranslationProvider>
      <CompanyContextProvider>
        <MemoryRouter>
          <SurveyDetailView
            model={{ survey: s, departments: [], distribution: null, invitations: null, users: null, timeZone: CR }}
            pending={null}
            actionError={null}
            onTransition={() => undefined}
            onDuplicate={() => undefined}
            onSaveText={onSaveText}
            now={NOW}
          />
        </MemoryRouter>
      </CompanyContextProvider>
    </TranslationProvider>,
  )
  return onSaveText
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
  vi.mocked(getSurveyText).mockResolvedValue(text())
})
afterEach(() => {
  vi.useRealTimers()
  cleanup()
  clearToken()
  localStorage.removeItem(LOCALE_STORAGE_KEY)
  vi.clearAllMocks()
})

const questionsPanel = () => screen.getByTestId('detail-questions')

/**
 * Audrey, 11 Nov 2026, on PROCOMER's demo (active, 0 of 3): «no veo una opción de modificar una
 * encuesta que ya está creada... para cambiar el nombre o las preguntas». Ruled the same day: TIMS
 * edits the name and description until the survey is archived, and the questions while it is
 * scheduled or active and nobody has answered. A client's administrator keeps the old rule.
 */
describe('Editing a survey that has left draft', () => {
  it('offers a super admin the name and the questions of an active survey nobody has answered', async () => {
    renderView(survey(), 'super_admin')

    expect(await screen.findByRole('button', { name: R.action })).toBeTruthy()
    expect(within(questionsPanel()).getByRole('link', { name: D.editQuestions }).getAttribute('href')).toBe('/surveys/s1/questions')
    expect(within(questionsPanel()).getByText(D.editableLive)).toBeTruthy()
    expect(within(questionsPanel()).queryByText(D.readOnly)).toBeNull()
  })

  it('offers the client administrator neither, as before', async () => {
    renderView(survey(), 'company_admin')

    await screen.findByTestId('detail-questions')
    expect(screen.queryByRole('button', { name: R.action })).toBeNull()
    expect(within(questionsPanel()).queryByRole('link', { name: D.editQuestions })).toBeNull()
    expect(within(questionsPanel()).getByText(D.readOnly)).toBeTruthy()
  })

  it('once somebody has answered, still offers the name but not the questions, and says why', async () => {
    renderView(survey({ responseCount: 4 }), 'super_admin')

    expect(await screen.findByRole('button', { name: R.action })).toBeTruthy()
    expect(within(questionsPanel()).queryByRole('link', { name: D.editQuestions })).toBeNull()
    expect(within(questionsPanel()).getByText(D.lockedResponses)).toBeTruthy()
  })

  it('offers the name of a closed survey, and nothing on an archived one', async () => {
    renderView(survey({ status: 'closed', responseCount: 239, allowedStatusTransitions: ['archived'] }), 'super_admin')
    expect(await screen.findByRole('button', { name: R.action })).toBeTruthy()
    cleanup()

    renderView(survey({ status: 'archived', responseCount: 239, allowedStatusTransitions: [] }), 'super_admin')
    await screen.findByTestId('detail-questions')
    expect(screen.queryByRole('button', { name: R.action })).toBeNull()
  })

  it('reads the name as stored, sends the change, and says invitations keep the old name', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onSaveText = renderView(survey(), 'super_admin')

    await user.click(await screen.findByRole('button', { name: R.action }))
    const dialog = await screen.findByRole('dialog')
    const name = await within(dialog).findByLabelText(R.titleLabel)
    expect((name as HTMLInputElement).value).toBe('Encuesta de Clima Organizacional PROCOMER 2026 (DEMO por invitación)')
    expect(within(dialog).getByTestId('rename-reach').textContent).toBe(R.reach)

    await user.clear(name)
    await user.type(name, 'Encuesta de Clima Organizacional PROCOMER 2026')
    await user.click(within(dialog).getByRole('button', { name: R.confirm }))

    expect(onSaveText).toHaveBeenCalledWith({
      title: { es: 'Encuesta de Clima Organizacional PROCOMER 2026' },
      description: { es: '¡Tu opinión cuenta!' },
    })
  })

  it('asks for the name in each language of a bilingual survey, and leaves an untranslated description absent', async () => {
    vi.mocked(getSurveyText).mockResolvedValue(text({
      language: 'both',
      locales: ['en', 'es'],
      title: { es: { text: 'Clima 2026', authored: true }, en: { text: '', authored: false } },
      description: { es: { text: 'Bienvenida', authored: true }, en: { text: '', authored: false } },
    }))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onSaveText = renderView(survey({ language: 'both' }), 'super_admin')

    await user.click(await screen.findByRole('button', { name: R.action }))
    const dialog = await screen.findByRole('dialog')
    const english = await within(dialog).findByLabelText(R.titleLabelIn.replace('{language}', R.language.en))

    await user.click(within(dialog).getByRole('button', { name: R.confirm }))
    expect(within(dialog).getByRole('alert').textContent).toBe(R.errorTitleIn.replace('{language}', R.language.en))
    expect(onSaveText).not.toHaveBeenCalled()

    await user.type(english, 'Climate 2026')
    await user.click(within(dialog).getByRole('button', { name: R.confirm }))
    expect(onSaveText).toHaveBeenCalledWith({ title: { en: 'Climate 2026', es: 'Clima 2026' }, description: { es: 'Bienvenida' } })
  })

  it('says a server refusal in Spanish', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderView(survey(), 'super_admin', vi.fn(async () => {
      throw new ApiError(409, 'English', 'survey_live_edit_out_of_scope')
    }))

    await user.click(await screen.findByRole('button', { name: R.action }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByLabelText(R.titleLabel)
    await user.click(within(dialog).getByRole('button', { name: R.confirm }))

    expect(await within(dialog).findByText(es.errors.api.codes.survey_live_edit_out_of_scope)).toBeTruthy()
  })
})
