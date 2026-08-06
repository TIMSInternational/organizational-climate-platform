using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
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

    // A demographic field has no language of its own: demographics are defined once per
    // company, so the company's language is the content language. That is also why
    // there is no per-field publish gate -- there is nothing to publish.
    private static DemographicFieldDetail ToDetail(
        DemographicField f,
        IReadOnlyList<DemographicFieldOption> options,
        string? lang,
        string companyLanguage)
    {
        var locale = ContentLanguages.NormaliseLocale(lang)
                     ?? ContentLanguages.SingleLocaleOf(companyLanguage)
                     ?? ContentLanguages.FallbackLocale;

        var fallbackFields = new List<string>();
        var label = LocalizedContent.Resolve(f.LabelEn, f.LabelEs, locale, companyLanguage);
        if (label.IsFallback) fallbackFields.Add("label");

        List<DemographicFieldOptionDto>? optionDtos = null;
        if (options.Count > 0)
        {
            optionDtos = [];
            foreach (var option in options.OrderBy(o => o.Order))
            {
                var optionLabel = LocalizedContent.Resolve(option.LabelEn, option.LabelEs, locale, companyLanguage);
                if (optionLabel.IsFallback) fallbackFields.Add($"options[{option.Order}].label");
                optionDtos.Add(new DemographicFieldOptionDto(option.Order, option.Value, optionLabel.Text));
            }
        }

        return new DemographicFieldDetail(
            f.Id, f.CompanyId, f.Field, label.Text, f.Type, optionDtos,
            f.Required, f.Order, f.IsActive, locale, fallbackFields);
    }

    private static async Task<string> LoadCompanyLanguageAsync(
        ClimateProjectDbContext db,
        Guid companyId,
        CancellationToken cancellationToken)
    {
        var language = await db.Companies
            .Where(c => c.Id == companyId)
            .Select(c => c.Settings.Language)
            .FirstOrDefaultAsync(cancellationToken);

        return ContentLanguages.NormaliseLanguage(language) ?? ContentLanguages.FallbackLocale;
    }

    // Builds the option rows for a field, deriving the stable value from the label when
    // the caller did not supply one (see MicroclimateContent.DeriveOptionValue for why
    // the value is the label text rather than an opaque id).
    private static bool TryBuildOptions(
        List<DemographicFieldOptionInput>? inputs,
        string companyLanguage,
        out List<DemographicFieldOption> options,
        out string? error)
    {
        options = [];
        error = null;

        var order = 0;
        foreach (var input in inputs ?? [])
        {
            string? labelEn = null;
            string? labelEs = null;
            if (input.Label is not null
                && !input.Label.TryResolve(companyLanguage, $"options[{order}].label", out labelEn, out labelEs, out error))
            {
                return false;
            }

            var value = MicroclimateContent.DeriveOptionValue(input.Value, labelEn, labelEs);
            if (value is null)
            {
                error = $"Option {order} needs a value or a label";
                return false;
            }

            if (value.Length > DemographicValueValidation.MaxValueLength)
            {
                // The value is what lands in user_demographics.value, so it has to fit
                // that column -- rejecting here gives a 400 instead of a truncation/500.
                error = $"Option {order} value exceeds {DemographicValueValidation.MaxValueLength} characters";
                return false;
            }

            if (options.Any(o => string.Equals(o.Value, value, StringComparison.Ordinal)))
            {
                error = $"Duplicate option value '{value}'";
                return false;
            }

            options.Add(new DemographicFieldOption
            {
                Order = order,
                Value = value,
                LabelEn = labelEn,
                LabelEs = labelEs,
            });
            order++;
        }

        return true;
    }

    private static async Task<IResult> ListAsync(
        Guid companyId,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, companyId))
        {
            return Results.Forbid();
        }

        var companyLanguage = await LoadCompanyLanguageAsync(db, companyId, cancellationToken);

        var fields = await db.DemographicFields
            .Where(f => f.CompanyId == companyId)
            .OrderBy(f => f.Order)
            .ToListAsync(cancellationToken);

        var fieldIds = fields.Select(f => f.Id).ToList();
        var optionsByField = (await db.DemographicFieldOptions
                .Where(o => fieldIds.Contains(o.DemographicFieldId))
                .OrderBy(o => o.Order)
                .ToListAsync(cancellationToken))
            .GroupBy(o => o.DemographicFieldId)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<DemographicFieldOption>)g.ToList());

        var details = fields
            .Select(f => ToDetail(f, optionsByField.GetValueOrDefault(f.Id, []), lang, companyLanguage))
            .ToList();

        return Results.Ok(new DemographicFieldListResponse(details));
    }

    private static async Task<IResult> CreateAsync(
        CreateDemographicFieldRequest request,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, request.CompanyId))
        {
            return Results.Forbid();
        }

        var companyLanguage = await LoadCompanyLanguageAsync(db, request.CompanyId, cancellationToken);

        if (string.IsNullOrWhiteSpace(request.Field) || request.Label is null)
        {
            return Results.Json(new { message = "Field and label are required" }, statusCode: 400);
        }

        if (!request.Label.TryResolve(companyLanguage, "label", out var labelEn, out var labelEs, out var labelError))
        {
            return Results.Json(new { message = labelError }, statusCode: 400);
        }

        if (string.IsNullOrWhiteSpace(labelEn) && string.IsNullOrWhiteSpace(labelEs))
        {
            return Results.Json(new { message = "Field and label are required" }, statusCode: 400);
        }

        if (!DemographicFieldValidation.ValidTypes.Contains(request.Type))
        {
            return Results.Json(new { message = $"Invalid type: {request.Type}" }, statusCode: 400);
        }

        if (!TryBuildOptions(request.Options, companyLanguage, out var options, out var optionError))
        {
            return Results.Json(new { message = optionError }, statusCode: 400);
        }

        if (request.Type == "select" && options.Count == 0)
        {
            return Results.Json(new { message = "Select fields require at least one option" }, statusCode: 400);
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
            LabelEn = labelEn?.Trim(),
            LabelEs = labelEs?.Trim(),
            Type = request.Type,
            Required = request.Required,
            Order = request.Order,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now,
        };

        db.DemographicFields.Add(field);
        foreach (var option in options)
        {
            option.DemographicFieldId = field.Id;
            db.DemographicFieldOptions.Add(option);
        }

        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(ToDetail(field, options, lang, companyLanguage), statusCode: 201);
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        UpdateDemographicFieldRequest request,
        string? lang,
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

        var companyLanguage = await LoadCompanyLanguageAsync(db, field.CompanyId, cancellationToken);

        if (request.Label is not null)
        {
            if (!request.Label.TryResolve(companyLanguage, "label", out var labelEn, out var labelEs, out var labelError))
            {
                return Results.Json(new { message = labelError }, statusCode: 400);
            }

            if (!string.IsNullOrWhiteSpace(labelEn)) field.LabelEn = labelEn.Trim();
            if (!string.IsNullOrWhiteSpace(labelEs)) field.LabelEs = labelEs.Trim();
        }

        var existingOptions = await db.DemographicFieldOptions
            .Where(o => o.DemographicFieldId == field.Id)
            .OrderBy(o => o.Order)
            .ToListAsync(cancellationToken);

        if (request.Options is not null)
        {
            if (!TryBuildOptions(request.Options, companyLanguage, out var options, out var optionError))
            {
                return Results.Json(new { message = optionError }, statusCode: 400);
            }

            db.DemographicFieldOptions.RemoveRange(existingOptions);
            foreach (var option in options)
            {
                option.DemographicFieldId = field.Id;
                db.DemographicFieldOptions.Add(option);
            }

            existingOptions = options;
        }

        if (request.Required.HasValue) field.Required = request.Required.Value;
        if (request.Order.HasValue) field.Order = request.Order.Value;
        if (request.IsActive.HasValue) field.IsActive = request.IsActive.Value;

        field.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(ToDetail(field, existingOptions, lang, companyLanguage));
    }
}
