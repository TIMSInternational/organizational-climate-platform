import { createContext } from 'react'
import type { Locale, TranslateFn } from './translate'

export interface TranslationContextValue {
  locale: Locale
  t: TranslateFn
  setLocale: (locale: Locale) => void
  /**
   * Follow the language the CONTENT came back in, without persisting it and without
   * overriding a choice the reader has made. See the implementation in
   * `TranslationProvider` for why both of those are load-bearing.
   */
  adoptContentLocale: (locale: Locale) => void
}

/**
 * The context object lives apart from both the provider and the hook so that
 * TranslationProvider.tsx exports nothing but a component — react-refresh only
 * works on files that are exclusively components.
 */
export const TranslationContext = createContext<TranslationContextValue | null>(null)
