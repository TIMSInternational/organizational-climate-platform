using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Surveys;

public class SurveyDraftRetentionTests
{
    private static readonly DateTimeOffset Now = new(2026, 8, 6, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Retention_is_thirty_days()
    {
        Assert.Equal(TimeSpan.FromDays(30), SurveyDraftRetention.Ttl);
    }

    [Fact]
    public void A_save_pushes_expiry_a_full_ttl_out_from_the_save()
    {
        Assert.Equal(Now.AddDays(30), SurveyDraftRetention.ExpiresAt(Now));
    }

    /// <summary>
    /// The sliding part of the policy, and the reason the sweep can never take live work:
    /// a draft saved 29 days after it was created is good for another 30, not for one.
    /// </summary>
    [Fact]
    public void Expiry_slides_from_the_latest_save_not_from_creation()
    {
        var created = Now;
        var lastSave = created.AddDays(29);

        Assert.Equal(created.AddDays(59), SurveyDraftRetention.ExpiresAt(lastSave));
    }

    [Fact]
    public void A_draft_saved_just_now_is_not_expired()
    {
        Assert.False(SurveyDraftRetention.IsExpired(SurveyDraftRetention.ExpiresAt(Now), Now));
    }

    [Fact]
    public void A_draft_untouched_for_longer_than_the_ttl_is_expired()
    {
        var expiresAt = SurveyDraftRetention.ExpiresAt(Now);

        Assert.True(SurveyDraftRetention.IsExpired(expiresAt, Now.AddDays(30).AddSeconds(1)));
    }

    /// <summary>
    /// The boundary instant is expired, matching the <c>expires_at &gt; now</c> filter the
    /// endpoint queries use -- so the helper and the SQL can never disagree about whether
    /// a draft on the exact boundary is recoverable.
    /// </summary>
    [Fact]
    public void The_boundary_instant_counts_as_expired_matching_the_query_filter()
    {
        var expiresAt = SurveyDraftRetention.ExpiresAt(Now);

        Assert.True(SurveyDraftRetention.IsExpired(expiresAt, expiresAt));
        Assert.False(SurveyDraftRetention.IsExpired(expiresAt, expiresAt.AddTicks(-1)));
    }
}
