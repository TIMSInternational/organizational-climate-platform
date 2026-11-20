import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Eye, RotateCcw } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { describeApiError } from '../../../api/describeApiError'
import { RespondShell } from '../../../components/layout'
import { Alert, AlertDescription, Button, LoadingState, Note } from '../../../components/ui'
import { useTranslation } from '../../../i18n'
import { getRespondPreview, type RespondPreview } from '../api/respondPreview'
import SurveyRespondForm, { RespondSurface } from '../components/SurveyRespondForm'
import { PublicRespondEntryView } from '../next/entry/PublicRespondEntryView'
import { mintPreviewSeed, type RespondPreviewSeam } from '../respondPreview'
import type { EntryPromise } from '../respondPromise'

/** The start page draws `AnonymityNotice` from the same view the form reads, as on `/s/:token`. */
const ENTRY_PROMISE: EntryPromise = 'respondView'

type StartState =
  | { status: 'loading' }
  | { status: 'ready'; preview: RespondPreview }
  | { status: 'failed'; error: unknown }

/**
 * `/surveys/:id/preview` — «Ver como quien responde» (ruled 2026-11-19, audit gap #3).
 *
 * The screens a visitor to the survey's link walks through, drawn by the components that draw
 * them for real: `RespondShell`, the start page (`PublicRespondEntryView`, with its anonymity
 * box), the demographic and identity screens when the survey asks them, every question in a
 * served order, the footer, and the survey's own thank-you. The texts are the effective ones
 * (survey → company → default), because the view is the one the respond GET builds.
 *
 * **It saves nothing.** The view comes from `GET /surveys/{id}/respond-preview`, which writes no
 * row, and the form runs on the `preview` seam (`respondPreview.ts`), which routes the session,
 * lock, autosave, submit, receipt and `onSubmitted` to nothing. The banner says so on every
 * screen. «Ver de nuevo» starts over with a fresh shuffle seed and a fresh read, so a text edited
 * in another tab shows on the next run.
 *
 * Behind `RequireAuth` and outside `AdminLayout`, beside `/surveys/:id/respond`: what an operator
 * checks is the respondent's frame, not the admin shell. The server decides who may see it
 * (`CanAdminister`, any status but archived); a refusal is said by `describeApiError`.
 */
export default function RespondPreviewPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { t, locale } = useTranslation()
  const { t: tRespond } = useTranslation('surveyRespond')
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const [run, setRun] = useState(() => ({ seed: mintPreviewSeed(), answering: false }))
  const [start, setStart] = useState<StartState>({ status: 'loading' })

  // One read per language per run: the start page and the form ask for the same payload, and
  // the form asks again on a language switch.
  const cache = useRef(new Map<string, Promise<RespondPreview>>())
  const fetchPreview = useCallback(
    (lang: string): Promise<RespondPreview> => {
      const cached = cache.current.get(lang)
      if (cached) return cached
      const loading = getRespondPreview(baseUrl, id, lang)
      cache.current.set(lang, loading)
      loading.catch(() => cache.current.delete(lang))
      return loading
    },
    [baseUrl, id],
  )

  useEffect(() => {
    if (run.answering) return
    let cancelled = false
    setStart({ status: 'loading' })
    fetchPreview(locale)
      .then((preview) => {
        if (!cancelled) setStart({ status: 'ready', preview })
      })
      .catch((error: unknown) => {
        if (!cancelled) setStart({ status: 'failed', error })
      })
    return () => {
      cancelled = true
    }
  }, [fetchPreview, locale, run.answering, run.seed])

  const seam = useMemo<RespondPreviewSeam>(
    () => ({ seed: run.seed, load: (lang) => fetchPreview(lang).then((preview) => preview.view) }),
    [fetchPreview, run.seed],
  )

  const restart = useCallback(() => {
    cache.current.clear()
    setRun({ seed: mintPreviewSeed(), answering: false })
  }, [])

  const loaded = start.status === 'ready' ? start.preview : null

  return (
    <RespondShell
      skipLabel={tRespond('skipToSurvey')}
      contentId="survey"
      brand={loaded ? { logoUrl: loaded.companyLogoUrl, companyName: loaded.companyName } : undefined}
    >
      <PreviewBanner surveyId={id} onRestart={restart} />
      {run.answering ? (
        // `publicEntry`: a preview is what the link's visitor sees. `key`: «Ver de nuevo»
        // mounts a fresh form with an empty answer map.
        <SurveyRespondForm key={run.seed} surveyId={id} publicEntry entryPromise={ENTRY_PROMISE} preview={seam} />
      ) : (
        <RespondSurface>
          {start.status === 'loading' && <LoadingState label={t('common.loading')} />}
          {start.status === 'failed' && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>
                {describeApiError(start.error, t, 'surveys.next.respondPreview.loadFailed')}
              </AlertDescription>
            </Alert>
          )}
          {start.status === 'ready' && (
            <PublicRespondEntryView
              view={start.preview.view}
              locale={locale}
              onBegin={() => setRun((current) => ({ ...current, answering: true }))}
            />
          )}
        </RespondSurface>
      )}
    </RespondShell>
  )
}

/**
 * «Vista previa — no se guarda nada», over every screen of the preview: visible enough that
 * nobody mistakes the page for the live link, quiet enough that the screens under it still read
 * as the respondent will read them.
 */
function PreviewBanner({ surveyId, onRestart }: { surveyId: string; onRestart: () => void }) {
  const { t } = useTranslation()

  return (
    <Note tone="info" icon={<Eye />} className="mb-4" data-slot="respond-preview-banner" aria-label={t('surveys.next.respondPreview.banner')}>
      <p className="m-0 font-semibold">{t('surveys.next.respondPreview.banner')}</p>
      <p className="m-0 text-fg-secondary">{t('surveys.next.respondPreview.bannerBody')}</p>
      <div className="mt-1 flex flex-wrap gap-x-2">
        <Button type="button" variant="plain" onClick={onRestart}>
          <RotateCcw aria-hidden="true" className="size-icon" />
          {t('surveys.next.respondPreview.restart')}
        </Button>
        <Button asChild variant="plain">
          <Link to={`/surveys/${surveyId}`}>{t('surveys.next.respondPreview.back')}</Link>
        </Button>
      </div>
    </Note>
  )
}
