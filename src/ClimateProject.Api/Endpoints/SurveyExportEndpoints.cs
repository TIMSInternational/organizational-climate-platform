using System.Security.Claims;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Auditing;
using ClimateProject.Application.Exports;
using ClimateProject.Application.Surveys;
using ClimateProject.Infrastructure.Persistence;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// The legacy export surface -- <c>surveys/[id]/export</c>, <c>/export/csv</c> and
/// <c>/export/pdf</c> -- served from the same aggregation the results screen reads (#122).
///
/// ## Nothing here decides what may be disclosed
///
/// Every route loads through <see cref="SurveyResultsEndpoints.LoadAsync"/>, which is what
/// <c>/results</c>, <c>/statistics</c> and <c>/analytics</c> load through, and hands the
/// resulting <see cref="SurveyAggregate"/> -- already suppressed by
/// <see cref="SurveyAggregation.Compute"/> -- to <see cref="SurveyExport"/>. There is no
/// query in this file, no floor, and no branch on a respondent count. That is the property
/// the slice is for: an export cannot reveal what the screen withholds if it never asks the
/// database anything the screen did not ask.
///
/// ## Audited as an export, not as a read
///
/// All three carry <see cref="AuditSensitiveReadAttribute"/> with
/// <see cref="AuditVerbs.Export"/> rather than <see cref="AuditVerbs.Read"/>. #143 names "who
/// exported this data" as one of the three questions the trail exists to answer, and it is a
/// different question from "who looked at it": a read leaves the data on the server, an export
/// hands the caller a copy to keep, forward and store. Both are recorded; the verb is what
/// lets them be told apart afterwards.
///
/// ## Two formats, one document
///
/// CSV streams and PDF buffers, and that asymmetry is deliberate rather than an oversight --
/// see <see cref="PdfDocument"/> for why a cross-reference table cannot be written before the
/// objects it indexes. Neither format computes anything the other does not.
/// </summary>
public static class SurveyExportEndpoints
{
    /// <summary>The <c>?format=</c> values <see cref="ExportAsync"/> accepts.</summary>
    public const string CsvFormat = "csv";

    /// <inheritdoc cref="CsvFormat"/>
    public const string PdfFormat = "pdf";

    public static void MapSurveyExportEndpoints(this WebApplication app)
    {
        // Its own group over the same prefix, matching what SurveyResultsEndpoints does and
        // for the same reason: same RequireAuthorization, same CanAdminister guard, same
        // 404-then-403 ordering, edited by different work.
        var group = app.MapGroup("/surveys").RequireAuthorization();

        // The two unambiguous routes an admin can paste into an address bar and get a file
        // from, plus the legacy query-string shape. All three are one handler pair.
        group.MapGet("/{id:guid}/export", ExportAsync)
            .WithMetadata(new AuditSensitiveReadAttribute(AuditVerbs.Export));

        group.MapGet("/{id:guid}/export/csv", ExportCsvAsync)
            .WithMetadata(new AuditSensitiveReadAttribute(AuditVerbs.Export));

        group.MapGet("/{id:guid}/export/pdf", ExportPdfAsync)
            .WithMetadata(new AuditSensitiveReadAttribute(AuditVerbs.Export));
    }

    // ------------------------------------------------------------------
    // Routes
    // ------------------------------------------------------------------

    /// <summary>
    /// The legacy shape. <c>?format=csv</c> (the default) or <c>?format=pdf</c>.
    /// </summary>
    /// <remarks>
    /// <b>It does not serve JSON, and does not read the Accept header.</b> The JSON of this
    /// exact aggregate already has a route -- <c>GET /surveys/{id}/analytics</c> -- so a JSON
    /// branch here would be a second name for an existing endpoint, and the one thing worse
    /// than two names is two names that can drift. A caller asking for a format that is not
    /// csv or pdf gets a 400 naming both, rather than a silent fallback that hands them a
    /// spreadsheet when they asked for a document.
    /// </remarks>
    private static async Task<IResult> ExportAsync(
        Guid id,
        string? format,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var requested = string.IsNullOrWhiteSpace(format) ? CsvFormat : format.Trim();

        if (string.Equals(requested, PdfFormat, StringComparison.OrdinalIgnoreCase))
        {
            return await ExportPdfAsync(id, lang, principal, db, cancellationToken);
        }

        if (!string.Equals(requested, CsvFormat, StringComparison.OrdinalIgnoreCase))
        {
            return Results.Json(
                new { message = $"Unsupported export format. Use '{CsvFormat}' or '{PdfFormat}'." },
                statusCode: 400);
        }

        return await ExportCsvAsync(id, lang, principal, db, cancellationToken);
    }

    /// <summary>
    /// The CSV, written straight to the response body.
    /// </summary>
    /// <remarks>
    /// <b>Streamed, not buffered.</b> #122 asks that a large export not exhaust memory, and
    /// the only version of that claim worth making is one the code shape enforces: nothing
    /// here builds a <c>byte[]</c> of the document, and <see cref="CsvStreamWriter"/> holds
    /// one row at a time. The rows are produced by <see cref="SurveyExport.WriteCsvAsync"/>
    /// as it walks the aggregate, so peak memory is the aggregate plus one row rather than the
    /// aggregate plus the file.
    ///
    /// <para>
    /// What is honestly still buffered is upstream of here: the aggregate itself, which
    /// <c>SurveyAggregateLoader</c> computes by materialising every answer of every completed
    /// response. That is the cost <c>/results</c> has always paid on the same survey, this
    /// route does not add to it, and it is the thing to fix if a survey ever gets large enough
    /// to matter -- fixing it in the exporter alone would be theatre.
    /// </para>
    /// </remarks>
    private static async Task<IResult> ExportCsvAsync(
        Guid id,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (context, failure) = await BuildAsync(id, lang, principal, db, cancellationToken);
        if (failure is not null)
        {
            return failure;
        }

        return Results.Stream(
            async stream =>
            {
                // leaveOpen inside CsvStreamWriter, so disposing the writer flushes the
                // encoder without closing the response body out from under Kestrel.
                await using var csv = new CsvStreamWriter(stream, SurveyExport.Columns);
                await SurveyExport.WriteCsvAsync(csv, context!, cancellationToken);
            },
            "text/csv",
            SurveyExport.CsvFileName(id));
    }

    /// <summary>The formatted document.</summary>
    private static async Task<IResult> ExportPdfAsync(
        Guid id,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var (context, failure) = await BuildAsync(id, lang, principal, db, cancellationToken);
        if (failure is not null)
        {
            return failure;
        }

        return Results.File(
            SurveyExport.BuildPdf(context!).ToBytes(),
            "application/pdf",
            SurveyExport.PdfFileName(id));
    }

    // ------------------------------------------------------------------
    // Loading
    // ------------------------------------------------------------------

    /// <summary>
    /// Resolves, authorizes and aggregates -- the one path to a survey's contents leaving the
    /// server as a file, so no format can skip a step another one takes.
    /// </summary>
    private static async Task<(SurveyExportContext? Context, IResult? Failure)> BuildAsync(
        Guid id,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var loaded = await SurveyResultsEndpoints.LoadAsync(id, lang, principal, db, cancellationToken);
        if (loaded.Failure is not null)
        {
            return (null, loaded.Failure);
        }

        var results = loaded.Context!;
        return (
            new SurveyExportContext(
                results.Survey.Id,
                results.Title,
                results.Survey.Status,
                results.Survey.Language,
                results.ResolvedLocale,
                results.FallbackFields,
                results.Aggregate,
                DateTimeOffset.UtcNow),
            null);
    }
}
