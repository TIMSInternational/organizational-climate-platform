import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import { clearToken, setToken } from '../../../../auth/token'
import { COMPANY_CONTEXT_STORAGE_KEY, CompanyContextProvider } from '../../../../company-context'
import { tokenFor } from '../../../../test/jwtFixture'
import SurveyBuilderNextPage from './SurveyBuilderNextPage'
import * as drafts from '../../api/surveyDrafts'
import * as creating from '../../api/surveyCreate'
import * as settingsApi from '../../../org-structure/api/companySettings'

import {
  MAX_TIME_LIMIT_MINUTES,
  SURVEY_BUILDER_STEPS,
  buildCreateInput,
  buildInstantiateInput,
  builderIndexOfDraftStep,
  builderSettingsInput,
  draftStepOfBuilderIndex,
  emptyQuestion,
  emptyWizardValues,
  settingsErrors,
  wizardStepErrors,
  type SurveyWizardValues,
} from '../../wizardValues'
import { draftValuesFrom, toDraftContent } from '../../draftContent'

/**
 * The builder's settings step (G16): the per-survey settings the API took and no builder control
 * set -- random order, automatic saving, a suggested time, a response limit. Pure rules first
 * (an untouched step sends nothing new, so no default moves), then the page.
 */
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
  listDepartments: vi.fn(async () => [
    { id: 'd1', name: 'Teletrabajo', employeeCount: 2, isActive: true },
    { id: 'd2', name: 'Finanzas', employeeCount: 2, isActive: true },
  ]),
}))
vi.mock('../../../org-structure/api/users', () => ({
  listUsers: vi.fn(async () => [
    { id: 'u1', name: 'José Mora', email: 'jose.mora@esph.test', departmentId: 'd1', isActive: true, role: 'employee' },
    { id: 'u2', name: 'Ana Solís', email: 'ana.solis@esph.test', departmentId: 'd2', isActive: true, role: 'employee' },
    { id: 'u3', name: 'Luis Vega', email: 'luis.vega@esph.test', departmentId: 'd2', isActive: false, role: 'employee' },
    { id: 'u4', name: 'Marta Ruiz', email: 'marta.ruiz@esph.test', departmentId: 'd1', isActive: true, role: 'employee' },
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

function Landed() {
  const { id } = useParams()
  return <p data-testid="landed">{id}</p>
}

function renderBuilder() {
  setToken(tokenFor({ role: 'company_admin', companyId: 'c1', sub: 'u-viewer', name: 'Ana Rojas' }))
  return render(
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
}

const QUESTION = {
  textEn: '', textEs: 'Me siento escuchado.', type: 'likert', required: true, options: [], category: 'trust',
  scaleLabelMinEn: '', scaleLabelMinEs: '', scaleLabelMaxEn: '', scaleLabelMaxEs: '', scaleMin: null, scaleMax: null,
}

function restoreDraft(step: number, over: Record<string, unknown> = {}) {
  const content = {
    version: 1, templateId: '', language: 'es', titleEn: '', titleEs: 'Teletrabajo 2026', descriptionEn: '', descriptionEs: '',
    type: 'periodic', startDate: '2026-10-20T08:00', endDate: '2026-10-28T23:59', departmentIds: [], targetAudienceCount: '',
    anonymous: true, allowPartialResponses: true, showProgress: true, questions: [QUESTION], ...over,
  }
  vi.mocked(drafts.getLatestSurveyDraft).mockResolvedValue({ id: 'dr1', sessionId: 'x', version: 1, currentStep: step, content, updatedAt: '2026-10-20T10:00:00Z' } as never)
}

async function openRestored() {
  renderBuilder()
  await userEvent.click(await screen.findByRole('button', { name: 'Restaurarla' }))
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
  vi.mocked(drafts.getLatestSurveyDraft).mockResolvedValue(null)
  vi.mocked(settingsApi.getCompanySettings).mockResolvedValue({
    companyId: 'c1',
    settings: { timezone: 'America/Costa_Rica', credentialMode: 'shared' },
  } as never)
  vi.mocked(drafts.autosaveSurveyDraft).mockImplementation(async (_b, id) => ({ id, version: 2, updatedAt: '2026-10-20T10:01:00Z' }) as never)
})
afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  localStorage.removeItem(LOCALE_STORAGE_KEY)
  vi.clearAllMocks()
})

function values(over: Partial<SurveyWizardValues> = {}): SurveyWizardValues {
  return {
    ...emptyWizardValues('es'),
    titleEs: 'Clima 2027',
    startDate: '2027-01-11T09:00',
    endDate: '2027-02-01T17:00',
    questions: [{ ...emptyQuestion('q1'), textEs: '¿Cómo va?', type: 'open_ended' }],
    ...over,
  }
}
const tr = ((key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key)) as never

describe('settings step — the request (G16)', () => {
  it('adds no settings key at all when the step is left untouched, on both create routes', () => {
    expect(Object.keys(buildCreateInput(values(), 'c1', 'America/Costa_Rica').settings ?? {}).sort()).toEqual(
      ['allowPartialResponses', 'anonymous', 'showProgress'],
    )
    expect(Object.keys(buildInstantiateInput(values({ templateId: 't1' }), 'c1').settings ?? {}).sort()).toEqual(
      ['allowPartialResponses', 'anonymous', 'showProgress'],
    )
  })

  it('sends what was chosen, as numbers, on both create routes', () => {
    const chosen = values({ randomizeQuestions: true, autoSave: false, timeLimitMinutes: ' 20 ', responseLimit: '150' })
    const expected = { randomizeQuestions: true, autoSave: false, timeLimitMinutes: 20, responseLimit: 150 }
    expect(buildCreateInput(chosen, 'c1').settings).toMatchObject(expected)
    expect(buildInstantiateInput({ ...chosen, templateId: 't1' }, 'c1').settings).toMatchObject(expected)
    expect(builderSettingsInput(chosen)).toEqual(expected)
  })

  it('refuses a limit that is not a whole number in range, and never a blank one', () => {
    for (const bad of ['0', '-5', '2.5', String(MAX_TIME_LIMIT_MINUTES + 1), 'abc']) {
      expect(settingsErrors(values({ timeLimitMinutes: bad }), tr), bad).toHaveLength(1)
    }
    for (const bad of ['0', '-1', '1.5']) {
      expect(settingsErrors(values({ responseLimit: bad }), tr), bad).toHaveLength(1)
    }
    expect(settingsErrors(values({ timeLimitMinutes: '', responseLimit: '  ' }), tr)).toEqual([])
    expect(settingsErrors(values({ timeLimitMinutes: String(MAX_TIME_LIMIT_MINUTES), responseLimit: '1' }), tr)).toEqual([])
    // The review backstop carries them too, so nothing invalid reaches submit.
    expect(wizardStepErrors(values({ responseLimit: '0' }), tr).review).toHaveLength(1)
  })

  it('keeps every stored draft step meaning what it meant: 5 is the review, settings saves as 4', () => {
    expect(SURVEY_BUILDER_STEPS[builderIndexOfDraftStep(5)]).toBe('review')
    expect(SURVEY_BUILDER_STEPS[builderIndexOfDraftStep(4)]).toBe('questions')
    expect(SURVEY_BUILDER_STEPS[builderIndexOfDraftStep(1)]).toBe('basics')
    expect(draftStepOfBuilderIndex(SURVEY_BUILDER_STEPS.indexOf('settings'))).toBe(4)
    expect(draftStepOfBuilderIndex(SURVEY_BUILDER_STEPS.indexOf('review'))).toBe(5)
  })

  it('round-trips the step through a draft, and restores an older draft with the server defaults', () => {
    const chosen = values({ randomizeQuestions: true, autoSave: false, timeLimitMinutes: '15', responseLimit: '40' })
    const restored = draftValuesFrom(toDraftContent(chosen), 'p', 'es')!
    expect(restored).toMatchObject({ randomizeQuestions: true, autoSave: false, timeLimitMinutes: '15', responseLimit: '40' })
    const legacy = { ...toDraftContent(values()) } as Record<string, unknown>
    for (const key of ['randomizeQuestions', 'autoSave', 'timeLimitMinutes', 'responseLimit']) delete legacy[key]
    expect(draftValuesFrom(legacy, 'p', 'es')).toMatchObject({ randomizeQuestions: false, autoSave: true, timeLimitMinutes: '', responseLimit: '' })
  })
})

describe('Nueva encuesta — Ajustes (G16)', () => {
  it('offers the four settings in Spanish, each saying what it does to respondents, and creates with them', async () => {
    vi.mocked(creating.createSurvey).mockResolvedValue({ id: 'new-survey' } as never)
    restoreDraft(4)
    await openRestored()
    await userEvent.click(await screen.findByRole('button', { name: 'Siguiente' }))
    const step = await screen.findByTestId('builder-settings')
    expect(screen.getByTestId('builder-step').textContent).toContain('Ajustes')
    expect(step.textContent).toContain('no ve el nombre de la dimensión sobre ninguna pregunta')
    expect(step.textContent).toContain('no se envía ni se bloquea nada')
    expect(step.textContent).toContain('la encuesta no admite respuestas nuevas')
    expect(step.textContent).toContain('se guarda solo mientras avanza')

    await userEvent.click(within(step).getByRole('checkbox', { name: 'Presentar las preguntas en orden aleatorio' }))
    await userEvent.click(within(step).getByRole('checkbox', { name: 'Guardado automático' }))
    await userEvent.type(within(step).getByRole('spinbutton', { name: 'Tiempo sugerido (minutos)' }), '20')
    await userEvent.type(within(step).getByRole('spinbutton', { name: 'Límite de respuestas' }), '150')
    // The preview follows the promise: a randomised survey prints no dimension over a question.
    expect(screen.getByTestId('builder-preview').querySelector('[data-slot="preview-section"]')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    const review = screen.getByTestId('builder-step').textContent ?? ''
    expect(review).toContain('Aleatorio, sin dimensión visible')
    expect(review).toContain('20 min')
    expect(review).toContain('150')

    await userEvent.click(screen.getByRole('button', { name: 'Crear el borrador' }))
    expect((await screen.findByTestId('landed')).textContent).toBe('new-survey')
    expect(vi.mocked(creating.createSurvey).mock.calls[0][1].settings).toMatchObject({
      randomizeQuestions: true,
      autoSave: false,
      timeLimitMinutes: 20,
      responseLimit: 150,
    })
  })

  it('creates exactly the old request when the step is passed through untouched', async () => {
    vi.mocked(creating.createSurvey).mockResolvedValue({ id: 'new-survey' } as never)
    restoreDraft(4)
    await openRestored()
    await userEvent.click(await screen.findByRole('button', { name: 'Siguiente' }))
    await screen.findByTestId('builder-settings')
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    await userEvent.click(screen.getByRole('button', { name: 'Crear el borrador' }))
    await screen.findByTestId('landed')
    expect(Object.keys(vi.mocked(creating.createSurvey).mock.calls[0][1].settings ?? {}).sort()).toEqual(
      ['allowPartialResponses', 'anonymous', 'showProgress'],
    )
  })

  it('will not leave the step on a response limit of zero, and says why', async () => {
    restoreDraft(4)
    await openRestored()
    await userEvent.click(await screen.findByRole('button', { name: 'Siguiente' }))
    const step = await screen.findByTestId('builder-settings')
    await userEvent.type(within(step).getByRole('spinbutton', { name: 'Límite de respuestas' }), '0')
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(screen.getByRole('alert').textContent).toContain('El límite de respuestas debe ser un número entero mayor que cero.')
    expect(screen.getByTestId('builder-settings')).toBeTruthy()
    expect(creating.createSurvey).not.toHaveBeenCalled()
  })

  it('offers automatic saving only where partial responses are allowed, as the server enforces', async () => {
    restoreDraft(4, { allowPartialResponses: false })
    await openRestored()
    await userEvent.click(await screen.findByRole('button', { name: 'Siguiente' }))
    const step = await screen.findByTestId('builder-settings')
    const box = within(step).getByRole('checkbox', { name: 'Guardado automático' })
    expect(box.hasAttribute('disabled')).toBe(true)
    expect(box.getAttribute('aria-checked')).toBe('false')
    expect(step.textContent).toContain('requiere permitir respuestas parciales')
  })
})
