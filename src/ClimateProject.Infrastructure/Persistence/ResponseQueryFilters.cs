namespace ClimateProject.Infrastructure.Persistence;

/// <summary>
/// The named query filters on <c>responses</c>.
/// </summary>
/// <remarks>
/// <para><see cref="Counted"/> hides a response TIMS excluded from the results
/// (<c>responses.excluded_at</c>, ruled 2026-11-08, <c>docs/decisions/operators-reopen-exclude-delete.md</c>).
/// It is ON for every query unless one opts out by name, so the results, reports, exports,
/// dashboards and benchmarks drop an excluded response without each having to remember to.</para>
/// <para>Opt out -- <c>db.Responses.IgnoreQueryFilters([ResponseQueryFilters.Counted])</c> -- only
/// where the question is about the PERSON or the ROW rather than the results: the respond flow
/// (an excluded person has still answered and must not be offered the survey again), the
/// roster and "my surveys" (they still finished), every "has this survey been answered" guard
/// (an excluded answer is still stored, so the survey must not become deletable or editable),
/// and GDPR (access and erasure reach every row a person has).</para>
/// </remarks>
public static class ResponseQueryFilters
{
    /// <summary>Responses that count towards results: <c>excluded_at IS NULL</c>.</summary>
    public const string Counted = "counted_responses";

    /// <summary>The argument to <c>IgnoreQueryFilters</c> that sees excluded responses too.</summary>
    public static readonly string[] IncludeExcluded = [Counted];
}
