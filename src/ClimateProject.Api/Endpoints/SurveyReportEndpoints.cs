using System.Globalization;
using System.Security.Claims;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Exports;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Reports.SurveyReports;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// The «Generar informe» wizard's three routes: what a survey can be reported by, what a given
/// choice would produce, and the PDF itself.
///
/// ## Same door as the results screen
///
/// Every route resolves the survey and authorises the caller exactly as
/// <c>GET /surveys/{id}/results</c> does -- <see cref="SurveyEndpoints.CanAdminister"/>: TIMS
/// (super_admin) for any company, a company_admin for their own (the ruling of 14 Nov 2026) --
/// and aggregates through the same <see cref="SurveyAggregateLoader"/>. A report that could
/// read a survey the results screen refuses, or read it differently, would be a second policy.
///
/// ## The PDF is computed when it is asked for, and kept nowhere
///
/// Nothing is stored: the file is built from the responses as they are at that moment and
/// streamed. A saved report lives on <c>/admin/reports</c>, with its own share links and
/// schedules, and every one of those surfaces would have to learn the cross tables before a
/// stored copy of this document could be offered safely. The download is audited as an
/// export, like every other file of results.
/// </summary>
public static class SurveyReportEndpoints
{
    public static void MapSurveyReportEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/surveys").RequireAuthorization();

