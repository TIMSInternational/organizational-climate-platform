using ClimateProject.Application.Surveys;
using ClimateProject.UnitTests.Reports;

namespace ClimateProject.UnitTests.Surveys;

/// <summary>
/// The survey report's cross tables. Every assertion here is about what may and may not carry
/// a number: a cross of two variables needs 3 respondents per cell AND must not let a smaller
/// group be recovered by subtraction from the row or column totals printed beside it.
/// </summary>
public class SurveyCrossTabulationTests
{
    private static readonly string Operaciones = SurveyReportFixture.Operaciones.ToString();
    private static readonly string Legal = SurveyReportFixture.Legal.ToString();
    private static readonly string Finanzas = SurveyReportFixture.Finanzas.ToString();

    [Fact]
    public void A_cell_of_fewer_than_three_people_is_protected_and_carries_no_number_at_all()
    {
        var inputs = new SurveyReportFixture()
            .Add(10, SurveyReportFixture.Operaciones, "mujer", 4)
            .Add(10, SurveyReportFixture.Operaciones, "hombre", 3)
            .Add(2, SurveyReportFixture.Legal, "mujer", 5)
            .Add(8, SurveyReportFixture.Legal, "hombre", 2)
            .Inputs();

        var table = SurveyCrossTabulation.Build(inputs, inputs.Compute(), "department", "gender");

        var two = table.Cell(Legal, "mujer")!;
        Assert.False(two.IsDisclosed);
        Assert.Null(two.RespondentCount);
        Assert.Null(two.Average);
    }

    [Fact]
    public void A_cell_of_three_or_more_is_protected_when_subtracting_it_from_its_row_would_reveal_a_smaller_one()
    {
        // Finanzas: 10 women, 4 men, 2 "otra". Printing women and men beside the department's
        // total would hand anyone the 2 by subtraction, so the smallest disclosed sibling -- the
        // 4 men -- is withheld too, until the hidden remainder (6) is itself at least 3. The
        // other departments are large in every gender so no column guard interferes.
        var inputs = new SurveyReportFixture()
            .Add(12, SurveyReportFixture.Operaciones, "mujer", 4)
            .Add(12, SurveyReportFixture.Operaciones, "hombre", 4)
            .Add(5, SurveyReportFixture.Operaciones, "otra", 4)
            .Add(10, SurveyReportFixture.Finanzas, "mujer", 3)
            .Add(4, SurveyReportFixture.Finanzas, "hombre", 5)
            .Add(2, SurveyReportFixture.Finanzas, "otra", 1)
            .Inputs();

        var table = SurveyCrossTabulation.Build(inputs, inputs.Compute(), "department", "gender");

        Assert.False(table.Cell(Finanzas, "otra")!.IsDisclosed);
        var men = table.Cell(Finanzas, "hombre")!;
        Assert.False(men.IsDisclosed);
        Assert.Null(men.RespondentCount);
        Assert.Null(men.Average);
        Assert.True(table.Cell(Finanzas, "mujer")!.IsDisclosed);
    }

    [Fact]
    public void A_disclosed_cell_is_the_results_screens_own_answer_for_that_cross()
    {
        var inputs = new SurveyReportFixture()
            .Add(9, SurveyReportFixture.Operaciones, "mujer", 4)
            .Add(6, SurveyReportFixture.Operaciones, "hombre", 2)
            .Add(7, SurveyReportFixture.Finanzas, "mujer", 5)
            .Add(5, SurveyReportFixture.Finanzas, "hombre", 3)
            .Inputs();

        var table = SurveyCrossTabulation.Build(inputs, inputs.Compute(), "department", "gender");
        var screen = inputs.Compute(SurveyResultsFilter.For(
            new SurveySegmentSelector("department", Operaciones),
            new SurveySegmentSelector("gender", "mujer")));

        var cell = table.Cell(Operaciones, "mujer")!;
        Assert.True(cell.IsDisclosed);
        Assert.False(screen.IsSuppressed);
        Assert.Equal(screen.Summary.CompletedCount, cell.RespondentCount);
        Assert.Equal(SurveyCrossTabulation.OverallAverage(screen.Questions), cell.Average);
        Assert.Equal(9, cell.RespondentCount);
        Assert.Equal(4.0, cell.Average);
    }

