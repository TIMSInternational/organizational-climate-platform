using System.Globalization;

namespace ClimateProject.Application.Surveys;

/// <summary>One demographic (or department) value a results query is narrowed to.</summary>
/// <param name="Field">
/// A demographic field key as stored on <c>response_demographics.field</c>, or
/// <see cref="DepartmentField"/> for the response's department.
/// </param>
/// <param name="Value">
/// The stored value. For <see cref="DepartmentField"/> this is the department's GUID; for a
/// demographic it is the decoded value, which is what <c>SurveyAggregation</c> groups on.
/// </param>
public sealed record SurveySegmentSelector(string Field, string Value)
{
    /// <summary>The pseudo-field naming <c>responses.department_id</c>.</summary>
    public const string DepartmentField = "department";

    public bool IsDepartment => string.Equals(Field, DepartmentField, StringComparison.Ordinal);
}

/// <summary>
/// Narrows a survey's results to the respondents matching every selector — the cross the
/// client asked for ("cómo está el demográfico de gerentes con el departamento de finanzas").
///
/// ## It is a filter, not a second aggregation
///
/// The filter is applied to the response list inside <see cref="SurveyAggregation.Compute"/>,
/// immediately after demographics are decoded and before anything else reads them. Everything
/// downstream — the survey floor, the segment floor, complement withholding, the
/// never-return-verbatim-text rule — then applies to the narrowed cohort without knowing a
/// filter exists. That is the whole design: a cross-tab gets the privacy controls the product
/// already has, rather than a second set written beside them that drifts.
///
/// It also means a cross whose cohort is under <see cref="SurveyResultsPrivacy.MinimumRespondents"/>
/// comes back suppressed by the existing whole-survey rule, with the counters still populated.
/// "Los gerentes del departamento de finanzas" is one person at most organisations, so that is
/// the answer that cross will usually give, and it is the correct one.
///
/// ## Why disclosure needs more than the cohort's own size
///
/// A floor on the selected cohort alone is not enough, and the hole is the one
/// <c>SurveyAggregation.WithholdComplement</c> already closes for a one-dimensional breakdown.
/// Suppose a field has values A=10, B=7, C=3 over 20 people. Ask for A and it is disclosed; ask
/// for B and it is disclosed; C is refused for being under the floor — and then
/// <c>whole − A − B</c> is C's cohort, means and all. The suppression is defeated without
/// anyone breaking it.
///
/// So <see cref="MayDisclose"/> runs the same withholding the breakdown does, per selector,
/// against the scope the OTHER selectors define: a value is disclosable only once enough of its
/// siblings are disclosed that the undisclosed remainder is itself at or above the floor. A
/// filtered query is answered only when every one of its selectors survives that test.
/// Deliberately conservative — it refuses some cohorts that are individually large enough,
/// because the alternative is a number that can be subtracted back out.
/// </summary>
public sealed class SurveyResultsFilter
{
    /// <summary>
    /// The most selectors one query may carry.
    ///
    /// Each one narrows the cohort and widens the differencing surface, and three already
    /// reaches "this department, this seniority, this gender", which at any real headcount is
    /// below the floor. A cap keeps the per-selector disclosure test bounded and says plainly
    /// that this is a reporting tool and not a query language over individuals.
    /// </summary>
    public const int MaxSelectors = 3;

    public static readonly SurveyResultsFilter None = new([]);

    private SurveyResultsFilter(IReadOnlyList<SurveySegmentSelector> selectors) => Selectors = selectors;

    public IReadOnlyList<SurveySegmentSelector> Selectors { get; }

    public bool IsEmpty => Selectors.Count == 0;

    /// <summary>
    /// Parses <c>field:value</c> pairs, reporting every problem rather than the first.
    ///
    /// Split on the FIRST colon only: a demographic field key is a slug and never contains one,
    /// while a value may well ("Gerencia: Finanzas").
    /// </summary>
    public static bool TryParse(IEnumerable<string>? raw, out SurveyResultsFilter filter, out string? error)
    {
        filter = None;
        error = null;
        var cleaned = (raw ?? []).Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s.Trim()).ToList();
        if (cleaned.Count == 0)
        {
            return true;
        }

        if (cleaned.Count > MaxSelectors)
        {
            error = $"At most {MaxSelectors} segment selectors may be combined; {cleaned.Count} were supplied.";
            return false;
        }

