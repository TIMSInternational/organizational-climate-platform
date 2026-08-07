using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Surveys;

public class SurveyAuditingTests
{
    [Fact]
    public void The_action_vocabulary_is_the_survey_domains_own_and_stays_small()
        => Assert.Equal(
            ["created", "updated", "status_changed", "duplicated", "version_created"],
            SurveyAuditActions.All);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Created")]
    [InlineData("deleted")]
    [InlineData("viewed")]
    public void Anything_outside_the_vocabulary_is_rejected(string? action)
        => Assert.False(SurveyAuditActions.IsRecorded(action));

    [Fact]
    public void Deletion_is_deliberately_not_an_action()
    {
        // survey_audit_logs.survey_id cascades, so a "deleted" row would be deleted by the
        // same statement that deleted the survey. Durable deletion records need the
        // tenant-scoped audit_logs table, which belongs to #143.
        Assert.DoesNotContain("deleted", SurveyAuditActions.All);
    }

    [Fact]
    public void Entity_types_fit_the_column()
        => Assert.All(SurveyAuditEntityTypes.All, type => Assert.True(type.Length <= 20));

    [Fact]
    public void Actions_fit_the_column()
        => Assert.All(SurveyAuditActions.All, action => Assert.True(action.Length <= 30));

    [Fact]
    public void An_update_change_set_carries_only_its_field_paths()
    {
        var json = new SurveyAuditChangeSet(Fields: ["title", "questions[0].text"]).ToJson();

        Assert.Equal("""{"fields":["title","questions[0].text"]}""", json);
    }

    [Fact]
    public void A_status_change_set_carries_only_from_and_to()
        => Assert.Equal(
            """{"from":"draft","to":"active"}""",
            new SurveyAuditChangeSet(From: "draft", To: "active").ToJson());

    [Fact]
    public void A_version_change_set_carries_only_the_number()
        => Assert.Equal(
            """{"versionNumber":2}""",
            new SurveyAuditChangeSet(VersionNumber: 2).ToJson());

    [Fact]
    public void A_change_set_survives_a_round_trip()
    {
        var original = new SurveyAuditChangeSet(Fields: ["settings.anonymous"], From: "scheduled", To: "draft", VersionNumber: 3);

        var read = SurveyAuditChangeSet.FromJson(original.ToJson());

        // Member by member, not record equality: Fields is an IReadOnlyList, which the
        // compiler-generated Equals compares by reference.
        Assert.NotNull(read);
        Assert.Equal(["settings.anonymous"], read.Fields);
        Assert.Equal("scheduled", read.From);
        Assert.Equal("draft", read.To);
        Assert.Equal(3, read.VersionNumber);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    [InlineData("{ not json")]
    public void An_unreadable_change_payload_reads_back_as_null_rather_than_throwing(string? json)
        => Assert.Null(SurveyAuditChangeSet.FromJson(json));
}
