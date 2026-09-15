import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowRight, ClipboardList, EyeOff, Inbox, LayoutGrid, Lock } from 'lucide-react'
import { PageTopBar } from '../../../../components/layout'
import {
  Button,
  Chip,
  EmptyState,
  LoadingRegion,
  NetworkError,
  SkeletonText,
} from '../../../../components/ui'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { calendarDay } from '../../../../lib/calendarDay'
import { useCompanyScope } from '../../../../company-context'
import { useMySurveysModel } from './useMySurveysModel'
import {
  belongsToNoCompany,
  groupMySurveys,
  isClosingSoon,
  roleLabelKey,
  type MySurveyRow,
} from './derive'

/**
 * `/surveys/my` — the respondent's own list, drawn as the MySurveys artboard (10 Sep) and,
 * for an account that belongs to no company, as MySurveysSinEmpresa.
 *
 * It replaced `MySurveysPage`, which is deleted rather than left unrouted: a page nothing
 * mounts still carries tests that report its guarantees as held.
 *
 * ## Why there is no role check, and why that is the correct shape here
 *
 * Every other page in this app either gates on a role or scopes itself from a claim. This
 * one does neither, deliberately. `GET /surveys/my` resolves the caller's **own user row**
 * — by `sub`, then by external id, then by email — and filters by that row's company and
 * department. It reads no role claim at all, which is what makes it loadable by `employee`,
 * `supervisor` and `leader`.
 *
 * Reading the department from the user row rather than from the JWT is the endpoint's own
 * choice and it matters: department membership moves, and a token minted before a transfer
 * would otherwise keep serving the old team's surveys until it expired.
 *
 * ## The artboard's "Ya respondidas" table is not built, and cannot be
 *
 * The artboard's second section is a receipt: every survey the reader has answered, with
 * the day they answered it. **No endpoint carries either fact.**
 * `SurveyQueries.AssignedTo` — the only query behind this page — hard-filters
 * `Status == SurveyStatuses.Active` *and* `!responses.Any(r => … && r.IsComplete)`, so a
 * survey leaves this payload the moment it is answered and never returns; `/surveys/my`
 * takes no parameter that would include it. The artboard says so itself, in its own note:
 * "Hoy la página solo muestra lo pendiente", and the state it draws is labelled
 * "Propuesta, pendiente de decisión".
 *
 * So the page draws "Para responder" and, in place of the receipt, the artboard's own third
 * card — "Lo que esta lista no guarda" — which states the two reasons the receipt is
 * missing: an anonymous survey leaves none, and this product never shows what anyone
 * answered. Inventing a survey-history read to fill the table is the alternative and is
 * worse: it would put a per-person answer log on the one surface in the product that must
 * not accumulate one.
 *
 * ## "Cerradas" survives the redesign
 *
 * The artboard has no closed group, because in its story the answered survey moved to the
 * receipt. Nothing in the payload can move there, so a row whose window has ended is still
 * grouped and still chipped "No queda registrada como suya" — the product genuinely does
 * not know whether this reader answered (`SurveyResponse.UserId` is NULL on an anonymous
 * response). It renders only when such a row actually arrives, which the `Status == Active`
 * filter makes impossible today; an empty heading would assert something untrue about the
 * reader.
 */
export default function MySurveysNextPage() {
  const scope = useCompanyScope()

  // Asked before the model, so the page's shape is decided by the token rather than by a
  // response: the reader below belongs to no tenant, and an empty list from the server is
  // the *consequence* of that, not the evidence for it.
  if (belongsToNoCompany(scope)) {
    return <NoCompanyState superAdmin={scope.isSuperAdmin} />
  }

  return <SurveyList eyebrowRoleKey={roleLabelKey(scope.role)} />
}

