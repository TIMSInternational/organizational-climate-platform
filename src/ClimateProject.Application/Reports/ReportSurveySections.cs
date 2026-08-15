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
/// It never computes a percentage, a mean, or a suppression decision; it only drops
/// detail a report does not print (per-question distributions, per-segment question
/// averages). Anything here that looks like arithmetic is a bug.
/// </para>
/// <para>
/// The anonymity floor rides along for free, and that is the design rather than a
/// convenience: a suppressed segment reaches this code with its
/// <c>RespondentCount</c> already zeroed by the aggregation, so the withheld headcount
/// is not merely hidden by the report -- it was never handed to it.
/// </para>
/// </summary>
public static class ReportSurveySections
{
    /// <summary>Projects one survey's aggregate into the section its report prints.</summary>
    public static ReportSurveySection ToSection(Guid surveyId, string? title, string status, SurveyAggregate aggregate)
    {
        ArgumentNullException.ThrowIfNull(aggregate);

        // The department breakdown is the one the report prints. It may be absent
        // entirely -- a survey below the whole-survey floor has no breakdowns at all --
        // in which case the section carries empty department rows and the survey-level
        // suppression flag explains why.
        var departments = aggregate.Breakdowns
            .FirstOrDefault(b => string.Equals(b.Dimension, "department", StringComparison.Ordinal));

        return new ReportSurveySection(
            surveyId,
            title,
            status,
            aggregate.Summary,
            aggregate.Dimensions,
            departments is null ? [] : departments.Segments.Select(ToDepartment).ToList(),
            departments?.SuppressedSegmentCount ?? 0,
            departments?.SuppressedRespondentCount ?? 0,
            departments?.UnsegmentedRespondentCount ?? 0,
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
}
