import { useEffect, useId, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  RadioGroup,
  RadioGroupItem,
} from '../../../../components/ui'
import { listDepartments, type Department } from '../../../org-structure/api/departments'
import type { CreateMicroclimateInvitationsInput, MicroclimateInvitationBatchResult } from '../../api/microclimateInvitations'

/**
 * "Invitar personas": `POST /microclimates/{id}/invitations` with exactly one selector — the
 * whole company, or named departments — as `CreateMicroclimateInvitationsRequest` requires.
 * The server refuses an empty request rather than guessing "everyone"; so does this dialog,
 * whose send button is disabled until a selector is complete.
 *
 * The departments are the company's own active ones (`GET /admin/departments`). The result
 * is the server's: how many were created, and its `note` verbatim when it has one (revoked
 * invitees skipped, undeliverable addresses).
 */
export function InviteDialog({
  open,
  onOpenChange,
  companyId,
  onInvite,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  onInvite: (input: CreateMicroclimateInvitationsInput) => Promise<MicroclimateInvitationBatchResult>
}) {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const groupId = useId()
  const [mode, setMode] = useState<'all' | 'departments'>('all')
  const [departments, setDepartments] = useState<Department[] | null>(null)
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set())
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<MicroclimateInvitationBatchResult | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setResult(null)
    setError(null)
    listDepartments(baseUrl, companyId)
      .then((list) => {
        if (!cancelled) setDepartments(list.filter((department) => department.isActive))
      })
      .catch(() => {
        if (!cancelled) setDepartments([])
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, companyId, open])

  const ready = mode === 'all' || picked.size > 0

  async function send(): Promise<void> {
    setSending(true)
    setError(null)
    try {
      setResult(await onInvite(mode === 'all' ? { allCompanyUsers: true } : { departmentIds: [...picked] }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('microclimates.next.detail.inviteTitle')}</DialogTitle>
          <DialogDescription>{t('microclimates.next.detail.inviteDescription')}</DialogDescription>
        </DialogHeader>
        {result ? (
          <p role="status" className="m-0 text-base text-fg-primary">
            {t('microclimates.next.detail.inviteCreated', { count: result.created })}
            {result.note ? ` ${result.note}` : ''}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <RadioGroup
              aria-labelledby={groupId}
              value={mode}
              onValueChange={(next) => setMode(next as 'all' | 'departments')}
            >
              <span id={groupId} className="sr-only">
                {t('microclimates.next.detail.inviteWho')}
              </span>
              <label className="flex items-center gap-2 text-base">
                <RadioGroupItem value="all" />
                {t('microclimates.next.detail.inviteAll')}
              </label>
              <label className="flex items-center gap-2 text-base">
                <RadioGroupItem value="departments" />
                {t('microclimates.next.detail.inviteDepartments')}
              </label>
            </RadioGroup>
            {mode === 'departments' && (
              <ul className="m-0 flex max-h-56 list-none flex-col gap-2 overflow-y-auto p-0">
                {departments === null ? (
                  <li className="text-sm text-fg-tertiary">{t('common.loading')}</li>
                ) : departments.length === 0 ? (
                  <li className="text-sm text-fg-tertiary">{t('microclimates.next.detail.inviteNoDepartments')}</li>
                ) : (
                  departments.map((department) => (
                    <li key={department.id}>
                      <label className="flex items-center gap-2 text-base">
                        <Checkbox
                          checked={picked.has(department.id)}
                          onCheckedChange={(checked) =>
                            setPicked((current) => {
                              const next = new Set(current)
                              if (checked === true) next.add(department.id)
                              else next.delete(department.id)
                              return next
                            })
                          }
                        />
                        {department.name}
                      </label>
                    </li>
                  ))
                )}
              </ul>
            )}
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {result ? t('common.close') : t('common.cancel')}
          </Button>
          {!result && (
            <Button variant="primary" disabled={!ready || sending} onClick={() => void send()}>
              {t('microclimates.next.detail.inviteSend')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
