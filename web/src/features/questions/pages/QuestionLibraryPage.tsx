import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { PageTopBar } from '../../../components/layout'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  Label,
  SkeletonText,
  Textarea,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui'
import { SectionHeading } from '../../dashboard/components/dashboardGrammar'
import { useCompanyScope } from '../../../company-context'
import { useTranslation } from '../../../i18n'
import {
  getQuestionLibraryItem,
  listQuestionCategories,
  listQuestionLibraryItems,
  type QuestionCategory,
  type QuestionLibraryItem,
} from '../api/questionLibrary'
import {
  QUESTION_LIBRARY_TYPES,
  createQuestionCategory,
  createQuestionLibraryItem,
  requiresOptions,
  updateQuestionCategory,
  updateQuestionLibraryItem,
} from '../api/questionLibraryAdmin'

/**
 * The question library's authoring screen — #423.
 *
 * ## Why this page had to exist
 *
 * `QuestionLibraryEndpoints` has carried POST and PUT for categories and items since
 * #112, and until now the only route that reached them was `/dev/question-library`,
 * inside `router.tsx`'s `import.meta.env.DEV` guard. **It is not in a production build.**
 * So the library could be read in the product (the wizards' picker) and written only by
 * `curl` or SQL. PROCOMER's instrument — roughly fifty questions — had nowhere in the
 * running application to go.
 *
 * ## This is not the question bank
 *
 * `/admin/question-bank` is the curation surface: a flat string category, industry
 * targeting, cross-corpus effectiveness. This is the authoring repository: a real
 * category hierarchy, a dimension, version chaining, and bilingual by construction. Both
 * endpoint files say the two must not be merged, so this page shares no component with
 * `QuestionBankPage` beyond the design system.
 *
 * ## Ownership is asked once and never again
 *
 * `CompanyId` is absent from both update DTOs because it is immutable after creation —
 * it decides who may write the row. That makes "global, or this company?" a decision
 * taken at the moment of creation and never revisited, which is exactly the question
 * #428's importer refuses to run without. So the create forms ask it outright rather
 * than inferring it from whatever the header switcher happened to be on:
 *
 * - a `company_admin` can only ever write their own company's rows (`CanWrite`), so the
 *   control is not rendered for them and the answer is stated instead;
 * - a `super_admin` chooses, and with no company selected the only honest option is
 *   global — the page says so rather than silently creating an unowned row.
 *
 * ## Both languages, always
 *
 * The library refuses a blank `NameEn`/`NameEs` or `TextEn`/`TextEs` (a half-translated
 * tree renders blank for one audience). The forms mark all four required and block the
 * submit, so the author is told which field is missing instead of meeting a bare 400.
 * The server remains the authority; this is a second guard, not the only one.
 */

interface CategoryDraft {
  nameEn: string
  nameEs: string
  descriptionEn: string
  descriptionEs: string
  parentCategoryId: string
  scope: 'global' | 'company'
}

interface ItemDraft {
  questionCategoryId: string
  textEn: string
  textEs: string
  type: string
  dimension: string
  options: string
  tags: string
  scope: 'global' | 'company'
}

const EMPTY_CATEGORY: CategoryDraft = {
  nameEn: '',
  nameEs: '',
  descriptionEn: '',
  descriptionEs: '',
  parentCategoryId: '',
  scope: 'global',
}

const EMPTY_ITEM: ItemDraft = {
  questionCategoryId: '',
  textEn: '',
  textEs: '',
  type: QUESTION_LIBRARY_TYPES[0],
  dimension: '',
  options: '',
  tags: '',
  scope: 'global',
}

/** Comma-separated, trimmed, blanks dropped. */
function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '')
}

/** One option per line. Blank lines are dropped so a trailing newline is not an option. */
function parseOptions(raw: string): { labelEn: string; labelEs: string }[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => ({ labelEn: line, labelEs: line }))
}

