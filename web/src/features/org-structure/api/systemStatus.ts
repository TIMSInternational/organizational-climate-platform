import { authFetch } from '../../../api/authFetch'

/**
 * `GET /admin/system/status` — the SuperAdmin operational view (#147, #275).
 *
 * Mirrors `SystemStatusDtos.cs`. Every status field is a machine token from
 * `SystemStatuses` / `SystemComponentStatuses`, never prose: the API deliberately emits no
 * user-facing English or Spanish, so these are translated on this side.
 */

/** `ok` | `degraded` | `unhealthy`. */
export type SystemAggregateStatus = 'ok' | 'degraded' | 'unhealthy'

/** Component tokens. `failing` and `stale` are the job-level ones (#275). */
export type SystemComponentStatus =
  | 'ok'
  | 'slow'
  | 'timeout'
  | 'unreachable'
  | 'backlog'
  | 'never-run'
  | 'stale'
  | 'failing'
  | 'unknown'

export interface SystemBuildStatus {
  commit: string
  builtAt: string
  runtime: string
}

export interface SystemDatabaseStatus {
  status: SystemComponentStatus
  latencyMs: number
  port: number
  /** #220: true means the runtime is pointed at Supavisor's transaction pooler. */
  usesTransactionPoolerPort: boolean
  maxPoolSize: number
  maxPoolSizeDefaulted: boolean
}

export interface SystemNotificationQueueStatus {
  status: SystemComponentStatus
  pending: number
  due: number
  deadLettered: number
  oldestDueAgeSeconds: number | null
}

export interface SystemDispatcherStatus {
  status: SystemComponentStatus
  lastDispatchAt: string | null
}

/**
 * One scheduled job's heartbeat.
 *
 * `consecutiveFailures` is reported alongside `status` rather than folded into it, because
 * "succeeding again after three failures" and "succeeding, never failed" are operationally
 * different and only the count distinguishes them.
 */
export interface SystemJobStatus {
  jobName: string
  intervalSeconds: number
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  consecutiveFailures: number
  status: SystemComponentStatus
}

export interface SystemStatusResponse {
  service: string
  status: SystemAggregateStatus
  checkedAt: string
  environment: string
  build: SystemBuildStatus
  database: SystemDatabaseStatus
  notificationQueue: SystemNotificationQueueStatus
  dispatcher: SystemDispatcherStatus
  jobs: SystemJobStatus[]
}

/**
 * Reads the status.
 *
 * `allowStatus: [503]` because this endpoint answers 503 when the aggregate verdict is
 * `unhealthy` — and that is the *answer*, carrying the full payload, not the absence of
 * one. Letting `authFetch` throw would discard exactly the state an operator opened the
 * page to see, and would render "the database is hanging" as a generic request failure.
 * Same reason the draft autosave opts 409 in (#266).
 */
export async function getSystemStatus(baseUrl: string): Promise<SystemStatusResponse> {
  const response = await authFetch(`${baseUrl}/admin/system/status`, {}, { allowStatus: [503] })
  return (await response.json()) as SystemStatusResponse
}
