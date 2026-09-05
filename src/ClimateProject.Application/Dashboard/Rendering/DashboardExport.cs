using ClimateProject.Application.Exports;
using ClimateProject.Application.Surveys;

namespace ClimateProject.Application.Dashboard.Rendering;

/// <summary>One labelled figure on an exported dashboard.</summary>
/// <param name="Value">
/// Already rendered to text by <see cref="DashboardExport"/>, never a raw number. The
/// formatting decisions -- decimal comma, and above all what a *withheld* figure prints as --
/// are made once, where they can be tested once.
/// </param>
public sealed record DashboardExportRow(string Label, string Value);

/// <summary>A titled group of rows, plus any table that belongs under it.</summary>
/// <param name="Notice">
/// A sentence printed under the heading rather than a figure beside a label -- "this team is
/// below the anonymity floor", "no survey is running". Null when there is nothing to say.
/// </param>
public sealed record DashboardExportSection(
    string Title,
    IReadOnlyList<DashboardExportRow> Rows,
    string? Notice = null,
    IReadOnlyList<string>? TableHeaders = null,
    IReadOnlyList<IReadOnlyList<string>>? TableRows = null);

/// <summary>
/// A dashboard flattened into sections, ready to render as either format.
/// </summary>
public sealed record DashboardExportDocument(
    string Title,
    string Subtitle,
    DateTimeOffset GeneratedAt,
    string Locale,
    IReadOnlyList<DashboardExportSection> Sections);

/// <summary>
/// Renders a dashboard payload as PDF or CSV (#134), through the same hand-rolled writers the
/// survey and report exports use -- <see cref="PdfDocument"/> and <see cref="CsvWriter"/>.
///
/// ## Nothing here decides what may be disclosed
///
/// This is the property the slice exists for, and it is the same one
/// <c>SurveyExportEndpoints</c> states: the endpoints that call this hand it the payload the
/// *screen* was already given, built by the same loader behind <c>GET /dashboard/company-admin</c>
/// and <c>/department-admin</c>. There is no query in this file, no floor, and no branch on a
/// respondent count. An export cannot reveal what the screen withholds if it never asks the
/// database anything the screen did not ask.
///
/// ## What it does decide is how a withheld figure PRINTS
///
/// That is the one disclosure-shaped judgement in this file, and it has exactly one rule:
/// <b>a withheld or absent figure prints as the word, never as zero.</b>
/// <see cref="DashboardTeamClimate.IsSuppressed"/> suppresses the whole dimension list, and
/// <see cref="DashboardDimensionScore.AverageScore"/> is nullable independently of it. Both go
/// through <see cref="ReportRenderCopy.Withheld"/> / <c>NotAvailable</c>.
///
/// The classic leak this repository has paid for is treating an absent count as <c>0</c>,
/// which reads to a director as "nobody in that team answered" -- a claim about named people
/// that the suppression exists to prevent anyone making. A CSV is where that misreading is
/// most likely, because a spreadsheet will happily average a column of zeroes.
/// </summary>
public static class DashboardExport
{
    /// <summary>
    /// The CSV shape: one row per figure, section named on every row.
    /// </summary>
    /// <remarks>
    /// Flat and long rather than one wide row per dashboard, for the reason
    /// <c>ReportRenderer.Columns</c> gives: a wide shape has to grow a column every time a
    /// dashboard grows a figure, which breaks every saved spreadsheet built on it, whereas a
    /// long shape grows rows and breaks nothing.
    /// </remarks>
    public static readonly string[] Columns = ["section", "label", "value"];

    // ------------------------------------------------------------------
    // Company admin
    // ------------------------------------------------------------------

