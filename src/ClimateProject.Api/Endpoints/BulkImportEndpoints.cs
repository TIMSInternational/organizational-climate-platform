using System.Diagnostics;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.OrgStructure.Intake;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

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

        // READ, never write. Turns an uploaded copy of OUR template into rows. The AI intake is
        // the route below; this one stays as the template-only path it always was.
        app.MapPost("/admin/users/bulk-import/parse", ParseAsync)
            .RequireAuthorization()
            .WithMetadata(new LargeRequestBodyMetadata());

        // READ, never write. Any spreadsheet the client has — their own HR export, not our
        // template — read, profiled, mapped (by Claude from a masked profile, by our template's
        // fixed headers, or by the admin's corrected mapping) and applied to every row here.
        // Nothing is created: what comes back is a proposal for the review step, which still
        // validates through ProcessRowsAsync like every other path.
        app.MapPost("/admin/users/bulk-import/understand", UnderstandAsync)
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
            parsedRows, [], companyId, isPreview, currentUser, db, emailSender, cancellationToken));
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
        IReadOnlyCollection<string> approvedNewDepartments,
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

        // Departments the admin approved creating. A name that already exists — active or
        // retired, at the top level — is not new: an active one simply matches, and a retired
        // one would be a duplicate the department endpoint itself refuses, so rows naming it
        // are told the department is not active instead of silently creating a twin.
        var retiredNames = (await db.Departments
                .Where(d => d.CompanyId == companyId && !d.IsActive && d.ParentDepartmentId == null)
                .Select(d => d.Name)
                .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var approvedNew = approvedNewDepartments
            .Select(n => n.Trim())
            .Where(n => n.Length is > 0 and <= 100
                        && !departments.Any(d => string.Equals(d.Name, n, StringComparison.OrdinalIgnoreCase))
                        && !retiredNames.Contains(n))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var createdDepartments = new Dictionary<string, Department>(StringComparer.OrdinalIgnoreCase);

        // Loaded only when a row carries demographics: the CSV and template paths never do.
        List<DemographicFieldDefinition>? demographicDefinitions = null;

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
            string? newDepartmentName = null;
            if (row.Department is not null)
            {
                department = departments.FirstOrDefault(d => d.Name == row.Department);
                if (department is null && approvedNew.TryGetValue(row.Department, out var approvedName))
                {
                    newDepartmentName = approvedName;
                }
                else if (department is null && retiredNames.Contains(row.Department))
                {
                    errors.Add($"Department is not active: {row.Department}");
                    issues.Add(new BulkImportIssue("department_inactive", row.Department));
                }
                else if (department is null)
                {
                    errors.Add($"Department not found: {row.Department}");
                    issues.Add(new BulkImportIssue("department_not_found", row.Department));
                }
            }

            // Validated exactly as a single invitation's pre-assigned demographics are
            // (InvitationEndpoints.CreateAsync): partial is fine, a wrong key or a value outside
            // a select field's options is not.
            IReadOnlyList<ResolvedDemographicValue> demographicValues = [];
            if (row.Demographics is { Count: > 0 })
            {
                demographicDefinitions ??= await DemographicValueStore.LoadDefinitionsAsync(db, companyId, cancellationToken);
                var validated = DemographicValueValidation.Validate(row.Demographics, demographicDefinitions, enforceRequired: false);
                if (validated.IsValid)
                {
                    demographicValues = validated.Values;
                }
                else
                {
                    foreach (var error in validated.Errors)
                    {
                        errors.Add(error);
                    }

                    issues.Add(new BulkImportIssue("invalid_demographic", string.Join(", ", row.Demographics.Keys)));
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
                if (newDepartmentName is not null && !createdDepartments.TryGetValue(newDepartmentName, out department))
                {
                    // Created once, and only because a row that is actually being invited uses
                    // it — an approved name that every row using it failed validation for is
                    // not created at all.
                    department = new Department
                    {
                        Id = Guid.NewGuid(),
                        CompanyId = companyId,
                        Name = newDepartmentName,
                        IsActive = true,
                        CreatedAt = now,
                        UpdatedAt = now,
                    };
                    db.Departments.Add(department);
                    createdDepartments[newDepartmentName] = department;
                }

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
                DemographicValueStore.AddForInvitation(db, invitation.Id, demographicValues);
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
                Department: string.IsNullOrWhiteSpace(r.Department) ? null : r.Department.Trim(),
                Demographics: r.Demographics))
            .ToList();

        return Results.Ok(await ProcessRowsAsync(
            rows, request.NewDepartments ?? [], request.CompanyId, request.Preview, currentUser, db, emailSender, cancellationToken));
    }

    private static readonly JsonSerializerOptions IntakeJson = new(JsonSerializerDefaults.Web);

    /// <summary>How long an identical file's mapping is reused: long enough for "upload again", not a store.</summary>
    private static readonly TimeSpan MappingCacheLifetime = TimeSpan.FromMinutes(30);

    private static async Task<IResult> UnderstandAsync(
        HttpRequest httpRequest,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        IIntakeMappingModel model,
        IMemoryCache cache,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!httpRequest.HasFormContentType)
        {
            return Results.Json(new { message = "Expected multipart form data", code = "bad_request" }, statusCode: 400);
        }

        var form = await httpRequest.ReadFormAsync(cancellationToken);
        var file = form.Files["file"];
        if (file is null || file.Length == 0)
        {
            return Results.Json(new { message = "A file is required", code = "no_file" }, statusCode: 400);
        }

        if (!Guid.TryParse(form["companyId"], out var companyId))
        {
            return Results.Json(new { message = "A valid companyId is required", code = "bad_request" }, statusCode: 400);
        }

        if (!CanAccessCompany(currentUser, companyId))
        {
            return Results.Forbid();
        }

        var company = await db.Companies.FirstOrDefaultAsync(c => c.Id == companyId, cancellationToken);
        if (company is null)
        {
            return Results.Json(new { message = "Company not found", code = "not_found" }, statusCode: 404);
        }

        var language = form["language"] == "en" ? "en" : "es";

        IReadOnlyList<SheetGrid> sheets;
        try
        {
            await using var stream = file.OpenReadStream();
            sheets = SpreadsheetReader.Read(stream, file.FileName);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return Results.Json(
                new { message = "This file could not be read as a spreadsheet (.xlsx or .csv).", code = "not_a_spreadsheet" },
                statusCode: 400);
        }

        if (sheets.All(s => s.Rows.Count == 0))
        {
            return Results.Json(new { message = "The file has no rows.", code = "empty_file" }, statusCode: 400);
        }

        var targets = await LoadIntakeTargetsAsync(db, company, language, cancellationToken);
        var profile = IntakeProfiler.Build(sheets);

        IntakeMapping mapping;
        string source;
        string? failureCode = null;
        IntakeAiFacts? ai = null;

        if (form["mapping"] is { Count: > 0 } submitted && !string.IsNullOrWhiteSpace(submitted.ToString()))
        {
            // The admin's corrected mapping: applied as given (after the same sanitising as the
            // model's), with no model call — editing a dropdown must not cost a request.
            IntakeMapping? corrected;
            try
            {
                corrected = JsonSerializer.Deserialize<IntakeMapping>(submitted.ToString(), IntakeJson);
            }
            catch (JsonException)
            {
                corrected = null;
            }

            if (corrected is null)
            {
                return Results.Json(new { message = "The mapping could not be read.", code = "bad_mapping" }, statusCode: 400);
            }

            mapping = IntakeMappingSanitizer.Sanitize(corrected, sheets, targets);
            source = "manual";
        }
        else if (sheets.FirstOrDefault(IntakeHeuristicMapping.IsTemplate) is { } template)
        {
            mapping = IntakeHeuristicMapping.Build(template, targets);
            source = "template";
        }
        else
        {
            var clock = Stopwatch.StartNew();
            var cacheKey = "intake-mapping:" + companyId + ":" + language + ":" + Hash(profile, targets);
            var cached = cache.TryGetValue(cacheKey, out IntakeModelResult? result) && result is not null;
            if (!cached)
            {
                result = await model.MapAsync(profile, targets, language, cancellationToken);
                if (result.Mapping is not null)
                {
                    cache.Set(cacheKey, result, MappingCacheLifetime);
                }
            }

            var roster = profile.Sheets.FirstOrDefault(s => s.Name == result!.Mapping?.Sheet) ?? profile.Sheets[0];
            if (result!.Mapping is { } proposed)
            {
                mapping = IntakeMappingSanitizer.Sanitize(proposed, sheets, targets);
                source = "ai";
                roster = profile.Sheets.FirstOrDefault(s => s.Name == mapping.Sheet) ?? roster;
            }
            else
            {
                var fallbackSheet = sheets.Where(s => s.Rows.Count > 0).MaxBy(s => s.Rows.Count)!;
                mapping = IntakeHeuristicMapping.Build(fallbackSheet, targets);
                source = "heuristic";
                failureCode = result.FailureCode ?? "ai_failed";
            }

            // Facts about a request that was never made would be a false privacy claim: "the AI
            // saw only the structure" when it saw nothing. Unavailable means not sent.
            ai = result.FailureCode == "ai_unavailable" ? null : new IntakeAiFacts(
                result.Model ?? "unknown",
                result.InputTokens,
                result.OutputTokens,
                clock.ElapsedMilliseconds,
                cached,
                roster.Columns.Where(c => c.Values is not null).Select(c => c.Header).ToList(),
                roster.Columns.Where(c => c.MaskedSamples is not null).Select(c => c.Header).ToList());
        }

        var sheet = sheets.First(s => s.Name == mapping.Sheet);
        var applied = IntakeMappingApplier.Apply(sheet, mapping, targets);
        var insights = IntakeInsights.Compute(applied.Rows, company.EmailDomain, applied.NewDepartments);

        return Results.Ok(new IntakeUnderstandResponse(
            source,
            failureCode,
            mapping,
            applied.Rows,
            applied.NewDepartments,
            applied.Problems,
            insights,
            new IntakeFileFacts(
                file.FileName,
                sheets.Select(s => new IntakeSheetFacts(s.Name, s.Rows.Count, s.ColumnCount)).ToList(),
                applied.NamesNormalised,
                applied.SkippedRows),
            ai,
            targets));
    }

    /// <summary>
    /// The company's mapping targets: ACTIVE departments (the same list the template offers) and
    /// ACTIVE demographic fields with their allowed stored values and a label in the reader's
    /// language.
    /// </summary>
    private static async Task<IntakeTargets> LoadIntakeTargetsAsync(
        ClimateProjectDbContext db,
        Company company,
        string language,
        CancellationToken cancellationToken)
    {
        var departments = await db.Departments
            .Where(d => d.CompanyId == company.Id && d.IsActive)
            .OrderBy(d => d.Name)
            .Select(d => d.Name)
            .ToListAsync(cancellationToken);

        var definitions = await DemographicValueStore.LoadDefinitionsAsync(db, company.Id, cancellationToken);
        var labels = await db.DemographicFields
            .Where(f => f.CompanyId == company.Id)
            .Select(f => new { f.Field, f.LabelEs, f.LabelEn })
            .ToListAsync(cancellationToken);

        var fieldIds = definitions.Select(d => d.Id).ToList();
        var optionLabels = (await db.DemographicFieldOptions
                .Where(o => fieldIds.Contains(o.DemographicFieldId))
                .Select(o => new { o.DemographicFieldId, o.Value, o.LabelEs, o.LabelEn })
                .ToListAsync(cancellationToken))
            .GroupBy(o => o.DemographicFieldId)
            .ToDictionary(
                g => g.Key,
                g => (IReadOnlyDictionary<string, string>)g.ToDictionary(
                    o => o.Value,
                    o => (language == "en" ? o.LabelEn ?? o.LabelEs : o.LabelEs ?? o.LabelEn) ?? o.Value));

        var demographics = definitions
            .Where(d => d.IsActive)
            .Select(d =>
            {
                var label = labels.FirstOrDefault(l => l.Field == d.Field);
                var text = language == "en" ? label?.LabelEn ?? label?.LabelEs : label?.LabelEs ?? label?.LabelEn;
                return new IntakeDemographicTarget(d.Field, text, d.Type, d.Options, optionLabels.GetValueOrDefault(d.Id));
            })
            .ToList();

        return new IntakeTargets(company.Name, company.EmailDomain, departments, demographics);
    }

    /// <summary>Identifies an identical question: same masked profile, same company targets.</summary>
    private static string Hash(IntakeProfile profile, IntakeTargets targets)
    {
        var json = JsonSerializer.Serialize(new { profile, targets }, IntakeJson);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json)));
    }
}
