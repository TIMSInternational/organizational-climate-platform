import { useContext, useMemo } from 'react'
import { TranslationContext } from './context'
import type { TranslationContextValue } from './context'
import type { TranslateFn, TranslateParams } from './translate'

/**
 * Translations for a component.
 *
 * Pass a namespace to scope the keys — `useTranslation('surveys')` then resolves
 * `t('title')` against `surveys.title`. Without one, `t` takes full paths.
 */
export function useTranslation(namespace?: string): TranslationContextValue {
  const context = useContext(TranslationContext)
  if (!context) {
    throw new Error('useTranslation must be used inside a TranslationProvider')
  }

  const { t: rootT } = context
  const t = useMemo<TranslateFn>(
    () =>
      namespace
        ? (key: string, params?: TranslateParams) => rootT(`${namespace}.${key}`, params)
        : rootT,
    [rootT, namespace],
  )

  return { ...context, t }
}
