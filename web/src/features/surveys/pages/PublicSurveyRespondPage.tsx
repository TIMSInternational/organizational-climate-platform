import { useParams } from 'react-router'
import { LanguageSwitcher, useTranslation } from '../../../i18n'
import { SkipLink } from '../../../components/ui'
import SurveyRespondForm from '../components/SurveyRespondForm'

/**
 * Answering a survey without an account: the one genuinely public page in this app.
 *
 * ## Why it is not `AdminLayout`
 *
 * The shell is built for a tenant member. It reads the JWT claims, builds a
 * role-aware nav, mounts the company-context provider, the notification bell and a
 * sign-out control. A respondent on this route has none of those things and is
 * entitled to none of them, and every one of them is a way for a company's structure
 * to leak onto a page anybody holding a link can open. So this route renders its own
 * chrome — a heading, a language picker, the form — and nothing that reads a claim.
 *
 * The only tenant data reachable from here is what
 * `GET /surveys/{id}/respond` returns, which is the reduced respondent view: no
 * company id, no author, no response count, no department targets, no user list.
 *
 * ## Why the language picker is here and not optional
 *
 * A respondent arriving from an email has no stored preference and no authenticated
 * locale, so the app starts them in whatever `detectLocale()` reads off the browser.
 * On a shared or mis-configured machine that is the wrong language, and this is the
 * one page where being unable to change it means being unable to answer at all.
 */
export default function PublicSurveyRespondPage() {
  const { id } = useParams<{ id: string }>()
  const { t } = useTranslation('surveyRespond')

  return (
    <div className="min-h-dvh bg-surface-outer">
      <SkipLink href="#survey">{t('skipToSurvey')}</SkipLink>

      <header className="flex flex-wrap items-center justify-between gap-inline border-b border-line-default bg-surface-panel px-gutter py-2">
        {/* The product name, which `i18n/noHardcodedStrings.test.ts` allows
            explicitly: it is a proper noun and is not translated. A respondent who
            followed a link out of an email needs to know what site they are on. */}
        <span className="text-sm font-medium text-fg-secondary">
          Organizational Climate Platform
        </span>
        <LanguageSwitcher />
      </header>

      <main
        id="survey"
        className="mx-auto w-full max-w-content overflow-x-auto p-gutter pb-section"
      >
        {id ? <SurveyRespondForm surveyId={id} publicEntry /> : null}
      </main>
    </div>
  )
}
