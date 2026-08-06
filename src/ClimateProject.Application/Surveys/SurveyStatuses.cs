namespace ClimateProject.Application.Surveys;

/// <summary>
/// The survey status vocabulary and the legal transitions between its members.
///
/// A validated string set rather than a C# enum, matching <c>Roles</c>,
/// <c>ContentLanguages</c>, <c>QuestionTypes</c> and <c>MicroclimateValidation</c>.
/// The column is <c>character varying(20)</c> with a <c>draft</c> default and no CHECK
/// constraint (see <c>20260731103349_AddSurveysCore</c>), so the database will happily
/// store any string -- this class is the only thing standing between the product and a
/// survey in a state nothing knows how to render.
///
/// Kept in Application rather than Api so the transition matrix is unit-testable
/// without Docker, the same reason <c>CompanyScope</c> and
/// <c>ContentPublishValidation</c> live here.
/// </summary>
public static class SurveyStatuses
{
    /// <summary>Being authored. The only state in which content is editable.</summary>
    public const string Draft = "draft";

    /// <summary>Finalised and queued to open, but not yet accepting responses.</summary>
    public const string Scheduled = "scheduled";

    /// <summary>Open. Responses are arriving.</summary>
    public const string Active = "active";

    /// <summary>No longer accepting responses. Results are final and analysable.</summary>
    public const string Closed = "closed";

    /// <summary>Filed away. Terminal.</summary>
    public const string Archived = "archived";

    public static readonly string[] All = [Draft, Scheduled, Active, Closed, Archived];

    /// <summary>
    /// Statuses in which a survey's content is exposed to respondents -- either already
    /// (<see cref="Active"/>) or irrevocably committed to be (<see cref="Scheduled"/>,
    /// where invitations go out carrying the survey's title). Entering one of these is
    /// what "publishing" means for a survey, and it is the point the content-i18n gate
    /// guards.
    /// </summary>
    public static readonly string[] RespondentVisible = [Scheduled, Active];

    /// <summary>
    /// The legal transitions, as an adjacency map. Deliberately explicit rather than
    /// derived from an ordering, because the interesting rules are the *absences*:
    ///
    /// <list type="bullet">
    /// <item><c>active -&gt; draft</c> is absent. Editing a survey that already has
    /// responses is exactly how a survey silently corrupts its own results: answers are
    /// stored against question ids and option values, so removing a question or
    /// renumbering an option orphans or re-labels answers already given. Once responses
    /// can exist, content is frozen forever.</item>
    /// <item><c>closed -&gt; active</c> is absent. Reopening a closed survey means
    /// responses arriving after its results were analysed, exported and benchmarked. The
    /// supported way to run it again is <c>POST /surveys/{id}/duplicate</c>, which yields
    /// a fresh draft whose option values still aggregate with the original.</item>
    /// <item><c>scheduled -&gt; draft</c> IS present, and is the only way back. A
    /// scheduled survey has no responses yet, so returning it to draft to fix a typo is
    /// safe -- and having one sanctioned route back is what makes freezing everything
    /// else defensible rather than merely strict.</item>
    /// <item><c>archived</c> has no outgoing edges. Terminal.</item>
    /// </list>
    /// </summary>
    private static readonly Dictionary<string, string[]> Transitions = new(StringComparer.Ordinal)
    {
        [Draft] = [Scheduled, Active, Archived],
        [Scheduled] = [Draft, Active, Closed, Archived],
        [Active] = [Closed],
        [Closed] = [Archived],
        [Archived] = [],
    };

    public static bool IsValid(string? status) => status is not null && All.Contains(status, StringComparer.Ordinal);

    /// <summary>The statuses reachable from <paramref name="status"/>, excluding itself.</summary>
    public static IReadOnlyList<string> AllowedTransitionsFrom(string? status)
        => status is not null && Transitions.TryGetValue(status, out var next) ? next : [];

    /// <summary>
    /// True when a survey may move from <paramref name="from"/> to <paramref name="to"/>.
    /// A no-op transition (<paramref name="from"/> == <paramref name="to"/>) is legal so
    /// that a retried request is idempotent rather than a spurious 400.
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
    /// True when this transition makes the survey's content visible to respondents for
    /// the first time. This is what gates the #195 translation check.
    ///
    /// A deliberate narrowing of <c>ContentPublishValidation.IsPublishTransition</c>,
    /// which is "left draft for anything" -- correct for a microclimate, whose vocabulary
    /// is draft/active/closed, but not for a survey. A survey can go
    /// <c>draft -&gt; archived</c> to file away an abandoned draft, and demanding a
    /// complete set of translations in order to *throw something away* would be a gate
    /// that blocks cleanup rather than protecting respondents. So both halves are
    /// required: leaving <see cref="Draft"/>, AND landing somewhere
    /// <see cref="RespondentVisible"/>.
    ///
    /// Keying the first half on <see cref="Draft"/> rather than on "not currently
    /// respondent-visible" is what makes this a strict subset of the shared predicate for
    /// every possible pair, not merely for the pairs
    /// <see cref="CanTransition(string?, string?)"/> happens to allow today -- so a later
    /// edge added to the map cannot silently make the two disagree.
    /// <c>scheduled -&gt; active</c> is correctly excluded: the gate already ran on the
    /// way into <c>scheduled</c>, and content has been frozen ever since.
    /// </summary>
    public static bool IsPublish(string? from, string? to)
        => string.Equals(from, Draft, StringComparison.Ordinal)
           && RespondentVisible.Contains(to, StringComparer.Ordinal);

    /// <summary>
    /// True when the survey's *content* -- title, description, language, type, questions,
    /// options, department targeting -- may still be rewritten. Draft only.
    ///
    /// Note this is the structural half of the rule; the endpoint additionally refuses a
    /// content edit whenever any response exists, so a row that somehow reached draft with
    /// responses attached is still protected. See <c>SurveyEndpoints.UpdateAsync</c>.
    /// </summary>
    public static bool AllowsContentEdit(string? status)
        => string.Equals(status, Draft, StringComparison.Ordinal);

    /// <summary>
    /// True when the survey's operational settings -- the response window and the
    /// invitation/reminder settings -- may still be adjusted. Extending a running
    /// survey's <c>EndDate</c> or turning off reminders changes nothing about what a
    /// respondent was asked, so it stays available while the survey is live and stops
    /// once it is closed.
    /// </summary>
    public static bool AllowsScheduleEdit(string? status)
        => string.Equals(status, Draft, StringComparison.Ordinal)
           || string.Equals(status, Scheduled, StringComparison.Ordinal)
           || string.Equals(status, Active, StringComparison.Ordinal);

    /// <summary>Whether responses may be submitted. Only an active survey collects.</summary>
    public static bool AcceptsResponses(string? status)
        => string.Equals(status, Active, StringComparison.Ordinal);
}
