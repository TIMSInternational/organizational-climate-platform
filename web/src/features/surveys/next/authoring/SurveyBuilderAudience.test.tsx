import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import { clearToken, setToken } from '../../../../auth/token'
import { COMPANY_CONTEXT_STORAGE_KEY, CompanyContextProvider } from '../../../../company-context'
import { tokenFor } from '../../../../test/jwtFixture'
import SurveyBuilderNextPage from './SurveyBuilderNextPage'
import * as drafts from '../../api/surveyDrafts'
import * as creating from '../../api/surveyCreate'
import * as surveysApi from '../../api/surveys'
import * as templatesApi from '../../api/surveyTemplates'
import * as settingsApi from '../../../org-structure/api/companySettings'

/**
 * "Personas específicas" and the company clock on Nueva encuesta (G14, G16), through the page: the
 * draft restores the people, the picker and the paste write them, and the create carries them --
 * with the dates read on the company's zone, not the laptop's.
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

describe('Nueva encuesta — Personas específicas (G14)', () => {
  it('creates the survey with the named people, no department, and the window on the company clock', async () => {
    vi.mocked(creating.createSurvey).mockResolvedValue({ id: 'new-survey' } as never)
    restoreDraft(5, { audienceMode: 'people', userIds: ['u1', 'u4'], departmentIds: ['d2'] })
    await openRestored()
    expect(await screen.findByText('2 personas, por nombre')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Crear el borrador' }))
    expect((await screen.findByTestId('landed')).textContent).toBe('new-survey')
    const sent = vi.mocked(creating.createSurvey).mock.calls[0][1]
    expect(sent.userIds).toEqual(['u1', 'u4'])
    expect(sent.departmentIds).toBeUndefined()
    // 08:00 and 23:59 in Costa Rica (UTC-6), whatever zone the machine running this is in.
    expect(sent.startDate).toBe('2026-10-20T14:00:00.000Z')
    expect(sent.endDate).toBe('2026-10-29T05:59:00.000Z')
  })

  it('loads a draft’s people ticked on the audience step, and keeps them when the draft is saved again', async () => {
    restoreDraft(3, { audienceMode: 'people', userIds: ['u1', 'u4'] })
    await openRestored()
    expect((await screen.findByRole('radio', { name: 'Personas específicas' })).getAttribute('data-state')).toBe('checked')
    expect(screen.getByTestId('people-chosen-count').textContent).toBe('2 personas elegidas')
    const list = await screen.findByTestId('people-results')
    expect(within(list).getByRole('checkbox', { name: 'José Mora' }).getAttribute('data-state')).toBe('checked')
    expect(within(list).getByRole('checkbox', { name: 'Ana Solís' }).getAttribute('data-state')).toBe('unchecked')
    expect(within(list).getByRole('checkbox', { name: 'Marta Ruiz' }).getAttribute('data-state')).toBe('checked')
    // The inactive account is never offered.
    expect(within(list).queryByRole('checkbox', { name: 'Luis Vega' })).toBeNull()

    await userEvent.click(within(list).getByRole('checkbox', { name: 'Ana Solís' }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }))
    await waitFor(() => expect(drafts.autosaveSurveyDraft).toHaveBeenCalled())
    const body = vi.mocked(drafts.autosaveSurveyDraft).mock.calls.at(-1)![2]
    expect(body.content).toMatchObject({ audienceMode: 'people', userIds: ['u1', 'u4', 'u2'] })
  })

  it('chooses every search result at once and counts them', async () => {
    restoreDraft(3, { audienceMode: 'people', userIds: [] })
    await openRestored()
    await userEvent.type(await screen.findByRole('textbox', { name: /Buscar personas/ }), 'teletrabajo')
    await userEvent.click(screen.getByRole('button', { name: 'Elegir los resultados (2)' }))
    expect(screen.getByTestId('people-chosen-count').textContent).toBe('2 personas elegidas')
  })

  it('lists the pasted addresses that match no active person before adding the ones that do', async () => {
    restoreDraft(3, { audienceMode: 'people', userIds: [] })
    await openRestored()
    const paste = await screen.findByRole('textbox', { name: /Pegar una lista de correos/ })
    await userEvent.click(paste)
    await userEvent.paste('jose.mora@esph.test\nluis.vega@esph.test\nnadie@esph.test')
    const preview = await screen.findByTestId('paste-preview')
    expect(preview.textContent).toContain('Correos leídos: 3. Coinciden con una persona activa: 1.')
    const unmatched = within(preview).getByTestId('paste-unmatched')
    expect(unmatched.textContent).toContain('luis.vega@esph.test — la cuenta está inactiva')
    expect(unmatched.textContent).toContain('nadie@esph.test — nadie en la empresa tiene este correo')
    expect(unmatched.textContent).not.toContain('jose.mora')
    await userEvent.click(within(preview).getByRole('button', { name: 'Agregar a la selección (1)' }))
    expect(screen.getByTestId('people-chosen-count').textContent).toBe('1 persona elegida')
  })

  it('will not continue with nobody chosen: that list would be the whole company', async () => {
    restoreDraft(3, { audienceMode: 'people', userIds: [] })
    await openRestored()
    await screen.findByTestId('people-picker')
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(await screen.findByText(/Elija al menos una persona/)).toBeTruthy()
    expect(screen.queryByText('Me siento escuchado.', { selector: '[data-testid="builder-questions"] *' })).toBeNull()
  })

  it('writes the people onto a template copy, and deletes the copy rather than leave it company-wide when that fails', async () => {
    vi.mocked(templatesApi.getSurveyTemplate).mockResolvedValue({
      id: 't1', name: 'Instrumento', language: 'es', resolvedLocale: 'es', fallbackFields: [],
      questions: [{ id: 'tq1', text: 'Confío en la dirección.', type: 'likert', options: null, scaleMin: 1, scaleMax: 5,
        scaleLabelMin: null, scaleLabelMax: null, required: true, commentRequired: false, commentPrompt: null, order: 0, category: 'trust' }],
    } as never)
    vi.mocked(templatesApi.instantiateSurveyTemplate).mockResolvedValue({ id: 'copy-1' } as never)
    vi.mocked(creating.setSurveyUserTargets).mockRejectedValueOnce(new Error('Unknown or inactive user(s)'))
    restoreDraft(5, { templateId: 't1', questions: [], audienceMode: 'people', userIds: ['u1'] })
    await openRestored()
    await waitFor(() => expect(screen.getByTestId('builder-step').textContent).toContain('Preguntas1'))
    await userEvent.click(screen.getByRole('button', { name: 'Crear el borrador' }))
    expect(await screen.findByText(/la copia se eliminó y no se creó ninguna encuesta/)).toBeTruthy()
    expect(vi.mocked(creating.setSurveyUserTargets).mock.calls[0].slice(1)).toEqual(['copy-1', ['u1']])
    expect(vi.mocked(surveysApi.deleteSurvey).mock.calls[0][1]).toBe('copy-1')
    expect(drafts.deleteSurveyDraft).not.toHaveBeenCalled()

    // And when it lands, the author lands on the copy.
    await userEvent.click(screen.getByRole('button', { name: 'Crear el borrador' }))
    expect((await screen.findByTestId('landed')).textContent).toBe('copy-1')
    expect(vi.mocked(creating.setSurveyUserTargets).mock.calls.at(-1)?.slice(1)).toEqual(['copy-1', ['u1']])
  })
})

describe('Nueva encuesta — the company clock (G16)', () => {
  it("names the company's zone beside the dates", async () => {
    restoreDraft(2)
    await openRestored()
    expect((await screen.findByTestId('builder-zone')).textContent).toBe(
      'Fechas y horas en la zona de la empresa: America/Costa_Rica (GMT-6).',
    )
  })
})
