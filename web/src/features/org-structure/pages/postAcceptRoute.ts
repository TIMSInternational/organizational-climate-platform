// Where to send a newly-created user right after they accept an invitation or
// sign up.
//
// CompanyEndpoints.ListAsync (GET /admin/companies) is Roles.SuperAdmin-only, so
// unconditionally navigating to /admin/companies -- as this page used to -- 403s for
// every employee/supervisor/leader/company_admin created by an invitation (i.e.
// everyone this endpoint exists to onboard).
//
// employee / supervisor / leader used to return null, because at the time there
// genuinely was no page any of them could load. #109 changed that: `/surveys/my`
// resolves the CALLER'S OWN user row and filters by that row's company and
// department, reading no role claim at all, so all three roles load it and get a
// real page rather than an empty one. `navSections.ts` already offers it to them
// as their primary destination (MY_SURVEYS_ITEM), so this now agrees with the nav
// instead of contradicting it.
//
// The `null` return is kept for the one case that is still genuinely
// destination-less -- no companyId at all -- because `/surveys/my` scopes by the
// caller's company and a user without one has nothing to be shown. Callers show
// an inline success message instead of navigating when it returns null.
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
    case 'employee':
    case 'supervisor':
    case 'leader':
      // #109. Authorized per user, not per role -- see the block above.
      return '/surveys/my'
    default:
      // An unknown role: no claim about what it can load, so no destination.
      return null
  }
}
