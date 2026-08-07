using ClimateProject.Application.Analytics;

namespace ClimateProject.Application.Surveys;

/// <summary>
/// Small-group disclosure control for survey results, and the reasoning behind each
/// of the three floors.
///
/// **The shape of the risk.** A survey result is an aggregate, and an aggregate
/// discloses an individual when the group it covers is small enough that "the group"
/// and "the person" are the same thing. There are three distinct ways that happens
/// here and they need three different answers -- a single number applied everywhere
/// would either leak (too low for cross-tabs) or delete the product (too high for a
/// distribution).
///
/// 1. **The survey as a whole** (<see cref="MinimumRespondents"/>). With four complete
///    responses, a per-question distribution is close to a verbatim readout: an admin
///    who knows who was invited can line the answers up against the four people. So
///    below the floor nothing per-question is returned at all -- not distributions,
///    not averages, not word frequencies. The participation counters *are* still
///    returned, because a count is what tells an admin whether to keep chasing
///    responses and "3 of 40 so far" identifies nobody.
///
/// 2. **A segment** (<see cref="MinimumSegmentRespondents"/>). This is the real
///    disclosure surface, and it is the one #87 already ruled on for demographic
///    snapshots. Department x role x tenure narrows a workforce far faster than any
///    one of them does, and a segment of one means every answer in that segment is
///    one named person's answers. The floor is deliberately **the same 5** as
///    <c>DemographicSnapshotPrivacy.MinimumGroupSize</c>: these are the same
///    quasi-identifiers over the same workforce, and two different floors on two
///    surfaces that can be differenced against each other is how a suppression rule
///    gets defeated without anyone breaking it.
///
/// 3. **A word in free text** (<see cref="MinimumWordRespondents"/>). Different risk,
///    different answer. A word cloud does not leak by group size, it leaks by
///    distinctiveness -- one respondent writing "my visa renewal" names themselves to
///    a reader who knows the team, however many people answered. The control that
///    matters is dropping words that occur in only one response, so the floor is 2.
///    Setting it to 5 was considered and rejected: it empties the cloud for exactly
///    the survey sizes this product runs at, which is a feature deleted rather than a
///    risk removed. Verbatim open text is never returned by this surface at all,
///    which is the larger half of the control.
///
/// **What is deliberately NOT suppressed: buckets inside a whole-survey question
/// distribution.** Once the survey is above <see cref="MinimumRespondents"/>, a bucket
/// of one ("one person strongly disagreed") is an answer count over a population that
/// already passed the floor, not a quasi-identifier -- it says nothing about *which*
/// respondent, and the joint distribution that would let a reader link two answers to
/// one person is never exposed. Suppressing it would delete the single dissenting
/// voice, which is the exact signal an honest climate survey exists to surface. That
/// is the difference from #87, where a bucket *was* a set of people counted by a
/// demographic attribute they carry.
///
/// **Withheld counts are always reported**, never silently dropped, so a reader can
/// tell "nobody else answered" from "a group was withheld" and so totals still
/// reconcile against the participation counters.
/// </summary>
public static class SurveyResultsPrivacy
{
    /// <summary>Complete responses a survey needs before any per-question result is computed.</summary>
    public const int MinimumRespondents = 5;

    /// <summary>
    /// Complete responses a single department or demographic segment needs before it is
    /// rendered.
    ///
    /// **Referenced, not restated.** The paragraph above argues this must be the same
    /// floor #87 applies to demographic snapshots, because these are the same
    /// quasi-identifiers over the same workforce and two surfaces with different floors
    /// can be differenced against each other. A copy of the literal <c>5</c> would honour
    /// that argument today and silently break it the first time either number is tuned,
    /// which is precisely the failure the argument describes. <c>SurveyResponsePrivacy</c>
    /// (#118) binds to the same constant for the same reason.
    /// </summary>
    public const int MinimumSegmentRespondents = DemographicSnapshotPrivacy.MinimumGroupSize;

    /// <summary>Distinct responses a word must appear in before it reaches a word cloud.</summary>
    public const int MinimumWordRespondents = 2;

    /// <summary>Machine-readable reason codes. Not display copy -- the client renders these through its own i18n keys.</summary>
    public const string BelowMinimumRespondents = "below_minimum_respondents";

    /// <inheritdoc cref="BelowMinimumRespondents"/>
    public const string BelowMinimumSegmentRespondents = "below_minimum_segment_respondents";

    public static bool MeetsSurveyFloor(int completedResponseCount) => completedResponseCount >= MinimumRespondents;

    public static bool MeetsSegmentFloor(int respondentCount) => respondentCount >= MinimumSegmentRespondents;

    public static bool MeetsWordFloor(int respondentCount) => respondentCount >= MinimumWordRespondents;
}
