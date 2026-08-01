using System.Security.Claims;
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
        app.MapPost("/admin/users/bulk-import", ImportAsync).RequireAuthorization();
    }

    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || currentUser.CompanyId == companyId.ToString();

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

        if (!Roles.Admin.Contains(currentUser.Role) || (currentUser.Role != Roles.SuperAdmin && currentUser.CompanyId != companyId.ToString()))
        {
            return Results.Forbid();
        }

        var isPreview = bool.TryParse(form["preview"], out var previewValue) && previewValue;

        using var reader = new StreamReader(file.OpenReadStream());
        var csv = await reader.ReadToEndAsync(cancellationToken);
        var parsedRows = CsvUserImportParser.Parse(csv);

        var departments = await db.Departments.Where(d => d.CompanyId == companyId).ToListAsync(cancellationToken);
        var existingEmails = (await db.Users.Where(u => u.CompanyId == companyId).Select(u => u.Email).ToListAsync(cancellationToken)).ToHashSet();
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
