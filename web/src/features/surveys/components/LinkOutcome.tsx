import { Info, ShieldCheck } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { Alert, AlertDescription, AlertTitle } from '../../../components/ui'
import type { LinkFailureCopy } from '../linkFailure'

export interface LinkOutcomeProps {
  copy: LinkFailureCopy
  /**
   * `SurveyLinkError.message`, used only when `copy.bodyKey` is null — i.e. when this
   * client has no sentence of its own for the status it got back. Empty when the
   * response carried no message, in which case the generic error copy stands in.
   */
  serverMessage: string
}

/**
 * The end of a survey link that did not open a survey.
 *
 * One component for both token routes, because the four dead-link outcomes are the same
 * four whichever link was followed and the visitor is the same person: somebody who
 * clicked something they were sent and now needs one sentence they can act on.
 *
 * ## Why it does not offer a "try again" or a link anywhere
 *
 * Nothing here is retryable. A revoked token stays revoked, an expired one stays
 * expired, and a wrong one is wrong on the next click too — so a retry button would be
 * a control whose only function is to produce the same message a second time. Nor is
 * there a link into the app: the visitor is not, and may never have been, a user of it,
 * and `RequireAuth` would meet them with a sign-in form nobody asked for.
 *
 * The one action that ever helps is naming who to ask, which the copy does.
 *
 * ## The tone comes from the mapping, not from the fact that a promise rejected
 *
 * `already_completed` arrives as a 409 and is not a problem: the respondent's answers
 * are in and there is nothing left for them to do. It renders in the success treatment
 * with the shield, exactly as `SurveyRespondForm`'s own already-completed state does, so
 * one situation does not have two faces depending on which route reached it.
 */
export function LinkOutcome({ copy, serverMessage }: LinkOutcomeProps) {
  const { t } = useTranslation('surveyRespond')
  const { t: tRoot } = useTranslation()

  const success = copy.tone === 'success'
  const description = copy.bodyKey === null ? serverMessage || tRoot('errors.generic') : t(copy.bodyKey)

  return (
    <Alert
      variant={success ? 'success' : 'warning'}
      // `alert` interrupts, `status` waits its turn. A dead link is the reason the page
      // exists and the respondent needs it now; a completed survey is a confirmation,
      // and the same rule the respond form already applies to those two cases.
      role={success ? 'status' : 'alert'}
    >
      {success ? <ShieldCheck aria-hidden="true" /> : <Info aria-hidden="true" />}
      <AlertTitle>{t(copy.titleKey)}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  )
}
