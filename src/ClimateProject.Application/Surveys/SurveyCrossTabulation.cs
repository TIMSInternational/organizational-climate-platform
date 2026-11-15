using ClimateProject.Application.Questions;

namespace ClimateProject.Application.Surveys;

/// <summary>
/// Everything <see cref="SurveyAggregation.Compute"/> reads, loaded once.
/// </summary>
/// <remarks>
/// A cross table asks the aggregation one question per cell. Loading the rows once and asking
/// in memory keeps a table of forty cells at one database round trip instead of forty, and --
/// the reason that matters more -- it means every cell is answered by the same
/// <see cref="SurveyAggregation.Compute"/> the results screen runs, filter and floors included.
/// </remarks>
public sealed record SurveyAggregationInputs(
    IReadOnlyList<AggregationQuestion> Questions,
    IReadOnlyList<AggregationResponse> Responses,
    IReadOnlyList<AggregationAnswer> Answers,
    IReadOnlyList<AggregationDepartment> Departments,
    int? TargetAudienceCount)
{
    /// <summary>The whole survey, or the cohort <paramref name="filter"/> selects.</summary>
    public SurveyAggregate Compute(SurveyResultsFilter? filter = null)
        => SurveyAggregation.Compute(Questions, Responses, Answers, Departments, TargetAudienceCount, filter);
}

/// <summary>One value of a cross table's variable, as a whole row or column.</summary>
/// <param name="Key">The stored value: a department id, or a decoded demographic value.</param>
/// <param name="Label">The display label, when the source has one.</param>
/// <param name="RespondentCount">Completed responses carrying this value.</param>
/// <param name="Average">The pooled mean of every scale answer in the group.</param>
public sealed record CrossTabMarginal(string Key, string? Label, int RespondentCount, double? Average);

/// <summary>One cell of a cross table: a group defined by a row value AND a column value.</summary>
/// <remarks>
/// A protected cell carries NO number -- not a count, not a mean, not a zero. Fewer than three
/// people, three or more who could be recovered by subtraction, and nobody at all are one state
/// here and one state in every rendering: telling them apart would itself say a group of one or
/// two exists (the design ruling of 14 Nov 2026).
/// </remarks>
public sealed record CrossTabCell(string RowKey, string ColumnKey, bool IsDisclosed, int? RespondentCount, double? Average);

/// <summary>A cross table of two variables, or the plain breakdown of one.</summary>
public sealed record CrossTab(
    string RowField,
    string? ColumnField,
    IReadOnlyList<CrossTabMarginal> Rows,
    IReadOnlyList<CrossTabMarginal> Columns,
    IReadOnlyList<CrossTabCell> Cells)
{
    /// <summary>Cells that print a number.</summary>
    public int DisclosedCount => Cells.Count(c => c.IsDisclosed);

    /// <summary>Cells printed as protected.</summary>
    public int ProtectedCount => Cells.Count(c => !c.IsDisclosed);

    /// <summary>The cell at a row and column, or null for a one-variable table.</summary>
    public CrossTabCell? Cell(string rowKey, string columnKey)
        => Cells.FirstOrDefault(c => string.Equals(c.RowKey, rowKey, StringComparison.Ordinal)
                                     && string.Equals(c.ColumnKey, columnKey, StringComparison.Ordinal));
}

