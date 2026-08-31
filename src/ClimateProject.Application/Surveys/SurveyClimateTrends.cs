namespace ClimateProject.Application.Surveys;

/// <summary>
/// The dimension scores of several surveys, read as one matrix -- climate over time.
///
/// **This computes nothing new.** Every score it returns is a
/// <see cref="SurveyDimensionResult.AverageScore"/> that
/// <see cref="SurveyAggregation.Compute"/> already produced for the whole company, or the
/// same weighted pooling applied to one segment's questions through the shared
/// <see cref="SurveyAggregation.PooledAverage"/>. That is #88's boundary held across a
/// second axis: results, statistics, analytics, report generation and now the trends
/// screen are presentations over one aggregation, so "the climate map says 3.8 and the
/// trend line says 3.6" is impossible rather than merely unlikely.
///
/// **Why the caller passes aggregates in.** This class is pure and takes
/// <see cref="SurveyAggregate"/> values, not a <c>DbContext</c>. Loading is the endpoint's
/// job through <c>SurveyAggregateLoader</c> -- the same loader the results routes and
/// report generation use -- which is what keeps the queries shared too. It also makes the
/// whole of this file testable without a database, which is why its arithmetic is pinned
/// by unit tests rather than only by an integration suite that takes ~14 minutes.
///
/// **What is NOT here: interpolation, extrapolation and "trend".** The matrix reports the
/// surveys that exist, at the dates they closed, and nothing between or beyond them. A
/// missing dimension is a null, not a line drawn from the previous reading to the next;
/// no slope, direction or forecast is computed. Two reasons. Surveys in this product run
/// at irregular intervals and with instruments that change between waves -- #210's
/// content-i18n work and every re-authored question mean two surveys' "Liderazgo" are the
/// same word, not provably the same construct -- so a smoothed line would assert a
/// comparability nobody established. And a forecast rendered beside a suppressed cell
/// reconstructs the withheld reading from its neighbours, which is the one thing the floor
/// exists to prevent.
/// </summary>
public static class SurveyClimateTrends
{
    /// <summary>
    /// The group key used when the caller did not group. Not a department id and not a
    /// demographic value, so it cannot collide with either.
    /// </summary>
    public const string WholeCompanyKey = "__company__";

    /// <summary>The <c>groupBy</c> value that selects the department breakdown.</summary>
    public const string DepartmentGroup = "department";

    /// <summary>One survey and its already-computed aggregate, as the caller loads them.</summary>
    /// <param name="Title">Resolved for the request locale by the caller, exactly as the results routes resolve it.</param>
    public sealed record Input(
        Guid SurveyId,
        string? Title,
        string Status,
        DateTimeOffset EndDate,
        SurveyAggregate Aggregate);

    /// <summary>
    /// Builds the matrix.
    /// </summary>
    /// <param name="companyId">Echoed onto the response; this class does no authorization and the endpoint must have done it.</param>
    /// <param name="groupBy">
    /// <see cref="DepartmentGroup"/>, a demographic field key, or null for the whole
    /// company. An unrecognised value is not an error: it produces zero groups, because a
    /// survey simply has no breakdown under that name. The endpoint decides whether that
    /// deserves a 400.
    /// </param>
    /// <param name="inputs">Any order; sorted here by <see cref="Input.EndDate"/>, oldest first.</param>
    public static ClimateTrendsResponse Build(
        Guid companyId,
        string? groupBy,
        IEnumerable<Input> inputs,
        DateTimeOffset generatedAt)
    {
        // Oldest first. ThenBy on the id so two surveys that closed at the same instant
        // have a stable order rather than one that depends on the query plan -- a matrix
        // whose columns reorder between two loads of the same page reads as data changing.
        var ordered = inputs
            .OrderBy(i => i.EndDate)
            .ThenBy(i => i.SurveyId)
            .ToList();

        var surveys = ordered
            .Select(i => new ClimateTrendSurvey(
                i.SurveyId,
                i.Title,
                i.Status,
                i.EndDate,
                i.Aggregate.Summary.CompletedCount,
                i.Aggregate.IsSuppressed))
            .ToList();

        // The union across every survey in the window, not the intersection.
        //
        // Intersecting would silently delete a dimension the organisation stopped asking
        // about, which is precisely the change a climate-over-time screen exists to show.
        // Ordinal ordering matches DimensionRollup's, so a dimension occupies the same
        // column position here as it does everywhere else.
        var dimensionKeys = ordered
            .SelectMany(i => i.Aggregate.Dimensions.Select(d => d.Dimension))
            .Distinct(StringComparer.Ordinal)
            .OrderBy(d => d, StringComparer.Ordinal)
            .ToList();

        var dimensions = dimensionKeys
            .Select(key => new ClimateTrendDimension(
                key,
                ordered.Count(i => i.Aggregate.Dimensions.Any(d => string.Equals(d.Dimension, key, StringComparison.Ordinal)))))
            .ToList();

        var groups = groupBy is null
            ? [BuildWholeCompany(ordered, dimensionKeys)]
            : BuildGroups(ordered, dimensionKeys, groupBy);

        var suppressedGroupCount = groups.Count(g => g.Points.All(p => p.IsSuppressed));

        return new ClimateTrendsResponse(
            companyId,
            groupBy,
            surveys,
            dimensions,
            groups,
            suppressedGroupCount,
            SurveyResultsPrivacy.MinimumSegmentRespondents,
            generatedAt);
    }

