/**
 * Whether the signed-in person's own name may appear in the application shell.
 *
 * Ruled 2026-10-16 by Federico, for the ESPH launch: a respondent is never shown their own
 * name on the portal. The copy §6 of `docs/decisions/who-may-see-an-individual-answer.md`
 * shipped tells all 640 of them that *"su empresa nunca verá su nombre junto a ellas"*, and a
 * portal that greets them by name while saying so is chrome arguing with its own promise. The
 * respondent cannot tell, from the outside, that the name in the rail came from their own
 * token rather than from a list somebody is holding.
 *
 * **Administrators keep theirs.** The same ruling deliberately left the Distribución roster
 * with ESPH's own administrators: with a seven-day window and 467 of the 640 addresses behind
 * a corporate mail filter that has never accepted mail from this platform, somebody has to be
 * able to chase a non-responder. Taking the name out of an administrator's rail would hide
 * nothing that administrator cannot already read on the next screen.
 *
 * ## It fails closed
 *
 * A role this set does not recognise — and a caller with no role claim at all — is treated as
 * a respondent. The two directions do not cost the same: being wrong towards silence yields a
 * rail that says "Mi cuenta", while being wrong towards the name puts one in front of
 * somebody who was promised it would not be there.
 *
 * ## Why it is one exported rule and not a condition in each shell
 *
 * There are two shells and they are not interchangeable: `SidebarUserMenu` is the desktop
 * rail and `ShellControls` is the mobile drawer, which is what most of ESPH's 640 people will
 * actually see. Copying the condition into both is how one of them keeps the name after an
 * edit to the other — the failure `docs/audits/` records as "one rule, two guards, only one
 * sweeps". One rule, one test, both callers.
 */
export const ROLES_SHOWN_THEIR_OWN_NAME: ReadonlySet<string> = new Set([
  'super_admin',
  'company_admin',
])

/** True only for a role on the list above. `undefined` is a respondent. */
export function showsOwnName(role: string | undefined): boolean {
  return role !== undefined && ROLES_SHOWN_THEIR_OWN_NAME.has(role)
}