    [Fact]
    public void A_combination_nobody_answered_is_protected_like_any_other_never_printed_as_zero()
    {
        var inputs = new SurveyReportFixture()
            .Add(9, SurveyReportFixture.Operaciones, "mujer", 4)
            .Add(6, SurveyReportFixture.Operaciones, "hombre", 2)
            .Add(7, SurveyReportFixture.Finanzas, "mujer", 5)
            .Inputs();

        var table = SurveyCrossTabulation.Build(inputs, inputs.Compute(), "department", "gender");

        var empty = table.Cell(Finanzas, "hombre")!;
        Assert.False(empty.IsDisclosed);
        Assert.Null(empty.RespondentCount);
    }

    [Fact]
    public void The_row_totals_are_the_single_variable_breakdown_shown_to_administrators_from_one()
    {
        var inputs = new SurveyReportFixture()
            .Add(9, SurveyReportFixture.Operaciones, "mujer", 4)
            .Add(1, SurveyReportFixture.Legal, "hombre", 2)
            .Inputs();
        var whole = inputs.Compute();

        var table = SurveyCrossTabulation.Build(inputs, whole, "department", "gender");

        var departments = whole.Breakdowns.Single(b => b.Dimension == "department");
        Assert.Equal(
            departments.Segments.Select(s => (s.Key, s.RespondentCount)),
            table.Rows.Select(r => (r.Key, r.RespondentCount)));
        Assert.Equal(1, table.Rows.Single(r => r.Key == Legal).RespondentCount);
    }

    [Fact]
    public void A_one_variable_table_lists_the_values_and_has_no_cells()
    {
        var inputs = new SurveyReportFixture()
            .Add(9, SurveyReportFixture.Operaciones, "mujer", 4)
            .Add(4, SurveyReportFixture.Finanzas, "hombre", 2)
            .Inputs();

        var table = SurveyCrossTabulation.Build(inputs, inputs.Compute(), "gender", null);

        Assert.Equal(["hombre", "mujer"], table.Rows.Select(r => r.Key));
        Assert.Empty(table.Columns);
        Assert.Empty(table.Cells);
        Assert.Equal(2.0, table.Rows.Single(r => r.Key == "hombre").Average);
    }

    [Fact]
    public void Scoping_the_rows_only_hides_rows_and_never_changes_a_cell()
    {
        var fixture = new SurveyReportFixture()
            .Add(9, SurveyReportFixture.Operaciones, "mujer", 4)
            .Add(6, SurveyReportFixture.Operaciones, "hombre", 2)
            .Add(7, SurveyReportFixture.Finanzas, "mujer", 5)
            .Add(5, SurveyReportFixture.Finanzas, "hombre", 3);
        var inputs = fixture.Inputs();
        var whole = inputs.Compute();

        var everything = SurveyCrossTabulation.Build(inputs, whole, "department", "gender");
        var scoped = SurveyCrossTabulation.Build(inputs, whole, "department", "gender", new HashSet<string> { Finanzas });

        Assert.Equal([Finanzas], scoped.Rows.Select(r => r.Key));
        Assert.All(scoped.Cells, cell => Assert.Equal(everything.Cell(cell.RowKey, cell.ColumnKey), cell));
    }

    [Fact]
    public void A_variable_cannot_be_crossed_with_itself()
        => Assert.Throws<ArgumentException>(() =>
        {
            var inputs = new SurveyReportFixture().Add(5, SurveyReportFixture.Operaciones, "mujer", 4).Inputs();
            SurveyCrossTabulation.Build(inputs, inputs.Compute(), "gender", "gender");
        });
}
