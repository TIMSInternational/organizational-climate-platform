using ClimateProject.Application.Reports;
using ClimateProject.Domain.Entities;

namespace ClimateProject.UnitTests.Reports;

/// <summary>
/// The regression net for #152.
///
/// <para>
/// These assert on insight data actually arriving in the section, not on types. The legacy bug
/// type-checked perfectly: two models with the same name, one of which the report generator
/// imported and nothing else populated, so the section came back empty with no error anywhere.
/// A test that only proved "the mapper compiles" would have passed against the broken code.
/// </para>
/// </summary>
public class ReportAIInsightsTests
{
    private static readonly Guid Acme = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Globex = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly DateTimeOffset Now = new(2026, 8, 5, 12, 0, 0, TimeSpan.Zero);

    private static AIInsight Insight(
        string title,
        Guid? companyId = null,
        DateTimeOffset? expiresAt = null,
        DateTimeOffset? createdAt = null,
        int confidenceScore = 87,
        bool isAcknowledged = false)
        => new()
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId ?? Acme,
            Type = "risk",
            Category = "attrition",
            Title = title,
            Description = "Engagement scores trending down over the last 3 cycles",
            ConfidenceScore = confidenceScore,
            Priority = "high",
            AffectedSegments = ["Engineering", "QA"],
            RecommendedActions = ["Schedule 1:1s", "Review workload distribution"],
            ExpiresAt = expiresAt,
            IsAcknowledged = isAcknowledged,
            CreatedAt = createdAt ?? Now.AddDays(-1),
            UpdatedAt = createdAt ?? Now.AddDays(-1),
        };

    [Fact]
    public void The_section_carries_the_insight_prose_and_not_just_its_identifiers()
    {
        // The legacy symptom was a section that rendered with the body missing. Assert the
        // fields a reader actually reads, not that a row came back.
        var item = Assert.Single(ReportAIInsights.ToSection([Insight("Elevated attrition risk in Engineering")]));

        Assert.Equal("Elevated attrition risk in Engineering", item.Title);
        Assert.Equal("Engagement scores trending down over the last 3 cycles", item.Description);
        Assert.Equal("risk", item.Type);
        Assert.Equal("attrition", item.Category);
        Assert.Equal("high", item.Priority);
        Assert.Equal(["Engineering", "QA"], item.AffectedSegments);
        Assert.Equal(["Schedule 1:1s", "Review workload distribution"], item.RecommendedActions);
    }

    [Fact]
    public void Confidence_reaches_the_report_as_the_0_to_100_integer_it_is_stored_as()
    {
        // req(#152): the rival legacy shape stored confidence as a 0-1 fraction. Read through
        // that shape, an 87 % insight arrives as 0.87 -- and as an int column, as 0. Pinning the
        // value is what distinguishes "read the right entity" from "read something insight-ish".
        var item = Assert.Single(ReportAIInsights.ToSection([Insight("High confidence", confidenceScore: 87)]));

        Assert.Equal(87, item.ConfidenceScore);
    }

    [Fact]
    public void An_expired_insight_is_dropped_and_a_live_one_is_kept()
    {
        var insights = new[]
        {
            Insight("Still true", expiresAt: Now.AddDays(30)),
            Insight("No longer true", expiresAt: Now.AddDays(-1)),
            Insight("Never expires"),
        }.AsQueryable();

        var kept = ReportAIInsights.ForCompany(insights, Acme, Now).ToList();

        Assert.Equal(2, kept.Count);
        Assert.DoesNotContain(kept, i => i.Title == "No longer true");
    }

    [Fact]
    public void Another_companys_insights_never_enter_the_section()
    {
        var insights = new[]
        {
            Insight("Ours"),
            Insight("Theirs", companyId: Globex),
        }.AsQueryable();

        var kept = ReportAIInsights.ForCompany(insights, Acme, Now).ToList();

        Assert.Equal("Ours", Assert.Single(kept).Title);
    }

    [Fact]
    public void An_acknowledged_insight_still_appears_carrying_its_acknowledgement_state()
    {
        // Acknowledgement records that a human read it, not that it stopped being true, so the
        // report keeps it and lets the renderer decide. Dropping it here would reproduce the
        // bug's symptom -- a missing section -- through a different door.
        var insights = new[] { Insight("Seen already", isAcknowledged: true) }.AsQueryable();

        var kept = ReportAIInsights.ForCompany(insights, Acme, Now).ToList();
        var item = Assert.Single(ReportAIInsights.ToSection(kept));

        Assert.True(item.IsAcknowledged);
        Assert.Equal("Seen already", item.Title);
    }

    [Fact]
    public void The_section_is_ordered_newest_first_and_deterministically()
    {
        var insights = new[]
        {
            Insight("Older", createdAt: Now.AddDays(-9)),
            Insight("Newest", createdAt: Now.AddHours(-1)),
            Insight("Middle", createdAt: Now.AddDays(-3)),
        }.AsQueryable();

        var titles = ReportAIInsights.ForCompany(insights, Acme, Now).Select(i => i.Title).ToList();

        Assert.Equal(["Newest", "Middle", "Older"], titles);
    }
}
