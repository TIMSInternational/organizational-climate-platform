import { Link } from 'react-router'
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui'
import { useTranslation } from '../../../i18n'
import { formatNotificationTimestamp } from '../../notifications/formatTimestamp'
import type { ConsentRecord } from '../api/gdpr'

/**
 * Catalogue paths for the six columns of `UserConsent`.
 *
 * Keyed by the column name as the exporter flattens it (`Consent.Analytics` minus its
 * prefix), so a column with no copy renders as the raw name rather than as a blank row —
 * the same fallback `ProfileActivityList` gives an unrecognised audit action. A consent
 * surface that hides a flag it has never heard of is exactly the wrong failure mode.
 *
 * `privacyCopy.test.ts` asserts every path here resolves in both catalogues, which is the
 * check `keysExist.test.ts` cannot do: the lookup is dynamic at the call site.
 */
export const CONSENT_LABEL_PATH: Record<string, string> = {
  Essential: 'privacy.consentEssential',
  Analytics: 'privacy.consentAnalytics',
  Marketing: 'privacy.consentMarketing',
  Personalization: 'privacy.consentPersonalization',
  ThirdParty: 'privacy.consentThirdParty',
  Demographics: 'privacy.consentDemographics',
}

export interface ConsentRecordPanelProps {
  /** Null until the export it is read from has been requested. */
  consent: ConsentRecord | null
}

/**
 * The consent columns stored on the caller's account.
 *
 * ## What this panel is careful not to imply
 *
 * `UserConsent` is a real column group on `users` and it is exported and erased with the
 * account — but **no screen in this product writes it**. The only writer anywhere under
 * `src/` is `SubjectErasure.AnonymiseAccount`, which sets every flag to false as part of an
 * erasure. So for a live account these values are whatever the row was created with, and
 * rendering them under a heading like "your choices" would put a decision in someone's
 * mouth that they were never offered. The panel says so instead, in
 * `privacy.consentNotCollected`, and points at the one consent surface that *is* editable:
 * the four email opt-outs on `/settings/notifications`, which `ProfileEndpoints` and
 * `NotificationEndpoints` both describe as "consent state in everything but name" and both
 * stamp `ConsentUpdatedAt` for.
 *
 * That stamp is why the timestamp is shown beside the flags rather than above them as if it
 * dated a choice about these six: it records the last change to the notification
 * preferences, and the copy says which.
 *
 * ## Read from the subject access export
 *
 * There is no consent endpoint to read — see `api/gdpr.ts`. The export flattens owned types
 * into the account record, so requesting it is the only way these columns become legible,
 * and this panel therefore has nothing to show until one has been requested.
 */
export default function ConsentRecordPanel({ consent }: ConsentRecordPanelProps) {
  const { t, locale } = useTranslation()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('privacy.consentTitle')}</CardTitle>
        <CardDescription>{t('privacy.consentDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-panel-gap">
        {consent === null ? (
          <p className="text-sm text-fg-tertiary">{t('privacy.consentPending')}</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('privacy.consentColumn')}</TableHead>
                  <TableHead>{t('privacy.consentStored')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {consent.flags.map((flag) => {
                  const path = CONSENT_LABEL_PATH[flag.name]
                  return (
                    <TableRow key={flag.name}>
                      <TableCell>{path === undefined ? flag.name : t(path)}</TableCell>
                      <TableCell>
                        <Badge variant={flag.granted ? 'success' : 'secondary'}>
                          {flag.granted
                            ? t('privacy.consentGranted')
                            : t('privacy.consentWithheld')}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            <p className="text-sm text-fg-tertiary">
              {t('privacy.consentUpdatedAt')}{' '}
              {consent.updatedAt === null
                ? t('privacy.consentNever')
                : formatNotificationTimestamp(consent.updatedAt, locale)}
            </p>
          </>
        )}

        <p className="text-sm text-fg-secondary">{t('privacy.consentNotCollected')}</p>

        <p className="text-sm text-fg-secondary">
          <Link to="/settings/notifications">{t('privacy.consentEmailLink')}</Link>{' '}
          {t('privacy.consentEmailNote')}
        </p>
      </CardContent>
    </Card>
  )
}
