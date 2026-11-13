import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Trash2 } from 'lucide-react'
import { describeKnownRefusal } from '../../../../api/describeApiError'
import { useCompanyContext } from '../../../../company-context'
import { useTranslation } from '../../../../i18n'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
} from '../../../../components/ui'
import { deleteCompany, getCompanyDeletion, type CompanyDeletionAssessment } from '../../api/companies'

type Assessment =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; assessment: CompanyDeletionAssessment }

/**
 * «Eliminar empresa» -- a company nobody has answered anything in (ruled 2026-11-08, super admins
 * only). Until this, a mistaken or rehearsal company was a 20 KB SQL script a developer ran.
 *
 * The dialog asks the server first (`GET /admin/companies/{id}/deletion`) and says what it found:
 * a company that holds answers, or a TIMS operator's account, is refused, and the dialog names
 * which of the two and offers nothing to type. Otherwise it says how many people, surveys and
 * departments go, that the step cannot be undone, and that the activity log is kept -- and the
 * company's name must be typed exactly, the confirmation the server checks too.
 */
export default function DeleteCompanyCard({ companyId, companyName }: { companyId: string; companyName: string }) {
  const { t } = useTranslation()
  const copy = (key: string, vars?: Record<string, string | number>) => t(`superadmin.next.companyDetail.delete.${key}`, vars)
  const [open, setOpen] = useState(false)
  return (
    <Card className="border-accent-red-ring" data-testid="delete-company">
      <CardHeader>
        <CardTitle>{copy('title')}</CardTitle>
        <CardDescription>{copy('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="destructive" onClick={() => setOpen(true)}>
          <Trash2 aria-hidden="true" />
          {copy('action')}
        </Button>
      </CardContent>
      <DeleteCompanyDialog companyId={companyId} companyName={companyName} open={open} onOpenChange={setOpen} />
    </Card>
  )
}

export function DeleteCompanyDialog({
  companyId,
  companyName,
  open,
  onOpenChange,
}: {
  companyId: string
  companyName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const copy = (key: string, vars?: Record<string, string | number>) => t(`superadmin.next.companyDetail.delete.${key}`, vars)
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const navigate = useNavigate()
  const { selectedCompanyId, selectCompany } = useCompanyContext()
  const [assessment, setAssessment] = useState<Assessment>({ status: 'loading' })
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setTyped('')
    setProblem(null)
    setAssessment({ status: 'loading' })
    getCompanyDeletion(baseUrl, companyId)
      .then((found) => {
        if (!cancelled) setAssessment({ status: 'ready', assessment: found })
      })
      .catch(() => {
        if (!cancelled) setAssessment({ status: 'failed' })
      })
    return () => {
      cancelled = true
    }
  }, [open, baseUrl, companyId])

  const ready = assessment.status === 'ready' ? assessment.assessment : null
  const nameMatches = ready !== null && typed.trim() === ready.name.trim()

  async function confirm() {
    if (ready === null || !ready.deletable || !nameMatches) return
    setBusy(true)
    setProblem(null)
    try {
      await deleteCompany(baseUrl, companyId, typed.trim())
      // The header must not keep pointing at a company that no longer exists.
      if (selectedCompanyId === companyId) selectCompany(null)
      onOpenChange(false)
      navigate('/admin/companies', { replace: true, state: { deletedCompany: ready.name } })
    } catch (cause) {
      setProblem(describeKnownRefusal(cause, t) ?? copy('failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent closeLabel={t('common.close')} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy('dialogTitle', { company: companyName })}</DialogTitle>
          <DialogDescription>{copy('dialogBody')}</DialogDescription>
        </DialogHeader>
        {assessment.status === 'loading' ? (
          <Skeleton className="h-16 w-full" />
        ) : assessment.status === 'failed' ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{copy('assessFailed')}</AlertDescription>
          </Alert>
        ) : !assessment.assessment.deletable ? (
          <Alert variant="destructive" role="alert" data-testid="delete-company-refused">
            <AlertDescription>
              {assessment.assessment.superAdmins > 0
                ? copy('refusedSuperAdmins', { count: assessment.assessment.superAdmins })
                : copy('refusedAnswers', {
                    count:
                      assessment.assessment.responses +
                      assessment.assessment.answeredMicroclimates +
                      assessment.assessment.linkParticipations,
                  })}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <p className="m-0 text-sm" data-testid="delete-company-scope">
              {copy('scope', {
                people: assessment.assessment.people,
                surveys: assessment.assessment.surveys,
                departments: assessment.assessment.departments,
              })}
            </p>
            <p role="note" className="m-0 text-sm text-accent-red-ink">
              {copy('irreversible')}
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="delete-company-name">{copy('typeName', { company: assessment.assessment.name })}</Label>
              <Input
                id="delete-company-name"
                value={typed}
                autoComplete="off"
                disabled={busy}
                onChange={(event) => setTyped(event.target.value)}
              />
            </div>
          </>
        )}
        {problem ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          {ready?.deletable ? (
            <Button type="button" variant="destructive" disabled={busy || !nameMatches} onClick={() => void confirm()}>
              {busy ? copy('deleting') : copy('confirm')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
