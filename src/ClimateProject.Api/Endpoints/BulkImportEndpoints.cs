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
        // The one route in the app that legitimately accepts a multi-megabyte body (a CSV
        // upload), so it is opted out of the default request-body ceiling #146 applies
        // everywhere else. It still has a ceiling -- Security:MaxUploadBodyBytes -- and it is
        // authenticated, unlike the surfaces the strict default exists for.
        app.MapPost("/admin/users/bulk-import", ImportAsync)
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
        IPasswordHasher passwordHasher,
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

        var departments = await db.Departments.Where(d => d.CompanyId == companyId).ToListAsync(cancellationToken);

        // Intentionally NOT scoped to `companyId`: UserConfiguration.cs puts a GLOBAL
        // unique index on users.email (no company_id in it), matching signup/login,
        // which look a user up by email alone across the whole platform. Scoping this
        // check to the target company would let a CSV row whose email already belongs
        // to a user in a DIFFERENT company pass as "valid" in preview and then throw
        // an unhandled DbUpdateException out of the single SaveChangesAsync call
        // below -- rolling back every other valid row in the same file.
        var existingEmails = (await db.Users.Select(u => u.Email).ToListAsync(cancellationToken)).ToHashSet();
        var seenInThisFile = new HashSet<string>();

        var results = new List<BulkImportRowResult>();
        var now = DateTimeOffset.UtcNow;

        foreach (var row in parsedRows)
        {
            var errors = new List<string>();
            var email = row.Email.ToLowerInvariant();

            if (string.IsNullOrWhiteSpace(row.Name))
            {
                errors.Add("Name is required");
            }

            if (!IsValidEmail(email))
            {
                errors.Add("Invalid email format");
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
            }

            Department? department = null;
            if (row.Department is not null)
            {
                department = departments.FirstOrDefault(d => d.Name == row.Department);
                if (department is null)
                {
                    errors.Add($"Department not found: {row.Department}");
                }
            }

            string status;
            if (errors.Count > 0)
            {
                status = "error";
            }
            else if (existingEmails.Contains(email) || !seenInThisFile.Add(email))
            {
                status = "duplicate";
                errors.Add("A user with this email already exists or appears twice in this file");
            }
            else if (isPreview)
            {
                status = "valid";
            }
            else
            {
                var user = new User
                {
                    Id = Guid.NewGuid(),
                    CompanyId = companyId,
                    Email = email,
                    Name = row.Name.Trim(),
                    PasswordHash = passwordHasher.Hash(Guid.NewGuid().ToString("N")),
                    Role = row.Role,
                    DepartmentId = department?.Id,
                    IsActive = true,
                    CreatedAt = now,
                    UpdatedAt = now,
                };
                db.Users.Add(user);
                existingEmails.Add(email);
                status = "created";
            }

            results.Add(new BulkImportRowResult(row.RowNumber, row.Name, email, row.Role, row.Department, status, errors));
        }

        if (!isPreview)
        {
            await db.SaveChangesAsync(cancellationToken);
        }

        var successCount = results.Count(r => r.Status is "valid" or "created");
        var errorCount = results.Count - successCount;

        return Results.Ok(new BulkImportResponse(results, successCount, errorCount));
    }
}
