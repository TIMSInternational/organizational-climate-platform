import type { SurveyRespondView } from '../api/surveyResponses'

/**
 * Which «Aviso de privacidad» a respondent reads (Ley 8968; ruled 2026-11-15).
 *
 * Each company may set one, in Spanish and in English, written by the CLIENT's legal team. The
 * respondent's own language comes first; when only the other one is set, that one — a notice in
 * the other language informs, none does not. `null` when neither is set, and the form then shows
 * nothing of it at all.
 *
 * `locale` is the language the form's chrome is in: it follows the survey's `resolvedLocale`
 * (`adoptContentLocale`) unless the respondent chose another on the picker, so it is the
 * language this respondent is reading — and the one the link's own label is in.
 *
 * A blank is "not set": the server trims and stores none, but an older row or a hand-written
 * fixture must not draw a link that opens an empty dialog.
 */
export function pickPrivacyNotice(
  view: Pick<SurveyRespondView, 'privacyNoticeEs' | 'privacyNoticeEn'>,
  locale: string,
): string | null {
  const es = present(view.privacyNoticeEs)
  const en = present(view.privacyNoticeEn)
  return locale.toLowerCase().startsWith('en') ? (en ?? es) : (es ?? en)
}

function present(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}