        group.MapGet("/{id:guid}/report/options", OptionsAsync);
        group.MapGet("/{id:guid}/report/preview", PreviewAsync);
        group.MapGet("/{id:guid}/export/report", ExportAsync)
            .WithMetadata(new AuditSensitiveReadAttribute(AuditVerbs.Export));
    }

    // ------------------------------------------------------------------
    // Routes
    // ------------------------------------------------------------------

    private static async Task<IResult> OptionsAsync(
        Guid id,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (loaded, failure) = await LoadAsync(id, lang, principal, db, cancellationToken);
        if (failure is not null)
        {
            return failure;
        }

        var context = loaded!;
        var whole = context.Whole;
        var departments = whole.Breakdowns
            .FirstOrDefault(b => string.Equals(b.Dimension, SurveySegmentSelector.DepartmentField, StringComparison.Ordinal))?
            .Segments.Where(s => !s.IsSuppressed)
            .OrderBy(s => s.Label, StringComparer.Create(CultureInfo.InvariantCulture, ignoreCase: true))
            .Select(s => new SurveyReportDepartmentOption(s.Key, s.Label, s.RespondentCount, s.Headcount))
            .ToList() ?? [];

        var others = await db.Surveys
            .AsNoTracking()
            .Where(s => s.CompanyId == context.Survey.CompanyId && s.Id != context.Survey.Id && s.Status != SurveyStatuses.Draft)
            .OrderByDescending(s => s.CreatedAt)
            .Take(30)
            .Select(s => new { s.Id, s.TitleEn, s.TitleEs, s.Language, s.Status, s.EndDate })
            .ToListAsync(cancellationToken);

        var comparable = others
            .Select(s => new SurveyReportComparableSurvey(
                s.Id,
                SurveyContent.Resolve(s.TitleEn, s.TitleEs, context.Locale, s.Language, "title", []),
                s.Status,
                s.EndDate))
            .ToList();

        return Results.Ok(new SurveyReportOptionsResponse(
            context.Survey.Id,
            context.Title,
            context.Survey.Status,
            context.ResolvedLocale,
            whole.IsSuppressed,
            whole.Summary.CompletedCount,
            whole.Summary.InvitedCount,
            departments,
            SurveyReportBuilder.Variables(whole, context.Labels, context.ResolvedLocale),
            comparable,
            SurveyReportSections.All,
            SurveyReportSections.Default,
            SurveyReportOptions.MaxCrosses,
            context.Scale.Key()));
    }

    private static async Task<IResult> PreviewAsync(
        Guid id,
        string? lang,
        string? sections,
        string[]? department,
        string[]? cross,
        string? compare,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (model, failure) = await BuildAsync(id, lang, sections, department, cross, compare, principal, db, cancellationToken);
        if (failure is not null)
        {
            return failure;
        }

        // The page count is the real one: the preview renders the document it describes, so
        // «≈ 14 páginas» in the wizard is a measurement of this exact choice, not an estimate.
        var pdf = SurveyReportPdf.Build(model!);
        return Results.Ok(new SurveyReportPreviewResponse(
            pdf.PageCount,
            model!.DisclosedCellCount,
            model.ProtectedCellCount,
            model.Departments.Count,
            model.OmittedDepartmentCount,
            [.. model.Crosses.Select(c => new SurveyReportCrossPreview(
                c.Table.RowField,
                c.Table.ColumnField,
                c.RowName,
                c.ColumnName,
                c.Table.Rows.Count,
                c.Table.Columns.Count,
                c.Table.ColumnField is null ? c.Table.Rows.Count : c.Table.Cells.Count,
                c.Table.ColumnField is null ? c.Table.Rows.Count : c.Table.DisclosedCount,
                c.Table.ProtectedCount))]));
    }

    private static async Task<IResult> ExportAsync(
        Guid id,
        string? lang,
        string? sections,
        string[]? department,
        string[]? cross,
        string? compare,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        AuditEntry audit,
        CancellationToken cancellationToken)
    {
        var (model, failure) = await BuildAsync(id, lang, sections, department, cross, compare, principal, db, cancellationToken);
        if (failure is not null)
        {
            return failure;
        }

        // Filed under the survey's company, as SurveyEndpoints files a close: a TIMS operator's
        // user row may carry no company, and the middleware writes no row it cannot attribute.
        var companyId = await db.Surveys.AsNoTracking().Where(s => s.Id == id).Select(s => s.CompanyId).FirstAsync(cancellationToken);
        if (await SurveyEndpoints.ResolveActingUserIdAsync(principal.GetCurrentUser(), db, cancellationToken) is { } actorId)
        {
            audit.AttributeTo(actorId, companyId);
        }

        var bytes = SurveyReportPdf.Build(model!).ToBytes();
        return Results.File(bytes, "application/pdf", FileName(model!));
    }

    // ------------------------------------------------------------------
    // Loading
    // ------------------------------------------------------------------

    internal sealed record LoadedSurvey(
        Survey Survey,
        string Locale,
        string ResolvedLocale,
        string? Title,
        SurveyAggregationInputs Inputs,
        SurveyAggregate Whole,
        SurveyExportLabels Labels,
        Company? Company,
        ScoreScale Scale);

    private static async Task<(LoadedSurvey? Loaded, IResult? Failure)> LoadAsync(
        Guid id,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var survey = await db.Surveys.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (survey is null)
        {
            return (null, SurveyResultsEndpoints.SurveyNotFound());
        }

        if (!SurveyEndpoints.CanAdminister(currentUser, survey.CompanyId))
        {
            return (null, Results.Forbid());
        }

        var locale = SurveyContent.ResolveRequestLocale(lang, survey.Language);
        var fallbackFields = new List<string>();
        var inputs = await SurveyAggregateLoader.LoadInputsAsync(db, survey, locale, fallbackFields, cancellationToken);
        var whole = inputs.Compute();
        var resolvedLocale = LocalizedContent.Resolve(survey.TitleEn, survey.TitleEs, locale, survey.Language).ResolvedLocale ?? locale;
        var title = SurveyContent.Resolve(survey.TitleEn, survey.TitleEs, locale, survey.Language, "title", fallbackFields);

        // The report's chrome follows what the caller asked to read, like the results screen's.
        var chrome = ContentLanguages.NormaliseLocale(lang) ?? resolvedLocale;
        var labels = await SurveyExportEndpoints.LoadLabelsAsync(survey.CompanyId, chrome, db, cancellationToken);
        var company = await db.Companies.AsNoTracking().FirstOrDefaultAsync(c => c.Id == survey.CompanyId, cancellationToken);
        var scale = ScoreScales.Parse(company?.Settings.ResultScale);

        return (new LoadedSurvey(survey, locale, chrome, title, inputs, whole, labels, company, scale), null);
    }

    private static async Task<(SurveyReportModel? Model, IResult? Failure)> BuildAsync(
        Guid id,
        string? lang,
        string? sections,
        string[]? department,
        string[]? cross,
        string? compare,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (!SurveyReportOptions.TryParse(sections, department, cross, compare, out var options, out var parseError))
        {
            return (null, BadRequest(parseError!));
        }

        var (loaded, failure) = await LoadAsync(id, lang, principal, db, cancellationToken);
        if (failure is not null)
        {
            return (null, failure);
        }

        var context = loaded!;

        // Every cross names variables this survey actually has. Checked here, while the caller
        // is still looking at the request, rather than drawn as an empty table they would have
        // to puzzle out.
        var variables = SurveyReportBuilder.Variables(context.Whole, context.Labels, context.ResolvedLocale);
        foreach (var request in options.Crosses)
        {
            foreach (var field in new[] { request.RowField, request.ColumnField }.OfType<string>())
            {
                if (!variables.Any(v => string.Equals(v.Field, field, StringComparison.Ordinal)))
                {
                    return (null, BadRequest(
                        $"Cross variable '{field}' is not one of this survey's variables"
                        + (variables.Count == 0 ? "; it has none with two or more values." : $": {string.Join(", ", variables.Select(v => v.Field))}.")));
                }
            }
        }

        if (options.DepartmentIds is { } departmentIds)
        {
            var known = await db.Departments
                .AsNoTracking()
                .Where(d => d.CompanyId == context.Survey.CompanyId && departmentIds.Contains(d.Id))
                .Select(d => d.Id)
                .ToListAsync(cancellationToken);
            var unknown = departmentIds.Where(d => !known.Contains(d)).ToList();
            if (unknown.Count > 0)
            {
                return (null, BadRequest($"department names {unknown.Count} department(s) that do not belong to this survey's company."));
            }
        }

        SurveyAggregate? compareAggregate = null;
        string? compareTitle = null;
        if (options.CompareSurveyId is { } compareId)
        {
            var earlier = await db.Surveys.AsNoTracking().FirstOrDefaultAsync(s => s.Id == compareId, cancellationToken);

            // The company clause is what keeps a comparison inside one tenant: another
            // company's survey id reads as unknown, never as a 403 that confirms it exists.
            if (earlier is null || earlier.CompanyId != context.Survey.CompanyId || earlier.Id == context.Survey.Id)
            {
                return (null, BadRequest("compare must name another survey of the same company."));
            }

            if (earlier.Status == SurveyStatuses.Draft)
            {
                return (null, BadRequest("compare names a draft, which has no results to compare with."));
            }

            var earlierFallback = new List<string>();
            compareAggregate = await SurveyAggregateLoader.ComputeAsync(db, earlier, context.Locale, earlierFallback, cancellationToken);
            compareTitle = SurveyContent.Resolve(earlier.TitleEn, earlier.TitleEs, context.Locale, earlier.Language, "title", earlierFallback);
        }

        var copy = SurveyReportCopy.For(context.ResolvedLocale);
        var (criticalDefault, opportunityDefault, strengthDefault) = copy.DefaultBandNames;
        var settings = context.Company?.Settings ?? new CompanySettings();
        var bands = new SurveyReportBands(
            settings.ResultBandOpportunityMin,
            settings.ResultBandStrengthMin,
            string.IsNullOrWhiteSpace(settings.ResultBandCriticalName) ? criticalDefault : settings.ResultBandCriticalName,
            string.IsNullOrWhiteSpace(settings.ResultBandOpportunityName) ? opportunityDefault : settings.ResultBandOpportunityName,
            string.IsNullOrWhiteSpace(settings.ResultBandStrengthName) ? strengthDefault : settings.ResultBandStrengthName);

        var model = SurveyReportBuilder.Build(new SurveyReportSource(
            context.ResolvedLocale,
            context.Company?.Name,
            context.Title,
            context.Survey.Status,
            CompanyNow(settings.Timezone),
            context.Scale,
            bands,
            context.Inputs,
            context.Whole,
            context.Labels,
            options,
            compareTitle,
            compareAggregate));

        return (model, null);
    }

    /// <summary>
    /// "Now" on the company's wall clock, so the date printed on the cover is the client's
    /// date: an evening download in Costa Rica is still the same day there, though UTC has
    /// moved on.
    /// </summary>
    private static DateTimeOffset CompanyNow(string? timezone)
    {
        var now = DateTimeOffset.UtcNow;
        if (string.IsNullOrWhiteSpace(timezone))
        {
            return now;
        }

        try
        {
            return TimeZoneInfo.ConvertTime(now, TimeZoneInfo.FindSystemTimeZoneById(timezone));
        }
        catch (Exception exception) when (exception is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            return now;
        }
    }

    /// <summary>«informe-clima-organizacional-2026.pdf»: the survey's title as ASCII, never an id a reader cannot place.</summary>
    internal static string FileName(SurveyReportModel model)
    {
        var prefix = model.Locale == "es" ? "informe" : "report";
        var slug = CompanyExportEndpoints.Slug(model.SurveyTitle);
        return slug.Length == 0 ? $"{prefix}.pdf" : $"{prefix}-{slug}.pdf";
    }

    private static IResult BadRequest(string message) => Results.Json(new ErrorResponse(message), statusCode: 400);
}