/// <summary>
/// The cross tables of the survey report: department by gender, seniority by age -- any two of
/// the survey's variables, each cell a group of respondents.
///
/// ## Every cell is the results screen's own answer
///
/// A cell is <see cref="SurveyAggregation.Compute"/> run with a two-selector
/// <see cref="SurveyResultsFilter"/>, which is exactly what <c>GET /surveys/{id}/results
/// ?segment=a&amp;segment=b</c> runs. So a cell is disclosed precisely when the screen would
/// disclose that cross: three respondents at least (<see cref="SurveyResultsPrivacy.MinimumSegmentRespondents"/>),
/// AND <see cref="SurveyResultsFilter.MayDisclose"/>'s sibling rule, which withholds a cell
/// whose value could be recovered by subtracting the other cells of its row or column from the
/// row's or column's total. This class adds no floor and relaxes none; it only asks once per
/// cell.
///
/// ## The marginals are single variables
///
/// A row or column total is one variable alone -- "everyone in Operaciones" -- which the
/// client's ruling of 15 Oct 2026 shows to administrators from one respondent, as the results
/// breakdown does. They come off the whole-survey aggregate's own breakdown, never computed
/// here a second time. The subtraction guard above is what makes printing them next to the
/// cells safe: it is measured against exactly these totals.
/// </summary>
public static class SurveyCrossTabulation
{
    /// <summary>
    /// Builds one table. <paramref name="whole"/> must be <paramref name="inputs"/>' own
    /// unfiltered aggregate: its breakdowns are the variables' values and totals.
    /// </summary>
    /// <param name="rowField">A demographic field key, or <see cref="SurveySegmentSelector.DepartmentField"/>.</param>
    /// <param name="columnField">The second variable, or null for a one-variable table.</param>
    /// <param name="rowKeys">When given, only these row values are drawn (the report's department scope). Hiding a row only ever removes numbers.</param>
    public static CrossTab Build(
        SurveyAggregationInputs inputs,
        SurveyAggregate whole,
        string rowField,
        string? columnField,
        IReadOnlySet<string>? rowKeys = null)
    {
        ArgumentNullException.ThrowIfNull(inputs);
        ArgumentNullException.ThrowIfNull(whole);
        ArgumentException.ThrowIfNullOrWhiteSpace(rowField);
        if (columnField is not null && string.Equals(rowField, columnField, StringComparison.Ordinal))
        {
            throw new ArgumentException("A cross needs two different variables.", nameof(columnField));
        }

        var scaleQuestions = ScaleQuestionIds(whole.Questions);
        var rows = Marginals(whole, rowField, scaleQuestions)
            .Where(r => rowKeys is null || rowKeys.Contains(r.Key))
            .ToList();

        if (columnField is null)
        {
            return new CrossTab(rowField, null, rows, [], []);
        }

        var columns = Marginals(whole, columnField, scaleQuestions);
        var cells = new List<CrossTabCell>(rows.Count * columns.Count);
        foreach (var row in rows)
        {
            foreach (var column in columns)
            {
                var cohort = inputs.Compute(SurveyResultsFilter.For(
                    new SurveySegmentSelector(rowField, row.Key),
                    new SurveySegmentSelector(columnField, column.Key)));

                // IsSuppressed covers all three refusals: the sibling rule, a cohort under the
                // floor, and an empty cohort (MayDisclose finds no such value). A disclosed
                // cohort is at least the floor by construction; the explicit check below is a
                // second lock on the one property this class must never lose.
                var disclosed = !cohort.IsSuppressed
                    && cohort.Summary.CompletedCount >= SurveyResultsPrivacy.MinimumSegmentRespondents;

                cells.Add(disclosed
                    ? new CrossTabCell(row.Key, column.Key, true, cohort.Summary.CompletedCount, OverallAverage(cohort.Questions))
                    : new CrossTabCell(row.Key, column.Key, false, null, null));
            }
        }

        return new CrossTab(rowField, columnField, rows, columns, cells);
    }

    /// <summary>
    /// The pooled mean of every scale answer: the survey's "media general". The same weighting
    /// as a dimension score (<see cref="SurveyAggregation.PooledAverage"/>), across every scale
    /// question rather than one category's.
    /// </summary>
    public static double? OverallAverage(IReadOnlyList<SurveyQuestionResult> questions)
    {
        ArgumentNullException.ThrowIfNull(questions);
        return SurveyAggregation.PooledAverage(questions
            .Where(q => QuestionTypes.NumericScale.Contains(q.Type, StringComparer.Ordinal))
            .Select(q => (q.AnsweredCount, q.Average)));
    }

    /// <summary>A segment's "media general", over the same scale questions as <see cref="OverallAverage"/>.</summary>
    public static double? SegmentAverage(IReadOnlyList<SurveyQuestionResult> questions, SurveySegmentResult segment)
    {
        ArgumentNullException.ThrowIfNull(segment);
        var scale = ScaleQuestionIds(questions);
        return SurveyAggregation.PooledAverage(segment.Questions
            .Where(q => scale.Contains(q.QuestionId))
            .Select(q => (q.AnsweredCount, q.Average)));
    }

    private static HashSet<Guid> ScaleQuestionIds(IReadOnlyList<SurveyQuestionResult> questions)
        => [.. questions
            .Where(q => QuestionTypes.NumericScale.Contains(q.Type, StringComparer.Ordinal))
            .Select(q => q.QuestionId)];

    private static List<CrossTabMarginal> Marginals(SurveyAggregate whole, string field, HashSet<Guid> scaleQuestions)
    {
        var breakdown = whole.Breakdowns.FirstOrDefault(b => string.Equals(b.Dimension, field, StringComparison.Ordinal));
        if (breakdown is null)
        {
            return [];
        }

        // A withheld segment is left out, never printed as a zero. Since 2026-10-15 a single
        // variable withholds nothing for administrators, so in practice every value is here.
        return [.. breakdown.Segments
            .Where(s => !s.IsSuppressed)
            .Select(s => new CrossTabMarginal(
                s.Key,
                s.Label,
                s.RespondentCount,
                SurveyAggregation.PooledAverage(s.Questions
                    .Where(q => scaleQuestions.Contains(q.QuestionId))
                    .Select(q => (q.AnsweredCount, q.Average)))))];
    }
}
