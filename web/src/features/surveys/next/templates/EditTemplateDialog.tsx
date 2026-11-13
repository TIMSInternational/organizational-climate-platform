import { useEffect, useId, useState } from 'react'
import { Save } from 'lucide-react'
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
import { getSurveyTemplate, updateSurveyTemplate, type SurveyTemplateListItem } from '../../api/surveyTemplates'
import { KNOWN_CATEGORIES, editedHalf } from './derive'

const K = 'surveys.next.templates'

type Loaded = { name: string; description: string; category: string; nameHalf: 'en' | 'es'; descriptionHalf: 'en' | 'es' }

/**
 * "Editar" on a template card: `PUT /survey-templates/{id}` with the three fields "Nueva
 * plantilla" asks for — name, description, category — under the same rule (all three required,
 * none blank). The name and description are written back to the language the reader is looking
 * at (`editedHalf`), so editing a bilingual template in Spanish never overwrites its English.
 *
 * The template's questions are not edited here: no screen authors a template's questions, and
 * `NewTemplateDialog` copies them from a survey. Whatever is edited, a survey already built
 * from this template keeps its own copy — the dialog says so.
 */
export default function EditTemplateDialog({
  template,
  onOpenChange,
  onSaved,
}: {
  /** The template being edited; `null` closes the dialog. */
  template: SurveyTemplateListItem | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const ids = useId()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'failed'>('idle')
  const templateId = template?.id ?? null

  useEffect(() => {
    if (!templateId) return
    let cancelled = false
    setLoaded(null)
    setLoadFailed(false)
    setStatus('idle')
    const requested = locale === 'en' ? 'en' : 'es'
    getSurveyTemplate(baseUrl, templateId, requested)
      .then((detail) => {
        if (cancelled) return
        const next: Loaded = {
          name: detail.name,
          description: detail.description,
          category: detail.category,
          nameHalf: editedHalf('name', requested, detail.fallbackFields),
          descriptionHalf: editedHalf('description', requested, detail.fallbackFields),
        }
        setLoaded(next)
        setName(next.name)
        setDescription(next.description)
        setCategory(next.category)
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [templateId, baseUrl, locale])

  const ready = loaded !== null && name.trim() !== '' && description.trim() !== '' && category.trim() !== ''
  const categories = loaded && !KNOWN_CATEGORIES.includes(loaded.category) ? [...KNOWN_CATEGORIES, loaded.category] : KNOWN_CATEGORIES

  async function save() {
    if (!templateId || !loaded || !ready) return
    setStatus('saving')
    try {
      await updateSurveyTemplate(
        baseUrl,
        templateId,
        {
          name: { [loaded.nameHalf]: name.trim() },
          description: { [loaded.descriptionHalf]: description.trim() },
          category: category.trim(),
        },
        locale,
      )
      onOpenChange(false)
      onSaved()
    } catch {
      setStatus('failed')
    }
  }

  return (
    <Dialog open={template !== null} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} data-slot="edit-template-dialog" className="max-w-[560px] gap-4 rounded-xl px-6 py-5">
        <DialogHeader className="gap-1">
          <DialogTitle className="m-0 text-2xl font-normal leading-tight">{t(`${K}.editTitle`)}</DialogTitle>
          <DialogDescription className="m-0 text-sm text-fg-secondary">{t(`${K}.editDescription`)}</DialogDescription>
        </DialogHeader>
        {loadFailed ? (
          <p role="alert" className="m-0 text-sm text-accent-red-ink">
            {t(`${K}.editLoadFailed`)}
          </p>
        ) : loaded === null ? (
          <SkeletonText lines={4} />
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <Field fieldLabel={t(`${K}.newName`)} htmlFor={`${ids}-name`} required>
              <Input id={`${ids}-name`} value={name} onChange={(event) => setName(event.target.value)} className="h-control-lg" />
            </Field>
            <Field fieldLabel={t(`${K}.newDescriptionLabel`)} htmlFor={`${ids}-description`} required>
              <Textarea id={`${ids}-description`} value={description} rows={3} onChange={(event) => setDescription(event.target.value)} />
            </Field>
            <Field fieldLabel={t(`${K}.newCategory`)} htmlFor={`${ids}-category`} required>
              <CanvasSelect id={`${ids}-category`} className="w-full" value={category} onChange={(event) => setCategory(event.target.value)}>
                {categories.map((value) => (
                  <option key={value} value={value}>
                    {KNOWN_CATEGORIES.includes(value) ? t(`${K}.category.${value}`) : value}
                  </option>
                ))}
              </CanvasSelect>
            </Field>
            <p className="m-0 text-xs text-fg-secondary">{t(`${K}.editKeepsSurveys`)}</p>
            {status === 'failed' && (
              <p role="alert" className="m-0 text-sm text-accent-red-ink">
                {t(`${K}.editFailed`)}
              </p>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" size="canvas">
                  {t('common.cancel')}
                </Button>
              </DialogClose>
              <Button type="submit" variant="primary" size="canvas" disabled={!ready || status === 'saving'}>
                <Save aria-hidden="true" />
                {status === 'saving' ? t(`${K}.editSaving`) : t(`${K}.editSave`)}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
