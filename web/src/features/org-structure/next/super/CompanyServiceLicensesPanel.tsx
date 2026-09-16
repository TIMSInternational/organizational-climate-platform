import { useEffect, useId, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { Alert, AlertDescription, Button, Input, SkeletonText } from '../../../../components/ui'
import {
  listServiceLicenses,
  grantServiceLicense,
  suspendServiceLicense,
  reactivateServiceLicense,
  type CompanyServiceLicense,
} from '../../api/licenses'
import { CanvasChip, Field, MiniBar, Panel } from './parts'

const SERVICE_LABEL_KEY: Readonly<Record<string, string>> = {
  general_climate: 'superadmin.next.companyDetail.licenses.serviceGeneralClimate',
  organizational_culture: 'superadmin.next.companyDetail.licenses.serviceOrganizationalCulture',
  microclimate: 'superadmin.next.companyDetail.licenses.serviceMicroclimate',
}

/**
 * `/admin/companies/:id` — the super administrator's service-licence panel.
 *
 * Per metered climate service: the seats used out of those granted, the licence status, and the
 * controls to grant/adjust seats and suspend or reactivate. A service with no licence is shown
 * as unmetered (completions are grandfathered) until seats are granted here. Enforcement itself
 * lives at the respond endpoint — a seat is spent when a respondent completes the survey.
 */
export default function CompanyServiceLicensesPanel({ companyId }: { companyId: string }) {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const headingId = useId()

  const [services, setServices] = useState<CompanyServiceLicense[] | null>(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let live = true
    setServices(null)
    setLoadError(false)
    listServiceLicenses(baseUrl, companyId)
      .then((rows) => live && setServices(rows))
      .catch(() => live && setLoadError(true))
    return () => {
      live = false
    }
  }, [baseUrl, companyId])

  function replace(updated: CompanyServiceLicense) {
    setServices((current) =>
      (current ?? []).map((row) => (row.serviceType === updated.serviceType ? updated : row)),
    )
  }

  return (
    <Panel
      labelledBy={headingId}
      heading={
        <h2 id={headingId} className="m-0 text-2xl">
          {t('superadmin.next.companyDetail.licenses.title')}
        </h2>
      }
      meta={t('superadmin.next.companyDetail.licenses.subtitle')}
      className="gap-4 pb-5"
    >
      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{t('superadmin.next.companyDetail.licenses.loadFailed')}</AlertDescription>
        </Alert>
      )}
      {services === null && !loadError && <SkeletonText lines={3} />}
      {services?.map((service) => (
        <ServiceRow
          key={service.serviceType}
          companyId={companyId}
          baseUrl={baseUrl}
          service={service}
          onChanged={replace}
        />
      ))}
    </Panel>
  )
}

function ServiceRow({
  companyId,
  baseUrl,
  service,
  onChanged,
}: {
  companyId: string
  baseUrl: string
  service: CompanyServiceLicense
  onChanged: (updated: CompanyServiceLicense) => void
}) {
  const { t } = useTranslation()
  const seatsId = useId()
  const [seats, setSeats] = useState(String(service.seatsTotal))
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState(false)

  const parsed = Number(seats)
  const seatsValid = Number.isInteger(parsed) && parsed >= 0
  const percent = service.seatsTotal > 0 ? (service.seatsUsed / service.seatsTotal) * 100 : 0
  const name = t(SERVICE_LABEL_KEY[service.serviceType] ?? service.serviceType)

  async function run(action: () => Promise<CompanyServiceLicense>) {
    setBusy(true)
    setSaveError(false)
    try {
      const updated = await action()
      onChanged(updated)
      setSeats(String(updated.seatsTotal))
    } catch {
      setSaveError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-2 border-t border-line-light pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-medium text-fg-primary">{name}</span>
        {service.licensed ? (
          <CanvasChip
            tone={service.status === 'suspended' ? 'warning' : 'good'}
            label={
              service.status === 'suspended'
                ? t('superadmin.next.companyDetail.licenses.statusSuspended')
                : t('superadmin.next.companyDetail.licenses.statusActive')
            }
          />
        ) : (
          <CanvasChip tone="neutral" label={t('superadmin.next.companyDetail.licenses.notLicensed')} />
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-fg-tertiary">
        <MiniBar percent={percent} muted={!service.licensed || service.status === 'suspended'} />
        <span>
          {t('superadmin.next.companyDetail.licenses.seatsUsage', {
            used: service.seatsUsed,
            total: service.seatsTotal,
          })}
        </span>
        {!service.licensed && <span>· {t('superadmin.next.companyDetail.licenses.unmeteredHint')}</span>}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field fieldLabel={t('superadmin.next.companyDetail.licenses.seatsField')} htmlFor={seatsId}>
          <Input
            id={seatsId}
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={seats}
            aria-invalid={!seatsValid}
            onChange={(event) => setSeats(event.target.value)}
            className="w-28"
          />
        </Field>
        <Button
          type="button"
          variant="primary"
          disabled={busy || !seatsValid}
          onClick={() => void run(() => grantServiceLicense(baseUrl, companyId, service.serviceType, { seatsTotal: parsed }))}
        >
          {busy ? t('superadmin.next.companyDetail.licenses.saving') : t('superadmin.next.companyDetail.licenses.save')}
        </Button>
        {service.licensed && service.status === 'active' && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void run(() => suspendServiceLicense(baseUrl, companyId, service.serviceType))}
          >
            {t('superadmin.next.companyDetail.licenses.suspend')}
          </Button>
        )}
        {service.licensed && service.status === 'suspended' && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void run(() => reactivateServiceLicense(baseUrl, companyId, service.serviceType))}
          >
            {t('superadmin.next.companyDetail.licenses.reactivate')}
          </Button>
        )}
      </div>

      {saveError && (
        <Alert variant="destructive">
          <AlertDescription>{t('superadmin.next.companyDetail.licenses.saveFailed')}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
