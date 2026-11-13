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
        // Every one of them was sent a code, so every one of them is counted (2026-11-02: on a
        // per-survey sheet the denominator is the people sent a code).
        var roster = new[]
        {
            Person("Uno", SurveyParticipantStatuses.Completed, "esph-uno", Today),
            Person("Dos", SurveyParticipantStatuses.Completed, "esph-dos", Today),
            Person("Tres", SurveyParticipantStatuses.Started, "esph-tres", Today),
            Person("Cuatro", SurveyParticipantStatuses.NotStarted, "esph-cuatro", Today),
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

        // The other two states, so the three counts add up to the people on the sheet.
        Assert.Equal(SurveyRosterCsv.StatusLabel(SurveyParticipantStatuses.Started, true), sheet.Cell(at + 3, 1).GetString());
        Assert.Equal(1, sheet.Cell(at + 3, 2).GetValue<int>());
        Assert.Equal(SurveyRosterCsv.StatusLabel(SurveyParticipantStatuses.NotStarted, true), sheet.Cell(at + 4, 1).GetString());
        Assert.Equal(1, sheet.Cell(at + 4, 2).GetValue<int>());
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

    /// <summary>
    /// A null field stays an empty cell: "no code yet" is not the empty string. The person
    /// STARTED without a key — the one kind of keyless person a per-survey sheet still lists,
    /// because a response is never left off (a keyless person who never opened it is not on
    /// the sheet at all since 2026-11-02).
    /// </summary>
    [Fact]
    public void A_person_with_no_key_leaves_those_cells_empty()
    {
        var bytes = StatusWorkbook.Build(
            [Survey("Clima", [Person("Sin Clave", SurveyParticipantStatuses.Started)])],
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

    // ------------------------------------------------------- who is counted, and colour (2026-11-02)

    /// <summary>
    /// ESPH's Clima reached 633 people by department while ESPH's own list was 619: the 14
    /// between them never received a Clima key and could not answer. The sheet counts the
    /// people sent a code, keeps anybody who answered without one, and says how many it left out.
    /// </summary>
    [Fact]
    public void A_per_survey_sheet_counts_the_people_sent_a_code_and_says_how_many_it_left_out()
    {
        var roster = new[]
        {
            Person("Ana Rojas", SurveyParticipantStatuses.Completed, "esph-ana", Today),
            Person("Beto Mora", SurveyParticipantStatuses.NotStarted, "esph-beto", Today),
            Person("Caro Solis", SurveyParticipantStatuses.NotStarted),
            Person("Dani Vega", SurveyParticipantStatuses.Completed),
        };

        var bytes = StatusWorkbook.Build([Survey("Clima", roster)], Today, spanish: true);

        using var book = Open(bytes);
        var sheet = book.Worksheet("Clima");
        var names = Enumerable.Range(5, 3).Select(r => sheet.Cell(r, 1).GetString()).ToList();
        Assert.Equal(["Ana Rojas", "Beto Mora", "Dani Vega"], names);
        Assert.DoesNotContain(sheet.CellsUsed(), c => c.GetString() == "Caro Solis");

        var at = 5 + 3 + 1;
        Assert.Equal(3, sheet.Cell(at, 2).GetValue<int>());
        Assert.Equal(2, sheet.Cell(at + 1, 2).GetValue<int>());
        Assert.Equal(2d / 3, sheet.Cell(at + 2, 2).GetValue<double>(), precision: 6);
        Assert.Contains(sheet.CellsUsed(), c => c.GetString() == "1 persona de la audiencia no recibió código para esta encuesta y no se cuenta.");
    }

    [Fact]
    public void A_survey_without_per_survey_keys_still_counts_everyone()
    {
        var bytes = StatusWorkbook.Build(
            [Survey("Identificada", [Person("Uno", SurveyParticipantStatuses.Completed), Person("Dos", SurveyParticipantStatuses.NotStarted)], perSurvey: false)],
            Today,
            spanish: true);

        using var book = Open(bytes);
        var sheet = book.Worksheet("Identificada");
        Assert.Equal(2, sheet.Cell(5 + 2 + 1, 2).GetValue<int>());
        Assert.DoesNotContain(sheet.CellsUsed(), c => c.GetString().Contains("no recibi", StringComparison.Ordinal));
    }

    /// <summary>The colours the client read for two weeks: finished green, started orange, not opened plain.</summary>
    [Fact]
    public void Each_state_is_coloured_as_the_clients_sheet_was()
    {
        var roster = new[]
        {
            Person("Uno", SurveyParticipantStatuses.Completed, "esph-uno", Today),
            Person("Dos", SurveyParticipantStatuses.Started, "esph-dos", Today),
            Person("Tres", SurveyParticipantStatuses.NotStarted, "esph-tres", Today),
        };

        var bytes = StatusWorkbook.Build([Survey("Clima", roster)], Today, spanish: true);

        using var book = Open(bytes);
        var sheet = book.Worksheet("Clima");
        var headers = SurveyRosterCsv.Headers(spanish: true, perSurvey: true, showState: true);
        var estado = Array.IndexOf(headers, "Estado") + 1;
        Assert.Equal("FF" + StatusWorkbook.FinishedFill, sheet.Cell(5, estado).Style.Fill.BackgroundColor.Color.ToArgb().ToString("X8"));
        Assert.Equal("FF" + StatusWorkbook.InProgressFill, sheet.Cell(6, estado).Style.Fill.BackgroundColor.Color.ToArgb().ToString("X8"));
        Assert.Equal(XLFillPatternValues.None, sheet.Cell(7, estado).Style.Fill.PatternType);
        Assert.True(sheet.AutoFilter.IsEnabled);
    }

    // ---- The progress layout (ESPH's format, walkthrough 2026-11-08) ----

    private static byte[] Progress(params StatusWorkbookSurvey[] surveys)
        => StatusWorkbook.Build(surveys, Today, spanish: true, StatusWorkbookLayout.Progress);

    /// <summary>
    /// Three columns, the name in ONE of them exactly as stored: the script this replaces split
    /// it by guessing where the surnames start, and the product does not print a guess.
    /// </summary>
    [Fact]
    public void The_progress_layout_has_the_name_whole_a_percentage_and_a_word()
    {
        var bytes = Progress(Survey("Clima", [
            Person("ADRIANA DE LOS ANGELES SANCHO PORRAS", SurveyParticipantStatuses.Completed, "esph-a", Today),
            Person("Hugo Peralta", SurveyParticipantStatuses.Started, "esph-b", Today),
            Person("Marta Solis", SurveyParticipantStatuses.NotStarted, "esph-c", Today),
        ]));

        using var book = Open(bytes);
        var sheet = book.Worksheet("Clima");
        Assert.Equal("Clima", sheet.Cell(1, 1).GetString());
        Assert.Equal("Al 2026-10-28", sheet.Cell(2, 1).GetString());
        Assert.Equal(
            ["Nombre completo", "Porcentaje de Avance", "Observaciones"],
            Enumerable.Range(1, 3).Select(c => sheet.Cell(4, c).GetString()));
        Assert.True(sheet.Cell(4, 4).IsEmpty());

        Assert.Equal("ADRIANA DE LOS ANGELES SANCHO PORRAS", sheet.Cell(5, 1).GetString());
        Assert.Equal(1d, sheet.Cell(5, 2).GetDouble());
        Assert.Equal("0%", sheet.Cell(5, 2).Style.NumberFormat.Format);
        Assert.Equal("Finalizada", sheet.Cell(5, 3).GetString());

        // How far a started person got is not known, so it is said, not invented.
        Assert.Equal("En curso", sheet.Cell(6, 2).GetString());
        Assert.Equal("Pendiente Finalizar", sheet.Cell(6, 3).GetString());

        Assert.Equal(0d, sheet.Cell(7, 2).GetDouble());
        Assert.Equal("Sin Iniciar", sheet.Cell(7, 3).GetString());
    }

    /// <summary>The whole row takes the status colour, as the client's file did.</summary>
    [Fact]
    public void The_progress_layout_colours_the_whole_row()
    {
        var bytes = Progress(Survey("Clima", [
            Person("Uno", SurveyParticipantStatuses.Completed, "esph-uno", Today),
            Person("Dos", SurveyParticipantStatuses.Started, "esph-dos", Today),
            Person("Tres", SurveyParticipantStatuses.NotStarted, "esph-tres", Today),
        ]));

        using var book = Open(bytes);
        var sheet = book.Worksheet("Clima");
        for (var c = 1; c <= 3; c++)
        {
            Assert.Equal("FF" + StatusWorkbook.FinishedFill, sheet.Cell(5, c).Style.Fill.BackgroundColor.Color.ToArgb().ToString("X8"));
            Assert.Equal("FF" + StatusWorkbook.InProgressFill, sheet.Cell(6, c).Style.Fill.BackgroundColor.Color.ToArgb().ToString("X8"));
            Assert.Equal(XLFillPatternValues.None, sheet.Cell(7, c).Style.Fill.PatternType);
        }

        Assert.True(sheet.AutoFilter.IsEnabled);
    }

    /// <summary>
    /// The total is the share FINISHED over the people on the sheet, a written value (not a
    /// formula), with the count beside it so it can be checked by counting.
    /// </summary>
    [Fact]
    public void The_progress_total_is_the_share_finished_written_as_a_value()
    {
        var bytes = Progress(Survey("Clima", [
            Person("Uno", SurveyParticipantStatuses.Completed, "esph-uno", Today),
            Person("Dos", SurveyParticipantStatuses.Started, "esph-dos", Today),
            Person("Tres", SurveyParticipantStatuses.NotStarted, "esph-tres", Today),
            Person("Cuatro", SurveyParticipantStatuses.Completed, "esph-cuatro", Today),
        ]));

        using var book = Open(bytes);
        var sheet = book.Worksheet("Clima");
        Assert.Equal("Total finalizadas", sheet.Cell(9, 1).GetString());
        Assert.False(sheet.Cell(9, 2).HasFormula);
        Assert.Equal(0.5d, sheet.Cell(9, 2).GetDouble(), 6);
        Assert.Equal("2 de 4 personas", sheet.Cell(9, 3).GetString());
    }

    /// <summary>
    /// Same people as the standard sheet: on a per-survey survey, those never sent a key are
    /// not counted, and the sheet says how many were left out.
    /// </summary>
    [Fact]
    public void The_progress_layout_counts_the_same_people_and_says_who_it_left_out()
    {
        var bytes = Progress(Survey("Clima", [
            Person("Con clave", SurveyParticipantStatuses.NotStarted, "esph-a", Today),
            Person("Sin clave", SurveyParticipantStatuses.NotStarted),
        ]));

        using var book = Open(bytes);
        var sheet = book.Worksheet("Clima");
        Assert.Equal("Con clave", sheet.Cell(5, 1).GetString());
        Assert.Equal("Total finalizadas", sheet.Cell(6, 1).GetString());
        Assert.Equal("0 de 1 personas", sheet.Cell(6, 3).GetString());
        Assert.Contains("1 persona de la audiencia no recibió código", sheet.Cell(8, 1).GetString(), StringComparison.Ordinal);
    }

    /// <summary>
    /// A survey that records no per-person state cannot fill a percentage column, so its sheet
    /// keeps the standard columns rather than printing a claim it cannot make.
    /// </summary>
    [Fact]
    public void A_survey_without_state_keeps_the_standard_sheet_in_the_progress_layout()
    {
        var bytes = Progress(Survey("Anonima", [Person("Uno", SurveyParticipantStatuses.NotStarted)], perSurvey: false, showState: false));

        using var book = Open(bytes);
        var sheet = book.Worksheet("Anonima");
        var headers = SurveyRosterCsv.Headers(spanish: true, perSurvey: false, showState: false);
        Assert.Equal(headers[0], sheet.Cell(4, 1).GetString());
        Assert.NotEqual("Nombre completo", sheet.Cell(4, 1).GetString());
    }

    [Fact]
    public void The_progress_layout_speaks_english_for_an_english_company()
    {
        var bytes = StatusWorkbook.Build(
            [Survey("Climate", [Person("Uno", SurveyParticipantStatuses.Started, "a", Today)])],
            Today,
            spanish: false,
            StatusWorkbookLayout.Progress);

        using var book = Open(bytes);
        var sheet = book.Worksheet("Climate");
        Assert.Equal(["Full name", "Progress", "Notes"], Enumerable.Range(1, 3).Select(c => sheet.Cell(4, c).GetString()));
        Assert.Equal("In progress", sheet.Cell(5, 2).GetString());
        Assert.Equal("Pending completion", sheet.Cell(5, 3).GetString());
    }
}
