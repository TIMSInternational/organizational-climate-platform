using ClimateProject.Application.Surveys;

namespace ClimateProject.Application.Benchmarks;

/// <summary>
/// One company read against a computed reference group (ruled 3 Nov 2026,
/// <c>docs/decisions/benchmark-groups-are-computed.md</c>).
/// </summary>
/// <remarks>
/// <para>
/// **Computes nothing the results screen does not.** Every input is a
/// <see cref="SurveyAggregate"/> from <c>SurveyAggregateLoader</c>, the aggregation behind
/// results, trends and reports. This class only puts those numbers on one 0–100 scale and
/// takes medians across companies. It is pure so its arithmetic is pinned by unit tests.
/// </para>
/// <para>
/// **Each question on its own scale.** A question's mean becomes an index through that
/// question's <c>ScaleMin</c> and <c>ScaleMax</c>, never an assumed 1–5: a company asking on
/// 1–4 and one asking on 1–5 can only be compared once each is read on its own range.
/// </para>
/// <para>
/// **The floors.** A group publishes nothing below <see cref="MinimumCompanies"/> companies,
/// and a dimension publishes no median below <see cref="MinimumCompanies"/> companies that
/// scored that exact dimension key. A member's survey under the respondent floor is never an
/// input (its aggregate arrives suppressed). With three companies the median IS one real
/// company's index, which is why the routes over this are super admin only.
/// </para>
/// </remarks>
public static class BenchmarkGroupReading
{
    /// <summary>The fewest companies a group or a dimension may publish a median from.</summary>
    public const int MinimumCompanies = 3;

    /// <summary>One dimension's index for one company.</summary>
    public sealed record DimensionIndex(string Key, double Index);

    /// <summary>
    /// One company's latest qualifying survey on the 0–100 index: each dimension in the order
    /// its first question was asked, and the overall index as the mean of the dimensions.
    /// </summary>
    public sealed record CompanyIndices(double Overall, IReadOnlyList<DimensionIndex> Dimensions);

    /// <summary>One dimension of the subject company against the group.</summary>
    /// <param name="Companies">How many group companies scored this exact dimension key.</param>
    public sealed record DimensionReading(string Key, double Score, double? Median, int Companies);

    /// <summary>The subject against the group, or why there is no comparison.</summary>
    public sealed record Reading(
        bool Sufficient,
        int CompanyCount,
        double? CompanyIndex,
        double? GroupMedian,
        IReadOnlyList<DimensionReading> Dimensions);

    /// <summary>
    /// A question mean as a 0–100 index on the question's own range, or null when the question
    /// carries no usable range (not a scale question, or a range that is empty or inverted).
    /// </summary>
    public static double? ToIndex(double? average, int? scaleMin, int? scaleMax)
    {
        if (average is not { } mean || !double.IsFinite(mean)) return null;
        if (scaleMin is not { } min || scaleMax is not { } max || max <= min) return null;
        var clamped = Math.Clamp(mean, min, max);
        return (clamped - min) / (max - min) * 100.0;
    }

    /// <summary>
    /// A survey's indices, or null when the survey cannot be an input: suppressed under the
    /// respondent floor, or with no categorised scale question anybody answered.
    /// </summary>
    /// <remarks>
    /// A dimension's index pools its questions weighted by how many people answered each, which
    /// is how <see cref="SurveyDimensionResult.AverageScore"/> pools them on the results screen,
    /// so on a single-scale survey the two agree exactly.
    /// </remarks>
    public static CompanyIndices? Indices(SurveyAggregate aggregate)
    {
        if (aggregate.IsSuppressed) return null;

        var order = new List<string>();
        var sums = new Dictionary<string, (double Weighted, int Answered)>(StringComparer.Ordinal);
        foreach (var question in aggregate.Questions)
        {
            var key = question.Category?.Trim();
            if (string.IsNullOrEmpty(key) || question.AnsweredCount <= 0) continue;
            if (ToIndex(question.Average, question.ScaleMin, question.ScaleMax) is not { } index) continue;

            if (!sums.TryGetValue(key, out var running))
            {
                order.Add(key);
                running = (0, 0);
            }

            sums[key] = (running.Weighted + (index * question.AnsweredCount), running.Answered + question.AnsweredCount);
        }

        if (order.Count == 0) return null;
        var dimensions = order.Select(key => new DimensionIndex(key, sums[key].Weighted / sums[key].Answered)).ToList();
        return new CompanyIndices(dimensions.Average(d => d.Index), dimensions);
    }

    /// <summary>
    /// The subject against the group's members. The subject is never one of the members: a
    /// company compared with a group that contains it is partly compared with itself.
    /// </summary>
    public static Reading Read(CompanyIndices subject, IReadOnlyList<CompanyIndices> members)
    {
        if (members.Count < MinimumCompanies)
        {
            // No number at all, not even the subject's own: the screen says why there is no
            // comparison, and a lone index beside it would read as the comparison.
            return new Reading(false, members.Count, null, null, []);
        }

        var dimensions = subject.Dimensions
            .Select(dimension =>
            {
                var scored = members
                    .Select(member => member.Dimensions.FirstOrDefault(d => string.Equals(d.Key, dimension.Key, StringComparison.Ordinal)))
                    .OfType<DimensionIndex>()
                    .Select(d => d.Index)
                    .ToList();
                return new DimensionReading(
                    dimension.Key,
                    dimension.Index,
                    scored.Count >= MinimumCompanies ? Median(scored) : null,
                    scored.Count);
            })
            .ToList();

        return new Reading(true, members.Count, subject.Overall, Median([.. members.Select(m => m.Overall)]), dimensions);
    }

    /// <summary>The middle value, or the mean of the two middle values.</summary>
    public static double Median(IReadOnlyList<double> values)
    {
        if (values.Count == 0) throw new ArgumentException("A median needs at least one value.", nameof(values));
        var sorted = values.OrderBy(v => v).ToList();
        var middle = sorted.Count / 2;
        return sorted.Count % 2 == 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2.0;
    }

    /// <summary>
    /// Whether a company meets a group's criteria. A null criterion matches anything; a set one
    /// matches the company's value trimmed and case-insensitively, and never a company that has
    /// no value recorded -- "sector Energía" must not quietly include companies nobody classified.
    /// </summary>
    public static bool Matches(string? criterion, string? companyValue)
    {
        if (string.IsNullOrWhiteSpace(criterion)) return true;
        return !string.IsNullOrWhiteSpace(companyValue)
               && string.Equals(criterion.Trim(), companyValue.Trim(), StringComparison.OrdinalIgnoreCase);
    }
}