    /// <summary>
    /// The company dashboard, exactly as <c>GET /dashboard/company-admin</c> built it.
    /// </summary>
    public static DashboardExportDocument ForCompanyAdmin(
        CompanyAdminDashboard dashboard,
        string? locale,
        DateTimeOffset generatedAt)
    {
        ArgumentNullException.ThrowIfNull(dashboard);

        var copy = DashboardExportCopy.For(locale);
        var shared = copy.Shared;

        var sections = new List<DashboardExportSection>
        {
            new(copy.People,
            [
                new DashboardExportRow(copy.Users, shared.Count(dashboard.UserCount)),
                new DashboardExportRow(copy.ActiveUsers, shared.Count(dashboard.ActiveUserCount)),
                new DashboardExportRow(copy.Departments, shared.Count(dashboard.DepartmentCount)),
            ]),

            new(copy.SurveysSection,
            [
                new DashboardExportRow(copy.TotalSurveys, shared.Count(dashboard.SurveyCount)),
                new DashboardExportRow(copy.ActiveSurveys, shared.Count(dashboard.ActiveSurveyCount)),
                new DashboardExportRow(copy.DraftSurveys, shared.Count(dashboard.DraftSurveyCount)),
                new DashboardExportRow(copy.TotalResponses, shared.Count(dashboard.ResponseCount)),
                new DashboardExportRow(copy.CompletedResponses, shared.Count(dashboard.CompletedResponseCount)),
            ]),

            new(copy.ActionPlans,
            [
                new DashboardExportRow(copy.OpenActionPlans, shared.Count(dashboard.OpenActionPlanCount)),
                new DashboardExportRow(copy.OverdueActionPlans, shared.Count(dashboard.OverdueActionPlanCount)),
            ]),
        };

        sections.Add(dashboard.OngoingSurveys.Count == 0
            ? new DashboardExportSection(copy.OngoingSurveys, [], Notice: copy.NoOngoingSurveys)
            : new DashboardExportSection(
                copy.OngoingSurveys,
                [],
                TableHeaders: [copy.Survey, shared.Status, copy.StartDate, copy.EndDate, shared.Responses],
                TableRows: [.. dashboard.OngoingSurveys.Select(s => (IReadOnlyList<string>)
                [
                    s.Title ?? shared.UntitledSurvey,
                    s.Status,
                    shared.Day(s.StartDate),
                    shared.Day(s.EndDate),
                    shared.Count(s.ResponseCount),
                ])]));

        sections.Add(DepartmentSection(dashboard.Departments, copy));

        return new DashboardExportDocument(
            copy.CompanyDashboardTitle,
            dashboard.CompanyName,
            generatedAt,
            ResolveLocale(locale),
            sections);
    }

    /// <summary>
    /// The department table -- and the one place the export has to apply a floor the payload
    /// does not.
    /// </summary>
    /// <remarks>
    /// <b>`CompanyAdminDashboard.Departments` carries UNFLOORED completed-response counts.</b>
    /// That is not a bug in the payload: the company dashboard's screen applies the floor
    /// itself, in <c>companyClimate.ts</c>'s <c>readDepartments</c>, and <c>ClimateMap</c>
    /// hatches every department under it rather than drawing its number. The screen's own
    /// comment records that an earlier department *table* on that page printed
    /// <c>completedResponseCount</c> for every department including the ones under the floor,
    /// "which is exactly the figure the map's hatch exists to withhold -- the two could not
    /// both be right, and the table was the one that was wrong."
    ///
    /// <para>
    /// An export that printed the raw list would re-create exactly that table, in a file that
    /// leaves the building. So the floor is applied here, against the same constant every
    /// other surface uses, and a withheld cell says <see cref="ReportRenderCopy.Withheld"/>
    /// rather than a number -- never <c>0</c>, which would read as "nobody in that team
    /// answered".
    /// </para>
    /// <para>
    /// The department is still <em>named</em>, and its member count still printed. Both are
    /// org-chart data the same administrator reads on <c>/admin/departments</c>, and this is
    /// the ruling <c>ReportRenderer</c> already made for the identical table. What is withheld
    /// is participation, which is the figure derived from what people answered.
    /// </para>
    /// </remarks>
    private static DashboardExportSection DepartmentSection(
        IReadOnlyList<DashboardDepartmentSummary> departments,
        DashboardExportCopy copy)
    {
        var shared = copy.Shared;
        var floor = SurveyResultsPrivacy.MinimumSegmentRespondents;

        if (departments.Count == 0)
        {
            return new DashboardExportSection(copy.Departments, [], Notice: copy.NoDepartments);
        }

        var withheld = departments.Count(d => d.CompletedResponseCount < floor);

        return new DashboardExportSection(
            copy.Departments,
            [],
            Notice: withheld > 0 ? shared.DepartmentWithheldNotice(floor) : null,
            TableHeaders: [shared.Department, copy.Members, copy.CompletedResponses],
            TableRows: [.. departments.Select(d => (IReadOnlyList<string>)
            [
                d.Name,
                shared.Count(d.MemberCount),
                d.CompletedResponseCount < floor ? shared.Withheld : shared.Count(d.CompletedResponseCount),
            ])]);
    }