        var selectors = new List<SurveySegmentSelector>(cleaned.Count);
        var seenFields = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entry in cleaned)
        {
            var separator = entry.IndexOf(':', StringComparison.Ordinal);
            if (separator <= 0 || separator == entry.Length - 1)
            {
                error = $"Segment selector '{entry}' must read 'field:value'.";
                return false;
            }

            var field = entry[..separator].Trim();
            var value = entry[(separator + 1)..].Trim();
            if (field.Length == 0 || value.Length == 0)
            {
                error = $"Segment selector '{entry}' must read 'field:value'.";
                return false;
            }

            // One value per field. "department:A and department:B" is an OR, and an OR over a
            // quasi-identifier is a way to assemble a cohort out of parts that were each
            // refused -- the opposite of what the disclosure test below is for.
            if (!seenFields.Add(field))
            {
                error = $"Field '{field}' appears more than once; a results query takes one value per field.";
                return false;
            }

            if (string.Equals(field, SurveySegmentSelector.DepartmentField, StringComparison.Ordinal)
                && !Guid.TryParse(value, CultureInfo.InvariantCulture, out _))
            {
                error = $"Segment selector '{entry}' must name a department by its id.";
                return false;
            }

            selectors.Add(new SurveySegmentSelector(field, value));
        }

        filter = new SurveyResultsFilter(selectors);
        return true;
    }

    /// <summary>Builds a filter directly. Used by callers that already hold validated selectors.</summary>
    public static SurveyResultsFilter For(params SurveySegmentSelector[] selectors)
        => selectors.Length == 0 ? None : new SurveyResultsFilter(selectors);

    /// <summary>True when the response carries every selected value.</summary>
    public bool Matches(AggregationResponse response) => Matches(response, skipIndex: -1);

    private bool Matches(AggregationResponse response, int skipIndex)
    {
        for (var i = 0; i < Selectors.Count; i++)
        {
            if (i == skipIndex)
            {
                continue;
            }

            if (!MatchesOne(response, Selectors[i]))
            {
                return false;
            }
        }

        return true;
    }

    private static bool MatchesOne(AggregationResponse response, SurveySegmentSelector selector)
    {
        if (selector.IsDepartment)
        {
            return response.DepartmentId is { } department
                && Guid.TryParse(selector.Value, CultureInfo.InvariantCulture, out var wanted)
                && department == wanted;
        }

        return response.Demographics.TryGetValue(selector.Field, out var value)
            && string.Equals(value, selector.Value, StringComparison.Ordinal);
    }

    /// <summary>
    /// The value a response carries for the selector's field, or null when it carries none.
    /// A response with no value sits outside every sibling cohort and is counted only in the
    /// scope total, exactly as <c>UnsegmentedRespondentCount</c> does in a breakdown.
    /// </summary>
    private static string? ValueOf(AggregationResponse response, SurveySegmentSelector selector)
    {
        if (selector.IsDepartment)
        {
            return response.DepartmentId?.ToString();
        }

        return response.Demographics.TryGetValue(selector.Field, out var value) ? value : null;
    }

    /// <summary>
    /// Whether this filter's cohort may be disclosed at all, by the sibling rule in the class
    /// remarks. An empty filter is always disclosable: it is the whole survey, which the survey
    /// floor governs.
    /// </summary>
    /// <param name="completed">Every COMPLETE response on the survey, demographics already decoded.</param>
    /// <param name="floor">Normally <see cref="SurveyResultsPrivacy.MinimumSegmentRespondents"/>.</param>
    public bool MayDisclose(IReadOnlyList<AggregationResponse> completed, int floor)
    {
        ArgumentNullException.ThrowIfNull(completed);
        if (IsEmpty)
        {
            return true;
        }

        for (var i = 0; i < Selectors.Count; i++)
        {
            var selector = Selectors[i];
            var scope = completed.Where(r => Matches(r, skipIndex: i)).ToList();

            // Sibling cohorts within that scope, smallest first and then by key --
            // **byte for byte the order `SurveyAggregation.WithholdComplement` withholds in**,
            // and that is not a style choice. The two surfaces withhold from the same sibling
            // set, so if they broke a tie differently the breakdown would hide one of two
            // equal cohorts and this would hide the other, and a reader who opened both would
            // have them both. `SurveyResultsPrivacy` names that failure directly: two rules
            // over the same quasi-identifiers that can be differenced against each other is
            // how suppression gets defeated without anyone breaking it.
            var cohorts = scope
                .Select(r => ValueOf(r, selector))
                .Where(v => v is not null)
                .GroupBy(v => v!, StringComparer.Ordinal)
                .Select(g => (Value: g.Key, Count: g.Count()))
                .OrderBy(c => c.Count)
                .ThenBy(c => c.Value, StringComparer.Ordinal)
                .ToList();

            var disclosed = cohorts.Where(c => c.Count >= floor).ToList();

            // The people the disclosed cohorts do not cover: the other siblings plus anyone
            // carrying no value for this field. A remainder of 1..4 is subtractable, so the
            // smallest disclosed cohort is withheld until it is not.
            var remainder = scope.Count - disclosed.Sum(c => c.Count);
            while (remainder > 0 && remainder < floor && disclosed.Count > 0)
            {
                var smallest = disclosed[0];
                disclosed.RemoveAt(0);
                remainder += smallest.Count;
            }

            if (!disclosed.Any(c => string.Equals(c.Value, selector.Value, StringComparison.Ordinal)))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>A stable, loggable rendering. Used in the response so a reader knows what was asked.</summary>
    public override string ToString() => string.Join(" + ", Selectors.Select(s => $"{s.Field}:{s.Value}"));
}