function SurveyList({ eyebrowRoleKey }: { eyebrowRoleKey: string | null }) {
  const { t } = useTranslation()
  const { status, surveys, error, departmentName, reload } = useMySurveysModel()

  // One clock reading for the whole render, so every row agrees about which day today is.
  const { open, closed } = groupMySurveys(surveys, Date.now())

  return (
    <div>
      <PageTopBar
        // "INGENIERÍA · EMPLEADO", the artboard's eyebrow — the department when the
        // supplementary read has named one, the role alone until then and if it fails.
        eyebrow={eyebrowFor(departmentName, eyebrowRoleKey, t)}
        title={t('navigation.mySurveys')}
        description={t('employee.next.mySurveysDescription')}
      />

      {status === 'error' ? (
        <NetworkError
          title={t('errors.generic')}
          description={error ?? undefined}
          onRetry={reload}
          retryText={t('common.retry')}
        />
      ) : (
        <LoadingRegion loading={status === 'loading'} label={t('common.loading')}>
          {status === 'loading' ? (
            <SkeletonText lines={4} />
          ) : surveys.length === 0 ? (
            // `fill` is the centred block the other primary empty states use, rather than a
            // stub stranded at the top of a full-height card.
            <EmptyState fill title={t('employee.mySurveysEmptyTitle')} description={t('employee.mySurveysEmptyBody')} />
          ) : (
            <div className="flex flex-col">
              <section aria-labelledby="my-surveys-to-answer" className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 id="my-surveys-to-answer" className="m-0 flex items-baseline gap-2">
                    {t('employee.next.toAnswerHeading')}
                    {/* The artboard sets the tally in mono beside the heading, a size down.
                        `open.length` and not a server count: this payload is the whole list,
                        not a page of one — that is the note under it. */}
                    <span className="font-mono text-sm font-normal tabular-nums text-fg-secondary">{open.length}</span>
                  </h2>
                  <span className="text-sm text-fg-secondary">{t('employee.next.toAnswerSorted')}</span>
                </div>

                {open.length > 0 ? (
                  <ul className="m-0 flex list-none flex-col gap-3 p-0">
                    {open.map((row, index) => (
                      <OpenSurveyRow key={row.id} row={row} head={index === 0} />
                    ))}
                  </ul>
                ) : null}

                {/* True of every payload: `SurveyEndpoints.ListMineAsync` pages nothing,
                    while Home's `DashboardQueries.PendingSurveys` takes `SurveyRowLimit` = 5. */}
                <p className="mb-0 max-w-measure text-sm text-fg-secondary">{t('employee.next.wholeListNote')}</p>
              </section>

              {closed.length > 0 ? (
                <section aria-labelledby="my-surveys-closed" className="mt-section flex flex-col gap-3">
                  <h2 id="my-surveys-closed" className="m-0">
                    {t('employee.mySurveysClosedHeading')}
                  </h2>
                  <ul className="m-0 flex list-none flex-col gap-3 p-0">
                    {closed.map((row) => (
                      <ClosedSurveyRow key={row.id} row={row} />
                    ))}
                  </ul>
                </section>
              ) : null}

              <NotKeptCard />
            </div>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}

/** "Ingeniería · Empleado" — either half alone where only one is known, and neither invented. */
function eyebrowFor(departmentName: string | null, roleKey: string | null, t: TranslateFn): string | null {
  const parts = [departmentName, roleKey ? t(roleKey) : null].filter(
    (part): part is string => typeof part === 'string' && part !== '',
  )
  return parts.length > 0 ? parts.join(' · ') : null
}

/** `6 preguntas · unos 4 minutos · cierra el 10 oct`, the line Home prints for the same row. */
function readingLine(row: MySurveyRow, t: TranslateFn, locale: string): string {
  const date = calendarDay(Date.parse(row.closesAt), locale)
  return row.underAMinute
    ? t('employee.surveyMetaOneQuestion', { date })
    : t('employee.surveyMeta', { questions: row.questionCount, minutes: row.minutes, date })
}

/** The time-left chip's word. Separate keys rather than a plural rule the catalogue has no room for. */
function timeLeftLabel(days: number, t: TranslateFn): string {
  if (days <= 0) return t('employee.taskClosesToday')
  if (days === 1) return t('employee.oneDayLeftChip')
  return t('employee.daysLeftChip', { days })
}

/**
 * A survey still open to the reader: the artboard's card row — glyph box, title, reading
 * line, one chip, one action.
 *
 * The accent frame and the amber chip are **one** rule, not two decisions. Nothing in
 * `MySurveyListItem` separates two open rows except how soon they close, so closing soon is
 * what lights a row up and the chip that says so wears the matching tone. Accenting *every*
 * open row would paint the whole page one colour and mark nothing.
 *
 * Only the **head** of the queue carries the red button. The artboard draws one row and one
 * red "Responder"; the canvas's own rule is at most one primary per screen, and Home already
 * applies exactly this split — the survey it leads with gets the primary, everything else
 * behind it gets a quieter way in (`EmployeeHomeView`'s `LeadCard` / `AlsoOpenRow`). The head
 * is the soonest to close, because `SurveyQueries.ToMyRows` orders by `EndDate`: an inbox is
 * a queue, not an archive.
 */
function OpenSurveyRow({ row, head }: { row: MySurveyRow; head: boolean }) {
  const { t, locale } = useTranslation()
  const soon = isClosingSoon(row)

  return (
    <li
      data-slot="my-survey-row"
      data-open="true"
      // `flex-wrap` with a 320px basis on the text: the chip and the action sit beside the
      // title while it keeps that much, and drop to their own line below it. The artboard's
      // own row geometry (`flex: 1 1 320px`).
      className={
        soon
          ? 'flex flex-wrap items-center gap-4 rounded-xl border border-accent-blue-ring bg-accent-blue-soft px-4 py-3.5'
          : 'flex flex-wrap items-center gap-4 rounded-xl border border-line-default bg-surface-card px-4 py-3.5 shadow-sm'
      }
    >
      {/* The glyph and the text are one block, so a phone never strands the glyph on a line
          of its own above the title (measured at 390px, round 1). 288px is its floor: below
          that the chip and the button wrap under it instead. */}
      <div className="flex min-w-0 grow basis-72 items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-icon-box text-fg-secondary"
        >
          <Inbox className="size-icon" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="break-words text-base font-semibold text-fg-primary">
            {row.name ?? t('surveys.untitled')}
          </span>
          <span className="break-words text-sm text-fg-secondary">{readingLine(row, t, locale)}</span>
        </div>
      </div>
      {row.daysLeft !== null ? (
        <Chip tone={soon ? 'warning' : 'neutral'} label={timeLeftLabel(row.daysLeft, t)} />
      ) : null}
      {/* A real destination: `/surveys/:id/respond` is a registered route, and the respond
          endpoint authorizes it per user rather than per role. */}
      <Button asChild variant={head ? 'primary' : 'default'} size="canvas">
        <Link to={`/surveys/${row.id}/respond`}>
          <ArrowRight aria-hidden="true" />
          {t('dashboard.respondNow')}
        </Link>
      </Button>
    </li>
  )
}

/**
 * A survey whose window has ended.
 *
 * The chip is the whole point of the row: it says *"not recorded as yours"* rather than a
 * tick, because the product genuinely does not know whether this reader answered. The only
 * action is outward, to what the company did with the answers, because there is nothing of
 * the reader's own left to open.
 */
function ClosedSurveyRow({ row }: { row: MySurveyRow }) {
  const { t, locale } = useTranslation()

  return (
    <li
      data-slot="my-survey-row"
      data-open="false"
      className="flex flex-wrap items-center gap-4 rounded-xl border border-line-default bg-surface-card px-4 py-3.5 shadow-sm"
    >
      <div className="flex min-w-0 grow basis-72 items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-icon-box text-fg-secondary"
        >
          <Inbox className="size-icon" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="break-words text-base font-semibold text-fg-primary">
            {row.name ?? t('surveys.untitled')}
          </span>
          <span className="break-words text-sm text-fg-secondary">
            {t('employee.closedMeta', { date: calendarDay(Date.parse(row.closesAt), locale) })}
          </span>
        </div>
      </div>
      <Chip tone="neutral" icon={<Lock aria-hidden="true" />} label={t('employee.notRecordedChip')} />
      <Button asChild size="canvas">
        <Link to="/dashboard">{t('employee.seeWhatCameOfIt')}</Link>
      </Button>
    </li>
  )
}

/**
 * "Lo que esta lista no guarda" — the artboard's closing card, and this page's answer to the
 * receipt it cannot draw. Both rows are statements about the product, not about the reader,
 * so the card is rendered whether or not anything is listed above it.
 */
function NotKeptCard() {
  const { t } = useTranslation()

  return (
    <section
      aria-labelledby="my-surveys-not-kept"
      data-slot="my-surveys-not-kept"
      className="mt-section flex flex-col gap-3 rounded-xl border border-line-default bg-surface-card px-5 pb-4.5 pt-4 shadow-sm"
    >
      <h2 id="my-surveys-not-kept" className="m-0">
        {t('employee.next.notKeptHeading')}
      </h2>
      <ul className="m-0 flex list-none flex-col p-0">
        <NotKeptRow
          icon={<EyeOff className="size-icon" />}
          title={t('employee.next.notKeptAnonymousTitle')}
          body={t('employee.next.notKeptAnonymousBody')}
        />
        <NotKeptRow
          icon={<Lock className="size-icon" />}
          title={t('employee.next.notKeptAnswersTitle')}
          body={t('employee.next.notKeptAnswersBody')}
        />
      </ul>
    </section>
  )
}

/** One row of that card: the glyph box, the claim and the line under it. */
function NotKeptRow({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <li className="flex items-start gap-3 border-b border-line-light py-3.5 last:border-b-0 last:pb-0">
      <span
        aria-hidden="true"
        className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-icon-box text-fg-secondary"
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-base font-semibold text-fg-primary">{title}</span>
        <span className="max-w-measure text-sm text-fg-secondary">{body}</span>
      </div>
    </li>
  )
}

/**
 * **MySurveysSinEmpresa** — an account that belongs to no company, reaching this page by a
 * direct link because its own sidebar does not offer the entry (`navSections.ts`).
 *
 * The old page answered it with "Todavía no le han enviado nada", which promises a delivery
 * that can never arrive. This says what is actually true, and says which of the two readers
 * it is talking to: super administration belongs to no tenant *by design*, while any other
 * company-less account is waiting on an assignment somebody can make.
 *
 * Neither way out is assumed. "Todas las Encuestas" is drawn for a super administrator only,
 * because `buildNavSections`' fallback branch — every other role that can reach this state —
 * carries no `/surveys` row: a `company_admin` is offered one only when their token names a
 * company, and such a reader never lands here. Sending a company-less leader to an
 * administrator's listing would be a button into a refusal.
 */
function NoCompanyState({ superAdmin }: { superAdmin: boolean }) {
  const { t } = useTranslation()

  return (
    <div>
      <PageTopBar
        eyebrow={t('employee.next.noCompanyEyebrow')}
        title={t('navigation.mySurveys')}
        description={t('employee.next.noCompanyDescription')}
      />
      <section
        data-slot="my-surveys-no-company"
        className="flex flex-col items-center gap-3 rounded-xl border border-line-default bg-surface-card px-8 py-10 text-center shadow-sm"
      >
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-icon-box text-fg-secondary"
        >
          <Inbox className="size-icon" />
        </span>
        <h2 className="m-0">{t('employee.next.noCompanyTitle')}</h2>
        <p className="mb-0 max-w-measure text-base text-fg-secondary">
          {superAdmin ? t('employee.next.noCompanyBodySuperAdmin') : t('employee.next.noCompanyBody')}
        </p>
        <div className="mt-1.5 flex flex-wrap justify-center gap-2">
          {superAdmin ? (
            <Button asChild variant="outline" size="canvas">
              <Link to="/surveys">
                <ClipboardList aria-hidden="true" />
                {t('navigation.surveys')}
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="outline" size="canvas">
            <Link to="/dashboard">
              <LayoutGrid aria-hidden="true" />
              {t('navigation.dashboard')}
            </Link>
          </Button>
        </div>
      </section>
    </div>
  )
}
