using ClimateProject.Application.Surveys;

namespace ClimateProject.Application.Reports;

/// <summary>
/// One dimension's movement between two surveys.
/// </summary>
/// <param name="Dimension">
/// The raw category string, exactly as <see cref="ClimateTrendDimension.Key"/> carries it.
/// Categories are authored free text and are translated nowhere in this product, so no label
/// is invented here.
/// </param>
/// <param name="EarlierScore">The earlier survey's score, or null when there is none to show.</param>
/// <param name="LaterScore">The later survey's score, or null when there is none to show.</param>
/// <param name="Delta">
/// <c>LaterScore - EarlierScore</c>, and <see langword="null"/> unless BOTH ends are present.
///
/// <para>Null has one meaning to a reader and three causes it must not be able to tell apart:
/// a survey below the anonymity floor, a survey that never asked this dimension, and a
/// dimension with no answered scale question. That is deliberately the same conflation
/// <see cref="ClimateTrendPoint.Scores"/> makes, and for the same reason -- a per-cell reason
/// code would let a reader difference "asked but withheld" against "never asked" and learn a
/// group's size.</para>
/// </param>
public sealed record ReportDimensionMovement(
    string Dimension,
    double? EarlierScore,
    double? LaterScore,
    double? Delta);

/// <summary>
/// The period-over-period section of a generated report: the same dimensions read across the
/// two most recent closed surveys.
/// </summary>
/// <param name="IsSuppressed">
/// True when either end of the comparison was withheld. <see cref="Dimensions"/> is then
/// empty -- not a list of nulls -- because a row per dimension would publish the instrument's
/// shape for a wave whose readings are withheld.
/// </param>
public sealed record ReportComparisonSection(
    Guid EarlierSurveyId,
    string? EarlierSurveyTitle,
    DateTimeOffset EarlierEndDate,
    Guid LaterSurveyId,
    string? LaterSurveyTitle,
    DateTimeOffset LaterEndDate,
    bool IsSuppressed,
    IReadOnlyList<ReportDimensionMovement> Dimensions);

/// <summary>
/// Projects <see cref="SurveyClimateTrends"/>' matrix into a report's comparison section
/// (#88 follow-up).
///
/// ## Why the delta is derived here and not computed here
///
/// The TODO this closes is explicit that "the delta must come from there rather than from a
/// subtraction written here". The distinction is not stylistic. Two scores subtracted from
/// <see cref="SurveyAggregateLoader"/>'s output directly would bypass every floor
/// <see cref="SurveyClimateTrends"/> applies; the subtraction below operates only on
/// <see cref="ClimateTrendPoint.Scores"/>, which are already null wherever the matrix withheld
/// them. The arithmetic is a subtraction; the *authority* for what may be subtracted is the
/// trends matrix, and nothing here can widen it.
///
/// ## Why the whole company, and only two surveys
///
/// **Ungrouped.** A per-department movement is a second suppression surface on a document that
/// <c>ReportShareEndpoints</c> serves to anonymous readers, and the department readings a report
/// may show are already in its survey sections, each carrying the aggregation's own decisions.
/// A delta adds a *relationship* between two waves, and a relationship between two withheld
/// waves is exactly what a differencing attack wants.
///
/// **Two.** "Period-over-period" is two windows. Feeding the whole twelve-survey window and
/// publishing the matrix would put a time series on a public link that no route puts there --
/// <c>GET /surveys/climate-trends</c> is authorized and this document is not.
///
/// ## Fail closed
///
/// If either end is suppressed the section reports <see cref="ReportComparisonSection.IsSuppressed"/>
/// and carries no rows. It is not omitted: a reader learning that a comparison exists but was
/// withheld is told something true, whereas an absent section reads as "these waves did not
/// move", which is the classic absent-count-as-zero leak this codebase already names.
/// </summary>
public static class ReportComparison
{
    /// <summary>How many surveys a comparison needs. Two windows, by definition.</summary>
    public const int RequiredSurveys = 2;

    /// <summary>
    /// The comparison for <paramref name="trends"/>, or <see langword="null"/> when the
    /// company has not closed two surveys yet -- which is a report with nothing to compare,
    /// not a report with a withheld comparison, and the two must not render the same.
    /// </summary>
    public static ReportComparisonSection? Build(ClimateTrendsResponse trends)
    {
        ArgumentNullException.ThrowIfNull(trends);

        if (trends.Surveys.Count < RequiredSurveys)
        {
            return null;
        }

        // Ungrouped, so exactly one series. Defensive rather than theatrical: a caller that
        // passed a groupBy would otherwise have its first department silently published as
        // "the company".
        if (trends.Groups.Count != 1)
        {
            return null;
        }

        var group = trends.Groups[0];
        if (group.Points.Count < RequiredSurveys)
        {
            return null;
        }

        // Oldest first (SurveyClimateTrends.Build sorts by EndDate), so the last two are the
        // most recent pair, and Points are positionally aligned to Surveys.
        var earlierIndex = trends.Surveys.Count - 2;
        var laterIndex = trends.Surveys.Count - 1;

        var earlierSurvey = trends.Surveys[earlierIndex];
        var laterSurvey = trends.Surveys[laterIndex];
        var earlier = group.Points[earlierIndex];
        var later = group.Points[laterIndex];

        if (earlier.IsSuppressed || later.IsSuppressed)
        {
            return new ReportComparisonSection(
                earlierSurvey.SurveyId, earlierSurvey.Title, earlierSurvey.EndDate,
                laterSurvey.SurveyId, laterSurvey.Title, laterSurvey.EndDate,
                IsSuppressed: true,
                Dimensions: []);
        }

        var movements = new List<ReportDimensionMovement>(trends.Dimensions.Count);
        for (var i = 0; i < trends.Dimensions.Count; i++)
        {
            // Positional alignment is the matrix's contract; a short row would be a defect in
            // Build rather than something to paper over, so it is read as absent, not skipped.
            var earlierScore = i < earlier.Scores.Count ? earlier.Scores[i] : null;
            var laterScore = i < later.Scores.Count ? later.Scores[i] : null;

            movements.Add(new ReportDimensionMovement(
                trends.Dimensions[i].Key,
                earlierScore,
                laterScore,
                earlierScore is { } from && laterScore is { } to ? to - from : null));
        }

        return new ReportComparisonSection(
            earlierSurvey.SurveyId, earlierSurvey.Title, earlierSurvey.EndDate,
            laterSurvey.SurveyId, laterSurvey.Title, laterSurvey.EndDate,
            IsSuppressed: false,
            Dimensions: movements);
    }
}
