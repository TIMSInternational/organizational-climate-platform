using System.Security.Claims;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Application.RespondentContent;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// What a client reads, edited rather than coded (ruled 2026-11-19,
/// <c>docs/decisions/editable-respondent-content.md</c>): a company's own wording and a survey's,
/// over the fixed <see cref="RespondentContentRegistry"/>.
/// </summary>
/// <remarks>
/// <para><b>Routes.</b> <c>GET/PUT /admin/companies/{companyId}/respondent-content</c> -- a super
/// admin for any company, a company admin for their own, 403 for everyone else.
/// <c>GET/PUT /surveys/{surveyId}/respondent-content</c> -- whoever administers the survey reads
/// it; a company admin writes while it is draft, scheduled or active, a super admin in any status
/// but archived (<see cref="RespondentContentPermissions"/>); archived is 409 for everybody.</para>
///
/// <para><b>The PUT</b> is partial (only the keys sent are touched), clears on an empty value, and
/// validates the whole body before the first write (<see cref="RespondentContentValidation"/>),
/// so a refusal leaves nothing half-applied. At the survey level a key that already had a survey
/// column (<see cref="RespondentContentEntry.LegacyColumn"/>) is written THERE, never to the
/// table, so the existing «Textos para quien responde» and «Correo de invitación» dialogs and this
/// route read and write the same value.</para>
///
/// <para><b>Audited and attributed to the company</b>: the middleware writes the row; the handler
/// names the company (a TIMS operator has none of their own, and would otherwise write no row)
/// and records, per <c>{locale}.{key}</c>, whether a text was set, changed or cleared -- never the
/// text. A survey write also enters the survey's own history.</para>
/// </remarks>
public static class RespondentContentEndpoints
{
    public static void MapRespondentContentEndpoints(this WebApplication app)
    {
        // Neither literal can shadow an existing route: `/admin/companies/{id:guid}` and
        // `/surveys/{id:guid}` are followed by a different segment in every other mapping.
        var companies = app.MapGroup("/admin/companies").RequireAuthorization();
        companies.MapGet("/{companyId:guid}/respondent-content", GetCompanyAsync);
        companies.MapPut("/{companyId:guid}/respondent-content", PutCompanyAsync);

        var surveys = app.MapGroup("/surveys").RequireAuthorization();
        surveys.MapGet("/{surveyId:guid}/respondent-content", GetSurveyAsync);
        surveys.MapPut("/{surveyId:guid}/respondent-content", PutSurveyAsync);
    }

    // ------------------------------------------------------------------
    // Company level
    // ------------------------------------------------------------------

    private static async Task<IResult> GetCompanyAsync(
        Guid companyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!RespondentContentPermissions.CanEditCompany(currentUser.Role, currentUser.CompanyId, companyId))
        {
            return Results.Forbid();
        }

        var language = await CompanyLanguageAsync(db, companyId, cancellationToken);
        if (language is null)
        {
            return CompanyNotFound();
        }

