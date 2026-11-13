import { useState, type FormEvent } from 'react'
import { useTranslation } from '../../../i18n'
import { Alert, AlertDescription, Button, TextField, TextareaField } from '../../../components/ui'
import type { PlanEdit } from '../next/useActionPlanDetailModel'
import { isProvenanceTag, parseTags } from './planTags'
import { describeApiError } from '../../../api/describeApiError'

export interface PlanEditFormProps {
  initial: { title: string; description: string; dueDay: string; tags: readonly string[] }
  onSubmit: (values: PlanEdit) => Promise<void>
  onCancel: () => void
}

/**
 * Correct a plan after it was created: what it says, when it is due, and its tags (G24).
 *
 * `PUT /action-plans/{id}` has always accepted every one of these; no screen offered them, so a
 * typo in a title or a due date agreed in a meeting could only be fixed by deleting nothing and
 * living with it. Same authorization as the status and priority menus beside it —
 * `Roles.Admin` of the plan's company — and audited by the server like every write.
 */
export default function PlanEditForm({ initial, onSubmit, onCancel }: PlanEditFormProps) {
  const { t } = useTranslation()
  const provenance = initial.tags.filter(isProvenanceTag)
  const [title, setTitle] = useState(initial.title)
  const [description, setDescription] = useState(initial.description)
  const [dueDate, setDueDate] = useState(initial.dueDay)
  const [tags, setTags] = useState(initial.tags.filter((tag) => !isProvenanceTag(tag)).join(', '))
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const errors: Record<string, string> = {}
    if (!title.trim()) errors.title = t('validation.required')
    if (!description.trim()) errors.description = t('validation.required')
    if (!dueDate) errors.dueDate = t('validation.required')
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSubmitting(true)
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        dueDate,
        tags: [...parseTags(tags), ...provenance],
      })
    } catch (err) {
      setError(describeApiError(err, t))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="flex flex-col gap-panel-gap" onSubmit={handleSubmit} noValidate>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <TextField label={t('actionPlans.planTitle')} required value={title} onChange={setTitle} error={fieldErrors.title} />
      <TextareaField
        label={t('actionPlans.description')}
        required
        rows={3}
        value={description}
        onChange={setDescription}
        error={fieldErrors.description}
      />
      {/* Native `type="date"`, as on the create form (`ActionPlanForm`). */}
      <label>
        {t('actionPlans.dueDate')}
        <input
          type="date"
          value={dueDate}
          required
          aria-invalid={fieldErrors.dueDate ? true : undefined}
          onChange={(event) => setDueDate(event.target.value)}
        />
      </label>
      <TextField
        label={t('actionPlans.tags')}
        value={tags}
        onChange={setTags}
        description={t('actionPlans.next.edit.tagsHint')}
      />
      <div className="flex flex-wrap gap-inline">
        <Button type="submit" disabled={submitting}>
          {submitting ? t('common.saving') : t('actionPlans.next.edit.save')}
        </Button>
        <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}
