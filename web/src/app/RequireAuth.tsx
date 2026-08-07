import { Navigate, Outlet } from 'react-router'
import { getToken } from '../auth/token'
import { decodeJwtPayload } from '../auth/jwt'

/**
 * The auth gate on every admin route.
 *
 * ## The deactivated-account branch (#81)
 *
 * A user can be deactivated *while holding a valid token* — `UserEndpoints`
 * flips `IsActive` and the JWT keeps working until it expires. Every request
 * that token then makes is refused, so without this branch the app renders its
 * whole shell and fails one panel at a time, with no single place saying why.
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
