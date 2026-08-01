// Where to send a newly-created user right after they accept an invitation.
//
// CompanyEndpoints.ListAsync (GET /admin/companies) is Roles.SuperAdmin-only, so
// unconditionally navigating to /admin/companies -- as this page used to -- 403s for
// every employee/supervisor/leader/company_admin created by an invitation (i.e.
// everyone this endpoint exists to onboard). There is currently no dashboard page for
// non-admin roles, so this only returns a route when one exists that the new user can
// actually load; callers should show an inline success message instead of navigating
// when it returns null.
export function resolvePostAcceptRoute(role: string | undefined, companyId: string | undefined): string | null {
  if (!companyId) {
    return null
  }

  switch (role) {
    case 'super_admin':
      return '/admin/companies'
    case 'company_admin':
      // UserEndpoints.CanAccessCompany allows a company_admin to read their own
      // company's user list, unlike the SuperAdmin-only companies list.
      return `/admin/companies/${companyId}/users`
    default:
      // employee / supervisor / leader: no page they can load yet.
      return null
  }
}
