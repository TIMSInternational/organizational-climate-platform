import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { PageTopBar } from '../../../components/layout'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  Label,
  SkeletonText,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui'
import { KpiTile } from '../../../components/charts'
import { KpiRow, SectionHeading } from '../../dashboard/components/dashboardGrammar'
import { useCompanyScope } from '../../../company-context'
import { useTranslation } from '../../../i18n'
import { questionTypeLabel } from '../../surveys/surveyVocabulary'
import {
  createQuestionBankItem,
  listQuestionBankCategories,
  listQuestionBankEffectiveness,
  listQuestionBankItems,
  setQuestionBankLifecycle,
  updateQuestionBankItem,
  type QuestionBankCategoryCount,
  type QuestionBankEffectivenessItem,
  type QuestionBankItem,
  type QuestionBankMetrics,
  QUESTION_BANK_TYPES,
} from '../api/questionBank'

/**
 * The question bank — the curation surface (#114, over #110's endpoints).
 *
 * ## Why this is not built on `QuestionLibraryBrowser`
 *
 * The obvious-looking reuse is the wrong one, and `QuestionBankEndpoints.cs` says so in
 * its own remarks: "They do not overlap in purpose and must not be merged." The LIBRARY
 * is the authoring repository the survey and microclimate wizards pick from — a category
 * *hierarchy*, a dimension, bilingual by construction. The BANK is this: a flat string
 * category with a subcategory beside it, industry and company-size targeting, and
 * cross-corpus effectiveness. `QuestionLibraryBrowser` is a picker dialog whose entire
 * contract is "hand some items back to a wizard"; it carries no metrics column, no
 * lifecycle control and no write path, because #112 deliberately withheld all three.
 *
 * Building this page on it would have meant either bending the picker into a second
 * shape or pointing this screen at the wrong tables — and #114's own acceptance criteria
 * ("effectiveness metrics visible", "retire") only exist on `/admin/question-bank`.
 *
 * ## Effectiveness, and why the rate alone is not enough
 *
 * The list projection carries `responseRate` already. This page still loads
 * `/effectiveness` beside it, because a rate on its own cannot distinguish "everyone
 * skips this question" from "nobody has been asked it yet" — and those two need opposite
 * curation decisions. `timesAsked` is the number that separates them, so the table shows
 * asked and skipped, not just the percentage.
 *
 * ## Degrading when the AI features are absent
 *
 * #111's "needs attention" flagging does not exist yet, and `isAiGenerated` is the only
 * AI-adjacent field the wire actually carries. So the page renders an AI badge where the
 * flag is set and says nothing at all where it is not — no empty "AI" column, no
 * placeholder panel promising a feature. The effectiveness read is likewise wrapped on
 * its own: if it fails, the corpus table still renders and the metric cells read "—",
 * because the list is usable without the derivation and unusable without the rows.
 */

/** How a row is scored for the "needs attention" hint, once it has actually been asked. */
const LOW_RESPONSE_RATE = 60

/** Below this many completed askings, a rate is not yet a signal. */
const MIN_ASKINGS_FOR_A_VERDICT = 5

interface DraftItem {
  text: string
  type: string
  category: string
  subcategory: string
}

const EMPTY_DRAFT: DraftItem = { text: '', type: 'likert', category: '', subcategory: '' }

