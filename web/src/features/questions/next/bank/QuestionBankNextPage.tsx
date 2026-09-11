import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowRight, BookOpen, Check, ChevronDown, Library, MoreHorizontal, Plus, Search } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { PageTopBar } from '../../../../components/layout'
import CompanyContextBar from '../../../../components/layout/CompanyContextBar'
import {
  Alert,
  AlertDescription,
  Button,
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ErrorState,
  Input,
  SkeletonText,
  Switch,
  Table,
} from '../../../../components/ui'
import { useCompanyScope } from '../../../../company-context'
import { readViewerClaims } from '../../../../auth/viewerCapabilities'
import { cn } from '../../../../lib/cn'
import { questionTypeLabel } from '../../../surveys/surveyVocabulary'
import { QUESTION_BANK_TYPES, type QuestionBankItem } from '../../api/questionBank'
import { OWNER_ALL, OWNER_GLOBAL, askedAnsweredSkipped, canWriteRow, needsAttention } from './derive'
import { useQuestionBankModel, type BankDraft, type QuestionBankModelState } from './useQuestionBankModel'

const EMPTY_DRAFT: BankDraft = { text: '', type: 'likert', category: '', subcategory: '' }

// The canvas's `.label` head over the default hairline, as the survey list draws its tables.
const HEAD = 'px-3 pt-2 pb-2 text-left text-2xs font-bold uppercase leading-normal tracking-label text-fg-label whitespace-nowrap border-b border-line-default'

/**
 * `/admin/question-bank` — the redesigned Banco de preguntas, which replaced
 * `QuestionBankPage` on this route (the old page stays in the tree, unrouted, as the wiring
 * reference), drawn as the SuperQuestionBank artboard of the per-role canvas (10 Sep).
 *
 * The triage's ruling, second option: the page states the bank/library split in a card of
 * its own — this page is how each question performs once asked, the library is the wording
 * the wizards choose from — with an owner column (Global or the tenant) and an empty state
 * that says what actually fills the bank. The canvas's empty sentence ("se llena cuando el
 * instrumento de PROCOMER se cargue en la biblioteca y una encuesta lo pregunte") claims a
 * path that does not exist: only the bank's own create, bulk and import endpoints write a row
 * (`QuestionBankEndpoints.cs:1104-1132`), so the page says that instead.
 *
 * Roles: a super administrator reads every tenant plus the global rows and writes any of
 * them; a company administrator reads their own plus the global rows and writes only their
 * own (`canWriteRow`, `QuestionBankEndpoints.cs:94-102`) — a global row offers them no Edit
 * and no Retire. Every write is the old page's call with the old page's body.
 */
export default function QuestionBankNextPage() {
  const { t } = useTranslation()
  const scope = useCompanyScope()
  const model = useQuestionBankModel()
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; item: QuestionBankItem } | null>(null)

  if (scope.status === 'no-company') {
    return <p role="alert">{t('common.noCompanyAssociated')}</p>
  }

  return (
    <div>
      <CompanyContextBar
        note={scope.status === 'ready' ? t('questionBank.next.barNoteChosen') : t('questionBank.next.barNoteUnchosen')}
      />
      <PageTopBar
        eyebrow={t('navigation.sectionWorkspace')}
        title={t('navigation.questionBank')}
        description={`${t('questionBank.next.description')}${
          scope.isSuperAdmin ? t('questionBank.next.descriptionSuper') : t('questionBank.next.descriptionCompany')
        }`}
        actions={
          <Button type="button" variant="primary" onClick={() => setEditor({ mode: 'create' })}>
            <Plus aria-hidden="true" />
            {t('questionBank.next.newQuestion')}
          </Button>
        }
      />

      <div className="flex flex-col gap-6">
        <SplitCard model={model} t={t} />
        <Filters model={model} t={t} />
        {model.actionError !== null && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{model.actionError}</AlertDescription>
          </Alert>
        )}
        {editor && (
          <BankEditor
            key={editor.mode === 'edit' ? editor.item.id : 'create'}
            editor={editor}
            model={model}
            onClose={() => setEditor(null)}
          />
        )}
        <BankTable model={model} onEdit={(item) => setEditor({ mode: 'edit', item })} />
      </div>
    </div>
  )
}