    // ------------------------------------------------------------------
    // Whole company
    // ------------------------------------------------------------------

    private static ClimateTrendGroup BuildWholeCompany(
        IReadOnlyList<Input> ordered,
        IReadOnlyList<string> dimensionKeys)
    {
        var points = ordered.Select(input =>
        {
            // The survey-level floor, not the segment floor: an ungrouped row covers every
            // respondent, so the question is whether the SURVEY may be read at all. Compute
            // has already applied it -- a suppressed aggregate arrives with Dimensions
            // empty -- and this re-states the flag rather than re-deriving the decision.
            if (input.Aggregate.IsSuppressed)
            {
                return Suppressed(input.SurveyId, dimensionKeys);
            }

            var byDimension = input.Aggregate.Dimensions
                .ToDictionary(d => d.Dimension, d => d.AverageScore, StringComparer.Ordinal);

            return new ClimateTrendPoint(
                input.SurveyId,
                input.Aggregate.Summary.CompletedCount,
                IsSuppressed: false,
                dimensionKeys.Select(key => byDimension.TryGetValue(key, out var score) ? score : null).ToList());
        }).ToList();

        return new ClimateTrendGroup(WholeCompanyKey, null, points);
    }

    // ------------------------------------------------------------------
    // Grouped
    // ------------------------------------------------------------------

    private static List<ClimateTrendGroup> BuildGroups(
        IReadOnlyList<Input> ordered,
        IReadOnlyList<string> dimensionKeys,
        string groupBy)
    {
        // Every group that appears in ANY survey in the window, so a department created
        // between two waves still gets a full-length series -- suppressed and scoreless in
        // the surveys it did not exist for. Ragged series would misalign the columns, and a
        // client aligning by index (which is the contract) would print one survey's reading
        // under another survey's heading.
        var keys = new List<string>();
        var labels = new Dictionary<string, string?>(StringComparer.Ordinal);

        foreach (var input in ordered)
        {
            foreach (var segment in SegmentsOf(input, groupBy))
            {
                if (!labels.ContainsKey(segment.Key))
                {
                    keys.Add(segment.Key);
                    labels[segment.Key] = segment.Label;
                }
                else if (labels[segment.Key] is null)
                {
                    // A later survey may carry a name the earlier one did not resolve.
                    // Taking the first non-null rather than the last keeps the label stable
                    // as the window grows.
                    labels[segment.Key] = segment.Label;
                }
            }
        }

        return keys
            .OrderBy(key => labels[key] ?? key, StringComparer.Ordinal)
            .Select(key => new ClimateTrendGroup(
                key,
                labels[key],
                ordered.Select(input => PointFor(input, groupBy, key, dimensionKeys)).ToList()))
            .ToList();
    }

    private static IReadOnlyList<SurveySegmentResult> SegmentsOf(Input input, string groupBy)
    {
        var breakdown = input.Aggregate.Breakdowns
            .FirstOrDefault(b => string.Equals(b.Dimension, groupBy, StringComparison.Ordinal));

        return breakdown?.Segments ?? [];
    }

    private static ClimateTrendPoint PointFor(
        Input input,
        string groupBy,
        string key,
        IReadOnlyList<string> dimensionKeys)
    {
        var segment = SegmentsOf(input, groupBy)
            .FirstOrDefault(s => string.Equals(s.Key, key, StringComparison.Ordinal));

        // Three distinct situations collapse to one suppressed point, deliberately: the
        // survey was below its own floor; the group was below the segment floor; or the
        // group did not answer this survey at all. Reporting them apart would tell a reader
        // which of "too small" and "absent" applies to a named department in a named
        // window, and differencing those across surveys recovers roughly how small.
        if (input.Aggregate.IsSuppressed || segment is null || segment.IsSuppressed)
        {
            return Suppressed(input.SurveyId, dimensionKeys);
        }

        // Category comes from the survey's own question rows -- the segment carries answered
        // counts and averages per question id, not categories -- so this joins the two the
        // same way DimensionRollup joins nothing at all: by reading Category off the
        // question result that already resolved it.
        var categoryByQuestion = input.Aggregate.Questions
            .Where(q => !string.IsNullOrWhiteSpace(q.Category))
            .ToDictionary(q => q.QuestionId, q => q.Category!);

        var pooled = segment.Questions
            .Where(q => categoryByQuestion.ContainsKey(q.QuestionId))
            .GroupBy(q => categoryByQuestion[q.QuestionId], StringComparer.Ordinal)
            .ToDictionary(
                g => g.Key,
                g => SurveyAggregation.PooledAverage(g.Select(q => (q.AnsweredCount, q.Average))),
                StringComparer.Ordinal);

        return new ClimateTrendPoint(
            input.SurveyId,
            segment.RespondentCount,
            IsSuppressed: false,
            dimensionKeys.Select(k => pooled.TryGetValue(k, out var score) ? score : null).ToList());
    }

    /// <summary>
    /// A withheld row: every score null, and the respondent count zeroed rather than
    /// reported. The count is what the floor protects -- see
    /// <c>ProtectedCell</c>'s note on why a suppressed cell never publishes its own size --
    /// so it must not travel to a client that is about to render the row as hatched.
    /// </summary>
    private static ClimateTrendPoint Suppressed(Guid surveyId, IReadOnlyList<string> dimensionKeys)
        => new(surveyId, 0, IsSuppressed: true, dimensionKeys.Select(_ => (double?)null).ToList());
}
