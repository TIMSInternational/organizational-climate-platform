import { useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, Check, ChevronRight, Plus } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { PageHeader } from '../../../../components/layout'
import CompanyContextBar from '../../../../components/layout/CompanyContextBar'
import {
  Alert,
  AlertDescription,
  Button,
  Chip,
  ErrorState,
  Input,
  LoadingState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  chipVariants,
} from '../../../../components/ui'
import { useCompanyScope } from '../../../../company-context'
import { readViewerClaims } from '../../../../auth/viewerCapabilities'
import { cn } from '../../../../lib/cn'
import { companyShortName } from '../../../../lib/companyShortName'
import type { QuestionCategory, QuestionLibraryItem, QuestionLibraryItemDetail } from '../../api/questionLibrary'
import { QUESTION_LIBRARY_TYPES, requiresOptions } from '../../api/questionLibraryAdmin'
import {
  bothLanguages,
  canWriteLibraryRow,
  categoryName,
  copiesOf,
  draftFromDetail,
  emptyDraft,
  hasScale,
  itemsIn,
  usedCount,
  type LibraryDraft,
} from './libraryDerive'
import { useQuestionLibraryModel, type QuestionLibraryModelState } from './useQuestionLibraryModel'
import { Count, EDITOR_CARD, QSelect, TABLE_CARD } from '../parts'

type EditorMode = 'item' | 'new-item' | 'new-category'

/**
 * `/admin/question-library` — the redesigned Biblioteca de preguntas, which replaced
 * `QuestionLibraryPage` on this route (the old page stays in the tree, unrouted, as the wiring
 * reference), drawn as the SuperQuestionLibrary artboard of the per-role canvas (10 Sep).
 *
 * A browsable catalogue: the category tree on the left — the global categories, then each
 * tenant's, with a tenant's copies of the global ones folded into one row — and the chosen
 * category's questions on the right, both languages side by side, the owner on every row, and
 * the chosen question open in the editor under them, where both languages are mandatory.
 *
 * Every write is the old page's call: the update is built from the row's DETAIL, never its
 * list row, so an edit carries back the tags, options and scale the list projection drops
 * (`derive.ts`, `draftFromDetail`). The canvas's footer ("Cambiar el texto crea la versión 2")
 * claims a versioning the endpoint does not do — `UpdateItemAsync` rewrites the row in place
 * (`QuestionLibraryEndpoints.cs:371-381`) — so the page says what is true: surveys copy, so a
 * survey that already asked the question keeps its own copy.
 *
 * Roles: a super administrator writes any row and chooses the owner of a new one (global, or
 * the company chosen above); a company administrator reads the global rows and writes only
 * their own (`canWriteLibraryRow`, `:60-67`) — a global row opens read-only for them.
 */
