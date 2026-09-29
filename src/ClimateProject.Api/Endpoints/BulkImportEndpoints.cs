using System.Security.Claims;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class BulkImportEndpoints
{
    public static void MapBulkImportEndpoints(this WebApplication app)
    {
        // The routes in the app that legitimately accept a multi-megabyte body (a CSV or
        // workbook upload), so they are opted out of the default request-body ceiling #146
        // applies everywhere else. They still have a ceiling -- Security:MaxUploadBodyBytes --
        // and they are authenticated, unlike the surfaces the strict default exists for.
        app.MapPost("/admin/users/bulk-import", ImportAsync)
            .RequireAuthorization()
            .WithMetadata(new LargeRequestBodyMetadata());

        // The workbook the client fills in, generated for one company so its departments are a
        // dropdown rather than something to spell correctly.
        app.MapGet("/admin/users/bulk-import/template", TemplateAsync)
            .RequireAuthorization();

        // READ, never write. Turns an uploaded workbook into rows for the wizard to show; it
        // touches no table and creates nothing, which is what lets the admin upload a file they
        // are not yet sure about. The Bedrock extraction step described in
        // IntakeParseResult replaces THIS route's body and nothing else.
        app.MapPost("/admin/users/bulk-import/parse", ParseAsync)
            .RequireAuthorization()
            .WithMetadata(new LargeRequestBodyMetadata());

        // The reviewed rows, as JSON. Deliberately not "the same CSV again": by this point the
        // admin has edited the table on screen, and CsvUserImportParser splits on commas with
        // no quoting (its own comment says not to extend it), so re-serialising an edited name
        // like "Rojas, Ana" would silently import two broken columns. The rows travel as rows.
        app.MapPost("/admin/users/bulk-import/rows", ImportRowsAsync)
            .RequireAuthorization()
            .WithMetadata(new LargeRequestBodyMetadata());
    }

    // Matches the CanAccessCompany helper in every sibling endpoint file
    // (UserEndpoints, DepartmentEndpoints, DemographicFieldEndpoints,
    // InvitationEndpoints): SuperAdmin any company, CompanyAdmin only their own.
    // A prior version of this specific helper omitted the `Role == CompanyAdmin`
    // clause entirely (SuperAdmin OR *any* role matching the target company),
    // while being unused -- an identically-named, identically-signatured helper
    // with looser semantics than its five siblings sitting right next to the
    // (correct, hand-written) live check below is a booby trap: the obvious DRY
    // cleanup of replacing that inline check with a call to this helper would
    // have silently granted any employee/supervisor/leader bulk-import into
    // their own company. Now that the semantics match, ImportAsync uses it directly.
    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());

    private static bool IsValidEmail(string email)
        => !string.IsNullOrWhiteSpace(email) && email.Contains('@') && email.Split('@').Length == 2 && email.Split('@')[1].Contains('.');

    private static async Task<IResult> ImportAsync(
        HttpRequest httpRequest,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        IInvitationEmailSender emailSender,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();

        if (!httpRequest.HasFormContentType)
        {
            return Results.Json(new { message = "Expected multipart form data" }, statusCode: 400);
        }

        var form = await httpRequest.ReadFormAsync(cancellationToken);
        var file = form.Files["file"];
        if (file is null || file.Length == 0)
        {
            return Results.Json(new { message = "A CSV file is required" }, statusCode: 400);
        }

        if (!Guid.TryParse(form["companyId"], out var companyId))
        {
            return Results.Json(new { message = "A valid companyId is required" }, statusCode: 400);
        }

        if (!CanAccessCompany(currentUser, companyId))
        {
            return Results.Forbid();
        }

        var isPreview = bool.TryParse(form["preview"], out var previewValue) && previewValue;

        using var reader = new StreamReader(file.OpenReadStream());
        var csv = await reader.ReadToEndAsync(cancellationToken);
        var parsedRows = CsvUserImportParser.Parse(csv);

        return Results.Ok(await ProcessRowsAsync(
            parsedRows, companyId, isPreview, currentUser, db, emailSender, cancellationToken));
    }

    /// <summary>
    /// Validate every row, and unless this is a preview, invite the ones that pass.
    ///
    /// <para>Extracted from <see cref="ImportAsync"/> unchanged so that the CSV upload and the
    /// reviewed-rows submission cannot validate differently. The wizard shows an admin the
    /// verdict of a preview and then asks them to approve it; if the approval ran through a
    /// second copy of these rules, the screen they approved would not be the thing that
    /// happened. One body, two callers, is the only shape that keeps that promise.</para>
    /// </summary>
    private static async Task<BulkImportResponse> ProcessRowsAsync(
        IReadOnlyList<ParsedImportRow> parsedRows,
        Guid companyId,
        bool isPreview,
        CurrentUser currentUser,
        ClimateProjectDbContext db,
        IInvitationEmailSender emailSender,
        CancellationToken cancellationToken)
    {
        // Active only, as the template's dropdown is: a department that has been retired is not
        // somewhere a new person can be placed, and matching it here would invite them into one.
        var departments = await db.Departments
            .Where(d => d.CompanyId == companyId && d.IsActive)
            .ToListAsync(cancellationToken);

        // Intentionally NOT scoped to `companyId`: UserConfiguration.cs puts a GLOBAL
        // unique index on users.email (no company_id in it), matching signup/login,
        // which look a user up by email alone across the whole platform. Scoping this
        // check to the target company would let a CSV row whose email already belongs
        // to a user in a DIFFERENT company pass as "valid" in preview and then throw
        // an unhandled DbUpdateException out of the single SaveChangesAsync call
        // below -- rolling back every other valid row in the same file.
        var existingEmails = (await db.Users.Select(u => u.Email).ToListAsync(cancellationToken)).ToHashSet();

        var now = DateTimeOffset.UtcNow;

        // Global for the same reason `existingEmails` is: an invitation is a promise of a row
        // in `users`, and that table's unique index on email is platform-wide. Minting a second
        // live token for somebody who already holds one is not a harmless duplicate -- whichever
        // they redeem first makes the other permanently unredeemable, and nothing tells them
        // which of the two mails in their inbox is the real one. Accepted and expired
        // invitations are not live and do not block a re-invite.
        var invitedEmails = (await db.UserInvitations
            .Where(i => i.Email != null && i.AcceptedAt == null && i.ExpiresAt > now)
            .Select(i => i.Email!)
            .ToListAsync(cancellationToken))
            .ToHashSet();

        var seenInThisFile = new HashSet<string>();

        // Resolved once rather than per row: it is a lookup by the caller's own email and the
        // caller does not change halfway through a file.
        var invitedBy = await InvitationEndpoints.ResolveActingUserIdAsync(currentUser, db, cancellationToken);

        var results = new List<BulkImportRowResult>();
        var created = new List<UserInvitation>();

        foreach (var row in parsedRows)
        {
            var errors = new List<string>();
            var issues = new List<BulkImportIssue>();
            var email = row.Email.ToLowerInvariant();

            if (string.IsNullOrWhiteSpace(row.Name))
            {
                errors.Add("Name is required");
                issues.Add(new BulkImportIssue("name_required"));
            }

            if (!IsValidEmail(email))
            {
                errors.Add("Invalid email format");
                issues.Add(new BulkImportIssue("invalid_email"));
            }

            // super_admin/company_admin are excluded from bulk-importable roles, not just
            // invalid ones. CanAccessCompany treats Role == SuperAdmin as unconditionally
            // authorized for any company, so without this exclusion a CompanyAdmin bulk-
            // importing into their own company could mint a peer company_admin (or, if the
            // row role were ever trusted further, a platform-wide super_admin). This mirrors
            // the same exclusion in InvitationEndpoints.CreateAsync's employee_direct branch
            // and CreateShareableLinkAsync -- company-scoped bulk role assignment must never
            // be able to create admin accounts.
            if (!Roles.All.Contains(row.Role) || row.Role == Roles.SuperAdmin || row.Role == Roles.CompanyAdmin)
            {
                errors.Add($"Invalid role: {row.Role}");
                issues.Add(new BulkImportIssue("invalid_role", row.Role));
            }

            Department? department = null;
            if (row.Department is not null)
            {
                department = departments.FirstOrDefault(d => d.Name == row.Department);
                if (department is null)
                {
                    errors.Add($"Department not found: {row.Department}");
                    issues.Add(new BulkImportIssue("department_not_found", row.Department));
                }
            }

            string status;
            if (errors.Count > 0)
            {
                status = "error";
            }
            else if (existingEmails.Contains(email))
            {
                // Three causes, told apart: each sends the admin somewhere different (the people
                // list, the pending invitations, their own file), and one sentence naming all
                // three sent them to all three.
                status = "duplicate";
                errors.Add("A user with this email already exists");
                issues.Add(new BulkImportIssue("already_user"));
            }
            else if (invitedEmails.Contains(email))
            {
                status = "duplicate";
                errors.Add("This email already holds a pending invitation");
                issues.Add(new BulkImportIssue("already_invited"));
            }
            else if (!seenInThisFile.Add(email))
            {
                status = "duplicate";
                errors.Add("This email appears more than once in this file");
                issues.Add(new BulkImportIssue("repeated_in_file"));
            }
            else if (isPreview)
            {
                status = "valid";
            }
            else
            {
                // An invitation, not an account. This branch used to write a `User` whose
                // PasswordHash was a freshly generated Guid that was hashed and then
                // discarded -- active, addressable, and impossible for anybody, including
                // its owner, to sign in to. A bulk import exists to onboard a workforce
                // before a survey, so that failure was invisible until the moment it
                // mattered most.
                //
                // The row's Name is deliberately not carried. `UserInvitation` has nowhere
                // to put it, and the accept flow already requires the person to give their
                // own name and password (InvitationAcceptEndpoints.cs:53). Their spelling of
                // their name beats a spreadsheet cell's. The name still reaches the admin in
                // this endpoint's own result row, which is where they check what they
                // uploaded.
                var invitation = new UserInvitation
                {
                    Id = Guid.NewGuid(),
                    Email = email,
                    CompanyId = companyId,
                    DepartmentId = department?.Id,
                    InvitedBy = invitedBy,
                    InvitationToken = Guid.NewGuid().ToString("N"),
                    InvitationType = InvitationValidation.TypeEmployeeDirect,
                    Role = row.Role,
                    Status = InvitationValidation.StatusPending,
                    ExpiresAt = now.Add(InvitationEndpoints.InvitationLifetime),
                    ReminderCount = 0,
                };
                db.UserInvitations.Add(invitation);
                created.Add(invitation);
                invitedEmails.Add(email);
                status = "invited";
            }

            results.Add(new BulkImportRowResult(row.RowNumber, row.Name, email, row.Role, row.Department, status, errors, issues));
        }

        if (!isPreview)
        {
            // Saved before a single mail goes out, for the reason InvitationEndpoints.CreateAsync
            // spells out: mailing first can put a token in somebody's inbox that no row backs,
            // and a recipient whose link 404s cannot tell that from never having been invited.
            // The opposite order can only produce a committed invitation whose mail failed,
            // which is what resend is for.
            await db.SaveChangesAsync(cancellationToken);

            // Delivery is recorded by the same rule as every other invitation (#368): `sent`
            // only once a provider took the message. A row whose mail failed stays `pending`,
            // which is the honest state and the one `POST /invitations/{id}/resend` retries.
            // Sequential on purpose -- this shares a DbContext, and RecordDeliveryAsync saves.
            foreach (var invitation in created)
            {
                await InvitationEndpoints.RecordDeliveryAsync(db, emailSender, invitation, now, cancellationToken);
            }
        }

        var successCount = results.Count(r => r.Status is "valid" or "invited");
        var errorCount = results.Count - successCount;

        return new BulkImportResponse(results, successCount, errorCount);
    }

    private static async Task<IResult> TemplateAsync(
        string? companyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();

        if (!Guid.TryParse(companyId, out var companyGuid))
        {
            return Results.Json(new { message = "A valid companyId is required" }, statusCode: 400);
        }

        if (!CanAccessCompany(currentUser, companyGuid))
        {
            return Results.Forbid();
        }

        var company = await db.Companies
            .FirstOrDefaultAsync(c => c.Id == companyGuid, cancellationToken);
        if (company is null)
        {
            return Results.Json(new { message = "Company not found" }, statusCode: 404);
        }

        // Ordered so the dropdown reads like a list rather than like insertion order, which is
        // what the admin scrolling it expects.
        var departments = await db.Departments
            .Where(d => d.CompanyId == companyGuid && d.IsActive)
            .OrderBy(d => d.Name)
            .Select(d => d.Name)
            .ToListAsync(cancellationToken);

        var workbook = IntakeTemplateWorkbook.Build(company.Name, departments);

        return Results.File(
            workbook,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "plantilla-personas.xlsx");
    }

    private static async Task<IResult> ParseAsync(
        HttpRequest httpRequest,
        ClaimsPrincipal principal,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();

        if (!httpRequest.HasFormContentType)
        {
            return Results.Json(new { message = "Expected multipart form data" }, statusCode: 400);
        }

        var form = await httpRequest.ReadFormAsync(cancellationToken);
        var file = form.Files["file"];
        if (file is null || file.Length == 0)
        {
            return Results.Json(new { message = "A file is required" }, statusCode: 400);
        }

        if (!Guid.TryParse(form["companyId"], out var companyId))
        {
            return Results.Json(new { message = "A valid companyId is required" }, statusCode: 400);
        }

        // Checked even though this route reads nothing from the database: it is the check that
        // stops one company's admin using the platform as a parser for a file they then import
        // elsewhere, and a route that authorises differently from its siblings is how that
        // stops being obvious.
        if (!CanAccessCompany(currentUser, companyId))
        {
            return Results.Forbid();
        }

        IntakeParseResult parsed;
        try
        {
            await using var stream = file.OpenReadStream();
            using var buffer = new MemoryStream();
            // ClosedXML needs a seekable stream; the form's stream is not one.
            await stream.CopyToAsync(buffer, cancellationToken);
            buffer.Position = 0;
            parsed = XlsxUserImportParser.Parse(buffer);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // A file that is not a workbook at all (a .csv renamed, a PDF, a corrupt download)
            // throws from deep inside the reader with a message written for whoever wrote the
            // reader. Answering 400 with our own sentence keeps that off the admin's screen,
            // and keeps a malformed upload from being recorded as a server fault.
            return Results.Json(
                new { message = "This file could not be read as an Excel workbook (.xlsx).", code = "not_a_workbook" },
                statusCode: 400);
        }

        return Results.Ok(parsed);
    }

    private static async Task<IResult> ImportRowsAsync(
        BulkImportRowsRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        IInvitationEmailSender emailSender,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();

        if (request.CompanyId == Guid.Empty)
        {
            return Results.Json(new { message = "A valid companyId is required" }, statusCode: 400);
        }

        if (!CanAccessCompany(currentUser, request.CompanyId))
        {
            return Results.Forbid();
        }

        var rows = (request.Rows ?? [])
            .Select(r => new ParsedImportRow(
                RowNumber: r.RowNumber,
                Name: (r.Name ?? string.Empty).Trim(),
                Email: (r.Email ?? string.Empty).Trim(),
                // Resolved again rather than trusted: the admin may have retyped the cell in the
                // review table, and the word they type there deserves the same Spanish synonyms
                // the workbook column accepts. An unrecognised word passes through so the
                // validation below can name it back.
                Role: IntakeWorkbook.ResolveRole(r.Role) ?? (r.Role ?? string.Empty).Trim(),
                Department: string.IsNullOrWhiteSpace(r.Department) ? null : r.Department.Trim()))
            .ToList();

        return Results.Ok(await ProcessRowsAsync(
            rows, request.CompanyId, request.Preview, currentUser, db, emailSender, cancellationToken));
    }
}
