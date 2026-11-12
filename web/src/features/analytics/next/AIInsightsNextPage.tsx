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
import { CARD, GeneratedNote, SectionHeading } from './parts'

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
 * result (the word carries it, and the list is sorted by it). Findings are machine-authored,
 * so the list says so (HIG `generative-ai.md` › Transparency) and that they may be wrong
 * (› Inputs, on hallucinations). The closing note states only what the page itself keeps:
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
          {insights.length > 0 && <GeneratedNote />}
          <div className={`${CARD} overflow-hidden`}>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col" className="w-28">{t('insights.next.colPriority')}</TableHead>
                  <TableHead scope="col">{t('insights.next.colFinding')}</TableHead>
                  <TableHead scope="col" className="hidden w-36 md:table-cell">{t('insights.next.colType')}</TableHead>
                  <TableHead scope="col" className="hidden w-40 md:table-cell">{t('insights.next.colCategory')}</TableHead>
                  <TableHead scope="col" className="w-12 md:w-44">
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
                      <TableCell className="py-3 align-top">
                        {/* Neutral: a priority is not one of the three result areas. */}
                        <Chip tone="neutral" label={insightPriorityLabel(t, insight.priority)} />
                      </TableCell>
                      <TableCell className="whitespace-normal py-3 align-top text-fg-primary">
                        {insight.title}
                        {/* Under md the type and category columns fold under the title, so a phone
                            keeps the finding and its one verb on screen without scrolling sideways. */}
                        <span className="mt-0.5 block text-sm text-fg-tertiary md:hidden">
                          {insightTypeLabel(t, insight.type)} · {insightCategoryLabel(t, insight.category)}
                        </span>
                      </TableCell>
                      <TableCell className="hidden py-3 align-top text-fg-secondary md:table-cell">{insightTypeLabel(t, insight.type)}</TableCell>
                      <TableCell className="hidden py-3 align-top text-fg-secondary md:table-cell">{insightCategoryLabel(t, insight.category)}</TableCell>
                      <TableCell className="py-2 text-right align-top">
                        {insight.isAcknowledged ? (
                          <Chip tone="neutral" icon={<Check />} label={t('insights.next.acknowledged')} />
                        ) : caps.canManageOrg ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={acknowledgingId !== null}
                            onClick={() => void acknowledge(insight.id)}
                            aria-label={t('insights.next.acknowledge')}
                          >
                            <Check aria-hidden="true" className="md:hidden" />
                            <span className="hidden md:inline">{t('insights.next.acknowledge')}</span>
                          </Button>
                        ) : null}
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
