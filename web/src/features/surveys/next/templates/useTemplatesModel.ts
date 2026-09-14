import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { getSurveyTemplate, listSurveyTemplates, type SurveyTemplateListItem } from '../../api/surveyTemplates'
import { shapeOf, type TemplateShape } from './derive'

export interface TemplatesModelState {
  status: 'loading' | 'ready' | 'error'
  templates: SurveyTemplateListItem[]
  /** Per template id; absent when its detail failed — the card then prints no dimensions. */
  shapes: ReadonlyMap<string, TemplateShape>
  error: string | null
  reload: () => void
}

/**
 * The wiring seam of the Templates artboard: `GET /survey-templates` (admin-only, scoped by the
 * server — global templates plus the caller's own tenant's; no company id is sent) with the free
 * text pushed to the server as `q`, then `GET /survey-templates/{id}` per template for the
 * dimensions and scale its questions declare. A failed detail costs its card the dimensions,
 * never the list.
 */
export function useTemplatesModel(q: string): TemplatesModelState {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [state, setState] = useState<Omit<TemplatesModelState, 'reload'>>({
    status: 'loading',
    templates: [],
    shapes: new Map(),
    error: null,
  })

  const load = useCallback(async () => {
    setState((current) => ({ ...current, status: 'loading', error: null }))
    try {
      const templates = await listSurveyTemplates(baseUrl, q ? { q } : {}, locale)
      const details = await Promise.allSettled(templates.map((template) => getSurveyTemplate(baseUrl, template.id, locale)))
      const shapes = new Map<string, TemplateShape>()
      details.forEach((detail, index) => {
        if (detail.status === 'fulfilled') shapes.set(templates[index].id, shapeOf(detail.value))
      })
      setState({ status: 'ready', templates, shapes, error: null })
    } catch (err) {
      setState({ status: 'error', templates: [], shapes: new Map(), error: err instanceof Error ? err.message : t('errors.generic') })
    }
  }, [baseUrl, q, locale, t])

  useEffect(() => {
    void load()
  }, [load])

  return { ...state, reload: () => void load() }
}
