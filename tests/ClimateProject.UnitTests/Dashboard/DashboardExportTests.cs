using System.Text;
using ClimateProject.Application.Dashboard;
using ClimateProject.Application.Dashboard.Rendering;
using ClimateProject.Application.Localization;
using ClimateProject.UnitTests.Exports;

namespace ClimateProject.UnitTests.Dashboard;

/// <summary>
/// What leaves the building when an administrator downloads a dashboard (#134).
///
/// <para>
/// <b>The unit under test is the renderer, so the payloads here are built by hand.</b> That is
/// the right boundary for the guarantee these tests own -- <em>given</em> a withheld climate
/// reading, what does the file say? -- and it is deliberately <em>not</em> the guarantee that
/// the export sees the same suppression the screen does. That one is about which loader the
/// endpoint calls, it cannot be shown by handing this class a DTO, and it is asserted in
/// <c>DashboardEndpointsTests</c> against a real database instead.
/// </para>
/// <para>
/// The PDF is read back through <see cref="PdfText"/> as the literal strings the content stream
/// actually draws, for the reason stated there: "the bytes contain no zero" is unassertable,
/// while "no drawn cell is the string <c>0</c>" is exactly the claim.
/// </para>
/// </summary>
public class DashboardExportTests
{
    private static readonly DateTimeOffset GeneratedAt = new(2026, 9, 5, 12, 0, 0, TimeSpan.Zero);
    private static readonly Guid CompanyId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    private static readonly Guid DepartmentId = Guid.Parse("d0000000-0000-0000-0000-000000000001");
    private static readonly Guid SurveyId = Guid.Parse("50000000-0000-0000-0000-000000000001");
    private static readonly Guid SmallDepartmentId = Guid.Parse("d0000000-0000-0000-0000-000000000002");

    // ==================================================================
    // Shape
    // ==================================================================

    [Fact]
    public void The_csv_starts_with_the_header_row()
    {
        var text = CsvText(DashboardExport.BuildCsv(CompanyDocument()));

        Assert.Equal(
            string.Join(",", DashboardExport.Columns.Select(c => $"\"{c}\"")),
            text.Split("\r\n")[0]);
    }

    [Fact]
    public void The_pdf_draws_the_dashboard_title_and_what_it_is_of()
    {
        var drawn = PdfText.DrawnStrings(DashboardExport.BuildPdf(CompanyDocument()));

        Assert.Contains("Company dashboard", drawn, StringComparer.Ordinal);
        Assert.Contains("Acme Costa Rica", drawn, StringComparer.Ordinal);
    }

    [Fact]
    public void The_company_figures_reach_the_csv()
    {
        var rows = CsvRows(DashboardExport.BuildCsv(CompanyDocument()));

        Assert.Equal("40", Cell(rows, "People", "Users"));
        Assert.Equal("31", Cell(rows, "People", "Active users"));
        Assert.Equal("7", Cell(rows, "Surveys", "Active surveys"));
        Assert.Equal("120", Cell(rows, "Surveys", "Completed responses"));
        Assert.Equal("3", Cell(rows, "Action plans", "Overdue action plans"));
    }

    // ==================================================================
    // THE PROPERTY THIS SLICE OWNS: a withheld figure prints as the word,
    // never as zero.
    // ==================================================================

    /// <summary>
    /// A department below the floor gets <see cref="DashboardTeamClimate.IsSuppressed"/> and an
    /// empty dimension list, and <see cref="DashboardTeamClimate.RespondentCount"/> is zero by
    /// construction -- the withheld size never travels with the withheld reading.
    /// </summary>
    /// <remarks>
    /// So the file must not print that zero. "Respondents: 0" under a heading called Team
    /// climate reads as <em>nobody on this team answered</em>, which is a claim about three
    /// named people that the suppression exists precisely to stop anyone making. The assertion
    /// is on the drawn cells rather than on a substring, because a PDF is full of zeros.
    /// </remarks>
    [Fact]
    public void A_suppressed_climate_prints_the_notice_and_no_cell_is_zero()
    {
        var document = DepartmentDocument(SuppressedClimate());

        var drawn = PdfText.DrawnStrings(DashboardExport.BuildPdf(document));

        Assert.Contains("Team climate", drawn, StringComparer.Ordinal);
        Assert.Contains(
            "This team is below the anonymity floor",
            PdfText.Prose(DashboardExport.BuildPdf(document)),
            StringComparison.Ordinal);

        // The one figure a suppressed reading may carry is the floor it was withheld under,
        // so the reader learns the promise the server kept rather than a constant of its own.
        Assert.Contains("5", drawn, StringComparer.Ordinal);

        // Nothing anywhere in the drawn text is a bare zero.
        Assert.DoesNotContain("0", drawn, StringComparer.Ordinal);

        // And the CSV, which is where a spreadsheet would happily average a column of zeroes.
        var climateRows = CsvRows(DashboardExport.BuildCsv(document))
            .Where(r => r.Section == "Team climate")
            .ToList();
        Assert.DoesNotContain(climateRows, r => r.Value == "0");
        Assert.DoesNotContain(climateRows, r => r.Label == "Respondents");
    }

