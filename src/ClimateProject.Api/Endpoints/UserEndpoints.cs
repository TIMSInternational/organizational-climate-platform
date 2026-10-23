using System.Security.Claims;
using System.Text.RegularExpressions;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Email;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class UserEndpoints
{
    public static void MapUserEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/users").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
        group.MapPut("/{id:guid}/role", UpdateRoleAsync);
    }

    // Takes Guid? rather than Guid because two of the three call sites below pass
    // user.CompanyId, which is nullable since #191. A null target is global scope and is
    // SuperAdmin-only -- see CompanyScope.CanAccess. Callers passing a plain Guid (the
    // companyId query parameter on ListAsync) still bind here via implicit conversion and
    // are completely unaffected.
    private static bool CanAccessCompany(CurrentUser currentUser, Guid? companyId)
        => CompanyScope.CanAccess(currentUser, companyId);

    // The same pattern sign-up and invitation acceptance check an address against
    // (AuthEndpoints.EmailFormatPattern, InvitationAcceptEndpoints.EmailFormatPattern): no
    // whitespace, one '@', a dot in the domain. Both copies are private, hence a third.
    private const string EmailFormatPattern = @"^[^\s@]+@[^\s@]+\.[^\s@]+$";

    // users.email is varchar(255) (UserConfiguration). Refused here rather than left to
    // Postgres, which would answer a longer value with a 500.
    private const int EmailMaxLength = 255;

    // A refusal the screen has to tell apart from the others, so it carries a code as well as
    // the English message every other refusal in this file carries.
    private static IResult EmailRefusal(int statusCode, string code, string message)
        => Results.Json(new { message, code }, statusCode: statusCode);

    /// <summary>
    /// A person whose only key is a per-survey code (<c>survey_credentials</c>): their company
    /// is in <c>per_survey</c> mode and the account has no password of its own. That is the
    /// exact shape a per_survey import mints (<c>BulkImportEndpoints</c>: no username, no
    /// password hash -- "a username and a password hash here would be a second, wider key").
    /// Read from the company's CURRENT mode: the reset this guards mints an account-wide key
    /// now, whatever mode the person's existing surveys froze.
    /// </summary>
    internal static async Task<bool> IsSurveyCodesOnlyAsync(
        ClimateProjectDbContext db, User user, CancellationToken cancellationToken)
    {
        if (user.PasswordHash is not null || user.CompanyId is not { } companyId)
        {
            return false;
        }

        var mode = await db.Companies
            .Where(c => c.Id == companyId)
            .Select(c => c.Settings.CredentialMode)
            .FirstOrDefaultAsync(cancellationToken);
        return mode == CredentialModes.PerSurvey;
    }

    private static UserListItem ToListItem(User u)
        => new(u.Id, u.Email, u.Name, u.Role, u.DepartmentId, u.IsActive, u.LastLoginAt, u.CreatedAt);

    private static UserDetail ToDetail(User u, IReadOnlyDictionary<string, string> demographics)
        => new(u.Id, u.CompanyId, u.Email, u.Name, u.Role, u.DepartmentId, u.ManagerId, u.IsActive, u.LastLoginAt, u.CreatedAt, demographics);

    private static async Task<IResult> ListAsync(
        Guid companyId,
        Guid? departmentId,
        string? role,
        string? demographicField,
        string? demographicValue,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, companyId))
        {
            return Results.Forbid();
        }

        // companyId is a non-nullable parameter, so this translates to a plain
        // `company_id = @p` and NULL rows never match. That is the intended outcome of
        // #191: a company-less super_admin belongs to no tenant, so they must not turn up
        // in any single company's user list.
        var query = db.Users.Where(u => u.CompanyId == companyId);
        if (departmentId.HasValue)
        {
            query = query.Where(u => u.DepartmentId == departmentId.Value);
        }

        if (!string.IsNullOrWhiteSpace(role))
        {
            query = query.Where(u => u.Role == role);
        }

        // The reason #193 exists: with demographics living in a jsonb blob, "show me
        // everyone in this company whose <custom field> is <value>" -- required for
        // every dashboard filter and export in req.md 2.2 -- had no server-side
        // answer. Now it is a join over user_demographics, index-backed by
        // IX_user_demographics_demographic_field_id_value.
        if (!string.IsNullOrWhiteSpace(demographicValue) && string.IsNullOrWhiteSpace(demographicField))
        {
            return Results.Json(new { message = "demographicValue requires demographicField" }, statusCode: 400);
        }

        if (!string.IsNullOrWhiteSpace(demographicField))
        {
            var fieldKey = demographicField.Trim();
            var fieldIds = db.DemographicFields
                .Where(f => f.CompanyId == companyId && f.Field == fieldKey)
                .Select(f => f.Id);

            var matches = db.UserDemographics.Where(d => fieldIds.Contains(d.DemographicFieldId));
            if (!string.IsNullOrWhiteSpace(demographicValue))
            {
                var wanted = demographicValue.Trim();
                matches = matches.Where(d => d.Value == wanted);
            }

            query = query.Where(u => matches.Select(d => d.UserId).Contains(u.Id));
        }

        var users = await query
            .OrderBy(u => u.Name)
            .Select(u => new UserListItem(u.Id, u.Email, u.Name, u.Role, u.DepartmentId, u.IsActive, u.LastLoginAt, u.CreatedAt, u.Username))
            .ToListAsync(cancellationToken);

        return Results.Ok(new UserListResponse(users));
    }

    private static async Task<IResult> GetAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id, cancellationToken);
        if (user is null)
        {
            return Results.Json(new { message = "User not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, user.CompanyId))
        {
            return Results.Forbid();
        }

        var demographics = await DemographicValueStore.LoadForUserAsync(db, user.Id, cancellationToken);
        return Results.Ok(ToDetail(user, demographics) with
        {
            SurveyCodesOnly = await IsSurveyCodesOnlyAsync(db, user, cancellationToken),
        });
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        UpdateUserRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id, cancellationToken);
        if (user is null)
        {
            return Results.Json(new { message = "User not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, user.CompanyId))
        {
            return Results.Forbid();
        }

        // Correcting an address (audit gap G3: ESPH sent a nonexistent address and full
        // mailboxes, and nothing in the product could change one). Decided before anything
        // below writes to the entity, so a refused address leaves the whole request unapplied.
        //
        // Normalised exactly as an import row is -- the parsers Trim() the cell and
        // BulkImportEndpoints lower-cases it -- so an address entered here and the same
        // address imported are the same string, and the global unique index on users.email
        // sees them as one.
        string? newEmail = null;
        if (request.Email is not null)
        {
            var candidate = request.Email.Trim().ToLowerInvariant();
            if (!string.Equals(candidate, user.Email, StringComparison.Ordinal))
            {
                // The IsActive rule below, for the same reason and more: an address is where a
                // password reset and every sign-in detail go, so a company_admin who could
                // re-point a super_admin's -- or a peer admin's -- would own that account.
                if (currentUser.Role != Roles.SuperAdmin && Roles.Admin.Contains(user.Role))
                {
                    return Results.Forbid();
                }

                if (candidate.Length > EmailMaxLength || !Regex.IsMatch(candidate, EmailFormatPattern))
                {
                    return EmailRefusal(400, "email_invalid", "Invalid email format");
                }

                // RFC 2606 / 6761 names: every send path refuses them already, so accepting one
                // here would store an address no message can ever reach.
                if (UndeliverableAddresses.IsUndeliverable(candidate))
                {
                    return EmailRefusal(400, "email_undeliverable", UndeliverableAddresses.ReasonFor(candidate));
                }

                // GLOBAL, like the index it pre-empts (UserConfiguration: HasIndex(Email).IsUnique()
                // with no company in it) and like the bulk importer's own check. Scoping this to
                // the company would only move the refusal to SaveChanges as a bare 409.
                if (await db.Users.AnyAsync(u => u.Email == candidate && u.Id != user.Id, cancellationToken))
                {
                    return EmailRefusal(409, "email_taken", "A user with this email already exists");
                }

                // The importer's second check (BulkImportEndpoints: invitedEmails). An open
                // invitation is a promise of a users row for this address; taking the address
                // here would make that invitation fail at acceptance with a 409 nobody expects.
                var checkedAt = DateTimeOffset.UtcNow;
                if (await db.UserInvitations.AnyAsync(
                        i => i.Email == candidate && i.AcceptedAt == null && i.ExpiresAt > checkedAt,
                        cancellationToken))
                {
                    return EmailRefusal(409, "email_invited", "This email already holds a pending invitation");
                }

                newEmail = candidate;
            }
        }

        // Deactivating an admin-role account (company_admin or super_admin) is a
        // privilege-escalation-adjacent surface: a CompanyAdmin's CompanyId can match a
        // super_admin's (signup assigns CompanyId from email domain), which would let a
        // lower-privileged CompanyAdmin lock out a super_admin -- or another company_admin,
        // including themselves. Only a SuperAdmin may flip IsActive for an admin-role
        // target; general field edits for admin-role users still go through untouched.
        if (request.IsActive.HasValue && currentUser.Role != Roles.SuperAdmin && Roles.Admin.Contains(user.Role))
        {
            return Results.Forbid();
        }

        // Department and manager are org-chart links, and an org chart belongs to a
        // company. A user with no company (a global super_admin, #191) has none, so say so
        // outright instead of falling through to the "must exist in the same company" 400
        // below -- which would be technically true and completely unhelpful.
        if (user.CompanyId is null && (request.DepartmentId.HasValue || request.ManagerId.HasValue))
        {
            return Results.Json(
                new { message = "User has no company; department and manager cannot be assigned" },
                statusCode: 400);
        }

        // "Set it to X" and "remove it" in one request: no order of applying them is what the
        // caller meant, so neither is applied.
        if (request.ClearDepartment && request.DepartmentId.HasValue)
        {
            return Results.Json(
                new { message = "Send either departmentId or clearDepartment, not both" },
                statusCode: 400);
        }

        if (request.ClearManager && request.ManagerId.HasValue)
        {
            return Results.Json(
                new { message = "Send either managerId or clearManager, not both" },
                statusCode: 400);
        }

        // A person reporting to themselves is a loop every org-chart reader (the tracking sync's
        // ManagerId, the subject-access export's "reports") would have to special-case.
        if (request.ManagerId == user.Id)
        {
            return Results.Json(new { message = "A person cannot be their own manager" }, statusCode: 400);
        }

        if (!string.IsNullOrWhiteSpace(request.Name))
        {
            user.Name = request.Name.Trim();
        }

        // Unsetting is the one department edit with no lookup: nothing to validate, and the
        // company-less guard above does not apply (such a user has no department to remove).
        if (request.ClearDepartment)
        {
            user.DepartmentId = null;
        }

        if (request.ClearManager)
        {
            user.ManagerId = null;
        }

        if (request.DepartmentId.HasValue)
        {
            var department = await db.Departments.FirstOrDefaultAsync(d => d.Id == request.DepartmentId.Value, cancellationToken);
            if (department is null || department.CompanyId != user.CompanyId)
            {
                return Results.Json(new { message = "Department must exist in the same company" }, statusCode: 400);
            }

            user.DepartmentId = request.DepartmentId.Value;
        }

        if (request.ManagerId.HasValue)
        {
            var manager = await db.Users.FirstOrDefaultAsync(m => m.Id == request.ManagerId.Value, cancellationToken);
            if (manager is null || manager.CompanyId != user.CompanyId)
            {
                return Results.Json(new { message = "Manager must exist in the same company" }, statusCode: 400);
            }

            user.ManagerId = request.ManagerId.Value;
        }

        if (request.IsActive.HasValue)
        {
            // Deactivating has to end the sessions the account already has, not just refuse
            // it new ones (#286). Tokens here are stateless HS256 valid for their whole lifetime and
            // #280's policy reads the isActive claim minted INTO the token, so flipping this
            // column alone left the deactivated user's browser working for up to a day --
            // which is the whole window an offboarding exists to close. Rotating the stamp
            // closes it: SecurityStampValidation compares this column against every presented
            // token during authentication, so the next request on any token minted before
            // this save is a 401. Same rotation, same reason, as the two password paths #284
            // named.
            //
            // Keyed on what the save ASKS FOR -- isActive: false -- and not on a true -> false
            // transition. Both halves of that are load-bearing.
            //
            // Not unconditional, because the admin edit dialog sends { name, isActive } on
            // EVERY save (web/src/features/org-structure/pages/UsersListPage.tsx): rotating
            // whenever isActive is merely present would sign an ACTIVE user out every time an
            // administrator corrected a typo in their name -- a revocation with no
            // deactivation behind it. Those saves carry isActive: true, so they miss this
            // branch. Reactivating misses it too and needs no rotation of its own: every token
            // from before the deactivation died at that rotation and cannot come back.
            //
            // Not the transition either, because "deactivate this person" has to work on a row
            // that already reads inactive. That state is reachable and not hypothetical: this
            // ships to a database whose existing inactive rows were deactivated by the code
            // this change replaces and never had their stamps rotated, so their holders' tokens
            // are live right now. Re-deactivating is the exact remediation an administrator
            // reaches for on noticing somebody still has access, and under a transition guard
            // it would return 200 and do nothing. The cost is a stamp rotated on every edit of
            // an already-inactive user; for a row deactivated by THIS code that rotation finds
            // no session left to end, and for the legacy rows above it is not a cost at all --
            // it ends the very sessions the transition guard would have left alive.
            //
            // The one session this can end mid-task is a super admin deactivating their own
            // account: no other role may (the guard above), and it is the honest outcome of
            // the request they made.
            if (!request.IsActive.Value)
            {
                user.SecurityStamp = Guid.NewGuid();
            }

            user.IsActive = request.IsActive.Value;
        }

        var now = DateTimeOffset.UtcNow;
        IReadOnlyDictionary<string, string> demographics;

        if (request.Demographics is null)
        {
            // Omitted entirely: leave the existing answers untouched, just echo them.
            demographics = await DemographicValueStore.LoadForUserAsync(db, user.Id, cancellationToken);
        }
        else if (user.CompanyId is not { } demographicsCompanyId)
        {
            // Demographic fields are defined per company, so a user with no company (#191)
            // has no field set to answer. Without this the load below would return an empty
            // definition set and validation would reject every submitted key as an unknown
            // field -- a confusing way to say "this user cannot have demographics at all".
            // Nothing has been persisted at this point: SaveChangesAsync is only called at
            // the end of the method.
            return Results.Json(
                new { message = "User has no company; demographics cannot be assigned" },
                statusCode: 400);
        }
        else
        {
            var definitions = await DemographicValueStore.LoadDefinitionsAsync(db, demographicsCompanyId, cancellationToken);
            var validation = DemographicValueValidation.Validate(request.Demographics, definitions, enforceRequired: true);
            if (!validation.IsValid)
            {
                return Results.Json(new { message = string.Join("; ", validation.Errors) }, statusCode: 400);
            }

            // An answer to a RETIRED field cannot be submitted (validation refuses an inactive
            // field), so a full replace would delete it as "omitted" -- an edit screen, which only
            // offers the active fields, would silently erase what the person answered under a
            // field the company has since switched off, and the segment it fed. Those answers are
            // not part of what this request can say, so they are carried through unchanged.
            var retiredFieldIds = definitions.Where(d => !d.IsActive).Select(d => d.Id).ToList();
            List<ResolvedDemographicValue> retiredAnswers = retiredFieldIds.Count == 0
                ? []
                : (await db.UserDemographics
                        .Where(d => d.UserId == user.Id && retiredFieldIds.Contains(d.DemographicFieldId))
                        .Select(d => new { d.DemographicFieldId, d.Value })
                        .ToListAsync(cancellationToken))
                    .Select(d => new ResolvedDemographicValue(
                        d.DemographicFieldId,
                        definitions.First(f => f.Id == d.DemographicFieldId).Field,
                        d.Value))
                    .ToList();
            var kept = validation.Values.Concat(retiredAnswers).ToList();

            await DemographicValueStore.ReplaceForUserAsync(db, user.Id, kept, now, cancellationToken);
            demographics = DemographicValueStore.ToMap(kept);
        }

        UserEmailChange? emailChange = null;
        if (newEmail is not null)
        {
            var previousEmail = user.Email;
            user.Email = newEmail;

            // A token carries the address it was minted with (the "email" claim, CurrentUser),
            // and several handlers still find the acting user by it (InvitationEndpoints,
            // ActionPlanEndpoints, MicroclimateEndpoints, SurveyEndpoints ...). A session that
            // outlived this change would resolve to nobody -- or, once someone else is given the
            // freed address, to THAT person. Rotating the stamp ends every session minted before
            // this save (SecurityStampValidation), the same rotation deactivation uses above.
            // Mass-invite and per-survey respondents sign in by USERNAME, which this does not
            // touch, so their sign-in details keep working; they only sign in again.
            user.SecurityStamp = Guid.NewGuid();

            // Pending ACCOUNT invitations to the old address. While this user held it, accepting
            // one was a 409 (InvitationAcceptEndpoints: "A user with this email already exists").
            // Freed, it would succeed and create a second person under the address the admin
            // just said was wrong. Expired rather than deleted: the row is the record that it
            // was sent.
            var orphaned = await db.UserInvitations
                .Where(i => i.Email == previousEmail && i.AcceptedAt == null && i.ExpiresAt > now)
                .ToListAsync(cancellationToken);
            foreach (var invitation in orphaned)
            {
                invitation.ExpiresAt = now;
            }

            // Deliberately left alone: survey_invitations.email and microclimate_invitations.email.
            // Those are the address a message was SENT to; rewriting them would make a "sent" row
            // claim delivery to an address that never received anything. Every send path reads
            // users.email at send time (NotificationRecipient.From, MassInviteEndpoints,
            // SurveyDistributionEndpoints), so future mail goes to the new address regardless.
            //
            // Codes already mailed to the old address and never used: counted, NOT re-sent. This
            // request sends no email at all; the screen points the admin at each survey's roster.
            var unusedSurveyCodes = await db.SurveyCredentials
                .Where(c => c.UserId == user.Id && c.LastSignInAt == null)
                .Join(
                    db.Surveys.Where(s => s.Status == SurveyStatuses.Scheduled || s.Status == SurveyStatuses.Active),
                    c => c.SurveyId,
                    s => s.Id,
                    (c, _) => c)
                .CountAsync(cancellationToken);

            emailChange = new UserEmailChange(previousEmail, unusedSurveyCodes, orphaned.Count);
        }

        user.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);

        // After the save, as DepartmentEndpoints does: a request that failed on the way out
        // records no change it did not make. An address is not a secret, and every admin who
        // can read this tenant's trail can already read the users list it came from.
        if (emailChange is not null)
        {
            audit.SetResourceId(user.Id);
            audit.RecordChange("email", emailChange.PreviousEmail, user.Email);
        }

        return Results.Ok(ToDetail(user, demographics) with { EmailChange = emailChange });
    }

    private static async Task<IResult> UpdateRoleAsync(
        Guid id,
        UpdateUserRoleRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        if (!Roles.All.Contains(request.Role))
        {
            return Results.Json(new { message = "Invalid role" }, statusCode: 400);
        }

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id, cancellationToken);
        if (user is null)
        {
            return Results.Json(new { message = "User not found" }, statusCode: 404);
        }

        // A company-less user (#191) may only hold super_admin. Every other role is
        // tenant-scoped, and demoting a global super_admin in place would mint the one
        // combination the codebase is not written for: a company_admin whose companyId
        // claim is blank. BenchmarkEndpoints.ListAsync would then hit
        // `Guid.Parse(currentUser.CompanyId)` -- safe today only because the SuperAdmin
        // branch short-circuits before it -- and throw a 500. Blocking it here closes the
        // hole at its only source rather than patching each downstream reader.
        if (user.CompanyId is null && request.Role != Roles.SuperAdmin)
        {
            return Results.Json(
                new { message = "User has no company; only super_admin is valid without one" },
                statusCode: 400);
        }

        user.Role = request.Role;
        user.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        var demographics = await DemographicValueStore.LoadForUserAsync(db, user.Id, cancellationToken);
        return Results.Ok(ToDetail(user, demographics));
    }
}
