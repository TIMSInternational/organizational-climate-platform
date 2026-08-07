using ClimateProject.Application.Analytics;

namespace ClimateProject.Application.Surveys;

/// <summary>
/// One demographic attribute a response could carry, and how many people in the
/// survey's audience share that exact value.
/// </summary>
/// <param name="CohortSize">
/// The size of the group this value puts the respondent in, measured over the survey's
/// company at submission time. It is the only thing that decides whether the attribute
/// may be attached to an anonymous response.
/// </param>
public sealed record DemographicCandidate(string Field, string Value, int CohortSize);

/// <param name="Kept">Attributes safe to attach, as (field, value) pairs.</param>
/// <param name="SuppressedFields">
/// Fields withheld because the respondent's value put them in too small a group.
/// Reported rather than silently dropped, exactly as
/// <see cref="DemographicSnapshotPrivacy"/> reports its suppressed buckets: a reader
/// has to be able to tell "this respondent answered nothing" from "we refused to
/// record it".
/// </param>
public sealed record DemographicCapture(
    IReadOnlyList<DemographicCandidate> Kept,
    IReadOnlyList<string> SuppressedFields);

/// <summary>
/// What an anonymous survey response may carry, decided at WRITE time.
///
/// <c>Survey.Settings.Anonymous</c> is a promise made to a respondent before they
/// answer, and <c>Response.IsAnonymous</c> is that promise recorded. Neither is worth
/// anything unless the row itself is unattributable, because the row is what flows
/// onward into exports, benchmark feeds and the ETL -- all of which are read by people
/// who never saw the flag.
///
/// **Four identifiers, and why each is refused.**
/// <list type="bullet">
/// <item><c>user_id</c> -- the direct link. Never written.</item>
/// <item><c>ip_address</c> and <c>user_agent</c> -- a near-direct link. An office IP
/// plus a browser fingerprint identifies a small team, and neither is needed: the
/// public path is defended by a per-IP rate limiter that partitions on the address
/// without persisting it, and duplicate submission is caught by the session key. Never
/// written for an anonymous response. They ARE written for an identified one, where
/// <c>user_id</c> is already there and abuse forensics is the only remaining use.</item>
/// <item>demographics and <c>department_id</c> -- the indirect link, and the one that
/// actually leaks. "Engineering + 10+ years tenure + Director" is one person in most
/// companies, and unlike the three above nothing about it looks like an identifier.
/// So each attribute is kept only when the respondent's own value puts them in a group
/// of at least <see cref="MinimumCohortSize"/> people.</item>
/// </list>
///
/// **Why write time and not read time.** Read-time suppression is what
/// <see cref="DemographicSnapshotPrivacy"/> does, and it is right for aggregates
/// computed on demand. It cannot protect this: a response row is exported, replicated
/// and fed to the ETL, and every one of those consumers would have to reimplement the
/// same threshold correctly forever. What is never written cannot leak.
///
/// **Why the cohort is measured over the company rather than over the responses so
/// far.** The response population is one respondent at the moment the first response
/// arrives, so every early respondent would be suppressed and every late one kept --
/// suppression that depends on arrival order is not a privacy property, it is a race.
/// Company headcount per value is stable, knowable at submission, and is the population
/// an attacker would actually cross-reference against.
/// </summary>
public static class SurveyResponsePrivacy
{
    /// <summary>
    /// Deliberately the same number as <see cref="DemographicSnapshotPrivacy.MinimumGroupSize"/>,
    /// and referenced rather than restated. These are the same quasi-identifiers
    /// protecting against the same cross-reference; two constants that happen to agree
    /// today are two constants that will disagree after the first tuning.
    /// </summary>
    public const int MinimumCohortSize = DemographicSnapshotPrivacy.MinimumGroupSize;

    /// <summary>
    /// True when a group of <paramref name="cohortSize"/> people is large enough to hide
    /// one respondent in. A non-positive size means the cohort could not be measured,
    /// which is treated as too small rather than as unknown.
    /// </summary>
    public static bool CohortIsLargeEnough(int cohortSize) => cohortSize >= MinimumCohortSize;

    /// <summary>
    /// The department that may be recorded on a response.
    ///
    /// An identified response records it unconditionally: <c>user_id</c> is already
    /// there, so the department adds no attributable information. An anonymous one
    /// records it only when the department is big enough to hide in -- a response
    /// tagged to a two-person team is a named response with extra steps.
    /// </summary>
    public static Guid? DepartmentFor(bool isAnonymous, Guid? departmentId, int departmentHeadcount)
    {
        if (departmentId is null)
        {
            return null;
        }

        return !isAnonymous || CohortIsLargeEnough(departmentHeadcount) ? departmentId : null;
    }

    /// <summary>
    /// Filters the respondent's demographics down to what may be attached.
    ///
    /// An identified response keeps everything -- an admin can already read the same
    /// values off the respondent's own user row, so suppressing them here would be
    /// theatre while breaking segmentation, which is the same reasoning
    /// <see cref="DemographicSnapshotPrivacy"/> applies to snapshot entries.
    /// </summary>
    public static DemographicCapture Filter(bool isAnonymous, IReadOnlyList<DemographicCandidate> candidates)
    {
        ArgumentNullException.ThrowIfNull(candidates);

        // Ordered so a suppression list is deterministic between runs rather than
        // dependent on the order rows came back from the database.
        var ordered = candidates
            .Where(candidate => !string.IsNullOrWhiteSpace(candidate.Field) && !string.IsNullOrWhiteSpace(candidate.Value))
            .OrderBy(candidate => candidate.Field, StringComparer.Ordinal)
            .ToList();

        if (!isAnonymous)
        {
            return new DemographicCapture(ordered, []);
        }

        var kept = new List<DemographicCandidate>(ordered.Count);
        var suppressed = new List<string>();
        foreach (var candidate in ordered)
        {
            if (CohortIsLargeEnough(candidate.CohortSize))
            {
                kept.Add(candidate);
            }
            else
            {
                suppressed.Add(candidate.Field);
            }
        }

        return new DemographicCapture(kept, suppressed);
    }
}
