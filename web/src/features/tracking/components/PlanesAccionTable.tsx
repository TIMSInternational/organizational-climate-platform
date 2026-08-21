import { Link } from 'react-router'
import {
  Progress,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui'
import { useTranslation } from '../../../i18n'
import type { PlanAccion } from '../api/trackingApi'
import { planCalendarDay } from '../planDates'
import { sortPlans } from '../planOrder'
import { toPercent } from '../semaforo'
import SemaforoChip from './SemaforoChip'

/**
 * The listing every tracking screen shares — the plans list and mis-tareas both
 * render this, so the two can never disagree about what a plan looks like.
 *
 * ## Ordering
 *
 * `sortPlans` — worst semáforo first, then earliest compromiso. See `planOrder.ts`
 * for why the service's own order is not usable and why an unknown state sorts
 * last.
 *
 * ## The percentage
 *
 * `toPercent`, never `* 100` written out here. See `semaforo.ts` — the value on
 * the wire is a fraction, and the bar and the figure must be derived from the same
 * conversion or they will drift apart at the edges.
 */
export interface PlanesAccionTableProps {
  plans: readonly PlanAccion[]
  /** What the empty row says — a task list and a node listing mean different things by it. */
  emptyMessage: string
}

export default function PlanesAccionTable({ plans, emptyMessage }: PlanesAccionTableProps) {
  const { t, locale } = useTranslation()
  const ordered = sortPlans(plans)

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('tracking.table.codigo')}</TableHead>
          <TableHead>{t('tracking.table.descripcion')}</TableHead>
          <TableHead>{t('tracking.table.estado')}</TableHead>
          <TableHead>{t('tracking.table.avance')}</TableHead>
          <TableHead>{t('tracking.table.compromiso')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ordered.length === 0 && <TableEmpty colSpan={5}>{emptyMessage}</TableEmpty>}
        {ordered.map((plan) => {
          const percent = toPercent(plan.porcentajeAvance)
          return (
            <TableRow key={plan.id}>
              <TableCell className="font-mono text-xs tabular-nums">
                <Link to={`/tracking/planes/${plan.id}`} className="text-accent-blue">
                  {plan.planCode}
                </Link>
              </TableCell>
              <TableCell className="max-w-prose">{plan.descripcionQue}</TableCell>
              <TableCell>
                <SemaforoChip estado={plan.estadoSemaforo} />
              </TableCell>
              <TableCell>
                <span className="flex min-w-24 flex-col gap-1">
                  <span className="font-mono text-xs tabular-nums">
                    {t('tracking.table.percent', { percent })}
                  </span>
                  <Progress value={percent} />
                </span>
              </TableCell>
              <TableCell className="font-mono text-xs tabular-nums">
                {planCalendarDay(plan.fechaCompromiso, locale)}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