    // ------------------------------------------------------------------
    // Department admin
    // ------------------------------------------------------------------

    /// <summary>
    /// The department dashboard, exactly as <c>GET /dashboard/department-admin</c> built it --
    /// including its climate reading, or the statement that the reading is withheld.
    /// </summary>
    public static DashboardExportDocument ForDepartmentAdmin(
        DepartmentAdminDashboard dashboard,
        string? locale,
        DateTimeOffset generatedAt)
    {
        ArgumentNullException.ThrowIfNull(dashboard);

        var copy = DashboardExportCopy.For(locale);
        var shared = copy.Shared;

        var sections = new List<DashboardExportSection>
        {
            new(copy.People,
            [
                new DashboardExportRow(copy.Members, shared.Count(dashboard.MemberCount)),
                new DashboardExportRow(copy.ActiveMembers, shared.Count(dashboard.ActiveMemberCount)),
            ]),

            new(copy.SurveysSection,
            [
                new DashboardExportRow(copy.ActiveSurveys, shared.Count(dashboard.ActiveSurveyCount)),
                new DashboardExportRow(copy.CompletedResponses, shared.Count(dashboard.CompletedResponseCount)),
            ]),

            new(copy.ActionPlans,
            [
                new DashboardExportRow(copy.OpenActionPlans, shared.Count(dashboard.OpenActionPlanCount)),
                new DashboardExportRow(copy.OverdueActionPlans, shared.Count(dashboard.OverdueActionPlanCount)),
            ]),
        };

        sections.Add(dashboard.ActiveSurveys.Count == 0
            ? new DashboardExportSection(copy.OngoingSurveys, [], Notice: copy.NoOngoingSurveys)
            : new DashboardExportSection(
                copy.OngoingSurveys,
                [],
                TableHeaders: [copy.Survey, shared.Status, copy.StartDate, copy.EndDate, shared.Responses],
                TableRows: [.. dashboard.ActiveSurveys.Select(s => (IReadOnlyList<string>)
                [
                    s.Title ?? shared.UntitledSurvey,
                    s.Status,
                    shared.Day(s.StartDate),
                    shared.Day(s.EndDate),
                    shared.Count(s.ResponseCount),
                ])]));

        sections.Add(ClimateSection(dashboard.Climate, copy));

        return new DashboardExportDocument(
            copy.DepartmentDashboardTitle,
            dashboard.DepartmentName,
            generatedAt,
            ResolveLocale(locale),
            sections);
    }

    /// <summary>
    /// The team-climate section -- the one place in this file where a suppression decision
    /// made upstream has to be *printed* rather than merely carried.
    /// </summary>
    /// <remarks>
    /// Three distinct states, deliberately printed as three different things, because
    /// collapsing any two of them is a false statement about a team:
    /// <list type="bullet">
    /// <item><c>null</c> -- the company has no closed survey at all. Nothing has been measured.</item>
    /// <item><see cref="DashboardTeamClimate.IsSuppressed"/> -- measured, and withheld because
    /// the team is below the floor. The dimension list is empty and
    /// <see cref="DashboardTeamClimate.RespondentCount"/> is zero by construction, so neither
    /// is printed: printing a zero respondent count here would state that nobody answered.</item>
    /// <item>Otherwise -- a reading, per dimension, with a null average still printing as
    /// "not available" rather than as <c>0</c>.</item>
    /// </list>
    /// </remarks>
    private static DashboardExportSection ClimateSection(DashboardTeamClimate? climate, DashboardExportCopy copy)
    {
        var shared = copy.Shared;

        if (climate is null)
        {
            return new DashboardExportSection(copy.TeamClimate, [], Notice: copy.NoClosedSurvey);
        }

        if (climate.IsSuppressed)
        {
            return new DashboardExportSection(
                copy.TeamClimate,
                [new DashboardExportRow(copy.MinimumGroupSize, shared.Count(climate.MinimumGroupSize))],
                Notice: copy.ClimateWithheldNotice);
        }

        var rows = new List<DashboardExportRow>
        {
            new(copy.SourceSurvey, climate.SurveyTitle ?? shared.UntitledSurvey),
            new(copy.ClosedOn, shared.Day(climate.SurveyEndDate)),
            new(shared.Respondents, shared.Count(climate.RespondentCount)),
        };

        return new DashboardExportSection(
            copy.TeamClimate,
            rows,
            TableHeaders: [shared.Dimension, shared.AverageScore],
            TableRows: [.. climate.Dimensions.Select(d => (IReadOnlyList<string>)
            [
                d.Dimension,
                // Null is NOT zero. `Decimal` renders it as the locale's "not available".
                shared.Decimal(d.AverageScore),
            ])]);
    }

