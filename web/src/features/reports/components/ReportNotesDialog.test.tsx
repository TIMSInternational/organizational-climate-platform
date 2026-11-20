import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReportNotesDialog from './ReportNotesDialog'
import ReportForm from './ReportForm'
import { TranslationProvider } from '../../../i18n'
import { setToken } from '../../../auth/token'
import { EMPTY_REPORT_NOTES, REPORT_NOTES_MAX_LENGTH } from '../api/reportNotes'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

const detail = {
  id: 'r1',
  title: 'Clima 2026',
  notes: {
    introEs: 'Introducción guardada.',
    introEn: null,
    conclusionsEs: null,
    conclusionsEn: null,
    recommendationsEs: null,
    recommendationsEn: null,
  },
}

describe('ReportNotesDialog', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('loads the stored notes and saves all six with a PUT', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(jsonResponse(detail))
    const onOpenChange = vi.fn()
    render(
      <TranslationProvider initialLocale="es">
        <ReportNotesDialog open onOpenChange={onOpenChange} baseUrl="http://api.test" report={{ id: 'r1', title: 'Clima 2026' }} />
      </TranslationProvider>,
    )

    const intro = await screen.findByLabelText('Introducción')
    await waitFor(() => expect((intro as HTMLTextAreaElement).value).toBe('Introducción guardada.'))

    fireEvent.change(screen.getByLabelText('Conclusiones'), { target: { value: 'Primera.\n\nSegunda.' } })
    await userEvent.click(screen.getByRole('button', { name: 'Guardar notas' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    const [url, init] = vi.mocked(fetch).mock.calls[1]
    expect(url).toBe('http://api.test/admin/reports/r1/notes?lang=es')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual({
      ...EMPTY_REPORT_NOTES,
      introEs: 'Introducción guardada.',
      conclusionsEs: 'Primera.\n\nSegunda.',
    })
  })

  it('edits the English notes from the language switch', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(detail)).mockResolvedValueOnce(jsonResponse(detail))
    render(
      <TranslationProvider initialLocale="es">
        <ReportNotesDialog open onOpenChange={() => {}} baseUrl="http://api.test" report={{ id: 'r1', title: 'Clima 2026' }} />
      </TranslationProvider>,
    )
    await waitFor(() => expect((screen.getByLabelText('Introducción') as HTMLTextAreaElement).value).toBe('Introducción guardada.'))

    await userEvent.click(screen.getByRole('button', { name: 'Inglés' }))
    const english = screen.getByLabelText('Introducción') as HTMLTextAreaElement
    expect(english.value).toBe('')
    expect(english.getAttribute('lang')).toBe('en')
    fireEvent.change(english, { target: { value: 'Our introduction.' } })
    await userEvent.click(screen.getByRole('button', { name: 'Guardar notas' }))

    await waitFor(() => expect(vi.mocked(fetch).mock.calls).toHaveLength(2))
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))
    expect(body.introEn).toBe('Our introduction.')
    expect(body.introEs).toBe('Introducción guardada.')
  })

  it('refuses a note over the limit before sending anything', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(detail))
    render(
      <TranslationProvider initialLocale="es">
        <ReportNotesDialog open onOpenChange={() => {}} baseUrl="http://api.test" report={{ id: 'r1', title: 'Clima 2026' }} />
      </TranslationProvider>,
    )
    await waitFor(() => expect((screen.getByLabelText('Introducción') as HTMLTextAreaElement).value).not.toBe(''))

    fireEvent.change(screen.getByLabelText('Recomendaciones'), {
      target: { value: 'x'.repeat(REPORT_NOTES_MAX_LENGTH + 1) },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Guardar notas' }))

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Una de las notas de TIMS supera los 4000 caracteres. Acórtela e intente de nuevo.',
    )
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1)
  })
})

describe('ReportForm «Notas de TIMS»', () => {
  afterEach(() => {
    cleanup()
  })

  it('submits the notes written in the new-report form', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <TranslationProvider initialLocale="es">
        <ReportForm onSubmit={onSubmit} />
      </TranslationProvider>,
    )

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Clima 2026' } })
    await userEvent.click(screen.getByRole('button', { name: 'Notas de TIMS' }))
    fireEvent.change(screen.getByLabelText('Recomendaciones'), { target: { value: 'Revisar la carga.' } })
    await userEvent.click(screen.getByRole('button', { name: 'Crear informe' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0].notes).toEqual({ ...EMPTY_REPORT_NOTES, recommendationsEs: 'Revisar la carga.' })
  })
})
