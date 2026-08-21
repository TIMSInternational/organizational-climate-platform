import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { cn } from '../../lib/cn'
import { dimensionLabel } from '../../features/surveys/dimensionLabel'
import {
  getQuestionLibraryItem,
  listQuestionCategories,
  listQuestionLibraryItems,
  type QuestionCategory,
  type QuestionLibraryItem,
  type QuestionLibraryItemDetail,
} from '../../features/questions/api/questionLibrary'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  LiveRegion,
  TextField,
} from '../ui'
import {
  categoryWithDescendants,
  filterLibraryItems,
  flattenCategories,
  visibleToCompany,
} from './questionLibraryFilter'

/**
 * The shared question picker (#115).
 *
 * ## Why it lives here and not in either feature folder
 *
 * Both wizards need it — the survey builder (#58) and the microclimate builder
 * (#127) — and the issue is explicit about why it is its own story: "shared
 * components between two epics are exactly what gets duplicated when each epic
 * builds in isolation". Under `features/surveys/` the microclimate wizard would be
 * importing across a feature boundary, which is the sentence that precedes someone
 * copying the file. Under `components/questions/` neither wizard owns it.
 *
 * `noDuplicatePicker.test.ts` is what keeps that true after this commit.
 *
 * ## Picking is a COPY, and the picker only reads
 *
 * `Question.SourceLibraryItemId` exists precisely so provenance can be recorded
 * without content depending on the library row — an answer is stored against the
 * question as it was ASKED, so a survey pointing at a mutable library row would
 * silently change the meaning of every stored answer when an author edited it. This
 * component therefore hands its caller a plain detail record and never writes
 * anything; each wizard maps it into its own question shape.
 *
 * ## The list projection is not enough to copy from
 *
 * `GET /admin/question-library` omits `options`, `scaleMin`/`scaleMax` and the four
 * scale-label columns. A `multiple_choice` item copied out of a list row arrives
 * with no options — an unanswerable question, created silently and discovered by a
 * respondent. Every add here goes through `GET /admin/question-library/{id}` first,
 * and the fetched detail is cached so preview and add never disagree.
 *
 * ## Two labelling props rather than an imported vocabulary
 *
 * `typeLabel` comes from the caller because the two surfaces have different question
 * vocabularies (`QuestionTypes.ForSurvey` vs `ForMicroclimate`) and #196 is the
 * record of what happens when a third copy of a vocabulary appears. The dimension
 * table is product-wide and single, so `dimensionLabel` is imported.
 */
export interface QuestionLibraryBrowserProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The company the picked questions are being written for. `null` (no company
   * chosen yet) offers nothing — see `visibleToCompany`.
   */
  companyId: string | null
  /** The question types the destination surface can render. */
  allowedTypes: readonly string[]
  /** The destination's own type vocabulary, so this component never mints a third. */
  typeLabel: (type: string) => string
  /** Called with the FULL detail of everything picked, in the order it was picked. */
  onAdd: (items: QuestionLibraryItemDetail[]) => void
  /**
   * Open with this item's preview already expanded.
   *
   * It exists for `/dev/question-library`. `scripts/shot.mjs` photographs a route and
   * cannot click, and the Vitest suite runs on happy-dom, which has no layout engine
   * — so without a way to reach the preview from a URL, the one part of this
   * component with its own layout could never be LOOKED at. Two defects in this
   * repository were found by a PNG and by nothing else.
   */
  initialPreviewId?: string
}

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export default function QuestionLibraryBrowser({
  open,
  onOpenChange,
  companyId,
  allowedTypes,
  typeLabel,
  onAdd,
  initialPreviewId,
}: QuestionLibraryBrowserProps) {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const [status, setStatus] = useState<LoadStatus>('idle')
  const [categories, setCategories] = useState<QuestionCategory[]>([])
  const [items, setItems] = useState<QuestionLibraryItem[]>([])
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [addedIds, setAddedIds] = useState<string[]>([])
  const [previewId, setPreviewId] = useState<string | null>(initialPreviewId ?? null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')

  // Details are fetched once per item and shared by preview and add. A ref rather
  // than state: a cache hit must not depend on a re-render having happened, or the
  // second of two adds in the same tick refetches.
  const detailCache = useRef(new Map<string, QuestionLibraryItemDetail>())

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setStatus('loading')
    setActionError(null)
    void Promise.all([
      // No `?companyId=`: for a SuperAdmin the server reads that as
      // `CompanyId == companyId`, which drops every global row. Scoping happens
      // below, on rows that still include the globals.
      listQuestionCategories(baseUrl),
      listQuestionLibraryItems(baseUrl),
    ])
      .then(([nextCategories, nextItems]) => {
        if (cancelled) return
        setCategories(nextCategories)
        setItems(nextItems)
        setStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [open, baseUrl])

  const scopedCategories = useMemo(
    () => visibleToCompany(categories, companyId),
    [categories, companyId],
  )
  const scopedItems = useMemo(() => visibleToCompany(items, companyId), [items, companyId])

  const visible = useMemo(
    () =>
      filterLibraryItems(scopedItems, {
        search,
        categoryId,
        categories: scopedCategories,
        allowedTypes,
      }),
    [scopedItems, search, categoryId, scopedCategories, allowedTypes],
  )

  const categoryNodes = useMemo(() => flattenCategories(scopedCategories), [scopedCategories])

  /** How many offerable items sit in a category and everything below it. */
  const countFor = useCallback(
    (id: string): number => {
      const subtree = categoryWithDescendants(scopedCategories, id)
      return scopedItems.filter(
        (item) =>
          item.isActive && allowedTypes.includes(item.type) && subtree.has(item.questionCategoryId),
      ).length
    },
    [scopedCategories, scopedItems, allowedTypes],
  )

  const loadDetail = useCallback(
    async (id: string): Promise<QuestionLibraryItemDetail> => {
      const cached = detailCache.current.get(id)
      if (cached) return cached
      const detail = await getQuestionLibraryItem(baseUrl, id)
      detailCache.current.set(id, detail)
      return detail
    },
    [baseUrl],
  )

  const [previewDetail, setPreviewDetail] = useState<QuestionLibraryItemDetail | null>(null)

  useEffect(() => {
    if (previewId === null) {
      setPreviewDetail(null)
      return
    }
    let cancelled = false
    setActionError(null)
    void loadDetail(previewId)
      .then((detail) => {
        if (!cancelled) setPreviewDetail(detail)
      })
      .catch(() => {
        if (!cancelled) setActionError(t('questionLibrary.previewFailed'))
      })
    return () => {
      cancelled = true
    }
  }, [previewId, loadDetail, t])

  /**
   * Adds by id, always through the detail endpoint.
   *
   * `close` is false for quick-add: its whole purpose is adding several questions
   * without leaving the library, and a dialog that shut after each one would make it
   * slower than the multi-select it sits beside.
   */
  async function addByIds(ids: string[], close: boolean): Promise<void> {
    if (ids.length === 0) return
    setBusy(true)
    setActionError(null)
    try {
      const details: QuestionLibraryItemDetail[] = []
      for (const id of ids) details.push(await loadDetail(id))
      onAdd(details)
      setAddedIds((current) => [...current, ...ids.filter((id) => !current.includes(id))])
      setSelected((current) => current.filter((id) => !ids.includes(id)))
      setAnnouncement(t('questionLibrary.addedCount', { count: details.length }))
      if (close) onOpenChange(false)
    } catch {
      // Nothing was handed to the wizard: `onAdd` runs only after every detail has
      // arrived, so a half-copied selection cannot reach the questions step.
      setActionError(t('questionLibrary.addFailed'))
    } finally {
      setBusy(false)
    }
  }

  function toggleSelected(id: string): void {
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    )
  }

  const textFor = (item: QuestionLibraryItem): string =>
    locale === 'es' ? item.textEs || item.textEn : item.textEn || item.textEs

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t('common.close')}
        className="max-h-[90vh] max-w-4xl overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{t('questionLibrary.title')}</DialogTitle>
          <DialogDescription>{t('questionLibrary.description')}</DialogDescription>
        </DialogHeader>

        {status === 'error' && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{t('questionLibrary.loadFailed')}</AlertDescription>
          </Alert>
        )}
        {actionError !== null && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-panel-gap md:grid-cols-[14rem_1fr]">
          <nav aria-label={t('questionLibrary.categoriesLabel')} className="grid content-start gap-inline">
            <p className="m-0 font-medium">{t('questionLibrary.categoriesLabel')}</p>
            <Button
              type="button"
              variant={categoryId === null ? 'primary' : 'ghost'}
              className="justify-start text-left"
              aria-pressed={categoryId === null}
              onClick={() => setCategoryId(null)}
            >
              {t('questionLibrary.allCategories')}
            </Button>
            {categoryNodes.map(({ category, depth }) => (
              <Button
                key={category.id}
                type="button"
                variant={categoryId === category.id ? 'primary' : 'ghost'}
                // Depth as a literal class rather than an inline `padding-inline-start`
                // calc: `utilityExistence.test.ts` reads `className` out of `.tsx` and
                // can only prove a class compiles when it can see the string.
                className={cn(
                  'justify-start text-left',
                  depth === 1 && 'ps-6',
                  depth >= 2 && 'ps-9',
                )}
                aria-pressed={categoryId === category.id}
                onClick={() => setCategoryId(category.id)}
              >
                <span className="min-w-0 truncate">
                  {locale === 'es' ? category.nameEs : category.nameEn}
                </span>
                <span className="ms-auto font-mono text-xs tabular-nums text-fg-secondary">
                  {countFor(category.id)}
                </span>
              </Button>
            ))}
          </nav>

          <div className="grid content-start gap-panel-gap">
            <TextField
              label={t('questionLibrary.searchLabel')}
              description={t('questionLibrary.searchHint')}
              value={search}
              onChange={setSearch}
            />

            {status === 'loading' && <p className="m-0 text-fg-secondary">{t('common.loading')}</p>}

            {status === 'ready' && visible.length === 0 && (
              <p className="m-0 text-fg-secondary">{t('questionLibrary.noMatches')}</p>
            )}

            <ul className="m-0 grid list-none gap-inline p-0">
              {visible.map((item) => {
                const textId = `library-item-${item.id}`
                const alreadyAdded = addedIds.includes(item.id)
                const text = textFor(item)
                return (
                  <li
                    key={item.id}
                    className="grid gap-inline rounded-lg border border-line-panel p-inline"
                  >
                    <div className="flex flex-wrap items-start gap-inline">
                      <Checkbox
                        className="mt-1"
                        checked={selected.includes(item.id)}
                        disabled={alreadyAdded || busy}
                        aria-labelledby={textId}
                        onCheckedChange={() => toggleSelected(item.id)}
                      />
                      <div className="grid min-w-0 flex-1 gap-inline">
                        <span id={textId} className="min-w-0">
                          {text}
                        </span>
                        <span className="flex flex-wrap items-center gap-inline">
                          <Badge variant="secondary">{typeLabel(item.type)}</Badge>
                          {/* The COMPANY's own rows are marked, not the global ones.
                              Most of a library is global, so a "shared" chip is a
                              constant — it repeats on eight rows in nine and says
                              nothing. The rare half of a binary is the informative
                              half. */}
                          {item.companyId !== null && (
                            <Chip tone="good" label={t('questionLibrary.companyItem')} />
                          )}
                          {item.dimension !== null && item.dimension.trim() !== '' && (
                            <Chip tone="accent" label={dimensionLabel(item.dimension.trim(), t)} />
                          )}
                          {item.tags.map((tag) => (
                            <Chip key={tag} tone="neutral" label={tag} />
                          ))}
                        </span>
                      </div>
                      <span className="flex flex-none flex-wrap items-center gap-inline">
                        <Button
                          type="button"
                          variant="outline"
                          aria-expanded={previewId === item.id}
                          aria-label={t('questionLibrary.previewNamed', { question: text })}
                          onClick={() => setPreviewId(previewId === item.id ? null : item.id)}
                        >
                          {t('common.preview')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={alreadyAdded || busy}
                          aria-label={t('questionLibrary.addNamed', { question: text })}
                          onClick={() => void addByIds([item.id], false)}
                        >
                          {alreadyAdded ? (
                            <Check aria-hidden="true" className="size-icon" />
                          ) : (
                            <Plus aria-hidden="true" className="size-icon" />
                          )}
                          {alreadyAdded ? t('questionLibrary.added') : t('common.add')}
                        </Button>
                      </span>
                    </div>

                    {previewId === item.id && (
                      <div className="grid gap-inline rounded-md bg-surface-icon-box p-inline">
                        {previewDetail === null || previewDetail.id !== item.id ? (
                          <p className="m-0 text-fg-secondary">{t('common.loading')}</p>
                        ) : (
                          <PreviewBody detail={previewDetail} typeLabel={typeLabel} />
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        </div>

        <LiveRegion>{announcement}</LiveRegion>

        <DialogFooter>
          <span className="me-auto text-fg-secondary">
            {t('questionLibrary.selectedCount', { count: selected.length })}
          </span>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={selected.length === 0 || busy}
            onClick={() => void addByIds(selected, true)}
          >
            {t('questionLibrary.addSelected', { count: selected.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * What a question actually is, before it is copied: both languages, the scale it is
 * answered on, and the options with the stable values aggregation joins on.
 *
 * The value is printed beside each label for the reason `SurveyQuestionList` prints
 * it — it is what the copied question will carry, and what makes two surveys built
 * from the same library item comparable.
 */
function PreviewBody({
  detail,
  typeLabel,
}: {
  detail: QuestionLibraryItemDetail
  typeLabel: (type: string) => string
}) {
  const { t } = useTranslation()
  const scaleMin = detail.scaleMin
  const scaleMax = detail.scaleMax

  return (
    <>
      <p className="m-0">
        <span className="font-medium">{t('surveys.questionTextEn')}</span> {detail.textEn}
      </p>
      <p className="m-0">
        <span className="font-medium">{t('surveys.questionTextEs')}</span> {detail.textEs}
      </p>
      <p className="m-0 text-fg-secondary">
        {typeLabel(detail.type)}
        {scaleMin !== null && scaleMax !== null && (
          <> · {t('questionLibrary.scaleRange', { min: scaleMin, max: scaleMax })}</>
        )}
        {' · '}
        {t('questionLibrary.usageCount', { count: detail.usageCount })}
      </p>
      {(detail.scaleLabelMinEn !== null || detail.scaleLabelMaxEn !== null) && (
        <p className="m-0 text-fg-secondary">
          {t('questionLibrary.scaleEnds', {
            min: detail.scaleLabelMinEn ?? '',
            max: detail.scaleLabelMaxEn ?? '',
          })}
        </p>
      )}
      {detail.options.length > 0 && (
        <div className="grid gap-inline">
          <p className="m-0 font-medium">{t('surveys.optionsLabel')}</p>
          <ul className="m-0 grid list-none gap-inline p-0">
            {detail.options.map((option) => (
              <li key={option.value} className="m-0">
                {option.labelEn ?? option.value}
                {option.labelEs !== null && option.labelEs !== option.labelEn && (
                  <> / {option.labelEs}</>
                )}{' '}
                <span className="font-mono text-xs text-fg-secondary">({option.value})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
