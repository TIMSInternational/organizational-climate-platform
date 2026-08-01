using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class CompanyEndpoints
{
    public static void MapCompanyEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/companies").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
        group.MapPut("/{id:guid}/settings", UpdateSettingsAsync);
    }

    private static async Task<IResult> ListAsync(
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        var companies = await db.Companies
            .OrderByDescending(c => c.CreatedAt)
            .Select(c => new CompanyListItem(c.Id, c.Name, c.EmailDomain, c.Industry, c.Size, c.Country, c.SubscriptionTier, c.CreatedAt))
            .ToListAsync(cancellationToken);

        return Results.Ok(new CompanyListResponse(companies));
    }

    private static async Task<IResult> CreateAsync(
        CreateCompanyRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        if (string.IsNullOrWhiteSpace(request.Name)
            || string.IsNullOrWhiteSpace(request.EmailDomain)
            || string.IsNullOrWhiteSpace(request.Industry)
            || string.IsNullOrWhiteSpace(request.Size)
            || string.IsNullOrWhiteSpace(request.Country))
        {
            return Results.Json(new { message = "Name, emailDomain, industry, size, and country are required" }, statusCode: 400);
        }

        var domain = request.EmailDomain.Trim().ToLowerInvariant();
        if (!CompanyValidation.IsValidDomain(domain))
        {
            return Results.Json(new { message = $"Invalid domain format: {domain}" }, statusCode: 400);
        }

        if (!CompanyValidation.ValidSizes.Contains(request.Size))
        {
            return Results.Json(new { message = $"Invalid size: {request.Size}" }, statusCode: 400);
        }

        var subscriptionTier = string.IsNullOrWhiteSpace(request.SubscriptionTier) ? "basic" : request.SubscriptionTier;
        if (!CompanyValidation.ValidSubscriptionTiers.Contains(subscriptionTier))
        {
            return Results.Json(new { message = $"Invalid subscription tier: {subscriptionTier}" }, statusCode: 400);
        }

        var existing = await db.Companies.FirstOrDefaultAsync(c => c.EmailDomain == domain, cancellationToken);
        if (existing is not null)
        {
            return Results.Json(new { message = $"Domain already exists: {domain}" }, statusCode: 409);
        }

        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            EmailDomain = domain,
            Industry = request.Industry.Trim(),
            Size = request.Size,
            Country = request.Country.Trim(),
            SubscriptionTier = subscriptionTier,
            CreatedAt = DateTimeOffset.UtcNow,
        };

        db.Companies.Add(company);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(
            new CompanyDetail(company.Id, company.Name, company.EmailDomain, company.Industry, company.Size, company.Country, company.SubscriptionTier, company.CreatedAt, UserCount: 0),
            statusCode: 201);
    }

    private static async Task<IResult> GetAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        var company = await db.Companies.FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (company is null)
        {
            return Results.Json(new { message = "Company not found" }, statusCode: 404);
        }

        var userCount = await db.Users.CountAsync(u => u.CompanyId == id && u.IsActive, cancellationToken);

        return Results.Ok(new CompanyDetail(company.Id, company.Name, company.EmailDomain, company.Industry, company.Size, company.Country, company.SubscriptionTier, company.CreatedAt, userCount));
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        UpdateCompanyRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        var company = await db.Companies.FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (company is null)
        {
            return Results.Json(new { message = "Company not found" }, statusCode: 404);
        }

        if (!string.IsNullOrWhiteSpace(request.EmailDomain))
        {
            var domain = request.EmailDomain.Trim().ToLowerInvariant();
            if (domain != company.EmailDomain)
            {
                if (!CompanyValidation.IsValidDomain(domain))
                {
                    return Results.Json(new { message = $"Invalid domain format: {domain}" }, statusCode: 400);
                }

                var existing = await db.Companies.FirstOrDefaultAsync(c => c.EmailDomain == domain && c.Id != id, cancellationToken);
                if (existing is not null)
                {
                    return Results.Json(new { message = "Domain already exists" }, statusCode: 409);
                }

                company.EmailDomain = domain;
            }
        }

        if (!string.IsNullOrWhiteSpace(request.Name))
        {
            company.Name = request.Name.Trim();
        }

        if (!string.IsNullOrWhiteSpace(request.Industry))
        {
            company.Industry = request.Industry.Trim();
        }

        if (!string.IsNullOrWhiteSpace(request.Size))
        {
            if (!CompanyValidation.ValidSizes.Contains(request.Size))
            {
                return Results.Json(new { message = $"Invalid size: {request.Size}" }, statusCode: 400);
            }

            company.Size = request.Size;
        }

        if (!string.IsNullOrWhiteSpace(request.Country))
        {
            company.Country = request.Country.Trim();
        }

        if (!string.IsNullOrWhiteSpace(request.SubscriptionTier))
        {
            if (!CompanyValidation.ValidSubscriptionTiers.Contains(request.SubscriptionTier))
            {
                return Results.Json(new { message = $"Invalid subscription tier: {request.SubscriptionTier}" }, statusCode: 400);
            }

            company.SubscriptionTier = request.SubscriptionTier;
        }

        await db.SaveChangesAsync(cancellationToken);

        var userCount = await db.Users.CountAsync(u => u.CompanyId == id && u.IsActive, cancellationToken);

        return Results.Ok(new CompanyDetail(company.Id, company.Name, company.EmailDomain, company.Industry, company.Size, company.Country, company.SubscriptionTier, company.CreatedAt, userCount));
    }

    private static async Task<IResult> UpdateSettingsAsync(
        Guid id,
        UpdateCompanySettingsRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role) || (currentUser.Role != Roles.SuperAdmin && currentUser.CompanyId != id.ToString()))
        {
            return Results.Forbid();
        }

        var company = await db.Companies.FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (company is null)
        {
            return Results.Json(new { message = "Company not found" }, statusCode: 404);
        }

        if (!string.IsNullOrWhiteSpace(request.SurveyFrequency)) company.Settings.SurveyFrequency = request.SurveyFrequency;
        if (request.MicroclimateEnabled.HasValue) company.Settings.MicroclimateEnabled = request.MicroclimateEnabled.Value;
        if (request.AiInsightsEnabled.HasValue) company.Settings.AiInsightsEnabled = request.AiInsightsEnabled.Value;
        if (request.AnonymousSurveys.HasValue) company.Settings.AnonymousSurveys = request.AnonymousSurveys.Value;
        if (request.DataRetentionDays.HasValue) company.Settings.DataRetentionDays = request.DataRetentionDays.Value;
        if (!string.IsNullOrWhiteSpace(request.Timezone)) company.Settings.Timezone = request.Timezone;
        if (!string.IsNullOrWhiteSpace(request.Language)) company.Settings.Language = request.Language;

        if (request.LogoUrl is not null) company.Branding.LogoUrl = request.LogoUrl;
        if (!string.IsNullOrWhiteSpace(request.PrimaryColor)) company.Branding.PrimaryColor = request.PrimaryColor;
        if (!string.IsNullOrWhiteSpace(request.SecondaryColor)) company.Branding.SecondaryColor = request.SecondaryColor;
        if (!string.IsNullOrWhiteSpace(request.FontFamily)) company.Branding.FontFamily = request.FontFamily;
        if (request.CustomCss is not null) company.Branding.CustomCss = request.CustomCss;

        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(new CompanySettingsResponse(
            company.Id,
            new CompanySettingsDto(company.Settings.SurveyFrequency, company.Settings.MicroclimateEnabled, company.Settings.AiInsightsEnabled, company.Settings.AnonymousSurveys, company.Settings.DataRetentionDays, company.Settings.Timezone, company.Settings.Language),
            new CompanyBrandingDto(company.Branding.LogoUrl, company.Branding.PrimaryColor, company.Branding.SecondaryColor, company.Branding.FontFamily, company.Branding.CustomCss)));
    }
}
