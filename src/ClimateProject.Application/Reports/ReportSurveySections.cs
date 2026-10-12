using ClimateProject.Application.Surveys;

namespace ClimateProject.Application.Reports;

/// <summary>
/// The single path by which a generated report turns a <see cref="SurveyAggregate"/>
/// into its printed section.
///
/// <para>
/// The boundary with the results screens (#88/#61) is settled in
/// <see cref="SurveyAggregation"/>: aggregation is shared, and every surface -- results,
/// statistics, analytics, real-time-stats, and this report -- is a presentation over
/// the one <see cref="SurveyAggregate"/>. This class is therefore a pure projection.
/// It never computes a percentage, a mean, or a suppression decision; it re-shapes rows
/// and calls the aggregation's own <see cref="SurveyAggregation.SegmentDimensionScores"/>
/// for the one rollup a segment row needs. Anything here that looks like arithmetic
/// written out by hand is a bug.
/// </para>
/// <para>
/// The anonymity floor rides along for free, and that is the design rather than a
/// convenience: a suppressed segment reaches this code with its
/// <c>RespondentCount</c> already zeroed and its <c>Questions</c> already emptied by the
/// aggregation, so the withheld headcount is not merely hidden by the report -- it was
/// never handed to it, and neither was anything a score could be derived from.
/// </para>
/// <para>
/// <b>Open text.</b> The section prints word FREQUENCIES and never response text.
/// That is not a rule this class applies; it is a rule it cannot break, because
/// <see cref="SurveyQuestionResult.Words"/> is a list of
/// <see cref="SurveyWordFrequency"/> -- a word, a language and two counts -- and the
/// aggregate carries no verbatim answer anywhere for a projection to reach. The floor on
/// those words is <see cref="SurveyResultsPrivacy.MinimumWordRespondents"/> and it was
/// applied before this code ran.
/// </para>
/// </summary>
public static class ReportSurveySections
{
    /// <summary>The dimension key the aggregation gives the department breakdown.</summary>
    /// <remarks>
    /// One constant rather than three string literals: the department breakdown is
    /// SELECTED by this name for <see cref="ReportSurveySection.Departments"/> and
    /// EXCLUDED by it from <see cref="ReportSurveySection.Demographics"/>, and two
    /// literals that stopped agreeing would either print departments twice or drop them
    /// from the document entirely.
    /// </remarks>
    private const string DepartmentDimension = "department";

    /// <summary>Projects one survey's aggregate into the section its report prints.</summary>
    /// <param name="resolvedLocale">The locale the aggregate's question text and option labels were resolved for.</param>
    public static ReportSurveySection ToSection(
        Guid surveyId,
        string? title,
        string status,
        string resolvedLocale,
        SurveyAggregate aggregate)
    {
        ArgumentNullException.ThrowIfNull(aggregate);

        // The department breakdown is the one the report prints as departments. It may be
        // absent entirely -- a survey below the whole-survey floor has no breakdowns at
        // all -- in which case the section carries empty department rows and the
        // survey-level suppression flag explains why.
        var departments = aggregate.Breakdowns
            .FirstOrDefault(b => string.Equals(b.Dimension, DepartmentDimension, StringComparison.Ordinal));

        return new ReportSurveySection(
            surveyId,
            title,
            status,
            resolvedLocale,
            aggregate.Summary,
            // Carried verbatim, type and all. A re-shape here would be a second place that
            // decides what a distribution is, and the first thing it would drop is the
            // suppressed-word counter that says a cloud is incomplete.
            aggregate.Questions,
            aggregate.Dimensions,
            // Disclosed departments only. A withheld one is counted below and never named --
            // the CSV export's rule (SurveyResultsPrivacy.WithoutWithheldSegments): a named
            // withheld row beside the withheld headcount is that group's size whenever it is
            // the only one withheld.
            departments is null ? [] : departments.Segments.Where(s => !s.IsSuppressed).Select(ToDepartment).ToList(),
            // Null, not 0, when there is no department breakdown at all (a survey below the
            // whole-survey floor has none). Zero is a claim -- "nothing was withheld" -- about
            // a breakdown that was never computed.
            departments?.SuppressedSegmentCount,
            departments?.SuppressedRespondentCount,
            departments?.UnsegmentedRespondentCount,
            aggregate.Breakdowns
                .Where(b => !string.Equals(b.Dimension, DepartmentDimension, StringComparison.Ordinal))
                .Select(breakdown => ToDemographicBreakdown(aggregate, breakdown))
                .ToList(),
            aggregate.IsSuppressed,
            aggregate.SuppressionReason,
            aggregate.MinimumGroupSize);
    }

    private static ReportDepartmentParticipation ToDepartment(SurveySegmentResult segment)
        // IsSuppressed, RespondentCount and ParticipationRate are carried verbatim from
        // the aggregation's decision -- for a suppressed segment that is (true, 0, null),
        // and re-deriving any of them here is exactly the drift this class exists to
        // make impossible.
        => new(segment.Key, segment.Label, segment.RespondentCount, segment.ParticipationRate, segment.IsSuppressed);

    private static ReportDemographicBreakdown ToDemographicBreakdown(SurveyAggregate aggregate, SurveyBreakdown breakdown)
        => new(
            breakdown.Dimension,
            // Disclosed groups only; see the department rows above for why a withheld group
            // is counted and never named.
            breakdown.Segments.Where(segment => !segment.IsSuppressed).Select(segment => ToSegment(aggregate, segment)).ToList(),
            breakdown.SuppressedSegmentCount,
            breakdown.SuppressedRespondentCount,
            breakdown.UnsegmentedRespondentCount);

    private static ReportSegmentParticipation ToSegment(SurveyAggregate aggregate, SurveySegmentResult segment)
        => new(
            segment.Key,
            segment.Label,
            segment.RespondentCount,
            segment.IsSuppressed,
            // The fifth caller of SegmentDimensionScores, by design rather than by
            // resignation: this is the number a demographic breakdown exists to give (a
            // group's reading per dimension), it is the same weighted pooling the
            // whole-survey rollup and the climate-over-time matrix use, and writing the
            // GroupBy out here would be the fifth rollup that eventually disagrees with
            // the other four. A suppressed segment has no Questions, so it gets no rows.
            SurveyAggregation.SegmentDimensionScores(aggregate.Questions, segment)
                .OrderBy(score => score.Key, StringComparer.Ordinal)
                .Select(score => new ReportSegmentDimensionScore(score.Key, score.Value))
                .ToList());
}
