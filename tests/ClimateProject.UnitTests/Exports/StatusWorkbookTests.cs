using ClimateProject.Application.Exports;
using ClimateProject.Application.Surveys;
using ClosedXML.Excel;

namespace ClimateProject.UnitTests.Exports;

/// <summary>
/// The status workbook: every one of a company's surveys as one file, a sheet each.
///
/// <para>
/// Through October 2026 this file was three roster downloads and a Python script, run about
/// twice a day. These tests pin the two things that make the product version trustworthy: the
/// columns are the CSV export's own, so they cannot drift from the screen, and the percentage
/// is a written value rather than a formula whose result only exists once Excel opens it.
/// </para>
/// </summary>
public class StatusWorkbookTests
{
    private static readonly DateOnly Today = new(2026, 10, 28);

    private static SurveyRosterRow Person(
        string name,
        string status,
        string? surveyUsername = null,
        DateOnly? issued = null,
        DateOnly? signedIn = null)
        => new(
            Guid.NewGuid(),
            name,
            $"{name.Split(' ')[0].ToLowerInvariant()}@esph-sa.com",
            Username: null,
            Role: "employee",
            Status: status,
            LastActivityOn: null,
            Demographics: [],
            SurveyUsername: surveyUsername,
            CredentialIssuedOn: issued,
            LastSignInOn: signedIn);

    private static StatusWorkbookSurvey Survey(
        string title,
        IReadOnlyList<SurveyRosterRow> roster,
        bool perSurvey = true,
        bool showState = true)
        => new(title, perSurvey, showState, roster);

    private static XLWorkbook Open(byte[] bytes)
    {
        var stream = new MemoryStream(bytes);
        return new XLWorkbook(stream);
    }

    [Fact]
    public void Each_survey_becomes_its_own_sheet_named_after_it()
    {
        var bytes = StatusWorkbook.Build(
            [
                Survey("Clima Organizacional", [Person("Marta Villalobos", SurveyParticipantStatuses.Completed)]),
                Survey("Teletrabajo", [Person("Hugo Peralta", SurveyParticipantStatuses.Started)]),
            ],
            Today,
            spanish: true);

        using var book = Open(bytes);
        Assert.Equal(["Clima Organizacional", "Teletrabajo"], book.Worksheets.Select(w => w.Name));
    }

    /// <summary>
    /// The header row IS `SurveyRosterCsv.Headers` — asserted against the method rather than
    /// against a copy of its words, so renaming a column in one place cannot leave this file
    /// saying the old thing.
    /// </summary>
    [Fact]
    public void The_columns_are_the_csv_exports_own()
    {
        var bytes = StatusWorkbook.Build(
            [Survey("Clima", [Person("Marta Villalobos", SurveyParticipantStatuses.Completed, "esph-a1b2c3d4", Today)])],
            Today,
            spanish: true);

        using var book = Open(bytes);
        var sheet = book.Worksheet("Clima");
        var expected = SurveyRosterCsv.Headers(spanish: true, perSurvey: true, showState: true);
        for (var c = 0; c < expected.Length; c++)
        {
            Assert.Equal(expected[c], sheet.Cell(4, c + 1).GetString());
        }

        // And the person's cells are `Fields`, in the same order.
        Assert.Equal("Marta Villalobos", sheet.Cell(5, 1).GetString());
        Assert.Equal("marta@esph-sa.com", sheet.Cell(5, 2).GetString());
        Assert.Equal("esph-a1b2c3d4", sheet.Cell(5, 4).GetString());
    }

    [Fact]
    public void Every_sheet_carries_its_title_and_the_day_the_picture_was_taken()
    {
        var bytes = StatusWorkbook.Build([Survey("Clima", [Person("Marta", SurveyParticipantStatuses.Completed)])], Today, spanish: true);

        using var book = Open(bytes);
        var sheet = book.Worksheet("Clima");
        Assert.Equal("Clima", sheet.Cell(1, 1).GetString());
        Assert.Contains("2026-10-28", sheet.Cell(2, 1).GetString(), StringComparison.Ordinal);
    }

