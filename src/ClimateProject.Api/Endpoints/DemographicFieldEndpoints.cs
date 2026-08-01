using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class DemographicFieldEndpoints
{
    public static void MapDemographicFieldEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/demographic-fields").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
    }

    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());

    private static DemographicFieldDetail ToDetail(DemographicField f)
        => new(f.Id, f.CompanyId, f.Field, f.Label, f.Type, f.Options, f.Required, f.Order, f.IsActive);

    private static bool IsValidCreate(CreateDemographicFieldRequest request, out string? error)
    {
        if (string.IsNullOrWhiteSpace(request.Field) || string.IsNullOrWhiteSpace(request.Label))
        {
            error = "Field and label are required";
            return false;
        }

        if (!DemographicFieldValidation.ValidTypes.Contains(request.Type))
        {
            error = $"Invalid type: {request.Type}";
            return false;
        }

        if (request.Type == "select" && (request.Options is null || request.Options.Count == 0))
        {
            error = "Select fields require at least one option";
            return false;
        }

        error = null;
        return true;
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

        var fields = await db.DemographicFields
            .Where(f => f.CompanyId == companyId)
            .OrderBy(f => f.Order)
            .Select(f => new DemographicFieldDetail(f.Id, f.CompanyId, f.Field, f.Label, f.Type, f.Options, f.Required, f.Order, f.IsActive))
            .ToListAsync(cancellationToken);

        return Results.Ok(new DemographicFieldListResponse(fields));
    }

    private static async Task<IResult> CreateAsync(
        CreateDemographicFieldRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, request.CompanyId))
        {
            return Results.Forbid();
        }

        if (!IsValidCreate(request, out var error))
        {
            return Results.Json(new { message = error }, statusCode: 400);
        }

        var fieldKey = request.Field.Trim();
        // IX_demographic_fields_company_id_field is a UNIQUE index (companyId, field).
        // Pre-check and return 409, matching the sibling pattern in
        // CompanyEndpoints.CreateAsync/UpdateAsync for the analogous unique
        // email-domain conflict -- without this, retyping an existing key hits the
        // unique index inside SaveChangesAsync and (with no exception middleware)
        // surfaced as an unhandled 500.
        var existing = await db.DemographicFields
            .FirstOrDefaultAsync(f => f.CompanyId == request.CompanyId && f.Field == fieldKey, cancellationToken);
        if (existing is not null)
        {
            return Results.Json(new { message = $"A demographic field with key '{fieldKey}' already exists for this company" }, statusCode: 409);
        }

        var now = DateTimeOffset.UtcNow;
        var field = new DemographicField
        {
            Id = Guid.NewGuid(),
            CompanyId = request.CompanyId,
            Field = fieldKey,
            Label = request.Label.Trim(),
            Type = request.Type,
            Options = request.Options,
            Required = request.Required,
            Order = request.Order,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now,
        };

        db.DemographicFields.Add(field);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(ToDetail(field), statusCode: 201);
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        UpdateDemographicFieldRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var field = await db.DemographicFields.FirstOrDefaultAsync(f => f.Id == id, cancellationToken);
        if (field is null)
        {
            return Results.Json(new { message = "Demographic field not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, field.CompanyId))
        {
            return Results.Forbid();
        }

        if (!string.IsNullOrWhiteSpace(request.Label)) field.Label = request.Label.Trim();
        if (request.Options is not null) field.Options = request.Options;
        if (request.Required.HasValue) field.Required = request.Required.Value;
        if (request.Order.HasValue) field.Order = request.Order.Value;
        if (request.IsActive.HasValue) field.IsActive = request.IsActive.Value;

        field.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(ToDetail(field));
    }
}
