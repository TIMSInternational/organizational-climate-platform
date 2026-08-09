namespace ClimateProject.Application.Search;

/// <summary>
/// The entity kinds global search can return, as a validated string set rather than a C#
/// enum -- matching <c>Roles</c>, <c>SurveyStatuses</c> and <c>ContentLanguages</c>.
///
/// The set was chosen by asking a single question of every candidate: is there already an
/// authenticated read path for it? Search must never be the first surface that exposes a
/// row, because then its permission rule has no existing rule to mirror and is invented
/// here -- which is exactly how a search index leaks. Everything below has a listing
/// endpoint whose guard <c>SearchQueries</c> reproduces in-query.
///
/// Deliberately absent: responses and question responses (respondent-level answers, which
/// the privacy rules in SurveyResultsPrivacy keep behind aggregation thresholds), audit
/// logs, notifications and the various templates (global rows a CompanyAdmin can read but
/// which carry no tenant, so they add cross-tenant surface for no navigational value).
/// </summary>
public static class SearchEntityTypes
{
    public const string Survey = "survey";
    public const string Question = "question";
    public const string Department = "department";
    public const string User = "user";
    public const string ActionPlan = "action_plan";
    public const string Report = "report";

    /// <summary>Every kind, in the order results are grouped for the caller.</summary>
    public static readonly string[] All = [Survey, Question, Department, User, ActionPlan, Report];

    public static bool IsValid(string? value) => Array.IndexOf(All, value) >= 0;

    /// <summary>
    /// Parses the comma-separated <c>?types=</c> filter. Returns <see cref="All"/> when the
    /// filter is absent, and null when it names something that is not a searchable kind --
    /// an unknown kind is a caller bug and must be a 400, not a silently narrower search
    /// that looks like "no results".
    /// </summary>
    public static IReadOnlyList<string>? Parse(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return All;
        }

        var requested = new List<string>();
        foreach (var part in raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var normalised = part.ToLowerInvariant();
            if (!IsValid(normalised))
            {
                return null;
            }

            if (!requested.Contains(normalised))
            {
                requested.Add(normalised);
            }
        }

        // Preserve the canonical grouping order rather than the caller's argument order, so
        // two callers asking for the same kinds get the same response shape.
        return requested.Count == 0 ? All : All.Where(requested.Contains).ToArray();
    }
}
