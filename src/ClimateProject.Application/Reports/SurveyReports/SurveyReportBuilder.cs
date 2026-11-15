using System.Globalization;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Reports.Rendering;
using ClimateProject.Application.Surveys;

namespace ClimateProject.Application.Reports.SurveyReports;

/// <summary>A variable the report can cross: the department, or one demographic field.</summary>
/// <param name="Field">The selector field: <see cref="SurveySegmentSelector.DepartmentField"/> or a demographic key.</param>
/// <param name="Label">The name a reader sees.</param>
/// <param name="ValueCount">How many values it takes in this survey's completed responses.</param>
public sealed record SurveyReportVariable(string Field, string Label, int ValueCount);

/// <summary>
/// Turns one survey's aggregate into the <see cref="SurveyReportModel"/> the PDF prints.
///
/// ## It decides presentation, never disclosure
///
/// Every number here comes off <see cref="SurveyAggregation.Compute"/>: the whole survey's
/// aggregate the results screen serves, and -- for a cross -- one filtered aggregate per cell
/// through <see cref="SurveyCrossTabulation"/>. This class orders, names, scopes and picks
/// sections. It has no floor of its own and no branch that could print a number the
/// aggregation withheld: a suppressed survey arrives with no questions, dimensions or
/// breakdowns, and the model it produces has none either.
/// </summary>
public static class SurveyReportBuilder
{
    /// <summary>
    /// The survey's variables, department first and then the demographic fields in key order.
    /// A variable with fewer than two values in this survey's responses is left out: crossing
    /// with it would only print the other variable again.
    /// </summary>
    public static IReadOnlyList<SurveyReportVariable> Variables(SurveyAggregate whole, SurveyExportLabels labels, string? locale)
    {
        ArgumentNullException.ThrowIfNull(whole);
        ArgumentNullException.ThrowIfNull(labels);

        var copy = SurveyReportCopy.For(locale);
        var variables = new List<SurveyReportVariable>();
        foreach (var breakdown in whole.Breakdowns)
        {
            // One variable per field. A respondent's self-declared área that names no
            // department of the company stays a demographic keyed "department" (SurveyAggregation
            // lifts only the ones it can match), and that key is the department selector's: the
            // results filter reads it as a department id. The department breakdown comes first,
            // so it is the one kept.
            if (variables.Any(v => string.Equals(v.Field, breakdown.Dimension, StringComparison.Ordinal)))
            {
                continue;
            }

            var values = breakdown.Segments.Count(s => !s.IsSuppressed);
            if (values < 2)
            {
                continue;
            }

            var isDepartment = string.Equals(breakdown.Dimension, SurveySegmentSelector.DepartmentField, StringComparison.Ordinal);
            var label = isDepartment
                ? copy.DepartmentVariable
                : labels.Dimensions.TryGetValue(breakdown.Dimension, out var named) ? named : breakdown.Dimension;
            variables.Add(new SurveyReportVariable(breakdown.Dimension, label, values));
        }

        return [.. variables
            .OrderBy(v => string.Equals(v.Field, SurveySegmentSelector.DepartmentField, StringComparison.Ordinal) ? 0 : 1)
            .ThenBy(v => v.Field, StringComparer.Ordinal)];
    }