/// <summary>A department the wizard can scope the report to.</summary>
public sealed record SurveyReportDepartmentOption(string Id, string? Name, int RespondentCount, int? Headcount);

/// <summary>An earlier survey the report can compare with.</summary>
public sealed record SurveyReportComparableSurvey(Guid Id, string? Title, string Status, DateTimeOffset? EndDate);

/// <summary>What the wizard needs to offer its choices for one survey.</summary>
public sealed record SurveyReportOptionsResponse(
    Guid SurveyId,
    string? Title,
    string Status,
    string ResolvedLocale,
    bool IsSuppressed,
    int CompletedCount,
    int? InvitedCount,
    IReadOnlyList<SurveyReportDepartmentOption> Departments,
    IReadOnlyList<SurveyReportVariable> Variables,
    IReadOnlyList<SurveyReportComparableSurvey> ComparableSurveys,
    IReadOnlyList<string> Sections,
    IReadOnlyList<string> DefaultSections,
    int MaxCrosses,
    string Scale);

/// <summary>One cross as the preview counts it. A protected cell is counted, never described.</summary>
public sealed record SurveyReportCrossPreview(
    string RowField,
    string? ColumnField,
    string RowName,
    string? ColumnName,
    int Rows,
    int Columns,
    int Groups,
    int Disclosed,
    int Protected);

/// <summary>What a given choice would produce.</summary>
public sealed record SurveyReportPreviewResponse(
    int PageCount,
    int DisclosedCells,
    int ProtectedCells,
    int DepartmentCount,
    int OmittedDepartmentCount,
    IReadOnlyList<SurveyReportCrossPreview> Crosses);
