import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { useTranslation } from '../../../i18n'
import { RespondCaption, RespondReading, RespondShell } from '../../../components/layout'
import { Alert, AlertDescription, AlertTitle } from '../../../components/ui'
import { RespondSurface } from '../../surveys/components/SurveyRespondForm'
import { calendarDay } from '../../../lib/calendarDay'
import { applyNoIndex } from '../../../lib/noIndex'
import SharedReportSections from '../components/SharedReportSections'
import { getSharedReport, type SharedReport } from '../api/sharedReports'

/**
 * `/shared/reports/:token` — a report as somebody who was sent a link reads it (#139).
 *
 * This is the highest-exposure page in the product. It is unauthenticated by design and
 * it serves a company's climate data to whoever holds the URL, so most of what follows
 * is about what it does *not* do.
 *
 * ## The endpoint behind it does not exist yet
 *
 * `GET /shared/reports/{token}` is not mapped by the API. #91 closed with export,
 * scheduling and the four `/admin/reports` routes; the token-addressed public route it
 * also scoped did not land, and `Report` has no share-token column for one to read.
 * `api/sharedReports.ts` records how that was checked.
 *
 * Nothing here is speculative about the *shape* of what comes back, though: the document
 * is `ReportOutputDocument`, which exists and is generated today, and the record fields
 * are `ReportDetail`'s. What the page does with a 404 — which is what it gets today — is
 * exactly what it does with an expired token, so this page is correct and safe against
 * the API as it stands, and shows a real report the day the route is mapped.
 *
 * ## Outside `RequireAuth`, and that is structural
 *
 * `router.tsx` declares this beside `/s/:token` as a direct child of the root, and
 * `router.test.ts` asserts it. `RequireAuth` renders `<Navigate to="/login" replace />`,
 * which **destroys the destination**: there is no `state.from` and no `?next=`, so a
 * visitor sent there could not come back to the report even after signing in — and the
 * visitor to this page has no account to sign in with in the first place.
 *
 * ## One outcome for every failure
 *
 * Expired, revoked and invalid must be indistinguishable, because differentiating them
 * turns a share link into an oracle: a caller with a list of guesses learns which ones
 * were once real. The server owes the flat 404; the client owes not undoing it.
 *
 * So there is exactly one failure state on this page and it takes no argument.
 * `getSharedReport` rejects with `SharedReportUnavailableError`, which carries no
 * status, no reason code and no server-supplied message — there is nothing here to
 * branch on, so a future edit cannot start branching by accident.
 *
 * ## The token is resolved exactly once per visit
 *
 * Deliberately, and it is the client half of "access should be logged" (#143). A read of
 * a shared report is an audited event; a page that re-resolved on every language switch
 * would file one reader as several and make the trail count clicks on a toggle rather
 * than readers of a report. So the locale is captured at mount and the effect does not
 * depend on it — the same decision, for a near-identical reason, that `/s/:token` makes
 * about `total_accesses`.
 *
 * The visible cost is that switching language re-renders every label on this page and
 * leaves the *authored* strings — the report title, the survey titles, the category
 * names — in the language they were resolved in. That is the right trade here: the
 * alternative corrupts an audit trail to retranslate three lines.
 *
 * ## What is not on this page
 *
 * No navigation, no account, no company switcher, no notification bell, no link into the
 * app at all — `RespondShell` is the standalone frame with a wordmark, a language picker
 * and a theme picker and nothing else, which is why it is reused here rather than
 * `AdminLayout`. `SharedReportPage.test.tsx` asserts it holds no anchor to any app
 * route, and asserts it **while a token is in `localStorage`**: an administrator opening
 * a share link in the browser they administer in is the routine case, and a page that
 * grew a rail for them would be a different page for every reader.
 */
export default function SharedReportPage() {
  const { token } = useParams<{ token: string }>()
  const { t, locale } = useTranslation('sharedReport')
  const { t: tRoot } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const [state, setState] = useState<SharedReportState>({ status: 'loading' })

  // The locale as of the first render, held so the resolve effect can send it without
  // depending on it. See the class comment: one visit is one access-log entry, and a
  // `locale` dependency would make it one per language switch.
  const requestLocale = useRef(locale)

  // `noindex` for as long as this page is mounted, and removed after — a router
  // transition does not reload the document, so a tag left behind would apply to every
  // page rendered next in this tab. `applyNoIndex` returns its own undo.
  useEffect(() => applyNoIndex(), [])

  useEffect(() => {
    if (!token) return

    let cancelled = false
    setState({ status: 'loading' })

    getSharedReport(baseUrl, token, { lang: requestLocale.current })
      .then((report) => {
        if (!cancelled) setState({ status: 'ready', report })
      })
      .catch(() => {
        // No argument, and nothing read off the rejection. Every cause — dead token,
        // revoked link, rate limit, 5xx, offline — lands here identically.
        if (!cancelled) setState({ status: 'unavailable' })
      })

    return () => {
      cancelled = true
    }
  }, [baseUrl, token])

  return (
    <RespondShell skipLabel={t('skipToReport')} contentId="report">
      <RespondSurface>
        {state.status === 'loading' && (
          <p className="text-base text-fg-secondary">{tRoot('common.loading')}</p>
        )}

        {state.status === 'unavailable' && (
          <Alert variant="warning" role="alert">
            <AlertTitle>{t('unavailableTitle')}</AlertTitle>
            <AlertDescription>{t('unavailableBody')}</AlertDescription>
          </Alert>
        )}

        {state.status === 'ready' && <ReportBody report={state.report} locale={locale} />}
      </RespondSurface>
    </RespondShell>
  )
}

type SharedReportState =
  | { status: 'loading' }
  | { status: 'ready'; report: SharedReport }
  | { status: 'unavailable' }

function ReportBody({ report, locale }: { report: SharedReport; locale: string }) {
  const { t } = useTranslation('sharedReport')

  return (
    <>
      <RespondCaption
        eyebrow={t('eyebrow')}
        title={report.title || t('untitledReport')}
        description={report.description}
      />

      {report.generatedAt !== null && (
        <section aria-label={t('panelLabel')} className="grid gap-panel-gap sm:grid-flow-col sm:auto-cols-fr">
          <RespondReading
            label={t('generatedReading')}
            // `calendarDay` for the reason it exists: it renders a day in UTC, so a
            // reader west of UTC is not told the report was generated a day early.
            value={calendarDay(Date.parse(report.generatedAt), locale)}
          />
        </section>
      )}

      {report.document === null ? (
        <p className="max-w-prose text-base text-fg-secondary">{t('noDocument')}</p>
      ) : (
        <>
          {/* The generator's own note is server-authored English naming the sections it
              has not built yet, so it is never printed verbatim to a reader who may not
              read English. Its presence is the fact worth passing on, and that is
              translated. See `ReportDocument.generationNote`. */}
          {report.document.generationNote.trim() !== '' && (
            <Alert>
              <AlertTitle>{t('incompleteTitle')}</AlertTitle>
              <AlertDescription>{t('incompleteBody')}</AlertDescription>
            </Alert>
          )}

          <SharedReportSections document={report.document} />
        </>
      )}
    </>
  )
}