export default function QuestionBankPage() {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const scope = useCompanyScope()
  const companyId = scope.companyId

  const [items, setItems] = useState<QuestionBankItem[]>([])
  const [total, setTotal] = useState(0)
  const [categories, setCategories] = useState<QuestionBankCategoryCount[]>([])
  const [effectiveness, setEffectiveness] = useState<QuestionBankEffectivenessItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [includeRetired, setIncludeRetired] = useState(false)

  const [showCreate, setShowCreate] = useState(false)
  const [draft, setDraft] = useState<DraftItem>(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<DraftItem>(EMPTY_DRAFT)
  const [busyId, setBusyId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [list, cats] = await Promise.all([
        listQuestionBankItems(baseUrl, {
          search: search || undefined,
          category: category || undefined,
          includeRetired,
        }),
        listQuestionBankCategories(baseUrl),
      ])
      setItems(list.items)
      setTotal(list.total)
      setCategories(cats)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, search, category, includeRetired])

  useEffect(() => {
    void reload()
  }, [reload])

  // Loaded separately and allowed to fail on its own — see the module note. A corpus you
  // can read without its derivation is far more useful than an error page.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rows = await listQuestionBankEffectiveness(baseUrl, companyId)
        if (!cancelled) setEffectiveness(rows)
      } catch {
        if (!cancelled) setEffectiveness([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [baseUrl, companyId])

  const metricsById = useMemo(() => {
    const byId = new Map<string, QuestionBankMetrics>()
    for (const row of effectiveness) byId.set(row.questionBankItemId, row.metrics)
    return byId
  }, [effectiveness])

  const activeCount = items.filter((item) => item.isActive).length
  const retiredCount = items.length - activeCount

  // The corpus-wide response rate, weighted by how often each question was actually
  // asked. A plain mean over rates would let a question asked twice weigh as much as one
  // asked four hundred times.
  const corpusResponseRate = useMemo(() => {
    let asked = 0
    let answered = 0
    for (const metrics of metricsById.values()) {
      asked += metrics.timesAsked
      answered += metrics.timesAnswered
    }
    return asked === 0 ? null : Math.round((answered / asked) * 100)
  }, [metricsById])

  /**
   * Whether a row is worth an admin's attention right now.
   *
   * Three gates, and the screenshot earned two of them. A RETIRED question is already
   * dealt with — flagging one reads as "act on this" about a decision somebody has
   * already taken, and a badge that fires on rows needing nothing is a badge readers
   * learn to skip. And a rate over too few askings is noise rather than signal: four
   * people skipping a question says nothing about the question.
   */
  function needsAttention(item: QuestionBankItem): boolean {
    if (!item.isActive) return false
    const metrics = metricsById.get(item.id)
    if (!metrics || metrics.timesAsked < MIN_ASKINGS_FOR_A_VERDICT) return false
    return metrics.responseRate < LOW_RESPONSE_RATE
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (!draft.text.trim() || !draft.category.trim()) return
    await createQuestionBankItem(baseUrl, {
      text: draft.text.trim(),
      type: draft.type,
      category: draft.category.trim(),
      subcategory: draft.subcategory.trim() || undefined,
      // A CompanyAdmin may only write their own company's rows, and a SuperAdmin with a
      // selected company is authoring for that company rather than for every tenant.
      // Creating a GLOBAL row is a deliberate act and does not belong behind this form.
      companyId: companyId ?? undefined,
    })
    setDraft(EMPTY_DRAFT)
    setShowCreate(false)
    await reload()
  }

  async function handleSaveEdit(event: FormEvent) {
    event.preventDefault()
    if (!editingId) return
    await updateQuestionBankItem(baseUrl, editingId, {
      text: editDraft.text.trim(),
      category: editDraft.category.trim(),
      subcategory: editDraft.subcategory.trim() || undefined,
    })
    setEditingId(null)
    await reload()
  }

  async function handleLifecycle(item: QuestionBankItem) {
    setBusyId(item.id)
    try {
      await setQuestionBankLifecycle(baseUrl, item.id, item.isActive ? 'retired' : 'active')
      await reload()
    } finally {
      setBusyId(null)
    }
  }

  function beginEdit(item: QuestionBankItem) {
    setEditingId(item.id)
    setEditDraft({
      text: item.text ?? '',
      type: item.type,
      category: item.category,
      subcategory: item.subcategory ?? '',
    })
  }

  const numberFormat = new Intl.NumberFormat(locale)

  return (
    <div>
      <PageTopBar
        title={t('navigation.questionBank')}
        description={t('questionBank.description')}
        actions={
          <Button
            variant={showCreate ? 'outline' : 'default'}
            onClick={() => setShowCreate((open) => !open)}
          >
            {showCreate ? t('common.cancel') : t('questionBank.newQuestion')}
          </Button>
        }
      />

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="mb-section grid gap-panel-gap rounded-lg border border-line-light bg-surface-icon-box p-panel"
        >
          <p className="m-0 max-w-prose text-sm text-fg-secondary">
            {t('questionBank.createHint')}
          </p>
          <div className="grid gap-panel-gap md:grid-cols-2">
            <div className="grid gap-inline md:col-span-2">
              <Label htmlFor="qb-text">{t('questionBank.textLabel')}</Label>
              <Input
                id="qb-text"
                value={draft.text}
                onChange={(event) => setDraft({ ...draft, text: event.target.value })}
                required
              />
            </div>
            <div className="grid gap-inline">
              <Label htmlFor="qb-category">{t('questionBank.categoryLabel')}</Label>
              <Input
                id="qb-category"
                value={draft.category}
                onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                required
              />
            </div>
            <div className="grid gap-inline">
              <Label htmlFor="qb-subcategory">{t('questionBank.subcategoryLabel')}</Label>
              <Input
                id="qb-subcategory"
                value={draft.subcategory}
                onChange={(event) => setDraft({ ...draft, subcategory: event.target.value })}
              />
            </div>
            <div className="grid gap-inline">
              <Label htmlFor="qb-type">{t('questionBank.typeLabel')}</Label>
              {/* A native select, unstyled on purpose: the bank's type list is short,
                  `type` is immutable after creation, and `index.css` already styles every
                  bare `select` in `@layer base` with the control height, padding, border
                  and radius the Input primitive gets. The hand-rolled classes this used to
                  carry were redundant, and one of them (`h-control`) was not a real
                  utility at all — `utilityExistence.test.ts` is what caught it. */}
              <select
                id="qb-type"
                value={draft.type}
                onChange={(event) => setDraft({ ...draft, type: event.target.value })}
              >
                {QUESTION_BANK_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {questionTypeLabel(t, type)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <Button type="submit">{t('questionBank.createQuestion')}</Button>
          </div>
        </form>
      )}

      <KpiRow>
        <KpiTile label={t('questionBank.totalItems')} value={total} locale={locale} />
        <KpiTile
          label={t('questionBank.activeItems')}
          value={activeCount}
          locale={locale}
          sub={includeRetired ? t('questionBank.retiredCount', { count: retiredCount }) : undefined}
        />
        <KpiTile
          label={t('questionBank.corpusResponseRate')}
          value={corpusResponseRate}
          format={{ kind: 'percentage' }}
          locale={locale}
          sub={corpusResponseRate === null ? t('questionBank.neverAsked') : undefined}
        />
      </KpiRow>

      <section className="mt-section grid gap-panel-gap md:grid-cols-[2fr_1fr_auto] md:items-end">
        <div className="grid gap-inline">
          <Label htmlFor="qb-search">{t('questionBank.searchLabel')}</Label>
          <Input
            id="qb-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('questionBank.searchPlaceholder')}
          />
        </div>
        <div className="grid gap-inline">
          <Label htmlFor="qb-filter-category">{t('questionBank.categoryFilterLabel')}</Label>
          {/* Bare, for the same reason as the type select above. */}
          <select
            id="qb-filter-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">{t('questionBank.allCategories')}</option>
            {categories.map((row) => (
              <option key={`${row.category}/${row.subcategory ?? ''}`} value={row.category}>
                {row.category} ({row.activeItemCount})
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-inline pb-inline">
          <Switch
            id="qb-include-retired"
            checked={includeRetired}
            onCheckedChange={setIncludeRetired}
          />
          <Label htmlFor="qb-include-retired">{t('questionBank.includeRetired')}</Label>
        </div>
      </section>

      <section className="mt-section">
        <SectionHeading>{t('questionBank.corpus')}</SectionHeading>
        {error ? (
          <ErrorState title={t('questionBank.loadFailed')} description={error} />
        ) : loading ? (
          <SkeletonText lines={5} />
        ) : items.length === 0 ? (
          <EmptyState
            title={t('questionBank.noQuestions')}
            description={t('questionBank.noQuestionsDescription')}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('questionBank.columnQuestion')}</TableHead>
                <TableHead>{t('questionBank.columnCategory')}</TableHead>
                <TableHead>{t('questionBank.columnType')}</TableHead>
                <TableHead className="text-right">{t('questionBank.columnAsked')}</TableHead>
                <TableHead className="text-right">{t('questionBank.columnResponseRate')}</TableHead>
                <TableHead className="text-right">{t('questionBank.columnSkipRate')}</TableHead>
                <TableHead>{t('questionBank.columnActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const metrics = metricsById.get(item.id)
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <span className="block">{item.text ?? t('questionBank.noTextInLocale')}</span>
                      <span className="mt-inline flex flex-wrap gap-inline">
                        {!item.isActive && (
                          <Badge variant="outline">{t('questionBank.retired')}</Badge>
                        )}
                        {/* #111 does not exist yet, so this is derived from the numbers
                            this API already returns rather than from an AI flag the wire
                            does not carry. */}
                        {needsAttention(item) && (
                          <Badge variant="destructive">{t('questionBank.needsAttention')}</Badge>
                        )}
                        {item.isAiGenerated && (
                          <Badge variant="secondary">{t('questionBank.aiGenerated')}</Badge>
                        )}
                        {item.companyId === null && (
                          <Badge variant="secondary">{t('questionBank.global')}</Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      {item.category}
                      {item.subcategory ? ` · ${item.subcategory}` : ''}
                    </TableCell>
                    <TableCell>{questionTypeLabel(t, item.type)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {metrics ? numberFormat.format(metrics.timesAsked) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {metrics ? `${Math.round(metrics.responseRate)}%` : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {metrics ? `${Math.round(metrics.skipRate)}%` : '—'}
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-inline">
                        <Button variant="outline" size="sm" onClick={() => beginEdit(item)}>
                          {t('common.edit')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyId === item.id}
                          onClick={() => void handleLifecycle(item)}
                        >
                          {item.isActive
                            ? t('questionBank.retire')
                            : t('questionBank.reactivate')}
                        </Button>
                      </span>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </section>

      {editingId && (
        <form
          onSubmit={handleSaveEdit}
          className="mt-section grid gap-panel-gap rounded-lg border border-line-light bg-surface-icon-box p-panel"
        >
          <SectionHeading>{t('questionBank.editQuestion')}</SectionHeading>
          <p className="m-0 max-w-prose text-sm text-fg-secondary">
            {t('questionBank.editHint')}
          </p>
          <div className="grid gap-inline">
            <Label htmlFor="qb-edit-text">{t('questionBank.textLabel')}</Label>
            <Input
              id="qb-edit-text"
              value={editDraft.text}
              onChange={(event) => setEditDraft({ ...editDraft, text: event.target.value })}
              required
            />
          </div>
          <div className="grid gap-panel-gap md:grid-cols-2">
            <div className="grid gap-inline">
              <Label htmlFor="qb-edit-category">{t('questionBank.categoryLabel')}</Label>
              <Input
                id="qb-edit-category"
                value={editDraft.category}
                onChange={(event) => setEditDraft({ ...editDraft, category: event.target.value })}
                required
              />
            </div>
            <div className="grid gap-inline">
              <Label htmlFor="qb-edit-subcategory">{t('questionBank.subcategoryLabel')}</Label>
              <Input
                id="qb-edit-subcategory"
                value={editDraft.subcategory}
                onChange={(event) =>
                  setEditDraft({ ...editDraft, subcategory: event.target.value })
                }
              />
            </div>
          </div>
          <div className="flex gap-inline">
            <Button type="submit">{t('common.save')}</Button>
            <Button type="button" variant="outline" onClick={() => setEditingId(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
