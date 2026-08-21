namespace ClimateProject.Application.Microclimates;

/// <summary>
/// The microclimate status vocabulary and the legal transitions between its members.
///
/// <para>
/// The counterpart of <c>SurveyStatuses</c>, and deliberately the same shape: a validated
/// string set rather than a C# enum, kept in Application rather than Api so the transition
/// matrix is unit-testable without Docker. The column is <c>character varying</c> with a
/// <c>draft</c> default and no CHECK constraint (see <c>20260731121922_AddMicroclimates</c>),
/// so the database will happily store any string -- this class is the only thing standing
/// between the product and a microclimate in a state nothing knows how to render.
/// </para>
///
/// <para>
/// <b>What this replaced.</b> Before #131 the status vocabulary lived in
/// <c>MicroclimateValidation.ValidStatuses</c> as a bare three-element array, and
/// <c>PUT /microclimates/{id}</c> accepted <em>any</em> member of it from <em>any</em>
/// current status. A closed microclimate could be reopened, and an active one whose
/// responses were already counted could be sent back to <c>draft</c> where its questions
/// become editable again -- the precise failure <c>SurveyStatuses</c> was written to stop,
/// on a surface where it was never applied. The vocabulary array is retained and now
/// derives from <see cref="All"/> so the two cannot drift.
/// </para>
/// </summary>
public static class MicroclimateStatuses
{
    /// <summary>
    /// Being authored, and not yet visible to any respondent.
    /// </summary>
    /// <remarks>
    /// Note this class does NOT currently gate content edits on being in this status --
    /// <c>PUT /microclimates/{id}</c> still accepts a title or description change against an
    /// active session. That is a real gap, deliberately left rather than quietly widened into
    /// by #131, whose remit was the transition map; there is no <c>AllowsContentEdit</c> here
    /// precisely so that no caller can believe a freeze is being enforced when it is not.
    /// <c>SurveyStatuses.AllowsContentEdit</c> is the shape the fix should take.
    /// </remarks>
    public const string Draft = "draft";

    /// <summary>Open. Responses are arriving.</summary>
    public const string Active = "active";

    /// <summary>No longer accepting responses. Results are final. Terminal.</summary>
    public const string Closed = "closed";

    public static readonly string[] All = [Draft, Active, Closed];

    /// <summary>
    /// The legal transitions, as an adjacency map. Explicit rather than derived from an
    /// ordering, because the interesting rules are the <em>absences</em>:
    ///
    /// <list type="bullet">
    /// <item><c>active -&gt; draft</c> is absent. A microclimate's answers are counted into
    /// <c>ResponseCount</c> and <c>LiveResults.WordCloudData</c> as they arrive and there is
    /// no per-response row to recount from, so content that becomes editable again cannot be
    /// reconciled against the aggregate it already contributed to. Once responses can exist,
    /// content is frozen forever.</item>
    /// <item><c>closed -&gt; active</c> is absent. Reopening means responses arriving after
    /// the session's results were read and exported. A microclimate is a point-in-time pulse;
    /// running it again means creating another one.</item>
    /// <item><c>draft -&gt; closed</c> IS present. It is how an abandoned draft is filed
    /// away without ever being put in front of anyone -- the role <c>archived</c> plays for a
    /// survey, which this vocabulary does not have. Note <see cref="IsPublish"/> excludes it,
    /// so abandoning a half-translated draft is not blocked by the translation gate.</item>
    /// <item><c>closed</c> has no outgoing edges. Terminal.</item>
    /// </list>
    /// </summary>
    private static readonly Dictionary<string, string[]> Transitions = new(StringComparer.Ordinal)
    {
        [Draft] = [Active, Closed],
        [Active] = [Closed],
        [Closed] = [],
    };

    public static bool IsValid(string? status) => status is not null && All.Contains(status, StringComparer.Ordinal);

    /// <summary>The statuses reachable from <paramref name="status"/>, excluding itself.</summary>
    public static IReadOnlyList<string> AllowedTransitionsFrom(string? status)
        => status is not null && Transitions.TryGetValue(status, out var next) ? next : [];

    /// <summary>
    /// True when a microclimate may move from <paramref name="from"/> to <paramref name="to"/>.
    /// A no-op transition (<paramref name="from"/> == <paramref name="to"/>) is legal so that
    /// a retried request is idempotent rather than a spurious 409.
    /// </summary>
    public static bool CanTransition(string? from, string? to)
    {
        if (!IsValid(from) || !IsValid(to))
        {
            return false;
        }

        return string.Equals(from, to, StringComparison.Ordinal)
               || AllowedTransitionsFrom(from).Contains(to, StringComparer.Ordinal);
    }

    /// <summary>
    /// True when this transition makes the microclimate's content visible to respondents for
    /// the first time. This is what gates the #195 translation check.
    ///
    /// <para>
    /// A deliberate narrowing of <c>ContentPublishValidation.IsPublishTransition</c>, which is
    /// "left draft for anything". That predicate is what
    /// <c>MicroclimateEndpoints.UpdateAsync</c> used before #131, and it made
    /// <c>draft -&gt; closed</c> -- throwing an abandoned draft away -- demand a complete set
    /// of translations. A gate that blocks cleanup protects nobody: there is no respondent to
    /// protect on that edge. So both halves are required here: leaving <see cref="Draft"/>,
    /// AND landing on <see cref="Active"/>, the only respondent-visible status this
    /// vocabulary has.
    /// </para>
    /// </summary>
    public static bool IsPublish(string? from, string? to)
        => string.Equals(from, Draft, StringComparison.Ordinal)
           && string.Equals(to, Active, StringComparison.Ordinal);

    /// <summary>Whether responses may be submitted. Only an active microclimate collects.</summary>
    public static bool AcceptsResponses(string? status)
        => string.Equals(status, Active, StringComparison.Ordinal);
}
