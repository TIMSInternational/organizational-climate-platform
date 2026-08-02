import { createContext } from 'react'
import type { Locale, TranslateFn } from './translate'

export interface TranslationContextValue {
  locale: Locale
  t: TranslateFn
  setLocale: (locale: Locale) => void
}

/**
 * The context object lives apart from both the provider and the hook so that
 * TranslationProvider.tsx exports nothing but a component — react-refresh only
 * works on files that are exclusively components.
 */
export const TranslationContext = createContext<TranslationContextValue | null>(null)
