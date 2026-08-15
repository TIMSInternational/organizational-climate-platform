import { Link } from 'react-router'
import type { SurveyTemplateListItem } from '../api/surveyTemplates'
import { useTranslation } from '../../../i18n'
import { Badge, Button } from '../../../components/ui'

interface SurveyTemplateCardProps {
  template: SurveyTemplateListItem
}

/**
 * One template in the catalogue grid.
 *
 * ## The chip is the scope, not a mood
 *
 * The prototype's card carries a tag ("Most used", "Draft"). The only thing in this
 * payload that deserves that position is `isGlobal`, and it is not decoration: a
 * global template is visible to every tenant and writable only by a super admin, and
 * the server ships the flag precisely so a client does not infer that
 * security-relevant property from `companyId === null`. `secondary` and `outline` are
 * the two `Badge` variants measured to clear WCAG AA in both themes (8.15:1 light /
 * 6.85:1 dark), and the word carries the meaning either way, so no hue is
 * load-bearing here.
 *
 * ## Where "Use" goes, and why it is not an instantiation from this card
 *
 * `POST /survey-templates/{id}/use` is one call away, and calling it from here would
 * be wrong twice over. It is **required** to carry a `companyId` for a super admin,
 * who has had no implicit tenant since #191 — which is why the detail page reads
 * `useCompanyScope()` before offering the action rather than after it fails. And
 * `UseSurveyTemplateRequest` also takes the title, description, dates and audience
 * that #267 taught the wizard to collect; instantiating from a card would silently
 * accept the defaults for every one of them.
 *
 * So "Use" opens `/surveys/new?template={id}` — the wizard, with this template
 * already chosen. That is the path #267 built: the wizard reports the template's
 * language, previews its questions read-only, and submits through `/use` itself.
 * "Preview" goes to the detail page, which is where the questions and the
 * one-click instantiation already live.
 */
export default function SurveyTemplateCard({ template }: SurveyTemplateCardProps) {
  const { t, locale } = useTranslation()

  return (
    <div className="flex flex-col rounded-xl border border-line-light bg-surface-icon-box p-card">
      <div className="flex items-start justify-between gap-inline">
        <b className="min-w-0 break-words font-semibold text-fg-primary">{template.name}</b>
        <Badge variant={template.isGlobal ? 'secondary' : 'outline'}>
          {template.isGlobal ? t('surveys.globalTemplate') : t('surveys.companyTemplate')}
        </Badge>
      </div>

      {/* Category and question count, in the sans face — the prototype sets this
          line in prose and reserves the mono face for the reading in the footer. */}
      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-fg-secondary">
        <span>{template.category}</span>
        <span aria-hidden="true">·</span>
        <span>{t('surveys.reviewQuestionCount', { count: template.questionCount })}</span>
      </div>

      {template.description !== '' && (
        // Clamped rather than truncated with an ellipsis in JS: the full text stays
        // in the DOM, so it is still read out and still found by in-page search.
        <p className="mt-1 mb-0 line-clamp-2 text-xs text-fg-secondary">{template.description}</p>
      )}

      {/* `mt-auto` so the action row sits on the floor of every card whatever the
          description above it did — a grid of cards with buttons at different
          heights is the thing this layout most easily gets wrong. */}
      <div className="mt-auto flex flex-wrap items-end justify-between gap-inline pt-3">
        <span className="grid">
          <span className="text-2xs font-semibold uppercase tracking-label text-fg-secondary">
            {t('surveys.timesUsed')}
          </span>
          <span className="font-mono text-base tabular-nums text-fg-primary">
            {template.usageCount.toLocaleString(locale)}
          </span>
        </span>
        <span className="flex gap-inline">
          {/* Named for the template each one acts on: a catalogue of twelve cards
              otherwise offers twenty-four links all reading "Preview" or "Use". */}
          <Button asChild size="sm" variant="outline">
            <Link
              to={`/surveys/templates/${template.id}`}
              aria-label={t('surveys.previewNamed', { name: template.name })}
            >
              {t('common.preview')}
            </Link>
          </Button>
          <Button asChild size="sm" variant="primary">
            <Link
              to={`/surveys/new?template=${encodeURIComponent(template.id)}`}
              aria-label={t('surveys.useNamed', { name: template.name })}
            >
              {t('surveys.use')}
            </Link>
          </Button>
        </span>
      </div>
    </div>
  )
}
