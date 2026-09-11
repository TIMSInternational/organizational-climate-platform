import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Download, FileText, Filter, Plus, Rows2 } from 'lucide-react'
import { RailQuestionLibraryIcon } from '../../../../navigation/railIcons'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { PageTopBar } from '../../../../components/layout'
import { Button, EmptyState, Input, NetworkError, SkeletonText, chipVariants } from '../../../../components/ui'
import { useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { useCompanyScope } from '../../../../company-context'
import { cn } from '../../../../lib/cn'
import { CanvasChip } from '../../../org-structure/next/super/parts'
import type { SurveyTemplateListItem } from '../../api/surveyTemplates'
import { KNOWN_CATEGORIES, byUsage, categoriesOf, countByCategory, type TemplateShape } from './derive'
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
 */
export default function SurveyTemplatesNextPage() {
  const { t, locale } = useTranslation()
  const capabilities = useViewerCapabilities()
  const scope = useCompanyScope()
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [creating, setCreating] = useState(false)
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
      <PageTopBar
        eyebrow={t(`${K}.eyebrow`)}
        title={t('navigation.surveyTemplates')}
        description={t(`${K}.description`)}
        actions={
          createFor ? (
            <Button variant="outline" size="canvas" onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              {t(`${K}.newTemplate`)}
            </Button>
          ) : undefined
        }
      />
      {createFor && <NewTemplateDialog open={creating} onOpenChange={setCreating} companyId={createFor} />}

      <form
        role="search"
        className="-mt-1 mb-5 flex flex-wrap items-center justify-between gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          setQ(draft.trim())
        }}
      >
        {/* The chips count templates, so they exist only once the list has answered: while it
            loads or after it failed there is no count to print, and "Todas 0" would say the
            company has no template. */}
        {state.status === 'ready' && (
          <div role="group" aria-label={t(`${K}.categoriesLabel`)} className="flex flex-wrap items-center gap-1.5">
            {['', ...categoriesOf(state.templates)].map((value) => {
              const selected = category === value
              return (
                <button
                  key={value || 'all'}
                  type="button"
                  aria-pressed={selected}
                  data-slot="category-chip"
                  onClick={() => setCategory(value)}
                  className={cn(
                    chipVariants({ tone: selected ? 'critical' : 'neutral' }),
                    'h-6.5 cursor-pointer px-2.5 text-sm',
                    selected ? 'border-chip-critical-ink/20' : 'bg-surface-card hover:border-line-hover',
                  )}
                >
                  {t(`${K}.chipCount`, {
                    label: value ? categoryLabel(t, value) : t(`${K}.all`),
                    count: value ? (counts.get(value) ?? 0) : state.templates.length,
                  })}
                </button>
              )
            })}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Input
            type="search"
            aria-label={t(`${K}.searchPlaceholder`)}
            placeholder={t(`${K}.searchPlaceholder`)}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="h-control-lg w-70 max-w-full"
          />
          <Button type="submit" variant="outline" size="canvas">
            <Filter aria-hidden="true" />
            {t('common.filter')}
          </Button>
        </div>
      </form>

      {state.status === 'error' ? (
        <NetworkError title={t(`${K}.loadFailed`)} description={state.error ?? undefined} onRetry={state.reload} retryText={t('common.retry')} />
      ) : state.status === 'loading' ? (
        <SkeletonText lines={6} />
      ) : (
        <section aria-labelledby="templates-count" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 id="templates-count" className="m-0 text-2xl">
              {t(visible.length === 1 ? `${K}.countOne` : `${K}.count`, { count: visible.length })}
            </h2>
            <span className="text-xs text-fg-label">{t(`${K}.sortedByUse`)}</span>
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
              />
            ))
          )}
          {capabilities.canAuthorSurveys && (
            <div data-slot="library-row" className="flex flex-wrap items-start gap-3.5 rounded-lg border border-dashed border-line-default bg-surface-card px-5 py-4.5">
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-icon-box text-fg-secondary">
                <RailQuestionLibraryIcon aria-hidden="true" className="size-4" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="text-lg font-semibold">{t(`${K}.libraryHeading`)}</span>
                <span className="max-w-measure text-xs text-fg-secondary">{t(`${K}.libraryBody`)}</span>
              </div>
              <Button asChild variant="outline" size="canvas">
                <Link to="/admin/question-library">
                  <Download aria-hidden="true" />
                  {t(`${K}.libraryAction`)}
                </Link>
              </Button>
            </div>
          )}
        </section>
      )}

      <p className="m-0 mt-5 flex items-start gap-2.5 rounded-lg border border-line-light bg-surface-icon-box px-3.5 py-3 text-xs leading-normal text-fg-secondary">
        <Rows2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {t(`${K}.footnote`)}
      </p>
    </div>
  )
}

function TemplateCard({ template, shape, canUse }: { template: SurveyTemplateListItem; shape: TemplateShape | null; canUse: boolean }) {
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
      className="grid items-center gap-5 rounded-xl border border-line-default bg-surface-card px-5 py-4 shadow-sm lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_90px_auto]"
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={`template-${template.id}`} className="m-0 text-lg font-semibold">
            {template.name}
          </h3>
          <CanvasChip label={template.isGlobal ? t(`${K}.global`) : t(`${K}.company`)} />
        </div>
        <span className="text-xs text-fg-label">{facts.join(' · ')}</span>
        <span className="text-xs text-fg-secondary">{template.description}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span aria-hidden="true" className="flex gap-0.75">
          {(declared ? shape.dimensions : Array.from({ length: Math.max(template.questionCount, 1) }, (_, index) => String(index))).map((key) => (
            <span key={key} className={cn('h-1.5 flex-1 rounded-sm', declared ? 'bg-accent-blue' : 'bg-line-default')} />
          ))}
        </span>
        <span className="text-2xs leading-snug text-fg-label">
          {declared ? shape.dimensions.map((key) => dimensionName(t, key)).join(' · ') : shape ? t(`${K}.noDimensions`) : t(`${K}.dimensionsUnavailable`)}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-2xs font-bold uppercase tracking-label text-fg-label">{t(`${K}.timesUsed`)}</span>
        <span className="font-mono text-xl leading-tight tabular-nums">{template.usageCount}</span>
      </div>
      <div className="flex gap-2">
        <Button asChild variant="outline" size="canvas">
          <Link to={`/surveys/templates/${template.id}`}>
            <FileText aria-hidden="true" />
            {t(`${K}.preview`)}
          </Link>
        </Button>
        {canUse && (
          <Button asChild variant="outline" size="canvas">
            <Link to={`/surveys/new?template=${encodeURIComponent(template.id)}`}>
              <ArrowRight aria-hidden="true" />
              {t(`${K}.use`)}
            </Link>
          </Button>
        )}
      </div>
    </article>
  )
}