    /// <summary>
    /// The count and the share, as VALUES. A formula's result is computed when the file opens,
    /// so a reader that shows an uncached cell prints 0 % — which is why `ResponseWorkbook`
    /// writes its totals out too.
    /// </summary>
    [Fact]
    public void The_totals_are_written_values_and_the_share_is_over_the_rows_above_them()
    {
        var roster = new[]
        {
            Person("Uno", SurveyParticipantStatuses.Completed),
            Person("Dos", SurveyParticipantStatuses.Completed),
            Person("Tres", SurveyParticipantStatuses.Started),
            Person("Cuatro", SurveyParticipantStatuses.NotStarted),
        };

        var bytes = StatusWorkbook.Build([Survey("Clima", roster)], Today, spanish: true);

        using var book = Open(bytes);
        var sheet = book.Worksheet("Clima");
        // 4 people start at row 5, so the block begins one blank row after the last of them.
        var at = 5 + roster.Length + 1;
        Assert.Equal("Personas", sheet.Cell(at, 1).GetString());
        Assert.Equal(4, sheet.Cell(at, 2).GetValue<int>());
        Assert.Equal(SurveyRosterCsv.StatusLabel(SurveyParticipantStatuses.Completed, true), sheet.Cell(at + 1, 1).GetString());
        Assert.Equal(2, sheet.Cell(at + 1, 2).GetValue<int>());
        Assert.Equal(0.5d, sheet.Cell(at + 2, 2).GetValue<double>(), precision: 6);
        Assert.False(sheet.Cell(at + 2, 2).HasFormula);
    }

    /// <summary>
    /// An anonymous survey that records only completions makes no per-person claim, so it gets
    /// no Estado column — and therefore no "finished" line either, because the sheet has no
    /// per-person state to count.
    /// </summary>
    [Fact]
    public void A_survey_that_records_no_state_gets_a_headcount_and_no_percentage()
    {
        var bytes = StatusWorkbook.Build(
            [Survey("Anónima", [Person("Uno", SurveyParticipantStatuses.NotCompleted)], perSurvey: false, showState: false)],
            Today,
            spanish: true);

        using var book = Open(bytes);
        var sheet = book.Worksheet("Anónima");
        var at = 5 + 1 + 1;
        Assert.Equal("Personas", sheet.Cell(at, 1).GetString());
        Assert.Equal(1, sheet.Cell(at, 2).GetValue<int>());
        Assert.True(sheet.Cell(at + 2, 2).IsEmpty());
    }

    /// <summary>A null field stays an empty cell: "no code yet" is not the empty string.</summary>
    [Fact]
    public void A_person_with_no_key_leaves_those_cells_empty()
    {
        var bytes = StatusWorkbook.Build(
            [Survey("Clima", [Person("Sin Clave", SurveyParticipantStatuses.NotStarted)])],
            Today,
            spanish: true);

        using var book = Open(bytes);
        var sheet = book.Worksheet("Clima");
        // Column 4 is Usuario, 5 is "Código enviado": both unknown for a person with no key.
        Assert.True(sheet.Cell(5, 4).IsEmpty());
        Assert.True(sheet.Cell(5, 5).IsEmpty());
    }

    /// <summary>
    /// Two surveys whose names agree for the first 31 characters — ESPH's did. Excel refuses a
    /// duplicate sheet name, so the second is numbered rather than the file being unwritable.
    /// </summary>
    [Fact]
    public void Two_surveys_with_the_same_long_name_still_produce_a_file()
    {
        var long1 = "Clima Organizacional ESPH 2026 primera medición";
        var long2 = "Clima Organizacional ESPH 2026 segunda medición";

        var bytes = StatusWorkbook.Build(
            [
                Survey(long1, [Person("Uno", SurveyParticipantStatuses.Completed)]),
                Survey(long2, [Person("Dos", SurveyParticipantStatuses.Completed)]),
            ],
            Today,
            spanish: true);

        using var book = Open(bytes);
        Assert.Equal(2, book.Worksheets.Count);
        Assert.Equal(2, book.Worksheets.Select(w => w.Name).Distinct(StringComparer.OrdinalIgnoreCase).Count());
        Assert.All(book.Worksheets, w => Assert.True(w.Name.Length <= 31));
    }

    /// <summary>A sheetless workbook is a corrupt file, not an empty one.</summary>
    [Fact]
    public void A_company_with_nothing_distributed_still_gets_an_openable_file()
    {
        var bytes = StatusWorkbook.Build([], Today, spanish: true);

        using var book = Open(bytes);
        var sheet = Assert.Single(book.Worksheets);
        Assert.Contains("encuestas", sheet.Cell(1, 1).GetString(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void A_title_made_only_of_characters_excel_refuses_still_names_a_sheet()
    {
        var bytes = StatusWorkbook.Build(
            [Survey("[*?]", [Person("Uno", SurveyParticipantStatuses.Completed)])],
            Today,
            spanish: true);

        using var book = Open(bytes);
        var sheet = Assert.Single(book.Worksheets);
        Assert.False(string.IsNullOrWhiteSpace(sheet.Name));
    }
}