function SplitCard({ model, t }: { model: QuestionBankModelState; t: TranslateFn }) {
  return (
    <section
      data-slot="bank-library-split"
      className="grid items-center gap-5 rounded-lg border border-line-default bg-surface-card px-5 py-3.5 shadow-xs md:grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)]"
    >
      <div className="flex items-start gap-3">
        <IconBox>
          <BookOpen />
        </IconBox>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-base font-semibold text-fg-primary">{t('questionBank.next.splitBankTitle')}</span>
          <span className="text-sm text-fg-secondary">{t('questionBank.next.splitBankBody')}</span>
        </div>
      </div>
      <span aria-hidden="true" className="hidden self-stretch bg-line-light md:block" />
      <div className="flex items-start gap-3">
        <IconBox>
          <Library />
        </IconBox>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-base font-semibold text-fg-primary">{t('questionBank.next.splitLibraryTitle')}</span>
          <span data-slot="library-summary" className="text-sm text-fg-secondary">
            {model.library
              ? t('questionBank.next.splitLibraryBody', {
                  questions: model.library.questions,
                  categories: model.library.categories,
                })
              : t('questionBank.next.splitLibraryBodyBare')}
          </span>
        </div>
        <Link to="/admin/question-library" className="inline-flex shrink-0 items-center gap-1 text-sm">
          {t('questionBank.next.openLibrary')}
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
    </section>
  )
}

function IconBox({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-icon-box text-fg-secondary [&_svg]:size-4"
    >
      {children}
    </span>
  )
}

/** A native select drawn as the canvas draws one: no platform arrow, the thin chevron. */
function CanvasSelect({
  label,
  value,
  onChange,
  className,
  children,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  className: string
  children: ReactNode
}) {
  return (
    <label className={cn('relative mb-0 w-full', className)}>
      <span className="sr-only">{label}</span>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-fg-label"
      />
      <select className="mt-0 block w-full appearance-none pr-8" value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  )
}

