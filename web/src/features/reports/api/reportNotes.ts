import { authFetch } from '../../../api/authFetch'
import type { Report } from './reports'

/**
 * «Notas de TIMS» (ruled 2026-11-19, `docs/decisions/editable-respondent-content.md`): TIMS's
 * own introduction, conclusions and recommendations on a report, in Spanish and English.
 * Mirrors `ReportNotesDto` (`ReportNotes.cs`). Empty string = no note.
 *
 * Plain text: a blank line separates paragraphs, a single line break is a soft wrap. The PDF
 * (`ReportRenderer`) and the shared page split the same way (`noteParagraphs`).
 */
export interface ReportNotes {
  introEs: string
  introEn: string
  conclusionsEs: string
  conclusionsEn: string
  recommendationsEs: string
  recommendationsEn: string
}

/** `ReportNotes.MaxLength` (C#): each of the six fields. Over it the server answers 400 `report_notes_too_long`. */
export const REPORT_NOTES_MAX_LENGTH = 4000

/** The three notes, in the order the document prints them. */
export const REPORT_NOTE_PARTS = ['intro', 'conclusions', 'recommendations'] as const
export type ReportNotePart = (typeof REPORT_NOTE_PARTS)[number]

export const EMPTY_REPORT_NOTES: ReportNotes = {
  introEs: '',
  introEn: '',
  conclusionsEs: '',
  conclusionsEn: '',
  recommendationsEs: '',
  recommendationsEn: '',
}

/** The field of one part in one language: `('intro', 'es')` is `introEs`. */
export function noteField(part: ReportNotePart, language: 'es' | 'en'): keyof ReportNotes {
  return `${part}${language === 'es' ? 'Es' : 'En'}` as keyof ReportNotes
}

/** The wire value (nulls for absent notes) as the editor's strings. */
export function notesFromWire(wire: Partial<Record<keyof ReportNotes, string | null>> | null | undefined): ReportNotes {
  const notes = { ...EMPTY_REPORT_NOTES }
  if (!wire) return notes
  for (const key of Object.keys(notes) as (keyof ReportNotes)[]) {
    const value = wire[key]
    notes[key] = typeof value === 'string' ? value : ''
  }
  return notes
}

/** True when at least one of the six fields has text. */
export function hasAnyNote(notes: ReportNotes): boolean {
  return Object.values(notes).some((value) => value.trim() !== '')
}

/** The first field over the limit, or `null` — the same check the server makes, on the trimmed value. */
export function firstNoteTooLong(notes: ReportNotes): keyof ReportNotes | null {
  for (const key of Object.keys(notes) as (keyof ReportNotes)[]) {
    if (notes[key].trim().length > REPORT_NOTES_MAX_LENGTH) return key
  }
  return null
}

/**
 * A note's paragraphs, as `ReportNotes.Paragraphs` (C#) splits them: on blank lines, each
 * paragraph's own line breaks folded into spaces, empty ones dropped.
 */
export function noteParagraphs(text: string | null | undefined): string[] {
  if (!text) return []
  const paragraphs: string[] = []
  let current: string[] = []
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim() === '') {
      if (current.length > 0) paragraphs.push(current.join(' '))
      current = []
      continue
    }
    current.push(line.trim())
  }
  if (current.length > 0) paragraphs.push(current.join(' '))
  return paragraphs
}

/** Replaces all six notes (`PUT /admin/reports/{id}/notes`). A blank field clears that note. */
export async function setReportNotes(baseUrl: string, id: string, notes: ReportNotes, locale?: string): Promise<Report> {
  const suffix = locale ? `?lang=${encodeURIComponent(locale)}` : ''
  const response = await authFetch(`${baseUrl}/admin/reports/${id}/notes${suffix}`, {
    method: 'PUT',
    body: JSON.stringify(notes),
  })
  return response.json() as Promise<Report>
}