    /// <summary>Builds the model. The options must already be validated against <see cref="Variables"/>.</summary>
    public static SurveyReportModel Build(SurveyReportSource source)
    {
        ArgumentNullException.ThrowIfNull(source);

        var copy = SurveyReportCopy.For(source.Locale);
        var whole = source.Whole;
        var options = source.Options;
        var locale = copy.Spanish ? "es" : "en";

        var departmentBreakdown = whole.Breakdowns
            .FirstOrDefault(b => string.Equals(b.Dimension, SurveySegmentSelector.DepartmentField, StringComparison.Ordinal));
        var disclosedDepartments = departmentBreakdown?.Segments.Where(s => !s.IsSuppressed).ToList() ?? [];
        var chosen = options.DepartmentIds is { } ids
            ? ids.Select(id => id.ToString()).ToHashSet(StringComparer.OrdinalIgnoreCase)
            : null;

        var departments = disclosedDepartments
            .Where(s => chosen is null || chosen.Contains(s.Key))
            .Select(s => new SurveyReportDepartment(
                s.Key,
                string.IsNullOrWhiteSpace(s.Label) ? copy.UnnamedDepartment : s.Label,
                s.RespondentCount,
                s.Headcount,
                SurveyCrossTabulation.SegmentAverage(whole.Questions, s),
                SurveyAggregation.SegmentDimensionScores(whole.Questions, s)))
            .OrderBy(d => d.Name, StringComparer.Create(CultureInfo.InvariantCulture, ignoreCase: true))
            .ToList();

        // Dimensions in the order the instrument first asks them, which is the order the client
        // designed and the order the questions section prints -- not the alphabetical order the
        // aggregation keys them by.
        var dimensionOrder = whole.Questions
            .Where(q => !string.IsNullOrWhiteSpace(q.Category))
            .Select(q => q.Category!)
            .Distinct(StringComparer.Ordinal)
            .ToList();
        var dimensions = dimensionOrder
            .Select(key => whole.Dimensions.FirstOrDefault(d => string.Equals(d.Dimension, key, StringComparison.Ordinal)))
            .Where(d => d is not null)
            .Select(d =>
            {
                var spread = departments
                    .Select(dep => dep.DimensionAverages.TryGetValue(d!.Dimension, out var v) ? v : null)
                    .Where(v => v is not null)
                    .Select(v => v!.Value)
                    .ToList();
                return new SurveyReportDimension(
                    d!.Dimension,
                    DimensionNames.Resolve(d.Dimension, locale) ?? d.Dimension,
                    d.AverageScore,
                    spread.Count > 0 ? spread.Min() : null,
                    spread.Count > 0 ? spread.Max() : null,
                    d.QuestionCount);
            })
            .ToList();

        var crosses = options.Has(SurveyReportSections.Crosses) && !whole.IsSuppressed
            ? options.Crosses.Select(request => BuildCross(source, request, chosen, copy)).ToList()
            : [];

        var dimensionNames = dimensions.ToDictionary(d => d.Key, d => d.Name, StringComparer.Ordinal);
        var codeWidth = whole.Questions.Count >= 100 ? 3 : 2;
        string Code(int index) => "P" + (index + 1).ToString(CultureInfo.InvariantCulture).PadLeft(codeWidth, '0');

        var questions = new List<SurveyReportQuestion>();
        var openQuestions = new List<SurveyReportOpenQuestion>();
        for (var i = 0; i < whole.Questions.Count; i++)
        {
            var q = whole.Questions[i];
            if (QuestionTypes.FreeText.Contains(q.Type, StringComparer.Ordinal))
            {
                openQuestions.Add(new SurveyReportOpenQuestion(Code(i), q.Text, q.AnsweredCount, q.Words, q.SuppressedWordCount));
                continue;
            }

            questions.Add(new SurveyReportQuestion(
                Code(i),
                q.Text,
                q.Category is { } category && dimensionNames.TryGetValue(category, out var name)
                    ? name
                    : string.IsNullOrWhiteSpace(q.Category) ? null : q.Category,
                q.Type,
                q.AnsweredCount,
                q.Average,
                q.ScaleMin,
                q.ScaleMax,
                q.ScaleLabelMin,
                q.ScaleLabelMax,
                q.Distribution));
        }

        return new SurveyReportModel(
            locale,
            source.CompanyName,
            string.IsNullOrWhiteSpace(source.SurveyTitle) ? copy.UntitledSurvey : source.SurveyTitle,
            source.SurveyStatus,
            source.GeneratedAt,
            source.Scale,
            source.Bands,
            options.Sections,
            whole.Summary,
            whole.IsSuppressed,
            SurveyCrossTabulation.OverallAverage(whole.Questions),
            dimensions,
            departments,
            disclosedDepartments.Count - departments.Count,
            crosses,
            questions,
            openQuestions,
            BuildComparison(source, dimensions, locale));
    }

