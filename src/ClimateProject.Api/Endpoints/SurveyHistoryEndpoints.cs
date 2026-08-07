using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// The read half of #106: a survey's content history (<c>survey_versions</c>) and its
/// change history (<c>survey_audit_logs</c>).
///
/// Its own file with its own <c>MapGroup("/surveys")</c> rather than four more routes in
/// SurveyEndpoints -- minimal-API groups are additive, the routes here are read-only, and
/// keeping the two apart means the 1200-line authoring surface is not where a reviewer
/// looks for the history contract.
///
/// Everything is admin-gated by <see cref="SurveyEndpoints.CanAdminister"/>. Version and
/// audit history expose who authored what and when, which is a company-administration
/// surface; a respondent's view of a survey is <c>/surveys/my</c>.
/// </summary>
public static class SurveyHistoryEndpoints
{
    public static void MapSurveyHistoryEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/surveys").RequireAuthorization();

        group.MapGet("/{id:guid}/versions", ListVersionsAsync);

        // "compare" cannot shadow /{versionId:guid}: the route constraint means the literal
        // never parses as an id, exactly as with /surveys/scoped.
        group.MapGet("/{id:guid}/versions/compare", CompareVersionsAsync);
        group.MapGet("/{id:guid}/versions/{versionId:guid}", GetVersionAsync);

