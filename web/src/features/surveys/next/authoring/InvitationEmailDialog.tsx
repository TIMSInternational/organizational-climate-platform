import { useEffect, useState } from 'react'
import { useTranslation, type Locale } from '../../../../i18n'
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  SkeletonText,
  TextField,
  TextareaField,
} from '../../../../components/ui'
import {
  getSurveyInvitationCopy,
  saveSurveyInvitationCopy,
  type InvitationCopyField,
  type SurveyInvitationCopy,
} from '../../api/surveyInvitationCopy'
import { describeApiError } from '../../../../api/describeApiError'

const baseUrl = import.meta.env.VITE_API_BASE_URL

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; context: SurveyInvitationCopy; draft: SurveyInvitationCopy['copy'] }

/**
 * «Correo de invitación»: the subject and message a `personal_link` survey mails, each person's
 * own link under them (ruled 2026-11-18, `docs/decisions/personal-link-invitations.md`).
 *
 * One box per language the survey is written in, read and written through
 * `surveyInvitationCopy.ts` -- which never prefills a box from the OTHER language's text, so an
 * untranslated box is empty rather than looking translated. Empty is legitimate here: the server
 * then writes a short neutral invitation in that language, and the help says so.
 *
 * Self-contained, like `RespondentTextsDialog`: it loads and saves on its own, so the
 * distribution model does not grow a second copy-editing state machine.
 */
export function InvitationEmailDialog({
  surveyId,
  open,
  onOpenChange,
  onSaved,
}: {
  surveyId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (message: string) => void
}) {
  const { t, locale: displayLocale } = useTranslation()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setState({ status: 'loading' })
    setSaveError(null)
    getSurveyInvitationCopy(baseUrl, surveyId, displayLocale)
      .then((context) => { if (!cancelled) setState({ status: 'ready', context, draft: context.copy }) })
      .catch(() => { if (!cancelled) setState({ status: 'error' }) })
    return () => { cancelled = true }
  }, [open, surveyId, displayLocale])

  const edit = (locale: Locale, field: InvitationCopyField, text: string) =>
    setState((current) =>
      current.status !== 'ready'
        ? current
        : { ...current, draft: { ...current.draft, [locale]: { ...current.draft[locale], [field]: { text, authored: current.draft[locale][field].authored } } } },
    )

  async function save() {
    if (state.status !== 'ready') return
    setSaving(true)
    setSaveError(null)
    try {
      await saveSurveyInvitationCopy(baseUrl, surveyId, state.draft, state.context.requiredLocales)
      onSaved(t('surveys.next.distribution.link.emailSaved'))
      onOpenChange(false)
    } catch (cause) {
      setSaveError(describeApiError(cause, t))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('surveys.next.distribution.link.emailTitle')}</DialogTitle>
        </DialogHeader>
        <p className="m-0 text-base text-fg-secondary">{t('surveys.next.distribution.link.emailHelp')}</p>
        {state.status === 'error' ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{t('surveys.next.distribution.link.emailLoadFailed')}</AlertDescription>
          </Alert>
        ) : state.status === 'loading' ? (
          <SkeletonText lines={4} />
        ) : (
          <div className="flex flex-col gap-panel-gap">
            {!state.context.editable && (
              <Alert variant="default">
                <AlertDescription>{t('surveys.distribution.copyLocked')}</AlertDescription>
              </Alert>
            )}
            <div className={state.context.requiredLocales.length > 1 ? 'grid gap-panel-gap md:grid-cols-2' : 'grid gap-panel-gap'}>
              {state.context.requiredLocales.map((locale) => (
                <section key={locale} className="flex flex-col gap-panel-gap">
                  {state.context.requiredLocales.length > 1 && (
                    <h3 className="text-xl font-semibold text-fg-primary">{t(`surveys.distribution.locale.${locale}`)}</h3>
                  )}
                  <TextField
                    label={t('surveys.distribution.invitationSubject')}
                    description={t('surveys.next.distribution.link.emailSubjectHelp')}
                    value={state.draft[locale].subject.text}
                    disabled={!state.context.editable || saving}
                    onChange={(text) => edit(locale, 'subject', text)}
                  />
                  <TextareaField
                    label={t('surveys.distribution.invitationMessage')}
                    description={t('surveys.next.distribution.link.emailMessageHelp')}
                    value={state.draft[locale].message.text}
                    rows={10}
                    disabled={!state.context.editable || saving}
                    onChange={(text) => edit(locale, 'message', text)}
                  />
                </section>
              ))}
            </div>
            {saveError && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            )}
            <div>
              <Button onClick={() => void save()} disabled={!state.context.editable || saving}>
                {saving ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
