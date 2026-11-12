import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Download, FileText, Filter, Pencil, Plus, Rows2, Search, Trash2 } from 'lucide-react'
import { RailQuestionLibraryIcon } from '../../../../navigation/railIcons'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { PageHeader } from '../../../../components/layout'
import {
  Alert,
  AlertDescription,
  Button,
  ConfirmationDialog,
  EmptyState,
  Input,
  LoadingState,
  NetworkError,
  Note,
  SegmentedControl,
} from '../../../../components/ui'
import { readViewerClaims, useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { useCompanyScope } from '../../../../company-context'
import { cn } from '../../../../lib/cn'
import { CanvasChip } from '../../../org-structure/next/super/parts'
import { deleteSurveyTemplate, type SurveyTemplateListItem } from '../../api/surveyTemplates'
import { KNOWN_CATEGORIES, byUsage, canWriteTemplate, categoriesOf, countByCategory, type TemplateShape } from './derive'
import EditTemplateDialog from './EditTemplateDialog'
import NewTemplateDialog from './NewTemplateDialog'
import { useTemplatesModel } from './useTemplatesModel'

const K = 'surveys.next.templates'

function categoryLabel(t: TranslateFn, category: string): string {
  return KNOWN_CATEGORIES.includes(category) ? t(`${K}.category.${category}`) : category
}

function dimensionName(t: TranslateFn, key: string): string {
  const path = `surveyRespond.dimensions.${key}`
  const name = t(path)
  return name === path ? key : name
}

/**
 * `/surveys/templates` — the Templates artboard, which replaced `SurveyTemplatesPage` on this
 * route (the old page stays in the tree, unrouted, as the wiring reference).
 *
 * Instruments ready to start a survey without rewriting the questions: the categories as facet
 * chips, a search the server answers (`q`), and one card per template — what it is, the
 * dimensions and scale its questions declare, how often it was used, and the way in. "Usar"
 * opens the survey wizard with the template (`/surveys/new?template=`), drawn only for a viewer
 * who may author a survey (`canAuthorSurveys` — `POST /survey-templates/{id}/use` is
 * `CanAdminister`); "Vista previa" opens the template's own page for any admin. "Nueva plantilla"
 * makes one from a company survey's questions (`NewTemplateDialog`).
 *
 * "Editar" and "Eliminar" are drawn on a template the viewer may write (`canWriteTemplate`, the
 * mirror of `CanWriteTemplate`: a super admin any; a company admin their own company's, never a
 * global one). Editing changes the name, description and category (`EditTemplateDialog`);
 * deleting removes the template and its questions after a confirmation. Neither reaches a survey
 * already built from the template — each holds its own copy of the questions, and the API test
 * `A_survey_built_from_a_template_is_unchanged_by_the_templates_edit_and_by_its_delete` pins it.
 */
export default function SurveyTemplatesNextPage() {
  const { t, locale } = useTranslation()
  const capabilities = useViewerCapabilities()
  const scope = useCompanyScope()
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<SurveyTemplateListItem | null>(null)
  const [deleting, setDeleting] = useState<SurveyTemplateListItem | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [deleteFailed, setDeleteFailed] = useState(false)
  const claims = readViewerClaims()
  const state = useTemplatesModel(q)
  const counts = countByCategory(state.templates)
  const visible = byUsage(
    state.templates.filter((template) => !category || template.category === category),
    locale,
  )
  // `POST /survey-templates` naming this company: `CanWriteTemplate` admits a super_admin, and a
  // company_admin only for their own tenant — the admin-with-a-company shape `canAuthorSurveys`
  // mirrors, with the company the request will carry. A super_admin with none selected is offered
  // nothing, because the only company-less template is a GLOBAL one.
  const createFor = capabilities.canAuthorSurveys && scope.status === 'ready' ? (scope.companyId ?? null) : null

  return (
    <div>
      {/* The board's `.hdr`, with the page's one primary — Nueva plantilla — at the trailing
          edge, drawn only for a viewer who may create one. */}
      <PageHeader
        eyebrow={t(`${K}.eyebrow`)}
        title={t('navigation.surveyTemplates')}
        description={t(`${K}.description`)}
        primaryAction={
          createFor ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              {t(`${K}.newTemplate`)}
            </Button>
          ) : undefined
        }
      />
      {createFor && <NewTemplateDialog open={creating} onOpenChange={setCreating} companyId={createFor} />}
      <EditTemplateDialog template={editing} onOpenChange={(open) => !open && setEditing(null)} onSaved={state.reload} />
      <ConfirmationDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !deletePending) setDeleting(null)
        }}
        title={t(`${K}.deleteTitle`, { name: deleting?.name ?? '' })}
        description={t(deleting?.usageCount === 1 ? `${K}.deleteBodyOne` : `${K}.deleteBody`, { count: deleting?.usageCount ?? 0 })}
        confirmText={t(`${K}.deleteConfirm`)}
        cancelText={t('common.cancel')}
        variant="destructive"
        loading={deletePending}
        onConfirm={async () => {
          if (!deleting) return
          setDeletePending(true)
          setDeleteFailed(false)
          try {
            await deleteSurveyTemplate(import.meta.env.VITE_API_BASE_URL as string, deleting.id)
            setDeleting(null)
            state.reload()
          } catch {
            setDeleting(null)
            setDeleteFailed(true)
          } finally {
            setDeletePending(false)
          }
        }}
      />
      {deleteFailed && (
        <Alert variant="destructive" role="alert" className="mb-4">
          <AlertDescription>{t(`${K}.deleteFailed`)}</AlertDescription>
        </Alert>
      )}

      <form
        role="search"
        className="mb-6 flex flex-wrap items-center gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          setQ(draft.trim())
        }}
      >
        {/* The chips count templates, so they exist only once the list has answered: while it
            loads or after it failed there is no count to print, and "Todas 0" would say the
            company has no template. */}
        {state.status === 'ready' && (
          // The board's `.seg`: the categories as one segmented control. The chosen one is
          // raised, never Crítica's red; it filters the templates already read. One line at
          // every width (HIG `segmented-controls.md`): a control that wraps stops reading as one
          // control, so at 390 it scrolls sideways inside its own box, the cut segment at the
          // edge saying there is more. The 4px pad keeps the 3px focus ring inside the scroller.
          <div data-slot="segment-scroller" className="-m-1 min-w-0 max-w-[calc(100%+0.5rem)] overflow-x-auto p-1 [scrollbar-width:none]">
          <SegmentedControl
            label={t(`${K}.categoriesLabel`)}
            value={category}
            onChange={setCategory}
            options={['', ...categoriesOf(state.templates)].map((value) => ({
              value,
              label: t(`${K}.chipCount`, {
                label: value ? categoryLabel(t, value) : t(`${K}.all`),
                count: value ? (counts.get(value) ?? 0) : state.templates.length,
              }),
            }))}
          />
          </div>
        )}
        {/* The list's filter bar, in its order (the review of 12 Nov): the segmented control,
            then on its own line the search (the leading glyph, 300px, the 32px field at 15px)
            and the one control that applies it, at the field's height. */}
        <div data-slot="templates-search-row" className="flex w-full min-w-0 flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-75">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-label"
            />
            <Input
              type="search"
              aria-label={t(`${K}.searchPlaceholder`)}
              placeholder={t(`${K}.searchPlaceholder`)}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="h-control-lg pl-8"
            />
          </div>
          <Button type="submit" variant="outline" className="shrink-0">
            <Filter aria-hidden="true" />
            {t('common.filter')}
          </Button>
        </div>
      </form>

      {state.status === 'error' ? (
        <NetworkError title={t(`${K}.loadFailed`)} description={state.error ?? undefined} onRetry={state.reload} retryText={t('common.retry')} />
      ) : state.status === 'loading' ? (
        <LoadingState rows={4} label={t('common.loading')} />
      ) : (
        <section aria-labelledby="templates-count" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 id="templates-count" className="m-0 text-2xl">
              {t(visible.length === 1 ? `${K}.countOne` : `${K}.count`, { count: visible.length })}
            </h2>
            <span className="text-sm text-fg-secondary">{t(`${K}.sortedByUse`)}</span>
          </div>
          {visible.length === 0 ? (
            <EmptyState title={t('surveys.noTemplatesFound')} description={t('surveys.tryAdjustingFilters')} />
          ) : (
            visible.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                shape={state.shapes.get(template.id) ?? null}
                canUse={capabilities.canAuthorSurveys}
                canWrite={canWriteTemplate(claims, template)}
                onEdit={() => setEditing(template)}
                onDelete={() => {
                  setDeleteFailed(false)
                  setDeleting(template)
                }}
              />
            ))
          )}
          {capabilities.canAuthorSurveys && (
            <div data-slot="library-row" className="flex flex-wrap items-start gap-3.5 rounded-xl border border-dashed border-line-panel bg-surface-card px-5 py-4.5">
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-icon-box text-fg-secondary">
                <RailQuestionLibraryIcon aria-hidden="true" className="size-4" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="font-display text-xl font-semibold leading-tight tracking-title">{t(`${K}.libraryHeading`)}</span>
                <span className="max-w-measure text-sm text-fg-secondary">{t(`${K}.libraryBody`)}</span>
              </div>
              <Button asChild variant="outline">
                <Link to="/admin/question-library">
                  <Download aria-hidden="true" />
                  {t(`${K}.libraryAction`)}
                </Link>
              </Button>
            </div>
          )}
        </section>
      )}

      {/* The board's `.note`: a standing fact about every template, in the neutral tone. */}
      <Note icon={<Rows2 />} className="mt-6 text-sm text-fg-secondary">
        <p className="m-0">{t(`${K}.footnote`)}</p>
      </Note>
    </div>
  )
}

