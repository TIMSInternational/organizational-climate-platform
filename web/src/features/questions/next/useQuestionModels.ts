import { useCallback, useEffect, useState } from 'react'
import { listQuestionCategories, listQuestionLibraryItems, type QuestionCategory, type QuestionLibraryItem } from '../api/questionLibrary'
import {
  listQuestionBankCategories,
  listQuestionBankEffectiveness,
  listQuestionBankItems,
  setQuestionBankLifecycle,
  type QuestionBankCategoryCount,
  type QuestionBankFilters,
} from '../api/questionBank'
import { useTranslation } from '../../../i18n'
import { bankRows, globalLibraryTotals, type BankRow } from './model'

/** The wiring seams for the two redesigned question screens — existing clients only. */

type Load<T> = { status: 'loading' } | { status: 'failed'; message: string } | { status: 'ready'; data: T }

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export interface LibraryModel {
  categories: QuestionCategory[]
  items: QuestionLibraryItem[]
}

export function useQuestionLibraryModel() {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [state, setState] = useState<Load<LibraryModel>>({ status: 'loading' })

  const reload = useCallback(async () => {
    try {
      const [categories, items] = await Promise.all([
        // Unscoped, exactly as the previous page read them: the server scopes by role
        // (global rows plus the caller's own tenant).
        listQuestionCategories(baseUrl),
        listQuestionLibraryItems(baseUrl, {}),
      ])
      setState({ status: 'ready', data: { categories, items } })
    } catch (error) {
      setState({ status: 'failed', message: messageOf(error, t('errors.generic')) })
    }
  }, [baseUrl, t])

  useEffect(() => {
    void reload()
  }, [reload])

  return { state, reload }
}

export interface BankModel {
  rows: BankRow[]
  categories: QuestionBankCategoryCount[]
  library: { questions: number; categories: number } | null
}

export function useQuestionBankModel(companyId: string | undefined, filters: QuestionBankFilters) {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [state, setState] = useState<Load<BankModel>>({ status: 'loading' })
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const { search, category, type, includeRetired } = filters

  const reload = useCallback(async () => {
    try {
      const scoped = companyId ? { companyId } : {}
      const [page, categories, effectiveness, libCategories, libItems] = await Promise.all([
        listQuestionBankItems(baseUrl, { ...scoped, search, category, type, includeRetired }),
        listQuestionBankCategories(baseUrl, companyId),
        listQuestionBankEffectiveness(baseUrl, companyId),
        // The library line is context: a failed library read drops the sentence, not the bank.
        listQuestionCategories(baseUrl, companyId).catch(() => null),
        listQuestionLibraryItems(baseUrl, scoped).catch(() => null),
      ])
      setState({
        status: 'ready',
        data: {
          rows: bankRows(page.items, effectiveness),
          categories,
          library: libCategories && libItems ? globalLibraryTotals(libCategories, libItems) : null,
        },
      })
    } catch (error) {
      setState({ status: 'failed', message: messageOf(error, t('errors.generic')) })
    }
  }, [baseUrl, companyId, search, category, type, includeRetired, t])

  useEffect(() => {
    void reload()
  }, [reload])

  const toggleLifecycle = useCallback(
    async (id: string, isActive: boolean) => {
      setBusyId(id)
      setActionError(null)
      try {
        await setQuestionBankLifecycle(baseUrl, id, isActive ? 'retired' : 'active')
        await reload()
      } catch (error) {
        setActionError(messageOf(error, t('errors.generic')))
      } finally {
        setBusyId(null)
      }
    },
    [baseUrl, reload, t],
  )

  return { state, reload, toggleLifecycle, busyId, actionError }
}