export default function QuestionLibraryPage() {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const scope = useCompanyScope()
  const companyId = scope.companyId

  // A super_admin with no company selected legitimately sees the whole corpus — the
  // endpoint returns global plus every company for that role. So this page does NOT
  // render the usual `needs-selection` prompt: it would block a view that works.
  const isSuperAdmin = scope.status === 'needs-selection' || companyId === undefined

  const [categories, setCategories] = useState<QuestionCategory[]>([])
  const [items, setItems] = useState<QuestionLibraryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const [categoryFilter, setCategoryFilter] = useState('')
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft>(EMPTY_CATEGORY)
  const [itemDraft, setItemDraft] = useState<ItemDraft>(EMPTY_ITEM)
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // NEITHER call passes `companyId`, and that is the whole point. Both endpoints
      // answer `CompanyId == companyId` when it is supplied for a super_admin, which
      // EXCLUDES the global rows -- `QuestionLibraryFilters` says so in its own doc
      // comment. An authoring screen that hid every global category and question is
      // precisely the screen PROCOMER's instrument could go missing from. Omitted, the
      // server gives a company_admin `global + own` and a super_admin everything, which
      // is what this page is for.
      const [cats, list] = await Promise.all([
        listQuestionCategories(baseUrl),
        listQuestionLibraryItems(baseUrl, {
          categoryId: categoryFilter || undefined,
        }),
      ])
      setCategories(cats)
      setItems(list)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, categoryFilter])

  useEffect(() => {
    void reload()
  }, [reload])

  const categoryName = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c.nameEn]))
    return (id: string) => byId.get(id) ?? id
  }, [categories])

  /**
   * The `companyId` a create should carry. `undefined` means a global row.
   * A company admin has no choice: `CanWrite` refuses anything but their own company.
   */
  const ownerFor = (draftScope: 'global' | 'company'): string | undefined => {
    if (!isSuperAdmin) return companyId
    return draftScope === 'company' ? companyId : undefined
  }

  const bothLanguages = (a: string, b: string) => a.trim() !== '' && b.trim() !== ''

  async function handleCreateCategory(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    if (!bothLanguages(categoryDraft.nameEn, categoryDraft.nameEs)) {
      setFormError(t('questionLibraryAdmin.bothLanguagesRequired'))
      return
    }
    setSaving(true)
    try {
      if (editingCategoryId) {
        await updateQuestionCategory(baseUrl, editingCategoryId, {
          nameEn: categoryDraft.nameEn.trim(),
          nameEs: categoryDraft.nameEs.trim(),
          descriptionEn: categoryDraft.descriptionEn.trim() || undefined,
          descriptionEs: categoryDraft.descriptionEs.trim() || undefined,
          parentCategoryId: categoryDraft.parentCategoryId || undefined,
        })
      } else {
        await createQuestionCategory(baseUrl, {
          nameEn: categoryDraft.nameEn.trim(),
          nameEs: categoryDraft.nameEs.trim(),
          descriptionEn: categoryDraft.descriptionEn.trim() || undefined,
          descriptionEs: categoryDraft.descriptionEs.trim() || undefined,
          parentCategoryId: categoryDraft.parentCategoryId || undefined,
          companyId: ownerFor(categoryDraft.scope),
        })
      }
      setCategoryDraft(EMPTY_CATEGORY)
      setEditingCategoryId(null)
      await reload()
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateItem(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    if (!bothLanguages(itemDraft.textEn, itemDraft.textEs)) {
      setFormError(t('questionLibraryAdmin.bothLanguagesRequired'))
      return
    }
    if (itemDraft.questionCategoryId === '') {
      setFormError(t('questionLibraryAdmin.categoryRequired'))
      return
    }
    const options = parseOptions(itemDraft.options)
    if (requiresOptions(itemDraft.type) && options.length === 0) {
      setFormError(t('questionLibraryAdmin.optionsRequired'))
      return
    }
    setSaving(true)
    try {
      if (editingItemId) {
        // No `type` and no `companyId`: both are immutable after creation.
        await updateQuestionLibraryItem(baseUrl, editingItemId, {
          questionCategoryId: itemDraft.questionCategoryId,
          textEn: itemDraft.textEn.trim(),
          textEs: itemDraft.textEs.trim(),
          dimension: itemDraft.dimension.trim() || undefined,
          options: options.length > 0 ? options : undefined,
          tags: parseTags(itemDraft.tags),
        })
      } else {
        await createQuestionLibraryItem(baseUrl, {
          questionCategoryId: itemDraft.questionCategoryId,
          textEn: itemDraft.textEn.trim(),
          textEs: itemDraft.textEs.trim(),
          type: itemDraft.type,
          dimension: itemDraft.dimension.trim() || undefined,
          options: options.length > 0 ? options : undefined,
          tags: parseTags(itemDraft.tags),
          companyId: ownerFor(itemDraft.scope),
        })
      }
      setItemDraft(EMPTY_ITEM)
      setEditingItemId(null)
      await reload()
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  function beginEditCategory(category: QuestionCategory) {
    setEditingCategoryId(category.id)
    setFormError(null)
    setCategoryDraft({
      nameEn: category.nameEn,
      nameEs: category.nameEs,
      descriptionEn: category.descriptionEn ?? '',
      descriptionEs: category.descriptionEs ?? '',
      parentCategoryId: category.parentCategoryId ?? '',
      scope: category.companyId ? 'company' : 'global',
    })
  }

  /**
   * Loads the FULL item before editing, and that is not politeness.
   *
   * `UpdateItemAsync` does `RemoveRange` over this item's options and tags and then
   * re-adds whatever the request carried, so a PUT built from a list row -- which
   * `QuestionLibraryItem` deliberately strips options and scale from -- would silently
   * delete every tag on the question it was only meant to retitle. Tags are what the
   * picker's search matches on besides the two texts, so the loss would surface much
   * later as "that question stopped being findable".
   */
  async function beginEditItem(item: QuestionLibraryItem) {
    setEditingItemId(item.id)
    setFormError(null)
    try {
      const detail = await getQuestionLibraryItem(baseUrl, item.id)
      setItemDraft({
        questionCategoryId: detail.questionCategoryId,
        textEn: detail.textEn,
        textEs: detail.textEs,
        type: detail.type,
        dimension: detail.dimension ?? '',
        options: detail.options.map((o) => o.labelEn ?? o.value).join('\n'),
        tags: detail.tags.join(', '),
        scope: detail.companyId ? 'company' : 'global',
      })
    } catch (cause) {
      // Leaving the draft untouched is the safe failure: an edit form pre-filled from a
      // list row would be the very PUT this function exists to prevent.
      setEditingItemId(null)
      setFormError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  if (scope.status === 'no-company') {
    return <p role="alert">{t('common.noCompanyAssociated')}</p>
  }

  const ownershipNote = isSuperAdmin
    ? companyId === undefined
      ? t('questionLibraryAdmin.ownershipGlobalOnly')
      : t('questionLibraryAdmin.ownershipChoice')
    : t('questionLibraryAdmin.ownershipCompany')
  const ownershipSelect = (
    id: string,
    value: 'global' | 'company',
    onPick: (next: 'global' | 'company') => void,
  ) => (
    <div className="grid gap-inline">
      <Label htmlFor={id}>{t('questionLibraryAdmin.ownership')}</Label>
      <select
        id={id}
        value={value}
        onChange={(event) => onPick(event.target.value === 'company' ? 'company' : 'global')}
      >
        <option value="global">{t('questionLibraryAdmin.ownershipGlobal')}</option>
        <option value="company">{t('questionLibraryAdmin.ownershipThisCompany')}</option>
      </select>
    </div>
  )

  return (
    <div>
      <PageTopBar
        title={t('navigation.questionLibrary')}
        description={t('questionLibraryAdmin.description')}
      />

      {error ? (
        <ErrorState title={t('questionLibraryAdmin.loadFailed')} description={error} />
      ) : null}
      {formError ? (
        <Alert variant="destructive" role="alert" className="mb-panel">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <section>
        <SectionHeading>{t('questionLibraryAdmin.categories')}</SectionHeading>
        <p className="m-0 mb-panel max-w-prose text-sm text-fg-secondary">{ownershipNote}</p>

        <form
          onSubmit={handleCreateCategory}
          className="mb-section grid gap-panel-gap rounded-lg border border-line-light bg-surface-icon-box p-panel"
        >
          <div className="grid gap-panel-gap md:grid-cols-2">
            <div className="grid gap-inline">
              <Label htmlFor="cat-name-en">{t('questionLibraryAdmin.nameEn')}</Label>
              <Input
                id="cat-name-en"
                value={categoryDraft.nameEn}
                required
                onChange={(e) => setCategoryDraft({ ...categoryDraft, nameEn: e.target.value })}
              />
            </div>
            <div className="grid gap-inline">
              <Label htmlFor="cat-name-es">{t('questionLibraryAdmin.nameEs')}</Label>
              <Input
                id="cat-name-es"
                value={categoryDraft.nameEs}
                required
                onChange={(e) => setCategoryDraft({ ...categoryDraft, nameEs: e.target.value })}
              />
            </div>
            <div className="grid gap-inline">
              <Label htmlFor="cat-desc-en">{t('questionLibraryAdmin.descriptionEn')}</Label>
              <Textarea
                id="cat-desc-en"
                rows={2}
                value={categoryDraft.descriptionEn}
                onChange={(e) =>
                  setCategoryDraft({ ...categoryDraft, descriptionEn: e.target.value })
                }
              />
            </div>
            <div className="grid gap-inline">
              <Label htmlFor="cat-desc-es">{t('questionLibraryAdmin.descriptionEs')}</Label>
              <Textarea
                id="cat-desc-es"
                rows={2}
                value={categoryDraft.descriptionEs}
                onChange={(e) =>
                  setCategoryDraft({ ...categoryDraft, descriptionEs: e.target.value })
                }
              />
            </div>
            <div className="grid gap-inline">
              <Label htmlFor="cat-parent">{t('questionLibraryAdmin.parentCategory')}</Label>
              <select
                id="cat-parent"
                value={categoryDraft.parentCategoryId}
                onChange={(e) =>
                  setCategoryDraft({ ...categoryDraft, parentCategoryId: e.target.value })
                }
              >
                <option value="">{t('questionLibraryAdmin.noParent')}</option>
                {categories
                  .filter((c) => c.id !== editingCategoryId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nameEn}
                    </option>
                  ))}
              </select>
            </div>
            {isSuperAdmin && companyId !== undefined && editingCategoryId === null
              ? ownershipSelect('cat-scope', categoryDraft.scope, (next) =>
                  setCategoryDraft({ ...categoryDraft, scope: next }),
                )
              : null}
          </div>
          <div className="flex flex-wrap gap-inline">
            <Button type="submit" disabled={saving}>
              {editingCategoryId
                ? t('questionLibraryAdmin.saveCategory')
                : t('questionLibraryAdmin.createCategory')}
            </Button>
            {editingCategoryId ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditingCategoryId(null)
                  setCategoryDraft(EMPTY_CATEGORY)
                  setFormError(null)
                }}
              >
                {t('common.cancel')}
              </Button>
            ) : null}
          </div>
        </form>

        {loading ? (
          <SkeletonText lines={3} />
        ) : categories.length === 0 ? (
          <EmptyState
            title={t('questionLibraryAdmin.noCategories')}
            description={t('questionLibraryAdmin.noCategoriesDescription')}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('questionLibraryAdmin.nameEn')}</TableHead>
                <TableHead>{t('questionLibraryAdmin.nameEs')}</TableHead>
                <TableHead>{t('questionLibraryAdmin.ownership')}</TableHead>
                <TableHead>{t('questionLibraryAdmin.itemCount')}</TableHead>
                <TableHead>{t('questionLibraryAdmin.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.nameEn}</TableCell>
                  <TableCell>{c.nameEs}</TableCell>
                  <TableCell>
                    <Badge>
                      {c.companyId
                        ? t('questionLibraryAdmin.ownershipThisCompany')
                        : t('questionLibraryAdmin.ownershipGlobal')}
                    </Badge>
                  </TableCell>
                  <TableCell>{c.itemCount}</TableCell>
                  <TableCell>
                    <Button type="button" variant="ghost" onClick={() => beginEditCategory(c)}>
                      {t('questionLibraryAdmin.edit')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="mt-section">
        <SectionHeading>{t('questionLibraryAdmin.questions')}</SectionHeading>

        <div className="mb-panel grid max-w-sm gap-inline">
          <Label htmlFor="item-filter">{t('questionLibraryAdmin.filterByCategory')}</Label>
          <select
            id="item-filter"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">{t('questionLibraryAdmin.allCategories')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameEn}
              </option>
            ))}
          </select>
        </div>

        <form
          onSubmit={handleCreateItem}
          className="mb-section grid gap-panel-gap rounded-lg border border-line-light bg-surface-icon-box p-panel"
        >
          <div className="grid gap-panel-gap md:grid-cols-2">
            <div className="grid gap-inline md:col-span-2">
              <Label htmlFor="item-category">{t('questionLibraryAdmin.category')}</Label>
              <select
                id="item-category"
                value={itemDraft.questionCategoryId}
                required
                onChange={(e) =>
                  setItemDraft({ ...itemDraft, questionCategoryId: e.target.value })
                }
              >
                <option value="">{t('questionLibraryAdmin.chooseCategory')}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nameEn}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-inline">
              <Label htmlFor="item-text-en">{t('questionLibraryAdmin.textEn')}</Label>
              <Input
                id="item-text-en"
                value={itemDraft.textEn}
                required
                onChange={(e) => setItemDraft({ ...itemDraft, textEn: e.target.value })}
              />
            </div>
            <div className="grid gap-inline">
              <Label htmlFor="item-text-es">{t('questionLibraryAdmin.textEs')}</Label>
              <Input
                id="item-text-es"
                value={itemDraft.textEs}
                required
                onChange={(e) => setItemDraft({ ...itemDraft, textEs: e.target.value })}
              />
            </div>
            <div className="grid gap-inline">
              <Label htmlFor="item-type">{t('questionLibraryAdmin.type')}</Label>
              <select
                id="item-type"
                value={itemDraft.type}
                // Immutable after creation: changing it would make the library disagree
                // with every question already copied from this row.
                disabled={editingItemId !== null}
                onChange={(e) => setItemDraft({ ...itemDraft, type: e.target.value })}
              >
                {QUESTION_LIBRARY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`questionLibraryAdmin.type_${type}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-inline">
              <Label htmlFor="item-dimension">{t('questionLibraryAdmin.dimension')}</Label>
              <Input
                id="item-dimension"
                value={itemDraft.dimension}
                onChange={(e) => setItemDraft({ ...itemDraft, dimension: e.target.value })}
              />
            </div>
            <div className="grid gap-inline md:col-span-2">
              <Label htmlFor="item-tags">{t('questionLibraryAdmin.tags')}</Label>
              <Input
                id="item-tags"
                value={itemDraft.tags}
                aria-describedby="item-tags-hint"
                onChange={(e) => setItemDraft({ ...itemDraft, tags: e.target.value })}
              />
              <p id="item-tags-hint" className="m-0 text-sm text-fg-secondary">
                {t('questionLibraryAdmin.tagsHint')}
              </p>
            </div>
            {requiresOptions(itemDraft.type) ? (
              <div className="grid gap-inline md:col-span-2">
                <Label htmlFor="item-options">{t('questionLibraryAdmin.options')}</Label>
                <Textarea
                  id="item-options"
                  value={itemDraft.options}
                  rows={4}
                  aria-describedby="item-options-hint"
                  onChange={(e) => setItemDraft({ ...itemDraft, options: e.target.value })}
                />
                <p id="item-options-hint" className="m-0 text-sm text-fg-secondary">
                  {t('questionLibraryAdmin.optionsHint')}
                </p>
              </div>
            ) : null}
            {isSuperAdmin && companyId !== undefined && editingItemId === null
              ? ownershipSelect('item-scope', itemDraft.scope, (next) =>
                  setItemDraft({ ...itemDraft, scope: next }),
                )
              : null}
          </div>
          <div className="flex flex-wrap gap-inline">
            <Button type="submit" disabled={saving}>
              {editingItemId
                ? t('questionLibraryAdmin.saveQuestion')
                : t('questionLibraryAdmin.createQuestion')}
            </Button>
            {editingItemId ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditingItemId(null)
                  setItemDraft(EMPTY_ITEM)
                  setFormError(null)
                }}
              >
                {t('common.cancel')}
              </Button>
            ) : null}
          </div>
        </form>

        {loading ? (
          <SkeletonText lines={5} />
        ) : items.length === 0 ? (
          <EmptyState
            title={t('questionLibraryAdmin.noQuestions')}
            description={t('questionLibraryAdmin.noQuestionsDescription')}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('questionLibraryAdmin.textEn')}</TableHead>
                <TableHead>{t('questionLibraryAdmin.textEs')}</TableHead>
                <TableHead>{t('questionLibraryAdmin.category')}</TableHead>
                <TableHead>{t('questionLibraryAdmin.type')}</TableHead>
                <TableHead>{t('questionLibraryAdmin.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{entry.textEn}</TableCell>
                  <TableCell>{entry.textEs}</TableCell>
                  <TableCell>{categoryName(entry.questionCategoryId)}</TableCell>
                  <TableCell>{t(`questionLibraryAdmin.type_${entry.type}`)}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => void beginEditItem(entry)}
                    >
                      {t('questionLibraryAdmin.edit')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  )
}