export default function SuperQuestionLibraryView() {
  const { t } = useTranslation()
  const scope = useCompanyScope()
  const model = useQuestionLibraryModel()
  const [mode, setMode] = useState<EditorMode>('item')

  if (scope.status === 'no-company') {
    return <p role="alert">{t('common.noCompanyAssociated')}</p>
  }

  const tenantNames = model.tree.tenants.map((group) => model.companyNames.get(group.companyId)).filter(Boolean) as string[]
  const note =
    scope.status === 'ready'
      ? t('questionLibraryAdmin.next.barNoteChosen')
      : tenantNames.length === 1
        ? t('questionLibraryAdmin.next.barNoteUnchosenOne', { company: tenantNames[0] })
        : tenantNames.length > 1
          ? t('questionLibraryAdmin.next.barNoteUnchosenMany')
          : t('questionLibraryAdmin.next.barNoteUnchosenNone')

  return (
    <div>
      <CompanyContextBar note={note} />
      <PageHeader
        eyebrow={t('navigation.sectionWorkspace')}
        title={t('navigation.questionLibrary')}
        description={t('questionLibraryAdmin.next.description')}
        primaryAction={
          <Button type="button" variant="primary" onClick={() => setMode('new-item')}>
            <Plus aria-hidden="true" />
            {t('questionLibraryAdmin.next.newQuestion')}
          </Button>
        }
      />

      {model.error !== null ? (
        <ErrorState
          title={t('questionLibraryAdmin.loadFailed')}
          description={model.error}
          action={
            <Button type="button" variant="outline" onClick={model.reload}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : model.loading && model.categories.length === 0 ? (
        <LoadingState rows={8} label={t('common.loading')} />
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[270px_minmax(0,1fr)]">
          <CategoryTreeCard model={model} onNewCategory={() => setMode('new-category')} onPick={() => setMode('item')} />
          <div className="flex min-w-0 flex-col gap-4">
            <CategoryQuestions model={model} onOpen={() => setMode('item')} />
            {model.formError !== null && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{model.formError}</AlertDescription>
              </Alert>
            )}
            {mode === 'new-category' ? (
              <CategoryEditor model={model} onDone={() => setMode('item')} />
            ) : mode === 'new-item' ? (
              <ItemEditor key="new" model={model} detail={null} onDone={() => setMode('item')} />
            ) : model.detail ? (
              <ItemEditor key={model.detail.id} model={model} detail={model.detail} onDone={() => setMode('item')} />
            ) : model.detailError !== null ? (
              <p role="alert" className="m-0 text-sm text-fg-secondary">
                {model.detailError}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

function CategoryTreeCard({
  model,
  onNewCategory,
  onPick,
}: {
  model: QuestionLibraryModelState
  onNewCategory: () => void
  onPick: () => void
}) {
  const { t, locale } = useTranslation()
  const [openCopies, setOpenCopies] = useState<ReadonlySet<string>>(() => new Set())
  const { tree } = model
  const tenantCount = tree.tenants.reduce((sum, group) => sum + group.copies.length + group.own.length, 0)
  // Named in passing, as the canvas does — "6 globales · 6 de Acme" — without the legal form.
  const soleTenantName = tree.tenants.length === 1 ? model.companyNames.get(tree.tenants[0].companyId) : undefined
  const soleTenant = soleTenantName ? companyShortName(soleTenantName) : undefined
  const meta =
    tenantCount === 0
      ? t('questionLibraryAdmin.next.categoriesMetaGlobal', { global: tree.global.length })
      : soleTenant
        ? t('questionLibraryAdmin.next.categoriesMetaOne', { global: tree.global.length, tenant: tenantCount, company: soleTenant })
        : t('questionLibraryAdmin.next.categoriesMetaMany', { global: tree.global.length, tenant: tenantCount })

  const row = (category: QuestionCategory, indent = false) => {
    const selected = category.id === model.selectedCategoryId
    return (
      // Styled whole, so `index.css`'s carded bare button never shows.
      <button
        key={category.id}
        type="button"
        data-slot="category-row"
        data-category-id={category.id}
        aria-pressed={selected}
        onClick={() => {
          model.selectCategory(category.id)
          onPick()
        }}
        className={cn(
          'flex h-auto min-h-9 w-full items-center gap-2 rounded-md border-0 px-2.5 py-1.5 text-left shadow-none pointer-coarse:min-h-11',
          indent && 'pl-6',
          // Blue is selection (the 11 Nov ruling): the chosen category wears the tint, as a
          // source list marks its selected row.
          selected
            ? 'bg-accent-blue-soft font-semibold text-accent-blue-ink'
            : 'bg-transparent font-normal text-fg-primary hover:bg-state-hover',
        )}
      >
        <span className="min-w-0 flex-1 truncate text-base">{categoryName(category, locale)}</span>
        <Count className={selected ? 'text-accent-blue-ink' : undefined}>{category.itemCount}</Count>
      </button>
    )
  }

  return (
    <section
      aria-labelledby="library-categories"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-line-panel bg-surface-card p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="library-categories" className="m-0 text-2xl leading-tight">
          {t('questionLibraryAdmin.next.categoriesHeading')}
        </h2>
        <span className="text-sm text-fg-tertiary">{meta}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="px-2.5 py-1 text-2xs font-semibold uppercase tracking-eyebrow text-fg-label">
          {t('questionLibraryAdmin.next.globalGroup')}
        </span>
        {tree.global.map((category) => row(category))}
        {tree.tenants.map((group) => {
          const name = model.companyNames.get(group.companyId) ?? t('questionLibraryAdmin.next.otherCompany')
          const open = openCopies.has(group.companyId)
          const copiesItems = group.copies.reduce((sum, category) => sum + category.itemCount, 0)
          return (
            <div key={group.companyId} className="flex flex-col gap-0.5" data-tenant={group.companyId}>
              <span className="px-2.5 pt-3 pb-1 text-2xs font-semibold uppercase tracking-eyebrow text-fg-label">
                {t('questionLibraryAdmin.next.tenantGroup', { company: name })}
              </span>
              {group.copies.length > 0 && (
                <>
                  <button
                    type="button"
                    data-slot="copies-row"
                    aria-expanded={open}
                    onClick={() =>
                      setOpenCopies((current) => {
                        const next = new Set(current)
                        if (next.has(group.companyId)) next.delete(group.companyId)
                        else next.add(group.companyId)
                        return next
                      })
                    }
                    className="flex h-auto min-h-9 w-full items-center gap-2 rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left font-normal shadow-none hover:bg-state-hover pointer-coarse:min-h-11"
                  >
                    <ChevronRight aria-hidden="true" className={cn('size-3.5 shrink-0 text-fg-tertiary transition-transform', open && 'rotate-90')} />
                    <span className="flex-1 text-base text-fg-secondary">
                      {group.copies.length === 1
                        ? t('questionLibraryAdmin.next.copiesRowOne')
                        : t('questionLibraryAdmin.next.copiesRow', { count: group.copies.length })}
                    </span>
                    <Count>{copiesItems}</Count>
                  </button>
                  {open && group.copies.map((category) => row(category, true))}
                </>
              )}
              {group.own.map((category) => row(category))}
            </div>
          )
        })}
      </div>
      <div className="border-t border-line-default pt-3">
        <Button type="button" variant="outline" onClick={onNewCategory}>
          <Plus aria-hidden="true" />
          {t('questionLibraryAdmin.next.newCategory')}
        </Button>
      </div>
      <p className="m-0 text-sm leading-normal text-fg-tertiary">{t('questionLibraryAdmin.next.categoryFootnote')}</p>
    </section>
  )
}

function OwnerChip({ companyId, model, t }: { companyId: string | null; model: QuestionLibraryModelState; t: TranslateFn }) {
  if (companyId === null) return <Chip tone="neutral" label={t('questionLibraryAdmin.next.ownerGlobal')} />
  // Neutral like Global: an owner is a fact, not an action, a selection or a live state.
  return <Chip tone="neutral" label={model.companyNames.get(companyId) ?? t('questionLibraryAdmin.next.otherCompany')} />
}

function CategoryQuestions({ model, onOpen }: { model: QuestionLibraryModelState; onOpen: () => void }) {
  const { t, locale } = useTranslation()
  const viewer = readViewerClaims()
  const category = model.categories.find((entry) => entry.id === model.selectedCategoryId) ?? null
  if (!category) return null
  const rows = itemsIn(category.id, model.items)
  const used = usedCount(rows)
  const meta =
    used > 0
      ? rows.length === 1
        ? t('questionLibraryAdmin.next.countOneUsed')
        : t('questionLibraryAdmin.next.countSomeUsed', { count: rows.length, used })
      : rows.length === 1
        ? t('questionLibraryAdmin.next.countOneUnused')
        : t('questionLibraryAdmin.next.countNoneUsed', { count: rows.length })
  const copies = category.companyId === null ? copiesOf(category, model.categories) : []

  return (
    <section aria-labelledby="library-category-title" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 id="library-category-title" className="m-0 text-2xl leading-tight">
            {categoryName(category, locale)}
          </h2>
          <OwnerChip companyId={category.companyId} model={model} t={t} />
        </div>
        <span className="text-sm text-fg-tertiary">{meta}</span>
      </div>
      <div className={TABLE_CARD}>
        {/* Below `sm` the table is a list: the English text and the three short columns step out
            (`hidden sm:table-cell`, and their <col>s with them) and the Spanish cell carries them
            under the question, so a phone keeps Editar on screen instead of scrolling it off the
            card (lists-and-tables.md, layout.md > Adapt to the width). From `sm` up it is the board's table. */}
        <Table className="sm:min-w-180 sm:table-fixed">
          <colgroup>
            {/* The two languages share what the four short columns leave, so neither wraps to a
                ribbon at 1440: Tipo, Dimensión and Propietario at 104px, the action at 80. */}
            <col />
            <col className="hidden sm:table-column" />
            <col className="hidden w-26 sm:table-column" />
            <col className="hidden w-26 sm:table-column" />
            <col className="hidden w-26 sm:table-column" />
            <col className="w-20" />
          </colgroup>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col" className="pl-4">{t('questionLibraryAdmin.next.colTextEs')}</TableHead>
              <TableHead scope="col" className={WIDE}>{t('questionLibraryAdmin.next.colTextEn')}</TableHead>
              <TableHead scope="col" className={WIDE}>{t('questionLibraryAdmin.next.colType')}</TableHead>
              <TableHead scope="col" className={WIDE}>{t('questionLibraryAdmin.next.colDimension')}</TableHead>
              <TableHead scope="col" className={WIDE}>{t('questionLibraryAdmin.next.colOwner')}</TableHead>
              <TableHead scope="col" className="pr-4">
                <span className="sr-only">{t('common.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((item) => (
              <QuestionRow
                key={item.id}
                item={item}
                model={model}
                selected={item.id === model.selectedItemId}
                writable={canWriteLibraryRow(item, viewer)}
                onOpen={() => {
                  model.selectItem(item.id)
                  onOpen()
                }}
                t={t}
              />
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 && <p className="m-0 px-4 py-4 text-sm text-fg-secondary">{t('questionLibraryAdmin.next.emptyCategory')}</p>}
        {copies.length > 0 && <CopyNote category={category} copies={copies} model={model} rows={rows} t={t} />}
      </div>
    </section>
  )
}

function CopyNote({
  copies,
  model,
  rows,
  t,
}: {
  category: QuestionCategory
  copies: QuestionCategory[]
  model: QuestionLibraryModelState
  rows: QuestionLibraryItem[]
  t: TranslateFn
}) {
  const copy = copies[0]
  // The sentence names the tenant in full, as the artboard prints it ("…como copia de Acme
  // Corporation, con su propia versión…"); the link names it in passing, without the legal
  // form ("Ver las de Acme").
  const company = copy.companyId ? (model.companyNames.get(copy.companyId) ?? t('questionLibraryAdmin.next.otherCompany')) : ''
  const companyShort = company ? companyShortName(company) : ''
  const copyRows = itemsIn(copy.id, model.items)
  const texts = new Set(rows.map((item) => item.textEs.trim()))
  const same = copyRows.length === rows.length && copyRows.every((item) => texts.has(item.textEs.trim()))
  return (
    <div data-slot="copy-note" className="flex flex-wrap items-center justify-between gap-3 border-t border-line-default px-4 py-3 text-sm text-fg-tertiary">
      <span className="min-w-0 flex-1">
        {same
          ? rows.length === 1
            ? t('questionLibraryAdmin.next.copyNoteSameOne', { company })
            : t('questionLibraryAdmin.next.copyNoteSame', { count: countWord(t, rows.length), company })
          : t('questionLibraryAdmin.next.copyNoteOther', { count: copyRows.length, company })}
      </span>
      <button
        type="button"
        onClick={() => model.selectCategory(copy.id)}
        className="inline-flex h-auto min-h-9 shrink-0 items-center gap-1 whitespace-nowrap border-0 bg-transparent p-0 text-sm font-semibold text-accent-blue-ink shadow-none hover:underline"
      >
        {t('questionLibraryAdmin.next.copyLink', { company: companyShort })}
        <ArrowRight aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  )
}

// A column only a wide screen has room for; below `sm` the row's meta line carries it.
const WIDE = 'hidden sm:table-cell'

function QuestionRow({
  item,
  model,
  selected,
  writable,
  onOpen,
  t,
}: {
  item: QuestionLibraryItem
  model: QuestionLibraryModelState
  selected: boolean
  writable: boolean
  onOpen: () => void
  t: TranslateFn
}) {
  return (
    <TableRow
      data-library-item={item.id}
      aria-selected={selected}
      // Blue is selection (the 11 Nov ruling): the question open in the editor below wears the
      // same tint as the chosen category.
      className={cn(selected && 'bg-accent-blue-soft hover:bg-accent-blue-soft')}
    >
      <TableCell className="py-3 pl-4">
        <span className={cn('block text-base leading-snug text-fg-primary', selected ? 'font-semibold' : 'font-medium')}>{item.textEs}</span>
        <span data-slot="library-row-meta" className="mt-1 flex flex-col gap-1 sm:hidden">
          <span lang="en" className="block text-sm leading-snug text-fg-secondary">
            {item.textEn}
          </span>
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-fg-tertiary">
            <OwnerChip companyId={item.companyId} model={model} t={t} />
            <span>
              {t(`questionLibraryAdmin.type_${item.type}`)}
              {item.dimension ? ` · ${item.dimension}` : ''}
            </span>
          </span>
        </span>
      </TableCell>
      <TableCell className={cn('py-3', WIDE)}>
        <span lang="en" className="block text-sm leading-snug text-fg-secondary">
          {item.textEn}
        </span>
      </TableCell>
      <TableCell className={cn('py-3 text-sm text-fg-secondary', WIDE)}>{t(`questionLibraryAdmin.type_${item.type}`)}</TableCell>
      <TableCell className={cn('py-3 text-sm break-words text-fg-secondary', WIDE)}>{item.dimension ?? '—'}</TableCell>
      <TableCell className={cn('py-3', WIDE)}>
        <OwnerChip companyId={item.companyId} model={model} t={t} />
      </TableCell>
      <TableCell className="py-2 pr-4 text-right">
        <Button
          type="button"
          variant="plain"
          size="sm"
          aria-label={t(writable ? 'questionLibraryAdmin.next.editRow' : 'questionLibraryAdmin.next.viewRow', { text: item.textEs })}
          onClick={onOpen}
        >
          {writable ? t('common.edit') : t('questionLibraryAdmin.next.view')}
        </Button>
      </TableCell>
    </TableRow>
  )
}

function Field({ label, required, help, children, className }: { label: string; required?: boolean; help?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span className="text-sm font-semibold text-fg-primary">
        {label}
        {required && (
          <span aria-hidden="true" className="text-accent-red-ink">
            {' '}
            *
          </span>
        )}
      </span>
      {children}
      {/* The board's help line: 12px on a 1.45 leading — 17.4px a line, where snug set 16.2. */}
      {help && <span data-slot="field-help" className="text-sm leading-[1.45] text-fg-tertiary">{help}</span>}
    </div>
  )
}

function CanvasSelect({ value, onChange, disabled, label, children }: { value: string; onChange: (value: string) => void; disabled?: boolean; label: string; children: ReactNode }) {
  return (
    <QSelect aria-label={label} className="flex w-full" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      {children}
    </QSelect>
  )
}

function ItemEditor({
  model,
  detail,
  onDone,
}: {
  model: QuestionLibraryModelState
  detail: QuestionLibraryItemDetail | null
  onDone: () => void
}) {
  const { t, locale } = useTranslation()
  const scope = useCompanyScope()
  const viewer = readViewerClaims()
  const creating = detail === null
  const defaultOwner: 'global' | 'company' = scope.isSuperAdmin ? 'global' : 'company'
  const initial = detail ? draftFromDetail(detail) : emptyDraft(model.selectedCategoryId ?? model.categories[0]?.id ?? '', defaultOwner)
  const [draft, setDraft] = useState<LibraryDraft>(initial)
  const [tagInput, setTagInput] = useState('')
  const writable = creating || canWriteLibraryRow(detail, viewer)
  const chosenCompany = scope.companyId ? model.companyNames.get(scope.companyId) : undefined
  // Only a super administrator with a company chosen has a choice; everyone else's owner is fixed.
  const ownerChoice = creating && scope.isSuperAdmin && scope.status === 'ready'
  const readOnly = !writable

  const usage = detail
    ? detail.usageCount > 0
      ? t('questionLibraryAdmin.next.usageSome', { count: detail.usageCount })
      : t('questionLibraryAdmin.next.usageNone')
    : ''
  const ownerWord = detail
    ? detail.companyId === null
      ? t('questionLibraryAdmin.next.ownerWordGlobal')
      : (model.companyNames.get(detail.companyId) ?? t('questionLibraryAdmin.next.otherCompany'))
    : ''

  function addTag() {
    const tag = tagInput.trim()
    if (tag === '' || draft.tags.includes(tag)) return
    setDraft({ ...draft, tags: [...draft.tags, tag] })
    setTagInput('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (readOnly) return
    if (!bothLanguages(draft)) {
      model.setFormError(t('questionLibraryAdmin.bothLanguagesRequired'))
      return
    }
    if (draft.questionCategoryId === '') {
      model.setFormError(t('questionLibraryAdmin.categoryRequired'))
      return
    }
    if (requiresOptions(draft.type) && draft.options.trim() === '') {
      model.setFormError(t('questionLibraryAdmin.optionsRequired'))
      return
    }
    const ok = await model.saveItem(draft, detail?.id ?? null)
    if (ok && creating) onDone()
  }

  const ownerValue = creating ? draft.owner : detail?.companyId === null ? 'global' : 'company'
  const ownerCompanyName = creating ? (chosenCompany ?? model.companyNames.get(scope.companyId ?? '') ?? '') : ownerWord

  return (
    <form
      onSubmit={(event) => void submit(event)}
      aria-labelledby="library-editor-title"
      data-slot="library-editor"
      className={EDITOR_CARD}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="library-editor-title" className="m-0 text-2xl leading-tight">
          {creating ? t('questionLibraryAdmin.next.editorNew') : t('questionLibraryAdmin.next.editorEdit')}
        </h2>
        {detail && (
          <span className="text-sm text-fg-tertiary">
            {t('questionLibraryAdmin.next.editorMeta', { version: detail.version, owner: ownerWord, usage })}
          </span>
        )}
      </div>
      <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
        <Field label={t('questionLibraryAdmin.next.fieldTextEs')} required>
          <Input aria-label={t('questionLibraryAdmin.next.fieldTextEs')} value={draft.textEs} disabled={readOnly} onChange={(event) => setDraft({ ...draft, textEs: event.target.value })} />
        </Field>
        <Field label={t('questionLibraryAdmin.next.fieldTextEn')} required help={t('questionLibraryAdmin.next.bothLanguagesHelp')}>
          <Input lang="en" aria-label={t('questionLibraryAdmin.next.fieldTextEn')} value={draft.textEn} disabled={readOnly} onChange={(event) => setDraft({ ...draft, textEn: event.target.value })} />
        </Field>
        <Field label={t('questionLibraryAdmin.next.fieldCategory')}>
          <CanvasSelect
            label={t('questionLibraryAdmin.next.fieldCategory')}
            value={draft.questionCategoryId}
            disabled={readOnly}
            onChange={(questionCategoryId) => setDraft({ ...draft, questionCategoryId })}
          >
            {model.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {categoryName(category, locale)}
                {category.companyId ? ` · ${model.companyNames.get(category.companyId) ?? ''}` : ''}
              </option>
            ))}
          </CanvasSelect>
        </Field>
        <Field label={t('questionLibraryAdmin.next.fieldType')} help={t('questionLibraryAdmin.next.typeHelp')}>
          {/* Immutable after creation: the update DTO carries no type. */}
          <CanvasSelect label={t('questionLibraryAdmin.next.fieldType')} value={draft.type} disabled={!creating} onChange={(type) => setDraft({ ...draft, type })}>
            {QUESTION_LIBRARY_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`questionLibraryAdmin.type_${type}`)}
              </option>
            ))}
          </CanvasSelect>
        </Field>
        <Field label={t('questionLibraryAdmin.next.fieldDimension')} help={t('questionLibraryAdmin.next.dimensionHelp')}>
          <Input aria-label={t('questionLibraryAdmin.next.fieldDimension')} value={draft.dimension} disabled={readOnly} onChange={(event) => setDraft({ ...draft, dimension: event.target.value })} />
        </Field>
        <Field label={t('questionLibraryAdmin.next.fieldTags')} help={t('questionLibraryAdmin.next.tagsHelp')}>
          <div className="flex flex-wrap items-center gap-1.5">
            {draft.tags.map((tag) => (
              <button
                key={tag}
                type="button"
                disabled={readOnly}
                // The canvas draws a plain chip: the chip itself is the remove control, named so.
                aria-label={t('questionLibraryAdmin.next.removeTag', { tag })}
                title={t('questionLibraryAdmin.next.removeTag', { tag })}
                onClick={() => setDraft({ ...draft, tags: draft.tags.filter((entry) => entry !== tag) })}
                className={cn(chipVariants({ tone: 'neutral' }), 'cursor-pointer hover:border-line-hover')}
              >
                {tag}
              </button>
            ))}
            <Input
              className="w-37.5"
              aria-label={t('questionLibraryAdmin.next.addTag')}
              placeholder={t('questionLibraryAdmin.next.addTag')}
              value={tagInput}
              disabled={readOnly}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addTag()
                }
              }}
              onBlur={addTag}
            />
          </div>
        </Field>
        {hasScale(draft.type) && (
          <>
            <Field label={t('questionLibraryAdmin.next.scaleEs')} help={t('questionLibraryAdmin.next.scaleHelp')}>
              <div className="grid grid-cols-2 gap-2">
                <Input aria-label={`${t('questionLibraryAdmin.next.scaleEs')} · ${t('questionLibraryAdmin.next.scaleMinLabel')}`} placeholder={t('questionLibraryAdmin.next.scaleMinEsPlaceholder')} value={draft.scaleLabelMinEs} disabled={readOnly} onChange={(event) => setDraft({ ...draft, scaleLabelMinEs: event.target.value })} />
                <Input aria-label={`${t('questionLibraryAdmin.next.scaleEs')} · ${t('questionLibraryAdmin.next.scaleMaxLabel')}`} placeholder={t('questionLibraryAdmin.next.scaleMaxEsPlaceholder')} value={draft.scaleLabelMaxEs} disabled={readOnly} onChange={(event) => setDraft({ ...draft, scaleLabelMaxEs: event.target.value })} />
              </div>
            </Field>
            <Field label={t('questionLibraryAdmin.next.scaleEn')}>
              <div className="grid grid-cols-2 gap-2">
                <Input lang="en" aria-label={`${t('questionLibraryAdmin.next.scaleEn')} · ${t('questionLibraryAdmin.next.scaleMinLabel')}`} placeholder={t('questionLibraryAdmin.next.scaleMinEnPlaceholder')} value={draft.scaleLabelMinEn} disabled={readOnly} onChange={(event) => setDraft({ ...draft, scaleLabelMinEn: event.target.value })} />
                <Input lang="en" aria-label={`${t('questionLibraryAdmin.next.scaleEn')} · ${t('questionLibraryAdmin.next.scaleMaxLabel')}`} placeholder={t('questionLibraryAdmin.next.scaleMaxEnPlaceholder')} value={draft.scaleLabelMaxEn} disabled={readOnly} onChange={(event) => setDraft({ ...draft, scaleLabelMaxEn: event.target.value })} />
              </div>
            </Field>
          </>
        )}
        {requiresOptions(draft.type) && (
          <Field label={t('questionLibraryAdmin.next.fieldOptions')} className="md:col-span-2">
            <Textarea aria-label={t('questionLibraryAdmin.next.fieldOptions')} rows={4} value={draft.options} disabled={readOnly} onChange={(event) => setDraft({ ...draft, options: event.target.value })} />
          </Field>
        )}
        <Field label={t('questionLibraryAdmin.next.fieldOwner')} help={t('questionLibraryAdmin.next.ownerHelp')}>
          <CanvasSelect
            label={t('questionLibraryAdmin.next.fieldOwner')}
            value={ownerValue}
            disabled={!ownerChoice}
            onChange={(owner) => setDraft({ ...draft, owner: owner === 'company' ? 'company' : 'global' })}
          >
            <option value="global">{t('questionLibraryAdmin.next.ownerOptionGlobal')}</option>
            {(ownerChoice || ownerValue === 'company') && (
              <option value="company">{t('questionLibraryAdmin.next.ownerOptionCompany', { company: ownerCompanyName })}</option>
            )}
          </CanvasSelect>
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-default pt-3">
        <span className="min-w-0 flex-1 basis-60 text-sm leading-normal text-fg-tertiary">{readOnly ? t('questionLibraryAdmin.next.readOnlyNote') : t('questionLibraryAdmin.next.saveNote')}</span>
        {!readOnly && (
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              size="canvas"
              onClick={() => {
                model.setFormError(null)
                if (creating) onDone()
                else setDraft(initial)
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" size="canvas" disabled={model.saving}>
              <Check aria-hidden="true" />
              {t('questionLibraryAdmin.next.saveQuestion')}
            </Button>
          </div>
        )}
      </div>
    </form>
  )
}

function CategoryEditor({ model, onDone }: { model: QuestionLibraryModelState; onDone: () => void }) {
  const { t, locale } = useTranslation()
  const scope = useCompanyScope()
  const [nameEs, setNameEs] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [descriptionEs, setDescriptionEs] = useState('')
  const [descriptionEn, setDescriptionEn] = useState('')
  const [parent, setParent] = useState('')
  const [owner, setOwner] = useState<'global' | 'company'>(scope.isSuperAdmin ? 'global' : 'company')
  const ownerChoice = scope.isSuperAdmin && scope.status === 'ready'
  const company = scope.companyId ? model.companyNames.get(scope.companyId) : undefined

  async function submit(event: FormEvent) {
    event.preventDefault()
    // Both names, trimmed: whitespace is not a translation (the old page's rule).
    if (nameEs.trim() === '' || nameEn.trim() === '') {
      model.setFormError(t('questionLibraryAdmin.bothLanguagesRequired'))
      return
    }
    const ownerId = scope.isSuperAdmin ? (owner === 'company' ? scope.companyId : undefined) : scope.companyId
    const ok = await model.saveCategory({
      nameEn: nameEn.trim(),
      nameEs: nameEs.trim(),
      descriptionEn: descriptionEn.trim() || undefined,
      descriptionEs: descriptionEs.trim() || undefined,
      parentCategoryId: parent || undefined,
      ...(ownerId ? { companyId: ownerId } : {}),
    })
    if (ok) onDone()
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      aria-labelledby="library-category-editor"
      data-slot="category-editor"
      className={EDITOR_CARD}
    >
      <h2 id="library-category-editor" className="m-0 text-2xl leading-tight">
        {t('questionLibraryAdmin.next.categoryEditorTitle')}
      </h2>
      <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
        <Field label={t('questionLibraryAdmin.next.nameEs')} required>
          <Input aria-label={t('questionLibraryAdmin.next.nameEs')} value={nameEs} onChange={(event) => setNameEs(event.target.value)} />
        </Field>
        <Field label={t('questionLibraryAdmin.next.nameEn')} required help={t('questionLibraryAdmin.next.bothLanguagesHelp')}>
          <Input lang="en" aria-label={t('questionLibraryAdmin.next.nameEn')} value={nameEn} onChange={(event) => setNameEn(event.target.value)} />
        </Field>
        <Field label={t('questionLibraryAdmin.next.descriptionEs')}>
          <Textarea aria-label={t('questionLibraryAdmin.next.descriptionEs')} rows={2} value={descriptionEs} onChange={(event) => setDescriptionEs(event.target.value)} />
        </Field>
        <Field label={t('questionLibraryAdmin.next.descriptionEn')}>
          <Textarea lang="en" aria-label={t('questionLibraryAdmin.next.descriptionEn')} rows={2} value={descriptionEn} onChange={(event) => setDescriptionEn(event.target.value)} />
        </Field>
        <Field label={t('questionLibraryAdmin.next.parent')}>
          <CanvasSelect label={t('questionLibraryAdmin.next.parent')} value={parent} onChange={setParent}>
            <option value="">{t('questionLibraryAdmin.next.noParent')}</option>
            {model.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {categoryName(category, locale)}
              </option>
            ))}
          </CanvasSelect>
        </Field>
        <Field label={t('questionLibraryAdmin.next.fieldOwner')} help={t('questionLibraryAdmin.next.ownerHelp')}>
          <CanvasSelect label={t('questionLibraryAdmin.next.fieldOwner')} value={owner} disabled={!ownerChoice} onChange={(value) => setOwner(value === 'company' ? 'company' : 'global')}>
            {scope.isSuperAdmin && <option value="global">{t('questionLibraryAdmin.next.ownerOptionGlobal')}</option>}
            {(ownerChoice || !scope.isSuperAdmin) && (
              <option value="company">{t('questionLibraryAdmin.next.ownerOptionCompany', { company: company ?? '' })}</option>
            )}
          </CanvasSelect>
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line-default pt-3">
        <Button type="button" variant="outline" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={model.saving}>
          <Check aria-hidden="true" />
          {t('questionLibraryAdmin.next.saveCategory')}
        </Button>
      </div>
    </form>
  )
}

/** "Las mismas dos preguntas" — a count from two to ten in words, as the canvas writes it in a sentence. */
function countWord(t: TranslateFn, count: number): string {
  return count >= 2 && count <= 10 ? t(`questionLibraryAdmin.next.countWord${count}`) : String(count)
}
