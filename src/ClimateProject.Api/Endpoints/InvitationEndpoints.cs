using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class InvitationEndpoints
{
    private static readonly TimeSpan InvitationLifetime = TimeSpan.FromDays(7);

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
    private static async Task<Guid> ResolveActingUserIdAsync(CurrentUser currentUser, ClimateProjectDbContext db, CancellationToken cancellationToken)
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
        await emailSender.SendAsync(invitation, cancellationToken);
        invitation.Status = InvitationValidation.StatusSent;
        invitation.SentAt = now;
        await db.SaveChangesAsync(cancellationToken);

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
            Status = InvitationValidation.StatusSent,
            ExpiresAt = now.Add(InvitationLifetime),
            SentAt = now,
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
        invitation.ReminderCount += 1;
        invitation.LastReminderSentAt = now;
        invitation.Status = InvitationValidation.StatusSent;
        invitation.SentAt = now;

        await emailSender.SendAsync(invitation, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);

        var demographics = await DemographicValueStore.LoadForInvitationsAsync(db, [invitation.Id], cancellationToken);
        return Results.Ok(ToDetail(invitation, demographics.GetValueOrDefault(invitation.Id, DemographicValueStore.Empty)));
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
