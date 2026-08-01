using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class SystemSettingsEndpoints
{
    public static void MapSystemSettingsEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/system-settings").RequireAuthorization();

        group.MapGet("", GetAsync);
        group.MapPut("", UpdateAsync);
    }

    private static SystemSettingsDetail ToDetail(SystemSettings s)
        => new(s.LoginEnabled, s.MaintenanceMode, s.MaintenanceMessage, s.MaxLoginAttempts, s.SessionTimeoutMinutes,
            new PasswordPolicyDto(s.PasswordPolicy.MinLength, s.PasswordPolicy.RequireUppercase, s.PasswordPolicy.RequireLowercase, s.PasswordPolicy.RequireNumbers, s.PasswordPolicy.RequireSpecialChars),
            new SystemEmailSettingsDto(s.EmailSettings.SmtpEnabled, s.EmailSettings.FromEmail, s.EmailSettings.SmtpHost, s.EmailSettings.SmtpPort),
            s.UpdatedAt);

    private static async Task<SystemSettings> GetOrCreateAsync(ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var settings = await db.SystemSettings.FirstOrDefaultAsync(cancellationToken);
        if (settings is not null)
        {
            return settings;
        }

        var now = DateTimeOffset.UtcNow;
        settings = new SystemSettings
        {
            Id = Guid.NewGuid(),
            CreatedAt = now,
            UpdatedAt = now,
            LoginEnabled = true,
            MaintenanceMode = false,
            MaxLoginAttempts = 5,
            SessionTimeoutMinutes = 60,
            PasswordPolicy = new PasswordPolicy(),
            EmailSettings = new SystemEmailSettings()
        };
        db.SystemSettings.Add(settings);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return settings;
        }
        catch (DbUpdateException)
        {
            // Lost the race to a concurrent GetOrCreateAsync call: the singleton_guard
            // unique index (see SystemSettingsConfiguration) rejected our insert
            // because another request already created the row (two admin tabs, a
            // refresh racing a StrictMode double-effect). Detach our failed entity
            // and read back whichever row won instead of bubbling up an unhandled
            // 500 or -- worse -- silently leaving a second, invisible duplicate row.
            db.Entry(settings).State = EntityState.Detached;
            var winner = await db.SystemSettings.FirstOrDefaultAsync(cancellationToken);
            if (winner is null)
            {
                throw;
            }

            return winner;
        }
    }

    private static async Task<IResult> GetAsync(
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        var settings = await GetOrCreateAsync(db, cancellationToken);
        return Results.Ok(ToDetail(settings));
    }

    private static async Task<IResult> UpdateAsync(
        UpdateSystemSettingsRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        var settings = await GetOrCreateAsync(db, cancellationToken);

        if (request.LoginEnabled.HasValue) settings.LoginEnabled = request.LoginEnabled.Value;
        if (request.MaintenanceMode.HasValue) settings.MaintenanceMode = request.MaintenanceMode.Value;
        if (request.MaintenanceMessage is not null) settings.MaintenanceMessage = request.MaintenanceMessage;
        if (request.MaxLoginAttempts.HasValue) settings.MaxLoginAttempts = request.MaxLoginAttempts.Value;
        if (request.SessionTimeoutMinutes.HasValue) settings.SessionTimeoutMinutes = request.SessionTimeoutMinutes.Value;

        if (request.PasswordPolicy is not null)
        {
            settings.PasswordPolicy.MinLength = request.PasswordPolicy.MinLength;
            settings.PasswordPolicy.RequireUppercase = request.PasswordPolicy.RequireUppercase;
            settings.PasswordPolicy.RequireLowercase = request.PasswordPolicy.RequireLowercase;
            settings.PasswordPolicy.RequireNumbers = request.PasswordPolicy.RequireNumbers;
            settings.PasswordPolicy.RequireSpecialChars = request.PasswordPolicy.RequireSpecialChars;
        }

        if (request.EmailSettings is not null)
        {
            settings.EmailSettings.SmtpEnabled = request.EmailSettings.SmtpEnabled;
            settings.EmailSettings.FromEmail = request.EmailSettings.FromEmail;
            settings.EmailSettings.SmtpHost = request.EmailSettings.SmtpHost;
            settings.EmailSettings.SmtpPort = request.EmailSettings.SmtpPort;
        }

        settings.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(ToDetail(settings));
    }
}