function Filters({ model, t }: { model: QuestionBankModelState; t: TranslateFn }) {
  const scope = useCompanyScope()
  const { filters, setFilters } = model
  const ownCompany = scope.companyId ? model.companyNames.get(scope.companyId) : undefined
  return (
    <div role="search" data-slot="bank-filters" className="flex flex-wrap items-center gap-3">
      <div className="relative w-full sm:w-70">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-label"
        />
        <Input
          type="search"
          aria-label={t('questionBank.next.searchPlaceholder')}
          placeholder={t('questionBank.next.searchPlaceholder')}
          value={filters.search}
          onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          className="pl-8"
        />
      </div>
      <CanvasSelect
        label={t('questionBank.next.colOwner')}
        className="sm:w-59"
        value={filters.owner}
        onChange={(owner) => setFilters({ ...filters, owner })}
      >
        <option value={OWNER_ALL}>
          {scope.isSuperAdmin || !ownCompany
            ? t('questionBank.next.ownerAll')
            : t('questionBank.next.ownerAllCompany', { company: ownCompany })}
        </option>
        <option value={OWNER_GLOBAL}>{t('questionBank.next.ownerGlobal')}</option>
        {[...model.companyNames.entries()].map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </CanvasSelect>
      <CanvasSelect
        label={t('questionBank.next.colCategory')}
        className="sm:w-45"
        value={filters.category}
        onChange={(category) => setFilters({ ...filters, category })}
      >
        <option value="">{t('questionBank.next.allCategories')}</option>
        {[...new Set(model.categories.map((row) => row.category))].map((category) => (
          <option key={category} value={category}>
            {category}
          </option>
        ))}
      </CanvasSelect>
      <CanvasSelect
        label={t('questionBank.next.colType')}
        className="sm:w-37.5"
        value={filters.type}
        onChange={(type) => setFilters({ ...filters, type })}
      >
        <option value="">{t('questionBank.next.allTypes')}</option>
        {QUESTION_BANK_TYPES.map((type) => (
          <option key={type} value={type}>
            {questionTypeLabel(t, type)}
          </option>
        ))}
      </CanvasSelect>
      <span className="flex items-center gap-2 text-sm text-fg-secondary sm:ml-auto">
        <Switch
          id="bank-show-retired"
          checked={filters.includeRetired}
          onCheckedChange={(includeRetired) => setFilters({ ...filters, includeRetired })}
        />
        <label htmlFor="bank-show-retired" className="m-0 text-sm font-normal text-fg-secondary">
          {t('questionBank.next.showRetired')}
        </label>
      </span>
    </div>
  )
}

function BankTable({ model, onEdit }: { model: QuestionBankModelState; onEdit: (item: QuestionBankItem) => void }) {
  const { t, locale } = useTranslation()
  const viewer = readViewerClaims()
  const numbers = new Intl.NumberFormat(locale)
  const filtered =
    model.filters.search !== '' || model.filters.category !== '' || model.filters.type !== '' || model.filters.owner !== OWNER_ALL

  return (
    <section aria-label={t('navigation.questionBank')} className="overflow-hidden rounded-lg border border-line-default bg-surface-card pt-2 shadow-xs">
      <div className="overflow-x-auto">
        <Table className="w-full min-w-200 table-fixed border-collapse">
          <colgroup>
            <col />
            <col className="w-33" />
            <col className="w-35.5" />
            <col className="w-28" />
            <col className="w-25.5" />
            <col className="w-25.5" />
            <col className="w-23" />
            <col className="w-21" />
          </colgroup>
          <thead>
            <tr>
              <th className={HEAD}>{t('questionBank.next.colQuestion')}</th>
              <th className={HEAD}>{t('questionBank.next.colOwner')}</th>
              <th className={HEAD}>{t('questionBank.next.colCategory')}</th>
              <th className={HEAD}>{t('questionBank.next.colType')}</th>
              <th className={cn(HEAD, 'text-right')}>{t('questionBank.next.colAsked')}</th>
              <th className={cn(HEAD, 'text-right')}>{t('questionBank.next.colAnswered')}</th>
              <th className={cn(HEAD, 'text-right')}>{t('questionBank.next.colSkipped')}</th>
              <th className={HEAD}>
                <span className="sr-only">{t('common.actions')}</span>
              </th>
            </tr>
          </thead>
          {!model.loading && model.error === null && (
            <tbody>
              {model.rows.map((item) => {
                const counts = askedAnsweredSkipped(model.metricsById.get(item.id))
                const owner = item.companyId === null ? null : (model.companyNames.get(item.companyId) ?? null)
                const writable = canWriteRow(item, viewer)
                const text = item.text ?? t('questionBank.noTextInLocale')
                return (
                  <tr key={item.id} data-bank-item={item.id} className={cn('border-b border-line-light last:border-b-0', !item.isActive && 'opacity-85')}>
                    <td className="px-3 py-3 align-top">
                      <span className="block text-base font-semibold text-fg-primary">{text}</span>
                      {(!item.isActive || needsAttention(item, model.metricsById.get(item.id)) || item.isAiGenerated) && (
                        <span className="mt-1.5 flex flex-wrap gap-1.5">
                          {!item.isActive && <Chip tone="neutral" label={t('questionBank.retired')} />}
                          {needsAttention(item, model.metricsById.get(item.id)) && (
                            <Chip tone="critical" label={t('questionBank.needsAttention')} />
                          )}
                          {item.isAiGenerated && <Chip tone="accent" label={t('questionBank.aiGenerated')} />}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top">
                      {item.companyId === null ? (
                        <Chip tone="neutral" label={t('questionBank.next.ownerGlobalChip')} />
                      ) : (
                        <span className="block truncate text-sm font-medium text-fg-secondary">
                          {owner ?? t('questionBank.next.ownerOtherCompany')}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top text-sm text-fg-secondary">
                      {item.category}
                      {item.subcategory ? ` · ${item.subcategory}` : ''}
                    </td>
                    <td className="px-3 py-3 align-top text-sm text-fg-secondary">{questionTypeLabel(t, item.type)}</td>
                    <td className="px-3 py-3 text-right align-top font-mono text-sm tabular-nums text-fg-primary">
                      {counts ? numbers.format(counts.asked) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right align-top font-mono text-sm tabular-nums text-fg-primary">
                      {counts ? numbers.format(counts.answered) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right align-top font-mono text-sm tabular-nums text-fg-primary">
                      {counts ? numbers.format(counts.skipped) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right align-top">
                      {writable && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              data-slot="bank-row-menu"
                              aria-label={t('questionBank.next.rowActions', { text })}
                              disabled={model.busyId === item.id}
                            >
                              <MoreHorizontal aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => onEdit(item)}>{t('common.edit')}</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void model.toggleLifecycle(item).catch(() => undefined)}>
                              {item.isActive ? t('questionBank.retire') : t('questionBank.reactivate')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          )}
        </Table>
      </div>
      {model.loading ? (
        <div className="px-3 py-4">
          <SkeletonText lines={4} />
        </div>
      ) : model.error !== null ? (
        <div className="p-4">
          <ErrorState
            title={t('questionBank.loadFailed')}
            description={model.error}
            action={
              <Button type="button" variant="outline" onClick={model.reload}>
                {t('common.retry')}
              </Button>
            }
          />
        </div>
      ) : model.rows.length === 0 ? (
        <div data-slot="bank-empty" className="flex items-center gap-3.5 px-3 py-4.5">
          <IconBox>
            <BookOpen />
          </IconBox>
          <div className="flex flex-col gap-0.5">
            <span className="text-base font-semibold text-fg-primary">
              {filtered ? t('questionBank.next.noMatchTitle') : t('questionBank.next.emptyTitle')}
            </span>
            <span className="text-sm text-fg-secondary">
              {filtered ? t('questionBank.next.noMatchBody') : t('questionBank.next.emptyBody')}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function BankEditor({
  editor,
  model,
  onClose,
}: {
  editor: { mode: 'create' } | { mode: 'edit'; item: QuestionBankItem }
  model: QuestionBankModelState
  onClose: () => void
}) {
  const { t } = useTranslation()
  const scope = useCompanyScope()
  const editing = editor.mode === 'edit' ? editor.item : null
  const [draft, setDraft] = useState<BankDraft>(
    editing
      ? { text: editing.text ?? '', type: editing.type, category: editing.category, subcategory: editing.subcategory ?? '' }
      : EMPTY_DRAFT,
  )
  const [saving, setSaving] = useState(false)
  const company = scope.companyId ? model.companyNames.get(scope.companyId) : undefined

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!draft.text.trim() || !draft.category.trim()) return
    setSaving(true)
    try {
      if (editing) await model.update(editing.id, draft)
      else await model.create(draft)
      onClose()
    } catch {
      // The model surfaced the server's message above the table; the draft stays for a retry.
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      aria-labelledby="bank-editor-title"
      data-slot="bank-editor"
      className="flex flex-col gap-3.5 rounded-lg border border-line-default border-l-[3px] border-l-fg-primary bg-surface-card px-5 pt-4 pb-4.5 shadow-xs"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="bank-editor-title" className="m-0 text-2xl">
          {editing ? t('questionBank.editQuestion') : t('questionBank.next.newQuestion')}
        </h2>
        <span className="text-sm text-fg-tertiary">
          {editing
            ? t('questionBank.next.editHint')
            : scope.status === 'ready'
              ? t('questionBank.next.ownershipCompany', { company: company ?? '' })
              : t('questionBank.next.ownershipGlobal')}
        </span>
      </div>
      <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
        <label className="m-0 flex flex-col gap-1.5 md:col-span-2">
          <span className="text-sm font-semibold text-fg-secondary">{t('questionBank.textLabel')}</span>
          <Input value={draft.text} required onChange={(event) => setDraft({ ...draft, text: event.target.value })} />
        </label>
        <label className="m-0 flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-fg-secondary">{t('questionBank.categoryLabel')}</span>
          <Input value={draft.category} required onChange={(event) => setDraft({ ...draft, category: event.target.value })} />
        </label>
        <label className="m-0 flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-fg-secondary">{t('questionBank.subcategoryLabel')}</span>
          <Input value={draft.subcategory} onChange={(event) => setDraft({ ...draft, subcategory: event.target.value })} />
        </label>
        <label className="m-0 flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-fg-secondary">{t('questionBank.typeLabel')}</span>
          {/* Only the types the bank accepts (`QuestionRepositoryTypes.Supported`), never
              `ranking`; immutable after creation, so an edit shows it and cannot change it. */}
          <select
            className="mt-0"
            value={draft.type}
            disabled={editing !== null}
            onChange={(event) => setDraft({ ...draft, type: event.target.value })}
          >
            {QUESTION_BANK_TYPES.map((type) => (
              <option key={type} value={type}>
                {questionTypeLabel(t, type)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line-light pt-2.5">
        <Button type="button" variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={saving}>
          <Check aria-hidden="true" />
          {editing ? t('common.save') : t('questionBank.createQuestion')}
        </Button>
      </div>
    </form>
  )
}