        group.MapGet("/{id:guid}/history", GetHistoryAsync);
    }

    /// <summary>
    /// A page of audit entries. Generous, but bounded: a survey that was edited two hundred
    /// times should not be able to make one request return two hundred rows of jsonb.
    /// </summary>
    private const int DefaultHistoryLimit = 100;
    private const int MaxHistoryLimit = 500;

    // ------------------------------------------------------------------
    // Versions
    // ------------------------------------------------------------------

    private static async Task<IResult> ListVersionsAsync(
        Guid id,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (survey, denial) = await LoadAsync(id, principal, db, cancellationToken);
        if (denial is not null)
        {
            return denial;
        }

        var versions = await db.SurveyVersions
            .Where(v => v.SurveyId == survey!.Id)
            .OrderByDescending(v => v.VersionNumber)
            .ToListAsync(cancellationToken);

        var authors = await LoadAuthorsAsync(db, versions, cancellationToken);
        var hasResponses = await HasResponsesAsync(db, survey!, cancellationToken);

        var summaries = versions.Select(version =>
        {
            var content = SurveyVersioning.ReadContent(version);
            var language = ContentLanguages.NormaliseLanguage(content.Settings.Language) ?? survey!.Language;
            var locale = SurveyContent.ResolveRequestLocale(lang, language);
            var fallbackFields = new List<string>();
            var title = SurveyContent.Resolve(version.TitleEn, version.TitleEs, locale, language, "title", fallbackFields);
            var isCurrent = version.VersionNumber == survey!.Version;

            authors.TryGetValue(version.CreatedBy, out var author);

            return new SurveyVersionSummary(
                version.Id,
                version.SurveyId,
                version.VersionNumber,
                title,
                language,
                ResolvedLocaleOf(version.TitleEn, version.TitleEs, locale, language),
                fallbackFields,
                version.Reason,
                version.Changes,
                content.Questions.Count,
                version.CreatedBy,
                author?.Name,
                author?.Email,
                version.CreatedAt,
                isCurrent,
                isCurrent && hasResponses);
        }).ToList();

        return Results.Ok(new SurveyVersionListResponse(
            survey!.Id, survey.Version, survey.ResponseCount, summaries));
    }

    private static async Task<IResult> GetVersionAsync(
        Guid id,
        Guid versionId,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (survey, denial) = await LoadAsync(id, principal, db, cancellationToken);
        if (denial is not null)
        {
            return denial;
        }

        // Scoped to the survey in the path, not looked up by id alone: a version id from
        // another tenant's survey must 404 rather than be served because the caller can
        // administer the survey they named.
        var version = await db.SurveyVersions
            .FirstOrDefaultAsync(v => v.Id == versionId && v.SurveyId == survey!.Id, cancellationToken);
        if (version is null)
        {
            return VersionNotFound();
        }

        var authors = await LoadAuthorsAsync(db, [version], cancellationToken);
        var hasResponses = await HasResponsesAsync(db, survey!, cancellationToken);

        return Results.Ok(ToDetail(version, survey!, authors, hasResponses, lang));
    }

    private static async Task<IResult> CompareVersionsAsync(
        Guid id,
        int? from,
        int? to,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (survey, denial) = await LoadAsync(id, principal, db, cancellationToken);
        if (denial is not null)
        {
            return denial;
        }

        if (from is null || to is null)
        {
            return Results.Json(
                new { message = "Both 'from' and 'to' version numbers are required." },
                statusCode: 400);
        }

        if (from.Value == to.Value)
        {
            return Results.Json(
                new { message = "'from' and 'to' must be different versions." },
                statusCode: 400);
        }

        var numbers = new[] { from.Value, to.Value };
        var rows = await db.SurveyVersions
            .Where(v => v.SurveyId == survey!.Id && numbers.Contains(v.VersionNumber))
            .ToListAsync(cancellationToken);

        var fromRow = rows.FirstOrDefault(v => v.VersionNumber == from.Value);
        var toRow = rows.FirstOrDefault(v => v.VersionNumber == to.Value);
        if (fromRow is null || toRow is null)
        {
            var missing = fromRow is null ? from.Value : to.Value;
            return Results.Json(
                new { message = $"This survey has no version {missing}." },
                statusCode: 404);
        }

        var authors = await LoadAuthorsAsync(db, rows, cancellationToken);
        var hasResponses = await HasResponsesAsync(db, survey!, cancellationToken);

        var changes = SurveyVersioning.Diff(
            SurveyVersioning.ReadContent(fromRow),
            SurveyVersioning.ReadContent(toRow));

        return Results.Ok(new SurveyVersionComparison(
            survey!.Id,
            ToDetail(fromRow, survey, authors, hasResponses, lang),
            ToDetail(toRow, survey, authors, hasResponses, lang),
            changes));
    }

    private static SurveyVersionDetail ToDetail(
        SurveyVersion version,
        Survey survey,
        IReadOnlyDictionary<Guid, SurveyVersionAuthor> authors,
        bool hasResponses,
        string? lang)
    {
        var content = SurveyVersioning.ReadContent(version);

        // The version's OWN language, not the survey's. A survey re-authored from
        // Spanish-only to 'both' must not make its earlier snapshots claim a second
        // translation they never had -- that would be the silent substitution #195 exists
        // to prevent, aimed at history instead of at a live read.
        var language = ContentLanguages.NormaliseLanguage(content.Settings.Language) ?? survey.Language;
        var locale = SurveyContent.ResolveRequestLocale(lang, language);
        var fallbackFields = new List<string>();

        var questions = content.Questions
            .OrderBy(q => q.Order)
            .Select(question =>
            {
                var path = $"questions[{question.Order}]";
                return new SurveyQuestionDto(
                    question.Id,
                    SurveyContent.Resolve(question.TextEn, question.TextEs, locale, language, $"{path}.text", fallbackFields),
                    question.Type,
                    ToOptionDtos(question.Options, locale, language, path, fallbackFields),
                    question.ScaleMin,
                    question.ScaleMax,
                    SurveyContent.Resolve(question.ScaleLabelMinEn, question.ScaleLabelMinEs, locale, language, $"{path}.scaleLabelMin", fallbackFields),
                    SurveyContent.Resolve(question.ScaleLabelMaxEn, question.ScaleLabelMaxEs, locale, language, $"{path}.scaleLabelMax", fallbackFields),
                    question.Required,
                    question.CommentRequired,
                    SurveyContent.Resolve(question.CommentPromptEn, question.CommentPromptEs, locale, language, $"{path}.commentPrompt", fallbackFields),
                    question.Order,
                    question.Category);
            })
            .ToList();

        var settings = new SurveySettingsDto(
            content.Settings.Anonymous,
            content.Settings.AllowPartialResponses,
            content.Settings.RandomizeQuestions,
            content.Settings.ShowProgress,
            content.Settings.AutoSave,
            content.Settings.TimeLimitMinutes,
            content.Settings.ResponseLimit,
            content.Settings.NotificationSendInvitations,
            content.Settings.NotificationSendReminders,
            content.Settings.NotificationReminderFrequencyDays,
            SurveyContent.Resolve(
                content.Settings.InvitationCustomMessageEn, content.Settings.InvitationCustomMessageEs,
                locale, language, "settings.invitationCustomMessage", fallbackFields),
            SurveyContent.Resolve(
                content.Settings.InvitationCustomSubjectEn, content.Settings.InvitationCustomSubjectEs,
                locale, language, "settings.invitationCustomSubject", fallbackFields),
            content.Settings.InvitationIncludeCredentials,
            content.Settings.InvitationSendImmediately,
            content.Settings.InvitationBrandingEnabled);

        authors.TryGetValue(version.CreatedBy, out var author);
        var isCurrent = version.VersionNumber == survey.Version;

        return new SurveyVersionDetail(
            version.Id,
            version.SurveyId,
            version.VersionNumber,
            SurveyContent.Resolve(version.TitleEn, version.TitleEs, locale, language, "title", fallbackFields),
            SurveyContent.Resolve(version.DescriptionEn, version.DescriptionEs, locale, language, "description", fallbackFields),
            content.Settings.Type,
            language,
            ResolvedLocaleOf(version.TitleEn, version.TitleEs, locale, language),
            fallbackFields,
            content.Settings.StartDate,
            content.Settings.EndDate,
            content.Settings.DepartmentIds,
            content.Settings.TargetAudienceCount,
            questions,
            settings,
            version.Reason,
            version.Changes,
            version.CreatedBy,
            author?.Name,
            author?.Email,
            version.CreatedAt,
            isCurrent,
            isCurrent && hasResponses);
    }

    private static List<SurveyQuestionOptionDto>? ToOptionDtos(
        IReadOnlyList<SurveyVersionOptionSnapshot> options,
        string locale,
        string language,
        string fieldPathPrefix,
        List<string> fallbackFields)
    {
        if (options.Count == 0)
        {
            return null;
        }

        var dtos = new List<SurveyQuestionOptionDto>(options.Count);
        foreach (var option in options.OrderBy(o => o.Order))
        {
            var label = LocalizedContent.Resolve(option.LabelEn, option.LabelEs, locale, language);
            if (label.IsFallback)
            {
                fallbackFields.Add($"{fieldPathPrefix}.options[{option.Order}].label");
            }

            dtos.Add(new SurveyQuestionOptionDto(option.Order, option.Value, label.Text));
        }

        return dtos;
    }

    /// <summary>
    /// The locale the payload is ACTUALLY in, named by the title, exactly as
    /// <c>SurveyEndpoints.ToDetailAsync</c> does it. A Spanish-only version fetched with
    /// <c>?lang=en</c> reports "es"; reporting "en" would be the silent substitution.
    /// </summary>
    private static string ResolvedLocaleOf(string? titleEn, string? titleEs, string locale, string language)
        => LocalizedContent.Resolve(titleEn, titleEs, locale, language).ResolvedLocale ?? locale;

    // ------------------------------------------------------------------
    // Audit history
    // ------------------------------------------------------------------

    private static async Task<IResult> GetHistoryAsync(
        Guid id,
        string? action,
        int? limit,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (survey, denial) = await LoadAsync(id, principal, db, cancellationToken);
        if (denial is not null)
        {
            return denial;
        }

        if (action is not null && !SurveyAuditActions.IsRecorded(action))
        {
            return Results.Json(
                new { message = $"Invalid action: {action}. Expected one of: {string.Join(", ", SurveyAuditActions.All)}" },
                statusCode: 400);
        }

        var take = Math.Clamp(limit ?? DefaultHistoryLimit, 1, MaxHistoryLimit);

        var query = db.SurveyAuditLogs.Where(a => a.SurveyId == survey!.Id);
        if (action is not null)
        {
            query = query.Where(a => a.Action == action);
        }

        var rows = await query
            .OrderByDescending(a => a.Timestamp)
            .ThenByDescending(a => a.Id)
            .Take(take)
            .ToListAsync(cancellationToken);

        var entries = rows
            .Select(a => new SurveyAuditEntry(
                a.Id, a.SurveyId, a.Action, a.EntityType, a.EntityId,
                SurveyAuditChangeSet.FromJson(a.Changes),
                a.UserId, a.UserName, a.UserEmail, a.UserRole, a.Timestamp, a.IpAddress))
            .ToList();

        return Results.Ok(new SurveyHistoryResponse(survey!.Id, entries));
    }

    // ------------------------------------------------------------------
    // Shared
    // ------------------------------------------------------------------

    private sealed record SurveyVersionAuthor(string Name, string Email);

    private static async Task<(Survey? Survey, IResult? Denial)> LoadAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var survey = await db.Surveys.FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (survey is null)
        {
            return (null, Results.Json(new { message = "Survey not found" }, statusCode: 404));
        }

        return SurveyEndpoints.CanAdminister(principal.GetCurrentUser(), survey.CompanyId)
            ? (survey, null)
            : (null, Results.Forbid());
    }

    /// <summary>
    /// Author names for a set of versions, joined at read time.
    ///
    /// Unlike an audit entry -- which denormalises the actor precisely so it keeps reading
    /// correctly after a rename -- a version row stores only <c>created_by</c>, so the
    /// current name is the only name available. Reported as nullable rather than as a
    /// placeholder string: a missing name is a fact for the client to render, not copy for
    /// the server to invent (and inventing it would put an untranslated English string in
    /// a payload, which #78 fixed once already).
    /// </summary>
    private static async Task<Dictionary<Guid, SurveyVersionAuthor>> LoadAuthorsAsync(
        ClimateProjectDbContext db,
        IReadOnlyCollection<SurveyVersion> versions,
        CancellationToken cancellationToken)
    {
        if (versions.Count == 0)
        {
            return [];
        }

        var ids = versions.Select(v => v.CreatedBy).Distinct().ToList();
        return await db.Users
            .Where(u => ids.Contains(u.Id))
            .Select(u => new { u.Id, u.Name, u.Email })
            .ToDictionaryAsync(u => u.Id, u => new SurveyVersionAuthor(u.Name, u.Email), cancellationToken);
    }

    private static async Task<bool> HasResponsesAsync(
        ClimateProjectDbContext db,
        Survey survey,
        CancellationToken cancellationToken)
        => survey.ResponseCount > 0
           || await db.Responses.AnyAsync(r => r.SurveyId == survey.Id, cancellationToken);

    private static IResult VersionNotFound()
        => Results.Json(new { message = "Survey version not found" }, statusCode: 404);
}
