using ClimateProject.Application.Exports;
using ClimateProject.UnitTests.Reports;
using ClosedXML.Excel;

namespace ClimateProject.UnitTests.Exports;

/// <summary>
/// «Resultados agregados»: the results screen's own numbers in a workbook -- single variables
/// only, open questions left out, and a survey under the floor reduced to its participation.
/// </summary>
public class ResultsWorkbookTests
{
    private static SurveyReportFixture Meridiano()
        => new SurveyReportFixture()
            .Add(12, SurveyReportFixture.Operaciones, "mujer", 4, comment: "carga horarios")
            .Add(10, SurveyReportFixture.Operaciones, "hombre", 3, comment: "carga")
            .Add(6, SurveyReportFixture.Finanzas, "mujer", 5)
            .Add(1, SurveyReportFixture.Legal, "otra", 1);

    private static XLWorkbook Book(params ResultsWorkbookSurvey[] surveys)
        => new(new MemoryStream(ResultsWorkbook.Build(surveys, ScoreScale.Mean, spanish: true, new DateOnly(2026, 11, 14))));

    [Fact]
    public void The_summary_lists_every_survey_with_its_participation_and_overall_mean()
    {
        var aggregate = Meridiano().Inputs(invited: 58).Compute();
        using var book = Book(new ResultsWorkbookSurvey("Clima 2026", "closed", aggregate, SurveyReportFixture.Labels, []));

        var summary = book.Worksheet("Resumen");
        Assert.Equal("Clima 2026", summary.Cell(5, 1).GetString());
        Assert.Equal(29, summary.Cell(5, 3).GetValue<int>());
        Assert.Equal(58, summary.Cell(5, 4).GetValue<int>());
        Assert.Equal(Math.Round(SurveyCrossTabulationAverage(aggregate), 2), summary.Cell(5, 6).GetValue<double>());
    }

    [Fact]
    public void Each_closed_question_is_a_row_and_open_questions_are_left_out()
    {
        using var book = Book(new ResultsWorkbookSurvey("Clima 2026", "closed", Meridiano().Inputs().Compute(), SurveyReportFixture.Labels, []));

        var sheet = book.Worksheet("Clima 2026");
        var codes = Enumerable.Range(6, 6).Select(r => sheet.Cell(r, 1).GetString()).ToList();
        Assert.Equal(["P01", "P02", "P03"], codes.Take(3));
        Assert.DoesNotContain("P04", codes);
        Assert.Contains(sheet.CellsUsed(), c => c.GetString().StartsWith("Las preguntas abiertas no están en este archivo", StringComparison.Ordinal));
        Assert.DoesNotContain(sheet.CellsUsed(), c => c.GetString().Contains("horarios", StringComparison.Ordinal));
    }

    [Fact]
    public void A_ticked_group_adds_one_column_per_value_named_with_its_size()
    {
        using var book = Book(new ResultsWorkbookSurvey("Clima 2026", "closed", Meridiano().Inputs().Compute(), SurveyReportFixture.Labels, ["gender"]));

        var sheet = book.Worksheet("Clima 2026");
        var headers = sheet.Row(5).CellsUsed().Select(c => c.GetString()).ToList();
        Assert.Contains("Género: Hombre (n = 10)", headers);
        Assert.Contains("Género: Mujer (n = 18)", headers);
        Assert.Contains("Género: Otra (n = 1)", headers);

        var column = headers.IndexOf("Género: Hombre (n = 10)") + 1;
        Assert.Equal(3.0, sheet.Cell(6, column).GetValue<double>());
    }

    [Fact]
    public void A_survey_under_the_floor_carries_its_participation_and_no_result()
    {
        var aggregate = new SurveyReportFixture().Add(2, SurveyReportFixture.Operaciones, "mujer", 5).Inputs().Compute();
        using var book = Book(new ResultsWorkbookSurvey("Pulso", "active", aggregate, SurveyReportFixture.Labels, ["department"]));

        var sheet = book.Worksheet("Pulso");
        Assert.StartsWith("Menos de 3 respuestas completas", sheet.Cell(4, 1).GetString(), StringComparison.Ordinal);
        Assert.Equal(4, sheet.LastRowUsed()!.RowNumber());
        Assert.True(book.Worksheet("Resumen").Cell(5, 6).IsEmpty());
    }

    [Fact]
    public void Readings_in_percent_are_the_mean_times_twenty()
    {
        var aggregate = Meridiano().Inputs().Compute();
        using var book = new XLWorkbook(new MemoryStream(ResultsWorkbook.Build(
            [new ResultsWorkbookSurvey("Clima 2026", "closed", aggregate, SurveyReportFixture.Labels, [])],
            ScoreScale.Percent,
            spanish: true,
            new DateOnly(2026, 11, 14))));

        var sheet = book.Worksheet("Clima 2026");
        var mean = aggregate.Questions[0].Average!.Value;
        Assert.Equal(Math.Round(mean * 20, 1), sheet.Cell(6, 6).GetValue<double>());
    }

    private static double SurveyCrossTabulationAverage(ClimateProject.Application.Surveys.SurveyAggregate aggregate)
        => ClimateProject.Application.Surveys.SurveyCrossTabulation.OverallAverage(aggregate.Questions)!.Value;
}
