import { useEffect, useRef, useState } from 'react'
import { Info } from 'lucide-react'
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
 * ## The endpoint behind it exists
 *
 * This comment said the opposite for a year — "`GET /shared/reports/{token}` is not mapped
 * by the API" — and it was already stale when it was written down twice: the sibling
 * `api/sharedReports.ts` records the route landing, and `router.tsx` says so on the route
 * declaration. Measured: `ReportShareEndpoints.cs:87` maps
 * `app.MapGet("/shared/reports/{token}", ResolveAsync)` outside every authorization group,
 * and `Program.cs:649` registers `MapReportShareEndpoints`. `report_shares` holds the
 * SHA-256 hash of each token with a finite expiry, and `ReportSharePanel` mints them from
 * the reports list.
 *
 * Nothing here changed when it landed, which was the point of writing it this way. The
 * document is `ReportOutputDocument` — projected through `PublicReportProjection`, an
 * allow-list, so a section added to the stored document is not world-readable by default —
 * and what the page does with a 404 is exactly what it does with an expired token.
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
            {/* The same glyph, variant and role `LinkOutcome` gives the dead survey
                link, and for the reason that component states about its own two routes:
                one situation must not have two faces depending on which link reached
                it. A visitor who followed a dead share link and a visitor who followed
                a dead invitation are the same person having the same experience, and
                before this the report's version was the only one of the two with no
                icon. `aria-hidden` because the sentence beside it says everything the
                glyph does. */}
            <Info aria-hidden="true" />
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

      {/* The reading below takes the same four-across ladder the participation rows use,
          and deliberately not `sm:auto-cols-fr`: this section holds exactly one reading,
          and auto columns stretched it the full width of a 1440px page — a lone date tile
          as wide as the whole report. Caught in the PNG, invisible to every assertion. */}
      {report.generatedAt !== null && (
        <section
          aria-label={t('panelLabel')}
          className="grid grid-cols-1 gap-panel-gap sm:grid-cols-2 xl:grid-cols-4"
        >
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
