using ClimateProject.Application.Reports.SurveyReports;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Reports;

public class SurveyReportBuilderTests
{
    private static SurveyReportFixture Meridiano()
        => new SurveyReportFixture()
            .Add(12, SurveyReportFixture.Operaciones, "mujer", 4, "0-1", "carga horarios")
            .Add(10, SurveyReportFixture.Operaciones, "hombre", 3, "1-3", "carga equipo")
            .Add(6, SurveyReportFixture.Finanzas, "mujer", 5, "0-1")
            .Add(5, SurveyReportFixture.Finanzas, "hombre", 2, "1-3")
            .Add(1, SurveyReportFixture.Legal, "otra", 1, "1-3");

    [Fact]
    public void Choosing_departments_changes_which_rows_print_never_the_organisations_numbers()
    {
        var fixture = Meridiano();
        var everything = SurveyReportBuilder.Build(fixture.Source(SurveyReportFixture.Options()));
        var scoped = SurveyReportBuilder.Build(fixture.Source(SurveyReportFixture.Options(
            departments: [SurveyReportFixture.Finanzas.ToString()])));

        Assert.Equal(everything.OverallAverage, scoped.OverallAverage);
        Assert.Equal(everything.Participation.CompletedCount, scoped.Participation.CompletedCount);
        Assert.Equal(everything.Participation.ParticipationRate, scoped.Participation.ParticipationRate);
        Assert.Equal(everything.Dimensions.Select(d => d.Average), scoped.Dimensions.Select(d => d.Average));
        Assert.Equal(["Finanzas"], scoped.Departments.Select(d => d.Name));
        Assert.Equal(2, scoped.OmittedDepartmentCount);
        Assert.Equal(3, everything.Departments.Count);
        Assert.Equal(0, everything.OmittedDepartmentCount);
    }

    [Fact]
    public void A_survey_under_the_floor_produces_a_model_with_no_number_but_participation()
    {
        var fixture = new SurveyReportFixture().Add(2, SurveyReportFixture.Operaciones, "mujer", 5);
        var model = SurveyReportBuilder.Build(fixture.Source(SurveyReportFixture.Options(crosses: ["department*gender"])));

        Assert.True(model.IsSuppressed);
        Assert.Null(model.OverallAverage);
        Assert.Empty(model.Dimensions);
        Assert.Empty(model.Questions);
        Assert.Empty(model.Departments);
        Assert.Empty(model.Crosses);
        Assert.Equal(2, model.Participation.CompletedCount);
    }

    [Fact]
    public void Dimensions_print_in_the_order_the_instrument_asks_them_not_alphabetically()
    {
        var model = SurveyReportBuilder.Build(Meridiano().Source(SurveyReportFixture.Options()));

        Assert.Equal(["liderazgo", "carga"], model.Dimensions.Select(d => d.Key));
    }

    [Fact]
    public void A_dimensions_range_runs_from_its_lowest_shown_department_to_its_highest()
    {
        var model = SurveyReportBuilder.Build(Meridiano().Source(SurveyReportFixture.Options()));

        var leadership = model.Dimensions.Single(d => d.Key == "liderazgo");
        Assert.Equal(1.0, leadership.Low);
        Assert.True(leadership.High > leadership.Low);
        Assert.Equal(model.Departments.Max(d => d.DimensionAverages["liderazgo"]), leadership.High);
    }

    [Fact]
    public void The_comparison_is_now_minus_before_dimension_by_dimension()
    {
        var before = new SurveyReportFixture()
            .Add(10, SurveyReportFixture.Operaciones, "mujer", 3)
            .Add(10, SurveyReportFixture.Finanzas, "hombre", 3)
            .Inputs()
            .Compute();

        var model = SurveyReportBuilder.Build(Meridiano().Source(
            SurveyReportFixture.Options(compare: Guid.NewGuid().ToString()), before));

        var comparison = Assert.IsType<SurveyReportComparison>(model.Comparison);
        Assert.False(comparison.IsSuppressed);
        Assert.Equal(3.0, comparison.OverallBefore);
        Assert.All(comparison.Dimensions, d => Assert.Equal(3.0, d.Before));
        Assert.Equal(model.Dimensions.Select(d => d.Average!.Value), comparison.Dimensions.Select(d => d.Now));
        Assert.Equal(0, comparison.UnmatchedDimensionCount);
    }

    [Fact]
    public void An_earlier_survey_under_the_floor_compares_as_suppressed_with_no_number()
    {
        var before = new SurveyReportFixture().Add(2, SurveyReportFixture.Operaciones, "mujer", 3).Inputs().Compute();

        var model = SurveyReportBuilder.Build(Meridiano().Source(
            SurveyReportFixture.Options(compare: Guid.NewGuid().ToString()), before));

        Assert.True(model.Comparison!.IsSuppressed);
        Assert.Null(model.Comparison.OverallBefore);
        Assert.Empty(model.Comparison.Dimensions);
    }

    [Fact]
    public void The_department_always_reads_down_the_side_whichever_way_it_was_asked()
    {
        var model = SurveyReportBuilder.Build(Meridiano().Source(SurveyReportFixture.Options(crosses: ["gender*department"])));

        var cross = Assert.Single(model.Crosses);
        Assert.Equal("department", cross.Table.RowField);
        Assert.Equal("gender", cross.Table.ColumnField);
        Assert.Equal("Departamento", cross.RowName);
        Assert.Equal("Género", cross.ColumnName);
        Assert.Equal("Mujer", cross.ColumnValueNames["mujer"]);
        Assert.Equal("Finanzas", cross.RowValueNames[SurveyReportFixture.Finanzas.ToString()]);
    }

    [Fact]
    public void The_department_scope_also_scopes_the_department_crosses()
    {
        var model = SurveyReportBuilder.Build(Meridiano().Source(SurveyReportFixture.Options(
            departments: [SurveyReportFixture.Operaciones.ToString()],
            crosses: ["department*gender"])));

        Assert.Equal([SurveyReportFixture.Operaciones.ToString()], model.Crosses.Single().Table.Rows.Select(r => r.Key));
    }

    [Fact]
    public void The_variables_list_the_department_first_and_name_every_field_as_the_company_does()
    {
        var whole = Meridiano().Inputs().Compute();

        var variables = SurveyReportBuilder.Variables(whole, SurveyReportFixture.Labels, "es");

        Assert.Equal(["department", "gender", "tenure"], variables.Select(v => v.Field));
        Assert.Equal(["Departamento", "Género", "Antigüedad"], variables.Select(v => v.Label));
        Assert.Equal(3, variables.Single(v => v.Field == "gender").ValueCount);
    }

    [Fact]
    public void A_variable_with_a_single_value_is_not_offered_for_crossing()
    {
        var whole = new SurveyReportFixture()
            .Add(5, SurveyReportFixture.Operaciones, "mujer", 4)
            .Add(5, SurveyReportFixture.Finanzas, "mujer", 3)
            .Inputs()
            .Compute();

        var variables = SurveyReportBuilder.Variables(whole, SurveyReportFixture.Labels, "es");

        Assert.DoesNotContain(variables, v => v.Field == "gender");
    }

    [Fact]
    public void Open_questions_carry_word_counts_only_and_never_reach_the_question_list()
    {
        var model = SurveyReportBuilder.Build(Meridiano().Source(SurveyReportFixture.Options()));

        Assert.DoesNotContain(model.Questions, q => q.Type == "open_ended");
        var open = Assert.Single(model.OpenQuestions);
        Assert.Equal("P04", open.Code);
        Assert.Contains(open.Words, w => w.Word == "carga" && w.ResponseCount == 22);
    }
}
