import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import {
  Alert,
  AlertDescription,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  SkeletonText,
} from '../../../../components/ui'
import {
  getSurveyRespondentContent,
  saveSurveyRespondentContent,
  type RespondentContentChanges,
  type RespondentContentView,
} from '../../api/respondentContent'
import { SURVEY_MAILS, getSurveyEmailPreview, type SurveyMail } from '../../api/respondentEmail'
import { EmailTextsEditor } from './EmailTextsEditor'

const baseUrl = import.meta.env.VITE_API_BASE_URL

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; view: RespondentContentView }

/**
 * «Correo de invitación»: the words of the three mails a survey sends -- the personal-link
 * invitation, the username-and-password mail and the no-password reminder -- each a subject and
 * a message per language the survey is written in (ruled 2026-11-19,
 * `docs/decisions/editable-respondent-content.md`; the personal link since 2026-11-18).
 *
 * Read and written through `GET/PUT /surveys/{id}/respondent-content`, so an empty field shows
 * what it inherits (the company's words, else the product's), a TIMS super admin may still
 * correct a published survey, and the personal-link pair lands in the same survey columns the
 * old editor wrote. Opens on the personal-link mail, as it always has; `initialMail` opens
 * another.
 *
 * Self-contained, like `RespondentTextsDialog`: it loads and saves on its own.
 */
export function InvitationEmailDialog({
  surveyId,
  open,
  onOpenChange,
  onSaved,
  initialMail,
}: {
  surveyId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (message: string) => void
  initialMail?: SurveyMail
}) {
  const { t } = useTranslation()
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setState({ status: 'loading' })
    getSurveyRespondentContent(baseUrl, surveyId)
      .then((view) => {
        if (cancelled) return
        setState(view.level === 'survey' && Array.isArray(view.requiredLocales) ? { status: 'ready', view } : { status: 'error' })
      })
      .catch(() => { if (!cancelled) setState({ status: 'error' }) })
    return () => { cancelled = true }
  }, [open, surveyId])

  const save = useCallback(
    (changes: RespondentContentChanges) => saveSurveyRespondentContent(baseUrl, surveyId, changes),
    [surveyId],
  )
  const preview = useCallback((mail: SurveyMail) => getSurveyEmailPreview(baseUrl, surveyId, mail), [surveyId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('surveys.next.distribution.link.emailTitle')}</DialogTitle>
        </DialogHeader>
        <p className="m-0 text-base text-fg-secondary">{t('surveys.emailTexts.surveyHelp')}</p>
        {state.status === 'error' ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{t('surveys.next.distribution.link.emailLoadFailed')}</AlertDescription>
          </Alert>
        ) : state.status === 'loading' ? (
          <SkeletonText lines={4} />
        ) : (
          <EmailTextsEditor
            view={state.view}
            mails={SURVEY_MAILS}
            initialMail={initialMail}
            onSave={save}
            loadPreview={preview}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
