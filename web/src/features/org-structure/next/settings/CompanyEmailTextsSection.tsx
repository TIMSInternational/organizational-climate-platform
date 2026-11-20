import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { Alert, AlertDescription, SkeletonText } from '../../../../components/ui'
import {
  getCompanyRespondentContent,
  saveCompanyRespondentContent,
  type RespondentContentChanges,
  type RespondentContentView,
} from '../../../surveys/api/respondentContent'
import { SURVEY_MAILS, getCompanyEmailPreview, type SurveyMail } from '../../../surveys/api/respondentEmail'
import { EmailTextsEditor } from '../../../surveys/next/authoring/EmailTextsEditor'
import { Panel } from '../super/parts'

const baseUrl = import.meta.env.VITE_API_BASE_URL as string

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; view: RespondentContentView }

/**
 * «Correos»: a company's own words for the three survey emails, which every survey of the
 * company inherits until it writes its own (ruled 2026-11-19,
 * `docs/decisions/editable-respondent-content.md`: survey → company → product). A super admin
 * for any company, a company administrator for their own -- the server decides, and a refusal
 * is said in words.
 *
 * Its own load and save, through `GET/PUT /admin/companies/{id}/respondent-content`, so it sits
 * beside the settings form without joining that form's single save button.
 */
export default function CompanyEmailTextsSection({ companyId }: { companyId: string }) {
  const { t } = useTranslation()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    getCompanyRespondentContent(baseUrl, companyId)
      // Only a company-level view with its locales is something to edit; anything else is a
      // failed load, said quietly -- this section is beside the settings form, not part of it.
      .then((view) => {
        if (cancelled) return
        setState(view.level === 'company' && Array.isArray(view.requiredLocales) ? { status: 'ready', view } : { status: 'error' })
      })
      .catch(() => { if (!cancelled) setState({ status: 'error' }) })
    return () => { cancelled = true }
  }, [companyId])

  const save = useCallback(
    (changes: RespondentContentChanges) => saveCompanyRespondentContent(baseUrl, companyId, changes),
    [companyId],
  )
  const preview = useCallback((mail: SurveyMail) => getCompanyEmailPreview(baseUrl, companyId, mail), [companyId])

  return (
    <div className="mt-4">
      <Panel
        labelledBy="company-email-texts"
        heading={
          <h2 id="company-email-texts" className="m-0 text-2xl">
            {t('surveys.emailTexts.companyTitle')}
          </h2>
        }
        meta={t('surveys.emailTexts.companyMeta')}
        className="gap-4 pb-5"
      >
        <p className="m-0 text-base text-fg-secondary">{t('surveys.emailTexts.companyHelp')}</p>
        {state.status === 'error' ? (
          <Alert variant="destructive" role="status">
            <AlertDescription>{t('surveys.emailTexts.loadFailed')}</AlertDescription>
          </Alert>
        ) : state.status === 'loading' ? (
          <SkeletonText lines={4} />
        ) : (
          <EmailTextsEditor view={state.view} mails={SURVEY_MAILS} onSave={save} loadPreview={preview} onSaved={setNotice} />
        )}
        {notice ? (
          <p role="status" className="m-0 text-sm text-fg-secondary">
            {notice}
          </p>
        ) : null}
      </Panel>
    </div>
  )
}
