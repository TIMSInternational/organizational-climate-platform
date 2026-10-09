import { useState } from 'react'
import { useTranslation } from '../../../i18n'
import { Button, SelectField, TextField } from '../../../components/ui'
import { createActionPlan } from '../../action-plans/api/actionPlans'
import { getSurvey } from '../api/surveys'

/** `ActionPlanValidation.ValidPriorities`, in the order the create form offers them. */
const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const

/** How far ahead a follow-up is due by default. A month is long enough to do something. */
const DEFAULT_DUE_DAYS = 30

export interface FollowUpPlanRequest {
  /** The prefilled title. The reader may change it; nothing else on the form is theirs to set. */
  title: string
  /** Already composed, in the reader's language, by whichever surface raised the follow-up. */
  description: string
  /** The department this plan belongs to, when the cohort names one. */
  departmentId?: string
  /** Provenance, machine-readable: `seguimiento` plus one `field:value` per selector. */
  tags: string[]
}

/**
 * Raise an action plan for one group, without leaving the screen that found it.
 *
 * ## Why this is a component and not two
 *
 * Both surfaces that find a group worth acting on — the results cross and the opened cell —
 * have to file the same plan against the same tenant with the same provenance. The cell panel
 * used to link to `/action-plans` instead, which is the LIST: the reader arrived having lost
 * the department and the dimension they had clicked, and had to retype both. Two copies of
 * this form would be two chances for one of them to drop `sourceSurveyId`, or to file against
 * the wrong company.
 *
 * ## The tenant comes from the SURVEY
 *
 * Not from the header's company scope, which for a super_admin may be another company
 * entirely — a plan filed against the wrong tenant is invisible to the people who have to do
 * it. `sourceSurveyId` is sent with it: the endpoint validates that the two name the same
 * company before it will accept the pair, which is exactly the agreement that holds here
 * because both come from this one `getSurvey`.
 */
export default function FollowUpPlanForm({
  baseUrl,
  surveyId,
  request,
  onCreated,
  onCancel,
}: {
  baseUrl: string
  surveyId: string
  request: FollowUpPlanRequest
  onCreated: (plan: { id: string; title: string }) => void
  onCancel: () => void
}) {
  const { t, locale } = useTranslation()
  const [form, setForm] = useState(() => ({
    title: request.title,
    due: new Date(Date.now() + DEFAULT_DUE_DAYS * 864e5).toISOString().slice(0, 10),
    priority: 'high',
  }))
  const [creating, setCreating] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  async function create() {
    setCreating(true)
    setFailure(null)
    try {
      const survey = await getSurvey(baseUrl, surveyId, locale)
      const plan = await createActionPlan(baseUrl, {
        title: form.title.trim(),
        description: request.description,
        companyId: survey.companyId,
        sourceSurveyId: surveyId,
        ...(request.departmentId ? { departmentId: request.departmentId } : {}),
        // Midday UTC, so the date the reader picked is the date every time zone reads back.
        dueDate: new Date(`${form.due}T12:00:00Z`).toISOString(),
        priority: form.priority,
        tags: request.tags,
      })
      onCreated({ id: plan.id, title: plan.title })
    } catch (error) {
      setFailure(error instanceof Error ? error.message : t('surveyResults.cross.followUpFailed'))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mt-4 grid gap-4 border-t border-line-default pt-4 sm:grid-cols-3">
      <TextField
        label={t('surveyResults.cross.followUpName')}
        value={form.title}
        onChange={(value) => setForm((f) => ({ ...f, title: value }))}
      />
      <TextField
        label={t('surveyResults.cross.followUpDue')}
        type="date"
        value={form.due}
        onChange={(value) => setForm((f) => ({ ...f, due: value }))}
      />
      <SelectField
        label={t('surveyResults.cross.followUpPriority')}
        value={form.priority}
        onChange={(value) => setForm((f) => ({ ...f, priority: value }))}
        options={PRIORITIES.map((p) => ({
          value: p,
          label: t(`surveyResults.cross.priority${p[0]!.toUpperCase()}${p.slice(1)}`),
        }))}
      />
      <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
        <Button
          type="button"
          onClick={() => void create()}
          disabled={creating || form.title.trim() === '' || form.due === ''}
        >
          {creating ? t('surveyResults.cross.creating') : t('surveyResults.cross.create')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={creating}>
          {t('surveyResults.cross.cancel')}
        </Button>
        {failure ? (
          <span role="alert" className="text-sm text-fg-secondary">
            {failure}
          </span>
        ) : null}
      </div>
    </div>
  )
}
