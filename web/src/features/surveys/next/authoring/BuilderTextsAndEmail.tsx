import { useEffect, useState } from 'react'
import { useTranslation, type Locale } from '../../../../i18n'
import { Button, SkeletonText } from '../../../../components/ui'
import { getCompanyRespondentContent, type RespondentContentView } from '../../api/respondentContentSources'
import { TextsAndEmailSources } from './TextsAndEmailSources'

/** What the survey page opens once the survey exists (`?open=`), read by `SurveyTextsAndEmailCard`. */
export type OpenAfterCreate = 'texts' | 'email'

type Load = { status: 'loading' } | { status: 'ready'; view: RespondentContentView } | { status: 'unknown' }

/**
 * «Textos y correo» in the builder's Revisión (audit 2026-11-19, gap #2).
 *
 * ## Why it creates the survey first
 *
 * The two editors -- «Textos para quien responde» (`RespondentTextsDialog`) and «Correo de
 * invitación» (`InvitationEmailDialog`) -- read and write a SURVEY: `PUT /surveys/{id}` and
 * `GET/PUT /surveys/{id}/respondent-content`. While the builder runs there is no survey: what it
 * autosaves is a `survey_drafts` row (`useSurveyDraft`), a different entity with no texts and no
 * id those routes accept, and the survey is made only by «Crear borrador» (`POST /surveys` or
 * `/survey-templates/{id}/use`). So the honest place to edit is right after that: each button
 * here creates the draft survey exactly as «Crear borrador» does and lands on its page with the
 * same dialog already open. Nothing is sent to anybody by either; the survey is a draft.
 *
 * ## What it can say before then
 *
 * Which texts the new survey will start with. A survey made here carries no texts of its own
 * (templates carry none), so each one is the company's or the product default, read from the
 * company's own route -- which a company admin may read for their company and a super admin for
 * any. For anybody else, or if it cannot be read, it says nothing it does not know.
 */
export function BuilderTextsAndEmail({
  companyId,
  locales,
  disabled,
  onCreateAndOpen,
}: {
  companyId: string
  /** The languages the survey is being written in. */
  locales: readonly Locale[]
  disabled: boolean
  onCreateAndOpen: (open: OpenAfterCreate) => void
}) {
  const { t } = useTranslation()
  const copy = (key: string) => t(`surveys.next.builder.texts.${key}`)
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [load, setLoad] = useState<Load>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setLoad({ status: 'loading' })
    getCompanyRespondentContent(baseUrl, companyId)
      .then((view) => { if (!cancelled) setLoad({ status: 'ready', view }) })
      .catch(() => { if (!cancelled) setLoad({ status: 'unknown' }) })
    return () => { cancelled = true }
  }, [baseUrl, companyId])

  return (
    <section aria-labelledby="builder-texts-title" className="flex flex-col gap-3 border-t border-line-light pt-4" data-testid="builder-texts">
      <h3 id="builder-texts-title" className="m-0 text-lg font-semibold text-fg-primary">{copy('title')}</h3>
      <p className="m-0 text-sm text-fg-secondary">{copy('builderHelp')}</p>
      {load.status === 'loading' ? (
        <SkeletonText lines={3} />
      ) : load.status === 'ready' ? (
        <TextsAndEmailSources view={load.view} locales={locales} />
      ) : (
        <p className="m-0 text-sm text-fg-secondary" data-testid="builder-texts-unknown">{copy('sourcesUnknown')}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={disabled} onClick={() => onCreateAndOpen('texts')}>
          {copy('createAndEditTexts')}
        </Button>
        <Button type="button" variant="outline" disabled={disabled} onClick={() => onCreateAndOpen('email')}>
          {copy('createAndEditEmail')}
        </Button>
      </div>
    </section>
  )
}
