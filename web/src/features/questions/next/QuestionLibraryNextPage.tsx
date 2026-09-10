import { useMemo, useState, type FormEvent } from 'react'
import { Check, ChevronDown, Lock, Plus, Search, X } from 'lucide-react'
import { PageTopBar } from '../../../components/layout'
import { Alert, AlertDescription, Button, Chip, ErrorState, Input, LoadingRegion, SkeletonText, Textarea } from '../../../components/ui'
import { useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { useCompanyScope } from '../../../company-context'
import { useCompanyName } from '../../../company-context/useCompanyName'
import { useTranslation } from '../../../i18n'
import { cn } from '../../../lib/cn'
import { questionTypeLabel } from '../../surveys/surveyVocabulary'
import { getQuestionLibraryItem, type QuestionCategory, type QuestionLibraryItem } from '../api/questionLibrary'
import {
  createQuestionCategory,
  createQuestionLibraryItem,
  QUESTION_LIBRARY_TYPES,
  requiresOptions,
  updateQuestionLibraryItem,
} from '../api/questionLibraryAdmin'
import { Eyebrow, TABLE_CARD_CLASS, TH_CLASS } from '../../shared-next/parts'
import { categoryTree, flattenTree, matchesSearch, type CategoryNode } from './model'
import { useQuestionLibraryModel } from './useQuestionModels'
import { SELECT_CLASS } from './QuestionBankNextPage'

/**
 * Biblioteca de preguntas, redesigned (canvas board "QuestionLibrary"): a browsable
 * catalogue — the category tree left, the selected category's questions in the middle,
 * and a bilingual editor drawer on the right.
 *
 * Who may write what is the server's rule (`CanWrite` in the library endpoints): a super
 * administrator writes global rows; a company administrator writes only their own
 * company's, so every global row is read-only for them and the drawer opens it as "Ver".
 * The submit path is the previous page's, field for field (`pages/QuestionLibraryPage.tsx`,
 * which stays in the tree as the wiring reference): `companyId` is the caller's company for
 * a company administrator. The scale ends are sent only when typed.
 */

type Drawer =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit' | 'view'; item: QuestionLibraryItem }
  | { mode: 'category' }

interface ItemDraft {
  categoryId: string
  textEs: string
  textEn: string
  type: string
  dimension: string
  minEs: string
  maxEs: string
  minEn: string
  maxEn: string
  tags: string[]
  tagDraft: string
}

const EMPTY: ItemDraft = { categoryId: '', textEs: '', textEn: '', type: 'likert', dimension: '', minEs: '', maxEs: '', minEn: '', maxEn: '', tags: [], tagDraft: '' }

export default function QuestionLibraryNextPage() {
  const { t, locale } = useTranslation()
  const scope = useCompanyScope()
  const caps = useViewerCapabilities()
  const companyName = useCompanyName()
  const company = companyName ?? t('insights.next.thisCompany')
  const { state, reload } = useQuestionLibraryModel()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [drawer, setDrawer] = useState<Drawer>({ mode: 'closed' })
  const [draft, setDraft] = useState<ItemDraft>(EMPTY)
  const [category, setCategory] = useState({ nameEs: '', nameEn: '', parentId: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const canAuthor = caps.canManageOrg
  const canWriteRow = (row: { companyId: string | null }) =>
    scope.isSuperAdmin || (canAuthor && row.companyId !== null && row.companyId === scope.companyId)

  const tree = useMemo(
    () => (state.status === 'ready' ? categoryTree(state.data.categories, state.data.items) : { globals: [], own: [] }),
    [state],
  )
  const all = useMemo(() => [...flattenTree(tree.globals), ...flattenTree(tree.own)], [tree])
  const selected = all.find((node) => node.category.id === selectedId) ?? tree.globals[0] ?? tree.own[0] ?? null
  const nameOf = (c: QuestionCategory) => (locale === 'es' ? c.nameEs : c.nameEn) || c.nameEn
  const descriptionOf = (c: QuestionCategory) => (locale === 'es' ? c.descriptionEs : c.descriptionEn) ?? null
  const primary = (item: QuestionLibraryItem) => (locale === 'es' ? item.textEs : item.textEn)
  const secondary = (item: QuestionLibraryItem) => (locale === 'es' ? item.textEn : item.textEs)

  const itemsOf = (categoryId: string) =>
    state.status === 'ready'
      ? state.data.items.filter((item) => item.questionCategoryId === categoryId && matchesSearch(item, search) && (!type || item.type === type))
      : []

  function openCreate() {
    setFormError(null)
    setDraft({ ...EMPTY, categoryId: selected?.category.id ?? '' })
    setDrawer({ mode: 'create' })
  }

  async function openItem(item: QuestionLibraryItem) {
    setFormError(null)
    const mode = canWriteRow(item) ? 'edit' : 'view'
    setDrawer({ mode, item })
    setDraft({ ...EMPTY, categoryId: item.questionCategoryId, textEs: item.textEs, textEn: item.textEn, type: item.type, dimension: item.dimension ?? '', tags: item.tags })
    try {
      const detail = await getQuestionLibraryItem(import.meta.env.VITE_API_BASE_URL as string, item.id)
      setDraft((current) => ({
        ...current,
        minEs: detail.scaleLabelMinEs ?? '',
        maxEs: detail.scaleLabelMaxEs ?? '',
        minEn: detail.scaleLabelMinEn ?? '',
        maxEn: detail.scaleLabelMaxEn ?? '',
      }))
    } catch {
      // The row already shows its text; the scale ends are a detail worth losing over a blank drawer.
    }
  }

  async function submitItem(event: FormEvent) {
    event.preventDefault()
    const baseUrl = import.meta.env.VITE_API_BASE_URL as string
    if (draft.textEs.trim() === '' || draft.textEn.trim() === '') {
      setFormError(t('questionLibraryAdmin.bothLanguagesRequired'))
      return
    }
    if (!draft.categoryId) {
      setFormError(t('questionLibraryAdmin.categoryRequired'))
      return
    }
    const ends = {
      scaleLabelMinEs: draft.minEs.trim() || undefined,
      scaleLabelMaxEs: draft.maxEs.trim() || undefined,
      scaleLabelMinEn: draft.minEn.trim() || undefined,
      scaleLabelMaxEn: draft.maxEn.trim() || undefined,
    }
    setSaving(true)
    setFormError(null)
    try {
      if (drawer.mode === 'edit') {
        await updateQuestionLibraryItem(baseUrl, drawer.item.id, {
          questionCategoryId: draft.categoryId,
          textEn: draft.textEn.trim(),
          textEs: draft.textEs.trim(),
          dimension: draft.dimension.trim() || undefined,
          tags: draft.tags,
          ...ends,
        })
      } else {
        await createQuestionLibraryItem(baseUrl, {
          questionCategoryId: draft.categoryId,
          textEn: draft.textEn.trim(),
          textEs: draft.textEs.trim(),
          type: draft.type,
          dimension: draft.dimension.trim() || undefined,
          tags: draft.tags,
          companyId: scope.isSuperAdmin ? undefined : scope.companyId,
          ...ends,
        })
      }
      setDrawer({ mode: 'closed' })
      await reload()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('errors.generic'))
    } finally {
      setSaving(false)
    }
  }

  async function submitCategory(event: FormEvent) {
    event.preventDefault()
    if (category.nameEs.trim() === '' || category.nameEn.trim() === '') {
      setFormError(t('questionLibraryAdmin.bothLanguagesRequired'))
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await createQuestionCategory(import.meta.env.VITE_API_BASE_URL as string, {
        nameEn: category.nameEn.trim(),
        nameEs: category.nameEs.trim(),
        parentCategoryId: category.parentId || undefined,
        companyId: scope.isSuperAdmin ? undefined : scope.companyId,
      })
      setDrawer({ mode: 'closed' })
      await reload()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('errors.generic'))
    } finally {
      setSaving(false)
    }
  }

  const readOnly = drawer.mode === 'view'
  const globalCategoryCount = state.status === 'ready' ? state.data.categories.filter((c) => c.companyId === null).length : 0
  const ownCategoryCount = state.status === 'ready' ? state.data.categories.filter((c) => c.companyId !== null).length : 0

  return (
    <div>
      <PageTopBar
        eyebrow={companyName}
        title={t('questionLibrary.next.title')}
        description={t('questionLibrary.next.description', { company })}
        actions={
          canAuthor ? (
            <Button type="button" variant="outline" onClick={openCreate}>
              <Plus aria-hidden="true" />
              {t('questionLibrary.next.newQuestion')}
            </Button>
          ) : null
        }
      />

      {state.status === 'loading' ? (
        <LoadingRegion loading label={t('common.loading')}>
          <SkeletonText lines={6} />
        </LoadingRegion>
      ) : state.status === 'failed' ? (
        <ErrorState
          title={t('questionLibrary.loadFailed')}
          description={state.message}
          action={
            <Button variant="outline" onClick={() => void reload()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : (
        <div
          className={cn(
            'grid items-start gap-4 lg:grid-cols-[14.25rem_minmax(0,1fr)]',
            drawer.mode !== 'closed' && 'xl:grid-cols-[14.25rem_minmax(0,1fr)_24.5rem]',
          )}
        >
          <nav aria-label={t('questionLibrary.next.categories')} className="rounded-lg border border-line-default bg-surface-card p-4">
            <h2 className="m-0 text-xl">{t('questionLibrary.next.categories')}</h2>
            <p className="mb-3 mt-0.5 text-xs text-fg-secondary">
              {t('questionLibrary.next.categoriesSummary', {
                globals: globalCategoryCount,
                own:
                  ownCategoryCount === 0
                    ? t('questionLibrary.next.ownNone')
                    : t('questionLibrary.next.ownSome', { count: ownCategoryCount }),
              })}
            </p>
            <Eyebrow className="mb-1.5 flex items-center gap-1 px-2.5 tracking-wider">
              {!scope.isSuperAdmin && <Lock aria-hidden="true" className="size-3" />}
              {scope.isSuperAdmin ? t('questionLibrary.next.globals') : t('questionLibrary.next.globalsReadOnly')}
            </Eyebrow>
            <CategoryList nodes={tree.globals} selectedId={selected?.category.id ?? null} onSelect={setSelectedId} nameOf={nameOf} />
            <Eyebrow className="mb-1.5 mt-4 px-2.5 tracking-wider">{company}</Eyebrow>
            {tree.own.length === 0 ? (
              <p className="m-0 rounded-md border border-dashed border-line-default p-2.5 text-xs text-fg-secondary">
                {t('questionLibrary.next.noOwnCategories')}
              </p>
            ) : (
              <CategoryList nodes={tree.own} selectedId={selected?.category.id ?? null} onSelect={setSelectedId} nameOf={nameOf} />
            )}
            {canAuthor && (
              <div className="mt-3 border-t border-line-light pt-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setFormError(null)
                    setCategory({ nameEs: '', nameEn: '', parentId: '' })
                    setDrawer({ mode: 'category' })
                  }}
                >
                  <Plus aria-hidden="true" />
                  {t('questionLibrary.next.newCategory')}
                </Button>
              </div>
            )}
          </nav>

          <section aria-labelledby="library-selected" className="min-w-0">
            {selected ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="library-selected" className="m-0 flex items-baseline gap-2 text-xl">
                    {nameOf(selected.category)}
                    <span className="font-mono text-xs text-fg-secondary tabular-nums">{selected.count}</span>
                  </h2>
                  <Chip
                    tone="neutral"
                    icon={selected.category.companyId === null ? <Lock className="size-3" /> : undefined}
                    label={selected.category.companyId === null ? t('questionLibrary.next.global') : company}
                  />
                </div>
                <p className="mb-3 mt-1 max-w-measure text-xs text-fg-secondary">
                  {descriptionOf(selected.category) ? `${descriptionOf(selected.category)} ` : ''}
                  {usageSentence(t, selected, state.data.items)}
                </p>
                <div className="mb-3 flex flex-wrap gap-2">
                  <label className="relative min-w-60 flex-1">
                    <span className="sr-only">{t('questionLibrary.next.search')}</span>
                    <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-tertiary" />
                    <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('questionLibrary.next.search')} className="pl-8" />
                  </label>
                  <select aria-label={t('questionBank.next.allTypes')} className={`${SELECT_CLASS} w-40`} value={type} onChange={(e) => setType(e.target.value)}>
                    <option value="">{t('questionBank.next.allTypes')}</option>
                    {QUESTION_LIBRARY_TYPES.map((value) => (
                      <option key={value} value={value}>
                        {questionTypeLabel(t, value)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={TABLE_CARD_CLASS}>
                  <table className="w-full border-collapse text-sm">
                    <thead className="border-b border-line-light">
                      <tr>
                        <th scope="col" className={TH_CLASS}>{t('questionLibrary.next.colQuestion')}</th>
                        <th scope="col" className={`${TH_CLASS} w-32`}>{t('questionLibrary.next.colOwner')}</th>
                        <th scope="col" className={`${TH_CLASS} w-20`}>
                          <span className="sr-only">{t('questionLibrary.next.colAction')}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {itemsOf(selected.category.id).map((item) => (
                        <ItemRow key={item.id} item={item} primary={primary(item)} secondary={secondary(item)} owner={item.companyId === null ? t('questionLibrary.next.global') : company} action={canWriteRow(item) ? t('questionLibrary.next.edit') : t('questionLibrary.next.view')} onOpen={() => void openItem(item)} />
                      ))}
                      {selected.children.map((child) => (
                        <ChildSection key={child.category.id} child={child} parentName={nameOf(selected.category)} nameOf={nameOf}>
                          {itemsOf(child.category.id).map((item) => (
                            <ItemRow key={item.id} item={item} primary={primary(item)} secondary={secondary(item)} owner={item.companyId === null ? t('questionLibrary.next.global') : company} action={canWriteRow(item) ? t('questionLibrary.next.edit') : t('questionLibrary.next.view')} onOpen={() => void openItem(item)} />
                          ))}
                        </ChildSection>
                      ))}
                    </tbody>
                  </table>
                  <p className="m-0 border-t border-line-light px-3 py-2.5 text-xs text-fg-secondary">
                    {t('questionLibrary.next.globalsNote')}
                  </p>
                </div>
              </>
            ) : (
              <p className="text-sm text-fg-secondary">{t('questionLibrary.noMatches')}</p>
            )}
          </section>

          {drawer.mode !== 'closed' && (
            <aside
              aria-labelledby="library-drawer-title"
              className="rounded-lg border border-line-default border-l-2 border-l-fg-primary bg-surface-card shadow-md"
            >
              <div className="flex items-start justify-between gap-2 border-b border-line-light p-4">
                <div>
                  <Eyebrow className="tracking-wider">{company}</Eyebrow>
                  <h2 id="library-drawer-title" className="m-0 text-xl">
                    {drawer.mode === 'category'
                      ? t('questionLibrary.next.newCategory')
                      : drawer.mode === 'create'
                        ? t('questionLibrary.next.newQuestion')
                        : drawer.mode === 'edit'
                          ? t('questionLibrary.next.editQuestion')
                          : t('questionLibrary.next.globalQuestion')}
                  </h2>
                </div>
                <Button type="button" size="icon" variant="outline" aria-label={t('common.close')} onClick={() => setDrawer({ mode: 'closed' })}>
                  <X aria-hidden="true" />
                </Button>
              </div>
              {drawer.mode === 'category' ? (
                <form onSubmit={(e) => void submitCategory(e)}>
                  <div className="flex flex-col gap-3 p-4 text-sm">
                    <Field label={t('questionLibrary.next.nameEs')} required>
                      <Input value={category.nameEs} onChange={(e) => setCategory({ ...category, nameEs: e.target.value })} />
                    </Field>
                    <Field label={t('questionLibrary.next.nameEn')} required>
                      <Input value={category.nameEn} onChange={(e) => setCategory({ ...category, nameEn: e.target.value })} />
                    </Field>
                    <Field label={t('questionLibrary.next.parent')} hint={t('questionLibrary.next.parentHint')}>
                      <select className={`${SELECT_CLASS} w-full`} value={category.parentId} onChange={(e) => setCategory({ ...category, parentId: e.target.value })}>
                        <option value="">{t('questionLibrary.next.noParent')}</option>
                        {all.map((node) => (
                          <option key={node.category.id} value={node.category.id}>
                            {nameOf(node.category)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {formError && <FormError message={formError} />}
                  </div>
                  <DrawerFooter saving={saving} submitLabel={t('questionLibrary.next.createCategory')} onCancel={() => setDrawer({ mode: 'closed' })} />
                </form>
              ) : (
                <form onSubmit={(e) => void submitItem(e)}>
                  <fieldset disabled={readOnly || saving} className="m-0 flex flex-col gap-3 border-0 p-4 text-sm">
                    <Field label={t('questionLibrary.next.category')} hint={t('questionLibrary.next.categoryHint')}>
                      <select className={`${SELECT_CLASS} w-full`} value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
                        {all.map((node) => (
                          <option key={node.category.id} value={node.category.id}>
                            {nameOf(node.category)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={t('questionLibrary.next.textEs')} required>
                      <Textarea rows={2} value={draft.textEs} onChange={(e) => setDraft({ ...draft, textEs: e.target.value })} />
                    </Field>
                    <Field label={t('questionLibrary.next.textEn')} required hint={t('questionLibrary.next.bothRequired')}>
                      <Textarea rows={2} value={draft.textEn} onChange={(e) => setDraft({ ...draft, textEn: e.target.value })} />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={t('questionLibrary.next.type')} hint={t('questionLibrary.next.typeHint')}>
                        <select
                          className={`${SELECT_CLASS} w-full`}
                          value={draft.type}
                          disabled={drawer.mode !== 'create'}
                          onChange={(e) => setDraft({ ...draft, type: e.target.value })}
                        >
                          {QUESTION_LIBRARY_TYPES.filter((value) => !requiresOptions(value) || value === draft.type).map((value) => (
                            <option key={value} value={value}>
                              {questionTypeLabel(t, value)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label={t('questionLibrary.next.dimension')} hint={t('questionLibrary.next.dimensionHint')}>
                        <Input value={draft.dimension} onChange={(e) => setDraft({ ...draft, dimension: e.target.value })} />
                      </Field>
                    </div>
                    <Field label={t('questionLibrary.next.endsEs')}>
                      <div className="grid grid-cols-2 gap-2">
                        <Input aria-label={t('questionLibrary.next.endMinEs')} placeholder={t('questionLibrary.next.endMinEs')} value={draft.minEs} onChange={(e) => setDraft({ ...draft, minEs: e.target.value })} />
                        <Input aria-label={t('questionLibrary.next.endMaxEs')} placeholder={t('questionLibrary.next.endMaxEs')} value={draft.maxEs} onChange={(e) => setDraft({ ...draft, maxEs: e.target.value })} />
                      </div>
                    </Field>
                    <Field label={t('questionLibrary.next.endsEn')} hint={t('questionLibrary.next.endsHint')}>
                      <div className="grid grid-cols-2 gap-2">
                        <Input aria-label={t('questionLibrary.next.endMinEn')} placeholder={t('questionLibrary.next.endMinEn')} value={draft.minEn} onChange={(e) => setDraft({ ...draft, minEn: e.target.value })} />
                        <Input aria-label={t('questionLibrary.next.endMaxEn')} placeholder={t('questionLibrary.next.endMaxEn')} value={draft.maxEn} onChange={(e) => setDraft({ ...draft, maxEn: e.target.value })} />
                      </div>
                    </Field>
                    <Field label={t('questionLibrary.next.tags')}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {draft.tags.map((tag) => (
                          <Chip key={tag} tone="neutral" label={tag} />
                        ))}
                        <Input
                          className="min-w-32 flex-1"
                          placeholder={t('questionLibrary.next.addTag')}
                          value={draft.tagDraft}
                          onChange={(e) => setDraft({ ...draft, tagDraft: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && draft.tagDraft.trim()) {
                              e.preventDefault()
                              const tag = draft.tagDraft.trim()
                              setDraft({ ...draft, tags: draft.tags.includes(tag) ? draft.tags : [...draft.tags, tag], tagDraft: '' })
                            }
                          }}
                        />
                      </div>
                    </Field>
                    <Field label={t('questionLibrary.next.ownership')} hint={t('questionLibrary.next.ownershipHint')}>
                      <div className="flex h-8 items-center gap-2 rounded-md border border-line-light bg-surface-icon-box px-3 text-fg-primary">
                        <Lock aria-hidden="true" className="size-3.5" />
                        {drawer.mode === 'view'
                          ? t('questionLibrary.next.global')
                          : scope.isSuperAdmin
                            ? t('questionLibrary.next.global')
                            : t('questionLibrary.next.onlyCompany', { company })}
                      </div>
                    </Field>
                    {formError && <FormError message={formError} />}
                  </fieldset>
                  {!readOnly && (
                    <DrawerFooter
                      saving={saving}
                      submitLabel={drawer.mode === 'edit' ? t('common.save') : t('questionLibrary.next.createQuestion')}
                      onCancel={() => setDrawer({ mode: 'closed' })}
                    />
                  )}
                </form>
              )}
            </aside>
          )}
        </div>
      )}
    </div>
  )
}

function usageSentence(t: (key: string, vars?: Record<string, string | number>) => string, node: CategoryNode, items: QuestionLibraryItem[]): string {
  const ids = new Set(flattenTree([node]).map((n) => n.category.id))
  const inCategory = items.filter((item) => ids.has(item.questionCategoryId))
  const used = inCategory.filter((item) => item.usageCount > 0).length
  if (inCategory.length === 0) return ''
  return used === 0
    ? t('questionLibrary.next.noneUsed', { count: inCategory.length })
    : t('questionLibrary.next.someUsed', { used, count: inCategory.length })
}

function CategoryList({
  nodes,
  selectedId,
  onSelect,
  nameOf,
  depth = 0,
}: {
  nodes: CategoryNode[]
  selectedId: string | null
  onSelect: (id: string) => void
  nameOf: (c: QuestionCategory) => string
  depth?: number
}) {
  return (
    <ul className="m-0 list-none p-0">
      {nodes.map((node) => (
        <li key={node.category.id}>
          <Button
            type="button"
            variant="ghost"
            aria-current={node.category.id === selectedId ? 'true' : undefined}
            onClick={() => onSelect(node.category.id)}
            className={cn(
              'h-8 w-full justify-between gap-2 px-2.5 text-sm font-normal',
              depth > 0 && 'pl-10',
              node.category.id === selectedId ? 'bg-surface-icon-box font-semibold text-fg-primary' : 'text-fg-primary',
            )}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              {depth === 0 && (
                <ChevronDown aria-hidden="true" className={cn('size-3.5 shrink-0', node.children.length === 0 && 'invisible')} />
              )}
              <span className="truncate">{nameOf(node.category)}</span>
            </span>
            <span className="font-mono text-xs text-fg-secondary tabular-nums">{node.count}</span>
          </Button>
          {node.children.length > 0 && node.category.id === selectedId && (
            <CategoryList nodes={node.children} selectedId={selectedId} onSelect={onSelect} nameOf={nameOf} depth={depth + 1} />
          )}
        </li>
      ))}
    </ul>
  )
}

function ItemRow({ item, primary, secondary, owner, action, onOpen }: { item: QuestionLibraryItem; primary: string; secondary: string; owner: string; action: string; onOpen: () => void }) {
  const { t } = useTranslation()
  const meta = [questionTypeLabel(t, item.type), item.dimension ? t('questionLibrary.next.dimensionOf', { dimension: item.dimension }) : null, t('questionLibrary.next.version', { version: item.version })]
    .filter(Boolean)
    .join(' · ')
  return (
    <tr data-testid="library-row" className="border-b border-line-light">
      <td className="px-3 py-2.5 align-top">
        <div className="text-fg-primary">{primary}</div>
        <div className="text-xs text-fg-secondary">{secondary}</div>
        <div className="mt-0.5 text-2xs text-fg-tertiary">{meta}</div>
      </td>
      <td className="px-3 py-2.5 align-top">
        <Chip tone="neutral" icon={item.companyId === null ? <Lock className="size-3" /> : undefined} label={owner} />
      </td>
      <td className="px-3 py-2.5 text-right align-top">
        <Button type="button" size="sm" variant="ghost" onClick={onOpen}>
          {action}
        </Button>
      </td>
    </tr>
  )
}

function ChildSection({ child, parentName, nameOf, children }: { child: CategoryNode; parentName: string; nameOf: (c: QuestionCategory) => string; children: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <>
      <tr className="border-b border-line-light bg-surface-icon-box">
        <th scope="rowgroup" colSpan={3} className="px-3 py-1.5 text-left font-normal">
          <span className="text-2xs font-bold uppercase tracking-wider text-fg-label">{nameOf(child.category)}</span>{' '}
          <span className="text-xs text-fg-secondary">
            {t('questionLibrary.next.subcategoryOf', { parent: parentName, count: child.count })}
          </span>
        </th>
      </tr>
      {children}
    </>
  )
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold text-fg-primary">
        {label}
        {required && <span className="text-accent-red"> *</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-fg-secondary">{hint}</span>}
    </label>
  )
}

function FormError({ message }: { message: string }) {
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

function DrawerFooter({ saving, submitLabel, onCancel }: { saving: boolean; submitLabel: string; onCancel: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex justify-end gap-2 border-t border-line-light p-4">
      <Button type="button" variant="outline" onClick={onCancel}>
        {t('common.cancel')}
      </Button>
      <Button type="submit" variant="primary" disabled={saving}>
        <Check aria-hidden="true" />
        {submitLabel}
      </Button>
    </div>
  )
}
