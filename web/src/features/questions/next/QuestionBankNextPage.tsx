import { useState } from 'react'
import { ArrowRight, Library, Search, SquareLibrary } from 'lucide-react'
import { Link } from 'react-router'
import { PageTopBar } from '../../../components/layout'
import { Alert, AlertDescription, Button, Chip, ErrorState, Input, LoadingRegion, SkeletonText, Switch, Table } from '../../../components/ui'
import { useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { useCompanyScope } from '../../../company-context'
import { useCompanyName } from '../../../company-context/useCompanyName'
import { useTranslation } from '../../../i18n'
import { questionTypeLabel } from '../../surveys/surveyVocabulary'
import { dimensionLabel } from '../../surveys/dimensionLabel'
import { QUESTION_BANK_TYPES, type QuestionBankItem } from '../api/questionBank'
import { EmptyRow, IconBox, TABLE_CARD_CLASS, TH_CLASS } from '../../shared-next/parts'
import { LOW_RESPONSE_RATE, MIN_ASKINGS_FOR_A_VERDICT } from './model'
import { useQuestionBankModel } from './useQuestionModels'

/**
 * Banco de preguntas, redesigned (canvas board "QuestionBank") — the "explain the split"
 * ruling: an intro block says what the bank is next to the library, the table measures how
 * each asked question performs, and an empty bank says when it will fill.
 *
 * The one verb kept is retire/reactivate (`POST /admin/question-bank/{id}/lifecycle`), offered
 * only where the server would accept it: a super administrator on any row, a company
 * administrator on their own company's rows. The previous `pages/QuestionBankPage.tsx` stays
 * in the tree as the wiring reference for authoring; the router no longer mounts it.
 */

export const SELECT_CLASS =
  'h-8 rounded-md border border-line-default bg-surface-card px-2 text-sm text-fg-primary'

export default function QuestionBankNextPage() {
  const { t, locale } = useTranslation()
  const scope = useCompanyScope()
  const caps = useViewerCapabilities()
  const companyName = useCompanyName()
  const company = companyName ?? t('insights.next.thisCompany')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [type, setType] = useState('')
  const [includeRetired, setIncludeRetired] = useState(false)
  const { state, reload, toggleLifecycle, busyId, actionError } = useQuestionBankModel(scope.companyId, {
    search: search.trim() || undefined,
    category: category || undefined,
    type: type || undefined,
    includeRetired,
  })

  const canWrite = (item: QuestionBankItem) =>
    scope.isSuperAdmin || (caps.canManageOrg && item.companyId !== null && item.companyId === scope.companyId)
  const categoryNames = state.status === 'ready' ? [...new Set(state.data.categories.map((c) => c.category))] : []

  return (
    <div>
      <PageTopBar eyebrow={[t('insights.next.proposal'), companyName].filter(Boolean).join(' · ')} title={t('questionBank.next.title')} description={t('questionBank.next.description')} />

      <div className="mb-panel-gap flex flex-wrap items-center gap-3 rounded-lg border border-line-default bg-surface-card p-4">
        <IconBox>
          <SquareLibrary />
        </IconBox>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-semibold text-fg-primary">{t('questionBank.next.splitTitle')}</p>
          <p className="m-0 text-xs text-fg-secondary">
            {t('questionBank.next.splitBody')}
            {state.status === 'ready' && state.data.library && (
              <>
                {' '}
                {t('questionBank.next.splitCounts', {
                  questions: state.data.library.questions,
                  categories: state.data.library.categories,
                })}
              </>
            )}
          </p>
        </div>
        <Link to="/admin/question-library" className="inline-flex items-center gap-1 text-xs text-fg-secondary">
          {t('questionBank.next.openLibrary')}
          <ArrowRight aria-hidden="true" className="size-3" />
        </Link>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="relative mb-0 min-w-60 flex-1 basis-60 sm:max-w-75">
          <span className="sr-only">{t('questionBank.next.searchPlaceholder')}</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-tertiary" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('questionBank.next.searchPlaceholder')}
            className="mt-0 pl-8"
          />
        </label>
        <select aria-label={t('questionBank.next.allCategories')} className={`${SELECT_CLASS} w-50`} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{t('questionBank.next.allCategories')}</option>
          {categoryNames.map((name) => (
            <option key={name} value={name}>
              {dimensionLabel(name, t)}
            </option>
          ))}
        </select>
        <select aria-label={t('questionBank.next.allTypes')} className={`${SELECT_CLASS} w-40`} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">{t('questionBank.next.allTypes')}</option>
          {QUESTION_BANK_TYPES.map((value) => (
            <option key={value} value={value}>
              {questionTypeLabel(t, value)}
            </option>
          ))}
        </select>
        <label className="mb-0 ml-auto inline-flex items-center gap-2 text-sm text-fg-secondary">
          <Switch checked={includeRetired} onCheckedChange={(value) => setIncludeRetired(value === true)} />
          {t('questionBank.next.showRetired')}
        </label>
      </div>

      {actionError && (
        <Alert variant="destructive" role="alert" className="mb-3">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {state.status === 'loading' ? (
        <LoadingRegion loading label={t('common.loading')}>
          <SkeletonText lines={4} />
        </LoadingRegion>
      ) : state.status === 'failed' ? (
        <ErrorState
          title={t('errors.generic')}
          description={state.message}
          action={
            <Button variant="outline" onClick={() => void reload()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : (
        <div className={TABLE_CARD_CLASS}>
          <div className="overflow-x-auto">
            <Table className="w-full border-collapse text-sm">
              <thead className="border-b border-line-light">
                <tr>
                  <th scope="col" className={TH_CLASS}>{t('questionBank.next.colQuestion')}</th>
                  <th scope="col" className={`${TH_CLASS} w-36`}>{t('questionBank.next.colOwner')}</th>
                  <th scope="col" className={`${TH_CLASS} w-36`}>{t('questionBank.next.colCategory')}</th>
                  <th scope="col" className={`${TH_CLASS} w-32`}>{t('questionBank.next.colType')}</th>
                  <th scope="col" className={`${TH_CLASS} w-26`}>{t('questionBank.next.colAsked')}</th>
                  <th scope="col" className={`${TH_CLASS} w-28`}>{t('questionBank.next.colAnswered')}</th>
                  <th scope="col" className={`${TH_CLASS} w-28`}>{t('questionBank.next.colSkipped')}</th>
                </tr>
              </thead>
              <tbody>
                {state.data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-0">
                      <EmptyRow
                        icon={<Library />}
                        title={t('questionBank.next.emptyTitle')}
                        lines={[t('questionBank.next.emptyWhen'), t('questionBank.next.emptyMeanwhile', { company })]}
                      />
                    </td>
                  </tr>
                ) : (
                  state.data.rows.map((row) => (
                    <tr key={row.item.id} data-testid="bank-row" className="border-b border-line-light last:border-b-0">
                      <td className="px-3 py-2.5 align-top">
                        <div className="text-fg-primary">{row.item.text ?? '—'}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {row.attention && <Chip tone="warning" label={t('questionBank.next.attention')} />}
                          {!row.item.isActive && <Chip tone="neutral" label={t('questionBank.next.retired')} />}
                          {canWrite(row.item) && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1.5 text-xs"
                              disabled={busyId !== null}
                              onClick={() => void toggleLifecycle(row.item.id, row.item.isActive)}
                            >
                              {row.item.isActive ? t('questionBank.next.retire') : t('questionBank.next.reactivate')}
                            </Button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <Chip
                          tone="neutral"
                          label={row.item.companyId === null ? t('questionBank.next.ownerGlobal') : company}
                        />
                      </td>
                      <td className="px-3 py-2.5 align-top text-fg-secondary">{dimensionLabel(row.item.category, t)}</td>
                      <td className="px-3 py-2.5 align-top text-fg-secondary">{questionTypeLabel(t, row.item.type)}</td>
                      {[row.asked, row.answered, row.skipped].map((value, index) => (
                        <td key={index} className="px-3 py-2.5 align-top font-mono text-fg-primary tabular-nums">
                          {value === null ? '—' : value.toLocaleString(locale)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </div>
        </div>
      )}

      <p className="mt-3 mb-0 text-xs text-fg-secondary">
        {t('questionBank.next.attentionRule', { min: MIN_ASKINGS_FOR_A_VERDICT, rate: LOW_RESPONSE_RATE })}
      </p>
    </div>
  )
}
