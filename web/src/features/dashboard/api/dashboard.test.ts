import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import {
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
        new Response(
          JSON.stringify({ message: 'The authenticated user is not assigned to a department' }),
          { status: 400 },
        ),
      )
      await expect(getDepartmentAdminDashboard(baseUrl)).resolves.toEqual({ kind: 'no-department' })
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
