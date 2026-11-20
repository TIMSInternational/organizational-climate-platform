import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import {
  EMPTY_REPORT_NOTES,
  REPORT_NOTES_MAX_LENGTH,
  firstNoteTooLong,
  hasAnyNote,
  noteField,
  noteParagraphs,
  notesFromWire,
  setReportNotes,
} from './reportNotes'

describe('reportNotes', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('splits paragraphs on blank lines and folds single line breaks, as the PDF does', () => {
    expect(noteParagraphs('Primera línea\r\nsigue igual\n\n\n  Segundo párrafo  \n \nTercero')).toEqual([
      'Primera línea sigue igual',
      'Segundo párrafo',
      'Tercero',
    ])
    expect(noteParagraphs('  \n\n ')).toEqual([])
    expect(noteParagraphs(null)).toEqual([])
  })

  it('names the first note over the limit, measured on the trimmed text like the server', () => {
    const atMax = 'a'.repeat(REPORT_NOTES_MAX_LENGTH)
    expect(firstNoteTooLong({ ...EMPTY_REPORT_NOTES, introEs: `  ${atMax}  ` })).toBeNull()
    expect(firstNoteTooLong({ ...EMPTY_REPORT_NOTES, conclusionsEn: `${atMax}a` })).toBe('conclusionsEn')
  })

  it('reads the wire nulls as empty fields and knows when nothing is written', () => {
    const notes = notesFromWire({ introEs: 'Hola', introEn: null })
    expect(notes).toEqual({ ...EMPTY_REPORT_NOTES, introEs: 'Hola' })
    expect(hasAnyNote(notes)).toBe(true)
    expect(hasAnyNote({ ...EMPTY_REPORT_NOTES, recommendationsEn: '   ' })).toBe(false)
    expect(noteField('recommendations', 'es')).toBe('recommendationsEs')
  })

  it('replaces all six notes with a PUT to the notes sub-resource', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: 'r1' }), { status: 200 }))
    const notes = { ...EMPTY_REPORT_NOTES, introEs: 'Introducción' }

    await setReportNotes('http://api.test', 'r1', notes, 'es')

    expect(fetch).toHaveBeenCalledWith(
      'http://api.test/admin/reports/r1/notes?lang=es',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(notes) }),
    )
  })
})
