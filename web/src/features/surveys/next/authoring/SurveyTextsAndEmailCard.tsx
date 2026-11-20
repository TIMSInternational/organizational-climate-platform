import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation, isLocale, type Locale } from '../../../../i18n'
import { Alert, AlertDescription, Button, SkeletonText } from '../../../../components/ui'
import { getSurveyRespondentContent, type RespondentContentView } from '../../api/respondentContentSources'
import { RespondentTextsDialog } from './RespondentTextsDialog'
import { InvitationEmailDialog } from './InvitationEmailDialog'
import { TextsAndEmailSources } from './TextsAndEmailSources'
import { Card, CardHeading } from './parts'

type Load = { status: 'loading' } | { status: 'ready'; view: RespondentContentView } | { status: 'error' }

/**
 * «Textos y correo» on the survey's own page -- where «Crear borrador» lands, so a survey
 * created from the builder can have its texts set before anybody is sent anything (audit
 * 2026-11-19, gap #2). Opens the SAME two dialogs Distribución opens, as they are; says, per
 * text and language, whether it is «De esta encuesta», «De la empresa» or «Predeterminado»
 * (`GET /surveys/{id}/respondent-content`), and reads it again after a save.
 *
 * `?open=texts` or `?open=email` -- the builder's «Crear y editar …» -- opens that dialog once,
 * then leaves the address, so a reload does not reopen it.
 */
export function SurveyTextsAndEmailCard({ surveyId }: { surveyId: string }) {
  const { t } = useTranslation()
  const copy = (key: string) => t(`surveys.next.builder.texts.${key}`)
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('open')
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [textsOpen, setTextsOpen] = useState(requested === 'texts')
  const [emailOpen, setEmailOpen] = useState(requested === 'email')
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    if (requested !== 'texts' && requested !== 'email') return
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete('open')
        return next
      },
      { replace: true },
    )
  }, [requested, setSearchParams])

  const read = useCallback(() => {
    let cancelled = false
    getSurveyRespondentContent(baseUrl, surveyId)
      .then((view) => { if (!cancelled) setLoad({ status: 'ready', view }) })
      .catch(() => { if (!cancelled) setLoad({ status: 'error' }) })
    return () => { cancelled = true }
  }, [baseUrl, surveyId])

  useEffect(() => read(), [read])

  const onSaved = (message: string) => {
    setSaved(message)
    read()
  }

  const locales: Locale[] = load.status === 'ready' ? load.view.requiredLocales.filter(isLocale) : []

  return (
    <Card className="flex flex-col gap-2.5 px-5 pb-4.5 pt-4" data-testid="detail-texts">
      <CardHeading title={copy('title')} />
      <p className="m-0 text-sm text-fg-secondary">{copy('surveyHelp')}</p>
      {load.status === 'loading' ? (
        <SkeletonText lines={3} />
      ) : load.status === 'error' ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{copy('loadFailed')}</AlertDescription>
        </Alert>
      ) : (
        <TextsAndEmailSources view={load.view} locales={locales} />
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => { setSaved(null); setTextsOpen(true) }}>
          {copy('editTexts')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => { setSaved(null); setEmailOpen(true) }}>
          {copy('editEmail')}
        </Button>
      </div>
      {saved ? <p role="status" className="m-0 text-sm text-fg-secondary">{saved}</p> : null}
      <RespondentTextsDialog surveyId={surveyId} open={textsOpen} onOpenChange={setTextsOpen} onSaved={onSaved} />
      <InvitationEmailDialog surveyId={surveyId} open={emailOpen} onOpenChange={setEmailOpen} onSaved={onSaved} />
    </Card>
  )
}
