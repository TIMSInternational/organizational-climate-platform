import { useTranslation } from '../../../i18n'
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../../../components/ui'
import type { SurveyRespondView } from '../api/surveyResponses'
import { pickPrivacyNotice } from './privacyNotice'

/**
 * The company's «Aviso de privacidad», one link before the first question that opens it.
 *
 * Information, not a consent gate: it never blocks answering, and nothing about the form waits
 * on it being opened. When the company has set none, this renders NOTHING — no link, no wrapper,
 * no text of ours — so a survey without a notice reads exactly as it did before the notice existed.
 *
 * The text is the client's legal team's, and it is drawn as text: a React child, never markup,
 * with `white-space: pre-wrap` so their paragraphs and line breaks survive.
 */
export function PrivacyNoticeLink({
  view,
}: {
  view: Pick<SurveyRespondView, 'privacyNoticeEs' | 'privacyNoticeEn'>
}) {
  const { t, locale } = useTranslation('surveyRespond')
  const notice = pickPrivacyNotice(view, locale)
  if (notice === null) return null

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="link" data-slot="privacy-notice-link" className="w-fit self-start text-sm">
          {t('privacyNotice.link')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('privacyNotice.close')} className="max-h-[85dvh] grid-rows-[auto_minmax(0,1fr)]">
        <DialogHeader className="pr-10">
          <DialogTitle>{t('privacyNotice.link')}</DialogTitle>
        </DialogHeader>
        <DialogDescription
          data-slot="privacy-notice-text"
          className="m-0 overflow-y-auto text-base leading-normal whitespace-pre-wrap text-fg-primary"
        >
          {notice}
        </DialogDescription>
      </DialogContent>
    </Dialog>
  )
}
