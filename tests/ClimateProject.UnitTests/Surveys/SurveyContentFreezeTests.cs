using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Surveys;

/// <summary>
/// The property #106 exists to protect: <b>once a survey has responses, its content must
/// not change underneath them.</b> A stored answer is a value against a question id and an
/// option value; if the wording behind either can be rewritten afterwards, the answer stops
/// meaning what it meant when it was given, silently and with row counts that still
/// reconcile.
///
/// Versioning expresses that property rather than merely recording it. A snapshot is taken
/// at publish -- the moment content becomes respondent-visible and stops being editable --
/// and the tests below prove that no path exists from a status that collects responses back
/// to one that permits an edit. That closure is what makes <c>surveys.version</c> a sound
/// answer to "which wording did this response see": there can only ever be one.
///
/// These are reachability proofs over the whole transition map, not a list of the pairs
/// that happen to be illegal today. A later lane adding <c>active -&gt; draft</c> because it
/// looked convenient fails these tests, which is the entire point of writing them this way.
/// </summary>
public class SurveyContentFreezeTests
{
    /// <summary>Every status reachable from <paramref name="from"/>, including itself.</summary>
    private static HashSet<string> Closure(string from)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal) { from };
        var pending = new Queue<string>([from]);

        while (pending.Count > 0)
        {
            foreach (var next in SurveyStatuses.AllowedTransitionsFrom(pending.Dequeue()))
            {
                if (seen.Add(next))
                {
                    pending.Enqueue(next);
                }
            }
        }

        return seen;
    }

    [Fact]
    public void Exactly_one_status_collects_responses()
    {
        // The freeze argument below rests on this: if two statuses collected responses, a
        // survey could gather answers, be edited between them, and gather more against
        // different wording under one version number.
        Assert.Equal(
            [SurveyStatuses.Active],
            SurveyStatuses.All.Where(SurveyStatuses.AcceptsResponses));
    }

    [Fact]
    public void Exactly_one_status_permits_a_content_edit()
        => Assert.Equal(
            [SurveyStatuses.Draft],
            SurveyStatuses.All.Where(SurveyStatuses.AllowsContentEdit));

    [Fact]
    public void No_content_editable_status_is_reachable_once_responses_can_exist()
    {
        var reachable = Closure(SurveyStatuses.Active);

        var editable = reachable.Where(SurveyStatuses.AllowsContentEdit).ToList();

        Assert.True(
            editable.Count == 0,
            $"A survey that has collected responses can reach {string.Join(", ", editable)}, "
            + "where its content becomes editable again. Every response already given would "
            + "then answer a question that no longer exists as it was asked.");
    }

    [Fact]
    public void No_status_that_collects_responses_is_reachable_from_a_content_editable_one_without_publishing()
    {
        // Draft reaches active, but only through a transition IsPublish recognises -- which
        // is what guarantees a snapshot exists before the first response can arrive.
        foreach (var target in SurveyStatuses.AllowedTransitionsFrom(SurveyStatuses.Draft)
                     .Where(SurveyStatuses.AcceptsResponses))
        {
            Assert.True(
                SurveyStatuses.IsPublish(SurveyStatuses.Draft, target),
                $"draft -> {target} accepts responses but is not recognised as a publish, so no version "
                + "would be snapshotted and the responses would have no wording to resolve against.");
        }
    }

    [Fact]
    public void Every_edge_out_of_draft_into_a_respondent_visible_status_snapshots_a_version()
    {
        // The publish predicate and the transition map must not drift: an edge added from
        // draft to a respondent-visible status that IsPublish does not recognise would skip
        // both the translation gate and the snapshot.
        var respondentVisible = SurveyStatuses.AllowedTransitionsFrom(SurveyStatuses.Draft)
            .Where(s => SurveyStatuses.RespondentVisible.Contains(s, StringComparer.Ordinal))
            .ToList();

        Assert.NotEmpty(respondentVisible);
        Assert.All(respondentVisible, target => Assert.True(SurveyStatuses.IsPublish(SurveyStatuses.Draft, target)));
    }

    [Fact]
    public void Republishing_is_only_reachable_from_a_status_that_has_never_collected_responses()
    {
        // A second snapshot means the content changed after a first publish. That is legal
        // exactly once -- scheduled -> draft -> published again -- and scheduled does not
        // accept responses, so no answer can predate the version that replaced it.
        var backToDraft = SurveyStatuses.All
            .Where(s => SurveyStatuses.AllowedTransitionsFrom(s).Contains(SurveyStatuses.Draft, StringComparer.Ordinal))
            .ToList();

        Assert.Equal([SurveyStatuses.Scheduled], backToDraft);
        Assert.False(SurveyStatuses.AcceptsResponses(SurveyStatuses.Scheduled));
    }
}
