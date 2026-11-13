import type { TranslateFn } from '../../i18n'
import type { SurveyTemplateListItem } from './api/surveyTemplates'

/**
 * Who a template belongs to, in words: the owning company's name, or "Global" for a template
 * every company sees. Null when the API did not say (an API older than `companyName`), so the
 * caller prints the name alone rather than a guess.
 *
 * A super administrator's list holds every client's copy of an instrument, and the wizard's
 * dropdown read "Instrumento de clima estándar (6 dimensiones)" three times (walkthrough
 * 2026-11-08).
 */
export function templateOwner(t: TranslateFn, template: Pick<SurveyTemplateListItem, 'isGlobal' | 'companyName'>): string | null {
  if (template.isGlobal) return t('surveys.globalTemplate')
  return template.companyName ? template.companyName : null
}

/** A template as one line, for a dropdown: "Name · Owner", or the name alone when the owner is unknown. */
export function templateOptionLabel(
  t: TranslateFn,
  template: Pick<SurveyTemplateListItem, 'name' | 'isGlobal' | 'companyName'>,
): string {
  const owner = templateOwner(t, template)
  return owner === null ? template.name : `${template.name} · ${owner}`
}
