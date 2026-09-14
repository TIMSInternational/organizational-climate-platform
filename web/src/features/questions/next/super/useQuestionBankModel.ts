import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCompanyScope } from '../../../../company-context'
import { useCompanyName } from '../../../../company-context/useCompanyName'
import { useTranslation } from '../../../../i18n'
import { listCompanies } from '../../../org-structure/api/companies'
import {
  createQuestionBankItem,
  listQuestionBankCategories,
  listQuestionBankEffectiveness,
  listQuestionBankItems,
  setQuestionBankLifecycle,
  updateQuestionBankItem,
  type QuestionBankCategoryCount,
  type QuestionBankItem,
  type QuestionBankMetrics,
} from '../../api/questionBank'
import { listQuestionCategories, listQuestionLibraryItems } from '../../api/questionLibrary'
import { OWNER_ALL, filterByOwner, librarySummary, type OwnerFilter } from './bankDerive'

/** How long typing rests before the search reaches the server. */
export const SEARCH_DEBOUNCE_MS = 350

export interface BankFilters {
  search: string
  category: string
  type: string
  includeRetired: boolean
  owner: OwnerFilter
}

export const EMPTY_BANK_FILTERS: BankFilters = { search: '', category: '', type: '', includeRetired: false, owner: OWNER_ALL }

export interface BankDraft {
  text: string
  type: string
  category: string
  subcategory: string
}

export interface QuestionBankModelState {
  loading: boolean
  error: string | null
  /** The rows after the owner filter; the server applied search, category, type and retired. */
  rows: readonly QuestionBankItem[]
  total: number
  metricsById: ReadonlyMap<string, QuestionBankMetrics>
  categories: readonly QuestionBankCategoryCount[]
  /** `null` while the library's reads are pending or when they failed — the card then omits the count. */
  library: { questions: number; categories: number } | null
  /** Company id → name, for the owner column and the owner filter. */
  companyNames: ReadonlyMap<string, string>
  filters: BankFilters
  setFilters: (next: BankFilters) => void
  create: (draft: BankDraft) => Promise<void>
  update: (id: string, draft: BankDraft) => Promise<void>
  toggleLifecycle: (item: QuestionBankItem) => Promise<void>
  busyId: string | null
  actionError: string | null
  reload: () => void
}

/**
 * The model behind `/admin/question-bank` — THE wiring seam of that screen, and the same
 * requests the old page made (`QuestionBankPage.tsx`): the list with search, category,
 * type and `includeRetired` on the query string and no company id (the server answers a
 * super administrator every tenant plus the global rows, a company administrator their own
 * plus the global ones); `/categories`; `/effectiveness` for the caller's scope, allowed to
 * fail on its own; the same create, update and lifecycle calls with the same bodies.
 *
 * Two reads are new and both are reads the product already makes elsewhere: the library's
 * categories and items (`questionLibrary.ts`, the wizards' picker) for the card that says
 * where the bank ends and the library begins, and `GET /admin/companies` — a super
 * administrator's only — to name each row's owner.
 */
export function useQuestionBankModel(): QuestionBankModelState {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const scope = useCompanyScope()
  const ownCompanyName = useCompanyName()
  const companyId = scope.companyId

  const [items, setItems] = useState<QuestionBankItem[]>([])
  const [total, setTotal] = useState(0)
  const [categories, setCategories] = useState<QuestionBankCategoryCount[]>([])
  const [metricsById, setMetricsById] = useState<ReadonlyMap<string, QuestionBankMetrics>>(() => new Map())
  const [library, setLibrary] = useState<{ questions: number; categories: number } | null>(null)
  const [companies, setCompanies] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFiltersState] = useState<BankFilters>(EMPTY_BANK_FILTERS)
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // The search waits for the typing to rest, so a word is one request and not one per key.
  useEffect(() => {
    if (filters.search === search) return
    const timer = setTimeout(() => setSearch(filters.search), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [filters.search, search])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [list, cats] = await Promise.all([
        listQuestionBankItems(baseUrl, {
          search: search || undefined,
          category: filters.category || undefined,
          type: filters.type || undefined,
          includeRetired: filters.includeRetired,
        }),
        listQuestionBankCategories(baseUrl),
      ])
      setItems(list.items)
      setTotal(list.total)
      setCategories(cats)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, search, filters.category, filters.type, filters.includeRetired, t])

  useEffect(() => {
    void reload()
  }, [reload])

  // Loaded on its own and allowed to fail: a corpus you can read without its derivation is
  // far more useful than an error page (the old page's rule).
  useEffect(() => {
    let cancelled = false
    listQuestionBankEffectiveness(baseUrl, companyId)
      .then((rows) => {
        if (!cancelled) setMetricsById(new Map(rows.map((row) => [row.questionBankItemId, row.metrics])))
      })
      .catch(() => {
        if (!cancelled) setMetricsById(new Map())
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, companyId])

  useEffect(() => {
    let cancelled = false
    Promise.all([listQuestionCategories(baseUrl), listQuestionLibraryItems(baseUrl)])
      .then(([cats, rows]) => {
        if (!cancelled) setLibrary(librarySummary(cats, rows))
      })
      .catch(() => {
        if (!cancelled) setLibrary(null)
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl])

  useEffect(() => {
    if (!scope.isSuperAdmin) return
    let cancelled = false
    listCompanies(baseUrl)
      .then((rows) => {
        if (!cancelled) setCompanies(new Map(rows.map((company) => [company.id, company.name])))
      })
      .catch(() => {
        if (!cancelled) setCompanies(new Map())
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, scope.isSuperAdmin])

  const companyNames = useMemo(() => {
    if (scope.isSuperAdmin || !companyId || !ownCompanyName) return companies
    return new Map([[companyId, ownCompanyName]])
  }, [companies, companyId, ownCompanyName, scope.isSuperAdmin])

  const rows = useMemo(() => filterByOwner(items, filters.owner), [items, filters.owner])

  const run = useCallback(
    async (id: string | null, action: () => Promise<unknown>) => {
      setActionError(null)
      setBusyId(id)
      try {
        await action()
        await reload()
      } catch (cause) {
        setActionError(cause instanceof Error ? cause.message : t('errors.generic'))
        throw cause
      } finally {
        setBusyId(null)
      }
    },
    [reload, t],
  )

  return {
    loading,
    error,
    rows,
    total,
    metricsById,
    categories,
    library,
    companyNames,
    filters,
    setFilters: setFiltersState,
    create: (draft) =>
      run(null, () =>
        createQuestionBankItem(baseUrl, {
          text: draft.text.trim(),
          type: draft.type,
          category: draft.category.trim(),
          subcategory: draft.subcategory.trim() || undefined,
          // The old page's rule, kept: a company administrator writes their own company's
          // rows, and a super administrator with a company chosen writes for that company.
          companyId: companyId ?? undefined,
        }),
      ),
    update: (id, draft) =>
      run(id, () =>
        updateQuestionBankItem(baseUrl, id, {
          text: draft.text.trim(),
          category: draft.category.trim(),
          subcategory: draft.subcategory.trim() || undefined,
        }),
      ),
    toggleLifecycle: (item) => run(item.id, () => setQuestionBankLifecycle(baseUrl, item.id, item.isActive ? 'retired' : 'active')),
    busyId,
    actionError,
    reload: () => {
      void reload()
    },
  }
}
