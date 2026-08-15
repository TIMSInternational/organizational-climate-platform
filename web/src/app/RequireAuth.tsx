import { Navigate, Outlet } from 'react-router'
import { getToken } from '../auth/token'
import { decodeJwtPayload } from '../auth/jwt'

/**
 * The auth gate on every admin route.
 *
 * ## The deactivated-account branch (#81), and why no token this API mints
 * reaches it any more
 *
 * It was written for a session that outlived its account: `UserEndpoints`
 * flipped `IsActive` and the JWT kept working until it expired, so without a
 * branch here the app rendered its whole shell and failed one panel at a time
 * with no single place saying why.
 *
 * Two server changes closed that from both ends. #280 made
 * `AuthEndpoints.IssueTokenForAsync` — the single mint site — refuse to issue a
 * token for an inactive account at all, so this API cannot produce
 * `isActive: "false"`; and #286 made deactivation rotate the user's security
 * stamp, so a token minted *before* the deactivation is refused with a 401 and
 * `authFetch` takes that session to `/login`. Between them, a deactivated user
 * now lands on the login page rather than on `/auth/inactive`.
 *
 * The branch stays because the claim is not this API's alone to mint —
 * `TrackingJwtSecret` is shared with the legacy climate-tracking application —
 * and because a client-side gate that trusts a claim it stopped checking is a
 * worse thing to leave behind than a branch that rarely fires. Do not describe
 * `/auth/inactive` as the destination of a deactivated session anywhere.
 *
 * **`isActive` is a string.** `JwtTokenService` emits
 * `new("isActive", claims.IsActive ? "true" : "false")`, so the claim is `"true"`
 * or `"false"`, never a boolean. `!claims.isActive` is `false` for the string
 * `"false"` and would let a deactivated session straight through — the comparison
 * has to be against the string, and it is written as an explicit `=== 'false'`
 * rather than `!== 'true'` so a token minted before the claim existed (absent,
 * not `"false"`) is treated as active rather than locked out.
 *
 * This is deliberately not checked at login: `LoginAsync` filters on
 * `u.IsActive`, so a deactivated user gets 401 "Invalid email or password",
 * identical to a wrong password. That identical response is what stops the login
 * form confirming an address exists, and this gate does not undo it — it only
 * ever fires for someone who already holds a token for the account.
 */
export default function RequireAuth() {
  const token = getToken()
  if (!token) {
    return <Navigate to="/login" replace />
  }

  const claims = decodeJwtPayload(token)
  if (claims?.isActive === 'false') {
    return <Navigate to="/auth/inactive" replace />
  }

  return <Outlet />
}
