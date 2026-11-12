import { Check, ShieldCheck, Sparkles } from 'lucide-react'
import { PageHeader } from '../../../components/layout'
import {
  Alert,
  AlertDescription,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  LoadingState,
  Note,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui'
import { readViewerClaims, useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { useCompanyScope } from '../../../company-context'
import { useCompanyName } from '../../../company-context/useCompanyName'
import { useTranslation } from '../../../i18n'
import { insightCategoryLabel, insightPriorityLabel, insightTypeLabel } from '../insightVocabulary'
import { EmptyRow } from '../../shared-next/parts'
import { useAIInsightsModel } from './useAnalyticsModels'
import SuperAIInsightsView from './super/SuperAIInsightsView'
import { CARD, ReviewNote, SectionHeading } from './parts'

/**
 * Información de IA, redesigned (canvas board "AIInsights").
 *
 * A prioritised list — critical first — whose one verb is "mark as reviewed". The server
 * lets a super administrator, or the company administrator of the insight's own company,
 * acknowledge (`AIInsightEndpoints.cs` → `CanAccess`); that is `canManageOrg` exactly, so
 * the button is offered on that capability and nowhere else.
 *
 * The empty state names why it is empty. The only producer of `AIInsight` rows today is
 * the admin `POST /admin/ai-insights` (`AIInsightEndpoints.cs:162`) — nothing generates
 * them — so "the analysis is not configured" is the measured reason, not a guess.
 *
 * The previous screen, `pages/AIInsightsPage.tsx`, stays in the tree as the wiring
 * reference for the detail panel; the router no longer mounts it.
 *
 * Apple design (11 Nov): the page header is `PageHeader`; the priority chips are neutral —
 * green, amber and red are the three result areas and nothing else, and a priority is not a
 * result (the word carries it, and the list is sorted by it). Over the list, one caution: check
 * the evidence before acting, the text may be wrong. It makes no claim about where the text
 * came from — the server stores whatever its caller sends and records no origin. The closing note states only what the page itself keeps:
 * it shows no responses. The old floor sentence promised that a finding never describes a
 * group under the floor — a check nothing on the create path makes (`AIInsightValidation.cs`),
 * and one the 15 Oct ruling does not even ask of an administrator's single department.
 */

export default function AIInsightsNextPage() {
  // The per-role canvas (10 Sep): the super administrator's variant — the choose-a-company state and the cross-tenant reading — is its own
  // view, `super/SuperAIInsightsView`, read off the claim as the tenant pages dispatch. Everyone else keeps this page.
  return readViewerClaims().role === 'super_admin' ? <SuperAIInsightsView /> : <AIInsightsForCompany />
}

function AIInsightsForCompany() {
  const { t } = useTranslation()
  const scope = useCompanyScope()
  const caps = useViewerCapabilities()
  const companyName = useCompanyName()
  const { state, reload, acknowledge, acknowledgingId, actionError } = useAIInsightsModel(scope.companyId)
  const company = companyName ?? t('insights.next.thisCompany')

  if (scope.status === 'needs-selection') {
    return (
      <EmptyState
        title={t('companyContext.chooseACompany')}
        description={t('companyContext.chooseACompanyDescription')}
      />
    )
  }
  if (scope.status === 'no-company') {
    return <p role="alert">{t('common.noCompanyAssociated')}</p>
  }

  const insights = state.status === 'ready' ? state.data : []

  return (
    <div>
      <PageHeader
        eyebrow={companyName}
        title={t('insights.next.title')}
        description={t('insights.next.description')}
      />

      <SectionHeading
        title={t('insights.next.heading')}
        count={state.status === 'ready' ? insights.length : undefined}
        aside={t('insights.next.order')}
      />

      {actionError && (
        <Alert variant="destructive" role="alert" className="mb-3">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {state.status === 'loading' ? (
        <LoadingState rows={4} label={t('common.loading')} />
      ) : state.status === 'failed' ? (
        <ErrorState
          title={t('insights.next.loadFailed')}
          description={state.message}
          action={
            <Button variant="outline" onClick={() => void reload()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {insights.length > 0 && <ReviewNote />}
          <div className={`${CARD} overflow-hidden`}>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col" className="hidden w-28 md:table-cell">{t('insights.next.colPriority')}</TableHead>
                  <TableHead scope="col">{t('insights.next.colFinding')}</TableHead>
                  <TableHead scope="col" className="hidden w-36 md:table-cell">{t('insights.next.colType')}</TableHead>
                  <TableHead scope="col" className="hidden w-40 md:table-cell">{t('insights.next.colCategory')}</TableHead>
                  <TableHead scope="col" className="hidden w-44 md:table-cell">
                    <span className="sr-only">{t('insights.next.colReview')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {insights.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-0">
                      <EmptyRow
                        icon={<Sparkles />}
                        title={t('insights.next.emptyTitle')}
                        lines={[
                          t('insights.next.emptyReason', { company }),
                          t('insights.next.emptyNext'),
                        ]}
                      />
                    </td>
                  </tr>
                ) : (
                  insights.map((insight) => (
                    <TableRow key={insight.id} data-testid="insight-row" className="border-line-light">
                      <TableCell className="hidden py-3 align-top md:table-cell">
                        {/* Neutral: a priority is not one of the three result areas. */}
                        <Chip tone="neutral" label={insightPriorityLabel(t, insight.priority)} />
                      </TableCell>
                      <TableCell className="whitespace-normal py-3 align-top text-fg-primary">
                        {/* Under md the priority, type, category and review columns fold into this
                            cell — the priority above the title, the facts and the verb under it — so
                            the finding keeps the phone's full width (HIG layout.md). Only one copy
                            is ever displayed: the other is display:none, out of the a11y tree. */}
                        <span data-slot="finding-folded-priority" className="mb-1.5 flex md:hidden">
                          <Chip tone="neutral" label={insightPriorityLabel(t, insight.priority)} />
                        </span>
                        <span data-slot="finding-title" className="block">{insight.title}</span>
                        <span className="mt-0.5 block text-sm text-fg-tertiary md:hidden">
                          {insightTypeLabel(t, insight.type)} · {insightCategoryLabel(t, insight.category)}
                        </span>
                        <span data-slot="finding-folded-review" className="mt-2 flex md:hidden">
                          <ReviewControl
                            acknowledged={insight.isAcknowledged}
                            canAcknowledge={caps.canManageOrg}
                            busy={acknowledgingId !== null}
                            onAcknowledge={() => void acknowledge(insight.id)}
                          />
                        </span>
                      </TableCell>
                      <TableCell className="hidden py-3 align-top text-fg-secondary md:table-cell">{insightTypeLabel(t, insight.type)}</TableCell>
                      <TableCell className="hidden py-3 align-top text-fg-secondary md:table-cell">{insightCategoryLabel(t, insight.category)}</TableCell>
                      <TableCell data-slot="finding-review" className="hidden py-2 text-right align-top md:table-cell">
                        <ReviewControl
                          acknowledged={insight.isAcknowledged}
                          canAcknowledge={caps.canManageOrg}
                          busy={acknowledgingId !== null}
                          onAcknowledge={() => void acknowledge(insight.id)}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* The board's column gap: 24px from the table to the note (AIInsights.dc.html). */}
      <Note icon={<ShieldCheck />} className="mt-section">
        {t('insights.next.privacyNote')}
      </Note>
    </div>
  )
}

/** "Revisado", or the one verb with its words always visible — never an icon alone, which reads as a checkbox. */
function ReviewControl({
  acknowledged,
  canAcknowledge,
  busy,
  onAcknowledge,
}: {
  acknowledged: boolean
  canAcknowledge: boolean
  busy: boolean
  onAcknowledge: () => void
}) {
  const { t } = useTranslation()
  if (acknowledged) return <Chip tone="neutral" icon={<Check />} label={t('insights.next.acknowledged')} />
  if (!canAcknowledge) return null
  return (
    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onAcknowledge}>
      {t('insights.next.acknowledge')}
    </Button>
  )
}
