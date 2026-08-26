import { resolveInitialRoute } from '../../../app/resolveInitialRoute'

// Where to send a newly-created user right after they accept an invitation or
// sign up.
//
// CompanyEndpoints.ListAsync (GET /admin/companies) is Roles.SuperAdmin-only, so
// unconditionally navigating to /admin/companies -- as this page used to -- 403s for
// every employee/supervisor/leader/company_admin created by an invitation (i.e.
// everyone this endpoint exists to onboard).
//
// ## The default branch is a destination now, not `null` (#138)
//
// employee / supervisor / leader used to return null, because at the time there
// genuinely was no page any of them could load. #109 changed that to `/surveys/my`.
// #138 changes it again, to whatever `resolveInitialRoute` says -- `/dashboard` --
// for two reasons:
//
//   - "Where does a signed-in person start" now has ONE answer instead of two.
//     Accepting an invitation put a user on a list page while logging in the next
//     morning put them on a summary; nothing justified the difference, and the
//     summary is the better first screen.
//   - It is the only destination that is safe for a role this module has never
//     heard of. `DashboardPage` dispatches on the role claim and falls through to
//     the per-user employee view, whose endpoint reads no role claim at all -- so
//     the `default` case can finally answer instead of refusing to guess. Before
//     this, an invitation minted with a role string this client did not recognise
//     ended on "your account was created" and no way forward.
//
// The two admin roles keep the destinations they had. Their landing pages are their
// own administration surface, they are reached from a nav row either way, and
// changing them would be churn this issue has no reason for.
//
// The `null` return survives for the one case that is still genuinely
// destination-less -- no companyId at all. `AcceptInvitationPage` shows an inline
// success message instead of navigating when it returns null.
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
      // employee / supervisor / leader, and any role string this client does not
      // recognise. All four land on the same page every signed-in user lands on.
      return resolveInitialRoute()
  }
}