    private static SurveyReportCross BuildCross(
        SurveyReportSource source,
        SurveyReportCrossRequest request,
        HashSet<string>? chosenDepartments,
        SurveyReportCopy copy)
    {
        var (row, column) = (request.RowField, request.ColumnField);

        // The department always reads down the side: an org chart runs to dozens of rows,
        // and rows break across pages where columns cannot. Otherwise the variable with more
        // values goes down the side, for the same reason.
        if (column is not null && (IsDepartment(column) || (!IsDepartment(row) && ValueCount(source.Whole, column) > ValueCount(source.Whole, row))))
        {
            (row, column) = (column, row);
        }

        var rowKeys = IsDepartment(row) ? chosenDepartments : null;
        var table = SurveyCrossTabulation.Build(source.Inputs, source.Whole, row, column, rowKeys);
        var variables = Variables(source.Whole, source.Labels, source.Locale);

        string VariableName(string field)
            => variables.FirstOrDefault(v => string.Equals(v.Field, field, StringComparison.Ordinal))?.Label
               ?? (IsDepartment(field) ? copy.DepartmentVariable : field);

        Dictionary<string, string> ValueNames(string field, IReadOnlyList<CrossTabMarginal> values)
            => values.ToDictionary(
                v => v.Key,
                v => IsDepartment(field)
                    ? (string.IsNullOrWhiteSpace(v.Label) ? copy.UnnamedDepartment : v.Label)
                    : source.Labels.Options.TryGetValue((field, v.Key), out var label) ? label : v.Key,
                StringComparer.Ordinal);

        return new SurveyReportCross(
            VariableName(row),
            column is null ? null : VariableName(column),
            table,
            ValueNames(row, table.Rows),
            column is null ? new Dictionary<string, string>(StringComparer.Ordinal) : ValueNames(column, table.Columns));
    }

    private static SurveyReportComparison? BuildComparison(
        SurveyReportSource source,
        IReadOnlyList<SurveyReportDimension> dimensions,
        string locale)
    {
        if (source.Compare is not { } before || !source.Options.Has(SurveyReportSections.Comparison) || source.Whole.IsSuppressed)
        {
            return null;
        }

        if (before.IsSuppressed)
        {
            return new SurveyReportComparison(source.CompareTitle, true, null, [], 0);
        }

        var deltas = new List<SurveyReportDimensionDelta>();
        foreach (var dimension in dimensions)
        {
            var earlier = before.Dimensions.FirstOrDefault(d => string.Equals(d.Dimension, dimension.Key, StringComparison.Ordinal));
            if (dimension.Average is { } now && earlier?.AverageScore is { } then)
            {
                deltas.Add(new SurveyReportDimensionDelta(dimension.Name, then, now));
            }
        }

        var keys = dimensions.Select(d => d.Key)
            .Union(before.Dimensions.Select(d => d.Dimension), StringComparer.Ordinal)
            .Count();

        return new SurveyReportComparison(
            source.CompareTitle,
            false,
            SurveyCrossTabulation.OverallAverage(before.Questions),
            deltas,
            keys - deltas.Count);
    }

    private static bool IsDepartment(string field)
        => string.Equals(field, SurveySegmentSelector.DepartmentField, StringComparison.Ordinal);

    private static int ValueCount(SurveyAggregate whole, string field)
        => whole.Breakdowns
            .FirstOrDefault(b => string.Equals(b.Dimension, field, StringComparison.Ordinal))?
            .Segments.Count(s => !s.IsSuppressed) ?? 0;
}
