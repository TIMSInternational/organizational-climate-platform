import { useState } from 'react'
import { PageTopBar } from '../../../components/layout'
import { useTranslation } from '../../../i18n'
import ConsentRecordPanel from '../components/ConsentRecordPanel'
import DataAccessPanel from '../components/DataAccessPanel'
import ErasureRequestPanel from '../components/ErasureRequestPanel'
import { getMyDataExport, readConsentRecord, type SubjectAccessExport } from '../api/gdpr'

/**
 * Privacy and data-subject rights, self-service (#137).
 *
 * ## Reachable by every role, and gated by nothing but `RequireAuth`
 *
 * The one endpoint behind this page is `GET /gdpr/access` with no `userId`, which the
 * handler documents as *"the self-service case and needs no role"*. It resolves the caller
 * from their own token and can address no other row — the same property `/profile` has, and
 * the same reason this page is linked from the shell's account menu (`SidebarUserMenu` on
 * the rail, `ShellControls` in the mobile drawer) rather than from `navSections`, which is
 * role-aware and would hide it from the employees whose data it is about. `navSections` is
 * also what feeds the four-slot mobile tab bar, and displacing a work destination with a
 * page a person visits twice a year would be the wrong trade; `MobileNav.test.tsx` pins
 * those four.
 *
 * ## Why the export is fetched once and shared by three panels
 *
 * `GET /gdpr/access` writes an `audit_logs` row per call by design — it is a bulk
 * disclosure — so the page asks for it exactly once, when the reader presses the button,
 * and the consent record and the erasure reference are read out of that same response.
 * Fetching separately per panel would file three disclosure records for one act.
 *
 * ## What this page cannot do, stated rather than mocked up
 *
 * There is **no erasure request to submit**. `POST /gdpr/erasure` is administrators only and
 * refuses a caller who names their own user id, so no role can erase itself; and the API has
 * no endpoint that records a subject's request for a controller to act on. `ErasureRequestPanel`
 * says that in words and hands over the identifiers instead of rendering a button that could
 * only 403. Building the intake would be a new table, a new endpoint and a notification —
 * server work this issue does not own.
 */
export default function PrivacySettingsPage() {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const [subjectExport, setSubjectExport] = useState<SubjectAccessExport | null>(null)
  const [requesting, setRequesting] = useState(false)
  // The server's own message, or '' when the failure carried none — the shape
  // `ProfilePage` and `NotificationPreferencesPage` both use.
  const [error, setError] = useState<string | null>(null)

  async function request() {
    setError(null)
    setRequesting(true)
    try {
      setSubjectExport(await getMyDataExport(baseUrl))
    } catch (err) {
      // The previous export, if any, stays on screen: it was a true answer when it was
      // given, and blanking it would suggest the data went away rather than the request.
      setError(err instanceof Error ? err.message : '')
    } finally {
      setRequesting(false)
    }
  }

  return (
    <div className="grid gap-panel-gap">
      {/* Passed rather than derived, exactly as `ProfilePage` does: `navSections` mentions
          no route under `/settings`, so `PageTopBar` would find no section to name. */}
      <PageTopBar
        eyebrow={t('privacy.eyebrow')}
        title={t('privacy.title')}
        description={t('privacy.description')}
      />

      <DataAccessPanel
        subjectExport={subjectExport}
        requesting={requesting}
        error={error}
        onRequest={() => void request()}
      />

      <ConsentRecordPanel
        consent={subjectExport === null ? null : readConsentRecord(subjectExport)}
      />

      <ErasureRequestPanel subject={subjectExport?.subject ?? null} />
    </div>
  )
}