    // ------------------------------------------------------------------
    // Formats
    // ------------------------------------------------------------------

    /// <summary>Renders the document as CSV -- one row per figure, plus one row per table cell line.</summary>
    public static CsvWriter BuildCsv(DashboardExportDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);

        var writer = new CsvWriter(Columns);
        var copy = DashboardExportCopy.For(document.Locale);

        writer.AppendRow(document.Title, copy.Shared.GeneratedAt, copy.Shared.Day(document.GeneratedAt));
        writer.AppendRow(document.Title, copy.Company, document.Subtitle);

        foreach (var section in document.Sections)
        {
            if (section.Notice is { } notice)
            {
                writer.AppendRow(section.Title, string.Empty, notice);
            }

            foreach (var row in section.Rows)
            {
                writer.AppendRow(section.Title, row.Label, row.Value);
            }

            if (section.TableHeaders is { } headers && section.TableRows is { } tableRows)
            {
                foreach (var tableRow in tableRows)
                {
                    // The first cell names the thing the row is about; the rest are labelled
                    // by their header, so a flat file stays readable without a wide shape.
                    var subject = tableRow.Count > 0 ? tableRow[0] : string.Empty;
                    for (var i = 1; i < tableRow.Count && i < headers.Count; i++)
                    {
                        writer.AppendRow(section.Title, $"{subject} - {headers[i]}", tableRow[i]);
                    }
                }
            }
        }

        return writer;
    }

    /// <summary>Renders the document as a PDF.</summary>
    public static PdfDocument BuildPdf(DashboardExportDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);

        var copy = DashboardExportCopy.For(document.Locale);
        var pdf = new PdfDocument(document.Title);

        pdf.Title(document.Title);
        pdf.Paragraph(document.Subtitle);
        pdf.Paragraph($"{copy.Shared.GeneratedAt}: {copy.Shared.Day(document.GeneratedAt)}");

        foreach (var section in document.Sections)
        {
            pdf.Heading(section.Title);

            if (section.Notice is { } notice)
            {
                pdf.Paragraph(notice);
            }

            if (section.Rows.Count > 0)
            {
                pdf.KeyValues([.. section.Rows.Select(r => (r.Label, (string?)r.Value))]);
            }

            if (section.TableHeaders is { } headers && section.TableRows is { Count: > 0 } tableRows)
            {
                pdf.Table(
                    [.. headers.Select((h, i) => new PdfTableColumn(h, i == 0 ? 2 : 1, RightAligned: i > 0))],
                    [.. tableRows.Select(r => (IReadOnlyList<string?>)[.. r.Select(c => (string?)c)])]);
            }
        }

        return pdf;
    }

    /// <summary>
    /// The locale the document was actually built in, so it carries the language it renders in
    /// rather than the raw <c>?lang=</c> the caller sent -- which may be absent, or a value no
    /// copy exists for.
    /// </summary>
    private static string ResolveLocale(string? locale)
        => Localization.ContentLanguages.NormaliseLocale(locale)
           ?? Localization.ContentLanguages.FallbackLocale;
}
