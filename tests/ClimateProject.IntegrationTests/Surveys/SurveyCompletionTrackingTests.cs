using System.Net;
using System.Net.Http.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// "Who has completed the assessment", recorded where it cannot be lost.
///
/// Before this, the only writer of <c>completed</c> was the page behind the emailed invitation
/// link. An employee who was already signed in and answered from their own list posted to
/// <c>/surveys/{id}/responses</c> and nowhere else, so their invitation stayed at <c>sent</c>
/// for good: the completion report under-counted them and the reminder sweep, whose outstanding
/// set is everything short of <c>completed</c>, chased people who had already answered.
///
/// This needs Postgres rather than a unit test because the thing under test is that the
/// invitation row and the response row move in ONE <c>SaveChanges</c>.
/// </summary>
[Collection("Postgres")]
public class SurveyCompletionTrackingTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;

    public SurveyCompletionTrackingTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
        _harness = new SurveyTestHarness(_factory, $"done-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync() => _companyId = await _harness.SeedCompanyAsync("Completion Co");

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<SurveyDetail> ActiveSurveyAsync(bool anonymous)
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);
        var request = SurveyTestHarness.MinimalRequest(_companyId) with
        {
            Settings = new SurveySettingsInput(Anonymous: anonymous),
        };
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, request);
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        return survey;
    }

    /// <summary>An invitation in the state the mail job leaves it in: minted and delivered.</summary>
    private Task InviteAsync(Guid surveyId, Guid userId, string status = SurveyInvitationStatuses.Sent)
        => _harness.WithDbAsync(async db =>
        {
            db.SurveyInvitations.Add(new SurveyInvitation
            {
                Id = Guid.NewGuid(),
                SurveyId = surveyId,
                UserId = userId,
                CompanyId = _companyId,
                Email = $"{userId:N}@done.test",
                InvitationToken = Guid.NewGuid().ToString("N"),
                Status = status,
                SentAt = DateTimeOffset.UtcNow.AddDays(-1),
                ExpiresAt = DateTimeOffset.UtcNow.AddDays(10),
                CreatedAt = DateTimeOffset.UtcNow.AddDays(-1),
                UpdatedAt = DateTimeOffset.UtcNow.AddDays(-1),
            });
            await db.SaveChangesAsync();
        });

    private Task<SurveyInvitation> InvitationAsync(Guid surveyId, Guid userId)
        => _harness.WithDbAsync(db => db.SurveyInvitations
            .AsNoTracking()
            .SingleAsync(i => i.SurveyId == surveyId && i.UserId == userId));

    /// <summary>
    /// The default question is <c>open_ended</c>, and an open question's answer IS its text:
    /// <c>SurveyAnswerValidation</c> refuses a separate <c>Text</c> comment on one with a 400.
    /// So the words go in <c>Value</c>.
    /// </summary>
    private static SubmitSurveyResponseRequest Answer(SurveyDetail survey, bool complete) =>
        new(
            Answers: [new SurveyAnswerInput(survey.Questions.Single().Id, Value: "todo bien")],
            SessionId: Guid.NewGuid().ToString("N"),
            IsComplete: complete);

    [Fact]
    public async Task An_identified_respondent_answering_from_inside_the_app_is_recorded_as_completed()
    {
        var survey = await ActiveSurveyAsync(anonymous: false);
        var (employee, userId) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId);
        await InviteAsync(survey.Id, userId);

        // Straight to /surveys/{id}/responses -- never touching /survey-invitations/{token}/completed,
        // which is the path that used to be the only writer.
        var submitted = await employee.PostAsJsonAsync($"/surveys/{survey.Id}/responses", Answer(survey, complete: true));
        Assert.Equal(HttpStatusCode.Created, submitted.StatusCode);

        var invitation = await InvitationAsync(survey.Id, userId);
        Assert.Equal(SurveyInvitationStatuses.Completed, invitation.Status);
        Assert.NotNull(invitation.CompletedAt);
    }

    [Fact]
    public async Task A_partial_save_does_not_complete_the_invitation()
    {
        var survey = await ActiveSurveyAsync(anonymous: false);
        var (employee, userId) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId);
        await InviteAsync(survey.Id, userId);

        var saved = await employee.PostAsJsonAsync($"/surveys/{survey.Id}/responses", Answer(survey, complete: false));
        saved.EnsureSuccessStatusCode();

        // Still outstanding, so the reminder sweep still reaches them -- which is correct:
        // they started and did not finish.
        var invitation = await InvitationAsync(survey.Id, userId);
        Assert.Equal(SurveyInvitationStatuses.Sent, invitation.Status);
        Assert.Null(invitation.CompletedAt);
    }

    /// <summary>
    /// The anonymity ceiling, enforced on the new writer exactly as it is on the token route.
    /// A per-person completion timestamp taken at the same instant as
    /// <c>responses.completion_time</c> is the join that un-anonymises the response.
    /// </summary>
    [Fact]
    public async Task An_anonymous_survey_records_nothing_against_the_individual()
    {
        var survey = await ActiveSurveyAsync(anonymous: true);
        var (employee, userId) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId);
        await InviteAsync(survey.Id, userId);

        var submitted = await employee.PostAsJsonAsync($"/surveys/{survey.Id}/responses", Answer(survey, complete: true));
        Assert.Equal(HttpStatusCode.Created, submitted.StatusCode);

        var invitation = await InvitationAsync(survey.Id, userId);
        Assert.Equal(SurveyInvitationStatuses.Sent, invitation.Status);
        Assert.Null(invitation.CompletedAt);
        Assert.Equal(SurveyInvitationStatuses.Opened, SurveyInvitationStatuses.AnonymityCeiling);
    }

    [Fact]
    public async Task A_revoked_invitation_is_not_walked_back_onto_the_ladder()
    {
        var survey = await ActiveSurveyAsync(anonymous: false);
        var (employee, userId) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId);
        await InviteAsync(survey.Id, userId, SurveyInvitationStatuses.Revoked);

        var submitted = await employee.PostAsJsonAsync($"/surveys/{survey.Id}/responses", Answer(survey, complete: true));
        // Asserted, because without it this test passes when the submission is REFUSED -- an
        // invitation that never moved is exactly what a 400 leaves behind too.
        Assert.Equal(HttpStatusCode.Created, submitted.StatusCode);

        var invitation = await InvitationAsync(survey.Id, userId);
        Assert.Equal(SurveyInvitationStatuses.Revoked, invitation.Status);
    }

    [Fact]
    public async Task A_respondent_with_no_invitation_completes_their_response_all_the_same()
    {
        var survey = await ActiveSurveyAsync(anonymous: false);
        var (employee, _) = await _harness.IdentifiedClientAsync(Roles.Employee, _companyId);

        // No invitation row at all -- the common case for a survey distributed by share link.
        // Recording completion must never become a precondition for recording the answer.
        var submitted = await employee.PostAsJsonAsync($"/surveys/{survey.Id}/responses", Answer(survey, complete: true));
        Assert.Equal(HttpStatusCode.Created, submitted.StatusCode);
    }
}
