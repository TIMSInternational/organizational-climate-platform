import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCompanyScope } from '../../../../company-context'
import { useCompanyName } from '../../../../company-context/useCompanyName'
import { useTranslation } from '../../../../i18n'
import { listCompanies } from '../../../org-structure/api/companies'
import {
  getQuestionLibraryItem,
  listQuestionCategories,
  listQuestionLibraryItems,
  type QuestionCategory,
  type QuestionLibraryItem,
  type QuestionLibraryItemDetail,
} from '../../api/questionLibrary'
import {
  createQuestionCategory,
  createQuestionLibraryItem,
  updateQuestionLibraryItem,
  type CreateQuestionCategoryInput,
} from '../../api/questionLibraryAdmin'
import { categoryTree, createBody, itemsIn, updateBody, type CategoryTree, type LibraryDraft } from './libraryDerive'

export interface QuestionLibraryModelState {
  loading: boolean
  error: string | null
  categories: readonly QuestionCategory[]
  items: readonly QuestionLibraryItem[]
  tree: CategoryTree
  /** Company id → name, for the owner chips and the tenant groups. */
  companyNames: ReadonlyMap<string, string>
  selectedCategoryId: string | null
  selectCategory: (id: string) => void
  selectedItemId: string | null
  selectItem: (id: string | null) => void
  /** The selected row's full detail — what the editor is built from. */
  detail: QuestionLibraryItemDetail | null
  detailError: string | null
  saving: boolean
  formError: string | null
  setFormError: (message: string | null) => void
  /** Saves the draft: an update when `itemId` is given, a create otherwise. */
  saveItem: (draft: LibraryDraft, itemId: string | null) => Promise<boolean>
  saveCategory: (input: CreateQuestionCategoryInput) => Promise<boolean>
  reload: () => void
}

/**
 * The model behind `/admin/question-library` — THE wiring seam of that screen, and the old
 * page's requests (`QuestionLibraryPage.tsx`): the category tree and the items with NO
 * `companyId` on either read — supplied for a super administrator it would EXCLUDE the global
 * rows (`questionLibrary.ts`, `QuestionLibraryFilters`) — then the same creates and the same
 * update, each built from the row's full detail so an edit never drops its tags, options or
 * scale (`derive.ts`, `draftFromDetail`). One read is new: `GET /admin/companies`, a super
 * administrator's only, to name each tenant's group.
 */
export function useQuestionLibraryModel(): QuestionLibraryModelState {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const scope = useCompanyScope()
  const ownCompanyName = useCompanyName()
  const [categories, setCategories] = useState<QuestionCategory[]>([])
  const [items, setItems] = useState<QuestionLibraryItem[]>([])
  const [companies, setCompanies] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [detail, setDetail] = useState<QuestionLibraryItemDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [cats, rows] = await Promise.all([listQuestionCategories(baseUrl), listQuestionLibraryItems(baseUrl)])
      setCategories(cats)
      setItems(rows)
      // Keep what the reader had open; otherwise open the first category and its first row.
      setSelectedCategoryId((current) => (current && cats.some((c) => c.id === current) ? current : (cats[0]?.id ?? null)))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, t])

  useEffect(() => {
    void reload()
  }, [reload])

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

  // The open row follows the open category: its first question, unless the reader chose one.
  useEffect(() => {
    if (selectedCategoryId === null) return
    setSelectedItemId((current) => {
      const inCategory = itemsIn(selectedCategoryId, items)
      if (current && inCategory.some((item) => item.id === current)) return current
      return inCategory[0]?.id ?? null
    })
  }, [selectedCategoryId, items])

  useEffect(() => {
    if (selectedItemId === null) {
      setDetail(null)
      return
    }
    let cancelled = false
    setDetailError(null)
    getQuestionLibraryItem(baseUrl, selectedItemId)
      .then((read) => {
        if (!cancelled) setDetail(read)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        // No editor from a list row: that is the very PUT which wipes tags and options.
        setDetail(null)
        setDetailError(cause instanceof Error ? cause.message : t('errors.generic'))
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, selectedItemId, t])

  const companyNames = useMemo(() => {
    if (scope.isSuperAdmin || !scope.companyId || !ownCompanyName) return companies
    return new Map([[scope.companyId, ownCompanyName]])
  }, [companies, ownCompanyName, scope.companyId, scope.isSuperAdmin])

  const saveItem = useCallback(
    async (draft: LibraryDraft, itemId: string | null) => {
      setSaving(true)
      setFormError(null)
      try {
        if (itemId) {
          const saved = await updateQuestionLibraryItem(baseUrl, itemId, updateBody(draft))
          setDetail(saved)
        } else {
          // A company administrator can only ever write their own company's rows; a super
          // administrator chooses, and with no company chosen the only honest owner is global.
          const owner = scope.isSuperAdmin ? (draft.owner === 'company' ? scope.companyId : undefined) : scope.companyId
          const created = await createQuestionLibraryItem(baseUrl, createBody(draft, owner))
          setSelectedCategoryId(created.questionCategoryId)
          setSelectedItemId(created.id)
        }
        await reload()
        return true
      } catch (cause) {
        setFormError(cause instanceof Error ? cause.message : t('errors.generic'))
        return false
      } finally {
        setSaving(false)
      }
    },
    [baseUrl, reload, scope.companyId, scope.isSuperAdmin, t],
  )

  const saveCategory = useCallback(
    async (input: CreateQuestionCategoryInput) => {
      setSaving(true)
      setFormError(null)
      try {
        const created = await createQuestionCategory(baseUrl, input)
        await reload()
        setSelectedCategoryId(created.id)
        return true
      } catch (cause) {
        setFormError(cause instanceof Error ? cause.message : t('errors.generic'))
        return false
      } finally {
        setSaving(false)
      }
    },
    [baseUrl, reload, t],
  )

  return {
    loading,
    error,
    categories,
    items,
    tree: useMemo(() => categoryTree(categories), [categories]),
    companyNames,
    selectedCategoryId,
    selectCategory: (id) => {
      setFormError(null)
      setSelectedCategoryId(id)
    },
    selectedItemId,
    selectItem: (id) => {
      setFormError(null)
      setSelectedItemId(id)
    },
    detail,
    detailError,
    saving,
    formError,
    setFormError,
    saveItem,
    saveCategory,
    reload: () => {
      void reload()
    },
  }
}
