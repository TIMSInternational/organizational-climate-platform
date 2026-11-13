import { useState } from 'react'
import { ArrowRight, Library, MoreHorizontal, SquareLibrary } from 'lucide-react'
import { Link } from 'react-router'
import { PageHeader } from '../../../components/layout'
import {
  Alert,
  AlertDescription,
  Button,
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ErrorState,
  LoadingState,
  Note,
  Switch,
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
import { questionTypeLabel } from '../../surveys/surveyVocabulary'
import { QUESTION_BANK_TYPES, type QuestionBankItem } from '../api/questionBank'
import { EmptyRow } from '../../shared-next/parts'
import { QSelect, SearchField, TABLE_CARD } from './parts'
import { dimensionName, LOW_RESPONSE_RATE, MIN_ASKINGS_FOR_A_VERDICT } from './model'
import { useQuestionBankModel } from './useQuestionModels'
import SuperQuestionBankView from './super/SuperQuestionBankView'

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

export default function QuestionBankNextPage() {
  // The per-role canvas (10 Sep): the super administrator's variant — the platform-wide bank with its owner column — is its own
  // view, `super/SuperQuestionBankView`, read off the claim as the tenant pages dispatch. Everyone else keeps this page.
  return readViewerClaims().role === 'super_admin' ? <SuperQuestionBankView /> : <QuestionBankForCompany />
}

function QuestionBankForCompany() {
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
      <PageHeader
        eyebrow={companyName}
        title={t('questionBank.next.title')}
        description={t('questionBank.next.description')}
        actions={
          <Button asChild variant="outline">
            <Link to="/admin/question-library">
              {t('questionBank.next.openLibrary')}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        }
      />

      {/* The bank/library split as the board's quiet `.note`: a standing fact about the screen,
          not an alert. 24px over the filters, the board's column gap. */}
      <Note data-testid="bank-split" icon={<SquareLibrary />} className="mb-section">
        <p className="m-0 font-semibold">{t('questionBank.next.splitTitle')}</p>
        <p className="m-0 text-sm leading-normal text-fg-secondary">
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
      </Note>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchField
          label={t('questionBank.next.searchPlaceholder')}
          value={search}
          onChange={setSearch}
          className="w-full sm:w-75"
        />
        <QSelect
          aria-label={t('questionBank.next.allCategories')}
          className="w-full sm:w-50"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">{t('questionBank.next.allCategories')}</option>
          {categoryNames.map((name) => (
            <option key={name} value={name}>
              {dimensionName(name, t) ?? t('questionLibrary.dimensionUnnamed')}
            </option>
          ))}
        </QSelect>
        <QSelect
          aria-label={t('questionBank.next.allTypes')}
          className="w-full sm:w-44"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">{t('questionBank.next.allTypes')}</option>
          {QUESTION_BANK_TYPES.map((value) => (
            <option key={value} value={value}>
              {questionTypeLabel(t, value)}
            </option>
          ))}
        </QSelect>
        <label className="mb-0 inline-flex min-h-9 items-center gap-2 text-sm font-normal text-fg-secondary sm:ml-auto">
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
        <LoadingState rows={4} label={t('common.loading')} />
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
        <section aria-label={t('questionBank.next.title')} className={TABLE_CARD}>
          {/* Below `sm` the table is a list: the secondary columns step out (`hidden sm:table-cell`) and
              the question cell carries them as a meta line, so a phone reads the question at full
              width instead of scrolling Categoría, Tipo and the counts off the card's right edge
              (lists-and-tables.md, layout.md > Adapt to the width). From `sm` up it is the board's table. */}
          <Table zebra className="sm:min-w-200">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col" className="px-4">{t('questionBank.next.colQuestion')}</TableHead>
                <TableHead scope="col" className="hidden w-40 sm:table-cell">{t('questionBank.next.colOwner')}</TableHead>
                <TableHead scope="col" className="hidden w-36 sm:table-cell">{t('questionBank.next.colCategory')}</TableHead>
                <TableHead scope="col" className="hidden w-36 sm:table-cell">{t('questionBank.next.colType')}</TableHead>
                <TableHead scope="col" numeric className="hidden w-26 sm:table-cell">{t('questionBank.next.colAsked')}</TableHead>
                <TableHead scope="col" numeric className="hidden w-28 sm:table-cell">{t('questionBank.next.colAnswered')}</TableHead>
                <TableHead scope="col" numeric className="hidden w-26 sm:table-cell">{t('questionBank.next.colSkipped')}</TableHead>
                <TableHead scope="col" className="w-14 pr-4">
                  <span className="sr-only">{t('common.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.data.rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <EmptyRow
                      measure="max-w-[100ch]"
                      icon={<Library />}
                      title={t('questionBank.next.emptyTitle')}
                      lines={[t('questionBank.next.emptyWhen'), t('questionBank.next.emptyMeanwhile', { company })]}
                    />
                  </td>
                </tr>
              ) : (
                state.data.rows.map((row) => (
                  <TableRow key={row.item.id} data-testid="bank-row">
                    <TableCell className="px-4 py-3 align-top">
                      <div className="text-fg-primary">{row.item.text ?? '—'}</div>
                      <div data-slot="bank-row-meta" className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-fg-secondary sm:hidden">
                        <Chip
                          tone="neutral"
                          label={row.item.companyId === null ? t('questionBank.next.ownerGlobal') : company}
                        />
                        <span>
                          {[dimensionName(row.item.category, t), questionTypeLabel(t, row.item.type)].filter(Boolean).join(' · ')}
                        </span>
                        <span className="basis-full tabular-nums text-fg-tertiary">
                          {(
                            [
                              [t('questionBank.next.colAsked'), row.asked],
                              [t('questionBank.next.colAnswered'), row.answered],
                              [t('questionBank.next.colSkipped'), row.skipped],
                            ] satisfies Array<[string, number | null]>
                          )
                            .map(([label, value]) => `${label} ${value === null ? '—' : value.toLocaleString(locale)}`)
                            .join(' · ')}
                        </span>
                      </div>
                      {(row.attention || !row.item.isActive) && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {/* Status words, so neutral: amber, green and red are the three result
                              areas and nothing else (the 11 Nov ruling). */}
                          {row.attention && <Chip tone="neutral" label={t('questionBank.next.attention')} />}
                          {!row.item.isActive && <Chip tone="neutral" label={t('questionBank.next.retired')} />}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="hidden py-3 align-top sm:table-cell">
                      <Chip
                        tone="neutral"
                        label={row.item.companyId === null ? t('questionBank.next.ownerGlobal') : company}
                      />
                    </TableCell>
                    <TableCell className="hidden py-3 align-top text-sm text-fg-secondary sm:table-cell">{dimensionName(row.item.category, t) ?? '—'}</TableCell>
                    <TableCell className="hidden py-3 align-top text-sm text-fg-secondary sm:table-cell">{questionTypeLabel(t, row.item.type)}</TableCell>
                    {[row.asked, row.answered, row.skipped].map((value, index) => (
                      <TableCell key={index} numeric className="hidden py-3 align-top text-fg-primary sm:table-cell">
                        {value === null ? '—' : value.toLocaleString(locale)}
                      </TableCell>
                    ))}
                    {/* Retire and reactivate change the row's state, so they sit in the trailing
                        overflow menu as the platform bank's do, never as a link under the text. */}
                    <TableCell className="py-2 pr-4 text-right align-top">
                      {canWrite(row.item) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              data-slot="bank-row-menu"
                              aria-label={t('questionBank.next.rowActions', { text: row.item.text ?? '—' })}
                              disabled={busyId !== null}
                            >
                              <MoreHorizontal aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => void toggleLifecycle(row.item.id, row.item.isActive)}>
                              {row.item.isActive ? t('questionBank.next.retire') : t('questionBank.next.reactivate')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </section>
      )}

      <p className="mt-3 mb-0 text-sm text-fg-tertiary">
        {t('questionBank.next.attentionRule', { min: MIN_ASKINGS_FOR_A_VERDICT, rate: LOW_RESPONSE_RATE })}
      </p>
    </div>
  )
}
