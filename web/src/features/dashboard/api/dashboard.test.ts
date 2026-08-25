import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  NO_DEPARTMENT_MESSAGE,
  NO_USER_RECORD_MESSAGE,
  getCompanyAdminDashboard,
  getDepartmentAdminDashboard,
  getEmployeeDashboard,
  getSuperAdminDashboard,
} from './dashboard'

const baseUrl = 'http://api.test'

function empty(): Response {
  return new Response(JSON.stringify({}), { status: 200 })
}

/**
 * These assert the **URL**, which is the whole contract this module has.
 *
 * A dashboard client that sends the wrong query string does not fail loudly — the server
 * answers something, and the page draws it. The two shapes worth pinning are therefore the
 * ones a reader would most reasonably get wrong: that the department dashboard sends no
 * department id for the role it is normally used by, and that an omitted `companyId`
 * really is omitted rather than serialised as `undefined`.
 */
describe('dashboard api client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks for the platform overview with no parameters at all', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(empty())
    await getSuperAdminDashboard(baseUrl)
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/dashboard/super-admin`, expect.anything())
  })

  it('omits companyId entirely when the caller has none to send', async () => {
    // Not `?companyId=undefined`. The server reads that as a malformed Guid and
    // answers 400, so a template-literal client would break the CompanyAdmin case --
    // the one where the scope is deliberately the server's to decide.
    vi.mocked(fetch).mockResolvedValueOnce(empty())
    await getCompanyAdminDashboard(baseUrl, { lang: 'en' })
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/dashboard/company-admin?lang=en`, expect.anything())
  })

  it('sends companyId when a SuperAdmin has named a tenant', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(empty())
    await getCompanyAdminDashboard(baseUrl, { companyId: 'c1', lang: 'es' })
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/dashboard/company-admin?companyId=c1&lang=es`,
      expect.anything(),
    )
  })

  it('sends no departmentId for a leader, whose department the server reads from their own row', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(empty())
    await getDepartmentAdminDashboard(baseUrl, { lang: 'en' })
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/dashboard/department-admin?lang=en`,
      expect.anything(),
    )
  })

  it('sends the locale on the employee dashboard, because survey titles are authored content', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(empty())
    await getEmployeeDashboard(baseUrl, 'es')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/dashboard/employee?lang=es`, expect.anything())
  })

  it('surfaces the server message when a request is refused', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'companyId is required' }), { status: 400 }),
    )
    await expect(getCompanyAdminDashboard(baseUrl)).rejects.toThrow('companyId is required')
  })

  /**
   * The department dashboard's second legitimate answer (#138).
   *
   * `/dashboard` is where every role lands after login, so a `leader` or `supervisor`
   * whose user row has no `department_id` used to have their first screen after signing in
   * be the raw English 400 body over a Retry that could never work. It is a result here,
   * not a throw, so the caller has to draw something for it.
   */
  describe('a caller with no department', () => {
    it('is a result rather than an error', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ message: NO_DEPARTMENT_MESSAGE }), { status: 400 }),
      )
      await expect(getDepartmentAdminDashboard(baseUrl)).resolves.toEqual({ kind: 'no-department' })
    })

    /**
     * The two 400s are two different people, and this client used to read them as one.
     *
     * `ActingUserRequired()` means the token resolved to no user row — an orphaned
     * account, not a missing team — and `allowStatus: [400]` folded it into
     * `no-department`, so the view drew "you have no department yet" over a red panel
     * carrying this very string, because `EmployeeAsync` resolves the same row and returns
     * the same 400.
     */
    it('tells the orphaned account apart from the one with no team', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ message: NO_USER_RECORD_MESSAGE }), { status: 400 }),
      )
      await expect(getDepartmentAdminDashboard(baseUrl)).resolves.toEqual({ kind: 'no-user-record' })
    })

    /**
     * Both literals, against the C# that sends them.
     *
     * Matching on a server's English prose is only safe if the match is pinned to the
     * source of that prose — otherwise a reword downstream turns a screen into a silent
     * lie. Same technique `roleCapabilities.test.ts` uses on `Roles.cs`: read the file,
     * fail here rather than in production.
     */
    it('matches on the exact strings the endpoints send', () => {
      const dashboards = readFileSync(
        join(process.cwd(), '..', 'src', 'ClimateProject.Api', 'Endpoints', 'DashboardEndpoints.cs'),
        'utf8',
      )
      const surveys = readFileSync(
        join(process.cwd(), '..', 'src', 'ClimateProject.Api', 'Endpoints', 'SurveyEndpoints.cs'),
        'utf8',
      )
      expect(dashboards).toContain(`"${NO_DEPARTMENT_MESSAGE}"`)
      // Sent by `SurveyEndpoints.ActingUserRequired()`, which `DashboardEndpoints` calls.
      expect(surveys).toContain(`"${NO_USER_RECORD_MESSAGE}"`)
      expect(dashboards).toContain('SurveyEndpoints.ActingUserRequired()')
    })

    /**
     * The third 400 branch — `DepartmentIdRequired`, which only an admin role passing no
     * `departmentId` provokes — has no screen, so it stays an error carrying the server's
     * own words rather than being dressed up as an empty team.
     */
    it('does not invent a cause for a 400 it has no screen for', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'departmentId is required' }), { status: 400 }),
      )
      await expect(getDepartmentAdminDashboard(baseUrl)).rejects.toThrow('departmentId is required')
    })

    /**
     * The fold was `allowStatus: [400]` and nothing pinned its width: review widened it to
     * `[400, 404, 500]` and the suite stayed green, which would have drawn "you have no
     * team" over a missing department and over a crashed server alike.
     */
    it.each([404, 500])('reports a %s as the failure it is', async (status) => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status }))
      await expect(getDepartmentAdminDashboard(baseUrl)).rejects.toThrow(`Request failed: ${status}`)
    })

    it('does not swallow a 403, which would be a wiring bug rather than an empty team', async () => {
      // A role that reached this endpoint and should not have. Folding it in would hide
      // the dispatch being wrong behind a page that looks merely quiet.
      vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 403 }))
      await expect(getDepartmentAdminDashboard(baseUrl)).rejects.toThrow('Request failed: 403')
    })

    it('still hands back the dashboard on a 200', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ departmentName: 'Ingeniería', memberCount: 7 }), {
          status: 200,
        }),
      )
      const result = await getDepartmentAdminDashboard(baseUrl)
      expect(result.kind).toBe('department')
      expect(result.kind === 'department' && result.dashboard.departmentName).toBe('Ingeniería')
    })
  })
})