    /// <summary>
    /// A department below the floor prints the word, not its count — the same figure the
    /// company screen hatches on its map.
    /// </summary>
    /// <remarks>
    /// This is the one place the export applies a floor the payload does not.
    /// <c>CompanyAdminDashboard.Departments</c> carries raw counts, because the screen floors
    /// them itself in <c>companyClimate.ts</c>. An earlier department table on that page
    /// printed them unfloored and was deleted for it; an export is that table again, in a file
    /// somebody keeps.
    /// </remarks>
    [Fact]
    public void A_department_below_the_floor_is_withheld_rather_than_counted()
    {
        var rows = CsvRows(DashboardExport.BuildCsv(CompanyDocument()));

        // The disclosed department prints its real figures, so this does not pass by printing
        // nothing at all: Ingeniería, 20 members, 14 completed responses.
        Assert.Equal("20", Cell(rows, "Departments", "Ingeniería - Members"));
        Assert.Equal("14", Cell(rows, "Departments", "Ingeniería - Completed responses"));

        // Finanzas has 3, below the floor of 5. Named, sized — and its participation withheld.
        Assert.Equal("4", Cell(rows, "Departments", "Finanzas - Members"));
        Assert.Equal("Withheld", Cell(rows, "Departments", "Finanzas - Completed responses"));

        // Never the count, anywhere in the section — including as a cell that happens to read 3.
        var departmentRows = rows.Where(r => r.Section == "Departments").ToList();
        Assert.DoesNotContain(departmentRows, r => r.Label == "Finanzas - Completed responses" && r.Value == "3");

        // And the file says why, rather than leaving a reader to guess that "Withheld" is a bug.
        Assert.Contains(departmentRows, r => r.Value.Contains("fewer than 5 respondents", StringComparison.Ordinal));
    }

    /// <summary>
    /// A dimension whose average is null inside an <em>unsuppressed</em> reading: a different
    /// state from the whole team being withheld, and it must still not print as zero.
    /// </summary>
    [Fact]
    public void A_null_dimension_average_prints_not_available_rather_than_zero()
    {
        var climate = new DashboardTeamClimate(
            SurveyId,
            "Clima 2026",
            new DateTimeOffset(2026, 8, 1, 0, 0, 0, TimeSpan.Zero),
            RespondentCount: 12,
            IsSuppressed: false,
            MinimumGroupSize: 5,
            Dimensions:
            [
                new DashboardDimensionScore("liderazgo", 4.25),
                new DashboardDimensionScore("comunicacion", null),
            ]);

        var drawn = PdfText.DrawnStrings(DashboardExport.BuildPdf(DepartmentDocument(climate)));

        // The computed dimension prints its real score, so this does not pass by printing
        // nothing at all.
        var leadership = drawn.ToList().IndexOf("liderazgo");
        Assert.True(leadership >= 0, "the computed dimension should be drawn");
        Assert.Equal("4.25", drawn[leadership + 1]);

        var communication = drawn.ToList().IndexOf("comunicacion");
        Assert.True(communication >= 0, "the uncomputed dimension should still be drawn");
        Assert.Equal("Not available", drawn[communication + 1]);
    }

    /// <summary>
    /// "Nothing has closed yet" and "your team is too small to report" are different statements
    /// and the export makes them differently -- collapsing them would tell a leader their team
    /// was suppressed when in fact no survey has ever closed.
    /// </summary>
    [Fact]
    public void No_closed_survey_reads_differently_from_a_withheld_reading()
    {
        var prose = PdfText.Prose(DashboardExport.BuildPdf(DepartmentDocument(climate: null)));

        Assert.Contains("No survey has closed yet", prose, StringComparison.Ordinal);
        Assert.DoesNotContain("below the anonymity floor", prose, StringComparison.Ordinal);
    }

    // ==================================================================
    // Locale
    // ==================================================================

    [Fact]
    public void Spanish_renders_spanish_including_the_withheld_notice()
    {
        var document = DashboardExport.ForDepartmentAdmin(
            DepartmentDashboard(SuppressedClimate()),
            ContentLanguages.Spanish,
            GeneratedAt);

        var prose = PdfText.Prose(DashboardExport.BuildPdf(document));

        Assert.Contains("Panel del departamento", prose, StringComparison.Ordinal);
        Assert.Contains("por debajo del umbral de anonimato", prose, StringComparison.Ordinal);
        Assert.DoesNotContain("below the anonymity floor", prose, StringComparison.Ordinal);
    }