        return Results.Ok(CompanyView(companyId, language, await RespondentContentStore.LoadAsync(db, companyId, cancellationToken)));
    }

    private static async Task<IResult> PutCompanyAsync(
        Guid companyId,
        UpdateRespondentContentRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!RespondentContentPermissions.CanEditCompany(currentUser.Role, currentUser.CompanyId, companyId))
        {
            return Results.Forbid();
        }

        var language = await CompanyLanguageAsync(db, companyId, cancellationToken);
        if (language is null)
        {
            return CompanyNotFound();
        }

        // Filed under the company whose wording this is, whoever the caller is.
        var actorId = await SurveyEndpoints.ResolveActingUserIdAsync(currentUser, db, cancellationToken);
        if (actorId is { } actor)
        {
            audit.AttributeTo(actor, companyId);
        }

        audit.SetResourceId(companyId);

        // Everything checked before the first write.
        var refusal = RespondentContentValidation.Prepare(request.Values, out var writes);
        if (refusal is not null)
        {
            return Refuse(refusal);
        }

        var rows = await db.RespondentContentOverrides
            .Where(o => o.CompanyId == companyId && o.SurveyId == null)
            .ToListAsync(cancellationToken);
        Apply(db, writes, rows, companyId, surveyId: null, surveySettings: null, actorId, DateTimeOffset.UtcNow, audit);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(CompanyView(companyId, language, await RespondentContentStore.LoadAsync(db, companyId, cancellationToken)));
    }

    // ------------------------------------------------------------------
    // Survey level
    // ------------------------------------------------------------------

    private static async Task<IResult> GetSurveyAsync(
        Guid surveyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var survey = await db.Surveys.AsNoTracking().FirstOrDefaultAsync(s => s.Id == surveyId, cancellationToken);
        if (survey is null)
        {
            return SurveyNotFound();
        }

        if (!SurveyEndpoints.CanAdminister(currentUser, survey.CompanyId))
        {
            return Results.Forbid();
        }

        return Results.Ok(SurveyView(survey, currentUser.Role, await RespondentContentStore.LoadAsync(db, survey, cancellationToken)));
    }

    private static async Task<IResult> PutSurveyAsync(
        Guid surveyId,
        UpdateRespondentContentRequest request,
        ClaimsPrincipal principal,
        HttpContext http,
        ClimateProjectDbContext db,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var survey = await db.Surveys.FirstOrDefaultAsync(s => s.Id == surveyId, cancellationToken);
        if (survey is null)
        {
            return SurveyNotFound();
        }

        if (!SurveyEndpoints.CanAdminister(currentUser, survey.CompanyId))
        {
            return Results.Forbid();
        }

        // survey_audit_logs.user_id is NOT NULL: a change nobody can be held to is refused, the
        // rule every survey write here keeps.
        var actor = await SurveyAuditTrail.ResolveActorAsync(currentUser, http, db, cancellationToken);
        if (actor is null)
        {
            return SurveyEndpoints.ActingUserRequired();
        }

        audit.AttributeTo(actor.UserId, survey.CompanyId);
        audit.SetResourceId(survey.Id);

        switch (RespondentContentPermissions.SurveyLock(currentUser.Role, survey.Status))
        {
            case RespondentContentSurveyLock.Archived:
                return Results.Json(
                    new { message = "An archived survey's respondent texts cannot be changed.", code = AdminRefusals.RespondentContentArchived },
                    statusCode: 409);
            case RespondentContentSurveyLock.Locked:
                return Results.Json(
                    new
                    {
                        message = "This survey is no longer draft, scheduled or active, so only a TIMS super administrator can change its respondent texts.",
                        code = AdminRefusals.RespondentContentLocked,
                    },
                    statusCode: 409);
        }

        var refusal = RespondentContentValidation.Prepare(request.Values, out var writes)
            ?? RespondentContentValidation.RefuseLocalesNotOffered(writes, RespondentContentPermissions.RequiredLocales(survey.Language));
        if (refusal is not null)
        {
            return Refuse(refusal);
        }

        var rows = await db.RespondentContentOverrides
            .Where(o => o.CompanyId == survey.CompanyId && o.SurveyId == survey.Id)
            .ToListAsync(cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var changed = Apply(db, writes, rows, survey.CompanyId, survey.Id, survey.Settings, actor.UserId, now, audit);
        if (changed.Count > 0)
        {
            survey.UpdatedAt = now;
            SurveyAuditTrail.Record(
                db, survey.Id, SurveyAuditActions.Updated, SurveyAuditEntityTypes.Survey, actor, now,
                new SurveyAuditChangeSet(Fields: changed));
        }

        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(SurveyView(survey, currentUser.Role, await RespondentContentStore.LoadAsync(db, survey, cancellationToken)));
    }

    // ------------------------------------------------------------------
    // Shared
    // ------------------------------------------------------------------

    /// <summary>
    /// Applies validated writes to one level. Returns the survey-history paths that changed:
    /// a legacy key's own <c>settings.*</c> path, <c>respondentContent</c> for the rest.
    /// </summary>
    private static List<string> Apply(
        ClimateProjectDbContext db,
        IReadOnlyList<RespondentContentWrite> writes,
        List<RespondentContentOverride> rows,
        Guid companyId,
        Guid? surveyId,
        SurveySettings? surveySettings,
        Guid? actorId,
        DateTimeOffset now,
        AuditEntry audit)
    {
        var changed = new List<string>();
        foreach (var write in writes)
        {
            var entry = write.Entry;
            string? before;

            if (surveySettings is not null && entry.LegacyColumn is { } column)
            {
                // The survey's column IS this key's survey level: written there, never to the table.
                before = RespondentContentLegacy.Read(surveySettings, column, write.Locale);
                if (string.Equals(before, write.Value, StringComparison.Ordinal))
                {
                    continue;
                }

                RespondentContentLegacy.Write(surveySettings, column, write.Locale, write.Value);
                Note(changed, "settings." + char.ToLowerInvariant(column[0]) + column[1..]);
            }
            else
            {
                var row = rows.FirstOrDefault(r =>
                    string.Equals(r.Key, entry.Key, StringComparison.Ordinal)
                    && string.Equals(r.Locale, write.Locale, StringComparison.Ordinal));
                before = row?.Value;
                if (string.Equals(before, write.Value, StringComparison.Ordinal))
                {
                    continue;
                }

                if (write.Value is null)
                {
                    db.RespondentContentOverrides.Remove(row!);
                    rows.Remove(row!);
                }
                else if (row is null)
                {
                    var added = new RespondentContentOverride
                    {
                        Id = Guid.NewGuid(),
                        CompanyId = companyId,
                        SurveyId = surveyId,
                        Key = entry.Key,
                        Locale = write.Locale,
                        Value = write.Value,
                        UpdatedBy = actorId,
                        UpdatedAt = now,
                    };
                    db.RespondentContentOverrides.Add(added);
                    rows.Add(added);
                }
                else
                {
                    row.Value = write.Value;
                    row.UpdatedBy = actorId;
                    row.UpdatedAt = now;
                }

                Note(changed, "respondentContent");
            }

            // A status, never the words: audit_logs is long-retention and read by company admins
            // (AuditEntry.RecordChange). A display choice is not prose, so it is recorded as is.
            audit.RecordChange(
                $"{write.Locale}.{entry.Key}",
                entry.IsDisplay ? before : before is null ? "default" : "set",
                entry.IsDisplay ? write.Value : write.Value is null ? "default" : before is null ? "set" : "changed");
        }

        return changed;
    }

    private static void Note(List<string> changed, string path)
    {
        if (!changed.Contains(path, StringComparer.Ordinal))
        {
            changed.Add(path);
        }
    }

    private static RespondentContentView CompanyView(Guid companyId, string language, RespondentContentSources sources)
        => new(
            RespondentContentLevels.Company,
            companyId,
            SurveyId: null,
            language,
            RespondentContentPermissions.RequiredLocales(language),
            Editable: true,
            SurveyStatus: null,
            RespondentContentEntryDto.All,
            RespondentContentResolver.GroupByLocale(sources.CompanyValues),
            SurveyValues: null,
            RespondentContentResolver.ResolveByLocale(sources));

    private static RespondentContentView SurveyView(Survey survey, string? role, RespondentContentSources sources)
        => new(
            RespondentContentLevels.Survey,
            survey.CompanyId,
            survey.Id,
            survey.Language,
            RespondentContentPermissions.RequiredLocales(survey.Language),
            Editable: RespondentContentPermissions.SurveyLock(role, survey.Status) == RespondentContentSurveyLock.None,
            survey.Status,
            RespondentContentEntryDto.All,
            RespondentContentResolver.GroupByLocale(sources.CompanyValues),
            // The legacy columns first, so a table row for the same key -- which this route never
            // writes -- would show as the one the chain reads.
            RespondentContentResolver.GroupByLocale(RespondentContentLegacy.ValuesOf(survey.Settings).Concat(sources.SurveyValues)),
            RespondentContentResolver.ResolveByLocale(sources));

    private static async Task<string?> CompanyLanguageAsync(ClimateProjectDbContext db, Guid companyId, CancellationToken cancellationToken)
        => await db.Companies.AsNoTracking()
            .Where(c => c.Id == companyId)
            .Select(c => c.Settings.Language)
            .FirstOrDefaultAsync(cancellationToken);

    private static IResult Refuse(RespondentContentRefusal refusal)
        => Results.Json(
            new
            {
                message = refusal.Message,
                code = refusal.Reason switch
                {
                    RespondentContentRefusalReason.UnknownLocale => AdminRefusals.RespondentContentUnknownLocale,
                    RespondentContentRefusalReason.LocaleMismatch => AdminRefusals.RespondentContentLocaleMismatch,
                    RespondentContentRefusalReason.UnknownKey => AdminRefusals.RespondentContentUnknownKey,
                    RespondentContentRefusalReason.TooLong => AdminRefusals.RespondentContentTooLong,
                    RespondentContentRefusalReason.UnknownPlaceholder => AdminRefusals.RespondentContentUnknownPlaceholder,
                    RespondentContentRefusalReason.LocaleNotOffered => AdminRefusals.RespondentContentLocaleNotOffered,
                    _ => AdminRefusals.RespondentContentValueNotAllowed,
                },
                locale = refusal.Locale,
                key = refusal.Key,
                placeholder = refusal.Placeholder,
                maxLength = refusal.MaxLength,
                allowed = refusal.Allowed,
            },
            statusCode: 400);

    private static IResult CompanyNotFound() => Results.Json(new { message = "Company not found" }, statusCode: 404);

    private static IResult SurveyNotFound() => Results.Json(new { message = "Survey not found" }, statusCode: 404);
}
