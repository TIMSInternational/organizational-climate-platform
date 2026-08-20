using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Email;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class InvitationEndpoints
{
    // Internal: bulk import mints the same invitation and must expire it on the same clock.
    internal static readonly TimeSpan InvitationLifetime = TimeSpan.FromDays(7);

    public static void MapInvitationEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/invitations").RequireAuthorization();

        group.MapPost("", CreateAsync);
        group.MapPost("/shareable-link", CreateShareableLinkAsync);
        group.MapPost("/{id:guid}/resend", ResendAsync);
        group.MapGet("", ListAsync);
    }

    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());

    private static InvitationDetail ToDetail(UserInvitation i, IReadOnlyDictionary<string, string> demographics)
        => new(i.Id, i.Email, i.CompanyId, i.DepartmentId, i.InvitationType, i.Role, i.Status,
               i.InvitationToken, i.ExpiresAt, i.SentAt, i.AcceptedAt, i.ReminderCount, demographics);

    // UserInvitation.InvitedBy is a FK to Users.Id (a Guid) -- it is NOT the JWT's `sub`
    // claim. Task 1 changes `sub` to prefer PersonaExternalId (an arbitrary legacy string,
    // not necessarily a Guid) once that backfill runs, so parsing currentUser.Sub as a Guid
    // here would silently break for any user with a populated PersonaExternalId. Resolve
    // the acting user's real Id via their (unique, stable) email instead.
    /// <summary>
    /// Internal rather than private because bulk import mints the same kind of invitation and
    /// must stamp the same `invited_by`. One definition, so the two paths cannot drift.
    /// </summary>
    internal static async Task<Guid> ResolveActingUserIdAsync(CurrentUser currentUser, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var actingUser = await db.Users.FirstOrDefaultAsync(u => u.Email == currentUser.Email, cancellationToken);
        return actingUser?.Id ?? Guid.Empty;
    }

    private static async Task<IResult> CreateAsync(
        CreateInvitationRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        IInvitationEmailSender emailSender,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();

        string role;
        if (request.InvitationType == InvitationValidation.TypeCompanyAdminSetup)
        {
            if (currentUser.Role != Roles.SuperAdmin)
            {
                return Results.Forbid();
            }

            role = Roles.CompanyAdmin;
        }
        else if (request.InvitationType == InvitationValidation.TypeEmployeeDirect)
        {
            if (!Roles.Admin.Contains(currentUser.Role) || !CanAccessCompany(currentUser, request.CompanyId))
            {
                return Results.Forbid();
            }

            // company_admin creation is reserved for the company_admin_setup branch above
            // (SuperAdmin-only). Without excluding it here, any CompanyAdmin could mint a
            // peer company_admin account via an employee_direct invitation and bypass the
            // "role changes are SuperAdmin-only" rule -- the same privilege-escalation
            // surface PUT /admin/users/{id}/role guards against.
            if (request.Role == Roles.SuperAdmin || request.Role == Roles.CompanyAdmin || !Roles.All.Contains(request.Role))
            {
                return Results.Json(new { message = "Invalid role for an employee invitation" }, statusCode: 400);
            }

            role = request.Role;
        }
        else
        {
            return Results.Json(new { message = "Invalid invitation type" }, statusCode: 400);
        }

        if (string.IsNullOrWhiteSpace(request.Email))
        {
            return Results.Json(new { message = "Email is required" }, statusCode: 400);
        }

        if (request.DepartmentId.HasValue)
        {
            var department = await db.Departments.FirstOrDefaultAsync(d => d.Id == request.DepartmentId.Value, cancellationToken);
            if (department is null || department.CompanyId != request.CompanyId)
            {
                return Results.Json(new { message = "Department must exist in the same company" }, statusCode: 400);
            }
        }

        // Demographics are pre-assigned here, not at acceptance: the roster upload
        // that produces these invitations already carries them. Validating at this
        // point is the whole reason #193 drops user_invitations.demographics too --
        // an unvalidated blob here would just defer the failure to acceptance, by
        // which time nobody is looking at the CSV any more.
        var invitationDefinitions = await DemographicValueStore.LoadDefinitionsAsync(db, request.CompanyId, cancellationToken);
        var invitationDemographics = DemographicValueValidation.Validate(request.Demographics, invitationDefinitions, enforceRequired: false);
        if (!invitationDemographics.IsValid)
        {
            return Results.Json(new { message = string.Join("; ", invitationDemographics.Errors) }, statusCode: 400);
        }

        var now = DateTimeOffset.UtcNow;
        var invitedBy = await ResolveActingUserIdAsync(currentUser, db, cancellationToken);
        var invitation = new UserInvitation
        {
            Id = Guid.NewGuid(),
            Email = request.Email.ToLowerInvariant(),
            CompanyId = request.CompanyId,
            DepartmentId = request.DepartmentId,
            InvitedBy = invitedBy,
            InvitationToken = Guid.NewGuid().ToString("N"),
            InvitationType = request.InvitationType,
            Role = role,
            Status = InvitationValidation.StatusPending,
            ExpiresAt = now.Add(InvitationLifetime),
            ReminderCount = 0,
        };

        db.UserInvitations.Add(invitation);
        DemographicValueStore.AddForInvitation(db, invitation.Id, invitationDemographics.Values);

        // Committed before the mail goes out (#100). Under the logging stub the order did not
        // matter; with a real provider it does, in one direction only -- mailing first and
        // saving second can put a token in someone's inbox that no row ever backed, and a
        // recipient clicking a link that 404s cannot tell that from an invitation that was
        // never sent. Saving first can only produce the opposite: a committed invitation whose
        // mail failed, which is logged and is exactly what POST /invitations/{id}/resend is for.
        await db.SaveChangesAsync(cancellationToken);

        // `sent` is recorded only when a send actually happened. It used to be written above,
        // before this method even called the sender, so an invitation that could not be
        // emailed still claimed delivery -- and the users screen rendered it as "Sent" /
        // "Enviada". Production has run with no mail provider since it went live, so that was
        // every invitation ever created.
        //
        // A failed send leaves the row `pending`, which is what it already was and what the
        // screen already renders. `POST /invitations/{id}/resend` is the retry. No new status
        // and no migration: the honest state existed all along.
        await RecordDeliveryAsync(db, emailSender, invitation, now, cancellationToken);

        return Results.Json(ToDetail(invitation, DemographicValueStore.ToMap(invitationDemographics.Values)), statusCode: 201);
    }

    private static async Task<IResult> CreateShareableLinkAsync(
        CreateShareableLinkRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        IInvitationEmailSender emailSender,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role) || !CanAccessCompany(currentUser, request.CompanyId))
        {
            return Results.Forbid();
        }

        // Same exclusion as CreateAsync's employee_direct branch: a shareable link must
        // never mint a company_admin (or super_admin) account, or any CompanyAdmin could
        // generate a self-service link for peer-admin privilege escalation.
        if (request.Role == Roles.SuperAdmin || request.Role == Roles.CompanyAdmin || !Roles.All.Contains(request.Role))
        {
            return Results.Json(new { message = "Invalid role for a shareable link" }, statusCode: 400);
        }

        if (request.DepartmentId.HasValue)
        {
            var department = await db.Departments.FirstOrDefaultAsync(d => d.Id == request.DepartmentId.Value, cancellationToken);
            if (department is null || department.CompanyId != request.CompanyId)
            {
                return Results.Json(new { message = "Department must exist in the same company" }, statusCode: 400);
            }
        }

        var linkDefinitions = await DemographicValueStore.LoadDefinitionsAsync(db, request.CompanyId, cancellationToken);
        var linkDemographics = DemographicValueValidation.Validate(request.Demographics, linkDefinitions, enforceRequired: false);
        if (!linkDemographics.IsValid)
        {
            return Results.Json(new { message = string.Join("; ", linkDemographics.Errors) }, statusCode: 400);
        }

        var now = DateTimeOffset.UtcNow;
        var invitedBy = await ResolveActingUserIdAsync(currentUser, db, cancellationToken);
        var invitation = new UserInvitation
        {
            Id = Guid.NewGuid(),
            Email = null,
            CompanyId = request.CompanyId,
            DepartmentId = request.DepartmentId,
            InvitedBy = invitedBy,
            InvitationToken = Guid.NewGuid().ToString("N"),
            InvitationType = InvitationValidation.TypeEmployeeSelfSignup,
            Role = request.Role,
            // NOT `sent`, and no `SentAt`. A shareable link has no addressee and this method
            // never calls the sender -- the admin distributes the link themselves. Recording
            // it as sent claimed a delivery that not only failed but was never attempted.
            // `pending` is exactly right: it is awaiting somebody redeeming it.
            Status = InvitationValidation.StatusPending,
            ExpiresAt = now.Add(InvitationLifetime),
            ReminderCount = 0,
        };

        db.UserInvitations.Add(invitation);
        DemographicValueStore.AddForInvitation(db, invitation.Id, linkDemographics.Values);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(ToDetail(invitation, DemographicValueStore.ToMap(linkDemographics.Values)), statusCode: 201);
    }

    private static async Task<IResult> ResendAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        IInvitationEmailSender emailSender,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var invitation = await db.UserInvitations.FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (invitation is null)
        {
            return Results.Json(new { message = "Invitation not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, invitation.CompanyId))
        {
            return Results.Forbid();
        }

        if (invitation.Status == InvitationValidation.StatusAccepted)
        {
            return Results.Json(new { message = "Invitation has already been accepted" }, statusCode: 409);
        }

        var now = DateTimeOffset.UtcNow;
        invitation.InvitationToken = Guid.NewGuid().ToString("N");
        invitation.ExpiresAt = now.Add(InvitationLifetime);
        // ReminderCount counts ATTEMPTS, so it rises either way -- an admin pressing resend
        // four times against a dead provider should be able to see that they did. The two
        // fields that assert a send instead of an attempt, `LastReminderSentAt` and `SentAt`,
        // are written below and only if one happened.
        invitation.ReminderCount += 1;

        // Same ordering as CreateAsync, and for the same reason: the freshly rotated token must
        // exist in the database before it is put in an inbox.
        await db.SaveChangesAsync(cancellationToken);

        var resendOutcome = await RecordDeliveryAsync(db, emailSender, invitation, now, cancellationToken);
        if (resendOutcome?.Delivered == true)
        {
            invitation.LastReminderSentAt = now;
            await db.SaveChangesAsync(cancellationToken);
        }

        var demographics = await DemographicValueStore.LoadForInvitationsAsync(db, [invitation.Id], cancellationToken);
        return Results.Ok(ToDetail(invitation, demographics.GetValueOrDefault(invitation.Id, DemographicValueStore.Empty)));
    }

    /// <summary>
    /// Attempts delivery and promotes the invitation to <c>sent</c> only if the provider took
    /// it. Returns the outcome, or <c>null</c> when no attempt was made.
    ///
    /// The sender is not called at all for an invitation with no address: a shareable link is
    /// distributed by the admin, and "no addressee" is not a failed delivery, it is the
    /// absence of one. Recording either as `sent` is the defect this exists to prevent.
    ///
    /// A second `SaveChangesAsync` is the cost of honesty here, and it is the right way round.
    /// The row must be committed before its token can be put in an inbox — mailing first and
    /// saving second can land a link in someone's inbox that no row backs, and a recipient
    /// clicking a 404 cannot tell that from an invitation that was never sent. This ordering
    /// can only produce the opposite: a committed invitation whose mail failed, which is
    /// visible as `pending` and is what resend is for.
    /// </summary>
    /// <summary>
    /// The one place that decides an invitation was `sent` (#368): only after a provider took
    /// the message. Internal so bulk import records delivery by the same rule rather than a
    /// second copy of it -- a copy is how "sent" came to mean "we tried" in the first place.
    /// </summary>
    internal static async Task<EmailSendOutcome?> RecordDeliveryAsync(
        ClimateProjectDbContext db,
        IInvitationEmailSender emailSender,
        UserInvitation invitation,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (invitation.Email is null)
        {
            return null;
        }

        var outcome = await emailSender.SendAsync(invitation, cancellationToken);
        if (!outcome.Delivered)
        {
            return outcome;
        }

        invitation.Status = InvitationValidation.StatusSent;
        invitation.SentAt = now;
        await db.SaveChangesAsync(cancellationToken);
        return outcome;
    }

    private static async Task<IResult> ListAsync(
        Guid companyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, companyId))
        {
            return Results.Forbid();
        }

        var rows = await db.UserInvitations
            .Where(i => i.CompanyId == companyId)
            .OrderByDescending(i => i.SentAt ?? DateTimeOffset.MinValue)
            .ToListAsync(cancellationToken);

        // One extra round trip for the whole page rather than N: the normalised
        // rows are fetched in bulk and stitched in memory.
        var demographicsByInvitation = await DemographicValueStore.LoadForInvitationsAsync(
            db, rows.Select(i => i.Id).ToList(), cancellationToken);

        var invitations = rows
            .Select(i => ToDetail(i, demographicsByInvitation.GetValueOrDefault(i.Id, DemographicValueStore.Empty)))
            .ToList();

        return Results.Ok(new InvitationListResponse(invitations));
    }
}
