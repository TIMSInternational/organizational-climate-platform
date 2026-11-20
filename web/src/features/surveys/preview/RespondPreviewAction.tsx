import { Eye } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '../../../components/ui'
import { useTranslation } from '../../../i18n'

/**
 * «Ver como quien responde» on the survey page: opens `/surveys/:id/preview`.
 *
 * Offered to whoever may administer the survey (`canAdminister` — the page's own
 * `canAdministerSurvey`, the server's `CanAdminister`) in any status but archived, draft
 * included: the check is made before the link goes out. The server refuses the rest anyway.
 */
export function RespondPreviewAction({
  survey,
  canAdminister,
}: {
  survey: { id: string; status: string }
  canAdminister: boolean
}) {
  const { t } = useTranslation()
  if (!canAdminister || survey.status === 'archived') return null

  return (
    <Button asChild variant="outline">
      <Link to={`/surveys/${survey.id}/preview`}>
        <Eye aria-hidden="true" className="size-icon" />
        {t('surveys.next.respondPreview.open')}
      </Link>
    </Button>
  )
}
