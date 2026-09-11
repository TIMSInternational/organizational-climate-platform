import { useEffect, useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { Plus } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  SkeletonText,
  Textarea,
} from '../../../../components/ui'
import { CanvasSelect, Field } from '../../../org-structure/next/super/parts'
import { getSurvey, listSurveys, type SurveyListItem } from '../../api/surveys'
import { createSurveyTemplate } from '../../api/surveyTemplates'
import { KNOWN_CATEGORIES } from './derive'
import { localesOf, templateInputFrom } from './fromSurvey'

const K = 'surveys.next.templates'
const DASH = '—'

/**
 * "Nueva plantilla" on the Templates artboard: a template made from the questions of one of the
 * company's surveys (`fromSurvey.ts`), then `POST /survey-templates` and the new template's own
 * page. The screen that authors a template's questions from nothing does not exist (triage:
 * "Authoring: the biggest undesigned surface"); the survey wizard is where questions are written,
 * so this copies the ones a survey already holds.
 *
 * Mounted only for a viewer who may write a template for `companyId` — the page decides that.
 */
export default function NewTemplateDialog({
  open,
  onOpenChange,
  companyId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
}) {
  const { t, locale } = useTranslation()
  const navigate = useNavigate()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const ids = useId()
  const [surveys, setSurveys] = useState<SurveyListItem[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [surveyId, setSurveyId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState(KNOWN_CATEGORIES[0])
  const [status, setStatus] = useState<'idle' | 'saving' | 'failed'>('idle')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadFailed(false)
    // A company admin is pinned to their own tenant by the server whatever is sent; a super
    // admin names the company the template will belong to.
    listSurveys(baseUrl, { companyId }, locale)
      .then((all) => {
        if (!cancelled) setSurveys(all.filter((survey) => survey.questionCount > 0))
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [open, baseUrl, companyId, locale])

  const survey = surveys?.find((candidate) => candidate.id === surveyId) ?? null
  const ready = survey !== null && name.trim() !== '' && description.trim() !== '' && category !== ''

  function pick(id: string) {
    const previous = surveys?.find((candidate) => candidate.id === surveyId)
    const next = surveys?.find((candidate) => candidate.id === id)
    setSurveyId(id)
    // The survey's title is the starting name, until the admin types their own.
    if (next?.title && (name.trim() === '' || name === previous?.title)) setName(next.title)
  }

  async function create() {
    if (!survey || !ready) return
    setStatus('saving')
    try {
      const readings = await Promise.all(
        localesOf(survey.language).map(async (reading) => ({ locale: reading, detail: await getSurvey(baseUrl, survey.id, reading) })),
      )
      const created = await createSurveyTemplate(
        baseUrl,
        templateInputFrom({ readings, survey, companyId, name: name.trim(), description: description.trim(), category }),
        locale,
      )
      onOpenChange(false)
      navigate(`/surveys/templates/${created.id}`)
    } catch {
      setStatus('failed')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} data-slot="new-template-dialog" className="max-w-[560px] gap-4 rounded-xl px-6 py-5">
        <DialogHeader className="gap-1">
          <DialogTitle className="m-0 text-2xl font-normal leading-tight">{t(`${K}.newTitle`)}</DialogTitle>
          <DialogDescription className="m-0 text-sm text-fg-secondary">{t(`${K}.newDescription`)}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <Field fieldLabel={t(`${K}.newFromSurvey`)} htmlFor={`${ids}-survey`} required helper={t(`${K}.newFromSurveyHelp`)}>
            {loadFailed ? (
              <p role="alert" className="m-0 text-xs text-accent-red">
                {t(`${K}.newSurveysFailed`)}
              </p>
            ) : surveys === null ? (
              <SkeletonText lines={1} />
            ) : surveys.length === 0 ? (
              <p className="m-0 text-xs text-fg-tertiary">{t(`${K}.newNoSurveys`)}</p>
            ) : (
              <CanvasSelect id={`${ids}-survey`} className="w-full" value={surveyId} onChange={(event) => pick(event.target.value)}>
                <option value="" disabled>
                  {t(`${K}.newPickSurvey`)}
                </option>
                {surveys.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {`${candidate.title ?? DASH} · ${t(candidate.questionCount === 1 ? `${K}.questionsOne` : `${K}.questions`, { count: candidate.questionCount })}`}
                  </option>
                ))}
              </CanvasSelect>
            )}
          </Field>
          <Field fieldLabel={t(`${K}.newName`)} htmlFor={`${ids}-name`} required>
            <Input id={`${ids}-name`} value={name} onChange={(event) => setName(event.target.value)} className="h-control-lg" />
          </Field>
          <Field fieldLabel={t(`${K}.newDescriptionLabel`)} htmlFor={`${ids}-description`} required>
            <Textarea id={`${ids}-description`} value={description} rows={3} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <Field fieldLabel={t(`${K}.newCategory`)} htmlFor={`${ids}-category`} required>
            <CanvasSelect id={`${ids}-category`} className="w-full" value={category} onChange={(event) => setCategory(event.target.value)}>
              {KNOWN_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {t(`${K}.category.${value}`)}
                </option>
              ))}
            </CanvasSelect>
          </Field>
          {status === 'failed' && (
            <p role="alert" className="m-0 text-sm text-accent-red">
              {t(`${K}.newFailed`)}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" size="canvas">
                {t('common.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" variant="primary" size="canvas" disabled={!ready || status === 'saving'}>
              <Plus aria-hidden="true" />
              {status === 'saving' ? t(`${K}.newCreating`) : t(`${K}.newCreate`)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
