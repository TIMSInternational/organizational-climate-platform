/**
 * Whether the product offers to invite people to a microclimate.
 *
 * **Ruled 2026-10-13 ("mode 3"): it does not.** A microclimate is answered from its QR
 * or its link, which asks nothing at all — no account, no name, no email, no
 * demographics — and that is now the only way in.
 *
 * ## Why a flag and not a deletion
 *
 * Nothing is removed. `MicroclimateInvitation`, its EF configuration,
 * `MapMicroclimateInvitationEndpoints()` at `Program.cs:673`, the token routes under
 * `/microclimate-invitations/{token}` and `MicroclimateInvitationLinks`/`Statuses`/`Tokens`
 * all stay exactly as they are. So:
 *
 * - an invitation that has already been sent still resolves, and the person holding it can
 *   still answer — revoking that by deleting endpoints would strand mail already in
 *   somebody's inbox;
 * - the detail board still LISTS the invitations a microclimate already has, and only hides
 *   the card once it knows there are none;
 * - the ruling is one line to revert, and reverting it moves every surface at once.
 *
 * Deleting the entity and its endpoints is a separate, irreversible decision — it needs a
 * migration to drop the table, and the invitation rows go with it. It was considered on
 * 2026-10-13 and deliberately not taken.
 *
 * Annotated `boolean` rather than left to infer `false`: as a literal type every guard
 * reading it becomes a constant expression, which is noise the linter is right to report
 * and which would make the revert a type change rather than a value change.
 */
export const MICROCLIMATE_INVITATIONS_OFFERED: boolean = false
