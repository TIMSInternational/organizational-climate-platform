using ClimateProject.Application.Exports;
using ClosedXML.Excel;

namespace ClimateProject.UnitTests.Exports;

public class QuestionnaireWorkbookTests
{
    private static readonly QuestionnaireSurvey Clima = new(
        "Clima Organizacional 2026",
        "closed",
        new DateTimeOffset(2026, 2, 3, 0, 0, 0, TimeSpan.Zero),
        new DateTimeOffset(2026, 2, 28, 0, 0, 0, TimeSpan.Zero),
        [
            new QuestionnaireQuestion(1, "multiple_choice", null, false, "¿Qué beneficio valora más?", null, null, null, null, null, null, null,
                [new QuestionnaireOption(1, "horario", "Horario flexible", "Flexible hours"), new QuestionnaireOption(0, "salud", "Seguro de salud", null)]),
            new QuestionnaireQuestion(0, "likert", "liderazgo", true, "Mi jefatura me trata con respeto.", "My manager treats me with respect.", 1, 5,
                "Totalmente en desacuerdo", "Strongly disagree", "Totalmente de acuerdo", "Strongly agree", []),
        ]);

    private static IXLWorksheet Sheet(byte[] bytes, out XLWorkbook book)
    {
        book = new XLWorkbook(new MemoryStream(bytes));
        // The first sheet is the cover; the questionnaire starts on the second.
        return book.Worksheet(2);
    }

    [Fact]
    public void Every_question_is_a_row_in_instrument_order_with_both_languages()
    {
        var sheet = Sheet(QuestionnaireWorkbook.Build([Clima], spanish: true), out var book);
        using var _ = book;

        Assert.Equal("Clima Organizacional 2026", sheet.Name);
        Assert.Equal("N.º", sheet.Cell(4, 1).GetString());
        Assert.Equal("P01", sheet.Cell(5, 1).GetString());
        Assert.Equal("Mi jefatura me trata con respeto.", sheet.Cell(5, 5).GetString());
        Assert.Equal("My manager treats me with respect.", sheet.Cell(5, 6).GetString());
        Assert.Equal("Escala", sheet.Cell(5, 3).GetString());
        Assert.Equal("Sí", sheet.Cell(5, 4).GetString());
        Assert.Equal("P02", sheet.Cell(6, 1).GetString());
        Assert.Equal("Opción múltiple", sheet.Cell(6, 3).GetString());
    }

    [Fact]
    public void An_untranslated_text_stays_an_empty_cell_never_filled_from_the_other_language()
    {
        var sheet = Sheet(QuestionnaireWorkbook.Build([Clima], spanish: true), out var book);
        using var _ = book;

        Assert.True(sheet.Cell(6, 6).IsEmpty());
        Assert.Equal("salud = Seguro de salud\nhorario = Horario flexible", sheet.Cell(6, 12).GetString());
        Assert.Equal("salud =\nhorario = Flexible hours", sheet.Cell(6, 13).GetString());
    }

    [Fact]
    public void The_headings_follow_the_language_chosen()
    {
        var sheet = Sheet(QuestionnaireWorkbook.Build([Clima], spanish: false), out var book);
        using var _ = book;

        Assert.Equal("No.", sheet.Cell(4, 1).GetString());
        Assert.Equal("Scale", sheet.Cell(5, 3).GetString());
    }

    [Fact]
    public void No_survey_still_opens_and_says_why_it_is_empty()
    {
        var sheet = Sheet(QuestionnaireWorkbook.Build([], spanish: true), out var book);
        using var _ = book;

        Assert.Equal("No se eligió ninguna encuesta.", sheet.Cell(1, 1).GetString());
    }
}