function TemplateCard({
  template,
  shape,
  canUse,
  canWrite,
  onEdit,
  onDelete,
}: {
  template: SurveyTemplateListItem
  shape: TemplateShape | null
  canUse: boolean
  canWrite: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const facts = [
    categoryLabel(t, template.category),
    t(template.questionCount === 1 ? `${K}.questionsOne` : `${K}.questions`, { count: template.questionCount }),
    ...(shape?.likert ? [t(`${K}.likert`, { min: shape.likert.min, max: shape.likert.max })] : []),
  ]
  const declared = shape !== null && shape.dimensions.length > 0
  return (
    <article
      data-slot="template-card"
      aria-labelledby={`template-${template.id}`}
      // The board's `.card`: 12px radius, the panel hairline, no shadow.
      className="grid items-center gap-5 rounded-xl border border-line-panel bg-surface-card px-5 py-4.5 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_90px_auto]"
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* A card title, so the display serif (the type ruling). */}
          <h3 id={`template-${template.id}`} className="m-0 font-display text-xl font-semibold leading-tight tracking-title">
            {template.name}
          </h3>
          <CanvasChip label={template.isGlobal ? t(`${K}.global`) : (template.companyName ?? t(`${K}.company`))} />
        </div>
        <span className="text-sm tabular-nums text-fg-secondary">{facts.join(' · ')}</span>
        <span className="text-sm text-fg-secondary">{template.description}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span aria-hidden="true" className="flex gap-0.75">
          {(declared ? shape.dimensions : Array.from({ length: Math.max(template.questionCount, 1) }, (_, index) => String(index))).map((key) => (
            // Gray, not blue: blue is action, selection and live, and a dimension is none of
            // them. Declared dimensions in the solid label gray, undeclared on the track.
            <span key={key} className={cn('h-1.5 flex-1 rounded-sm', declared ? 'bg-fg-light' : 'bg-surface-fill')} />
          ))}
        </span>
        <span className="text-xs leading-snug text-fg-secondary">
          {declared ? shape.dimensions.map((key) => dimensionName(t, key)).join(' · ') : shape ? t(`${K}.noDimensions`) : t(`${K}.dimensionsUnavailable`)}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {/* The board's `.kpi .l` eyebrow and value: 11px uppercase is the eyebrow's one use. */}
        <span className="text-2xs font-semibold uppercase tracking-tile text-fg-label">{t(`${K}.timesUsed`)}</span>
        <span className="text-2xl font-semibold leading-tight tabular-nums">{template.usageCount}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link to={`/surveys/templates/${template.id}`}>
            <FileText aria-hidden="true" />
            {t(`${K}.preview`)}
          </Link>
        </Button>
        {canUse && (
          <Button asChild variant="outline">
            <Link to={`/surveys/new?template=${encodeURIComponent(template.id)}`}>
              <ArrowRight aria-hidden="true" />
              {t(`${K}.use`)}
            </Link>
          </Button>
        )}
        {canWrite && (
          <>
            <Button type="button" variant="outline" onClick={onEdit} aria-label={t(`${K}.editFor`, { name: template.name })}>
              <Pencil aria-hidden="true" />
              {t(`${K}.edit`)}
            </Button>
            <Button type="button" variant="outline" onClick={onDelete} aria-label={t(`${K}.deleteFor`, { name: template.name })}>
              <Trash2 aria-hidden="true" />
              {t(`${K}.delete`)}
            </Button>
          </>
        )}
      </div>
    </article>
  )
}