    /// <summary>
    /// An unrecognised <c>?lang=</c> falls back exactly as a report does, rather than throwing
    /// or emitting a key path.
    /// </summary>
    [Fact]
    public void An_unknown_locale_falls_back_to_english()
    {
        var document = DashboardExport.ForCompanyAdmin(CompanyDashboard(), "klingon", GeneratedAt);

        Assert.Equal(ContentLanguages.English, document.Locale);
        Assert.Equal("Company dashboard", document.Title);
    }

    // ==================================================================
    // Fixtures
    // ==================================================================

    private static DashboardExportDocument CompanyDocument()
        => DashboardExport.ForCompanyAdmin(CompanyDashboard(), ContentLanguages.English, GeneratedAt);

    private static DashboardExportDocument DepartmentDocument(DashboardTeamClimate? climate)
        => DashboardExport.ForDepartmentAdmin(
            DepartmentDashboard(climate), ContentLanguages.English, GeneratedAt);

    private static CompanyAdminDashboard CompanyDashboard()
        => new(
            CompanyId,
            "Acme Costa Rica",
            UserCount: 40,
            ActiveUserCount: 31,
            DepartmentCount: 6,
            SurveyCount: 12,
            ActiveSurveyCount: 7,
            DraftSurveyCount: 2,
            ResponseCount: 180,
            CompletedResponseCount: 120,
            OpenActionPlanCount: 9,
            OverdueActionPlanCount: 3,
            OngoingSurveys:
            [
                new DashboardSurveySummary(
                    SurveyId,
                    "Clima 2026",
                    "active",
                    new DateTimeOffset(2026, 8, 1, 0, 0, 0, TimeSpan.Zero),
                    new DateTimeOffset(2026, 8, 31, 0, 0, 0, TimeSpan.Zero),
                    ResponseCount: 120,
                    TargetAudienceCount: 200),
            ],
            Departments:
            [
                new DashboardDepartmentSummary(DepartmentId, "Ingeniería", MemberCount: 20, CompletedResponseCount: 14),
                // Below SurveyResultsPrivacy.MinimumSegmentRespondents. The company payload
                // carries this count UNFLOORED -- the screen floors it itself and hatches the
                // department on the map -- so the export has to floor it or it republishes
                // exactly what the screen withholds.
                new DashboardDepartmentSummary(SmallDepartmentId, "Finanzas", MemberCount: 4, CompletedResponseCount: 3),
            ]);

    private static DepartmentAdminDashboard DepartmentDashboard(DashboardTeamClimate? climate)
        => new(
            DepartmentId,
            "Ingeniería",
            CompanyId,
            MemberCount: 20,
            ActiveMemberCount: 18,
            ActiveSurveyCount: 1,
            CompletedResponseCount: 14,
            OpenActionPlanCount: 2,
            OverdueActionPlanCount: 1,
            ActiveSurveys:
            [
                new DashboardDepartmentSurveySummary(
                    SurveyId,
                    "Clima 2026",
                    "active",
                    new DateTimeOffset(2026, 8, 1, 0, 0, 0, TimeSpan.Zero),
                    new DateTimeOffset(2026, 8, 31, 0, 0, 0, TimeSpan.Zero),
                    ResponseCount: 14),
            ],
            Climate: climate);

    /// <summary>
    /// The shape the dashboard endpoint actually produces for a team under the floor: empty
    /// dimensions, and a respondent count of zero because the withheld size never travels with
    /// the withheld reading.
    /// </summary>
    private static DashboardTeamClimate SuppressedClimate()
        => new(
            SurveyId,
            "Clima 2026",
            new DateTimeOffset(2026, 8, 31, 0, 0, 0, TimeSpan.Zero),
            RespondentCount: 0,
            IsSuppressed: true,
            MinimumGroupSize: 5,
            Dimensions: []);

    private static string CsvText(Application.Exports.CsvWriter writer)
        // The BOM is three bytes CsvWriter prepends deliberately, and it is not part of the
        // document.
        => Encoding.UTF8.GetString(writer.ToBytes().AsSpan(3));

    private sealed record CsvRow(string Section, string Label, string Value);

    private static IReadOnlyList<CsvRow> CsvRows(Application.Exports.CsvWriter writer)
        =>
        [
            .. CsvText(writer)
                .Split("\r\n", StringSplitOptions.RemoveEmptyEntries)
                .Skip(1)
                .Select(line =>
                {
                    var fields = line[1..^1].Split("\",\"", StringSplitOptions.None);
                    return new CsvRow(fields[0], fields[1], fields[2]);
                }),
        ];

    private static string Cell(IReadOnlyList<CsvRow> rows, string section, string label)
        => rows.Single(r => r.Section == section && r.Label == label).Value;
}
